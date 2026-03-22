from app.database import get_connection
from typing import Optional
import logging
import re
import time
import requests
from bs4 import BeautifulSoup
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta


logger = logging.getLogger(__name__)

TOPIX_TICKER_CANDIDATES = ["^TOPX", "1306.T", "1348.T", "1475.T"]
YFINANCE_MAX_RETRIES = 3
YFINANCE_RETRY_DELAY_SECONDS = 1
BETA_LOOKBACK_DAYS = 365 * 2
BETA_FETCH_BUFFER_DAYS = 30
BETA_HISTORY_START_TOLERANCE_DAYS = 30
BETA_HISTORY_END_TOLERANCE_DAYS = 14
BETA_MIN_WEEKLY_POINTS = 52
BETA_SHORT_LOOKBACK_DAYS = 90
BETA_SHORT_MIN_WEEKLY_POINTS = 8


def _calculate_current_fiscal_quarter(fiscal_year_end_month: Optional[int]):
    if fiscal_year_end_month is None:
        return None
    if fiscal_year_end_month < 1 or fiscal_year_end_month > 12:
        return None

    current_month = datetime.now().month
    fiscal_year_start_month = (fiscal_year_end_month % 12) + 1
    month_offset = (current_month - fiscal_year_start_month) % 12
    return month_offset // 3 + 1


def _parse_fiscal_year_end_month(raw_value):
    if raw_value is None:
        return None

    try:
        if isinstance(raw_value, (int, float)):
            value = int(raw_value)
            if 1 <= value <= 12:
                return value
            if 100 <= value <= 1231:
                month = value // 100
                if 1 <= month <= 12:
                    return month
        text = str(raw_value).strip()
        if not text:
            return None
        numeric = int(float(text))
        if 1 <= numeric <= 12:
            return numeric
        if 100 <= numeric <= 1231:
            month = numeric // 100
            if 1 <= month <= 12:
                return month
    except (TypeError, ValueError):
        return None

    return None


def _extract_fiscal_year_end_month_from_info(info: dict):
    fiscal_year_end_month = _parse_fiscal_year_end_month(
        info.get("fiscalYearEnd")
    )
    if fiscal_year_end_month is None:
        fiscal_year_end_month = _parse_fiscal_year_end_month(
            info.get("nextFiscalYearEnd")
        )
    if fiscal_year_end_month is None:
        fiscal_year_end_month = _parse_fiscal_year_end_month(
            info.get("lastFiscalYearEnd")
        )
    if fiscal_year_end_month is None:
        last_fiscal_year_end = _to_float_or_none(info.get("lastFiscalYearEnd"))
        if last_fiscal_year_end is not None:
            try:
                fiscal_year_end_month = datetime.fromtimestamp(
                    int(last_fiscal_year_end)
                ).month
            except (OverflowError, OSError, ValueError):
                fiscal_year_end_month = None
    return fiscal_year_end_month


def _candidate_ticker_symbols(code: str):
    code_text = str(code).strip()
    if code_text.startswith("^"):
        return [code_text]
    if "." in code_text:
        return [code_text]
    return [f"{code_text}.T", f"{code_text}.S"]


def _build_trade_metrics(trade_rows):
    metrics = {}
    side_rank = {"buy": 0, "sell": 1}

    normalized_rows = []
    for r in trade_rows:
        side_raw = str(r[2] or "").strip().lower()
        if side_raw in ("buy", "b", "買", "買い"):
            side = "buy"
        elif side_raw in ("sell", "s", "売", "売り"):
            side = "sell"
        else:
            continue
        normalized_rows.append((r[0], r[1], side, r[3], r[4], r[5]))

    normalized_rows.sort(
        key=lambda x: (
            x[0],  # stock_id
            x[1],  # trade_date
            side_rank.get(x[2], 2),  # buy first on same day
            x[5] if x[5] is not None else datetime.min,  # created_at
        )
    )

    for r in normalized_rows:
        stock_id = r[0]
        side = r[2]
        qty = int(r[3] or 0)
        price = float(r[4] or 0)

        if stock_id not in metrics:
            metrics[stock_id] = {
                "holding_qty": 0,
                "avg_cost": 0.0,
                "realized_pnl": 0.0,
            }

        m = metrics[stock_id]

        if side == "buy":
            total_cost = m["avg_cost"] * m["holding_qty"] + price * qty
            m["holding_qty"] += qty
            if m["holding_qty"] > 0:
                m["avg_cost"] = total_cost / m["holding_qty"]
            continue

        if side == "sell":
            matched_qty = min(qty, m["holding_qty"])
            if matched_qty > 0:
                m["realized_pnl"] += (price - m["avg_cost"]) * matched_qty
                m["holding_qty"] -= matched_qty
                if m["holding_qty"] == 0:
                    m["avg_cost"] = 0.0

    return metrics


def get_all_stocks():
    con = get_connection()
    _ensure_stock_info_table(con)
    _ensure_minkabu_table(con)
    _ensure_kabutan_table(con)
    _ensure_stock_metrics_table(con)
    rows = con.execute("""
        WITH latest_daily AS (
            SELECT
                stock_id,
                date,
                close,
                rsi14,
                rsi30,
                rsi60,
                LAG(close) OVER (
                    PARTITION BY stock_id
                    ORDER BY date
                ) AS prev_close,
                ROW_NUMBER() OVER (
                    PARTITION BY stock_id
                    ORDER BY date DESC
                ) AS rn
            FROM daily_prices
        ),
        latest_minkabu AS (
            SELECT
                stock_id,
                target_price,
                target_rating,
                theoretical_price,
                individual_price,
                individual_rating,
                analyst_price,
                analyst_rating,
                eps_growth_yoy,
                eps_growth_3y_avg,
                forecast_eps_growth,
                peg,
                per,
                fetched_date,
                updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY stock_id
                    ORDER BY fetched_date DESC, updated_at DESC
                ) AS rn
            FROM minkabu_forecasts
        ),
        latest_kabutan AS (
            SELECT
                stock_id,
                yield_total,
                yield_benefit,
                yield_dividend,
                fetched_date,
                updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY stock_id
                    ORDER BY fetched_date DESC, updated_at DESC
                ) AS rn
            FROM kabutan_yields
        ),
        latest_metrics AS (
            SELECT
                company_id,
                beta,
                beta_3m,
                calc_date,
                ROW_NUMBER() OVER (
                    PARTITION BY company_id
                    ORDER BY calc_date DESC
                ) AS rn
            FROM stock_metrics
        )
        SELECT
            s.id,
            s.code,
            s.name,
            s.industry,
            s.favorite,
            s.buy_price,
            s.sell_price,
            ld.date,
            ld.close,
            (ld.close - ld.prev_close) AS change_value,
            CASE
                WHEN ld.prev_close IS NULL OR ld.prev_close = 0 THEN NULL
                ELSE (ld.close - ld.prev_close) / ld.prev_close * 100
            END AS change_percent,
            ld.rsi14,
            ld.rsi30,
            ld.rsi60,
            lm.target_price,
            lm.target_rating,
            lm.theoretical_price,
            lm.individual_price,
            lm.individual_rating,
            lm.analyst_price,
            lm.analyst_rating,
            lm.eps_growth_yoy,
            lm.eps_growth_3y_avg,
            lm.forecast_eps_growth,
            lm.peg,
            lm.per,
            lm.fetched_date,
            lk.yield_total,
            lk.yield_benefit,
            lk.yield_dividend,
            lk.fetched_date,
            lmt.beta,
            lmt.beta_3m,
            lmt.calc_date,
            si.fiscal_year_end_month
        FROM stocks s
        LEFT JOIN latest_daily ld
            ON s.id = ld.stock_id
           AND ld.rn = 1
        LEFT JOIN latest_minkabu lm
            ON s.id = lm.stock_id
           AND lm.rn = 1
        LEFT JOIN latest_kabutan lk
            ON s.id = lk.stock_id
           AND lk.rn = 1
        LEFT JOIN latest_metrics lmt
            ON s.id = lmt.company_id
           AND lmt.rn = 1
        LEFT JOIN stock_info si
            ON s.id = si.stock_id
        ORDER BY favorite DESC, code
    """).fetchall()
    trade_rows = con.execute("""
        SELECT stock_id, trade_date, side, quantity, price, created_at
        FROM trade_history
        ORDER BY
            stock_id,
            trade_date,
            CASE
                WHEN lower(side) IN ('buy', 'b', '買', '買い') THEN 0
                WHEN lower(side) IN ('sell', 's', '売', '売り') THEN 1
                ELSE 2
            END,
            created_at
    """).fetchall()
    con.close()

    trade_metrics = _build_trade_metrics(trade_rows)

    return [
        {
            "id": r[0],
            "code": r[1],
            "name": r[2],
            "industry": r[3],
            "favorite": r[4],
            "buy_price": r[5],
            "sell_price": r[6],
            "latest_date": r[7],
            "latest_close": r[8],
            "holding_qty": trade_metrics.get(r[0], {}).get("holding_qty", 0),
            "avg_buy_price": (
                round(trade_metrics.get(r[0], {}).get("avg_cost", 0.0), 2)
                if trade_metrics.get(r[0], {}).get("holding_qty", 0) > 0
                else None
            ),
            "holding_value": (
                trade_metrics.get(r[0], {}).get("holding_qty", 0) * float(r[8])
                if r[8] is not None
                else None
            ),
            "unrealized_pnl": (
                round(
                    (
                        float(r[8]) - trade_metrics.get(r[0], {}).get("avg_cost", 0.0)
                    ) * trade_metrics.get(r[0], {}).get("holding_qty", 0),
                    2,
                )
                if (
                    r[8] is not None
                    and trade_metrics.get(r[0], {}).get("holding_qty", 0) > 0
                )
                else None
            ),
            "realized_pnl": round(
                trade_metrics.get(r[0], {}).get("realized_pnl", 0.0), 2
            ),
            "change_value": r[9],
            "change_percent": r[10],
            "rsi14": r[11],
            "rsi30": r[12],
            "rsi60": r[13],
            "minkabu_target_price": r[14],
            "minkabu_target_rating": r[15],
            "minkabu_theoretical_price": r[16],
            "minkabu_individual_price": r[17],
            "minkabu_individual_rating": r[18],
            "minkabu_analyst_price": r[19],
            "minkabu_analyst_rating": r[20],
            "minkabu_eps_growth_yoy": r[21],
            "minkabu_eps_growth_3y_avg": r[22],
            "minkabu_forecast_eps_growth": r[23],
            "minkabu_peg": r[24],
            "minkabu_per": r[25],
            "minkabu_fetched_date": r[26],
            "kabutan_total_yield": r[27],
            "kabutan_benefit_yield": r[28],
            "kabutan_dividend_yield": r[29],
            "kabutan_fetched_date": r[30],
            "beta": r[31],
            "beta_3m": r[32],
            "beta_calc_date": r[33],
            "fiscal_year_end_month": r[34],
            "current_fiscal_quarter": _calculate_current_fiscal_quarter(r[34]),
        }
        for r in rows
    ]


def create_stock(
    code: str,
    name: str,
    industry: Optional[str] = None,
    favorite: bool = False,
    buy_price: Optional[float] = None,
    sell_price: Optional[float] = None,
):
    con = get_connection()

    max_id = con.execute(
        "SELECT COALESCE(MAX(id), 0) FROM stocks"
    ).fetchone()[0]

    con.execute(
        """
        INSERT INTO stocks (id, code, name, industry, favorite, buy_price, sell_price)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [max_id + 1, code, name, industry, favorite, buy_price, sell_price],
    )

    con.commit()
    con.close()


def delete_stock(stock_id: int):
    con = get_connection()
    con.execute("DELETE FROM stocks WHERE id = ?", [stock_id])
    con.commit()
    con.close()


def update_stock(stock_id: int, updates: dict):
    con = get_connection()
    current = con.execute(
        """
        SELECT code, name, industry, favorite, buy_price, sell_price
        FROM stocks
        WHERE id = ?
        """,
        [stock_id],
    ).fetchone()
    if current is None:
        con.close()
        raise ValueError("Stock not found")

    code = updates["code"] if updates.get("code") is not None else current[0]
    name = updates["name"] if updates.get("name") is not None else current[1]
    industry = updates["industry"] if "industry" in updates else current[2]
    favorite = updates["favorite"] if updates.get("favorite") is not None else current[3]
    buy_price = updates["buy_price"] if "buy_price" in updates else current[4]
    sell_price = updates["sell_price"] if "sell_price" in updates else current[5]

    con.execute(
        """
        UPDATE stocks
        SET code = ?, name = ?, industry = ?, favorite = ?, buy_price = ?, sell_price = ?
        WHERE id = ?
        """,
        [code, name, industry, favorite, buy_price, sell_price, stock_id],
    )
    con.commit()
    con.close()


def add_trade_history(
    stock_id: int,
    trade_date: str,
    side: str,
    quantity: int,
    price: float,
):
    side_raw = str(side).strip().lower()
    if side_raw in ("buy", "b", "買", "買い"):
        side_normalized = "buy"
    elif side_raw in ("sell", "s", "売", "売り"):
        side_normalized = "sell"
    else:
        side_normalized = side_raw
    if side_normalized not in ("buy", "sell"):
        raise ValueError("side must be buy or sell")
    if quantity <= 0:
        raise ValueError("quantity must be > 0")
    if price <= 0:
        raise ValueError("price must be > 0")

    trade_day = datetime.strptime(trade_date, "%Y-%m-%d").date()

    con = get_connection()
    con.execute(
        """
        INSERT INTO trade_history (
            stock_id, trade_date, side, quantity, price, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [stock_id, trade_day, side_normalized, quantity, price, datetime.now()],
    )
    con.commit()
    con.close()


def get_trade_history(stock_id: int):
    con = get_connection()
    rows = con.execute(
        """
        SELECT stock_id, trade_date, side, quantity, price, created_at
        FROM trade_history
        WHERE stock_id = ?
        ORDER BY trade_date DESC, created_at DESC
        """,
        [stock_id],
    ).fetchall()
    con.close()

    return [
        {
            "stock_id": r[0],
            "trade_date": r[1],
            "side": r[2],
            "quantity": r[3],
            "price": r[4],
            "created_at": r[5],
        }
        for r in rows
    ]


def delete_trade_history(stock_id: int, created_at: str):
    ts_text = str(created_at).strip()
    if ts_text.endswith("Z"):
        ts_text = ts_text[:-1]

    try:
        ts = datetime.fromisoformat(ts_text)
    except ValueError:
        raise ValueError("created_at is invalid")

    con = get_connection()
    con.execute(
        """
        DELETE FROM trade_history
        WHERE stock_id = ? AND created_at = ?
        """,
        [stock_id, ts],
    )
    con.commit()
    con.close()

# =========================
# RSI計算
# =========================
def calculate_rsi(df, period=14):
    delta = df["Close"].diff()

    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    return rsi


# =========================
# 4年分取得 + 保存
# =========================
def update_daily_data(stock_id: int, code: str):
    end = datetime.today()
    start = end - timedelta(days=365 * 4)
    last_reason = "empty history"
    used_ticker = None
    df = pd.DataFrame()

    for ticker_symbol in _candidate_ticker_symbols(code):
        ticker = yf.Ticker(ticker_symbol)
        try:
            candidate = ticker.history(start=start, end=end)
            if candidate is not None and not candidate.empty:
                used_ticker = ticker_symbol
                df = candidate
                break
            last_reason = "empty history"
        except Exception as e:
            last_reason = str(e)

    if used_ticker is None or df.empty:
        return {
            "message": "No data",
            "ticker": ",".join(_candidate_ticker_symbols(code)),
            "reason": last_reason,
        }

    df.reset_index(inplace=True)

    # RSI計算
    df["rsi14"] = calculate_rsi(df, 14)
    df["rsi30"] = calculate_rsi(df, 30)
    df["rsi60"] = calculate_rsi(df, 60)

    con = get_connection()

    for _, row in df.iterrows():
        con.execute(
            """
            INSERT OR REPLACE INTO daily_prices
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                stock_id,
                row["Date"].date(),
                float(row["Open"]),
                float(row["High"]),
                float(row["Low"]),
                float(row["Close"]),
                int(row["Volume"]),
                float(row["rsi14"]) if not pd.isna(row["rsi14"]) else None,
                float(row["rsi30"]) if not pd.isna(row["rsi30"]) else None,
                float(row["rsi60"]) if not pd.isna(row["rsi60"]) else None,
            ],
        )

    con.commit()
    con.close()

    return {"message": "Daily data updated"}


def _chunked(items, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _dedupe_tickers(tickers):
    return list(dict.fromkeys([ticker for ticker in tickers if ticker]))


def _download_history_batch(
    tickers,
    start,
    end,
    interval: str = "1d",
    retries: int = YFINANCE_MAX_RETRIES,
):
    request_tickers = _dedupe_tickers(tickers)
    if not request_tickers:
        return pd.DataFrame(), "No tickers"

    last_error = "No data"
    for attempt in range(1, retries + 1):
        try:
            df = yf.download(
                tickers=request_tickers,
                start=start,
                end=end,
                interval=interval,
                group_by="ticker",
                auto_adjust=False,
                progress=False,
                threads=len(request_tickers) > 1,
            )
            if df is not None and not df.empty:
                return df, None
            last_error = "No data"
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "yfinance download failed attempt=%s/%s tickers=%s reason=%s",
                attempt,
                retries,
                ",".join(request_tickers),
                last_error,
            )
        if attempt < retries:
            time.sleep(YFINANCE_RETRY_DELAY_SECONDS)

    return pd.DataFrame(), last_error


def _normalize_history_frame(history_df):
    if history_df is None or history_df.empty:
        return None

    normalized = history_df.copy()
    if isinstance(normalized.columns, pd.MultiIndex):
        normalized.columns = normalized.columns.get_level_values(0)

    normalized = normalized.reset_index()
    if "Date" not in normalized.columns and len(normalized.columns) > 0:
        normalized.rename(columns={normalized.columns[0]: "Date"}, inplace=True)
    if "Date" not in normalized.columns:
        return None

    normalized["Date"] = pd.to_datetime(normalized["Date"], utc=True).dt.tz_localize(None)
    normalized = normalized.sort_values("Date")
    return normalized


def _extract_history_frame(downloaded_df, ticker_symbol: str):
    if downloaded_df is None or downloaded_df.empty:
        return None, "No data"

    history_df = downloaded_df
    if isinstance(downloaded_df.columns, pd.MultiIndex):
        available = set(downloaded_df.columns.get_level_values(0))
        if ticker_symbol not in available:
            return None, "Missing ticker in response"
        history_df = downloaded_df[ticker_symbol].copy()

    normalized = _normalize_history_frame(history_df)
    if normalized is None or normalized.empty:
        return None, "No rows"
    if "Close" not in normalized.columns:
        return None, "Missing Close column"
    if normalized["Close"].dropna().empty:
        return None, "No close data"
    return normalized, None


def _select_history_frame(downloaded_df, candidate_tickers):
    reasons = []

    for ticker_symbol in candidate_tickers:
        history_df, reason = _extract_history_frame(downloaded_df, ticker_symbol)
        if history_df is None:
            reasons.append(f"{ticker_symbol}:{reason}")
            continue
        return history_df, ticker_symbol, None

    if not reasons:
        return None, None, "No data"
    return None, None, "; ".join(reasons)


def _is_data_shortage_reason(reason: Optional[str]):
    if not reason:
        return False

    shortage_markers = (
        "No data",
        "No rows",
        "Missing ticker in response",
        "Missing Close column",
        "No close data",
        "Insufficient history",
        "Insufficient weekly returns",
        "Insufficient aligned weekly returns",
    )
    return any(marker in reason for marker in shortage_markers)


def _prepare_daily_history_frame(history_df):
    required_cols = {"Open", "High", "Low", "Close", "Volume"}
    if history_df is None or history_df.empty:
        return None, "No rows"
    if not required_cols.issubset(history_df.columns):
        return None, "Missing OHLCV columns"

    daily_df = history_df.dropna(subset=["Open", "High", "Low", "Close"]).copy()
    if daily_df.empty:
        return None, "All rows are NaN"

    daily_df["rsi14"] = calculate_rsi(daily_df, 14)
    daily_df["rsi30"] = calculate_rsi(daily_df, 30)
    daily_df["rsi60"] = calculate_rsi(daily_df, 60)
    daily_df["Date"] = pd.to_datetime(daily_df["Date"]).dt.date
    return daily_df, None


def _insert_daily_rows(con, stock_id: int, history_df, target_start):
    target_df = history_df[history_df["Date"] >= target_start]
    if target_df.empty:
        return 0

    inserted = 0
    for _, row in target_df.iterrows():
        con.execute(
            """
            INSERT OR REPLACE INTO daily_prices
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                stock_id,
                row["Date"],
                float(row["Open"]),
                float(row["High"]),
                float(row["Low"]),
                float(row["Close"]),
                int(row["Volume"]) if not pd.isna(row["Volume"]) else None,
                float(row["rsi14"]) if not pd.isna(row["rsi14"]) else None,
                float(row["rsi30"]) if not pd.isna(row["rsi30"]) else None,
                float(row["rsi60"]) if not pd.isna(row["rsi60"]) else None,
            ],
        )
        inserted += 1

    return inserted


def _prepare_weekly_returns(history_df, required_start, required_end, min_weekly_points=BETA_MIN_WEEKLY_POINTS):
    if history_df is None or history_df.empty:
        return None, "No rows"
    if "Close" not in history_df.columns:
        return None, "Missing Close column"

    close_series = (
        history_df[["Date", "Close"]]
        .dropna(subset=["Close"])
        .set_index("Date")["Close"]
        .sort_index()
        .astype(float)
    )
    if close_series.empty:
        return None, "No close data"

    allowed_start = (required_start + timedelta(days=BETA_HISTORY_START_TOLERANCE_DAYS)).date()
    allowed_end = (required_end - timedelta(days=BETA_HISTORY_END_TOLERANCE_DAYS)).date()

    first_date = close_series.index.min().date()
    last_date = close_series.index.max().date()
    if first_date > allowed_start:
        return None, f"Insufficient history start={first_date.isoformat()}"
    if last_date < allowed_end:
        return None, f"Insufficient history end={last_date.isoformat()}"

    weekly_returns = close_series.resample("W").last().pct_change().dropna()
    if len(weekly_returns) < min_weekly_points:
        return None, f"Insufficient weekly returns ({len(weekly_returns)})"

    return weekly_returns, None


def _calculate_beta_from_returns(stock_returns, market_returns, min_weekly_points=BETA_MIN_WEEKLY_POINTS):
    aligned = pd.concat(
        [
            stock_returns.rename("stock"),
            market_returns.rename("market"),
        ],
        axis=1,
        join="inner",
    ).dropna()

    if len(aligned) < min_weekly_points:
        return None, f"Insufficient aligned weekly returns ({len(aligned)})"

    market_variance = aligned["market"].var()
    if pd.isna(market_variance) or market_variance == 0:
        return None, "Market variance is zero"

    beta = aligned["stock"].cov(aligned["market"]) / market_variance
    if pd.isna(beta):
        return None, "Beta calculation returned NaN"

    return float(beta), None


def _update_daily_prices_batch(con, stock_rows, days: int, batch_size: int):
    today = datetime.today()
    fetch_start = today - timedelta(days=days + 90)
    fetch_end = today + timedelta(days=1)
    target_start = (today - timedelta(days=days)).date()

    updated_rows = 0
    updated_stocks = 0
    failed = []

    for stock_batch in _chunked(stock_rows, batch_size):
        batch_candidates = {
            stock_id: _candidate_ticker_symbols(code)
            for stock_id, code in stock_batch
        }
        batch_tickers = _dedupe_tickers(
            ticker_symbol
            for candidates in batch_candidates.values()
            for ticker_symbol in candidates
        )
        batch_df, batch_error = _download_history_batch(
            batch_tickers,
            start=fetch_start,
            end=fetch_end,
            interval="1d",
        )

        for stock_id, code in stock_batch:
            candidates = batch_candidates[stock_id]
            history_df, used_ticker, reason = _select_history_frame(batch_df, candidates)
            if history_df is None:
                fallback_df, fallback_error = _download_history_batch(
                    candidates,
                    start=fetch_start,
                    end=fetch_end,
                    interval="1d",
                )
                history_df, used_ticker, reason = _select_history_frame(fallback_df, candidates)
                if history_df is None:
                    failed.append(
                        {
                            "stock_id": stock_id,
                            "code": code,
                            "ticker": ",".join(candidates),
                            "reason": reason or fallback_error or batch_error or "No data",
                        }
                    )
                    continue

            daily_df, reason = _prepare_daily_history_frame(history_df)
            if daily_df is None:
                failed.append(
                    {
                        "stock_id": stock_id,
                        "code": code,
                        "ticker": used_ticker or ",".join(candidates),
                        "reason": reason or "Invalid OHLCV data",
                    }
                )
                continue

            inserted = _insert_daily_rows(con, stock_id, daily_df, target_start)
            if inserted > 0:
                updated_stocks += 1
                updated_rows += inserted

    logger.info(
        "daily price batch completed success=%s failed=%s",
        updated_stocks,
        len(failed),
    )

    return {
        "updated_stocks": updated_stocks,
        "updated_rows": updated_rows,
        "failed": failed,
    }


def _upsert_stock_metric(con, company_id: int, beta: Optional[float], beta_3m: Optional[float], calc_date):
    con.execute(
        """
        INSERT OR REPLACE INTO stock_metrics (company_id, beta, beta_3m, calc_date)
        VALUES (?, ?, ?, ?)
        """,
        [company_id, beta, beta_3m, calc_date],
    )


def _update_beta_batch(con, stock_rows, batch_size: int):
    calc_date = datetime.today().date()
    required_end = datetime.today()
    required_start = required_end - timedelta(days=BETA_LOOKBACK_DAYS)
    required_start_short = required_end - timedelta(days=BETA_SHORT_LOOKBACK_DAYS)
    fetch_start = required_start - timedelta(days=BETA_FETCH_BUFFER_DAYS)
    fetch_end = required_end + timedelta(days=1)

    updated_stocks = 0
    failed = []
    skipped = []

    for stock_batch in _chunked(stock_rows, batch_size):
        batch_candidates = {
            stock_id: _candidate_ticker_symbols(code)
            for stock_id, code in stock_batch
        }
        market_candidates = TOPIX_TICKER_CANDIDATES
        batch_tickers = _dedupe_tickers(
            [
                ticker_symbol
                for candidates in batch_candidates.values()
                for ticker_symbol in candidates
            ]
            + market_candidates
        )
        batch_df, batch_error = _download_history_batch(
            batch_tickers,
            start=fetch_start,
            end=fetch_end,
            interval="1d",
        )

        market_history_df, market_ticker, market_reason = _select_history_frame(
            batch_df,
            market_candidates,
        )
        if market_history_df is None:
            market_fallback_df, fallback_error = _download_history_batch(
                market_candidates,
                start=fetch_start,
                end=fetch_end,
                interval="1d",
            )
            market_history_df, market_ticker, market_reason = _select_history_frame(
                market_fallback_df,
                market_candidates,
            )
            if market_history_df is None:
                failed_reason = market_reason or fallback_error or batch_error or "Market download failed"
                for stock_id, code in stock_batch:
                    failed.append(
                        {
                            "company_id": stock_id,
                            "code": code,
                            "ticker": market_ticker or ",".join(market_candidates),
                            "reason": failed_reason,
                        }
                    )
                continue

        market_returns, market_reason = _prepare_weekly_returns(
            market_history_df,
            required_start,
            required_end,
        )
        market_returns_short, market_reason_short = _prepare_weekly_returns(
            market_history_df,
            required_start_short,
            required_end,
            min_weekly_points=BETA_SHORT_MIN_WEEKLY_POINTS,
        )
        if market_returns is None and market_returns_short is None:
            for stock_id, code in stock_batch:
                failed.append(
                    {
                        "company_id": stock_id,
                        "code": code,
                        "ticker": market_ticker or ",".join(market_candidates),
                        "reason": market_reason or market_reason_short or "Market weekly returns unavailable",
                    }
                )
            continue

        for stock_id, code in stock_batch:
            candidates = batch_candidates[stock_id]
            history_df, used_ticker, reason = _select_history_frame(batch_df, candidates)
            if history_df is None:
                fallback_df, fallback_error = _download_history_batch(
                    candidates,
                    start=fetch_start,
                    end=fetch_end,
                    interval="1d",
                )
                history_df, used_ticker, reason = _select_history_frame(fallback_df, candidates)
                if history_df is None:
                    result_row = {
                        "company_id": stock_id,
                        "code": code,
                        "ticker": ",".join(candidates),
                        "reason": reason or fallback_error or batch_error or "No data",
                    }
                    if _is_data_shortage_reason(result_row["reason"]):
                        skipped.append(result_row)
                    else:
                        failed.append(result_row)
                    continue

            stock_returns, reason = _prepare_weekly_returns(
                history_df,
                required_start,
                required_end,
            )
            stock_returns_short, reason_short = _prepare_weekly_returns(
                history_df,
                required_start_short,
                required_end,
                min_weekly_points=BETA_SHORT_MIN_WEEKLY_POINTS,
            )

            beta = None
            beta_reason = None
            if stock_returns is not None and market_returns is not None:
                beta, beta_reason = _calculate_beta_from_returns(stock_returns, market_returns)
            elif stock_returns is None:
                beta_reason = reason or "Insufficient long-term history"
            else:
                beta_reason = market_reason or "Market long-term returns unavailable"

            beta_3m = None
            beta_3m_reason = None
            if stock_returns_short is not None and market_returns_short is not None:
                beta_3m, beta_3m_reason = _calculate_beta_from_returns(
                    stock_returns_short,
                    market_returns_short,
                    min_weekly_points=BETA_SHORT_MIN_WEEKLY_POINTS,
                )
            elif stock_returns_short is None:
                beta_3m_reason = reason_short or "Insufficient 3-month history"
            else:
                beta_3m_reason = market_reason_short or "Market 3-month returns unavailable"

            if beta is None and beta_3m is None:
                reason_joined = " / ".join(
                    [r for r in [beta_reason, beta_3m_reason] if r]
                ) or "Unable to calculate beta"
                skipped.append(
                    {
                        "company_id": stock_id,
                        "code": code,
                        "ticker": used_ticker or ",".join(candidates),
                        "reason": reason_joined,
                    }
                )
                continue

            _upsert_stock_metric(con, stock_id, beta, beta_3m, calc_date)
            updated_stocks += 1

    logger.info(
        "beta batch completed success=%s skipped=%s failed=%s failed_codes=%s",
        updated_stocks,
        len(skipped),
        len(failed),
        ",".join(item["code"] for item in failed),
    )

    return {
        "updated_stocks": updated_stocks,
        "failed": failed,
        "skipped": skipped,
        "calc_date": calc_date.isoformat(),
    }


def update_all_daily_data(days: int = 7, batch_size: int = 50):

    con = get_connection()
    _ensure_stock_metrics_table(con)
    stock_rows = con.execute("""
        SELECT id, code
        FROM stocks
        ORDER BY id
    """).fetchall()

    if not stock_rows:
        con.close()
        return {
            "message": "No stocks to update",
            "updated_stocks": 0,
            "updated_rows": 0,
            "failed": [],
            "beta_updated_stocks": 0,
            "beta_failed": [],
            "beta_skipped": [],
        }

    daily_result = _update_daily_prices_batch(
        con,
        stock_rows,
        days=days,
        batch_size=batch_size,
    )
    beta_result = _update_beta_batch(
        con,
        stock_rows,
        batch_size=batch_size,
    )
    fiscal_info_result = _update_fiscal_year_end_month_batch(
        con,
        stock_rows,
        batch_size=batch_size,
    )

    con.commit()
    con.close()

    logger.info(
        "update_all_daily_data completed daily_success=%s beta_success=%s fiscal_success=%s",
        daily_result["updated_stocks"],
        beta_result["updated_stocks"],
        fiscal_info_result["updated_stocks"],
    )

    return {
        "message": "Daily data and beta updated",
        "days": days,
        "total_stocks": len(stock_rows),
        "updated_stocks": daily_result["updated_stocks"],
        "updated_rows": daily_result["updated_rows"],
        "failed": daily_result["failed"],
        "beta_updated_stocks": beta_result["updated_stocks"],
        "beta_failed": beta_result["failed"],
        "beta_skipped": beta_result["skipped"],
        "beta_calc_date": beta_result["calc_date"],
        "fiscal_info_updated_stocks": fiscal_info_result["updated_stocks"],
        "fiscal_info_failed": fiscal_info_result["failed"],
        "fiscal_info_skipped": fiscal_info_result["skipped"],
    }

def update_quarterly_earnings(stock_id: int, code: str):
    df = None
    for ticker_symbol in _candidate_ticker_symbols(code):
        ticker = yf.Ticker(ticker_symbol)
        candidate = ticker.quarterly_income_stmt
        if candidate is not None and not candidate.empty:
            df = candidate
            break

    if df is None or df.empty:
        return {"message": "No earnings data"}

    df = df.T  # 転置（列→行）
    df.reset_index(inplace=True)
    df.rename(columns={"index": "fiscal_period_end"}, inplace=True)

    # 前年同期比較のため直近8四半期を保持
    df = df.sort_values("fiscal_period_end", ascending=False).head(8)

    con = get_connection()

    inserted = 0

    for _, row in df.iterrows():

        fiscal_date = pd.to_datetime(row["fiscal_period_end"]).date()

        revenue = row.get("Total Revenue")
        operating_income = row.get("Operating Income")
        net_income = row.get("Net Income")
        eps = row.get("Diluted EPS")

        con.execute(
            """
            INSERT OR REPLACE INTO earnings
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                stock_id,
                fiscal_date,
                "quarter",
                float(revenue) if pd.notna(revenue) else None,
                float(operating_income) if pd.notna(operating_income) else None,
                float(net_income) if pd.notna(net_income) else None,
                float(eps) if pd.notna(eps) else None,
                datetime.now(),
            ],
        )

        inserted += 1

    con.commit()
    con.close()

    return {"inserted": inserted}


def get_earnings_data(stock_id: int):

    con = get_connection()

    rows = con.execute("""
        WITH ordered AS (
            SELECT
                stock_id,
                fiscal_period_end,
                period_type,
                revenue,
                operating_income,
                net_income,
                eps,
                LAG(revenue, 4) OVER (
                    PARTITION BY stock_id
                    ORDER BY fiscal_period_end
                ) AS revenue_prev_year
            FROM earnings
            WHERE stock_id = ?
        )
        SELECT
            fiscal_period_end,
            period_type,
            revenue,
            operating_income,
            net_income,
            eps,
            revenue_prev_year,
            CASE
                WHEN revenue_prev_year IS NULL OR revenue_prev_year = 0 THEN NULL
                ELSE (revenue - revenue_prev_year) / revenue_prev_year * 100
            END AS revenue_yoy_pct
        FROM ordered
        ORDER BY fiscal_period_end DESC
        LIMIT 8
    """, [stock_id]).fetchall()

    con.close()

    return [
        {
            "fiscal_period_end": r[0],
            "period_type": r[1],
            "revenue": r[2],
            "operating_income": r[3],
            "net_income": r[4],
            "eps": r[5],
            "revenue_prev_year": r[6],
            "revenue_yoy_pct": r[7],
        }
        for r in rows
    ]


def _to_float_or_none(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_dividend_yield(value):
    val = _to_float_or_none(value)
    if val is None:
        return None
    if val > 1:
        return val / 100
    return val


def _ensure_minkabu_table(con):
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS minkabu_forecasts (
            stock_id INTEGER,
            target_price DOUBLE,
            target_rating VARCHAR,
            theoretical_price DOUBLE,
            individual_price DOUBLE,
            individual_rating VARCHAR,
            analyst_price DOUBLE,
            analyst_rating VARCHAR,
            eps_growth_yoy DOUBLE,
            eps_growth_3y_avg DOUBLE,
            forecast_eps_growth DOUBLE,
            peg DOUBLE,
            per DOUBLE,
            fetched_date DATE,
            source_url VARCHAR,
            updated_at TIMESTAMP,
            UNIQUE (stock_id, fetched_date)
        )
        """
    )
    con.execute("ALTER TABLE minkabu_forecasts ADD COLUMN IF NOT EXISTS eps_growth_yoy DOUBLE")
    con.execute("ALTER TABLE minkabu_forecasts ADD COLUMN IF NOT EXISTS eps_growth_3y_avg DOUBLE")
    con.execute("ALTER TABLE minkabu_forecasts ADD COLUMN IF NOT EXISTS forecast_eps_growth DOUBLE")
    con.execute("ALTER TABLE minkabu_forecasts ADD COLUMN IF NOT EXISTS peg DOUBLE")
    con.execute("ALTER TABLE minkabu_forecasts ADD COLUMN IF NOT EXISTS per DOUBLE")


def _ensure_kabutan_table(con):
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS kabutan_yields (
            stock_id INTEGER,
            yield_total DOUBLE,
            yield_benefit DOUBLE,
            yield_dividend DOUBLE,
            fetched_date DATE,
            source_url VARCHAR,
            updated_at TIMESTAMP,
            UNIQUE (stock_id, fetched_date)
        )
        """
    )


def _ensure_stock_metrics_table(con):
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS stock_metrics (
            company_id INTEGER,
            beta DOUBLE,
            beta_3m DOUBLE,
            calc_date DATE,
            UNIQUE (company_id, calc_date)
        )
        """
    )
    con.execute("ALTER TABLE stock_metrics ADD COLUMN IF NOT EXISTS beta_3m DOUBLE")


def _ensure_stock_info_table(con):
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS stock_info (
            stock_id INTEGER PRIMARY KEY,
            long_name VARCHAR,
            short_name VARCHAR,
            sector VARCHAR,
            industry VARCHAR,
            market_cap DOUBLE,
            trailing_pe DOUBLE,
            forward_pe DOUBLE,
            dividend_yield DOUBLE,
            beta DOUBLE,
            website VARCHAR,
            business_summary VARCHAR,
            currency VARCHAR,
            country VARCHAR,
            updated_at TIMESTAMP
        )
        """
    )
    con.execute("ALTER TABLE stock_info ADD COLUMN IF NOT EXISTS fiscal_year_end_month INTEGER")


def _latest_value(values):
    if not values:
        return None
    for value in reversed(values):
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def _extract_minkabu_prices(payload: dict):
    stock = payload.get("stock") or {}
    return {
        "target_price": _latest_value(stock.get("mk_prices")),
        "individual_price": _latest_value(stock.get("picks_prices")),
        "theoretical_price": _latest_value(stock.get("theoretic_prices")),
    }


def _extract_minkabu_ratings(html: str):
    soup = BeautifulSoup(html, "html.parser")
    target_rating = None
    target_box = soup.select_one(".md_target_box_group .md_target_box")
    if target_box:
        header_plate = target_box.select_one(".md_target_box_header .md_picksPlate .value")
        if header_plate:
            target_rating = header_plate.get_text(strip=True)

    def find_body_rating(label_text: str):
        for item in soup.select(".md_target_box_body .md_box"):
            label = item.select_one(".label")
            if not label:
                continue
            if label.get_text(strip=True) != label_text:
                continue
            plate = item.select_one(".md_picksPlate")
            if plate:
                return plate.get_text(strip=True)
        return None

    return {
        "target_rating": target_rating,
        "individual_rating": find_body_rating("個人予想"),
        "analyst_rating": find_body_rating("アナリスト"),
    }


def _extract_kabutan_yields(html: str):
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.stock_yutai_top_1")
    if table:
        tds = table.select("tr td")
        if len(tds) >= 3:
            values = []
            for td in tds[:3]:
                text = td.get_text(strip=True).replace("％", "%")
                text = text.replace("．", ".").replace("・", ".")
                if text in ("-", "－", "―", "--", "—"):
                    values.append(0.0)
                    continue
                match = re.search(r"([0-9]+(?:\.[0-9]+)?)%", text)
                values.append(float(match.group(1)) if match else None)
            return {
                "yield_total": values[0],
                "yield_benefit": values[1],
                "yield_dividend": values[2],
            }

    return {"yield_total": None, "yield_benefit": None, "yield_dividend": None}


def _extract_kabutan_dividend_from_stock(html: str):
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        if "PER" in "".join(headers) and "利回り" in "".join(headers):
            for tr in table.find_all("tr"):
                tds = [td.get_text(strip=True) for td in tr.find_all("td")]
                if not tds:
                    continue
                # columns: PER, PBR, 利回り, 信用倍率, 時価総額 ...
                if len(tds) >= 3:
                    text = tds[2].replace("％", "%").replace("．", ".").replace("・", ".")
                    if text in ("-", "－", "―", "--", "—"):
                        return 0.0
                    match = re.search(r"([0-9]+(?:\.[0-9]+)?)%", text)
                    if match:
                        return float(match.group(1))
            break
    return None


def update_stock_info(stock_id: int, code: str):
    info = {}
    for ticker_symbol in _candidate_ticker_symbols(code):
        ticker = yf.Ticker(ticker_symbol)
        info = ticker.info or {}
        if info:
            break

    if not info:
        return {"message": "No info data"}

    fiscal_year_end_month = _extract_fiscal_year_end_month_from_info(info)

    con = get_connection()
    _ensure_stock_info_table(con)
    con.execute(
        """
        INSERT OR REPLACE INTO stock_info (
            stock_id,
            long_name,
            short_name,
            sector,
            industry,
            market_cap,
            trailing_pe,
            forward_pe,
            dividend_yield,
            beta,
            website,
            business_summary,
            currency,
            country,
            fiscal_year_end_month,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            stock_id,
            info.get("longName"),
            info.get("shortName"),
            info.get("sector"),
            info.get("industry"),
            _to_float_or_none(info.get("marketCap")),
            _to_float_or_none(info.get("trailingPE")),
            _to_float_or_none(info.get("forwardPE")),
            _normalize_dividend_yield(info.get("dividendYield")),
            _to_float_or_none(info.get("beta")),
            info.get("website"),
            info.get("longBusinessSummary"),
            info.get("currency"),
            info.get("country"),
            fiscal_year_end_month,
            datetime.now(),
        ],
    )
    con.commit()
    con.close()

    return {"message": "Stock info updated"}


def _update_fiscal_year_end_month_batch(con, stock_rows, batch_size: int):
    _ensure_stock_info_table(con)
    failed = []
    skipped = []
    updated_stocks = 0
    now = datetime.now()

    for i in range(0, len(stock_rows), batch_size):
        chunk = stock_rows[i:i + batch_size]
        for stock_id, code in chunk:
            try:
                info = {}
                used_ticker = None
                for ticker_symbol in _candidate_ticker_symbols(str(code)):
                    ticker = yf.Ticker(ticker_symbol)
                    candidate = ticker.info or {}
                    if candidate:
                        info = candidate
                        used_ticker = ticker_symbol
                        break

                if not info:
                    skipped.append(
                        {
                            "company_id": stock_id,
                            "code": code,
                            "ticker": None,
                            "reason": "No info data",
                        }
                    )
                    continue

                fiscal_year_end_month = _extract_fiscal_year_end_month_from_info(info)
                if fiscal_year_end_month is None:
                    skipped.append(
                        {
                            "company_id": stock_id,
                            "code": code,
                            "ticker": used_ticker,
                            "reason": "No fiscal year end month",
                        }
                    )
                    continue

                con.execute(
                    """
                    INSERT INTO stock_info (stock_id, fiscal_year_end_month, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT (stock_id) DO UPDATE SET
                        fiscal_year_end_month = EXCLUDED.fiscal_year_end_month,
                        updated_at = EXCLUDED.updated_at
                    """,
                    [stock_id, fiscal_year_end_month, now],
                )
                updated_stocks += 1
            except Exception as e:  # noqa: BLE001
                failed.append(
                    {
                        "company_id": stock_id,
                        "code": code,
                        "reason": str(e),
                    }
                )

    logger.info(
        "fiscal month batch completed success=%s skipped=%s failed=%s",
        updated_stocks,
        len(skipped),
        len(failed),
    )
    return {
        "updated_stocks": updated_stocks,
        "failed": failed,
        "skipped": skipped,
    }


def get_stock_info(stock_id: int):

    con = get_connection()
    _ensure_stock_info_table(con)
    _ensure_stock_metrics_table(con)
    row = con.execute(
        """
        WITH latest_metrics AS (
            SELECT
                company_id,
                beta,
                calc_date,
                ROW_NUMBER() OVER (
                    PARTITION BY company_id
                    ORDER BY calc_date DESC
                ) AS rn
            FROM stock_metrics
        )
        SELECT
            si.stock_id,
            si.long_name,
            si.short_name,
            si.sector,
            si.industry,
            si.market_cap,
            si.trailing_pe,
            si.forward_pe,
            si.dividend_yield,
            COALESCE(lm.beta, si.beta) AS beta,
            si.website,
            si.business_summary,
            si.currency,
            si.country,
            si.fiscal_year_end_month,
            si.updated_at,
            lm.calc_date
        FROM stock_info si
        LEFT JOIN latest_metrics lm
            ON si.stock_id = lm.company_id
           AND lm.rn = 1
        WHERE si.stock_id = ?
        """,
        [stock_id],
    ).fetchone()
    con.close()

    if not row:
        return None

    return {
        "stock_id": row[0],
        "long_name": row[1],
        "short_name": row[2],
        "sector": row[3],
        "industry": row[4],
        "market_cap": row[5],
        "trailing_pe": row[6],
        "forward_pe": row[7],
        "dividend_yield": _normalize_dividend_yield(row[8]),
        "beta": row[9],
        "website": row[10],
        "business_summary": row[11],
        "currency": row[12],
        "country": row[13],
        "fiscal_year_end_month": row[14],
        "current_fiscal_quarter": _calculate_current_fiscal_quarter(row[14]),
        "updated_at": row[15],
        "beta_calc_date": row[16],
    }


def update_stock_info_all():
    con = get_connection()
    _ensure_stock_info_table(con)
    stock_rows = con.execute(
        """
        SELECT id, code
        FROM stocks
        ORDER BY id
        """
    ).fetchall()
    con.close()

    updated = 0
    failed = []

    for stock_id, code in stock_rows:
        try:
            result = update_stock_info(stock_id, code)
            if result.get("message") == "Stock info updated":
                updated += 1
            else:
                failed.append(
                    {
                        "stock_id": stock_id,
                        "code": code,
                        "reason": result.get("message", "No info data"),
                    }
                )
        except Exception as e:
            failed.append(
                {
                    "stock_id": stock_id,
                    "code": code,
                    "reason": str(e),
                }
            )

    return {
        "message": "Stock info updated",
        "total_stocks": len(stock_rows),
        "updated_stocks": updated,
        "failed": failed,
    }


def _parse_number_from_text(text: Optional[str]):
    if text is None:
        return None
    normalized = str(text).strip().replace(",", "")
    normalized = normalized.replace("?", "%")
    normalized = normalized.replace("?", "-")
    normalized = normalized.replace("?", "-")
    m = re.search(r"-?[0-9]+(?:\.[0-9]+)?", normalized)
    if not m:
        return None
    try:
        return float(m.group(0))
    except (TypeError, ValueError):
        return None


def _extract_minkabu_per(html: str):
    soup = BeautifulSoup(html, "html.parser")
    for tr in soup.select("table tr"):
        th = tr.find("th")
        td = tr.find("td")
        if not th or not td:
            continue
        label = th.get_text(" ", strip=True)
        if "PER" not in label.upper():
            continue
        return _parse_number_from_text(td.get_text(" ", strip=True))
    return None


def _safe_growth_rate(new_value: Optional[float], old_value: Optional[float]):
    if new_value is None or old_value is None:
        return None
    if old_value == 0:
        return None
    return (new_value - old_value) / abs(old_value)


def _extract_eps_values_from_yfinance(code: str):
    for ticker_symbol in _candidate_ticker_symbols(code):
        try:
            stmt = yf.Ticker(ticker_symbol).quarterly_income_stmt
        except Exception:
            continue

        if stmt is None or stmt.empty:
            continue

        try:
            df = stmt.T.sort_index(ascending=False)
            eps_series = None
            for col in ("Diluted EPS", "Basic EPS"):
                if col in df.columns:
                    eps_series = df[col]
                    break
            if eps_series is None:
                continue
            vals = [float(v) for v in eps_series.dropna().tolist()]
            if vals:
                return vals
        except Exception:
            continue

    return []


def _compute_eps_growth_metrics(con, stock_id: int, code: str):
    eps_values = []
    try:
        eps_rows = con.execute(
            """
            SELECT fiscal_period_end, eps
            FROM earnings
            WHERE stock_id = ? AND eps IS NOT NULL
            ORDER BY fiscal_period_end DESC
            LIMIT 20
            """,
            [stock_id],
        ).fetchall()
        eps_values = [float(r[1]) for r in eps_rows if r[1] is not None]
    except Exception:
        eps_values = []

    # Fallback: when local earnings are not populated, fetch quarterly EPS directly.
    if len(eps_values) < 8:
        eps_values = _extract_eps_values_from_yfinance(code)

    if len(eps_values) < 8:
        return {"eps_growth_yoy": None, "eps_growth_3y_avg": None}

    latest_4 = sum(eps_values[0:4])
    prev_4 = sum(eps_values[4:8])
    eps_growth_yoy = _safe_growth_rate(latest_4, prev_4)

    eps_growth_3y_avg = None
    if len(eps_values) >= 16:
        latest_year = sum(eps_values[0:4])
        three_years_ago = sum(eps_values[12:16])
        if latest_year is not None and three_years_ago not in (None, 0) and latest_year > 0 and three_years_ago > 0:
            eps_growth_3y_avg = (latest_year / three_years_ago) ** (1 / 3) - 1

    return {
        "eps_growth_yoy": eps_growth_yoy,
        "eps_growth_3y_avg": eps_growth_3y_avg,
    }


def _fetch_yfinance_growth_metrics(code: str):
    for ticker_symbol in _candidate_ticker_symbols(code):
        try:
            info = yf.Ticker(ticker_symbol).info or {}
        except Exception:
            continue

        forecast_growth = _to_float_or_none(info.get("earningsGrowth"))
        yoy_growth = _to_float_or_none(info.get("earningsQuarterlyGrowth"))
        trailing_pe = _to_float_or_none(info.get("trailingPE"))
        forward_pe = _to_float_or_none(info.get("forwardPE"))
        per_value = trailing_pe if trailing_pe is not None else forward_pe

        if forecast_growth is not None or yoy_growth is not None or per_value is not None:
            return {
                "forecast_eps_growth": forecast_growth,
                "eps_growth_yoy": yoy_growth,
                # yfinance does not provide a clear 3Y EPS CAGR for all symbols.
                # Use annual earnings growth as a practical fallback proxy.
                "eps_growth_3y_avg": forecast_growth,
                "per": per_value,
            }

    return {
        "forecast_eps_growth": None,
        "eps_growth_yoy": None,
        "eps_growth_3y_avg": None,
        "per": None,
    }


def _calculate_peg(per: Optional[float], forecast_eps_growth: Optional[float]):
    if per is None or forecast_eps_growth is None:
        return None
    if forecast_eps_growth <= 0:
        return None
    growth_percent = forecast_eps_growth * 100
    if growth_percent == 0:
        return None
    return per / growth_percent


def update_minkabu_forecasts_all():
    con = get_connection()
    _ensure_minkabu_table(con)
    stock_rows = con.execute("""
        SELECT id, code
        FROM stocks
        ORDER BY id
    """).fetchall()

    today = datetime.today().date()
    updated = 0
    skipped = 0
    failed = []

    for stock_id, code in stock_rows:

        code_text = str(code or "").strip()
        if not code_text:
            failed.append({"stock_id": stock_id, "code": code, "reason": "Missing code"})
            continue

        minkabu_code = re.sub(r"\.T$", "", code_text)
        analysis_url = f"https://minkabu.jp/stock/{minkabu_code}/analysis"
        stock_url = f"https://minkabu.jp/stock/{minkabu_code}"
        json_url = f"https://assets.minkabu.jp/jsons/stock-jam/stocks/{minkabu_code}/lump.json"

        prices = {}
        ratings = {}
        valuation = {}

        try:
            json_res = requests.get(
                json_url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=20,
            )
            if json_res.status_code == 200:
                prices = _extract_minkabu_prices(json_res.json())
            else:
                failed.append({"stock_id": stock_id, "code": code_text, "reason": f"JSON HTTP {json_res.status_code}"})
                continue
        except Exception as e:
            failed.append({"stock_id": stock_id, "code": code_text, "reason": f"JSON error: {e}"})
            continue

        try:
            html_res = requests.get(
                analysis_url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=20,
            )
            if html_res.status_code == 200:
                ratings = _extract_minkabu_ratings(html_res.text)
            else:
                ratings = {}
        except Exception:
            ratings = {}

        try:
            stock_res = requests.get(
                stock_url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=20,
            )
            if stock_res.status_code == 200:
                valuation["per"] = _extract_minkabu_per(stock_res.text)
            else:
                valuation["per"] = None
        except Exception:
            valuation["per"] = None

        eps_metrics = _compute_eps_growth_metrics(con, stock_id, code_text)
        yf_growth_metrics = _fetch_yfinance_growth_metrics(code_text)

        if eps_metrics.get("eps_growth_yoy") is None:
            eps_metrics["eps_growth_yoy"] = yf_growth_metrics.get("eps_growth_yoy")
        if eps_metrics.get("eps_growth_3y_avg") is None:
            eps_metrics["eps_growth_3y_avg"] = yf_growth_metrics.get("eps_growth_3y_avg")

        forecast_eps_growth = yf_growth_metrics.get("forecast_eps_growth")
        per_value = valuation.get("per")
        if per_value is None:
            per_value = yf_growth_metrics.get("per")

        data = {
            "target_price": prices.get("target_price"),
            "target_rating": ratings.get("target_rating"),
            "theoretical_price": prices.get("theoretical_price"),
            "individual_price": prices.get("individual_price"),
            "individual_rating": ratings.get("individual_rating"),
            "analyst_price": None,
            "analyst_rating": ratings.get("analyst_rating"),
            "eps_growth_yoy": eps_metrics.get("eps_growth_yoy"),
            "eps_growth_3y_avg": eps_metrics.get("eps_growth_3y_avg"),
            "forecast_eps_growth": forecast_eps_growth,
            "per": per_value,
            "peg": _calculate_peg(per_value, forecast_eps_growth),
        }

        if all(value is None for value in data.values()):
            failed.append({"stock_id": stock_id, "code": code_text, "reason": "Parse failed"})
            continue

        con.execute(
            """
            INSERT OR REPLACE INTO minkabu_forecasts (
                stock_id,
                target_price,
                target_rating,
                theoretical_price,
                individual_price,
                individual_rating,
                analyst_price,
                analyst_rating,
                eps_growth_yoy,
                eps_growth_3y_avg,
                forecast_eps_growth,
                peg,
                per,
                fetched_date,
                source_url,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                stock_id,
                data.get("target_price"),
                data.get("target_rating"),
                data.get("theoretical_price"),
                data.get("individual_price"),
                data.get("individual_rating"),
                data.get("analyst_price"),
                data.get("analyst_rating"),
                data.get("eps_growth_yoy"),
                data.get("eps_growth_3y_avg"),
                data.get("forecast_eps_growth"),
                data.get("peg"),
                data.get("per"),
                today,
                analysis_url,
                datetime.now(),
            ],
        )
        updated += 1

    con.commit()
    con.close()

    return {
        "message": "Minkabu forecasts updated",
        "total_stocks": len(stock_rows),
        "updated_stocks": updated,
        "skipped_stocks": skipped,
        "failed": failed,
    }


def update_kabutan_yields_all():
    con = get_connection()
    _ensure_kabutan_table(con)
    stock_rows = con.execute("""
        SELECT id, code
        FROM stocks
        ORDER BY id
    """).fetchall()

    today = datetime.today().date()
    updated = 0
    skipped = 0
    failed = []

    for stock_id, code in stock_rows:
        exists = con.execute(
            """
            SELECT 1
            FROM kabutan_yields
            WHERE stock_id = ? AND fetched_date = ?
            """,
            [stock_id, today],
        ).fetchone()
        if exists:
            skipped += 1
            continue

        code_text = str(code or "").strip()
        if not code_text:
            failed.append({"stock_id": stock_id, "code": code, "reason": "Missing code"})
            continue

        kabutan_code = re.sub(r"\\D", "", code_text)
        if not kabutan_code:
            failed.append({"stock_id": stock_id, "code": code_text, "reason": "Invalid code"})
            continue

        yutai_url = f"https://kabutan.jp/stock/yutai?code={kabutan_code}"
        stock_url = f"https://kabutan.jp/stock/?code={kabutan_code}"
        try:
            res = requests.get(
                yutai_url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=20,
            )
        except Exception as e:
            failed.append({"stock_id": stock_id, "code": code_text, "reason": str(e)})
            continue

        if res.status_code != 200:
            failed.append({"stock_id": stock_id, "code": code_text, "reason": f"HTTP {res.status_code}"})
            continue

        data = _extract_kabutan_yields(res.text)
        if all(value is None for value in data.values()):
            try:
                stock_res = requests.get(
                    stock_url,
                    headers={"User-Agent": "Mozilla/5.0"},
                    timeout=20,
                )
            except Exception as e:
                failed.append({"stock_id": stock_id, "code": code_text, "reason": f"Fallback error: {e}"})
                continue

            if stock_res.status_code != 200:
                failed.append({"stock_id": stock_id, "code": code_text, "reason": f"Fallback HTTP {stock_res.status_code}"})
                continue

            dividend = _extract_kabutan_dividend_from_stock(stock_res.text)
            if dividend is None:
                failed.append({"stock_id": stock_id, "code": code_text, "reason": "Parse failed"})
                continue
            data = {
                "yield_total": dividend,
                "yield_benefit": 0.0,
                "yield_dividend": dividend,
            }

        con.execute(
            """
            INSERT OR REPLACE INTO kabutan_yields
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                stock_id,
                data.get("yield_total"),
                data.get("yield_benefit"),
                data.get("yield_dividend"),
                today,
                yutai_url,
                datetime.now(),
            ],
        )
        updated += 1

    con.commit()
    con.close()

    return {
        "message": "Kabutan yields updated",
        "total_stocks": len(stock_rows),
        "updated_stocks": updated,
        "skipped_stocks": skipped,
        "failed": failed,
    }


def get_chart_data(stock_id: int, start: str, end: str):

    con = get_connection()

    rows = con.execute("""
        SELECT date, open, high, low, close, volume,
               rsi14, rsi30, rsi60
        FROM daily_prices
        WHERE stock_id = ?
          AND date BETWEEN ? AND ?
        ORDER BY date
    """, [stock_id, start, end]).fetchall()

    con.close()

    return [
        {
            "time": r[0],
            "open": r[1],
            "high": r[2],
            "low": r[3],
            "close": r[4],
            # "volume": r[5],
            "rsi14": r[6],
            #"rsi30": r[7],
            #"rsi60": r[8],
        }
        for r in rows
    ]

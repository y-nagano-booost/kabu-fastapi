from app.database import get_connection
from typing import Optional
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta


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
            ld.rsi60
        FROM stocks s
        LEFT JOIN latest_daily ld
            ON s.id = ld.stock_id
           AND ld.rn = 1
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


def update_stock(
    stock_id: int,
    code: str,
    name: str,
    industry: Optional[str],
    favorite: bool,
    buy_price: Optional[float],
    sell_price: Optional[float],
):
    con = get_connection()
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


def update_all_daily_data(days: int = 7, batch_size: int = 50):

    con = get_connection()
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
        }

    today = datetime.today()
    fetch_start = today - timedelta(days=days + 90)
    fetch_end = today + timedelta(days=1)
    target_start = (today - timedelta(days=days)).date()

    ticker_to_stock_id = {}
    stock_to_candidates = {}
    tickers = []
    for stock_id, code in stock_rows:
        candidates = _candidate_ticker_symbols(code)
        stock_to_candidates[stock_id] = candidates
        for ticker_symbol in candidates:
            ticker_to_stock_id[ticker_symbol] = stock_id
            tickers.append(ticker_symbol)

    updated_rows = 0
    updated_stocks = 0
    failed = []

    for batch in _chunked(tickers, batch_size):
        try:
            df = yf.download(
                tickers=batch,
                start=fetch_start,
                end=fetch_end,
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                progress=False,
                threads=True,
            )
        except Exception as e:
            # バッチ失敗時は巻き添えを防ぐため、1銘柄ずつ再試行する
            for ticker in batch:
                stock_id = ticker_to_stock_id[ticker]
                try:
                    single_df = yf.download(
                        tickers=ticker,
                        start=fetch_start,
                        end=fetch_end,
                        interval="1d",
                        auto_adjust=False,
                        progress=False,
                        threads=False,
                    )
                except Exception as se:
                    failed.append({"ticker": ticker, "reason": f"batch:{e} single:{se}"})
                    continue

                if single_df is None or single_df.empty:
                    failed.append({"ticker": ticker, "reason": "No data"})
                    continue

                try:
                    stock_df = single_df.copy()
                    if isinstance(stock_df.columns, pd.MultiIndex):
                        stock_df.columns = stock_df.columns.get_level_values(0)

                    stock_df = stock_df.reset_index()
                    if "Date" not in stock_df.columns:
                        stock_df.rename(columns={stock_df.columns[0]: "Date"}, inplace=True)

                    required_cols = {"Open", "High", "Low", "Close", "Volume"}
                    if not required_cols.issubset(stock_df.columns):
                        failed.append({"ticker": ticker, "reason": "Missing OHLCV columns"})
                        continue

                    stock_df = stock_df.dropna(subset=["Open", "High", "Low", "Close"])
                    if stock_df.empty:
                        failed.append({"ticker": ticker, "reason": "All rows are NaN"})
                        continue

                    stock_df["rsi14"] = calculate_rsi(stock_df, 14)
                    stock_df["rsi30"] = calculate_rsi(stock_df, 30)
                    stock_df["rsi60"] = calculate_rsi(stock_df, 60)
                    stock_df["Date"] = pd.to_datetime(stock_df["Date"]).dt.date

                    target_df = stock_df[stock_df["Date"] >= target_start]
                    if target_df.empty:
                        continue

                    inserted_for_stock = 0
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
                        inserted_for_stock += 1

                    if inserted_for_stock > 0:
                        updated_stocks += 1
                        updated_rows += inserted_for_stock
                except Exception as ie:
                    failed.append({"ticker": ticker, "reason": str(ie)})
            continue

        if df is None or df.empty:
            for ticker in batch:
                failed.append({"ticker": ticker, "reason": "No data"})
            continue

        processed_stock_ids = set()
        for ticker in batch:
            stock_id = ticker_to_stock_id[ticker]
            if stock_id in processed_stock_ids:
                continue
            try:
                stock_df = None
                chosen_ticker = None
                if isinstance(df.columns, pd.MultiIndex):
                    available = set(df.columns.get_level_values(0))
                    for candidate in stock_to_candidates.get(stock_id, []):
                        if candidate in available:
                            tmp = df[candidate].copy()
                            if tmp is not None and not tmp.empty:
                                stock_df = tmp
                                chosen_ticker = candidate
                                break
                else:
                    # 単一銘柄レスポンス
                    stock_df = df.copy()
                    chosen_ticker = ticker

                if stock_df is None:
                    failed.append({"ticker": ",".join(stock_to_candidates.get(stock_id, [ticker])), "reason": "Missing ticker in response"})
                    continue

                if stock_df.empty:
                    failed.append({"ticker": chosen_ticker or ticker, "reason": "No rows"})
                    continue

                stock_df = stock_df.reset_index()
                if "Date" not in stock_df.columns:
                    stock_df.rename(columns={stock_df.columns[0]: "Date"}, inplace=True)

                required_cols = {"Open", "High", "Low", "Close", "Volume"}
                if not required_cols.issubset(stock_df.columns):
                    failed.append({"ticker": chosen_ticker or ticker, "reason": "Missing OHLCV columns"})
                    continue

                stock_df = stock_df.dropna(subset=["Open", "High", "Low", "Close"])
                if stock_df.empty:
                    failed.append({"ticker": chosen_ticker or ticker, "reason": "All rows are NaN"})
                    continue

                stock_df["rsi14"] = calculate_rsi(stock_df, 14)
                stock_df["rsi30"] = calculate_rsi(stock_df, 30)
                stock_df["rsi60"] = calculate_rsi(stock_df, 60)
                stock_df["Date"] = pd.to_datetime(stock_df["Date"]).dt.date

                target_df = stock_df[stock_df["Date"] >= target_start]
                if target_df.empty:
                    continue

                inserted_for_stock = 0
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
                    inserted_for_stock += 1

                if inserted_for_stock > 0:
                    updated_stocks += 1
                    updated_rows += inserted_for_stock
                processed_stock_ids.add(stock_id)

            except Exception as e:
                failed.append({"ticker": ticker, "reason": str(e)})

    con.commit()
    con.close()

    return {
        "message": "Daily data updated",
        "days": days,
        "total_stocks": len(stock_rows),
        "updated_stocks": updated_stocks,
        "updated_rows": updated_rows,
        "failed": failed,
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


def update_stock_info(stock_id: int, code: str):
    info = {}
    for ticker_symbol in _candidate_ticker_symbols(code):
        ticker = yf.Ticker(ticker_symbol)
        info = ticker.info or {}
        if info:
            break

    if not info:
        return {"message": "No info data"}

    con = get_connection()
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
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            datetime.now(),
        ],
    )
    con.commit()
    con.close()

    return {"message": "Stock info updated"}


def get_stock_info(stock_id: int):

    con = get_connection()
    row = con.execute(
        """
        SELECT
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
            updated_at
        FROM stock_info
        WHERE stock_id = ?
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
        "updated_at": row[14],
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

import { useEffect, useRef, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType
} from "lightweight-charts"

type Price = {
  time: string
  open: number
  high: number
  low: number
  close: number
  rsi14: number | null
}

type Stock = {
  id: number
  code: string
  name: string
}

type LinePoint = {
  time: string
  value: number
}

type Earnings = {
  fiscal_period_end: string
  period_type: string
  revenue: number | null
  operating_income: number | null
  net_income: number | null
  eps: number | null
  revenue_prev_year: number | null
  revenue_yoy_pct: number | null
}

type StockInfo = {
  stock_id: number
  long_name: string | null
  short_name: string | null
  sector: string | null
  industry: string | null
  market_cap: number | null
  trailing_pe: number | null
  forward_pe: number | null
  dividend_yield: number | null
  beta: number | null
  beta_calc_date: string | null
  website: string | null
  business_summary: string | null
  currency: string | null
  country: string | null
  updated_at: string | null
}

const formatDate = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const calculateBollingerBands = (
  data: Price[],
  period = 20,
  stdMultiplier = 2
) => {
  const upper: LinePoint[] = []
  const middle: LinePoint[] = []
  const lower: LinePoint[] = []

  for (let i = period - 1; i < data.length; i += 1) {
    const window = data.slice(i - period + 1, i + 1)
    const closes = window.map((p) => p.close)
    const sma = closes.reduce((sum, v) => sum + v, 0) / period
    const variance =
      closes.reduce((sum, v) => sum + (v - sma) * (v - sma), 0) / period
    const stdev = Math.sqrt(variance)

    middle.push({ time: data[i].time, value: sma })
    upper.push({ time: data[i].time, value: sma + stdev * stdMultiplier })
    lower.push({ time: data[i].time, value: sma - stdev * stdMultiplier })
  }

  return { upper, middle, lower }
}

const calculateSimpleMovingAverage = (data: Price[], period: number) => {
  const result: LinePoint[] = []

  for (let i = period - 1; i < data.length; i += 1) {
    const window = data.slice(i - period + 1, i + 1)
    const avg = window.reduce((sum, p) => sum + p.close, 0) / period
    result.push({ time: data[i].time, value: avg })
  }

  return result
}

export default function StockDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const stockDropdownRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const rsiRef = useRef<HTMLDivElement | null>(null)
  const earningsRef = useRef<HTMLDivElement | null>(null)
  const [stocks, setStocks] = useState<Stock[]>([])
  const [prices, setPrices] = useState<Price[]>([])
  const [earnings, setEarnings] = useState<Earnings[]>([])
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null)
  const [isUpdatingDaily, setIsUpdatingDaily] = useState(false)
  const [updateMessage, setUpdateMessage] = useState("")
  const [isUpdatingEarnings, setIsUpdatingEarnings] = useState(false)
  const [earningsMessage, setEarningsMessage] = useState("")
  const [isUpdatingInfo, setIsUpdatingInfo] = useState(false)
  const [infoMessage, setInfoMessage] = useState("")
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [isEarningsOpen, setIsEarningsOpen] = useState(false)
  const [stockFilter, setStockFilter] = useState("")
  const [isStockMenuOpen, setIsStockMenuOpen] = useState(false)
  const today = new Date()
  const fourMonthsAgo = new Date()
  fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4)
  const [startDate, setStartDate] = useState(formatDate(fourMonthsAgo))
  const [endDate, setEndDate] = useState(formatDate(today))

  useEffect(() => {
    fetch("http://localhost:8000/api/stocks", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setStocks(data))
  }, [])

  const fetchChartData = (stockId: string, start: string, end: string) => {
    fetch(`http://localhost:8000/api/stocks/${stockId}/chart?start=${start}&end=${end}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setPrices(data))
  }

  const fetchEarningsData = (stockId: string) => {
    fetch(`http://localhost:8000/api/stocks/${stockId}/earnings`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setEarnings(data))
  }

  const fetchStockInfo = (stockId: string) => {
    fetch(`http://localhost:8000/api/stocks/${stockId}/info`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) return null
        return res.json()
      })
      .then((data) => setStockInfo(data))
      .catch(() => setStockInfo(null))
  }

  useEffect(() => {
    if (!id) return
    fetchChartData(id, startDate, endDate)
    fetchEarningsData(id)
    fetchStockInfo(id)
  }, [id, startDate, endDate])

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        stockDropdownRef.current &&
        !stockDropdownRef.current.contains(event.target as Node)
      ) {
        setIsStockMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  const handleUpdateDaily = async () => {
    if (!id || isUpdatingDaily) return
    setIsUpdatingDaily(true)
    setUpdateMessage("日次データを更新中...")
    try {
      const res = await fetch(`http://localhost:8000/api/stocks/${id}/update-daily`, {
        method: "POST",
      })
      if (!res.ok) {
        setUpdateMessage("更新に失敗しました")
        return
      }
      setUpdateMessage("日次データを更新しました")
      fetchChartData(id, startDate, endDate)
    } catch {
      setUpdateMessage("更新に失敗しました")
    } finally {
      setIsUpdatingDaily(false)
    }
  }

  const handleUpdateEarnings = async () => {
    if (!id || isUpdatingEarnings) return
    setIsUpdatingEarnings(true)
    setEarningsMessage("決算データを更新中...")
    try {
      const res = await fetch(`http://localhost:8000/api/stocks/${id}/update-earnings`, {
        method: "POST",
      })
      if (!res.ok) {
        setEarningsMessage("更新に失敗しました")
        return
      }
      setEarningsMessage("決算データを更新しました")
      fetchEarningsData(id)
    } catch {
      setEarningsMessage("更新に失敗しました")
    } finally {
      setIsUpdatingEarnings(false)
    }
  }

  const handleUpdateInfo = async () => {
    if (!id || isUpdatingInfo) return
    setIsUpdatingInfo(true)
    setInfoMessage("企業情報を更新中...")
    try {
      const res = await fetch(`http://localhost:8000/api/stocks/${id}/update-info`, {
        method: "POST",
      })
      if (!res.ok) {
        setInfoMessage("更新に失敗しました")
        return
      }
      setInfoMessage("企業情報を更新しました")
      fetchStockInfo(id)
    } catch {
      setInfoMessage("更新に失敗しました")
    } finally {
      setIsUpdatingInfo(false)
    }
  }

  // ローソク足
  useEffect(() => {
    if (!chartRef.current || prices.length === 0) return

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#333",
      },
      width: chartRef.current.clientWidth,
      height: 400,
    })

    const candleSeries = chart.addSeries(CandlestickSeries)
    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: "#2563eb",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const bbMiddleSeries = chart.addSeries(LineSeries, {
      color: "#6b7280",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: "#2563eb",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const ma14Series = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    const ma60Series = chart.addSeries(LineSeries, {
      color: "#8b5cf6",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    candleSeries.setData(
      prices.map((p) => ({
        time: p.time,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
      }))
    )
    const bb = calculateBollingerBands(prices, 20, 2)
    bbUpperSeries.setData(bb.upper)
    bbMiddleSeries.setData(bb.middle)
    bbLowerSeries.setData(bb.lower)
    ma14Series.setData(calculateSimpleMovingAverage(prices, 14))
    ma60Series.setData(calculateSimpleMovingAverage(prices, 60))

    chart.timeScale().fitContent()

    return () => chart.remove()
  }, [prices])

  // RSI
  useEffect(() => {
    if (!rsiRef.current || prices.length === 0) return

    const rsiChart = createChart(rsiRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#333",
      },
      width: rsiRef.current.clientWidth,
      height: 150,
    })

    const rsiSeries = rsiChart.addSeries(LineSeries, {
      color: "red",
      lineWidth: 2,
    })

    rsiSeries.setData(
    prices
        .filter((p) => p.rsi14 !== null)
        .map((p) => ({
          time: p.time,
        value: Number(p.rsi14),
        }))
    )

    rsiChart.timeScale().fitContent()

    return () => rsiChart.remove()
  }, [prices])

  // Earnings 前年比較
  useEffect(() => {
    if (!earningsRef.current || earnings.length === 0) return

    const earningsChart = createChart(earningsRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#333",
      },
      width: earningsRef.current.clientWidth,
      height: 220,
    })

    const revenueSeries = earningsChart.addSeries(LineSeries, {
      color: "#2563eb",
      lineWidth: 2,
    })
    const prevYearSeries = earningsChart.addSeries(LineSeries, {
      color: "#9ca3af",
      lineWidth: 2,
    })

    const sorted = [...earnings].reverse()
    revenueSeries.setData(
      sorted
        .filter((e) => e.revenue !== null)
        .map((e) => ({
          time: e.fiscal_period_end,
          value: Number(e.revenue),
        }))
    )
    prevYearSeries.setData(
      sorted
        .filter((e) => e.revenue_prev_year !== null)
        .map((e) => ({
          time: e.fiscal_period_end,
          value: Number(e.revenue_prev_year),
        }))
    )

    earningsChart.timeScale().fitContent()

    return () => earningsChart.remove()
  }, [earnings])

  const fmt = (value: number | null, digits = 0) => {
    if (value === null || value === undefined) return "-"
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
  }

  const fmtPercent = (value: number | null, digits = 2) => {
    if (value === null || value === undefined) return "-"
    const num = Number(value)
    const percent = Math.abs(num) <= 1 ? num * 100 : num
    return `${percent.toFixed(digits)}%`
  }

  const fmtDateValue = (value: string | null) => {
    if (!value) return "-"
    return value.slice(0, 10)
  }

  const filteredStocks = stocks
    .filter((s) => {
      const q = stockFilter.trim().toLowerCase()
      if (!q) return true
      return (
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q)
      )
    })
    .slice(0, 30)

  const handleStockSelect = (stock: Stock) => {
    setStockFilter("")
    setIsStockMenuOpen(false)
    navigate(`/stocks/${stock.id}`)
  }
  const currentStock = stocks.find((s) => String(s.id) === id)
  const financialLink = currentStock
    ? `https://www.buffett-code.com/company/${currentStock.code}/financial`
    : null
  const yahooSymbol = currentStock
    ? (currentStock.code.endsWith(".T") ? currentStock.code : `${currentStock.code}.T`)
    : null
  const yahooLink = yahooSymbol
    ? `https://finance.yahoo.co.jp/quote/${yahooSymbol}`
    : null
  const minkabuCode = currentStock ? currentStock.code.replace(/\.T$/, "") : null
  const minkabuLink = minkabuCode
    ? `https://minkabu.jp/stock/${minkabuCode}/analysis`
    : null

  return (
<div className="stock-detail-container">
  <Link to="/">← 一覧へ戻る</Link>
  <div className="detail-header">
    <h2>銘柄詳細</h2>
    <div className="stock-switcher">
      <div className="stock-dropdown" ref={stockDropdownRef}>
        <button
          type="button"
          className="stock-dropdown-trigger"
          onClick={() => setIsStockMenuOpen(!isStockMenuOpen)}
        >
          {currentStock ? `${currentStock.code} - ${currentStock.name}` : "銘柄を選択"}
          <span>{isStockMenuOpen ? "▲" : "▼"}</span>
        </button>
        {isStockMenuOpen && (
          <div className="stock-dropdown-menu">
            <input
              value={stockFilter}
              placeholder="銘柄コード / 銘柄名で検索"
              onChange={(e) => setStockFilter(e.target.value)}
            />
            {filteredStocks.length > 0 ? (
              filteredStocks.map((stock) => (
                <button
                  key={stock.id}
                  type="button"
                  className="stock-dropdown-item"
                  onClick={() => handleStockSelect(stock)}
                >
                  {stock.code} - {stock.name}
                </button>
              ))
            ) : (
              <div className="stock-dropdown-empty">候補がありません</div>
            )}
          </div>
        )}
      </div>
      <button
        className="save"
        onClick={handleUpdateDaily}
        disabled={!id || isUpdatingDaily}
      >
        {isUpdatingDaily ? "更新中..." : "4年分データ更新"}
      </button>
      {updateMessage && <span className="update-message">{updateMessage}</span>}
    </div>
  </div>
  <div className="info-card">
    <button className="accordion-toggle" onClick={() => setIsInfoOpen(!isInfoOpen)}>
      企業情報 {isInfoOpen ? "▲" : "▼"}
    </button>
    <div className="info-actions">
      <button
        className="save"
        onClick={handleUpdateInfo}
        disabled={!id || isUpdatingInfo}
      >
        {isUpdatingInfo ? "更新中..." : "基本情報更新"}
      </button>
      {infoMessage && <span className="update-message">{infoMessage}</span>}
    </div>
    {isInfoOpen && (
      <>
        {stockInfo ? (
          <div className="info-table-wrap">
            <table className="info-table">
              <tbody>
                <tr><th>名称</th><td>{stockInfo.long_name || stockInfo.short_name || "-"}</td></tr>
                <tr><th>セクター</th><td>{stockInfo.sector || "-"}</td></tr>
                <tr><th>業種</th><td>{stockInfo.industry || "-"}</td></tr>
                <tr><th>時価総額</th><td>{fmt(stockInfo.market_cap)}</td></tr>
                <tr><th>PER(実績)</th><td>{fmt(stockInfo.trailing_pe, 2)}</td></tr>
                <tr><th>PER(予想)</th><td>{fmt(stockInfo.forward_pe, 2)}</td></tr>
                <tr><th>配当利回り</th><td>{fmtPercent(stockInfo.dividend_yield, 2)}</td></tr>
                <tr><th>β(週次/2年)</th><td>{fmt(stockInfo.beta, 2)}</td></tr>
                <tr><th>β計算日</th><td>{fmtDateValue(stockInfo.beta_calc_date)}</td></tr>
                <tr><th>通貨</th><td>{stockInfo.currency || "-"}</td></tr>
                <tr><th>国</th><td>{stockInfo.country || "-"}</td></tr>
                <tr>
                  <th>Web</th>
                  <td>
                    {stockInfo.website ? (
                      <a href={stockInfo.website} target="_blank" rel="noreferrer">{stockInfo.website}</a>
                    ) : "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="update-message">Info未取得です。`Info更新` を実行してください。</div>
        )}
        {stockInfo?.business_summary && (
          <p className="business-summary">{stockInfo.business_summary}</p>
        )}
      </>
    )}
  </div>
  <div className="date-range">
    <label>
      開始日
      <input
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
      />
    </label>
    <label>
      終了日
      <input
        type="date"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
      />
    </label>
  </div>

  <div className="chart-wrapper">
    <div ref={chartRef} />
  </div>

  <div className="chart-wrapper" style={{ marginTop: 20 }}>
    <div ref={rsiRef} />
  </div>

  <div className="info-card earnings-section">
    <button className="accordion-toggle" onClick={() => setIsEarningsOpen(!isEarningsOpen)}>
      決算データ {isEarningsOpen ? "▲" : "▼"}
    </button>
    <div className="info-actions">
      <button
        className="save"
        onClick={handleUpdateEarnings}
        disabled={!id || isUpdatingEarnings}
      >
        {isUpdatingEarnings ? "更新中..." : "決算データ更新"}
      </button>
      {earningsMessage && <span className="update-message">{earningsMessage}</span>}
    </div>

    {isEarningsOpen && (
      <>
        <div className="earnings-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>決算期末</th>
                <th>売上高</th>
                <th>営業利益</th>
                <th>純利益</th>
                <th>EPS</th>
                <th>前年売上</th>
                <th>売上YoY%</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((e) => (
                <tr key={e.fiscal_period_end}>
                  <td>{e.fiscal_period_end}</td>
                  <td>{fmt(e.revenue)}</td>
                  <td>{fmt(e.operating_income)}</td>
                  <td>{fmt(e.net_income)}</td>
                  <td>{fmt(e.eps, 2)}</td>
                  <td>{fmt(e.revenue_prev_year)}</td>
                  <td>{e.revenue_yoy_pct == null ? "-" : `${Number(e.revenue_yoy_pct).toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>売上高 前年比較</h3>
        <div className="chart-wrapper">
          <div ref={earningsRef} />
        </div>
      </>
    )}
  </div>
  {(financialLink || yahooLink || minkabuLink) && (
    <div className="external-link-section">
      {financialLink && (
        <a className="detail-link" href={financialLink} target="_blank" rel="noreferrer">
          バフェット・コード 財務情報を見る（{currentStock?.code}）
        </a>
      )}
      {yahooLink && (
        <a className="detail-link" href={yahooLink} target="_blank" rel="noreferrer">
          Yahoo!ファイナンス
        </a>
      )}
      {minkabuLink && (
        <a className="detail-link" href={minkabuLink} target="_blank" rel="noreferrer">
          みんかぶ 株価予想
        </a>
      )}
    </div>
  )}
</div>
  )
}

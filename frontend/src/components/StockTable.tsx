import { Link } from "react-router-dom"
import { Fragment, type MouseEvent, useMemo, useState } from "react"

type Stock = {
  id: number
  code: string
  name: string
  industry?: string
  favorite?: boolean
  buy_price?: number | null
  sell_price?: number | null
  latest_date?: string | null
  latest_close?: number | null
  holding_qty?: number | null
  avg_buy_price?: number | null
  holding_value?: number | null
  unrealized_pnl?: number | null
  realized_pnl?: number | null
  change_value?: number | null
  change_percent?: number | null
  rsi14?: number | null
  rsi30?: number | null
  rsi60?: number | null
  beta?: number | null
  beta_3m?: number | null
  beta_calc_date?: string | null
  fiscal_year_end_month?: number | null
  current_fiscal_quarter?: number | null
  minkabu_target_price?: number | null
  minkabu_target_rating?: string | null
  minkabu_theoretical_price?: number | null
  minkabu_individual_price?: number | null
  minkabu_individual_rating?: string | null
  minkabu_analyst_price?: number | null
  minkabu_analyst_rating?: string | null
  minkabu_eps_growth_yoy?: number | null
  minkabu_eps_growth_3y_avg?: number | null
  minkabu_forecast_eps_growth?: number | null
  minkabu_peg?: number | null
  minkabu_per?: number | null
  minkabu_fetched_date?: string | null
  kabutan_total_yield?: number | null
  kabutan_benefit_yield?: number | null
  kabutan_dividend_yield?: number | null
  kabutan_fetched_date?: string | null
}

type Trade = {
  stock_id: number
  trade_date: string
  side: "buy" | "sell"
  quantity: number
  price: number
  created_at: string
}

type Props = {
  stocks: Stock[]
  onUpdate: (stock: Stock) => void
  onDelete: (id: number) => void
  onAddTrade: (
    stockId: number,
    tradeDate: string,
    side: "buy" | "sell",
    quantity: number,
    price: number
  ) => Promise<void>
  onFetchTrades: (stockId: number) => Promise<Trade[]>
  onDeleteTrade: (stockId: number, createdAt: string) => Promise<void>
  isRightSidebarOpen: boolean
}

type RangeFilterKey =
  | "latest_close"
  | "change_percent"
  | "rsi14"
  | "rsi30"
  | "rsi60"
  | "beta"
  | "beta_3m"
  | "minkabu_eps_growth_yoy"
  | "minkabu_eps_growth_3y_avg"
  | "minkabu_forecast_eps_growth"
  | "minkabu_peg"
  | "minkabu_per"
  | "kabutan_dividend_yield"
  | "kabutan_benefit_yield"
  | "kabutan_total_yield"

type RangeFilterState = Record<RangeFilterKey, { min: string; max: string }>

const RANGE_FILTER_DEFS: Array<{ key: RangeFilterKey; label: string }> = [
  { key: "latest_close", label: "最新株価" },
  { key: "change_percent", label: "前日比率(%)" },
  { key: "rsi14", label: "RSI14" },
  { key: "rsi30", label: "RSI30" },
  { key: "rsi60", label: "RSI60" },
  { key: "beta", label: "市場連動係数(長期)" },
  { key: "beta_3m", label: "市場連動係数(3か月)" },
  { key: "minkabu_eps_growth_yoy", label: "EPS成長(前年同期比)(%)" },
  { key: "minkabu_eps_growth_3y_avg", label: "EPS成長(3年平均)(%)" },
  { key: "minkabu_forecast_eps_growth", label: "予想EPS成長(%)" },
  { key: "minkabu_peg", label: "PEG" },
  { key: "minkabu_per", label: "PER" },
  { key: "kabutan_dividend_yield", label: "配当利回り(%)" },
  { key: "kabutan_benefit_yield", label: "優待利回り(%)" },
  { key: "kabutan_total_yield", label: "配当+優待(%)" },
]

const PERCENT_RATIO_RANGE_KEYS: RangeFilterKey[] = [
  "minkabu_eps_growth_yoy",
  "minkabu_eps_growth_3y_avg",
  "minkabu_forecast_eps_growth",
]

const createInitialRangeFilters = (): RangeFilterState =>
  Object.fromEntries(
    RANGE_FILTER_DEFS.map((def) => [def.key, { min: "", max: "" }])
  ) as RangeFilterState

export default function StockTable({
  stocks,
  onUpdate,
  onDelete,
  onAddTrade,
  onFetchTrades,
  onDeleteTrade,
  isRightSidebarOpen,
}: Props) {
  const [editedRows, setEditedRows] = useState<Record<number, Stock>>({})
  const [sortKey, setSortKey] = useState<keyof Stock>("code")
  const [sortAsc, setSortAsc] = useState(true)
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [buyTargetOnly, setBuyTargetOnly] = useState(false)
  const [sellTargetOnly, setSellTargetOnly] = useState(false)
  const [industryFilter, setIndustryFilter] = useState("")
  const [fiscalMonthFilters, setFiscalMonthFilters] = useState<number[]>([])
  const [keyword, setKeyword] = useState("")
  const [targetRatingFilter, setTargetRatingFilter] = useState<string[]>([])
  const [individualRatingFilter, setIndividualRatingFilter] = useState<string[]>([])
  const [analystRatingFilter, setAnalystRatingFilter] = useState<string[]>([])
  const [rangeFilters, setRangeFilters] = useState<RangeFilterState>(createInitialRangeFilters)
  const [tradeFormOpenId, setTradeFormOpenId] = useState<number | null>(null)
  const [isCompactView, setIsCompactView] = useState(true)
  const [rowDetailMode, setRowDetailMode] = useState<Record<number, boolean>>({})
  const [tradeDate, setTradeDate] = useState("")
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy")
  const [tradeQuantity, setTradeQuantity] = useState("")
  const [tradePrice, setTradePrice] = useState("")
  const [tradeMap, setTradeMap] = useState<Record<number, Trade[]>>({})

  // ----------------------------
  // ソート処理
  // ----------------------------
  const sortedFilteredStocks = useMemo(() => {
    let result = [...stocks]

    // フィルタ
    if (favoriteOnly) {
      result = result.filter((s) => s.favorite)
    }

    if (industryFilter) {
      result = result.filter((s) => s.industry === industryFilter)
    }

    if (fiscalMonthFilters.length > 0) {
      result = result.filter(
        (s) => s.fiscal_year_end_month != null && fiscalMonthFilters.includes(s.fiscal_year_end_month)
      )
    }

    if (keyword) {
      result = result.filter(
        (s) =>
          s.code.includes(keyword) ||
          s.name.includes(keyword)
      )
    }

    if (targetRatingFilter.length > 0) {
      result = result.filter((s) => targetRatingFilter.includes(s.minkabu_target_rating ?? ""))
    }
    if (individualRatingFilter.length > 0) {
      result = result.filter((s) => individualRatingFilter.includes(s.minkabu_individual_rating ?? ""))
    }
    if (analystRatingFilter.length > 0) {
      result = result.filter((s) => analystRatingFilter.includes(s.minkabu_analyst_rating ?? ""))
    }

    for (const { key } of RANGE_FILTER_DEFS) {
      const minRaw = rangeFilters[key].min.trim()
      const maxRaw = rangeFilters[key].max.trim()
      if (!minRaw && !maxRaw) continue

      const isPercentRatio = PERCENT_RATIO_RANGE_KEYS.includes(key)
      const min = minRaw === "" ? null : (isPercentRatio ? Number(minRaw) / 100 : Number(minRaw))
      const max = maxRaw === "" ? null : (isPercentRatio ? Number(maxRaw) / 100 : Number(maxRaw))
      if ((min !== null && Number.isNaN(min)) || (max !== null && Number.isNaN(max))) continue

      result = result.filter((s) => {
        const value = s[key]
        if (value === null || value === undefined) return false
        if (min !== null && value < min) return false
        if (max !== null && value > max) return false
        return true
      })
    }

    const isBuyTarget = (s: Stock) =>
      s.latest_close !== null &&
      s.latest_close !== undefined &&
      s.buy_price !== null &&
      s.buy_price !== undefined &&
      s.latest_close <= s.buy_price

    const isSellTarget = (s: Stock) =>
      s.latest_close !== null &&
      s.latest_close !== undefined &&
      s.sell_price !== null &&
      s.sell_price !== undefined &&
      s.latest_close >= s.sell_price

    if (buyTargetOnly && sellTargetOnly) {
      result = result.filter((s) => isBuyTarget(s) || isSellTarget(s))
    } else if (buyTargetOnly) {
      result = result.filter((s) => isBuyTarget(s))
    } else if (sellTargetOnly) {
      result = result.filter((s) => isSellTarget(s))
    }

    // ソート
    result.sort((a, b) => {
      const favoriteDiff = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))
      if (favoriteDiff !== 0) return favoriteDiff

      const aVal = a[sortKey]
      const bVal = b[sortKey]

      if (aVal == null && bVal == null) return 0
      if (aVal == null) return sortAsc ? 1 : -1
      if (bVal == null) return sortAsc ? -1 : 1

      if (typeof aVal === "number" && typeof bVal === "number") {
        if (aVal < bVal) return sortAsc ? -1 : 1
        if (aVal > bVal) return sortAsc ? 1 : -1
        return 0
      }

      if (typeof aVal === "boolean" && typeof bVal === "boolean") {
        const av = Number(aVal)
        const bv = Number(bVal)
        if (av < bv) return sortAsc ? -1 : 1
        if (av > bv) return sortAsc ? 1 : -1
        return 0
      }

      const av = String(aVal)
      const bv = String(bVal)
      if (av < bv) return sortAsc ? -1 : 1
      if (av > bv) return sortAsc ? 1 : -1
      return 0
    })

    return result
  }, [
    stocks,
    sortKey,
    sortAsc,
    favoriteOnly,
    buyTargetOnly,
    sellTargetOnly,
    industryFilter,
    fiscalMonthFilters,
    keyword,
    targetRatingFilter,
    individualRatingFilter,
    analystRatingFilter,
    rangeFilters,
  ])

  const handleSort = (key: keyof Stock) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const handleChange = (
    id: number,
    field: keyof Stock,
    value: string | boolean | number | null
  ) => {
    setEditedRows((prev) => ({
      ...prev,
      [id]: {
        ...stocks.find((s) => s.id === id)!,
        ...prev[id],
        [field]: value,
      },
    }))
  }

  const handleNumberChange = (id: number, field: keyof Stock, value: string) => {
    const parsed = value === "" ? null : Number(value)
    handleChange(id, field, Number.isNaN(parsed) ? null : parsed)
  }

  const handleSave = (id: number) => {
    if (editedRows[id]) {
      onUpdate(editedRows[id])
      setEditedRows((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
    }
  }

  const industries = Array.from(
    new Set(stocks.map((s) => s.industry).filter(Boolean))
  )
  const ratingOptions = Array.from(
    new Set(
      stocks
        .flatMap((s) => [
          s.minkabu_target_rating ?? null,
          s.minkabu_individual_rating ?? null,
          s.minkabu_analyst_rating ?? null,
        ])
        .filter(Boolean)
    )
  ) as string[]
  const sortedRatingOptions = ["強買い", "やや買い", "買い", "中立", "やや売り", "売り", "強売り", "割安", "割高"]
    .filter((r) => ratingOptions.includes(r))
    .concat(ratingOptions.filter((r) => !["強買い", "やや買い", "買い", "中立", "やや売り", "売り", "強売り", "割安", "割高"].includes(r)))

  const fmtNumber = (value?: number | null, digits = 2) => {
    if (value === null || value === undefined) return "-"
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    })
  }

  const fmtFixed = (value?: number | null, digits = 2) => {
    if (value === null || value === undefined) return "-"
    return Number(value).toFixed(digits)
  }

  const fmtPercent = (value?: number | null, digits = 2) => {
    if (value === null || value === undefined) return "-"
    return `${Number(value).toFixed(digits)}%`
  }

  const fmtRatioPercent = (value?: number | null, digits = 2) => {
    if (value === null || value === undefined) return "-"
    return `${(Number(value) * 100).toFixed(digits)}%`
  }

  const fmtDate = (value?: string | null) => {
    if (!value) return ""
    return value.slice(0, 10)
  }

  const fmtDiff = (value?: number | null, base?: number | null) => {
    if (value == null || base == null) return "-"
    const diff = value - base
    const sign = diff > 0 ? "+" : ""
    return `${sign}${fmtNumber(diff, 0)}`
  }

  const fmtPegLabel = (value?: number | null) => {
    if (value === null || value === undefined) return "-"
    if (value <= 0.9) return `割安(${fmtFixed(value, 2)})`
    if (value < 1.1) return `妥当(${fmtFixed(value, 2)})`
    return `割高(${fmtFixed(value, 2)})`
  }

  const getTheorySignal = (theory?: number | null, current?: number | null) => {
    if (theory == null || current == null) return null
    return current > theory ? "sell" : "buy"
  }

  const getChangeClass = (value?: number | null) => {
    if (value === null || value === undefined) return ""
    if (value > 0) return "value-up"
    if (value < 0) return "value-down"
    return ""
  }

  const getRsiClass = (value?: number | null) => {
    if (value === null || value === undefined) return ""
    if (value <= 25) return "rsi-low"
    if (value >= 65) return "rsi-high"
    return ""
  }

  const getRatingClass = (value?: string | null) => {
    if (!value) return ""
    if (["強買い", "やや買い", "買い"].includes(value)) return "rating-buy"
    if (["強売り", "やや売り", "売り"].includes(value)) return "rating-sell"
    if (["中立", "割安", "割高"].includes(value)) return "rating-neutral"
    return ""
  }

  const toggleRating = (current: string[], value: string, setter: (next: string[]) => void) => {
    if (current.includes(value)) {
      setter(current.filter((v) => v !== value))
    } else {
      setter([...current, value])
    }
  }

  const openTradeForm = async (stockId: number) => {
    setTradeFormOpenId(stockId)
    setTradeDate(new Date().toISOString().slice(0, 10))
    setTradeSide("buy")
    setTradeQuantity("")
    setTradePrice("")
    const trades = await onFetchTrades(stockId)
    setTradeMap((prev) => ({ ...prev, [stockId]: trades }))
  }

  const handleAddTrade = async (stockId: number) => {
    const quantity = Number(tradeQuantity)
    const price = Number(tradePrice)
    if (!tradeDate || Number.isNaN(quantity) || Number.isNaN(price)) return
    if (quantity <= 0 || price <= 0) return

    await onAddTrade(stockId, tradeDate, tradeSide, quantity, price)
    const trades = await onFetchTrades(stockId)
    setTradeMap((prev) => ({ ...prev, [stockId]: trades }))
    setTradeQuantity("")
    setTradePrice("")
  }

  const handleDeleteTrade = async (stockId: number, createdAt: string) => {
    await onDeleteTrade(stockId, createdAt)
    const trades = await onFetchTrades(stockId)
    setTradeMap((prev) => ({ ...prev, [stockId]: trades }))
  }

  const setRowDetail = (stockId: number, isDetail: boolean) => {
    setRowDetailMode((prev) => ({
      ...prev,
      [stockId]: isDetail,
    }))
  }

  const getIsDetailRow = (stockId: number) => rowDetailMode[stockId] ?? !isCompactView

  const handleRowDoubleClick = (
    event: MouseEvent<HTMLTableRowElement>,
    stockId: number,
    isDetailRow: boolean
  ) => {
    if (isDetailRow) return

    const target = event.target
    if (target instanceof HTMLElement && target.closest("a, button, input, select, textarea, label")) {
      return
    }

    setRowDetail(stockId, true)
  }

  const toggleFiscalMonthFilter = (month: number) => {
    setFiscalMonthFilters((prev) =>
      prev.includes(month) ? prev.filter((m) => m !== month) : [...prev, month].sort((a, b) => a - b)
    )
  }

  const handleRangeChange = (key: RangeFilterKey, bound: "min" | "max", value: string) => {
    setRangeFilters((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        [bound]: value,
      },
    }))
  }

  const clearRangeFilters = () => {
    setRangeFilters(createInitialRangeFilters())
  }

  const handleCompactFavoriteChange = (stock: Stock, checked: boolean) => {
    onUpdate({
      ...stock,
      ...editedRows[stock.id],
      favorite: checked,
    })

    setEditedRows((prev) => {
      const copy = { ...prev }
      delete copy[stock.id]
      return copy
    })
  }

  const tableColumnCount = 15

  const renderActionStack = (stockId: number, isEdited: boolean, isDetailRow: boolean) => (
    <div className="action-stack">
      <button
        type="button"
        className="row-mode-toggle"
        onClick={() => setRowDetail(stockId, !isDetailRow)}
      >
        {isDetailRow ? "簡易表示" : "詳細表示"}
      </button>
      <Link className="detail-link" to={`/stocks/${stockId}`}>
        銘柄詳細
      </Link>
      <button
        type="button"
        onClick={() => handleSave(stockId)}
        disabled={!isEdited}
        aria-label="保存"
        title="保存"
      >
        💾
      </button>
      <button type="button" onClick={() => onDelete(stockId)} aria-label="削除" title="削除">
        🗑
      </button>
      <button
        type="button"
        onClick={() => void openTradeForm(stockId)}
        aria-label="取引履歴"
        title="取引履歴"
      >
        📒
      </button>
    </div>
  )

  return (
    <div className={`card stock-table-card ${isRightSidebarOpen ? "with-right-sidebar" : "without-right-sidebar"}`}>
      {isRightSidebarOpen && (
      <section className="panel right-menu-panel">
      <div className="panel-header">
        <h3 className="panel-title">{"\u30d5\u30a3\u30eb\u30bf"}</h3>
      </div>
<div className="filters">
        <div className="filter-row">
          <div className="filter-block">
            <label className="filter-label">検索</label>
            <input
              placeholder="コード・銘柄名"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="filter-block">
            <label className="filter-label">業種</label>
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
            >
              <option value="">全業種</option>
              {industries.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-block">
            <label className="filter-label">決算月（複数選択）</label>
            <div className="filter-chip-group">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                <button
                  key={`fiscal-${month}`}
                  type="button"
                  className={`filter-chip ${fiscalMonthFilters.includes(month) ? "is-active" : ""}`}
                  onClick={() => toggleFiscalMonthFilter(month)}
                >
                  {month}月
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block filter-inline">
            <label className="filter-label">表示</label>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={favoriteOnly}
                onChange={(e) => setFavoriteOnly(e.target.checked)}
              />
              ★のみ
            </label>
          </div>
        </div>

        <div className="filter-advanced always-open">
          <div className="filter-chip-group">
            <span className="filter-chip-label">{"\u30bf\u30fc\u30b2\u30c3\u30c8"}</span>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={buyTargetOnly}
                onChange={(e) => setBuyTargetOnly(e.target.checked)}
              />
              {"\u8cb7\u3044\u72d9\u3044"}
            </label>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={sellTargetOnly}
                onChange={(e) => setSellTargetOnly(e.target.checked)}
              />
              {"\u58f2\u308a\u72d9\u3044"}
            </label>
          </div>
          <div className="filter-chip-group">
            <span className="filter-chip-label">目標評価</span>
            {sortedRatingOptions.map((r) => (
              <button
                key={`target-${r}`}
                type="button"
                className={`filter-chip ${targetRatingFilter.includes(r) ? "is-active" : ""}`}
                onClick={() => toggleRating(targetRatingFilter, r, setTargetRatingFilter)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="filter-chip-group">
            <span className="filter-chip-label">個人評価</span>
            {sortedRatingOptions.map((r) => (
              <button
                key={`individual-${r}`}
                type="button"
                className={`filter-chip ${individualRatingFilter.includes(r) ? "is-active" : ""}`}
                onClick={() => toggleRating(individualRatingFilter, r, setIndividualRatingFilter)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="filter-chip-group">
            <span className="filter-chip-label">アナ評価</span>
            {sortedRatingOptions.map((r) => (
              <button
                key={`analyst-${r}`}
                type="button"
                className={`filter-chip ${analystRatingFilter.includes(r) ? "is-active" : ""}`}
                onClick={() => toggleRating(analystRatingFilter, r, setAnalystRatingFilter)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="filter-range-grid">
            <div className="filter-range-row filter-range-head">
              <span className="range-label">項目</span>
              <span className="range-min">min</span>
              <span className="range-max">max</span>
            </div>
            {RANGE_FILTER_DEFS.map((def) => (
              <div key={def.key} className="filter-range-row">
                <label className="range-label" htmlFor={`range-${def.key}-min`}>{def.label}</label>
                <input
                  id={`range-${def.key}-min`}
                  className="range-min"
                  type="number"
                  step="0.01"
                  value={rangeFilters[def.key].min}
                  onChange={(e) => handleRangeChange(def.key, "min", e.target.value)}
                />
                <input
                  className="range-max"
                  type="number"
                  step="0.01"
                  value={rangeFilters[def.key].max}
                  onChange={(e) => handleRangeChange(def.key, "max", e.target.value)}
                />
              </div>
            ))}
          </div>
          <button type="button" className="filter-toggle filter-clear" onClick={clearRangeFilters}>
            min/max をクリア
          </button>
        </div>
      </div>
    </section>
      )}

      <div className="table-main">
      <button
        type="button"
        className="filter-toggle"
        onClick={() => setIsCompactView((prev) => !prev)}
      >
        {isCompactView ? "全件を詳細表示" : "全件を簡易表示"}
      </button>
<div className="table-wrapper">
       <table className="table table-sticky">
        <thead>
          <tr className="sub-header">
            <th className="sticky-col sticky-1" onClick={() => handleSort("favorite")}>{"\u2605"}</th>
            <th className="sticky-col sticky-2">
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("code")}>{"銘柄コード"}</button>
                <button type="button" className="header-action header-muted" onClick={() => handleSort("industry")}>{"業種"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("name")}>{"銘柄名"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("fiscal_year_end_month")}>{"決算月"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("current_fiscal_quarter")}>{"現在四半期"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("latest_close")}>{"最新株価 "}<span className="header-muted">(yyyy/mm/dd)</span></button>
                <button type="button" className="header-action" onClick={() => handleSort("buy_price")}>{"買い狙い価格"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("sell_price")}>{"売り狙い価格"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("holding_qty")}>{"保有株数"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("holding_value")}>{"保有価値"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("avg_buy_price")}>{"買い平均価格"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("unrealized_pnl")}>{"含み損益"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("realized_pnl")}>{"確定損益"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("change_value")}>{"前日増減"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("change_percent")}>{"前日比率"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("rsi14")}>RSI14</button>
                <button type="button" className="header-action" onClick={() => handleSort("rsi30")}>RSI30</button>
                <button type="button" className="header-action" onClick={() => handleSort("rsi60")}>RSI60</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("beta")}>{"市場連動係数(長期)"}</button>
                <button type="button" className="header-action header-muted" onClick={() => handleSort("beta_calc_date")}>{"計算日"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("beta_3m")}>{"市場連動係数(3か月)"}</button>
                <button type="button" className="header-action header-muted" onClick={() => handleSort("beta_calc_date")}>{"計算日"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_target_rating")}>{"目標評価：目標株価"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_theoretical_price")}>{"理論株価"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_individual_rating")}>{"個人評価：個人予想株価"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_analyst_rating")}>{"アナリスト評価：予想株価"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_eps_growth_yoy")}>{"EPS成長(前年同期比)"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_eps_growth_3y_avg")}>{"3年平均"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_forecast_eps_growth")}>{"予想EPS"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_peg")}>{"PEG"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("minkabu_per")}>{"PER"}</button>
              </div>
            </th>
            <th>
              <div className="header-stack">
                <button type="button" className="header-action" onClick={() => handleSort("kabutan_dividend_yield")}>{"配当利回り"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("kabutan_benefit_yield")}>{"優待利回り"}</button>
                <button type="button" className="header-action" onClick={() => handleSort("kabutan_total_yield")}>{"配当＋優待"}</button>
                <button type="button" className="header-action header-muted" onClick={() => handleSort("kabutan_fetched_date")}>{"取得日"}</button>
              </div>
            </th>
            <th className="sticky-col-right">{"操作"}</th>
          </tr>
        </thead>

        <tbody>
          {sortedFilteredStocks.map((stock) => {
            const row = editedRows[stock.id] || stock
            const isEdited = !!editedRows[stock.id]
            const isDetailRow = getIsDetailRow(stock.id)
            const isCompactRow = !isDetailRow

            return (
              <Fragment key={stock.id}>
                <tr
                  className={isDetailRow ? "table-row-detail" : "table-row-compact"}
                  style={{ background: isEdited ? "#fff8dc" : "" }}
                  onDoubleClick={(event) => handleRowDoubleClick(event, stock.id, isDetailRow)}
                  title={isCompactRow ? "ダブルクリックで詳細表示" : undefined}
                >
                  {isCompactRow ? (
                    <>
                      <td className="sticky-col sticky-1">
                        <input
                          type="checkbox"
                          checked={row.favorite || false}
                          onChange={(e) => handleCompactFavoriteChange(stock, e.target.checked)}
                        />
                      </td>
                      <td className="sticky-col sticky-2 compact-name-cell">
                        {row.name}
                      </td>
                      <td className="compact-value-cell">
                        {stock.fiscal_year_end_month == null && stock.current_fiscal_quarter == null
                          ? "-"
                          : `${stock.fiscal_year_end_month == null ? "-" : `${stock.fiscal_year_end_month}月`} / ${stock.current_fiscal_quarter == null ? "-" : `Q${stock.current_fiscal_quarter}`}`}
                      </td>
                      <td className="compact-value-cell">
                        <span className="highlight-value">{fmtNumber(stock.latest_close)}</span>
                      </td>
                      <td className="compact-value-cell">
                        <span className="highlight-value">{fmtNumber(stock.holding_value)}</span>
                      </td>
                      <td className={`compact-value-cell ${getChangeClass(stock.unrealized_pnl)}`}>
                        {fmtNumber(stock.unrealized_pnl)}
                      </td>
                      <td className={`compact-value-cell ${getChangeClass(stock.change_percent)}`}>
                        {stock.change_percent == null ? "-" : `${fmtFixed(stock.change_percent)}%`}
                      </td>
                      <td className={`compact-value-cell ${getRsiClass(stock.rsi14)}`}>
                        {fmtFixed(stock.rsi14)}
                      </td>
                      <td className="compact-value-cell">
                        {fmtFixed(stock.beta)}
                      </td>
                      <td className="compact-value-cell">
                        {fmtFixed(stock.beta_3m)}
                      </td>
                      <td className="compact-rating-cell">
                        <span className={`cell-badge ${getRatingClass(stock.minkabu_target_rating)}`}>
                          {stock.minkabu_target_rating ?? "-"}
                        </span>
                      </td>
                      <td className="compact-value-cell">
                        {fmtRatioPercent(stock.minkabu_eps_growth_yoy, 1)}
                      </td>
                      <td className="compact-value-cell">
                        {fmtPegLabel(stock.minkabu_peg)}
                      </td>
                      <td className="compact-value-cell">
                        {fmtPercent(stock.kabutan_total_yield, 2)}
                      </td>
                      <td className="sticky-col-right compact-mode-cell">
                        <button
                          type="button"
                          className="row-mode-toggle"
                          onClick={() => setRowDetail(stock.id, true)}
                        >
                          詳細表示
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
<td className="sticky-col sticky-1">
                    <input
                      type="checkbox"
                      checked={row.favorite || false}
                      onChange={(e) =>
                        handleChange(stock.id, "favorite", e.target.checked)
                      }
                    />
                  </td>

                  <td className="sticky-col sticky-2">
                    <div className="cell-stack compact-stack">
                      <input
                        className="cell-input cell-code"
                        value={row.code}
                        onChange={(e) =>
                          handleChange(stock.id, "code", e.target.value)
                        }
                      />
                      <input
                        className="cell-input cell-muted"
                        value={row.industry || ""}
                        onChange={(e) =>
                          handleChange(stock.id, "industry", e.target.value)
                        }
                      />
                      <input
                        className="cell-input cell-name"
                        value={row.name}
                        onChange={(e) =>
                          handleChange(stock.id, "name", e.target.value)
                        }
                      />
                    </div>
                  </td>

                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line">
                        <span className="cell-label-inline">{"決算月"}</span>
                        <span>{stock.fiscal_year_end_month == null ? "-" : `${stock.fiscal_year_end_month}月`}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-label-inline">{"現在四半期"}</span>
                        <span>{stock.current_fiscal_quarter == null ? "-" : `Q${stock.current_fiscal_quarter}`}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line highlight-line">
                        <span className="highlight-value">{fmtNumber(stock.latest_close)}</span>
                        <small className="cell-date">{fmtDate(stock.latest_date)}</small>
                      </div>
                      <div className="cell-line cell-input-row">
                        <input
                          type="number"
                          step="0.01"
                          value={row.buy_price ?? ""}
                          onChange={(e) => handleNumberChange(stock.id, "buy_price", e.target.value)}
                        />
                        <span className="cell-tag buy">{"\u8cb7\u72d9"}</span>
                      </div>
                      <div className="cell-line cell-input-row">
                        <input
                          type="number"
                          step="0.01"
                          value={row.sell_price ?? ""}
                          onChange={(e) => handleNumberChange(stock.id, "sell_price", e.target.value)}
                        />
                        <span className="cell-tag sell">{"\u58f2\u72d9"}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line">{fmtNumber(stock.holding_qty, 0)}</div>
                      <div className="cell-line highlight-line"><span className="highlight-value">{fmtNumber(stock.holding_value)}</span></div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line">{fmtNumber(stock.avg_buy_price)}</div>
                      <div className={`cell-line ${getChangeClass(stock.unrealized_pnl)}`}>{fmtNumber(stock.unrealized_pnl)}</div>
                      <div className={`cell-line ${getChangeClass(stock.realized_pnl)}`}>{fmtNumber(stock.realized_pnl)}</div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className={`cell-line ${getChangeClass(stock.change_value)}`}>
                        {fmtNumber(stock.change_value)}
                      </div>
                      <div className={`cell-line ${getChangeClass(stock.change_percent)}`}>
                        {stock.change_percent == null ? "-" : `${fmtFixed(stock.change_percent)}%`}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className={`cell-line ${getRsiClass(stock.rsi14)}`}>{fmtFixed(stock.rsi14)}</div>
                      <div className={`cell-line ${getRsiClass(stock.rsi30)}`}>{fmtFixed(stock.rsi30)}</div>
                      <div className={`cell-line ${getRsiClass(stock.rsi60)}`}>{fmtFixed(stock.rsi60)}</div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line highlight-line">
                        <span className="highlight-value">{fmtFixed(stock.beta)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-date">{fmtDate(stock.beta_calc_date)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line highlight-line">
                        <span className="highlight-value">{fmtFixed(stock.beta_3m)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-date">{fmtDate(stock.beta_calc_date)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line">
                        <span className={`cell-badge ${getRatingClass(stock.minkabu_target_rating)}`}>{stock.minkabu_target_rating ?? "-"}</span>
                        <span>{fmtNumber(stock.minkabu_target_price, 0)}</span>
                        <span className={`cell-diff ${getChangeClass(stock.minkabu_target_price != null && stock.latest_close != null ? stock.minkabu_target_price - stock.latest_close : null)}`}>
                          {fmtDiff(stock.minkabu_target_price, stock.latest_close)}
                        </span>
                      </div>
                      <div className="cell-line">
                        <span className={`cell-badge ${getTheorySignal(stock.minkabu_theoretical_price, stock.latest_close) === "sell" ? "rating-sell" : getTheorySignal(stock.minkabu_theoretical_price, stock.latest_close) === "buy" ? "rating-buy" : ""}`}>
                          {getTheorySignal(stock.minkabu_theoretical_price, stock.latest_close) === "sell" ? "\u58f2\u308a" : getTheorySignal(stock.minkabu_theoretical_price, stock.latest_close) === "buy" ? "\u8cb7\u3044" : "-"}
                        </span>
                        <span>{fmtNumber(stock.minkabu_theoretical_price, 0)}</span>
                        <span className={`cell-diff ${getChangeClass(stock.minkabu_theoretical_price != null && stock.latest_close != null ? stock.minkabu_theoretical_price - stock.latest_close : null)}`}>
                          {fmtDiff(stock.minkabu_theoretical_price, stock.latest_close)}
                        </span>
                      </div>
                      <div className="cell-line">
                        <span className={`cell-badge ${getRatingClass(stock.minkabu_individual_rating)}`}>{stock.minkabu_individual_rating ?? "-"}</span>
                        <span>{fmtNumber(stock.minkabu_individual_price, 0)}</span>
                        <span className={`cell-diff ${getChangeClass(stock.minkabu_individual_price != null && stock.latest_close != null ? stock.minkabu_individual_price - stock.latest_close : null)}`}>
                          {fmtDiff(stock.minkabu_individual_price, stock.latest_close)}
                        </span>
                      </div>
                      <div className="cell-line">
                        <span className={`cell-badge ${getRatingClass(stock.minkabu_analyst_rating)}`}>{stock.minkabu_analyst_rating ?? "-"}</span>
                        <span className="cell-date">{fmtDate(stock.minkabu_fetched_date)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line">
                        <span className="cell-label-inline">{"前年同期比"}</span>
                        <span>{fmtRatioPercent(stock.minkabu_eps_growth_yoy, 2)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-label-inline">{"3年平均"}</span>
                        <span>{fmtRatioPercent(stock.minkabu_eps_growth_3y_avg, 2)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-label-inline">{"予想EPS"}</span>
                        <span>{fmtRatioPercent(stock.minkabu_forecast_eps_growth, 2)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line">
                        <span className="cell-label-inline">{"PEG"}</span>
                        <span>{fmtPegLabel(stock.minkabu_peg)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-label-inline">{"PER"}</span>
                        <span>{fmtFixed(stock.minkabu_per, 2)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack compact-stack">
                      <div className="cell-line">
                        <span className="cell-label-inline">{"配当"}</span>
                        <span>{fmtPercent(stock.kabutan_dividend_yield, 2)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-label-inline">{"優待"}</span>
                        <span>{fmtPercent(stock.kabutan_benefit_yield, 2)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-label-inline">{"合計"}</span>
                        <span>{fmtPercent(stock.kabutan_total_yield, 2)}</span>
                      </div>
                      <div className="cell-line">
                        <span className="cell-label-inline">{"取得日"}</span>
                        <span className="cell-date">{fmtDate(stock.kabutan_fetched_date)}</span>
                      </div>
                    </div>
                  </td>

                  <td className="sticky-col-right">
                    {renderActionStack(stock.id, isEdited, isDetailRow)}
                  </td>
                    </>
                  )}
                </tr>

                {tradeFormOpenId === stock.id && (
                  <tr key={`trade-form-${stock.id}`} className="trade-form-row">
                    <td colSpan={tableColumnCount}>
                      <div className="trade-form">
                        <input
                          type="date"
                          value={tradeDate}
                          onChange={(e) => setTradeDate(e.target.value)}
                        />
                        <select
                          value={tradeSide}
                          onChange={(e) => setTradeSide(e.target.value as "buy" | "sell")}
                        >
                          <option value="buy">買い</option>
                          <option value="sell">売り</option>
                        </select>
                        <input
                          type="number"
                          min={1}
                          placeholder="株数"
                          value={tradeQuantity}
                          onChange={(e) => setTradeQuantity(e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="価格"
                          value={tradePrice}
                          onChange={(e) => setTradePrice(e.target.value)}
                        />
                        <button className="save" onClick={() => handleAddTrade(stock.id)}>
                          登録
                        </button>
                        <button onClick={() => setTradeFormOpenId(null)}>閉じる</button>
                      </div>
                      <div className="trade-history-wrap">
                        <table className="table trade-history-table">
                          <thead>
                            <tr>
                              <th>日付</th>
                              <th>売買</th>
                              <th>株数</th>
                              <th>価格</th>
                              <th>削除</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(tradeMap[stock.id] ?? []).map((t, idx) => (
                              <tr key={`${t.created_at}-${idx}`}>
                                <td>{t.trade_date}</td>
                                <td>{t.side === "buy" ? "買い" : "売り"}</td>
                                <td>{fmtNumber(t.quantity, 0)}</td>
                                <td>{fmtNumber(t.price)}</td>
                                <td>
                                  <button
                                    className="delete"
                                    onClick={() => void handleDeleteTrade(stock.id, t.created_at)}
                                  >
                                    削除
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {(tradeMap[stock.id] ?? []).length === 0 && (
                              <tr>
                                <td colSpan={5}>取引履歴はありません</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  </div>
  </div>
  )
}

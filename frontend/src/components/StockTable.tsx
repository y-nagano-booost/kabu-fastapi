import { Link } from "react-router-dom"
import { Fragment, useMemo, useState } from "react"

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
}

export default function StockTable({ stocks, onUpdate, onDelete, onAddTrade, onFetchTrades, onDeleteTrade }: Props) {
  const [editedRows, setEditedRows] = useState<Record<number, Stock>>({})
  const [sortKey, setSortKey] = useState<keyof Stock>("code")
  const [sortAsc, setSortAsc] = useState(true)
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [buyTargetOnly, setBuyTargetOnly] = useState(false)
  const [sellTargetOnly, setSellTargetOnly] = useState(false)
  const [industryFilter, setIndustryFilter] = useState("")
  const [keyword, setKeyword] = useState("")
  const [tradeFormOpenId, setTradeFormOpenId] = useState<number | null>(null)
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

    if (keyword) {
      result = result.filter(
        (s) =>
          s.code.includes(keyword) ||
          s.name.includes(keyword)
      )
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
  }, [stocks, sortKey, sortAsc, favoriteOnly, buyTargetOnly, sellTargetOnly, industryFilter, keyword])

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

  const fmtDate = (value?: string | null) => {
    if (!value) return ""
    return value.slice(0, 10)
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

  return (
    <div className="card">
      <h2>銘柄一覧</h2>

      {/* フィルタエリア */}
      <div style={{ marginBottom: 15 }}>
        <input
          placeholder="コード・銘柄名検索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />

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

        <label style={{ marginLeft: 10 }}>
          <input
            type="checkbox"
            checked={favoriteOnly}
            onChange={(e) => setFavoriteOnly(e.target.checked)}
          />
          ★のみ
        </label>
        <label style={{ marginLeft: 10 }}>
          <input
            type="checkbox"
            checked={buyTargetOnly}
            onChange={(e) => setBuyTargetOnly(e.target.checked)}
          />
          買い狙い
        </label>
        <label style={{ marginLeft: 10 }}>
          <input
            type="checkbox"
            checked={sellTargetOnly}
            onChange={(e) => setSellTargetOnly(e.target.checked)}
          />
          売り狙い
        </label>
      </div>
      <div className="table-wrapper">
       <table className="table">
        <thead>
          <tr>
            <th onClick={() => handleSort("favorite")}>★</th>
            <th onClick={() => handleSort("code")}>コード</th>
            <th onClick={() => handleSort("name")}>銘柄名</th>
            <th onClick={() => handleSort("industry")}>業種</th>
            <th onClick={() => handleSort("latest_close")}>最新株価</th>
            <th onClick={() => handleSort("buy_price")}>買い狙い価格</th>
            <th onClick={() => handleSort("sell_price")}>売り狙い価格</th>
            <th onClick={() => handleSort("holding_qty")}>保有株数</th>
            <th onClick={() => handleSort("avg_buy_price")}>買い平均価格</th>
            <th onClick={() => handleSort("holding_value")}>保有価値</th>
            <th onClick={() => handleSort("unrealized_pnl")}>現株価損益</th>
            <th onClick={() => handleSort("realized_pnl")}>確定損益</th>
            <th onClick={() => handleSort("change_value")}>前日比</th>
            <th onClick={() => handleSort("change_percent")}>前日比%</th>
            <th onClick={() => handleSort("rsi14")}>RSI14</th>
            <th onClick={() => handleSort("rsi30")}>RSI30</th>
            <th onClick={() => handleSort("rsi60")}>RSI60</th>
            <th>操作</th>
          </tr>
        </thead>

        <tbody>
          {sortedFilteredStocks.map((stock) => {
            const row = editedRows[stock.id] || stock
            const isEdited = !!editedRows[stock.id]

            return (
              <Fragment key={stock.id}>
                <tr style={{ background: isEdited ? "#fff8dc" : "" }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.favorite || false}
                      onChange={(e) =>
                        handleChange(stock.id, "favorite", e.target.checked)
                      }
                    />
                  </td>

                  <td>
                    <input
                      value={row.code}
                      onChange={(e) =>
                        handleChange(stock.id, "code", e.target.value)
                      }
                    />
                  </td>

                  <td>
                    <input
                      value={row.name}
                      onChange={(e) =>
                        handleChange(stock.id, "name", e.target.value)
                      }
                    />
                  </td>

                  <td>
                    <input
                      value={row.industry || ""}
                      onChange={(e) =>
                        handleChange(stock.id, "industry", e.target.value)
                      }
                    />
                  </td>

                  <td>
                    <div>{fmtNumber(stock.latest_close)}</div>
                    <small>{fmtDate(stock.latest_date)}</small>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={row.buy_price ?? ""}
                      onChange={(e) => handleNumberChange(stock.id, "buy_price", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={row.sell_price ?? ""}
                      onChange={(e) => handleNumberChange(stock.id, "sell_price", e.target.value)}
                    />
                  </td>
                  <td>{fmtNumber(stock.holding_qty, 0)}</td>
                  <td>{fmtNumber(stock.avg_buy_price)}</td>
                  <td>{fmtNumber(stock.holding_value)}</td>
                  <td className={getChangeClass(stock.unrealized_pnl)}>{fmtNumber(stock.unrealized_pnl)}</td>
                  <td className={getChangeClass(stock.realized_pnl)}>{fmtNumber(stock.realized_pnl)}</td>
                  <td className={getChangeClass(stock.change_value)}>{fmtNumber(stock.change_value)}</td>
                  <td className={getChangeClass(stock.change_percent)}>
                    {stock.change_percent == null ? "-" : `${fmtFixed(stock.change_percent)}%`}
                  </td>
                  <td className={getRsiClass(stock.rsi14)}>{fmtFixed(stock.rsi14)}</td>
                  <td className={getRsiClass(stock.rsi30)}>{fmtFixed(stock.rsi30)}</td>
                  <td className={getRsiClass(stock.rsi60)}>{fmtFixed(stock.rsi60)}</td>

                  <td>
                    <Link className="detail-link" to={`/stocks/${stock.id}`}>
                      詳細
                    </Link>

                    <button
                      onClick={() => handleSave(stock.id)}
                      disabled={!isEdited}
                    >
                      💾
                    </button>

                    <button onClick={() => onDelete(stock.id)}>
                      🗑
                    </button>
                    <button onClick={() => void openTradeForm(stock.id)}>
                      取引履歴追加
                    </button>
                  </td>
                </tr>

                {tradeFormOpenId === stock.id && (
                  <tr key={`trade-form-${stock.id}`} className="trade-form-row">
                    <td colSpan={18}>
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
  )
}

import { useEffect, useState } from "react"
import "../App.css"
import StockTable from "../components/StockTable"

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
  minkabu_target_price?: number | null
  minkabu_target_rating?: string | null
  minkabu_theoretical_price?: number | null
  minkabu_individual_price?: number | null
  minkabu_individual_rating?: string | null
  minkabu_analyst_price?: number | null
  minkabu_analyst_rating?: string | null
  minkabu_fetched_date?: string | null
  kabutan_total_yield?: number | null
  kabutan_benefit_yield?: number | null
  kabutan_dividend_yield?: number | null
  kabutan_fetched_date?: string | null
}

function App() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [isUpdatingAllDaily, setIsUpdatingAllDaily] = useState(false)
  const [updateAllMessage, setUpdateAllMessage] = useState("")
  const [isUpdatingMinkabu, setIsUpdatingMinkabu] = useState(false)
  const [updateMinkabuMessage, setUpdateMinkabuMessage] = useState("")
  const [isUpdatingKabutan, setIsUpdatingKabutan] = useState(false)
  const [updateKabutanMessage, setUpdateKabutanMessage] = useState("")
  const [isActionsVisible, setIsActionsVisible] = useState(true)

  // -----------------------------
  // 一覧取得
  // -----------------------------
  const fetchStocks = async () => {
    const res = await fetch("http://localhost:8000/api/stocks", { cache: "no-store" })
    const data: Stock[] = await res.json()
    setStocks(data)
  }

  useEffect(() => {
    fetchStocks()
  }, [])

  // -----------------------------
  // 新規追加
  // -----------------------------
  const addStock = async (
    code: string,
    name: string,
    industry: string,
    favorite: boolean
  ) => {
    await fetch("http://localhost:8000/api/stocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, industry, favorite })
    })

    fetchStocks()
  }

  // -----------------------------
  // 更新（保存ボタン用）
  // -----------------------------
  const updateStock = async (stock: Stock) => {
    await fetch(`http://localhost:8000/api/stocks/${stock.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: stock.code,
        name: stock.name,
        industry: stock.industry,
        favorite: stock.favorite,
        buy_price: stock.buy_price,
        sell_price: stock.sell_price,
      }),
    })

    fetchStocks()
  }

  // -----------------------------
  // 削除
  // -----------------------------
  const deleteStock = async (id: number) => {
    await fetch(`http://localhost:8000/api/stocks/${id}`, {
      method: "DELETE"
    })

    fetchStocks()
  }

  const addTrade = async (
    stockId: number,
    tradeDate: string,
    side: "buy" | "sell",
    quantity: number,
    price: number
  ) => {
    await fetch(`http://localhost:8000/api/stocks/${stockId}/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trade_date: tradeDate,
        side,
        quantity,
        price,
      }),
    })
    await fetchStocks()
  }

  const fetchTrades = async (stockId: number) => {
    const res = await fetch(`http://localhost:8000/api/stocks/${stockId}/trades`, { cache: "no-store" })
    return res.json()
  }

  const deleteTrade = async (stockId: number, createdAt: string) => {
    await fetch(
      `http://localhost:8000/api/stocks/${stockId}/trades?created_at=${encodeURIComponent(createdAt)}`,
      { method: "DELETE" }
    )
    await fetchStocks()
  }

  const updateAllDaily = async () => {
    if (isUpdatingAllDaily) return
    setIsUpdatingAllDaily(true)
    setUpdateAllMessage("全銘柄の日次データを更新中...")
    try {
      const res = await fetch("http://localhost:8000/api/stocks/update-daily-all?days=7", {
        method: "POST",
      })
      if (!res.ok) {
        setUpdateAllMessage("更新に失敗しました")
        return
      }
      const data = await res.json()
      setUpdateAllMessage(`更新完了: ${data.updated_stocks}銘柄 / ${data.updated_rows}件`)
      fetchStocks()
    } catch {
      setUpdateAllMessage("更新に失敗しました")
    } finally {
      setIsUpdatingAllDaily(false)
    }
  }

  const updateAllMinkabu = async () => {
    if (isUpdatingMinkabu) return
    setIsUpdatingMinkabu(true)
    setUpdateMinkabuMessage("みんかぶ予想を取得中...")
    try {
      const res = await fetch("http://localhost:8000/api/stocks/update-minkabu-forecast-all", {
        method: "POST",
      })
      if (!res.ok) {
        setUpdateMinkabuMessage("取得に失敗しました")
        return
      }
      const data = await res.json()
      setUpdateMinkabuMessage(
        `更新: ${data.updated_stocks} / スキップ: ${data.skipped_stocks} / 失敗: ${data.failed?.length ?? 0}`
      )
      fetchStocks()
    } catch {
      setUpdateMinkabuMessage("取得に失敗しました")
    } finally {
      setIsUpdatingMinkabu(false)
    }
  }

  const updateAllKabutan = async () => {
    if (isUpdatingKabutan) return
    setIsUpdatingKabutan(true)
    setUpdateKabutanMessage("配当・優待利回りを取得中...")
    try {
      const res = await fetch("http://localhost:8000/api/stocks/update-kabutan-yields-all", {
        method: "POST",
      })
      if (!res.ok) {
        setUpdateKabutanMessage("取得に失敗しました")
        return
      }
      const data = await res.json()
      setUpdateKabutanMessage(
        `更新: ${data.updated_stocks} / スキップ: ${data.skipped_stocks} / 失敗: ${data.failed?.length ?? 0}`
      )
      fetchStocks()
    } catch {
      setUpdateKabutanMessage("取得に失敗しました")
    } finally {
      setIsUpdatingKabutan(false)
    }
  }

  const exportStocksCsv = () => {
    const headers = [
      "id",
      "code",
      "name",
      "industry",
      "favorite",
      "latest_close",
      "buy_target_price",
      "sell_target_price",
      "holding_qty",
      "avg_buy_price",
      "holding_value",
      "unrealized_pnl",
      "realized_pnl",
      "change_value",
      "change_percent",
      "rsi14",
      "rsi30",
      "rsi60",
      "minkabu_target_price",
      "minkabu_target_rating",
      "minkabu_theoretical_price",
      "minkabu_individual_price",
      "minkabu_individual_rating",
      "minkabu_analyst_price",
      "minkabu_analyst_rating",
      "minkabu_fetched_date",
      "kabutan_total_yield",
      "kabutan_benefit_yield",
      "kabutan_dividend_yield",
      "kabutan_fetched_date",
    ]

    const escapeCsv = (value: unknown) => {
      if (value === null || value === undefined) return ""
      const text = String(value)
      if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
        return `"${text.replace(/"/g, "\"\"")}"`
      }
      return text
    }

    const rows = stocks.map((s) => [
      s.id,
      s.code,
      s.name,
      s.industry ?? "",
      s.favorite ? "true" : "false",
      s.latest_close ?? "",
      s.buy_price ?? "",
      s.sell_price ?? "",
      s.holding_qty ?? "",
      s.avg_buy_price ?? "",
      s.holding_value ?? "",
      s.unrealized_pnl ?? "",
      s.realized_pnl ?? "",
      s.change_value ?? "",
      s.change_percent ?? "",
      s.rsi14 ?? "",
      s.rsi30 ?? "",
      s.rsi60 ?? "",
      s.minkabu_target_price ?? "",
      s.minkabu_target_rating ?? "",
      s.minkabu_theoretical_price ?? "",
      s.minkabu_individual_price ?? "",
      s.minkabu_individual_rating ?? "",
      s.minkabu_analyst_price ?? "",
      s.minkabu_analyst_rating ?? "",
      s.minkabu_fetched_date ?? "",
      s.kabutan_total_yield ?? "",
      s.kabutan_benefit_yield ?? "",
      s.kabutan_dividend_yield ?? "",
      s.kabutan_fetched_date ?? "",
    ])

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const today = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `stocks_${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="container">
      <h1 className="title">📈 株式銘柄管理</h1>
      <section className="panel">
        <div className="panel-header">
          <h3 className="panel-title">{"\u30c7\u30fc\u30bf\u53d6\u5f97"}</h3>
          <button
            type="button"
            className="panel-toggle"
            onClick={() => setIsActionsVisible((prev) => !prev)}
          >
            {isActionsVisible ? "\u975e\u8868\u793a" : "\u8868\u793a"}
          </button>
        </div>
        {isActionsVisible && (
          <div className="home-actions">
            <button
              className="save"
              onClick={updateAllDaily}
              disabled={isUpdatingAllDaily}
            >
              {isUpdatingAllDaily ? "\u66f4\u65b0\u4e2d..." : "\u5168\u92d8\u67c4\u0037\u65e5\u5206\u0044\u0042\u66f4\u65b0"}
            </button>
            <button
              className="save"
              onClick={updateAllMinkabu}
              disabled={isUpdatingMinkabu}
            >
              {isUpdatingMinkabu ? "\u53d6\u5f97\u4e2d..." : "\u307f\u3093\u304b\u3076\u4e88\u60f3 \u4e00\u62ec\u53d6\u5f97"}
            </button>
            <button
              className="save"
              onClick={updateAllKabutan}
              disabled={isUpdatingKabutan}
            >
              {isUpdatingKabutan ? "\u53d6\u5f97\u4e2d..." : "\u914d\u5f53\u30fb\u512a\u5f85\u5229\u56de\u308a \u4e00\u62ec\u53d6\u5f97"}
            </button>
            <button onClick={exportStocksCsv}>{"\u0043\u0053\u0056\u30a8\u30af\u30b9\u30dd\u30fc\u30c8"}</button>
          </div>
        )}
        <div className="panel-messages">
          {updateAllMessage && <span className="update-message">{updateAllMessage}</span>}
          {updateMinkabuMessage && <span className="update-message">{updateMinkabuMessage}</span>}
          {updateKabutanMessage && <span className="update-message">{updateKabutanMessage}</span>}
        </div>
      </section>


      {/* 一覧編集専用 */}
      <StockTable
        stocks={stocks}
        onAdd={addStock}
        onUpdate={updateStock}
        onDelete={deleteStock}
        onAddTrade={addTrade}
        onFetchTrades={fetchTrades}
        onDeleteTrade={deleteTrade}
      />
    </div>
  )
}

export default App

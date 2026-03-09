import { useEffect, useState } from "react"
import "../App.css"
import StockForm from "../components/StockForm"
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
}

function App() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [isUpdatingAllDaily, setIsUpdatingAllDaily] = useState(false)
  const [updateAllMessage, setUpdateAllMessage] = useState("")

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
      <div className="home-actions">
        <button
          className="save"
          onClick={updateAllDaily}
          disabled={isUpdatingAllDaily}
        >
          {isUpdatingAllDaily ? "更新中..." : "全銘柄7日分DB更新"}
        </button>
        <button onClick={exportStocksCsv}>CSVエクスポート</button>
        {updateAllMessage && <span className="update-message">{updateAllMessage}</span>}
      </div>

      {/* 新規追加専用 */}
      <StockForm onAdd={addStock} />

      {/* 一覧編集専用 */}
      <StockTable
        stocks={stocks}
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

import { useEffect, useState } from "react"
import "../App.css"
import StockTable from "../components/StockTable"
import StockForm from "../components/StockForm"
import DashboardHeader from "../components/layout/DashboardHeader"
import { apiUrl } from "../lib/api"

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

type FavoriteBackup = {
  ids: number[]
  savedAt: string
}

const FAVORITE_BACKUP_KEY = "kabu.favorite-backup.v1"

const getFavoriteIds = (items: Stock[]) =>
  [...new Set(items.filter((stock) => stock.favorite).map((stock) => stock.id))].sort((a, b) => a - b)

const readFavoriteBackup = (): FavoriteBackup | null => {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(FAVORITE_BACKUP_KEY)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || !("ids" in parsed)) return null

    const idsValue = (parsed as { ids?: unknown }).ids
    const savedAtValue = (parsed as { savedAt?: unknown }).savedAt
    if (!Array.isArray(idsValue)) return null

    const ids = [...new Set(
      idsValue.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    )].sort((a, b) => a - b)

    return {
      ids,
      savedAt: typeof savedAtValue === "string" ? savedAtValue : "",
    }
  } catch {
    return null
  }
}

const writeFavoriteBackup = (ids: number[]) => {
  if (typeof window === "undefined") return
  const payload: FavoriteBackup = {
    ids: [...new Set(ids)].sort((a, b) => a - b),
    savedAt: new Date().toISOString(),
  }
  window.localStorage.setItem(FAVORITE_BACKUP_KEY, JSON.stringify(payload))
}

const formatFavoriteBackupSavedAt = (savedAt: string) => {
  if (!savedAt) return ""
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString()
}

function Home() {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [isUpdatingAllDaily, setIsUpdatingAllDaily] = useState(false)
  const [updateAllMessage, setUpdateAllMessage] = useState("")
  const [isUpdatingMinkabu, setIsUpdatingMinkabu] = useState(false)
  const [updateMinkabuMessage, setUpdateMinkabuMessage] = useState("")
  const [isUpdatingKabutan, setIsUpdatingKabutan] = useState(false)
  const [updateKabutanMessage, setUpdateKabutanMessage] = useState("")
  const [favoriteRestoreInfo, setFavoriteRestoreInfo] = useState<FavoriteBackup | null>(null)
  const [favoriteRestoreMessage, setFavoriteRestoreMessage] = useState("")
  const [isRestoringFavorites, setIsRestoringFavorites] = useState(false)

  // 初期表示: 左右とも表示
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true)
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true)

  const syncFavoriteBackup = (nextStocks: Stock[], allowEmptyFavoriteBackup = false) => {
    const favoriteIds = getFavoriteIds(nextStocks)
    if (favoriteIds.length > 0 || allowEmptyFavoriteBackup) {
      writeFavoriteBackup(favoriteIds)
      setFavoriteRestoreInfo(null)
      return
    }

    const backup = readFavoriteBackup()
    if (backup && backup.ids.length > 0) {
      setFavoriteRestoreInfo(backup)
      return
    }
    setFavoriteRestoreInfo(null)
  }

  const fetchStocks = async (options?: { allowEmptyFavoriteBackup?: boolean }) => {
    const res = await fetch(apiUrl("/api/stocks"), { cache: "no-store" })
    const data: Stock[] = await res.json()
    setStocks(data)
    syncFavoriteBackup(data, options?.allowEmptyFavoriteBackup ?? false)
  }

  useEffect(() => {
    void fetchStocks()
  }, [])

  const saveStock = async (
    stock: Stock,
    options: { reload?: boolean; allowEmptyFavoriteBackup?: boolean } = {}
  ) => {
    const payload: Record<string, unknown> = {
      code: stock.code,
      name: stock.name,
      industry: stock.industry ?? null,
      buy_price: stock.buy_price ?? null,
      sell_price: stock.sell_price ?? null,
    }
    if (stock.favorite !== undefined) payload.favorite = stock.favorite

    const res = await fetch(apiUrl(`/api/stocks/${stock.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error("failed to update stock")
    if (options.reload !== false) {
      await fetchStocks({ allowEmptyFavoriteBackup: options.allowEmptyFavoriteBackup ?? true })
    }
  }

  const addStock = async (code: string, name: string, industry: string, favorite: boolean) => {
    await fetch(apiUrl("/api/stocks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name, industry, favorite }),
    })
    await fetchStocks({ allowEmptyFavoriteBackup: true })
  }

  const updateStock = async (stock: Stock) => {
    await saveStock(stock, { allowEmptyFavoriteBackup: true })
  }

  const deleteStock = async (id: number) => {
    await fetch(apiUrl(`/api/stocks/${id}`), { method: "DELETE" })
    await fetchStocks({ allowEmptyFavoriteBackup: true })
  }

  const addTrade = async (
    stockId: number,
    tradeDate: string,
    side: "buy" | "sell",
    quantity: number,
    price: number
  ) => {
    await fetch(apiUrl(`/api/stocks/${stockId}/trades`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade_date: tradeDate, side, quantity, price }),
    })
    await fetchStocks()
  }

  const fetchTrades = async (stockId: number) => {
    const res = await fetch(apiUrl(`/api/stocks/${stockId}/trades`), { cache: "no-store" })
    return res.json()
  }

  const deleteTrade = async (stockId: number, createdAt: string) => {
    await fetch(
      apiUrl(`/api/stocks/${stockId}/trades?created_at=${encodeURIComponent(createdAt)}`),
      { method: "DELETE" }
    )
    await fetchStocks()
  }

  const restoreFavoriteBackup = async () => {
    const backup = readFavoriteBackup()
    if (!backup || backup.ids.length === 0 || isRestoringFavorites) return

    const favoriteIdSet = new Set(backup.ids)
    const restoreTargets = stocks.filter((stock) => favoriteIdSet.has(stock.id) && !stock.favorite)

    if (restoreTargets.length === 0) {
      writeFavoriteBackup(getFavoriteIds(stocks))
      setFavoriteRestoreInfo(null)
      setFavoriteRestoreMessage("復元できるお気に入りはありません")
      return
    }

    setIsRestoringFavorites(true)
    setFavoriteRestoreMessage(`お気に入りを ${restoreTargets.length} 件復元中...`)
    try {
      for (const stock of restoreTargets) {
        await saveStock({ ...stock, favorite: true }, { reload: false })
      }
      await fetchStocks({ allowEmptyFavoriteBackup: true })
      setFavoriteRestoreMessage(`お気に入りを ${restoreTargets.length} 件復元しました`)
    } catch {
      setFavoriteRestoreMessage("お気に入りの復元に失敗しました")
      await fetchStocks()
    } finally {
      setIsRestoringFavorites(false)
    }
  }

  const updateAllDaily = async () => {
    if (isUpdatingAllDaily) return
    setIsUpdatingAllDaily(true)
    setUpdateAllMessage("全銘柄の日次データを更新中...")
    try {
      const res = await fetch(apiUrl("/api/stocks/update-daily-all?days=7"), { method: "POST" })
      if (!res.ok) {
        setUpdateAllMessage("更新に失敗しました")
        return
      }
      const data = await res.json()
      setUpdateAllMessage(
        `更新完了: 株価 ${data.updated_stocks}銘柄 / ${data.updated_rows}件, 市場連動係数 ${data.beta_updated_stocks ?? 0}銘柄, 決算月 ${data.fiscal_info_updated_stocks ?? 0}銘柄, 市場連動係数失敗 ${data.beta_failed?.length ?? 0}件`
      )
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
      const res = await fetch(apiUrl("/api/stocks/update-minkabu-forecast-all"), { method: "POST" })
      if (!res.ok) {
        setUpdateMinkabuMessage("取得に失敗しました")
        return
      }
      const data = await res.json()
      setUpdateMinkabuMessage(`更新: ${data.updated_stocks} / スキップ: ${data.skipped_stocks} / 失敗: ${data.failed?.length ?? 0}`)
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
      const res = await fetch(apiUrl("/api/stocks/update-kabutan-yields-all"), { method: "POST" })
      if (!res.ok) {
        setUpdateKabutanMessage("取得に失敗しました")
        return
      }
      const data = await res.json()
      setUpdateKabutanMessage(`更新: ${data.updated_stocks} / スキップ: ${data.skipped_stocks} / 失敗: ${data.failed?.length ?? 0}`)
      fetchStocks()
    } catch {
      setUpdateKabutanMessage("取得に失敗しました")
    } finally {
      setIsUpdatingKabutan(false)
    }
  }

  const exportStocksCsv = () => {
    const headers = [
      "id", "code", "name", "industry", "favorite", "latest_close", "buy_target_price", "sell_target_price",
      "holding_qty", "avg_buy_price", "holding_value", "unrealized_pnl", "realized_pnl", "change_value",
      "change_percent", "rsi14", "rsi30", "rsi60", "beta", "beta_3m", "beta_calc_date", "minkabu_target_price",
      "minkabu_target_rating", "minkabu_theoretical_price", "minkabu_individual_price", "minkabu_individual_rating",
      "minkabu_analyst_price", "minkabu_analyst_rating", "minkabu_fetched_date", "kabutan_total_yield",
      "kabutan_benefit_yield", "kabutan_dividend_yield", "kabutan_fetched_date",
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
      s.id, s.code, s.name, s.industry ?? "", s.favorite ? "true" : "false", s.latest_close ?? "", s.buy_price ?? "",
      s.sell_price ?? "", s.holding_qty ?? "", s.avg_buy_price ?? "", s.holding_value ?? "", s.unrealized_pnl ?? "",
      s.realized_pnl ?? "", s.change_value ?? "", s.change_percent ?? "", s.rsi14 ?? "", s.rsi30 ?? "", s.rsi60 ?? "",
      s.beta ?? "", s.beta_3m ?? "", s.beta_calc_date ?? "", s.minkabu_target_price ?? "", s.minkabu_target_rating ?? "",
      s.minkabu_theoretical_price ?? "", s.minkabu_individual_price ?? "", s.minkabu_individual_rating ?? "",
      s.minkabu_analyst_price ?? "", s.minkabu_analyst_rating ?? "", s.minkabu_fetched_date ?? "",
      s.kabutan_total_yield ?? "", s.kabutan_benefit_yield ?? "", s.kabutan_dividend_yield ?? "", s.kabutan_fetched_date ?? "",
    ])

    const csv = [headers, ...rows].map((row) => row.map((cell) => escapeCsv(cell)).join(",")).join("\n")
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
    <div className="dashboard-page">
      <DashboardHeader
        title="株式銘柄管理"
        isLeftSidebarOpen={isLeftSidebarOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        onToggleLeft={() => setIsLeftSidebarOpen((prev) => !prev)}
        onToggleRight={() => setIsRightSidebarOpen((prev) => !prev)}
      />

      <div className={`dashboard-body ${isLeftSidebarOpen ? "with-left-sidebar" : "without-left-sidebar"}`}>
        {isLeftSidebarOpen && (
          <aside className="dashboard-sidebar left-sidebar">
            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">データ取得</h3>
              </div>
              <div className="home-actions">
                <button className="save left-action-btn" onClick={updateAllDaily} disabled={isUpdatingAllDaily}>
                  {isUpdatingAllDaily ? "更新中..." : "全銘柄7日分DB更新+市場連動係数計算"}
                </button>
                <button className="save left-action-btn" onClick={updateAllMinkabu} disabled={isUpdatingMinkabu}>
                  {isUpdatingMinkabu ? "取得中..." : "みんかぶ予想 一括取得"}
                </button>
                <button className="save left-action-btn" onClick={updateAllKabutan} disabled={isUpdatingKabutan}>
                  {isUpdatingKabutan ? "取得中..." : "配当・優待利回り 一括取得"}
                </button>
                <button className="left-action-btn" onClick={exportStocksCsv}>CSVエクスポート</button>
              </div>
              <div className="panel-messages">
                {updateAllMessage && <span className="update-message">{updateAllMessage}</span>}
                {updateMinkabuMessage && <span className="update-message">{updateMinkabuMessage}</span>}
                {updateKabutanMessage && <span className="update-message">{updateKabutanMessage}</span>}
                {favoriteRestoreMessage && <span className="update-message">{favoriteRestoreMessage}</span>}
              </div>
            </section>

            <section className="panel">
              <h3 className="panel-title">レコード追加</h3>
              <StockForm onAdd={addStock} />
            </section>

            {favoriteRestoreInfo && (
              <section className="favorite-recovery">
                <div className="favorite-recovery-copy">
                  <strong>お気に入りが全件OFFになっています</strong>
                  <span>このブラウザに残っている {favoriteRestoreInfo.ids.length} 件のバックアップから復元できます。</span>
                  {formatFavoriteBackupSavedAt(favoriteRestoreInfo.savedAt) && (
                    <small>最終バックアップ: {formatFavoriteBackupSavedAt(favoriteRestoreInfo.savedAt)}</small>
                  )}
                </div>
                <button type="button" className="save" onClick={restoreFavoriteBackup} disabled={isRestoringFavorites}>
                  {isRestoringFavorites ? "復元中..." : "お気に入りを復元"}
                </button>
              </section>
            )}
          </aside>
        )}

        <main className="dashboard-main">
          <StockTable
            stocks={stocks}
            onUpdate={updateStock}
            onDelete={deleteStock}
            onAddTrade={addTrade}
            onFetchTrades={fetchTrades}
            onDeleteTrade={deleteTrade}
            isRightSidebarOpen={isRightSidebarOpen}
          />
        </main>
      </div>
    </div>
  )
}

export default Home

import { useEffect, useState } from "react"

type Stock = {
  id: number
  code: string
  name: string
  industry?: string
  favorite?: boolean
}

type Props = {
  onAdd: (code: string, name: string, industry: string, favorite: boolean) => Promise<void>
  onUpdate?: (id: number, code: string, name: string, industry: string, favorite: boolean) => Promise<void>
  editingStock?: Stock | null
}

export default function StockForm({ onAdd, onUpdate, editingStock }: Props) {
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [industry, setIndustry] = useState("")
  const [favorite, setFavorite] = useState(false)

  useEffect(() => {
    if (editingStock) {
      setCode(editingStock.code)
      setName(editingStock.name)
      setIndustry(editingStock.industry ?? "")
      setFavorite(!!editingStock.favorite)
    } else {
      setCode("")
      setName("")
      setIndustry("")
      setFavorite(false)
    }
  }, [editingStock])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editingStock && onUpdate) {
      await onUpdate(editingStock.id, code, name, industry, favorite)
    } else {
      await onAdd(code, name, industry, favorite)
    }
    setCode("")
    setName("")
    setIndustry("")
    setFavorite(false)
  }

  return (
    <section className="panel add-panel">
    <form onSubmit={handleSubmit} className="stock-form">
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="コード" required />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前" required />
      <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="業種" />
      <label>
        <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
        お気に入り
      </label>
      <button type="submit">{editingStock ? "更新" : "追加"}</button>
    </form>
    </section>
  )
}

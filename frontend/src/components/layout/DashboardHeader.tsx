type Props = {
  title: string
  isLeftSidebarOpen: boolean
  isRightSidebarOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export default function DashboardHeader({
  title,
  isLeftSidebarOpen,
  isRightSidebarOpen,
  onToggleLeft,
  onToggleRight,
}: Props) {
  return (
    <header className="dashboard-header">
      <div className="dashboard-header-left">
        <button type="button" className="sidebar-toggle-btn left-toggle-btn" onClick={onToggleLeft}>
          {isLeftSidebarOpen ? "◀ 左メニューを閉じる" : "▶ 左メニューを開く"}
        </button>
        <h1 className="dashboard-title">{title}</h1>
      </div>
      <div className="dashboard-header-actions">
        <button type="button" className="sidebar-toggle-btn" onClick={onToggleRight}>
          {isRightSidebarOpen ? "右メニューを閉じる ▶" : "右メニューを開く ◀"}
        </button>
      </div>
    </header>
  )
}

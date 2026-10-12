const PALETTE = ['#2f6fed', '#0e9f6e', '#d97706', '#8b5cf6', '#e11d48', '#0891b2', '#65a30d']

export function ownerColor(name, members = []) {
  if (!name || name === '미배정') return '#94a3b8'
  const index = members.indexOf(name)
  const seed = index >= 0 ? index : [...name].reduce((a, c) => a + c.charCodeAt(0), 0)
  return PALETTE[seed % PALETTE.length]
}

export function ProgressBar({ value, color = '#2f6fed', height = 8 }) {
  return (
    <div className="bar" style={{ height }}>
      <div
        className="bar-fill"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  )
}

export function StatusChip({ status }) {
  return <span className={`chip status-${status}`}>{status}</span>
}

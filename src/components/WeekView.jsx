import { ownerColor } from './ui.jsx'

export default function WeekView({ plan, stats }) {
  const weeks = plan.weeks
  const max = Math.max(1, ...plan.weeklyLoad.flatMap((row) => row.values))
  const weekTotals = weeks.map((_, i) =>
    plan.weeklyLoad.reduce((acc, row) => acc + (row.values[i] ?? 0), 0),
  )

  // 대분류의 주차 공수를, 그 대분류를 맡은 담당자들의 공수 비중대로 나눈 추정치
  const owners = [...plan.members, '미배정']
  const ownerWeek = owners.map((owner) => ({
    owner,
    values: weeks.map((_, weekIndex) =>
      plan.weeklyLoad.reduce((acc, row) => {
        const tasks = plan.tasks.filter((t) => t.category === row.category)
        const total = tasks.reduce((a, t) => a + t.effort, 0)
        if (!total) return acc
        const mine = tasks
          .filter((t) => (t.pub || '미배정') === owner)
          .reduce((a, t) => a + t.effort, 0)
        return acc + ((row.values[weekIndex] ?? 0) * mine) / total
      }, 0),
    ),
  })).filter((row) => row.values.some((v) => v > 0.05))
  const ownerMax = Math.max(1, ...ownerWeek.flatMap((row) => row.values))

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>대분류별 주차 공수</h2>
          <span className="muted">진한 칸일수록 공수가 큰 주차입니다</span>
        </div>
        <div className="scroll-x">
          <table className="grid heat">
            <thead>
              <tr>
                <th className="left sticky">{plan.labels.대분류}</th>
                {weeks.map((week, i) => (
                  <th key={week.name} className={i === stats.currentWeek ? 'now' : ''}>
                    <div>{week.name}</div>
                    <div className="muted small">
                      {fmt(week.start)}~{fmt(week.end)}
                    </div>
                  </th>
                ))}
                <th>합계</th>
                <th className="wide">진행률</th>
              </tr>
            </thead>
            <tbody>
              {plan.weeklyLoad.map((row) => {
                const cat = stats.byCategory.find((c) => c.key === row.category)
                const total = row.values.reduce((a, b) => a + b, 0)
                return (
                  <tr key={row.category}>
                    <td className="left strong sticky">{row.category}</td>
                    {row.values.map((value, i) => (
                      <td
                        key={i}
                        className={`heat-cell${i === stats.currentWeek ? ' now' : ''}`}
                        style={value ? { background: heatColor(value / max) } : undefined}
                      >
                        {value || ''}
                      </td>
                    ))}
                    <td className="strong">{total}</td>
                    <td className="wide">
                      <div className="inline-bar">
                        <div className="bar">
                          <div className="bar-fill" style={{ width: `${cat?.progress ?? 0}%` }} />
                        </div>
                        <span className="pct">{cat?.progress ?? 0}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="total-row">
                <td className="left sticky">주차 합계</td>
                {weekTotals.map((value, i) => (
                  <td key={i} className={i === stats.currentWeek ? 'now' : ''}>
                    {value}
                  </td>
                ))}
                <td>{weekTotals.reduce((a, b) => a + b, 0)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{plan.labels.퍼블담당}별 주차 부하 (추정)</h2>
          <span className="muted">현재 {plan.labels.퍼블담당} 배정을 기준으로 {plan.labels.대분류} 주차 공수를 나눈 값입니다</span>
        </div>
        <div className="scroll-x">
          <table className="grid heat">
            <thead>
              <tr>
                <th className="left sticky">담당자</th>
                {weeks.map((week, i) => (
                  <th key={week.name} className={i === stats.currentWeek ? 'now' : ''}>
                    {week.name}
                  </th>
                ))}
                <th>합계</th>
              </tr>
            </thead>
            <tbody>
              {ownerWeek.map((row) => (
                <tr key={row.owner}>
                  <td className="left strong sticky">
                    <span className="dot" style={{ background: ownerColor(row.owner, plan.members) }}>
                      {row.owner === '미배정' ? '?' : row.owner[0]}
                    </span>
                    {row.owner}
                  </td>
                  {row.values.map((value, i) => (
                    <td
                      key={i}
                      className={`heat-cell${i === stats.currentWeek ? ' now' : ''}`}
                      style={value > 0.05 ? { background: heatColor(value / ownerMax) } : undefined}
                    >
                      {value > 0.05 ? round(value) : ''}
                    </td>
                  ))}
                  <td className="strong">{round(row.values.reduce((a, b) => a + b, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const round = (n) => (Math.round(n * 10) / 10).toString()
const fmt = (iso) => iso.slice(5).replace('-', '.')
const heatColor = (ratio) => `rgba(47, 111, 237, ${0.08 + Math.min(1, ratio) * 0.55})`

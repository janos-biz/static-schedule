import { statusLabel } from '../lib/planMd.js'
import { ProgressBar, ownerColor } from './ui.jsx'

export default function Dashboard({ plan, stats, onSelectOwner }) {
  const labels = plan.labels
  const s = (status) => statusLabel(status, labels)
  const currentWeek = stats.currentWeek
  const weekLabel =
    currentWeek === -1
      ? '일정 종료'
      : `${plan.weeks[currentWeek]?.name} (${plan.weeks[currentWeek]?.start} ~ ${plan.weeks[currentWeek]?.end})`

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <h2>전체 진행률</h2>
          <span className="muted">현재 주차: {weekLabel}</span>
        </div>
        <div className="overall">
          <div className="overall-num">{stats.progress}%</div>
          <div className="overall-bar">
            <ProgressBar value={stats.progress} height={14} />
            <div className="muted small">
              진척 환산 {stats.doneEffort.toFixed(1)} / 전체 {stats.totalEffort}건
            </div>
          </div>
        </div>

        <div className="cards">
          <Metric label="전체 작업" value={`${plan.tasks.length}건`} sub={`화면 ${stats.totalEffort}건`} />
          <Metric label={s('대기')} value={`${stats.stageCounts.대기}건`} sub="착수 전" />
          <Metric
            label={s('퍼블')}
            value={`${stats.stageCounts.퍼블}건`}
            sub={`진행중 ${stats.phaseCounts['pub-doing']} · 완료(${s('검수')} 대기) ${stats.phaseCounts['pub-done']}`}
          />
          <Metric
            label={s('검수')}
            value={`${stats.stageCounts.검수}건`}
            sub={`진행중 ${stats.phaseCounts['qa-doing'] + stats.phaseCounts['qa-wait']} · 완료 ${stats.phaseCounts['qa-done']}`}
          />
          <Metric
            label={`${labels.퍼블담당} 미배정`}
            value={`${stats.unassignedCount}건`}
            sub={`화면 ${stats.unassignedEffort}건 · ${labels.검수담당} 미배정 ${stats.qaUnassignedCount}건`}
            warn={stats.unassignedCount > 0}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>담당자별 배정 현황 ({labels.퍼블담당} 기준)</h2>
          <span className="muted">카드를 클릭하면 해당 담당자의 {labels.퍼블담당}·{labels.검수담당} 작업만 볼 수 있습니다</span>
        </div>
        <div className="owner-grid">
          {stats.byOwner
            .filter((o) => o.count > 0 || plan.members.includes(o.key))
            .map((owner) => (
              <button
                key={owner.key}
                className="owner-card"
                onClick={() => onSelectOwner(owner.key)}
                style={{ borderTopColor: ownerColor(owner.key, plan.members) }}
              >
                <div className="owner-head">
                  <span className="owner-name">{owner.key}</span>
                  <span className="muted small">{labels.퍼블담당} {owner.count}건 · 화면 {owner.effort}건</span>
                </div>
                <ProgressBar
                  value={owner.progress}
                  color={ownerColor(owner.key, plan.members)}
                />
                <div className="owner-meta">
                  <span>{owner.progress}%</span>
                  <span className="muted small">
                    {s('대기')} {owner.counts.대기} · {s('퍼블')} {owner.counts.퍼블} · {s('검수')}{' '}
                    {owner.counts.검수}
                  </span>
                </div>
                {owner.key !== '미배정' && (
                  <div className="muted small">{labels.검수담당} 배정 {owner.qaCount}건 · 화면 {owner.qaEffort}건</div>
                )}
              </button>
            ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>대분류별 진행</h2>
        </div>
        <table className="grid">
          <thead>
            <tr>
              <th className="left">{labels.대분류}</th>
              <th>작업</th>
              <th>공수(화면 건수)</th>
              <th className="wide">진행률</th>
              <th>{labels.퍼블담당}</th>
              <th>{labels.백엔드}</th>
            </tr>
          </thead>
          <tbody>
            {stats.byCategory.map((row) => {
              const owners = [...new Set(row.tasks.map((t) => t.pub || '미배정'))]
              const backends = [...new Set(row.tasks.map((t) => t.backend).filter(Boolean))]
              return (
                <tr key={row.key}>
                  <td className="left strong">{row.key}</td>
                  <td>{row.count}</td>
                  <td>{row.effort}</td>
                  <td className="wide">
                    <div className="inline-bar">
                      <ProgressBar value={row.progress} />
                      <span className="pct">{row.progress}%</span>
                    </div>
                  </td>
                  <td>
                    <div className="owner-dots">
                      {owners.map((o) => (
                        <span
                          key={o}
                          className="dot"
                          title={o}
                          style={{ background: ownerColor(o, plan.members) }}
                        >
                          {o === '미배정' ? '?' : o[0]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="muted small">{backends.join(', ') || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Metric({ label, value, sub, warn }) {
  return (
    <div className={warn ? 'metric warn' : 'metric'}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  )
}

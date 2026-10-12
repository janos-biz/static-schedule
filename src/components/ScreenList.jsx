import { useMemo, useState } from 'react'
import { screenIaPath, screensForTask } from '../lib/planMd.js'

// 화면 유형(화면ID 끝 글자)
const TYPE_LABEL = { M: '메인', P: '팝업', T: '탭', D: '상세' }

// 작업 목록의 안정 작업키와 화면 목록을 결합한다. 외부 화면 데이터는 사용하지 않는다.
const flatten = (plan) =>
  plan.tasks.map((task) => {
    const screens = screensForTask(plan, task).map((screen) => ({
      ...screen,
      path: screenIaPath(plan, screen),
    }))
    const leaves = [...new Set(screens.map((screen) => screen.path).filter(Boolean))]
    return {
      key: task.workKey,
      major: task.category,
      mid: task.task,
      leaves,
      screens,
    }
  })

const matches = (row, q) => {
  if (!q) return true
  const hay = [row.major, row.mid, ...row.leaves, ...row.screens.map((s) => `${s.id} ${s.title}`)]
  return hay.join('\n').toLowerCase().includes(q)
}

export default function ScreenList({ plan }) {
  const [query, setQuery] = useState('')
  const [major, setMajor] = useState('전체')
  const [open, setOpen] = useState(() => new Set())

  const rows = useMemo(() => flatten(plan), [plan])
  const majors = useMemo(() => ['전체', ...new Set(plan.tasks.map((task) => task.category))], [plan.tasks])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => (major === '전체' || row.major === major) && matches(row, q))
  }, [rows, query, major])

  const totalScreens = visible.reduce((acc, row) => acc + row.screens.length, 0)
  const allOpen = visible.length > 0 && visible.every((row) => open.has(row.key))

  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(visible.map((r) => r.key)))

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>중메뉴별 화면번호</h2>
          <span className="muted small">
            중메뉴 {visible.length}개 · 화면 {totalScreens}건
            {visible.length !== rows.length ? ` (전체 중메뉴 ${rows.length} / 화면 ${plan.screens.length})` : ''}
          </span>
        </div>

        <div className="filters">
          <label>
            <span>대메뉴</span>
            <select value={major} onChange={(e) => setMajor(e.target.value)}>
              {majors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            <span>검색 (중메뉴 · 화면번호 · 화면명)</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 권한관리, UI-ESG-150M, 배출계수"
            />
          </label>
          <button className={allOpen ? 'ghost on' : 'ghost'} onClick={toggleAll} disabled={visible.length === 0}>
            {allOpen ? '모두 접기' : '모두 펼치기'}
          </button>
        </div>

        <p className="filter-summary">
          행(중메뉴)을 클릭하면 선택한 plan 파일의 작업키에 연결된 화면번호가 펼쳐집니다. IA·화면명·화면번호의
          출처는 현재 plan 파일 하나입니다.
        </p>

        {visible.length === 0 ? (
          <p className="muted">조건에 맞는 중메뉴가 없습니다.</p>
        ) : (
          <table className="grid accordion">
            <thead>
              <tr>
                <th className="col-toggle" />
                <th className="left col-major">대메뉴</th>
                <th className="left">중메뉴</th>
                <th className="col-count">화면 수</th>
                <th className="left col-first">첫 화면</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const expanded = open.has(row.key)
                return [
                  <tr
                    key={row.key}
                    className={expanded ? 'acc-row open' : 'acc-row'}
                    onClick={() => toggle(row.key)}
                  >
                    <td className="col-toggle">
                      <span className={expanded ? 'caret open' : 'caret'} aria-hidden="true" />
                    </td>
                    <td className="left muted small col-major">{row.major}</td>
                    <td className="left strong">
                      {row.mid}
                      {row.leaves.length > 0 && (
                        <span className="muted small leaf-hint"> · {row.leaves.join(' / ')}</span>
                      )}
                    </td>
                    <td>{row.screens.length}</td>
                    <td className="left mono small muted col-first">{row.screens[0]?.id ?? '—'}</td>
                  </tr>,
                  expanded && (
                    <tr key={`${row.key}--open`} className="acc-panel-row">
                      <td colSpan={5}>
                        <ScreenChips screens={row.screens} />
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// 화면번호 칩 목록. 화면 목록 탭과 담당자 배정 표의 펼침 영역이 함께 쓴다.
// hits = 검색어와 맞은 화면번호 배열(선택). 그 칩만 도드라지게 표시한다.
export function ScreenChips({ screens, hits }) {
  if (screens.length === 0) {
    return <p className="muted small">화면설계서에 연계된 화면이 없습니다.</p>
  }
  const hitSet = new Set(hits ?? [])
  return (
    <ul className="screen-list">
      {screens.map((s) => (
        <li key={s.id} title={s.path ?? ''} className={hitSet.has(s.id) ? 'hit' : undefined}>
          <span className="mono screen-id">{s.id}</span>
          <span className={`type-chip type-${s.type ?? 'M'}`}>{TYPE_LABEL[s.type] ?? s.type ?? '—'}</span>
          <span className="screen-title">{s.title || s.id}</span>
        </li>
      ))}
    </ul>
  )
}

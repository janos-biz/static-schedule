import { useState } from 'react'
import { LABEL_KEYS, STATUSES, completionAction } from '../lib/planMd.js'

function Drawer({ title, eyebrow, onClose, onSubmit, submitLabel, error, children }) {
  return (
    <div
      className="memo-drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        if (event.key !== 'Tab') return
        const focusable = [
          ...event.currentTarget.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
          ),
        ]
        const first = focusable[0]
        const last = focusable.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <div className="memo-drawer task-editor" role="dialog" aria-modal="true" aria-labelledby="maintain-editor-title">
        <div className="memo-drawer-head">
          <div>
            <p className="muted small">{eyebrow}</p>
            <h2 id="maintain-editor-title">{title}</h2>
          </div>
          <button type="button" className="memo-close" onClick={onClose} aria-label={`${title} 닫기`}>
            ×
          </button>
        </div>
        <form
          className="task-editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          {children}
          {error && (
            <p className="login-error maintain-error" role="alert">
              {error}
            </p>
          )}
          <div className="memo-drawer-actions">
            <button type="button" className="ghost" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="memo-save">
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const tryRun = (fn, setError) => {
  try {
    fn()
    return true
  } catch (error) {
    setError(String(error?.message ?? error))
    return false
  }
}

export function RosterEditor({ plan, onClose, onSubmit }) {
  const labels = plan.labels
  const [rows, setRows] = useState(() =>
    plan.people.map((person, index) => ({ ...person, original: person.name, key: `p${index}` })),
  )
  const [error, setError] = useState('')
  const usage = (name) =>
    plan.tasks.filter((task) => [task.backend, task.pub, task.qa].includes(name)).length

  const update = (key, patch) => {
    setError('')
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const submit = () => {
    const renames = Object.fromEntries(
      rows
        .filter((row) => row.original && row.original !== row.name.trim())
        .map((row) => [row.original, row.name.trim()]),
    )
    if (tryRun(() => onSubmit(rows, renames), setError)) onClose()
  }

  return (
    <Drawer
      eyebrow="plan 담당자 표"
      title="담당자 관리"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="명단 저장"
      error={error}
    >
      <p className="muted small">
        역할을 체크한 사람만 작업의 {labels.백엔드} · {labels.퍼블담당} · {labels.검수담당} 선택 목록에 나옵니다. 이름을
        바꾸면 그 사람이 배정된 작업에도 함께 반영됩니다.
      </p>
      <table className="maintain-grid">
        <thead>
          <tr>
            <th className="left">이름</th>
            <th>{labels.백엔드}</th>
            <th>{labels.퍼블담당}</th>
            <th>{labels.검수담당}</th>
            <th>배정</th>
            <th aria-label="삭제" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const used = row.original ? usage(row.original) : 0
            return (
              <tr key={row.key}>
                <td className="left">
                  <input
                    value={row.name}
                    onChange={(event) => update(row.key, { name: event.target.value })}
                    aria-label={`${index + 1}번째 담당자 이름`}
                    autoFocus={index === 0}
                    required
                  />
                </td>
                {['backend', 'pub', 'qa'].map((role) => (
                  <td key={role}>
                    <input
                      type="checkbox"
                      checked={row[role]}
                      onChange={(event) => update(row.key, { [role]: event.target.checked })}
                      aria-label={`${row.name || '새 담당자'} ${role === 'backend' ? labels.백엔드 : role === 'pub' ? labels.퍼블담당 : labels.검수담당}`}
                    />
                  </td>
                ))}
                <td className="muted small">{used}건</td>
                <td>
                  <button
                    type="button"
                    className="maintain-delete"
                    onClick={() => {
                      setError('')
                      setRows((prev) => prev.filter((item) => item.key !== row.key))
                    }}
                    aria-label={`${row.name || '새 담당자'} 삭제`}
                    title={used ? '배정된 작업이 있으면 저장할 때 막힙니다. 먼저 작업 담당자를 바꿔 주세요.' : '명단에서 뺍니다.'}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="ghost"
        onClick={() =>
          setRows((prev) => [
            ...prev,
            { key: `new${Date.now()}`, original: '', name: '', backend: false, pub: true, qa: true },
          ])
        }
      >
        담당자 추가
      </button>
    </Drawer>
  )
}

const toISO = (date) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const addDays = (iso, days) => {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toISO(date)
}

// 마지막 주차 다음 월요일~금요일. 주차가 없으면 오늘이 속한 주.
function nextWeek(rows) {
  const last = rows.at(-1)?.end
  const base = last ? addDays(last, 1) : toISO(new Date())
  const day = new Date(`${base}T00:00:00`).getDay()
  const monday = last ? addDays(base, (8 - day) % 7) : addDays(base, day === 0 ? -6 : 1 - day)
  return { name: `${rows.length + 1}주`, start: monday, end: addDays(monday, 4) }
}

export function ScheduleEditor({ plan, onClose, onSubmit }) {
  const [rows, setRows] = useState(() => plan.weeks.map((week, index) => ({ ...week, key: `w${index}` })))
  const [error, setError] = useState('')
  const first = rows[0]
  const last = rows.at(-1)
  const outside = plan.tasks.filter(
    (task) => (task.start && first && task.start < first.start) || (task.end && last && task.end > last.end),
  )

  const update = (key, patch) => {
    setError('')
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  return (
    <Drawer
      eyebrow="plan 주차 일정 표"
      title="계획 일정 관리"
      onClose={onClose}
      onSubmit={() => tryRun(() => onSubmit(rows), setError) && onClose()}
      submitLabel="일정 저장"
      error={error}
    >
      <p className="muted small">
        프로젝트 기간은 첫 주차 시작일 ~ 마지막 주차 종료일로 자동 계산됩니다. 휴일은 주차 날짜에서 빼서 적습니다.
        작업별 시작·종료일은 작업 행의 수정에서 바꿉니다.
      </p>
      <p className="maintain-summary">
        {first && last ? `${first.start} ~ ${last.end} · ${rows.length}주` : '주차가 없습니다'}
        {outside.length > 0 && (
          <span className="tag-diff">일정이 주차 범위 밖인 작업 {outside.length}건</span>
        )}
      </p>
      <table className="maintain-grid schedule-grid">
        <thead>
          <tr>
            <th className="left">주차</th>
            <th>시작</th>
            <th>종료</th>
            <th aria-label="삭제" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key}>
              <td className="left">
                <input
                  value={row.name}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                  aria-label={`${index + 1}번째 주차 이름`}
                  autoFocus={index === 0}
                  required
                />
              </td>
              <td>
                <input
                  type="date"
                  value={row.start}
                  onChange={(event) => update(row.key, { start: event.target.value })}
                  aria-label={`${row.name} 시작일`}
                  required
                />
              </td>
              <td>
                <input
                  type="date"
                  value={row.end}
                  onChange={(event) => update(row.key, { end: event.target.value })}
                  aria-label={`${row.name} 종료일`}
                  required
                />
              </td>
              <td>
                <button
                  type="button"
                  className="maintain-delete"
                  onClick={() => {
                    setError('')
                    setRows((prev) => prev.filter((item) => item.key !== row.key))
                  }}
                  aria-label={`${row.name} 삭제`}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="ghost"
        onClick={() => setRows((prev) => [...prev, { ...nextWeek(prev), key: `new${Date.now()}` }])}
      >
        주차 추가
      </button>
    </Drawer>
  )
}

const LABEL_GROUPS = [
  { title: '작업 표 헤더', keys: ['대분류', '중분류', '백엔드', '퍼블담당', '검수담당'] },
  { title: '상태 이름', keys: STATUSES },
]

export function LabelEditor({ plan, onClose, onSubmit }) {
  const [draft, setDraft] = useState(() => ({ ...plan.labels }))
  const [title, setTitle] = useState(plan.title)
  const [error, setError] = useState('')
  const preview = (status, progress) => completionAction({ status, progress }, draft).label

  return (
    <Drawer
      eyebrow="plan 표시 설정 표"
      title="표시 이름 관리"
      onClose={onClose}
      onSubmit={() => tryRun(() => onSubmit(draft, title), setError) && onClose()}
      submitLabel="이름 저장"
      error={error}
    >
      <p className="muted small">
        화면에 보이는 이름만 바뀝니다. plan 파일의 작업 목록에는 상태 코드(대기 · 퍼블 · 검수)가 그대로 저장되어 진행률
        규칙은 그대로입니다.
      </p>
      <fieldset className="maintain-fieldset">
        <legend>페이지</legend>
        <div className="task-editor-grid">
          <label className="task-editor-wide">
            페이지 제목 (화면 상단 · 브라우저 탭)
            <input
              value={title}
              onChange={(event) => {
                setError('')
                setTitle(event.target.value)
              }}
              autoFocus
              required
            />
          </label>
        </div>
      </fieldset>
      {LABEL_GROUPS.map((group) => (
        <fieldset key={group.title} className="maintain-fieldset">
          <legend>{group.title}</legend>
          <div className="task-editor-grid">
            {group.keys.filter((key) => LABEL_KEYS.includes(key)).map((key) => (
              <label key={key}>
                {group.keys === STATUSES ? `상태 ${key}` : key}
                <input
                  value={draft[key] ?? ''}
                  onChange={(event) => {
                    setError('')
                    setDraft((prev) => ({ ...prev, [key]: event.target.value }))
                  }}
                  required
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="maintain-summary">
        완료 버튼 미리보기: <strong>{preview('퍼블', 25)}</strong> → <strong>{preview('검수', 75)}</strong>
      </p>
    </Drawer>
  )
}

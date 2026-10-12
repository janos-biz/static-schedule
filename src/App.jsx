import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyLabels,
  applyRoster,
  applyTitle,
  applyWeeks,
  nowStamp,
  parsePlan,
  phaseKey,
  refreshDerived,
  serializePlan,
  stampCompletion,
  syncTaskScreens,
  syncStatusProgress,
} from './lib/planMd.js'
import { authPath, canEdit, canMaintain } from './lib/mode.js'
import AdminLogin from './components/AdminLogin.jsx'
import Dashboard from './components/Dashboard.jsx'
import WeekView from './components/WeekView.jsx'
import TaskTable from './components/TaskTable.jsx'
import ScreenList from './components/ScreenList.jsx'

const TABS = [
  // 읽기 전용에서는 배정을 할 수 없으니 탭 이름도 하는 일에 맞춘다.
  { key: 'tasks', label: canEdit ? '담당자 배정' : '작업 현황' },
  { key: 'dashboard', label: '대시보드' },
  { key: 'weeks', label: '주차 일정' },
  { key: 'screens', label: '화면 목록' },
]

const todayYYMMDD = () => todayISO().slice(2).replaceAll('-', '')

const todayISO = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 파일명의 날짜(YYMMDD) → 화면 표시용 2026-08-06
const dateLabel = (yymmdd) =>
  /^\d{6}$/.test(yymmdd)
    ? `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
    : yymmdd

// 새로고침해도 보고 있던 날짜가 유지되도록 주소(?date=)에 남긴다.
const dateFromUrl = () => {
  const value = new URLSearchParams(window.location.search).get('date') ?? ''
  return /^\d{6}$/.test(value) ? value : ''
}

// 선택한 날짜의 파일만 읽고 쓴다. 날짜가 비어 있으면 서버가 최신 파일을 골라 준다.
const fileUrl = (date) => (date ? `/plan-file?date=${date}` : '/plan-file')

const writeDateToUrl = (date) => {
  const url = new URL(window.location.href)
  if (date) url.searchParams.set('date', date)
  else url.searchParams.delete('date')
  window.history.replaceState(null, '', url)
}

export default function App() {
  const [plan, setPlan] = useState(null)
  const [mtime, setMtime] = useState(0)
  // date = 보고 있는 계획 파일의 날짜(YYMMDD). 빈 값이면 서버가 최신 파일을 준다.
  const [date, setDate] = useState(dateFromUrl)
  const [dates, setDates] = useState([])
  const [tab, setTab] = useState(() => {
    const hash = window.location.hash.replace('#', '')
    return TABS.some((t) => t.key === hash) ? hash : 'tasks'
  })
  const [ownerFilter, setOwnerFilter] = useState('전체')
  const [save, setSave] = useState({ state: 'idle', message: '' })
  const [error, setError] = useState('')
  // 역할별 로그인 상태. null = 아직 확인 중. 읽기 전용 화면에서는 물어볼 것이 없다.
  const [session, setSession] = useState(canEdit ? null : { configured: true, authed: false })
  const [expired, setExpired] = useState(false)

  const busy = useRef(false)
  const mtimeRef = useRef(0)
  const planRef = useRef(null)
  const dateRef = useRef('')
  mtimeRef.current = mtime
  planRef.current = plan
  dateRef.current = date

  const applyFile = useCallback((data) => {
    setPlan(parsePlan(data.content))
    setMtime(data.mtime)
    if (data.date) setDate(data.date)
    if (data.dates) setDates(data.dates)
  }, [])

  const load = useCallback(
    async (target) => {
      const res = await fetch(fileUrl(target))
      const data = await res.json().catch(() => ({}))
      // 응답을 기다리는 사이에 날짜를 또 바꿨으면 늦게 온 응답은 버린다.
      if (target && target !== dateRef.current) return
      if (!res.ok) throw new Error(data.error ?? `계획 파일을 읽지 못했습니다 (${res.status})`)
      applyFile(data)
      writeDateToUrl(data.date ?? target ?? '')
      setError('')
    },
    [applyFile],
  )

  useEffect(() => {
    load(dateFromUrl()).catch((e) => setError(String(e.message ?? e)))
  }, [load])

  // 편집 화면이면 현재 경로 역할의 로그인 여부를 묻는다. 실패하면 잠금 화면을 보여 준다.
  useEffect(() => {
    if (!canEdit) return
    fetch(`${authPath}/session`)
      .then((res) => res.json())
      .then(setSession)
      .catch(() => setSession({ configured: true, authed: false }))
  }, [])

  // 다른 사람이 저장한 내용을 주기적으로 가져온다.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (busy.current) return
      try {
        const res = await fetch(fileUrl(dateRef.current))
        if (!res.ok) return
        const data = await res.json()
        // 응답이 도착하는 사이에 날짜를 바꿨으면 버린다.
        if (data.date !== dateRef.current) return
        if (data.mtime !== mtimeRef.current) applyFile(data)
        else if (data.dates) setDates(data.dates)
      } catch {
        /* 네트워크 일시 오류는 무시 */
      }
    }, 7000)
    return () => clearInterval(timer)
  }, [applyFile])

  // 읽기 전용 화면에서는 저장 경로 자체를 막는다. 편집 UI도 함께 감추지만,
  // 마지막 관문을 여기 한 곳에 둬야 새 기능이 실수로 파일을 건드리지 않는다.
  const persist = useCallback(async (nextPlan) => {
    if (!canEdit) return
    busy.current = true
    const target = dateRef.current
    setSave({ state: 'saving', message: '저장 중…' })
    try {
      const content = serializePlan(nextPlan, { today: todayISO() })
      const res = await fetch(fileUrl(target), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, baseMtime: mtimeRef.current }),
      })
      const data = await res.json()

      if (res.status === 409) {
        applyFile(data)
        setSave({ state: 'error', message: '다른 사용자가 먼저 저장해서 최신 내용을 다시 불러왔습니다.' })
        return
      }
      // 쿠키가 만료됐거나 비밀번호가 바뀌었다. 저장한 내용은 화면에만 남으므로 다시 로그인시킨다.
      if (res.status === 401) {
        setExpired(true)
        setSession({ configured: true, authed: false })
        return
      }
      if (!res.ok) throw new Error(data.error ?? `저장 실패 (${res.status})`)

      setMtime(data.mtime)
      setSave({
        state: 'saved',
        message: `plan-${data.date}.md 저장됨 · ${new Date().toLocaleTimeString('ko-KR')}`,
      })
    } catch (e) {
      setSave({ state: 'error', message: `저장 실패: ${e.message ?? e}` })
    } finally {
      busy.current = false
    }
  }, [applyFile])

  // 바꾼 값에서 공수(연결 화면 수)·주차 공수·담당자 목록을 다시 계산한 뒤 화면에 반영하고 저장한다.
  const commit = useCallback(
    (next) => {
      const derived = refreshDerived(next)
      setPlan(derived)
      persist(derived)
    },
    [persist],
  )

  // 담당자·주차 일정·표시 이름은 /maintain 에서만 바꾼다. 검증 오류는 편집 drawer로 그대로 던진다.
  const saveSettings = useCallback(
    (apply) => {
      const prev = planRef.current
      if (!prev || !canMaintain) return
      commit(apply(prev))
    },
    [commit],
  )

  // 날짜를 바꾸면 그 날짜의 파일을 새로 읽는다. 저장도 이후부터 그 파일로 간다.
  const changeDate = useCallback(
    (next) => {
      if (next === dateRef.current) return
      dateRef.current = next
      setDate(next)
      setPlan(null)
      setMtime(0)
      setError('')
      setSave({ state: 'idle', message: '' })
      writeDateToUrl(next)
      load(next).catch((e) => setError(String(e.message ?? e)))
    },
    [load],
  )

  // 행 식별은 ID가 아니라 rowIndex(표에서의 행 위치)로 한다.
  // md를 직접 고치다 ID가 겹쳐도 엉뚱한 행이 같이 바뀌지 않는다.
  const updateTask = useCallback(
    (rowIndex, patch, changed) => {
      const prev = planRef.current
      if (!prev || !canEdit) return
      const at = nowStamp()
      const tasks = prev.tasks.map((task) => {
        if (task.rowIndex !== rowIndex) return task
        return applyTaskPatch(task, patch, changed, at)
      })
      const next = { ...prev, tasks }
      commit(next)
    },
    [commit],
  )

  // 여러 행을 한 번에 바꾸고 한 번만 저장한다.
  const updateMany = useCallback(
    (rowIndexes, patch, changed) => {
      const prev = planRef.current
      if (!prev || !canEdit || rowIndexes.length === 0) return
      const target = new Set(rowIndexes)
      const at = nowStamp()
      const tasks = prev.tasks.map((task) => {
        if (!target.has(task.rowIndex)) return task
        return applyTaskPatch(task, patch, changed, at)
      })
      const next = { ...prev, tasks }
      commit(next)
    },
    [commit],
  )

  const addTask = useCallback(
    (task, screenIds) => {
      const prev = planRef.current
      if (!prev || !canMaintain) return
      const rowIndex = prev.tasks.reduce((max, item) => Math.max(max, item.rowIndex), -1) + 1
      const screens = syncTaskScreens(prev.screens, null, task, screenIds)
      const next = {
        ...prev,
        tasks: [...prev.tasks, { ...task, rowIndex }],
        screens,
        screensManaged: true,
      }
      commit(next)
    },
    [commit],
  )

  const replaceTask = useCallback(
    (rowIndex, task, screenIds) => {
      const prev = planRef.current
      if (!prev || !canMaintain) return
      const replaced = prev.tasks.find((item) => item.rowIndex === rowIndex)
      if (!replaced) return
      const tasks = prev.tasks.map((item) => (item.rowIndex === rowIndex ? { ...task, rowIndex } : item))
      const screens = syncTaskScreens(prev.screens, replaced, task, screenIds)
      const releases = (prev.releases ?? []).map((entry) => {
        const matches = entry.category || entry.task
          ? entry.category === replaced.category && entry.task === replaced.task
          : entry.taskId === replaced.id
        return matches
          ? { ...entry, taskId: task.id, category: task.category, task: task.task }
          : entry
      })
      const next = { ...prev, tasks, screens, releases, screensManaged: true }
      commit(next)
    },
    [commit],
  )

  const deleteTask = useCallback(
    (rowIndex) => {
      const prev = planRef.current
      if (!prev || !canMaintain) return
      const removed = prev.tasks.find((item) => item.rowIndex === rowIndex)
      if (!removed) return
      const releases = (prev.releases ?? []).filter((entry) =>
        entry.category || entry.task
          ? entry.category !== removed.category || entry.task !== removed.task
          : entry.taskId !== removed.id,
      )
      const next = {
        ...prev,
        tasks: prev.tasks.filter((item) => item.rowIndex !== rowIndex),
        releases,
        screens: (prev.screens ?? []).filter((screen) => screen.workKey !== removed.workKey),
      }
      commit(next)
    },
    [commit],
  )

  // 릴리즈(개발 이관)는 계속 다시 일어나므로 덮어쓰지 않고 이력으로 쌓는다.
  // 쌓인 기록은 화면에서 지울 수 없다. 잘못 남긴 건 계획 파일의 `릴리즈 이력` 표에서 직접 고친다.
  const addRelease = useCallback(
    (rowIndex) => {
      const prev = planRef.current
      if (!prev || !canEdit) return
      const task = prev.tasks.find((t) => t.rowIndex === rowIndex)
      if (!task) return
      const entry = {
        at: nowStamp(),
        taskId: task.id,
        category: task.category,
        task: task.task,
        note: '',
      }
      const next = { ...prev, releases: [entry, ...(prev.releases ?? [])] }
      commit(next)
    },
    [commit],
  )

  // 최신 plan을 그대로 복제해 plan-<오늘>.md 를 만들고 그 버전으로 넘어간다. 이후 편집은 새 파일에 저장된다.
  const createVersion = useCallback(async () => {
    const source = dateRef.current
    if (!canMaintain || busy.current) return
    if (!window.confirm(`plan-${source}.md 를 복제해 plan-${todayYYMMDD()}.md 를 만들고 새 버전으로 전환할까요?`)) return
    busy.current = true
    setSave({ state: 'saving', message: '새 버전 만드는 중…' })
    try {
      const res = await fetch('/plan-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: source, baseMtime: mtimeRef.current }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setExpired(true)
        setSession({ configured: true, authed: false })
        return
      }
      if (data.dates) setDates(data.dates)
      if (!res.ok) throw new Error(data.error ?? `새 버전을 만들지 못했습니다 (${res.status})`)
      dateRef.current = data.date
      applyFile(data)
      writeDateToUrl(data.date)
      setSave({ state: 'saved', message: `plan-${data.date}.md 새 버전 생성 · plan-${source}.md 는 그대로 보존` })
    } catch (e) {
      setSave({ state: 'error', message: String(e.message ?? e) })
    } finally {
      busy.current = false
    }
  }, [applyFile])

  const stats = useMemo(() => (plan ? buildStats(plan) : null), [plan])

  // 브라우저 탭 제목도 plan 파일의 페이지 제목을 따른다.
  const pageTitle = plan?.title
  useEffect(() => {
    if (pageTitle) document.title = pageTitle
  }, [pageTitle])

  const logout = async () => {
    await fetch(`${authPath}/logout`, { method: 'POST' }).catch(() => {})
    setExpired(false)
    setSession({ configured: true, authed: false })
  }

  // 편집 경로는 로그인 전까지 계획 내용을 아예 그리지 않는다.
  if (canEdit && !session?.authed) {
    if (!session) return <div className="shell"><div className="panel muted">확인 중…</div></div>
    return (
      <AdminLogin
        authPath={authPath}
        configured={session.configured}
        expired={expired}
        maintain={canMaintain}
        onSuccess={() => {
          setExpired(false)
          setSession({ configured: true, authed: true })
        }}
      />
    )
  }

  // 어떤 화면(로딩·오류 포함)에서도 날짜를 바꿀 수 있도록 최상단에 고정한다.
  const datePicker = (
    <DatePicker date={date} dates={dates} onChange={changeDate} />
  )

  if (error) {
    return (
      <div className="shell">
        {datePicker}
        <div className="panel error-panel">
          <h2>문제가 발생했습니다</h2>
          <p>{error}</p>
          <p className="muted">
            개발 서버가 static-schedule 폴더에서 실행 중인지, 선택한 날짜의 plan-YYMMDD.md 파일이 있는지 확인해 주세요.
          </p>
        </div>
      </div>
    )
  }

  if (!plan || !stats) {
    return (
      <div className="shell">
        {datePicker}
        <div className="panel muted">
          {date ? `plan-${date}.md` : '계획 파일'} 불러오는 중…
        </div>
      </div>
    )
  }

  const goToOwner = (owner) => {
    setOwnerFilter(owner)
    setTab('tasks')
    window.location.hash = 'tasks'
  }

  return (
    <div className="shell">
      {datePicker}

      <header className="top">
        <div>
          <h1>{plan.title}</h1>
          <p className="muted">
            {plan.period} · {plan.unit} · 최종 수정 {plan.updatedAt}
          </p>
        </div>
        {canEdit ? (
          <div className="head-right">
            <div className={`save-badge ${save.state}`}>
              {save.state === 'idle' ? `plan-${date}.md 연결됨` : save.message}
            </div>
            {canMaintain && (
              <VersionButton date={date} dates={dates} busy={save.state === 'saving'} onClick={createVersion} />
            )}
            <button className="ghost" onClick={logout} title="편집 화면에서 나갑니다. 다시 들어오려면 비밀번호가 필요합니다.">
              로그아웃
            </button>
          </div>
        ) : (
          <div className="save-badge readonly" title="이 주소에서는 값을 바꿀 수 없습니다. 수정은 편집 화면에서 합니다.">
            읽기 전용 · plan-{date}.md
          </div>
        )}
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() => {
              setTab(t.key)
              window.location.hash = t.key
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'dashboard' && <Dashboard plan={plan} stats={stats} onSelectOwner={goToOwner} />}
      {tab === 'weeks' && <WeekView plan={plan} stats={stats} />}
      {tab === 'screens' && <ScreenList plan={plan} />}
      {tab === 'tasks' && (
        <TaskTable
          plan={plan}
          ownerFilter={ownerFilter}
          setOwnerFilter={setOwnerFilter}
          onUpdate={updateTask}
          onUpdateMany={updateMany}
          onAdd={addTask}
          onDelete={deleteTask}
          onReplace={replaceTask}
          onRelease={addRelease}
          onSaveRoster={(people, renames) => saveSettings((prev) => applyRoster(prev, people, renames))}
          onSaveWeeks={(weeks) => saveSettings((prev) => applyWeeks(prev, weeks))}
          onSaveLabels={(labels, title) => saveSettings((prev) => applyTitle(applyLabels(prev, labels), title))}
          maintain={canMaintain}
          readOnly={!canEdit}
        />
      )}
    </div>
  )
}

// 한 행에 수정 내용을 적용한다. 상태·진행률이 바뀌어 퍼블/검수 완료에 도달하면 그 시각을 남긴다.
function applyTaskPatch(task, patch, changed, at) {
  const merged = { ...task, ...patch }
  const synced = changed ? syncStatusProgress(merged, changed) : merged
  return stampCompletion(task, synced, at)
}

// 최신 파일을 보고 있고 오늘 버전이 아직 없을 때만 누를 수 있다. 막힌 이유는 툴팁으로 알려 준다.
function VersionButton({ date, dates, busy, onClick }) {
  const today = todayYYMMDD()
  const reason =
    date !== dates[0]
      ? '최신 plan 파일을 보고 있을 때만 새 버전을 만들 수 있습니다.'
      : dates.includes(today)
        ? `plan-${today}.md 가 이미 있습니다.`
        : ''
  return (
    <button
      type="button"
      className="version-btn"
      onClick={onClick}
      disabled={Boolean(reason) || busy}
      title={reason || `plan-${date}.md 를 그대로 복제해 plan-${today}.md 를 만들고, 이후 편집은 새 버전에 저장합니다.`}
    >
      버전 업데이트
    </button>
  )
}

// 최상단 날짜 선택 줄. 고른 날짜의 plan-YYMMDD.md를 읽고, 수정도 그 파일에 저장된다.
function DatePicker({ date, dates, onChange }) {
  const list = dates.length > 0 ? dates : date ? [date] : []
  const index = list.indexOf(date)
  const move = (step) => {
    const next = list[index + step]
    if (next) onChange(next)
  }

  return (
    <div className="date-bar">
      <label className="date-field">
        <span>계획 날짜</span>
        <select value={date} onChange={(e) => onChange(e.target.value)} disabled={list.length === 0}>
          {list.length === 0 && <option value="">불러오는 중…</option>}
          {list.map((d, i) => (
            <option key={d} value={d}>
              {dateLabel(d)}
              {i === 0 ? ' (최신)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="date-nav">
        {/* 목록이 최신순이라 이전 날짜는 뒤(+1), 다음 날짜는 앞(-1) */}
        <button className="ghost" onClick={() => move(1)} disabled={index < 0 || index >= list.length - 1}>
          ← 이전
        </button>
        <button className="ghost" onClick={() => move(-1)} disabled={index <= 0}>
          다음 →
        </button>
      </div>
      <span className="muted small">
        {date
          ? canEdit
            ? `plan-${date}.md 를 보고 있습니다. 수정 사항도 이 파일에 저장됩니다.`
            : `plan-${date}.md 를 보고 있습니다. 읽기 전용 화면이라 수정은 되지 않습니다.`
          : ''}
        {list.length > 1 ? ` · 총 ${list.length}개 버전` : ''}
      </span>
    </div>
  )
}

function buildStats(plan) {
  const done = (t) => (t.effort * t.progress) / 100
  const sum = (list, fn) => list.reduce((acc, item) => acc + fn(item), 0)

  const totalEffort = sum(plan.tasks, (t) => t.effort)
  const doneEffort = sum(plan.tasks, done)

  const group = (keyFn, keys) => {
    const map = new Map(keys.map((k) => [k, []]))
    for (const task of plan.tasks) {
      const key = keyFn(task)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(task)
    }
    return [...map.entries()].map(([key, tasks]) => {
      const effort = sum(tasks, (t) => t.effort)
      const qaTasks = plan.tasks.filter((t) => t.qa === key)
      return {
        key,
        tasks,
        count: tasks.length,
        effort,
        doneEffort: sum(tasks, done),
        progress: effort ? Math.round((sum(tasks, done) / effort) * 100) : 0,
        qaCount: qaTasks.length,
        qaEffort: sum(qaTasks, (t) => t.effort),
        counts: {
          대기: tasks.filter((t) => t.status === '대기').length,
          퍼블: tasks.filter((t) => t.status === '퍼블').length,
          검수: tasks.filter((t) => t.status === '검수').length,
        },
      }
    })
  }

  // 퍼블담당 기준 그룹 (검수 배정은 각 카드에 별도 표시)
  const byOwner = group((t) => t.pub || '미배정', [...plan.members])
  const byCategory = group(
    (t) => t.category,
    plan.weeklyLoad.map((row) => row.category),
  )

  const now = new Date()
  now.setHours(0, 0, 0, 0)
  let currentWeek = -1
  plan.weeks.forEach((week, index) => {
    const start = new Date(`${week.start}T00:00:00`)
    const end = new Date(`${week.end}T23:59:59`)
    if (now >= start && now <= end) currentWeek = index
  })
  if (currentWeek === -1) {
    const upcoming = plan.weeks.findIndex((w) => now < new Date(`${w.start}T00:00:00`))
    currentWeek = upcoming
  }

  return {
    totalEffort,
    doneEffort,
    progress: totalEffort ? Math.round((doneEffort / totalEffort) * 100) : 0,
    unassignedEffort: sum(
      plan.tasks.filter((t) => !t.pub),
      (t) => t.effort,
    ),
    unassignedCount: plan.tasks.filter((t) => !t.pub).length,
    qaUnassignedCount: plan.tasks.filter((t) => !t.qa).length,
    stageCounts: {
      대기: plan.tasks.filter((t) => t.status === '대기').length,
      퍼블: plan.tasks.filter((t) => t.status === '퍼블').length,
      검수: plan.tasks.filter((t) => t.status === '검수').length,
    },
    // 상태 + 진행률을 함께 해석한 진행 상황별 건수
    phaseCounts: plan.tasks.reduce(
      (acc, task) => {
        const key = phaseKey(task)
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      },
      { wait: 0, 'pub-doing': 0, 'pub-done': 0, 'qa-wait': 0, 'qa-doing': 0, 'qa-done': 0 },
    ),
    byOwner,
    byCategory,
    currentWeek,
  }
}

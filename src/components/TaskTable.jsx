import { useMemo, useRef, useState } from 'react'
import {
  PROGRESS_STEPS,
  STATUSES,
  completionAction,
  phaseKey,
  releasesByTask,
  releasesOf,
  screenIaPath,
  screensForTask,
  statusLabel,
  taskSearchText,
  taskPhase,
} from '../lib/planMd.js'
import { ownerColor } from './ui.jsx'
import { ScreenChips } from './ScreenList.jsx'
import { LabelEditor, RosterEditor, ScheduleEditor } from './MaintainEditors.jsx'


// 상단 전체 흐름 안내. 단계 이름은 plan의 표시 설정(상태 이름)을 따른다.
const flowSteps = (labels) => {
  const s = (status) => statusLabel(status, labels)
  return [
    { phase: 'wait', title: '착수 전', desc: `상태 ${s('대기')} · 진행률 0%` },
    { phase: 'pub-doing', title: `${s('퍼블')} 진행중`, desc: `상태 ${s('퍼블')} · 진행률 25%` },
    { phase: 'pub-done', title: `${s('퍼블')} 완료 · ${s('검수')} 대기`, desc: `상태 ${s('퍼블')} · 진행률 50%` },
    { phase: 'qa-doing', title: `${s('검수')} 진행중`, desc: `상태 ${s('검수')} · 진행률 75%` },
    { phase: 'qa-done', title: `${s('검수')} 완료`, desc: `상태 ${s('검수')} · 진행률 100%` },
  ]
}

function FlowGuide({ readOnly, labels }) {
  const steps = flowSteps(labels)
  const pub = statusLabel('퍼블', labels)
  const qa = statusLabel('검수', labels)
  return (
    <section className="panel guide">
      <div className="panel-head">
        <h2>진행 상황 읽는 법 · 전체 흐름</h2>
        <span className="muted small">
          진행 상황은 <strong>상태</strong>와 <strong>진행률</strong>을 함께 해석한 값입니다
        </span>
      </div>

      <ol className="flow">
        {steps.map((step, index) => (
          <li key={step.phase} className="flow-step">
            <span className={`phase-chip phase-${step.phase}`}>{step.title}</span>
            <span className="muted small">{step.desc}</span>
            {index < steps.length - 1 && <span className="flow-arrow" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>

      <ul className="guide-notes">
        <li>
          <strong>완료 버튼</strong> — 상태가 <em>{pub}</em>일 때 누르면 진행률이 <strong>50%</strong>({pub} 완료 · {qa}
          대기)가 되고, 상태가 <em>{qa}</em>일 때 누르면 <strong>100%</strong>({qa} 완료)가 됩니다.
        </li>
        <li>
          <strong>{pub} → {qa} 넘기기</strong> — {pub} 완료(50%) 후 {qa} 담당자가 <em>상태</em>를 <em>{qa}</em>로
          바꾸면 {qa} 진행중이 됩니다.
        </li>
        <li>
          <strong>완료 시각 기록</strong> — 퍼블 완료·검수 완료가 된 시점이 계획 파일에 자동으로 남습니다. 진행 상황
          칸 아래 작은 글씨가 그 시각입니다.
        </li>
        <li>
          <strong>릴리즈(개발 이관)</strong> — 행을 클릭해 펼치면 <em>릴리즈 완료</em> 버튼이 있습니다. 누를 때마다 그
          시각이 이력으로 쌓이고, <em>릴리즈</em> 컬럼에는 마지막 릴리즈 날짜·시간이 표시됩니다. 한 번 쌓인 기록은
          화면에서 지울 수 없습니다.
        </li>
        <li>
          <strong>자동 연동</strong> — 상태를 바꾸면 진행률이 그 단계 값({pub} 25% / {qa} 75%)으로, 진행률을 바꾸면
          상태가 그에 맞게 자동 조정됩니다. 두 값이 서로 어긋날 일이 없습니다.
        </li>
        <li>
          {readOnly ? (
            <>
              <strong>읽기 전용</strong> — 이 주소에서는 값을 바꿀 수 없습니다. 담당자·상태·진행률은 현재 값만
              보여 주고, 완료·릴리즈 버튼과 일괄 변경은 나오지 않습니다. 편집은 별도 관리자 화면(
              <code>/admin</code>)에서 합니다. 다른 사람이 그쪽에서 저장한 내용은 몇 초 안에 이 화면에도 반영됩니다.
            </>
          ) : (
            <>
              <strong>저장</strong> — 모든 변경은 화면 맨 위에서 고른 <strong>계획 날짜</strong>의
              파일(plan-YYMMDD.md)에 즉시 저장되고, 다른 사람 화면에도 몇 초 안에 반영됩니다.
            </>
          )}
        </li>
      </ul>
    </section>
  )
}

const SCHEDULE_KEY = 'static-schedule:show-schedule'

export default function TaskTable({
  plan,
  ownerFilter,
  setOwnerFilter,
  onUpdate,
  onUpdateMany,
  onAdd,
  onDelete,
  onReplace,
  onRelease,
  onSaveRoster,
  onSaveWeeks,
  onSaveLabels,
  maintain = false,
  // 읽기 전용(기본 경로)에서는 수정 수단을 아예 그리지 않는다. 잠긴 컨트롤을
  // 남겨 두면 "왜 안 바뀌지" 로 이어져서, 값만 글자로 보여 주는 편이 낫다.
  readOnly = false,
}) {
  const [category, setCategory] = useState('전체')
  const [status, setStatus] = useState('전체')
  const [backend, setBackend] = useState('전체')
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState(() => new Set())
  const [memoDrawer, setMemoDrawer] = useState(null)
  const [taskEditor, setTaskEditor] = useState(null)
  // 유지보수 설정 drawer: 'roster' | 'schedule' | 'labels'
  const [settingsEditor, setSettingsEditor] = useState(null)
  const settingsReturnFocus = useRef(null)
  const labels = plan.labels
  const memoReturnFocus = useRef(null)
  const taskEditorReturnFocus = useRef(null)
  // 펼쳐 둔 행(중분류). 행을 클릭하면 그 중분류의 화면번호가 아래에 붙는다.
  const [expanded, setExpanded] = useState(() => new Set())
  // 계획일정 컬럼은 기본으로 접어 둔다. 펼친 상태는 브라우저에 기억시킨다.
  const [showSchedule, setShowSchedule] = useState(
    () => window.localStorage.getItem(SCHEDULE_KEY) === '1',
  )

  const toggleSchedule = () =>
    setShowSchedule((prev) => {
      window.localStorage.setItem(SCHEDULE_KEY, prev ? '0' : '1')
      return !prev
    })

  // 작업 ID별 릴리즈 이력(최신순). 표에는 맨 앞(마지막 릴리즈)만 쓴다.
  const releaseMap = useMemo(() => releasesByTask(plan), [plan.releases])

  const categories = useMemo(() => [...new Set(plan.tasks.map((t) => t.category))], [plan.tasks])
  const backends = useMemo(
    () => [...new Set(plan.tasks.map((t) => t.backend).filter(Boolean))],
    [plan.tasks],
  )

  // 검색 대상은 선택한 plan 파일의 작업·IA·화면 목록에서만 만든다.
  const haystacks = useMemo(() => {
    const map = new Map()
    for (const task of plan.tasks) {
      map.set(task.rowIndex, taskSearchText(plan, task))
    }
    return map
  }, [plan])

  // 검색어가 화면번호에 걸린 행 → 맞은 화면번호들. 이런 행은 자동으로 펼쳐서
  // 어떤 화면 때문에 걸렸는지 바로 보이게 한다.
  const screenHits = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map()
    if (!q) return map
    for (const task of plan.tasks) {
      const hit = screensForTask(plan, task)
        .filter((screen) =>
          `${screen.id} ${screen.title} ${screenIaPath(plan, screen)}`.toLowerCase().includes(q),
        )
        .map((s) => s.id)
      if (hit.length > 0) map.set(task.rowIndex, hit)
    }
    return map
  }, [plan, query])

  const filtered = plan.tasks.filter((task) => {
    if (ownerFilter === '미배정') {
      if (task.pub && task.qa) return false
    } else if (ownerFilter !== '전체' && task.pub !== ownerFilter && task.qa !== ownerFilter) {
      return false
    }
    if (category !== '전체' && task.category !== category) return false
    if (status !== '전체' && task.status !== status) return false
    if (backend !== '전체' && task.backend !== backend) return false
    const q = query.trim().toLowerCase()
    if (q && !(haystacks.get(task.rowIndex) ?? '').includes(q)) return false
    return true
  })

  // 착수일(시작 계획일)이 빠른 작업이 위로. 같으면 마감일이 빠른 쪽, 그것도 같으면 파일 순서.
  // 착수일이 없는(옛 파일) 작업은 파일 순서 그대로 뒤에 붙는다.
  const rows = [...filtered].sort((a, b) => {
    if (!a.start && !b.start) return a.rowIndex - b.rowIndex
    if (!a.start) return 1
    if (!b.start) return -1
    return (
      a.start.localeCompare(b.start) ||
      (a.end ?? '').localeCompare(b.end ?? '') ||
      a.rowIndex - b.rowIndex
    )
  })

  const effort = rows.reduce((a, t) => a + t.effort, 0)
  const doneEffort = rows.reduce((a, t) => a + (t.effort * t.progress) / 100, 0)

  // 필터된 행의 진행 상황별 건수
  const phaseCounts = rows.reduce(
    (acc, t) => {
      const key = phaseKey(t)
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    },
    { wait: 0, 'pub-doing': 0, 'pub-done': 0, 'qa-wait': 0, 'qa-doing': 0, 'qa-done': 0 },
  )

  // 읽기 전용에서 빠지는 컬럼: 체크박스, 완료 버튼. 펼침 행의 colSpan 계산에 쓴다.
  const colCount = (readOnly ? 11 : 13) + (showSchedule ? 1 : 0) + (maintain ? 1 : 0)

  // 선택·수정 대상은 ID가 아니라 rowIndex로 가리킨다. md에서 ID가 겹쳐도 안전하다.
  const selectedRows = rows.filter((t) => checked.has(t.rowIndex)).map((t) => t.rowIndex)
  const allChecked = rows.length > 0 && selectedRows.length === rows.length

  const toggle = (rowIndex) =>
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex)
      return next
    })

  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(rows.map((t) => t.rowIndex)))

  const toggleExpand = (rowIndex) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex)
      return next
    })

  // 셀 안의 담당자/상태 select, 체크박스, 완료 버튼을 조작할 때는 행이 접히거나 펴지면 안 된다.
  const rowClick = (rowIndex) => (e) => {
    if (e.target.closest('select, input, button, a, option')) return
    toggleExpand(rowIndex)
  }

  const allExpanded = rows.length > 0 && rows.every((t) => expanded.has(t.rowIndex))
  const toggleExpandAll = () =>
    setExpanded(allExpanded ? new Set() : new Set(rows.map((t) => t.rowIndex)))

  const bulk = (patch, changed) => {
    onUpdateMany(selectedRows, patch, changed)
    setChecked(new Set())
  }

  const selectedEffort = rows
    .filter((t) => checked.has(t.rowIndex))
    .reduce((a, t) => a + t.effort, 0)

  const memoTask = memoDrawer
    ? plan.tasks.find((task) => task.rowIndex === memoDrawer.rowIndex)
    : null

  const openMemo = (task, trigger, mode) => {
    memoReturnFocus.current = trigger
    setMemoDrawer({ rowIndex: task.rowIndex, value: task.memo ?? '', mode })
  }

  const closeMemo = () => {
    setMemoDrawer(null)
    requestAnimationFrame(() => memoReturnFocus.current?.focus())
  }

  const saveMemo = () => {
    if (!memoDrawer || memoDrawer.mode !== 'edit') return
    onUpdate(memoDrawer.rowIndex, { memo: memoDrawer.value })
    closeMemo()
  }

  const deleteMemo = () => {
    if (!memoDrawer || !memoTask?.memo) return
    if (!window.confirm(`'${memoTask.task}' 메모를 삭제할까요?\n삭제한 메모는 복구할 수 없습니다.`)) return

    const triggerRow = memoReturnFocus.current?.closest('tr')
    const taskRow = triggerRow?.matches('.task-row') ? triggerRow : triggerRow?.previousElementSibling
    memoReturnFocus.current = taskRow?.querySelector('.col-task')
    onUpdate(memoDrawer.rowIndex, { memo: '' })
    closeMemo()
  }

  const openTaskEditor = (mode, task, trigger) => {
    taskEditorReturnFocus.current = trigger
    setTaskEditor({ mode, task })
  }

  const closeTaskEditor = () => {
    setTaskEditor(null)
    requestAnimationFrame(() => taskEditorReturnFocus.current?.focus())
  }

  const openSettings = (kind) => (event) => {
    settingsReturnFocus.current = event.currentTarget
    setSettingsEditor(kind)
  }

  const closeSettings = () => {
    setSettingsEditor(null)
    requestAnimationFrame(() => settingsReturnFocus.current?.focus())
  }

  return (
    <div className="stack">
      <FlowGuide readOnly={readOnly} labels={labels} />
      <section className="panel">
        {plan.catalogIssues.length > 0 && (
          <div className="error-panel catalog-issues" role="alert">
            <strong>plan 파일 IA·화면 연결 확인 필요</strong>
            <ul>
              {plan.catalogIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        )}
        <div className="filters">
          {maintain && (
            <button
              type="button"
              className="maintain-add"
              onClick={(event) => openTaskEditor('add', newTask(plan.tasks), event.currentTarget)}
            >
              작업 추가
            </button>
          )}
          {maintain && (
            <div className="maintain-settings" role="group" aria-label="plan 기준 정보 관리">
              <button type="button" className="ghost" onClick={openSettings('roster')}>
                담당자 관리
              </button>
              <button type="button" className="ghost" onClick={openSettings('schedule')}>
                계획 일정 관리
              </button>
              <button type="button" className="ghost" onClick={openSettings('labels')}>
                표시 이름 관리
              </button>
            </div>
          )}
          <label>
            담당자({labels.퍼블담당}·{labels.검수담당})
            <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option>전체</option>
              {plan.members.map((m) => (
                <option key={m}>{m}</option>
              ))}
              <option>미배정</option>
            </select>
          </label>
          <label>
            {labels.백엔드}
            <select value={backend} onChange={(e) => setBackend(e.target.value)}>
              <option>전체</option>
              {backends.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label>
            {labels.대분류}
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>전체</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            상태
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>전체</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(s, labels)}</option>
              ))}
            </select>
          </label>
          <label className="grow">
            검색
            <input
              value={query}
              placeholder="화면명 / ID / 화면번호(UI-ESG-*) 검색"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            className={showSchedule ? 'ghost on' : 'ghost'}
            onClick={toggleSchedule}
            title="WBS 시작·종료 계획일 컬럼을 보이거나 숨깁니다. 숨겨도 정렬 기준(착수일 빠른 순)은 그대로입니다."
            aria-expanded={showSchedule}
          >
            계획일정(개발) {showSchedule ? '숨기기' : '보기'}
          </button>
          <button
            className={allExpanded ? 'ghost on' : 'ghost'}
            onClick={toggleExpandAll}
            disabled={rows.length === 0}
            title="각 중분류에 속한 화면번호(UI-ESG-*)를 모두 펼치거나 접습니다. 행을 하나씩 클릭해도 됩니다."
            aria-expanded={allExpanded}
          >
            화면번호 {allExpanded ? '모두 접기' : '모두 펼치기'}
          </button>
          <button
            className="ghost"
            onClick={() => {
              setOwnerFilter('전체')
              setCategory('전체')
              setStatus('전체')
              setBackend('전체')
              setQuery('')
            }}
          >
            필터 초기화
          </button>
        </div>

        {!readOnly && selectedRows.length > 0 ? (
          <div className="bulk-bar">
            <strong>{selectedRows.length}건 선택</strong>
            <span className="muted small">({selectedEffort}건)</span>
            <span className="bulk-sep" />
            <label className="bulk-field">
              {labels.퍼블담당} 일괄 지정
              <select
                value=""
                onChange={(e) =>
                  e.target.value && bulk({ pub: e.target.value === '__none' ? '' : e.target.value })
                }
              >
                <option value="">선택…</option>
                {plan.pubMembers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__none">미배정으로 되돌리기</option>
              </select>
            </label>
            <label className="bulk-field">
              {labels.검수담당} 일괄 지정
              <select
                value=""
                onChange={(e) =>
                  e.target.value && bulk({ qa: e.target.value === '__none' ? '' : e.target.value })
                }
              >
                <option value="">선택…</option>
                {plan.qaMembers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__none">미배정으로 되돌리기</option>
              </select>
            </label>
            <label className="bulk-field">
              상태 일괄 변경
              <select value="" onChange={(e) => e.target.value && bulk({ status: e.target.value }, 'status')}>
                <option value="">선택…</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{statusLabel(s, labels)}</option>
                ))}
              </select>
            </label>
            <button className="ghost" onClick={() => setChecked(new Set())}>
              선택 해제
            </button>
          </div>
        ) : (
          <div className="filter-summary">
            작업 {rows.length}건 · 화면 {effort}건 · 진행 {effort ? Math.round((doneEffort / effort) * 100) : 0}%
            {' · '}퍼블 완료 {phaseCounts['pub-done']}건 · 검수 진행중 {phaseCounts['qa-doing']}건 · 검수 완료{' '}
            {phaseCounts['qa-done']}건
            {' · '}
            {readOnly
              ? '읽기 전용 화면입니다. 값은 편집 화면(/admin)에서 바꿉니다.'
              : '칸을 바꾸거나 완료 버튼을 누르면 바로 선택한 날짜의 계획 파일에 저장됩니다.'}
          </div>
        )}

        {maintain && (
          <p className="sheet-scroll-hint">
            표를 좌우로 밀어 행 끝의 수정·삭제를 사용할 수 있습니다.
          </p>
        )}
        <div className="sheet-wrap">
          <table className="sheet">
            <thead>
              <tr>
                {!readOnly && (
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="전체 선택"
                    />
                  </th>
                )}
                <th className="col-id">No.</th>
                <th className="col-cat">{labels.대분류}</th>
                <th className="col-task">{labels.중분류}</th>
                <th className="col-num">공수</th>
                {showSchedule && (
                  <th className="col-date">계획일정(개발)</th>
                )}
                <th className="col-be">{labels.백엔드}</th>
                <th className="col-owner">{labels.퍼블담당}</th>
                <th className="col-owner">{labels.검수담당}</th>
                <th className="col-status">상태</th>
                <th className="col-progress">진행률</th>
                <th className="col-phase">진행 상황</th>
                <th className="col-release">릴리즈</th>
                {!readOnly && <th className="col-done">완료</th>}
                {maintain && <th className="col-maintain">관리</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((task, index) => {
                const isOpen = expanded.has(task.rowIndex) || screenHits.has(task.rowIndex)
                const history = releasesOf(releaseMap, task)
                const lastRelease = history[0]
                return [
                <tr
                  key={task.rowIndex}
                  className={`task-row${task.pub ? '' : ' unassigned'}${checked.has(task.rowIndex) ? ' picked' : ''}${isOpen ? ' open' : ''}`}
                  onClick={rowClick(task.rowIndex)}
                >
                  {!readOnly && (
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={checked.has(task.rowIndex)}
                        onChange={() => toggle(task.rowIndex)}
                        aria-label={`${task.task} 선택`}
                      />
                    </td>
                  )}
                  <td
                    className="col-id muted"
                    title={task.id ? `계획 파일 ID ${task.id}` : ''}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={`memo-number${task.memo ? ' has-memo' : ''}`}
                      onClick={(event) => openMemo(task, event.currentTarget, 'view')}
                      disabled={!task.memo}
                      aria-label={
                        task.memo
                          ? `${seqId(index)}번 태스크 메모 보기`
                          : `${seqId(index)}번 태스크 메모 없음`
                      }
                      title={task.memo ? '작성된 태스크 메모를 봅니다.' : '작성된 메모가 없습니다.'}
                    >
                      {seqId(index)}
                    </button>
                  </td>
                  <td className="col-cat">{task.category}</td>
                  {/* 계획일정을 접어 뒀을 때도 마우스를 올리면 날짜를 볼 수 있다 */}
                  <td className="col-task strong" title={`계획일정 ${schedule(task)}`} tabIndex={-1}>
                    <span className={isOpen ? 'caret open' : 'caret'} aria-hidden="true" />
                    {task.task}
                  </td>
                  <td className="col-num">{task.effort}</td>
                  {showSchedule && <td className="col-date muted">{schedule(task)}</td>}
                  <td className="col-be muted">{task.backend || '—'}</td>
                  {readOnly ? (
                    <ValueCells task={task} plan={plan} />
                  ) : (
                    <EditCells task={task} plan={plan} onUpdate={onUpdate} />
                  )}
                  <td className="col-phase">
                    <span
                      className={`phase-chip phase-${phaseKey(task)}`}
                      title={`상태 ${statusLabel(task.status, labels)} + 진행률 ${task.progress}% → ${taskPhase(task, labels).label}`}
                    >
                      {taskPhase(task, labels).label}
                    </span>
                    <DoneStamps task={task} />
                  </td>
                  <td className="col-release">
                    {lastRelease ? (
                      <span
                        className="release-stamp"
                        title={`마지막 릴리즈 ${lastRelease.at} · 총 ${history.length}회`}
                      >
                        {shortStamp(lastRelease.at)}
                        {history.length > 1 && <span className="release-count">{history.length}회</span>}
                      </span>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  {!readOnly && (
                    <td className="col-done">
                      <CompleteButton task={task} labels={labels} onUpdate={onUpdate} />
                    </td>
                  )}
                  {maintain && (
                    <td className="col-maintain">
                      <div className="maintain-actions">
                        <button
                          type="button"
                          className="maintain-edit"
                          onClick={(event) => openTaskEditor('edit', task, event.currentTarget)}
                          aria-label={`${task.task} 행 수정`}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="maintain-delete"
                          onClick={() => {
                            const screenCount = screensForTask(plan, task).length
                            if (window.confirm(
                              `'${task.task}' 작업 행을 삭제할까요?\n` +
                              `연결 화면 ${screenCount}건과 릴리즈 이력도 함께 삭제됩니다.`,
                            )) {
                              onDelete(task.rowIndex)
                            }
                          }}
                          aria-label={`${task.task} 행 삭제`}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  )}
                </tr>,
                isOpen && (
                  <tr key={`${task.rowIndex}--screens`} className="task-screens-row">
                    <td colSpan={colCount}>
                      <TaskDetail
                        plan={plan}
                        task={task}
                        history={history}
                        onRelease={onRelease}
                        onMemo={openMemo}
                        hits={screenHits.get(task.rowIndex)}
                        readOnly={readOnly}
                      />
                    </td>
                  </tr>
                ),
                ]
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="muted" style={{ padding: 24 }}>
                    조건에 맞는 작업이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {memoDrawer && memoTask && (
        <MemoDrawer
          task={memoTask}
          mode={memoDrawer.mode}
          value={memoDrawer.value}
          onChange={(value) => setMemoDrawer((prev) => ({ ...prev, value }))}
          onClose={closeMemo}
          onSave={saveMemo}
          onDelete={readOnly ? undefined : deleteMemo}
        />
      )}
      {taskEditor && (
        <TaskEditor
          key={`${taskEditor.mode}-${taskEditor.task.rowIndex ?? 'new'}`}
          plan={plan}
          mode={taskEditor.mode}
          task={taskEditor.task}
          onClose={closeTaskEditor}
          onSubmit={(task, screenIds) => {
            if (taskEditor.mode === 'add') onAdd(task, screenIds)
            else onReplace(taskEditor.task.rowIndex, task, screenIds)
            closeTaskEditor()
          }}
        />
      )}
      {settingsEditor === 'roster' && (
        <RosterEditor plan={plan} onClose={closeSettings} onSubmit={onSaveRoster} />
      )}
      {settingsEditor === 'schedule' && (
        <ScheduleEditor plan={plan} onClose={closeSettings} onSubmit={onSaveWeeks} />
      )}
      {settingsEditor === 'labels' && (
        <LabelEditor plan={plan} onClose={closeSettings} onSubmit={onSaveLabels} />
      )}
    </div>
  )
}

// 명단에 없는 값이 이미 배정돼 있어도 선택 상자에서 사라지지 않게 한다.
const withCurrent = (list, value) => (value && !list.includes(value) ? [...list, value] : list)

function newTask(tasks) {
  const number =
    tasks.reduce((max, task) => {
      const match = /^T(\d+)$/.exec(task.id ?? '')
      return match ? Math.max(max, Number(match[1])) : max
    }, 0) + 1
  const id = `T${String(number).padStart(2, '0')}`
  return {
    id,
    workKey: `WORK-${id}`,
    iaKey: '',
    category: '',
    task: '',
    effort: 0,
    start: '',
    end: '',
    backend: '',
    pub: '',
    qa: '',
    status: '대기',
    progress: 0,
    pubDoneAt: '',
    qaDoneAt: '',
    memo: '',
    note: '',
  }
}

function TaskEditor({ plan, mode, task, onClose, onSubmit }) {
  const [draft, setDraft] = useState(() => ({ ...task }))
  const [screenIds, setScreenIds] = useState(() =>
    screensForTask(plan, task).map((screen) => screen.id).join(', '),
  )
  const [screenError, setScreenError] = useState('')
  const labels = plan.labels
  const screenCount = new Set(
    screenIds
      .split(/[\s,]+/)
      .map((id) => id.trim().toUpperCase())
      .filter(Boolean),
  ).size
  const change = (key) => (event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))

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
      <div
        className="memo-drawer task-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
      >
        <div className="memo-drawer-head">
          <div>
            <p className="muted small">plan 작업 목록</p>
            <h2 id="task-editor-title">작업 {mode === 'add' ? '추가' : '수정'}</h2>
          </div>
          <button type="button" className="memo-close" onClick={onClose} aria-label="작업 편집 닫기">
            ×
          </button>
        </div>
        <form
          className="task-editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            setScreenError('')
            try {
              onSubmit(draft, screenIds)
            } catch (error) {
              setScreenError(String(error?.message ?? error))
            }
          }}
        >
          <div className="task-editor-grid">
            <label>
              ID
              <input value={draft.id} onChange={change('id')} required autoFocus />
            </label>
            <label>
              작업키
              <input value={draft.workKey} onChange={change('workKey')} required />
            </label>
            <label>
              IA키
              <select value={draft.iaKey} onChange={change('iaKey')} required>
                <option value="">선택…</option>
                {plan.ia.map((node) => (
                  <option key={node.key} value={node.key}>{node.name}</option>
                ))}
              </select>
            </label>
            <label className="task-editor-wide">
              화면번호 (UI-ESG-*)
              <input
                value={screenIds}
                onChange={(event) => {
                  setScreenIds(event.target.value)
                  setScreenError('')
                }}
                placeholder="UI-ESG-1000M, UI-ESG-1001P"
                aria-describedby="task-screen-help"
              />
            </label>
            <label>
              {labels.대분류}
              <input value={draft.category} onChange={change('category')} required />
            </label>
            <label className="task-editor-wide">
              {labels.중분류}
              <input value={draft.task} onChange={change('task')} required />
            </label>
            <label>
              공수(자동)
              <output className="task-editor-output" aria-live="polite">
                화면 {screenCount}건
              </output>
            </label>
            <label>
              시작
              <input type="date" value={draft.start} onChange={change('start')} />
            </label>
            <label>
              종료
              <input type="date" value={draft.end} onChange={change('end')} />
            </label>
            <label>
              {labels.백엔드}
              <select value={draft.backend} onChange={change('backend')}>
                <option value="">미배정</option>
                {withCurrent(plan.backendMembers, draft.backend).map((member) => <option key={member}>{member}</option>)}
              </select>
            </label>
            <label>
              {labels.퍼블담당}
              <select value={draft.pub} onChange={change('pub')}>
                <option value="">미배정</option>
                {withCurrent(plan.pubMembers, draft.pub).map((member) => <option key={member}>{member}</option>)}
              </select>
            </label>
            <label>
              {labels.검수담당}
              <select value={draft.qa} onChange={change('qa')}>
                <option value="">미배정</option>
                {withCurrent(plan.qaMembers, draft.qa).map((member) => <option key={member}>{member}</option>)}
              </select>
            </label>
          </div>
          <p id="task-screen-help" className="muted small">
            여러 개는 쉼표나 공백으로 구분합니다. 새 화면은 선택한 IA키와 작업키에 연결되고, 공수는 연결된 화면 수로
            자동 계산됩니다.
          </p>
          {screenError && <p className="login-error" role="alert">{screenError}</p>}
          <p className="muted small">
            저장하면 선택한 plan 파일의 작업 목록 표에 즉시 반영됩니다.
          </p>
          <div className="memo-drawer-actions">
            <button type="button" className="ghost" onClick={onClose}>취소</button>
            <button type="submit" className="memo-save">{mode === 'add' ? '작업 추가' : '변경 저장'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// 퍼블담당·검수담당·상태·진행률 네 칸. 편집 화면에서는 셀 안의 컨트롤로,
// 읽기 전용 화면에서는 같은 자리에 값만 글자로 나온다(컬럼 수는 양쪽이 같다).
function EditCells({ task, plan, onUpdate }) {
  const members = plan.members
  return (
    <>
      <td className="cell-edit">
        <select
          className="cell-select owner-select"
          value={task.pub}
          style={{ color: task.pub ? ownerColor(task.pub, members) : 'var(--muted)' }}
          onChange={(e) => onUpdate(task.rowIndex, { pub: e.target.value })}
        >
          <option value="">미배정</option>
          {withCurrent(plan.pubMembers, task.pub).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="cell-edit">
        <select
          className="cell-select owner-select"
          value={task.qa}
          style={{ color: task.qa ? ownerColor(task.qa, members) : 'var(--muted)' }}
          onChange={(e) => onUpdate(task.rowIndex, { qa: e.target.value })}
        >
          <option value="">미배정</option>
          {withCurrent(plan.qaMembers, task.qa).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="cell-edit">
        <select
          className={`cell-select status-${task.status}`}
          value={task.status}
          onChange={(e) => onUpdate(task.rowIndex, { status: e.target.value }, 'status')}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s, plan.labels)}
            </option>
          ))}
        </select>
      </td>
      <td className="cell-edit">
        <div className="progress-cell">
          <div className="bar">
            <div className="bar-fill" style={{ width: `${task.progress}%` }} />
          </div>
          <select
            className="cell-select narrow"
            value={task.progress}
            onChange={(e) => onUpdate(task.rowIndex, { progress: Number(e.target.value) }, 'progress')}
          >
            {progressOptions(task.progress).map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </div>
      </td>
    </>
  )
}

function ValueCells({ task, plan }) {
  const members = plan.members
  const owner = (name) =>
    name ? (
      <span className="owner-value" style={{ color: ownerColor(name, members) }}>
        {name}
      </span>
    ) : (
      <span className="muted">미배정</span>
    )

  return (
    <>
      <td className="cell-static">{owner(task.pub)}</td>
      <td className="cell-static">{owner(task.qa)}</td>
      <td className="cell-static">
        <span className={`status-value status-${task.status}`}>{statusLabel(task.status, plan.labels)}</span>
      </td>
      <td className="cell-static">
        <div className="progress-cell">
          <div className="bar">
            <div className="bar-fill" style={{ width: `${task.progress}%` }} />
          </div>
          <span className="progress-value">{task.progress}%</span>
        </div>
      </td>
    </>
  )
}

// 행을 펼쳤을 때 나오는 영역: 계획 파일 ID + 릴리즈 기록 + 화면번호 목록.
// 표의 No. 는 화면 순번이라 계획 파일과 다를 수 있어, 문서에서 찾을 ID를 여기서 알려 준다.
function TaskDetail({ plan, task, history, onRelease, onMemo, hits, readOnly }) {
  return (
    <div className="task-detail">
      {task.id && (
        <p className="muted small doc-id">
          계획 파일 ID <strong className="mono">{task.id}</strong> · {task.category} › {task.task}
        </p>
      )}
      <ReleaseBox
        task={task}
        history={history}
        onRelease={onRelease}
        onMemo={onMemo}
        readOnly={readOnly}
      />
      <TaskScreens plan={plan} task={task} hits={hits} />
    </div>
  )
}

// 릴리즈(개발 이관) 기록. 여러 번 일어날 수 있어 누를 때마다 이력이 쌓인다.
// 읽기 전용에서는 쌓인 기록만 보이고 추가 버튼은 나오지 않는다.
function ReleaseBox({ task, history, onRelease, onMemo, readOnly }) {
  const last = history[0]

  return (
    <div className="release-box">
      <div className="release-head">
        <div>
          <strong>릴리즈 (개발 이관)</strong>
          <span className="muted small">
            {' · '}
            {last
              ? `마지막 릴리즈 ${last.at} · 총 ${history.length}회`
              : '아직 릴리즈 기록이 없습니다'}
          </span>
        </div>
        {!readOnly && (
          <div className="release-actions">
            <button
              type="button"
              className="memo-view-btn"
              onClick={(event) => onMemo(task, event.currentTarget, 'view')}
              disabled={!task.memo}
              title={task.memo ? '작성된 태스크 메모를 읽기 전용으로 봅니다.' : '작성된 메모가 없습니다.'}
              aria-haspopup="dialog"
            >
              메모 보기
            </button>
            <button
              type="button"
              className="memo-btn"
              onClick={(event) => onMemo(task, event.currentTarget, 'edit')}
              title={task.memo ? '작성한 태스크 메모를 열어 수정합니다.' : '이 태스크에 메모를 작성합니다.'}
              aria-haspopup="dialog"
            >
              {task.memo ? '메모 수정' : '메모 작성'}
            </button>
            <button
              type="button"
              className="release-btn"
              onClick={() => onRelease(task.rowIndex)}
              title="지금 시각으로 릴리즈 기록을 한 건 추가합니다. 다시 이관할 때마다 눌러 두면 이력이 쌓입니다."
            >
              릴리즈 완료
            </button>
          </div>
        )}
      </div>

      <p className="muted small release-progress">
        퍼블 완료 {task.pubDoneAt || '—'} · 검수 완료 {task.qaDoneAt || '—'}
      </p>

      {history.length > 0 && (
        <ol className="release-history">
          {history.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              <span className="mono">{entry.at}</span>
              {index === 0 && <span className="release-latest">최신</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function MemoDrawer({ task, mode, value, onChange, onClose, onSave, onDelete }) {
  const isView = mode === 'view'
  const isSaved = value === (task.memo ?? '')

  return (
    <div
      className="memo-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        if (event.key !== 'Tab') return

        const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), textarea:not(:disabled)')]
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
      <div
        className="memo-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memo-drawer-title"
      >
        <div className="memo-drawer-head">
          <div>
            <p className="muted small">{task.category}</p>
            <h2 id="memo-drawer-title">
              {task.task} 메모 {isView ? '보기' : task.memo ? '수정' : '작성'}
            </h2>
          </div>
          <button
            type="button"
            className="memo-close"
            onClick={onClose}
            aria-label="메모 닫기"
            autoFocus={isView}
          >
            ×
          </button>
        </div>

        {isView ? (
          <div className="memo-view">
            <p className="memo-view-label">태스크 메모</p>
            <div className="memo-view-content">{task.memo}</div>
            <div className="memo-drawer-actions">
              {onDelete && (
                <button type="button" className="memo-delete" onClick={onDelete}>
                  메모 삭제
                </button>
              )}
              <button type="button" className="ghost" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        ) : (
          <form
            className="memo-form"
            onSubmit={(event) => {
              event.preventDefault()
              onSave()
            }}
          >
            <label htmlFor="task-memo">태스크 메모</label>
            <textarea
              id="task-memo"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="이 태스크에서 공유할 내용이나 확인할 사항을 적어 주세요."
              aria-label="태스크 메모"
              autoFocus
            />
            <p className="muted small">줄바꿈을 포함해 선택한 계획 파일에 저장됩니다.</p>
            <div className="memo-drawer-actions">
              {task.memo && onDelete && (
                <button type="button" className="memo-delete" onClick={onDelete}>
                  메모 삭제
                </button>
              )}
              <button type="button" className="ghost" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="memo-save" disabled={isSaved}>
                저장
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// 행을 펼쳤을 때 선택한 plan 파일의 작업키에 연결된 화면 목록을 보여 준다.
function TaskScreens({ plan, task, hits }) {
  const screens = screensForTask(plan, task).map((screen) => ({
    ...screen,
    path: screenIaPath(plan, screen),
  }))

  if (screens.length === 0) {
    return (
      <div className="task-screens">
        <p className="muted small">
          plan 파일의 화면 목록에서 <strong>{task.category} › {task.task}</strong> 작업키에 연결된 화면이 없습니다.
        </p>
      </div>
    )
  }

  return (
    <div className="task-screens">
      <p className="muted small screens-head">
        <strong>{task.category} › {task.task}</strong> · 화면 {screens.length}건
        {screens.length !== task.effort && (
          <span className="tag-diff">계획 공수 {task.effort}건과 다름</span>
        )}
        {hits?.length > 0 && <span className="tag-hit">검색어와 맞는 화면 {hits.length}건</span>}
      </p>
      <ScreenChips screens={screens} hits={hits} />
    </div>
  )
}

// 화면에 보이는 순서대로 매기는 행 번호. 정렬·필터가 바뀌면 다시 매겨진다.
// 계획 파일의 ID(T01~)와 헷갈리지 않도록 T 접두어를 붙이지 않는다 —
// 화면의 "10번째 행"과 문서의 "T10"은 서로 다른 작업일 수 있다.
const seqId = (index) => String(index + 1)

// 08.03~08.07 형태. 시작/종료 컬럼이 없는 옛날 계획 파일이면 빈칸.
function schedule(task) {
  if (!task.start && !task.end) return '—'
  const day = (iso) => (iso ? iso.slice(5).replace('-', '.') : '?')
  return `${day(task.start)}~${day(task.end)}`
}

// "2026-08-07 14:32" → "08.07 14:32". 표 안에서는 연도를 빼서 폭을 줄인다.
function shortStamp(at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(at ?? '')
  return m ? `${m[2]}.${m[3]} ${m[4]}` : at || '—'
}

// 진행 상황 칸 아래에 붙는 완료 시각. 지금 단계에 해당하는 기록만 보여 준다.
function DoneStamps({ task }) {
  const key = phaseKey(task)
  const done = key === 'qa-done' ? task.qaDoneAt : ['pub-done', 'qa-wait', 'qa-doing'].includes(key) ? task.pubDoneAt : ''
  if (!done) return null
  const label = key === 'qa-done' ? '검수 완료' : '퍼블 완료'
  return (
    <span className="done-stamp" title={`${label} ${done}`}>
      {shortStamp(done)}
    </span>
  )
}

// plan.md를 직접 손대서 25/50/75가 아닌 값이 들어와도 선택 목록에서 사라지지 않게 한다.
function progressOptions(current) {
  if (PROGRESS_STEPS.includes(current)) return PROGRESS_STEPS
  return [...PROGRESS_STEPS, current].sort((a, b) => a - b)
}

// 지금 단계를 끝내는 버튼. 퍼블이면 50%, 검수면 100%로 올린다.
function CompleteButton({ task, labels, onUpdate }) {
  const action = completionAction(task, labels)
  const key = phaseKey(task)
  const finished = ['pub-done', 'qa-done'].includes(key)
  const stamp = key === 'qa-done' ? task.qaDoneAt : key === 'pub-done' ? task.pubDoneAt : ''

  return (
    <button
      type="button"
      className={`done-btn${finished ? ' finished' : ''}`}
      disabled={Boolean(action.disabled)}
      title={
        action.disabled
          ? `${action.reason}${stamp ? ` (완료 시각 ${stamp})` : ''}`
          : `${action.hint}. 누른 시각도 함께 기록됩니다.`
      }
      onClick={() => onUpdate(task.rowIndex, { progress: action.progress }, 'progress')}
    >
      {finished ? `✓ ${action.label}` : action.label}
    </button>
  )
}


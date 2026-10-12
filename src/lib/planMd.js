// 계획 파일(plan-YYMMDD.md) <-> 앱 데이터 변환. plan 파일이 유일한 저장소(SoT)다.
// 파싱은 원본 라인 배열을 그대로 들고 있다가, 저장 시 관리 대상 표와 메타 줄만 교체한다.
// 그래서 md의 다른 내용(메모·이력 등)은 손상되지 않는다.
//
// 저장 데이터: 담당자 · 주차 일정 · IA · 작업 목록 · 화면 목록 · 릴리즈 이력
// 파생 데이터(저장할 때마다 다시 계산해서 씀): 공수(연결 화면 수) · 프로젝트 기간 ·
//   대분류별 주차 공수 · 종료 기준 누적 완료율

export const STATUSES = ['대기', '퍼블', '검수']
// 각 진행 상황을 대표하는 진행률. 0 / 25 / 50 / 75 / 100 다섯 단계로 쓴다.
// 착수 전 0 · 퍼블 진행중 25 · 퍼블 완료 50 · 검수 진행중 75 · 검수 완료 100
export const PROGRESS_STEPS = [0, 25, 50, 75, 100]
export const STATUS_PROGRESS = { 대기: 0, 퍼블: 25, 검수: 75 }
export const UNASSIGNED = '-'

// 표시 이름. 작업 목록의 상태 칸에는 코드(대기·퍼블·검수)를 저장하고, 화면에는 이 이름을 보여 준다.
export const LABEL_KEYS = ['대분류', '중분류', '백엔드', '퍼블담당', '검수담당', '대기', '퍼블', '검수']
export const DEFAULT_LABELS = {
  대분류: '대분류',
  중분류: '중분류(화면)',
  백엔드: '백엔드',
  퍼블담당: '퍼블담당',
  검수담당: '검수담당',
  대기: '대기',
  퍼블: '퍼블',
  검수: '검수',
}

function parseLabels(rows, header) {
  const keyAt = header.indexOf('항목')
  const valueAt = header.indexOf('표시명')
  const labels = { ...DEFAULT_LABELS }
  for (const cells of rows) {
    const key = (cells[keyAt] ?? '').trim()
    const value = (cells[valueAt] ?? '').trim()
    if (LABEL_KEYS.includes(key) && value) labels[key] = value
  }
  return labels
}

export function applyLabels(plan, labels) {
  const cleaned = Object.fromEntries(LABEL_KEYS.map((key) => [key, String(labels?.[key] ?? '').trim()]))
  const problems = []
  for (const key of LABEL_KEYS) {
    if (!cleaned[key]) problems.push(`${key}: 표시 이름을 입력해 주세요.`)
    else if (cleaned[key].includes('|')) problems.push(`${key}: 표시 이름에는 '|'를 쓸 수 없습니다.`)
  }
  const statusNames = STATUSES.map((status) => cleaned[status])
  if (new Set(statusNames).size !== statusNames.length) problems.push('상태 이름은 서로 달라야 합니다.')
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return { ...plan, labels: cleaned, labelsManaged: true }
}

export const statusLabel = (status, labels = DEFAULT_LABELS) => labels[status] ?? status

// 페이지 제목 = plan 파일 첫 `# 제목` 줄. 화면 상단 제목과 브라우저 탭 제목에 함께 쓴다.
export function applyTitle(plan, title) {
  const cleaned = String(title ?? '').trim()
  if (!cleaned) throw new Error('페이지 제목을 입력해 주세요.')
  if (/[\r\n]/.test(cleaned)) throw new Error('페이지 제목은 한 줄로 입력해 주세요.')
  return { ...plan, title: cleaned }
}

const TASK_SECTION = '작업 목록'
const WEEK_SECTION = '주차 일정'
const LOAD_SECTION = '대분류별 주차 공수'
const RELEASE_SECTION = '릴리즈 이력'
const IA_SECTION = 'IA'
const SCREEN_SECTION = '화면 목록'
const PEOPLE_SECTION = '담당자'
const DONE_SECTION = '종료 기준 누적 완료율'

// 완료 시각을 담는 컬럼. 이 컬럼이 없는 옛 파일은 저장할 때 자동으로 추가된다.
const TIME_COLUMNS = ['퍼블완료', '검수완료']
const TASK_MANAGED_COLUMNS = [...TIME_COLUMNS, '메모']
const IA_HEADER = ['IA키', '상위 IA키', '구분', '명칭', '순서']
const SCREEN_HEADER = ['화면ID', '화면명', 'IA키', '작업키']
const RELEASE_HEADER = ['일시', 'ID', '대분류', '중분류', '비고']
const PEOPLE_HEADER = ['이름', '백엔드', '퍼블', '검수']
const WEEK_HEADER = ['주차', '시작', '종료']
const LABEL_SECTION = '표시 설정'
const LABEL_HEADER = ['항목', '표시명']
const ROLE_MARK = 'O'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SCREEN_ID = /\bUI-ESG-\d+[MP]\b/gi
const SCREEN_ID_FORMAT = /^UI-ESG-\d+[MP]$/

// 기록용 시각 문자열. "2026-08-07 14:32" (파일에서 읽어도 그대로 이해되는 형태)
export function nowStamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    ` ${pad(now.getHours())}:${pad(now.getMinutes())}`
  )
}

const isTableRow = (line) => line.trim().startsWith('|')
const isDivider = (line) => /^\|[\s:|-]+\|$/.test(line.trim())

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

const buildRow = (cells) => `| ${cells.join(' | ')} |`

// textarea 메모를 Markdown 표 한 칸에 안전하게 넣는다.
// 전용 컬럼만 이 규칙을 쓰므로 기존 비고·원문은 손대지 않는다.
const encodeMemo = (value) =>
  (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/\|/g, '&#124;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>')

const decodeMemo = (value) =>
  (value ?? '')
    .replace(/<br>/g, '\n')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&#124;/g, '|')
    .replace(/&amp;/g, '&')

// 제목이 title인 ## 섹션의 표 위치를 찾는다. { header, divider, start, end }
function findTable(lines, title) {
  const headingIndex = lines.findIndex(
    (line) => line.trim().replace(/^#+\s*/, '') === title && line.trim().startsWith('#'),
  )
  if (headingIndex === -1) return null

  let i = headingIndex + 1
  while (i < lines.length && !isTableRow(lines[i])) {
    if (lines[i].trim().startsWith('#')) return null // 표 없이 다음 섹션
    i += 1
  }
  if (i >= lines.length) return null

  const header = splitRow(lines[i])
  const dividerIndex = i + 1
  if (!isDivider(lines[dividerIndex] ?? '')) return null

  let start = dividerIndex + 1
  let end = start
  while (end < lines.length && isTableRow(lines[end])) end += 1

  return { header, headerIndex: i, dividerIndex, start, end }
}

function tableRows(lines, table) {
  if (!table) return []
  return lines.slice(table.start, table.end).map(splitRow)
}

function metaValue(lines, label) {
  const re = new RegExp(`^-\\s*${label}\\s*:\\s*(.+)$`)
  for (const line of lines) {
    const m = line.trim().match(re)
    if (m) return m[1].trim()
  }
  return ''
}

function catalogIssues(ia, screens, tasks) {
  const issues = []
  const duplicates = (values) => {
    const seen = new Set()
    const repeated = new Set()
    for (const value of values) {
      if (seen.has(value)) repeated.add(value)
      else seen.add(value)
    }
    return [...repeated]
  }

  const iaByKey = new Map(ia.map((node) => [node.key, node]))
  const iaKeys = new Set(iaByKey.keys())
  const workKeys = new Set(tasks.map((task) => task.workKey))
  const taskByWorkKey = new Map(tasks.map((task) => [task.workKey, task]))
  for (const key of duplicates(ia.map((node) => node.key))) issues.push(`중복 IA키: ${key}`)
  for (const key of duplicates(tasks.map((task) => task.workKey))) issues.push(`중복 작업키: ${key}`)
  for (const id of duplicates(screens.map((screen) => screen.id))) issues.push(`중복 화면ID: ${id}`)

  for (const node of ia) {
    if (node.parentKey && !iaKeys.has(node.parentKey)) {
      issues.push(`IA ${node.key}의 상위 IA키가 없습니다: ${node.parentKey}`)
    }
  }
  const reportedCycles = new Set()
  for (const node of ia) {
    const path = []
    const indexes = new Map()
    let key = node.key
    while (key && iaByKey.has(key)) {
      if (indexes.has(key)) {
        const cycle = [...path.slice(indexes.get(key)), key].join(' → ')
        if (!reportedCycles.has(cycle)) {
          reportedCycles.add(cycle)
          issues.push(`IA 순환 참조: ${cycle}`)
        }
        break
      }
      indexes.set(key, path.length)
      path.push(key)
      key = iaByKey.get(key).parentKey
    }
  }

  const isWithin = (childKey, ancestorKey) => {
    const seen = new Set()
    let key = childKey
    while (key && iaByKey.has(key) && !seen.has(key)) {
      if (key === ancestorKey) return true
      seen.add(key)
      key = iaByKey.get(key).parentKey
    }
    return false
  }
  for (const task of tasks) {
    if (!iaKeys.has(task.iaKey)) issues.push(`작업 ${task.workKey}의 IA키가 없습니다: ${task.iaKey}`)
  }
  for (const screen of screens) {
    if (!SCREEN_ID_FORMAT.test(screen.id)) issues.push(`화면ID 형식 오류: ${screen.id}`)
    if (!iaKeys.has(screen.iaKey)) issues.push(`화면 ${screen.id}이 참조하는 존재하지 않는 IA키: ${screen.iaKey}`)
    if (!workKeys.has(screen.workKey)) {
      issues.push(`화면 ${screen.id}이 참조하는 존재하지 않는 작업키: ${screen.workKey}`)
    } else if (iaKeys.has(screen.iaKey)) {
      const task = taskByWorkKey.get(screen.workKey)
      if (iaKeys.has(task.iaKey) && !isWithin(screen.iaKey, task.iaKey)) {
        issues.push(`화면 ${screen.id}의 작업 IA 범위 밖: ${screen.iaKey} → ${task.iaKey}`)
      }
    }
  }
  return issues
}

export function parsePlan(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')

  const title = (lines.find((l) => l.trim().startsWith('# ')) ?? '# 일정 계획')
    .replace(/^#\s*/, '')
    .trim()

  const weekTable = findTable(lines, WEEK_SECTION)
  const weeks = tableRows(lines, weekTable).map(([name, start, end]) => ({
    name,
    start,
    end,
  }))

  const loadTable = findTable(lines, LOAD_SECTION)
  const storedWeeklyLoad = tableRows(lines, loadTable).map((cells) => ({
    category: cells[0],
    values: cells.slice(1).map((v) => Number(v) || 0),
  }))

  const iaTable = findTable(lines, IA_SECTION)
  const iaCol = {}
  ;(iaTable?.header ?? []).forEach((name, index) => {
    iaCol[name] = index
  })
  let ia = tableRows(lines, iaTable).map((cells) => ({
    key: cells[iaCol['IA키']] ?? '',
    parentKey: cells[iaCol['상위 IA키']] ?? '',
    level: cells[iaCol['구분']] ?? '',
    name: cells[iaCol['명칭']] ?? '',
    order: Number(cells[iaCol['순서']]) || 0,
  }))

  const screenTable = findTable(lines, SCREEN_SECTION)
  const screenCol = {}
  ;(screenTable?.header ?? []).forEach((name, index) => {
    screenCol[name] = index
  })
  let screens = tableRows(lines, screenTable).map((cells) => {
    const id = cells[screenCol['화면ID']] ?? ''
    return {
      id,
      title: decodeMemo(cells[screenCol['화면명']] ?? ''),
      iaKey: cells[screenCol['IA키']] ?? '',
      workKey: cells[screenCol['작업키']] ?? '',
      type: id.slice(-1),
    }
  })

  const labelTable = findTable(lines, LABEL_SECTION)
  const labels = labelTable ? parseLabels(tableRows(lines, labelTable), labelTable.header) : { ...DEFAULT_LABELS }
  const toStatus = (value) =>
    STATUSES.includes(value) ? value : (STATUSES.find((status) => labels[status] === value) ?? '대기')

  const taskTable = findTable(lines, TASK_SECTION)
  const col = {}
  ;(taskTable?.header ?? []).forEach((name, index) => {
    col[name] = index
  })

  const person = (value) => (!value || value === UNASSIGNED ? '' : value)

  const tasks = tableRows(lines, taskTable).map((cells, index) => {
    const category = cells[col['대분류']] ?? ''
    const task = cells[col['중분류']] ?? ''
    return {
      id: cells[col['ID']] || `R${index + 1}`,
      workKey: cells[col['작업키']] || `LEGACY:${category}/${task}`,
      iaKey: cells[col['IA키']] || `LEGACY-IA:${category}/${task}`,
      category,
      task,
      effort: Number(cells[col['공수']]) || 0,
      // WBS의 시작·종료 계획일. 없는 파일(구버전)도 있어서 기본값은 빈 값.
      start: cells[col['시작']] ?? '',
      end: cells[col['종료']] ?? '',
      backend: person(cells[col['백엔드']]),
      pub: person(cells[col['퍼블담당']]),
      qa: person(cells[col['검수담당']]),
      status: toStatus(cells[col['상태']]),
      progress: Math.max(0, Math.min(100, Number(cells[col['진행률']]) || 0)),
      // 퍼블/검수 완료 버튼을 누른 시점. 컬럼이 없는 옛 파일은 빈 값.
      pubDoneAt: cells[col['퍼블완료']] ?? '',
      qaDoneAt: cells[col['검수완료']] ?? '',
      memo: decodeMemo(cells[col['메모']]),
      note: cells[col['비고']] ?? '',
      rowIndex: index,
    }
  })

  // 담당자 명단. `## 담당자` 표가 정본이고, 없는 옛 파일은 `프론트 담당자` 메타(퍼블·검수)와
  // 작업에 적힌 백엔드 값으로 명단을 만든다.
  const peopleTable = findTable(lines, PEOPLE_SECTION)
  const people = peopleTable
    ? parsePeople(tableRows(lines, peopleTable), peopleTable.header)
    : legacyPeople(metaValue(lines, '프론트 담당자'), tasks)

  const catalogMode = iaTable && screenTable ? 'structured' : 'legacy'
  if (catalogMode === 'legacy') {
    const iaByKey = new Map()
    const screenById = new Map()
    const midOrders = new Map()

    for (const task of tasks) {
      const majorKey = `LEGACY-IA:${task.category}`
      if (!iaByKey.has(majorKey)) {
        iaByKey.set(majorKey, {
          key: majorKey,
          parentKey: '',
          level: '대분류',
          name: task.category,
          order: iaByKey.size + 1,
        })
      }
      if (!iaByKey.has(task.iaKey)) {
        const nextOrder = (midOrders.get(majorKey) ?? 0) + 1
        midOrders.set(majorKey, nextOrder)
        iaByKey.set(task.iaKey, {
          key: task.iaKey,
          parentKey: majorKey,
          level: '중분류',
          name: task.task,
          order: nextOrder,
        })
      }

      for (const rawId of task.note.match(SCREEN_ID) ?? []) {
        const id = rawId.toUpperCase()
        if (screenById.has(id)) continue
        screenById.set(id, {
          id,
          title: id,
          iaKey: task.iaKey,
          workKey: task.workKey,
          type: id.slice(-1),
        })
      }
    }
    ia = [...iaByKey.values()]
    screens = [...screenById.values()]
  }

  // 릴리즈(개발 이관)는 여러 번 일어나므로 별도 섹션에 최신순으로 쌓아 둔다.
  const releaseTable = findTable(lines, RELEASE_SECTION)
  const rcol = {}
  ;(releaseTable?.header ?? []).forEach((name, index) => {
    rcol[name] = index
  })
  const releases = tableRows(lines, releaseTable)
    .map((cells) => ({
      at: cells[rcol['일시']] ?? '',
      taskId: cells[rcol['ID']] ?? '',
      category: cells[rcol['대분류']] ?? '',
      task: cells[rcol['중분류']] ?? '',
      note: cells[rcol['비고']] ?? '',
    }))
    .filter((r) => r.at && r.taskId)
    .sort((a, b) => b.at.localeCompare(a.at))

  return refreshDerived({
    lines,
    title,
    period: metaValue(lines, '프로젝트 기간'),
    unit: metaValue(lines, '공수 단위'),
    updatedAt: metaValue(lines, '최종 수정'),
    people,
    labels,
    weeks,
    storedWeeklyLoad,
    ia,
    screens,
    catalogMode,
    tasks,
    releases,
    taskTable,
    iaTable,
    screenTable,
    releaseTable,
    peopleTable,
    labelTable,
  })
}

const isMarked = (value) => /^(o|y|yes|v|✓|✔|○|true)$/i.test((value ?? '').trim())

function parsePeople(rows, header) {
  const at = (name) => header.indexOf(name)
  return rows
    .map((cells) => ({
      name: (cells[at('이름')] ?? '').trim(),
      backend: isMarked(cells[at('백엔드')]),
      pub: isMarked(cells[at('퍼블')]),
      qa: isMarked(cells[at('검수')]),
    }))
    .filter((person) => person.name)
}

function legacyPeople(frontMeta, tasks) {
  const byName = new Map()
  for (const name of frontMeta.split(',').map((s) => s.trim()).filter(Boolean)) {
    byName.set(name, { name, backend: false, pub: true, qa: true })
  }
  for (const task of tasks) {
    if (!task.backend) continue
    const person = byName.get(task.backend) ?? { name: task.backend, backend: false, pub: false, qa: false }
    byName.set(task.backend, { ...person, backend: true })
  }
  return [...byName.values()]
}

const effortFromScreens = (plan) => plan.catalogMode === 'structured' || Boolean(plan.screensManaged)

// 주차 번호: 날짜가 들어가는 첫 주차(휴일로 비는 날은 다음 주차). 범위 밖이면 -1.
export function weekIndexOf(weeks, date) {
  if (!date || !weeks?.length) return -1
  return weeks.findIndex((week) => date <= week.end)
}

function categoryOrder(plan) {
  const majors = (plan.ia ?? [])
    .filter((node) => node.level === '대분류')
    .sort((a, b) => a.order - b.order)
    .map((node) => node.name)
  const used = new Set(plan.tasks.map((task) => task.category))
  return [...new Set([...majors.filter((name) => used.has(name)), ...plan.tasks.map((task) => task.category)])]
}

// 대분류별 주차 공수 = 시작일이 속한 주에 새로 착수하는 화면 건수.
export function computeWeeklyLoad(plan) {
  return categoryOrder(plan).map((category) => ({
    category,
    values: plan.weeks.map((_, index) =>
      plan.tasks
        .filter((task) => task.category === category && weekIndexOf(plan.weeks, task.start) === index)
        .reduce((acc, task) => acc + task.effort, 0),
    ),
  }))
}

// 종료 기준 누적 완료율 = 종료일이 속한 주에 공수 전체가 끝난다고 본 누적 비율(0~1).
export function computeDoneRates(plan) {
  const doneBy = (tasks, index) =>
    tasks
      .filter((task) => {
        const at = weekIndexOf(plan.weeks, task.end)
        return at !== -1 && at <= index
      })
      .reduce((acc, task) => acc + task.effort, 0)
  const rows = categoryOrder(plan).map((category) => {
    const tasks = plan.tasks.filter((task) => task.category === category)
    const volume = tasks.reduce((acc, task) => acc + task.effort, 0)
    return { category, volume, rates: plan.weeks.map((_, index) => (volume ? doneBy(tasks, index) / volume : 0)) }
  })
  const volume = plan.tasks.reduce((acc, task) => acc + task.effort, 0)
  return {
    rows,
    total: { volume, rates: plan.weeks.map((_, index) => (volume ? doneBy(plan.tasks, index) / volume : 0)) },
  }
}

// 저장 데이터에서 계산되는 값들을 다시 만든다. 파싱 직후와 화면에서 값을 바꾼 직후에 쓴다.
// rowIndex 등 행 식별은 건드리지 않는다.
export function refreshDerived(plan) {
  const counts = new Map()
  for (const screen of plan.screens ?? []) counts.set(screen.workKey, (counts.get(screen.workKey) ?? 0) + 1)
  const tasks = effortFromScreens(plan)
    ? plan.tasks.map((task) => ({ ...task, effort: counts.get(task.workKey) ?? 0 }))
    : plan.tasks
  const people = plan.people ?? []
  const names = (role) => people.filter((person) => person[role]).map((person) => person.name)
  const next = {
    ...plan,
    tasks,
    // members = 퍼블·검수 대상 전체(담당자 색상·필터 기준). 역할별 목록은 선택 상자에 쓴다.
    members: people.filter((person) => person.pub || person.qa).map((person) => person.name),
    pubMembers: names('pub'),
    qaMembers: names('qa'),
    backendMembers: names('backend'),
  }
  // 일정이 있는 plan은 주차 공수를 작업에서 계산하고, 일정이 없는 옛 파일만 표 값을 쓴다.
  next.scheduleDerived = (next.weeks ?? []).length > 0 && tasks.some((task) => task.start)
  next.weeklyLoad = next.scheduleDerived ? computeWeeklyLoad(next) : (plan.storedWeeklyLoad ?? [])
  next.catalogIssues = catalogIssues(next.ia ?? [], next.screens ?? [], tasks)
  return next
}

// 담당자 명단을 바꾼다. renames(옛 이름 → 새 이름)는 작업의 백엔드·퍼블·검수 값에도 적용한다.
// 작업이 아직 쓰는 사람을 지우거나 그 역할을 빼면 오류로 막는다.
export function applyRoster(plan, people, renames = {}) {
  const cleaned = people.map((person) => ({
    name: String(person.name ?? '').trim(),
    backend: Boolean(person.backend),
    pub: Boolean(person.pub),
    qa: Boolean(person.qa),
  }))
  const problems = []
  if (cleaned.some((person) => !person.name)) problems.push('이름이 비어 있는 행이 있습니다.')
  if (cleaned.some((person) => person.name === UNASSIGNED || /[|,]/.test(person.name))) {
    problems.push(`이름에는 '${UNASSIGNED}', '|', ','를 쓸 수 없습니다.`)
  }
  const seen = new Set()
  for (const person of cleaned) {
    if (person.name && seen.has(person.name)) problems.push(`중복된 이름: ${person.name}`)
    seen.add(person.name)
  }

  const rename = (value) => (value && Object.hasOwn(renames, value) ? renames[value] : value)
  const tasks = plan.tasks.map((task) => ({
    ...task,
    backend: rename(task.backend),
    pub: rename(task.pub),
    qa: rename(task.qa),
  }))
  const has = (name, role) => cleaned.some((person) => person.name === name && person[role])
  const ROLE_LABEL = { backend: '백엔드', pub: '퍼블', qa: '검수' }
  const missing = new Map()
  for (const task of tasks) {
    for (const role of ['backend', 'pub', 'qa']) {
      const name = task[role]
      if (!name || has(name, role)) continue
      const key = `${name}(${ROLE_LABEL[role]})`
      missing.set(key, [...(missing.get(key) ?? []), task.id || task.task])
    }
  }
  for (const [key, ids] of missing) {
    const more = ids.length > 5 ? ` 외 ${ids.length - 5}건` : ''
    problems.push(`${key} 배정이 남아 있는 작업: ${ids.slice(0, 5).join(', ')}${more}`)
  }
  if (problems.length > 0) throw new Error(problems.join('\n'))

  return { ...plan, people: cleaned, tasks, peopleManaged: true }
}

export function applyWeeks(plan, weeks) {
  const cleaned = weeks.map((week) => ({
    name: String(week.name ?? '').trim(),
    start: String(week.start ?? '').trim(),
    end: String(week.end ?? '').trim(),
  }))
  const problems = []
  if (cleaned.length === 0) problems.push('주차가 하나 이상 있어야 합니다.')
  const seen = new Set()
  cleaned.forEach((week, index) => {
    const label = week.name || `${index + 1}번째 행`
    if (!week.name) problems.push(`${index + 1}번째 행의 주차 이름이 비어 있습니다.`)
    else if (seen.has(week.name)) problems.push(`중복된 주차 이름: ${week.name}`)
    seen.add(week.name)
    if (week.name.includes('|')) problems.push(`${label}: 주차 이름에는 '|'를 쓸 수 없습니다.`)
    const prev = cleaned[index - 1]
    if (!ISO_DATE.test(week.start) || !ISO_DATE.test(week.end)) {
      problems.push(`${label}: 시작·종료 날짜를 모두 입력해 주세요.`)
    } else if (week.start > week.end) {
      problems.push(`${label}: 시작일이 종료일보다 늦습니다.`)
    } else if (prev && ISO_DATE.test(prev.end) && week.start <= prev.end) {
      problems.push(`${label}: 앞 주차(${prev.name})와 날짜가 겹치거나 순서가 뒤바뀝니다.`)
    }
  })
  if (problems.length > 0) throw new Error(problems.join('\n'))
  return { ...plan, weeks: cleaned }
}

export function screensForTask(plan, task) {
  return (plan.screens ?? []).filter((screen) => screen.workKey === task.workKey)
}

export function syncTaskScreens(screens, beforeTask, afterTask, rawIds) {
  const ids = [
    ...new Set(
      String(rawIds ?? '')
        .split(/[\s,]+/)
        .map((id) => id.trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
  const invalid = ids.filter((id) => !SCREEN_ID_FORMAT.test(id))
  if (invalid.length > 0) {
    throw new Error(`화면번호 형식이 올바르지 않습니다: ${invalid.join(', ')}`)
  }

  const previousWorkKey = beforeTask?.workKey ?? ''
  const otherScreens = (screens ?? []).filter((screen) => screen.workKey !== previousWorkKey)
  const conflicts = ids.filter((id) => otherScreens.some((screen) => screen.id === id))
  if (conflicts.length > 0) {
    throw new Error(`다른 작업에 이미 연결된 화면번호입니다: ${conflicts.join(', ')}`)
  }

  const wanted = new Set(ids)
  const next = []
  for (const screen of screens ?? []) {
    if (screen.workKey !== previousWorkKey) {
      next.push(screen)
      continue
    }
    if (!wanted.delete(screen.id)) continue
    next.push({ ...screen, workKey: afterTask.workKey })
  }
  for (const id of wanted) {
    next.push({
      id,
      title: id,
      iaKey: afterTask.iaKey,
      workKey: afterTask.workKey,
      type: id.slice(-1),
    })
  }
  return next
}

export function screenIaPath(plan, screen) {
  const byKey = new Map((plan.ia ?? []).map((node) => [node.key, node]))
  const names = []
  const seen = new Set()
  let key = screen?.iaKey ?? ''

  while (key && byKey.has(key) && !seen.has(key)) {
    seen.add(key)
    const node = byKey.get(key)
    names.unshift(node.name)
    key = node.parentKey
  }
  return names.join(' › ')
}

export function taskSearchText(plan, task) {
  const screenText = screensForTask(plan, task)
    .map((screen) => `${screen.id} ${screen.title} ${screenIaPath(plan, screen)}`)
    .join(' ')
  return `${task.id} ${task.workKey} ${task.category} ${task.task} ${screenText}`.toLowerCase()
}

// 작업의 안정 식별자. 표의 ID(T01~)는 정렬 기준이나 행 추가로 바뀌므로 짝을 맞추는 데
// 쓰지 않는다. 대분류+중분류는 계획 판 사이에서 이력을 옮길 때도 쓰던 기준이다.
export const taskKey = (task) => [(task?.category ?? '').trim(), (task?.task ?? '').trim()].join('\0')

// 작업 → 릴리즈 이력(최신순). 표에서 마지막 릴리즈 시각을 찾을 때 쓴다.
// 대분류·중분류가 비어 있는 옛 기록은 ID로만 찾을 수 있어 `id:` 키로도 함께 넣는다.
export function releasesByTask(plan) {
  const map = new Map()
  const push = (key, entry) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(entry)
  }
  for (const entry of plan.releases ?? []) {
    if (entry.category || entry.task) push(taskKey(entry), entry)
    else if (entry.taskId) push(`id:${entry.taskId}`, entry)
  }
  return map
}

// 위 map 에서 이 작업의 이력을 꺼낸다.
export function releasesOf(map, task) {
  return map.get(taskKey(task)) ?? map.get(`id:${task.id}`) ?? []
}

// 표 머리글에 없는 컬럼을 (비고 앞에) 끼워 넣은 순서를 돌려준다.
function ensureColumns(header, names) {
  const order = [...header]
  for (const name of names) {
    if (order.includes(name)) continue
    const noteIndex = order.indexOf('비고')
    if (noteIndex === -1) order.push(name)
    else order.splice(noteIndex, 0, name)
  }
  return order
}

export function serializePlan(source, { today } = {}) {
  const plan = refreshDerived(source)
  const lines = [...plan.lines]
  const table = plan.taskTable
  if (!table) throw new Error('계획 파일에서 "작업 목록" 표를 찾을 수 없습니다.')

  // 유지보수에서 legacy 화면 매핑을 구조형으로 승격할 때는 작업키·IA키도 함께 명시한다.
  const managedColumns = plan.screensManaged
    ? ['작업키', 'IA키', ...TASK_MANAGED_COLUMNS]
    : TASK_MANAGED_COLUMNS
  const order = ensureColumns(table.header, managedColumns)
  if (order.length !== table.header.length) {
    lines[table.headerIndex] = buildRow(order)
    lines[table.dividerIndex] = buildRow(order.map(() => '---'))
  }

  const rows = plan.tasks.map((task) => {
    const byName = {
      ID: task.id,
      작업키: task.workKey,
      IA키: task.iaKey,
      대분류: task.category,
      중분류: task.task,
      공수: String(task.effort),
      시작: task.start ?? '',
      종료: task.end ?? '',
      백엔드: task.backend || UNASSIGNED,
      퍼블담당: task.pub || UNASSIGNED,
      검수담당: task.qa || UNASSIGNED,
      상태: task.status,
      진행률: String(task.progress),
      퍼블완료: task.pubDoneAt ?? '',
      검수완료: task.qaDoneAt ?? '',
      메모: encodeMemo(task.memo),
      비고: task.note ?? '',
    }
    return buildRow(order.map((name) => byName[name] ?? ''))
  })

  // 여러 표를 고치므로 뒤쪽부터 바꾼다. 앞쪽을 먼저 바꾸면 뒤쪽 위치가 밀린다.
  const edits = [{ start: table.start, remove: table.end - table.start, lines: rows }]
  const catalogEdit = buildLegacyCatalogEdit(lines, plan)
  if (catalogEdit) edits.push(catalogEdit)
  else {
    const screenEdit = buildScreenEdit(plan)
    if (screenEdit) edits.push(screenEdit)
  }
  const releaseEdit = buildReleaseEdit(lines, plan)
  if (releaseEdit) edits.push(releaseEdit)
  edits.push(...buildScheduleEdits(lines, plan), ...buildSettingsEdits(lines, plan))
  edits.sort((a, b) => b.start - a.start)
  for (const edit of edits) lines.splice(edit.start, edit.remove, ...edit.lines)

  if (plan.weeks.length > 0) {
    const first = plan.weeks[0]
    const last = plan.weeks.at(-1)
    replaceMeta(lines, '프로젝트 기간', `${first.start} ~ ${last.end} (${plan.weeks.length}주)`)
  }
  if (plan.members.length > 0) replaceMeta(lines, '프론트 담당자', plan.members.join(', '))
  const titleIndex = lines.findIndex((line) => line.trim().startsWith('# '))
  if (titleIndex !== -1) lines[titleIndex] = `# ${plan.title}`
  else if (plan.title) lines.unshift(`# ${plan.title}`, '')

  if (today) {
    const stampIndex = lines.findIndex((l) => /^-\s*최종 수정\s*:/.test(l.trim()))
    if (stampIndex !== -1) lines[stampIndex] = `- 최종 수정: ${today}`
  }

  return lines.join('\n')
}

function tableEdit(table, header, rows) {
  return {
    start: table.headerIndex,
    remove: table.end - table.headerIndex,
    lines: [buildRow(header), buildRow(header.map(() => '---')), ...rows.map(buildRow)],
  }
}

const percent = (ratio, digits = 0) => `${(ratio * 100).toFixed(digits)}%`

// 주차 일정은 저장 데이터, 주차 공수·누적 완료율 표는 그 일정과 작업 목록에서 다시 계산해 쓴다.
function buildScheduleEdits(lines, plan) {
  const edits = []
  const weekTable = findTable(lines, WEEK_SECTION)
  if (weekTable && plan.weeks.length > 0) {
    edits.push(tableEdit(weekTable, WEEK_HEADER, plan.weeks.map((week) => [week.name, week.start, week.end])))
  }
  if (!plan.scheduleDerived) return edits

  const names = plan.weeks.map((week) => week.name)
  const loadTable = findTable(lines, LOAD_SECTION)
  if (loadTable) {
    edits.push(
      tableEdit(
        loadTable,
        ['대분류', ...names],
        plan.weeklyLoad.map((row) => [row.category, ...row.values.map(String)]),
      ),
    )
  }
  const doneTable = findTable(lines, DONE_SECTION)
  if (doneTable) {
    const { rows, total } = computeDoneRates(plan)
    edits.push(
      tableEdit(doneTable, ['대분류', '물량', ...names], [
        ...rows.map((row) => [row.category, String(row.volume), ...row.rates.map((rate) => percent(rate))]),
        ['**전체**', `**${total.volume}**`, ...total.rates.map((rate) => `**${percent(rate, 1)}**`)],
      ]),
    )
  }
  return edits
}

// 담당자·표시 설정 표. 이미 있으면 교체하고, 화면에서 처음 편집했으면 작업 목록 앞에 새로 만든다.
function buildSettingsEdits(lines, plan) {
  const edits = []
  const inserts = []
  const peopleRows = (plan.people ?? []).map((person) => [
    person.name,
    person.backend ? ROLE_MARK : '',
    person.pub ? ROLE_MARK : '',
    person.qa ? ROLE_MARK : '',
  ])
  const peopleTable = findTable(lines, PEOPLE_SECTION)
  if (peopleTable) edits.push(tableEdit(peopleTable, PEOPLE_HEADER, peopleRows))
  else if (plan.peopleManaged) inserts.push(...sectionLines(PEOPLE_SECTION, PEOPLE_HEADER, peopleRows))

  const labelRows = LABEL_KEYS.map((key) => [key, plan.labels?.[key] ?? DEFAULT_LABELS[key]])
  const labelTable = findTable(lines, LABEL_SECTION)
  if (labelTable) edits.push(tableEdit(labelTable, LABEL_HEADER, labelRows))
  else if (plan.labelsManaged) inserts.push(...sectionLines(LABEL_SECTION, LABEL_HEADER, labelRows))

  if (inserts.length > 0) {
    const before = lines.findIndex(
      (line) => line.trim().startsWith('#') && line.trim().replace(/^#+\s*/, '') === TASK_SECTION,
    )
    edits.push({ start: before === -1 ? lines.length : before, remove: 0, lines: inserts })
  }
  return edits
}

const sectionLines = (title, header, rows) => [
  `## ${title}`,
  '',
  buildRow(header),
  buildRow(header.map(() => '---')),
  ...rows.map(buildRow),
  '',
]

function replaceMeta(lines, label, value) {
  const index = lines.findIndex((line) => new RegExp(`^-\\s*${label}\\s*:`).test(line.trim()))
  if (index !== -1) lines[index] = `- ${label}: ${value}`
}

function buildLegacyCatalogEdit(lines, plan) {
  if (!plan.screensManaged || plan.iaTable || plan.screenTable) return null

  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end -= 1
  const iaRows = (plan.ia ?? []).map((node) =>
    buildRow([node.key, node.parentKey, node.level, node.name, String(node.order)]),
  )
  const screenRows = (plan.screens ?? []).map((screen) =>
    buildRow([screen.id, encodeMemo(screen.title), screen.iaKey, screen.workKey]),
  )

  return {
    start: end,
    remove: lines.length - end,
    lines: [
      '',
      `## ${IA_SECTION}`,
      '',
      buildRow(IA_HEADER),
      buildRow(IA_HEADER.map(() => '---')),
      ...iaRows,
      '',
      `## ${SCREEN_SECTION}`,
      '',
      buildRow(SCREEN_HEADER),
      buildRow(SCREEN_HEADER.map(() => '---')),
      ...screenRows,
      '',
    ],
  }
}

function buildScreenEdit(plan) {
  const table = plan.screenTable
  if (!table) return null
  const rows = (plan.screens ?? []).map((screen) => {
    const byName = {
      화면ID: screen.id,
      화면명: encodeMemo(screen.title),
      IA키: screen.iaKey,
      작업키: screen.workKey,
    }
    return buildRow(table.header.map((name) => byName[name] ?? ''))
  })
  return { start: table.start, remove: table.end - table.start, lines: rows }
}

// "릴리즈 이력" 섹션을 갱신하는 편집 정보. 섹션이 없으면 파일 끝에 새로 만든다.
function buildReleaseEdit(lines, plan) {
  const releases = [...(plan.releases ?? [])].sort((a, b) => b.at.localeCompare(a.at))
  const table = plan.releaseTable

  if (table) {
    const order = table.header
    const rows = releases.map((entry) => {
      const byName = {
        일시: entry.at,
        ID: entry.taskId,
        대분류: entry.category ?? '',
        중분류: entry.task ?? '',
        비고: entry.note ?? '',
      }
      return buildRow(order.map((name) => byName[name] ?? ''))
    })
    return { start: table.start, remove: table.end - table.start, lines: rows }
  }

  if (releases.length === 0) return null

  // 파일 끝의 빈 줄을 지우고 그 자리에 섹션을 붙인다(끝에 빈 줄 하나만 남긴다).
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end -= 1

  const rows = releases.map((entry) =>
    buildRow([entry.at, entry.taskId, entry.category ?? '', entry.task ?? '', entry.note ?? '']),
  )

  return {
    start: end,
    remove: lines.length - end,
    lines: [
      '',
      `## ${RELEASE_SECTION}`,
      '',
      '릴리즈(개발 이관) 기록입니다. 최신순이며, 웹 화면에서 행을 펼친 뒤 `릴리즈 완료`를 누르면 한 줄씩 쌓입니다.',
      '',
      buildRow(RELEASE_HEADER),
      buildRow(RELEASE_HEADER.map(() => '---')),
      ...rows,
      '',
    ],
  }
}

// ─────────────────────────────────────────────────────────────
// 진행 상황 = 상태 + 진행률을 함께 읽어서 만든 값
//
//   대기                       → 착수 전                (대표값 0%)
//   퍼블 + 50% 미만            → 퍼블 진행중             (대표값 25%)
//   퍼블 + 50% 이상            → 퍼블 완료 · 검수 대기    (대표값 50%)
//   검수 + 50% 미만            → 검수 대기 (진행률이 아직 퍼블 구간)
//   검수 + 50% 이상 100% 미만  → 검수 진행중             (대표값 75%)
//   검수 + 100%                → 검수 완료              (대표값 100%)
// ─────────────────────────────────────────────────────────────

export function phasesFor(labels = DEFAULT_LABELS) {
  const pub = labels.퍼블
  const qa = labels.검수
  return [
    { key: 'wait', label: '착수 전', short: '착수 전' },
    { key: 'pub-doing', label: `${pub} 진행중`, short: `${pub} 진행중` },
    { key: 'pub-done', label: `${pub} 완료 · ${qa} 대기`, short: `${pub} 완료` },
    { key: 'qa-wait', label: `${qa} 대기`, short: `${qa} 대기` },
    { key: 'qa-doing', label: `${qa} 진행중`, short: `${qa} 진행중` },
    { key: 'qa-done', label: `${qa} 완료`, short: `${qa} 완료` },
  ]
}

export const PHASES = phasesFor()

export function phaseKey(task) {
  const progress = task.progress ?? 0
  if (task.status === '검수') {
    if (progress >= 100) return 'qa-done'
    if (progress >= 50) return 'qa-doing'
    return 'qa-wait'
  }
  if (task.status === '퍼블') {
    return progress >= 50 ? 'pub-done' : 'pub-doing'
  }
  return 'wait'
}

export function taskPhase(task, labels = DEFAULT_LABELS) {
  return phasesFor(labels).find((phase) => phase.key === phaseKey(task))
}

// "완료" 버튼이 이 작업에서 무엇을 하는지. disabled면 reason이 이유.
export function completionAction(task, labels = DEFAULT_LABELS) {
  const pub = labels.퍼블
  const qa = labels.검수
  const key = phaseKey(task)
  if (key === 'pub-doing') {
    return { label: `${pub} 완료`, progress: 50, hint: `${pub} 작업을 끝내고 진행률을 50%로 올립니다 (${qa} 대기 상태가 됩니다)` }
  }
  if (key === 'qa-doing' || key === 'qa-wait') {
    return { label: `${qa} 완료`, progress: 100, hint: `${qa}를 끝내고 진행률을 100%로 올립니다` }
  }
  if (key === 'pub-done') {
    return { disabled: true, label: `${pub} 완료`, reason: `이미 ${pub} 완료입니다. ${qa}를 시작하려면 상태를 "${qa}"로 바꾸세요.` }
  }
  if (key === 'qa-done') {
    return { disabled: true, label: `${qa} 완료`, reason: `${qa}까지 모두 끝난 작업입니다.` }
  }
  return { disabled: true, label: '완료', reason: `상태를 "${pub}"로 바꾼 뒤에 사용할 수 있습니다.` }
}

// 퍼블 완료 / 검수 완료에 "도달한 순간"의 시각을 기록한다.
// 완료 버튼뿐 아니라 상태·진행률을 직접 바꿔 완료가 된 경우에도 같은 기준으로 남긴다.
// 완료 지점에서 벗어났다가 다시 완료되면 새 시각으로 덮어쓴다(마지막 완료 시점이 남는다).
export function stampCompletion(before, after, at = nowStamp()) {
  const from = phaseKey(before)
  const to = phaseKey(after)
  if (from === to) return after
  if (to === 'pub-done') return { ...after, pubDoneAt: at }
  if (to === 'qa-done') return { ...after, qaDoneAt: at }
  return after
}

// 상태(대기 → 퍼블 → 검수)와 진행률을 서로 모순되지 않게 맞춘다.
export function syncStatusProgress(task, changed) {
  const progress = task.progress ?? 0

  if (changed === 'status') {
    // 상태를 바꾸면 그 단계를 대표하는 진행률로 맞춘다.
    // 단, 이미 그 단계의 "완료" 지점이면(퍼블 50% / 검수 100%) 완료 상태를 유지한다.
    if (task.status === '대기') return { ...task, progress: 0 }
    if (task.status === '퍼블') {
      return progress === 50 ? task : { ...task, progress: STATUS_PROGRESS.퍼블 }
    }
    if (task.status === '검수') {
      return progress >= 100 ? task : { ...task, progress: STATUS_PROGRESS.검수 }
    }
    return task
  }

  if (changed === 'progress') {
    if (progress === 0) return { ...task, status: '대기' }
    if (progress === 100) return { ...task, status: '검수' }
    if (progress < 50) return { ...task, status: '퍼블' }
    // 50%는 "퍼블 완료"와 "검수 시작"의 경계라 기존 상태를 존중한다.
    if (progress === 50) return task.status === '대기' ? { ...task, status: '퍼블' } : task
    return { ...task, status: '검수' }
  }

  return task
}

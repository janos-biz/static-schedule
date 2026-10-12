import test from 'node:test'
import assert from 'node:assert/strict'

import * as planMd from '../src/lib/planMd.js'
import {
  parsePlan,
  screenIaPath,
  screensForTask,
  serializePlan,
  taskSearchText,
} from '../src/lib/planMd.js'

const structuredPlan = `# 테스트 계획

- 프로젝트 기간: 2026-09-01 ~ 2026-09-30
- 공수 단위: 건
- 프론트 담당자: 박민수
- 최종 수정: 2026-09-01

## IA

| IA키 | 상위 IA키 | 구분 | 명칭 | 순서 |
|---|---|---|---|---|
| IA-GHG |  | 대분류 | 온실가스 관리 | 1 |
| IA-GHG-REF | IA-GHG | 중분류 | 기준정보 | 1 |
| IA-GHG-REF-CORP | IA-GHG-REF | 메뉴 | 법인·사업장 | 1 |

## 작업 목록

| ID | 작업키 | IA키 | 대분류 | 중분류 | 공수 | 시작 | 종료 | 백엔드 | 퍼블담당 | 검수담당 | 상태 | 진행률 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T01 | WK-GHG-REF | IA-GHG-REF | 온실가스 관리 | 기준정보 | 1 | 2026-09-01 | 2026-09-02 | 최영수 | 박민수 | - | 퍼블 | 25 |  |

## 화면 목록

| 화면ID | 화면명 | IA키 | 작업키 |
|---|---|---|---|
| UI-ESG-1176P | 사업장 관리 - 담당자 추가 | IA-GHG-REF-CORP | WK-GHG-REF |
`

test('plan 파일의 IA와 화면 목록을 작업키로 파싱한다', () => {
  const plan = parsePlan(structuredPlan)

  assert.deepEqual(plan.ia, [
    { key: 'IA-GHG', parentKey: '', level: '대분류', name: '온실가스 관리', order: 1 },
    { key: 'IA-GHG-REF', parentKey: 'IA-GHG', level: '중분류', name: '기준정보', order: 1 },
    { key: 'IA-GHG-REF-CORP', parentKey: 'IA-GHG-REF', level: '메뉴', name: '법인·사업장', order: 1 },
  ])
  assert.deepEqual(plan.screens, [
    {
      id: 'UI-ESG-1176P',
      title: '사업장 관리 - 담당자 추가',
      iaKey: 'IA-GHG-REF-CORP',
      workKey: 'WK-GHG-REF',
      type: 'P',
    },
  ])
  assert.equal(plan.tasks[0].workKey, 'WK-GHG-REF')
  assert.equal(plan.tasks[0].iaKey, 'IA-GHG-REF')
  assert.equal(plan.catalogMode, 'structured')
  assert.deepEqual(plan.catalogIssues, [])
  assert.deepEqual(screensForTask(plan, plan.tasks[0]).map((screen) => screen.id), ['UI-ESG-1176P'])
  assert.equal(screenIaPath(plan, plan.screens[0]), '온실가스 관리 › 기준정보 › 법인·사업장')
})

const legacyPlan = `# 구버전 계획

- 프론트 담당자: 박민수

## 작업 목록

| ID | 대분류 | 중분류 | 공수 | 시작 | 종료 | 백엔드 | 퍼블담당 | 검수담당 | 상태 | 진행률 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T01 | 온실가스 관리 | 기준정보 | 2 | 2026-09-01 | 2026-09-02 | 최영수 | 박민수 | - | 퍼블 | 25 | 화면번호: UI-ESG-1176P, UI-ESG-9999P |
`

test('구버전 plan은 비고의 화면번호만으로 IA와 화면 연결을 구성한다', () => {
  const plan = parsePlan(legacyPlan)
  const task = plan.tasks[0]

  assert.equal(plan.catalogMode, 'legacy')
  assert.equal(task.workKey, 'LEGACY:온실가스 관리/기준정보')
  assert.equal(task.iaKey, 'LEGACY-IA:온실가스 관리/기준정보')
  assert.deepEqual(screensForTask(plan, task).map((screen) => screen.id), [
    'UI-ESG-1176P',
    'UI-ESG-9999P',
  ])
  assert.equal(screenIaPath(plan, plan.screens[0]), '온실가스 관리 › 기준정보')
})

test('구버전 plan의 화면번호 편집은 구조형 IA와 화면 목록으로 승격해 보존한다', () => {
  const plan = parsePlan(legacyPlan)
  const task = plan.tasks[0]
  const screens = planMd.syncTaskScreens(
    plan.screens,
    task,
    task,
    'UI-ESG-1001P',
  )
  const reparsed = parsePlan(
    serializePlan({
      ...plan,
      screens,
      screensManaged: true,
    }),
  )

  assert.equal(reparsed.catalogMode, 'structured')
  assert.deepEqual(reparsed.catalogIssues, [])
  assert.deepEqual(reparsed.screens.map((screen) => screen.id), ['UI-ESG-1001P'])
  assert.match(serializePlan({ ...plan, screens, screensManaged: true }), /## 화면 목록/)
})

test('구버전 plan 승격은 신규 작업과 구조 수정의 작업키 IA키를 함께 보존한다', () => {
  const plan = parsePlan(legacyPlan)
  const existing = plan.tasks[0]
  const added = {
    ...existing,
    id: 'T02',
    workKey: 'WORK-T02',
    iaKey: existing.iaKey,
    category: '신규 분류',
    task: '신규 작업',
    rowIndex: 1,
  }
  const withAddedScreens = planMd.syncTaskScreens(
    plan.screens,
    null,
    added,
    'UI-ESG-2002P',
  )
  const afterAdd = parsePlan(
    serializePlan({
      ...plan,
      tasks: [...plan.tasks, added],
      screens: withAddedScreens,
      screensManaged: true,
    }),
  )

  assert.equal(afterAdd.catalogMode, 'structured')
  assert.deepEqual(afterAdd.catalogIssues, [])
  assert.equal(afterAdd.tasks[1].workKey, 'WORK-T02')
  assert.equal(afterAdd.tasks[1].iaKey, existing.iaKey)
  assert.equal(afterAdd.screens.find((screen) => screen.id === 'UI-ESG-2002P').workKey, 'WORK-T02')

  const changed = {
    ...existing,
    workKey: 'WORK-T01-CHANGED',
    category: '변경 분류',
    task: '변경 작업',
  }
  const changedScreens = planMd.syncTaskScreens(
    plan.screens,
    existing,
    changed,
    'UI-ESG-1176P',
  )
  const afterChange = parsePlan(
    serializePlan({
      ...plan,
      tasks: [changed],
      screens: changedScreens,
      screensManaged: true,
    }),
  )

  assert.deepEqual(afterChange.catalogIssues, [])
  assert.equal(afterChange.tasks[0].workKey, 'WORK-T01-CHANGED')
  assert.equal(afterChange.tasks[0].category, '변경 분류')
  assert.equal(afterChange.tasks[0].task, '변경 작업')
  assert.equal(afterChange.screens[0].workKey, 'WORK-T01-CHANGED')
})

test('작업 저장 후에도 작업키 IA키와 plan 화면 목록을 보존한다', () => {
  const plan = parsePlan(structuredPlan)
  const changed = {
    ...plan,
    tasks: plan.tasks.map((task) => ({ ...task, pub: '이영희' })),
  }
  const reparsed = parsePlan(serializePlan(changed, { today: '2026-09-02' }))

  assert.equal(reparsed.tasks[0].workKey, 'WK-GHG-REF')
  assert.equal(reparsed.tasks[0].iaKey, 'IA-GHG-REF')
  assert.equal(reparsed.tasks[0].pub, '이영희')
  assert.deepEqual(reparsed.screens, plan.screens)
  assert.deepEqual(reparsed.ia, plan.ia)
})

test('작업 행 추가 수정 삭제를 Markdown 작업 목록에 반영한다', () => {
  const plan = parsePlan(structuredPlan)
  const added = {
    ...plan.tasks[0],
    id: 'T02',
    workKey: 'WK-GHG-NEW',
    task: '추가 작업',
    effort: 3,
    backend: '신규 백엔드',
    pub: '',
    qa: '박민수',
    status: '대기',
    progress: 0,
    rowIndex: 1,
  }
  const afterAdd = parsePlan(serializePlan({ ...plan, tasks: [...plan.tasks, added] }))

  assert.equal(afterAdd.tasks.length, 2)
  assert.equal(afterAdd.tasks[1].task, '추가 작업')
  assert.equal(afterAdd.tasks[1].qa, '박민수')

  const modified = {
    ...afterAdd.tasks[1],
    task: '수정된 작업',
    pub: '박민수',
  }
  const afterDelete = parsePlan(serializePlan({ ...afterAdd, tasks: [modified] }))

  assert.equal(afterDelete.tasks.length, 1)
  assert.equal(afterDelete.tasks[0].id, 'T02')
  assert.equal(afterDelete.tasks[0].task, '수정된 작업')
  // 연결된 화면이 없는 작업이라 공수는 0으로 계산된다.
  assert.equal(afterDelete.tasks[0].effort, 0)
  assert.equal(afterDelete.tasks[0].pub, '박민수')
  assert.doesNotMatch(
    serializePlan({ ...afterAdd, tasks: [modified] }),
    /\| T01 \| WK-GHG-REF \|/,
  )
})

test('작업 삭제 시 연결 화면도 Markdown에서 함께 제거해 무결성을 지킨다', () => {
  const plan = parsePlan(structuredPlan)
  const reparsed = parsePlan(
    serializePlan({
      ...plan,
      tasks: [],
      screens: [],
    }),
  )

  assert.deepEqual(reparsed.tasks, [])
  assert.deepEqual(reparsed.screens, [])
  assert.deepEqual(reparsed.catalogIssues, [])
  assert.doesNotMatch(serializePlan({ ...plan, tasks: [], screens: [] }), /UI-ESG-1176P/)
})

test('작업 편집 화면번호를 정규화하고 화면 목록 매핑으로 동기화한다', () => {
  assert.equal(typeof planMd.syncTaskScreens, 'function')

  const plan = parsePlan(structuredPlan)
  const before = plan.tasks[0]
  const after = { ...before, workKey: 'WK-GHG-UPDATED', iaKey: 'IA-GHG-REF' }
  const screens = planMd.syncTaskScreens(
    [
      ...plan.screens,
      {
        id: 'UI-ESG-2000M',
        title: '다른 작업 화면',
        iaKey: 'IA-GHG',
        workKey: 'WK-OTHER',
        type: 'M',
      },
    ],
    before,
    after,
    'ui-esg-1176p, UI-ESG-2001M\nui-esg-2001m',
  )

  assert.deepEqual(screens, [
    {
      id: 'UI-ESG-1176P',
      title: '사업장 관리 - 담당자 추가',
      iaKey: 'IA-GHG-REF-CORP',
      workKey: 'WK-GHG-UPDATED',
      type: 'P',
    },
    {
      id: 'UI-ESG-2000M',
      title: '다른 작업 화면',
      iaKey: 'IA-GHG',
      workKey: 'WK-OTHER',
      type: 'M',
    },
    {
      id: 'UI-ESG-2001M',
      title: 'UI-ESG-2001M',
      iaKey: 'IA-GHG-REF',
      workKey: 'WK-GHG-UPDATED',
      type: 'M',
    },
  ])

  const replacedIds = planMd.syncTaskScreens(
    plan.screens,
    before,
    after,
    'UI-ESG-2001M',
  )
  assert.deepEqual(replacedIds.map((screen) => screen.id), ['UI-ESG-2001M'])

  assert.throws(
    () => planMd.syncTaskScreens(plan.screens, before, after, '화면-1'),
    /화면번호 형식/,
  )
  assert.throws(
    () =>
      planMd.syncTaskScreens(
        [
          ...plan.screens,
          { id: 'UI-ESG-2000M', title: '', iaKey: 'IA-GHG', workKey: 'WK-OTHER' },
        ],
        before,
        after,
        'UI-ESG-2000M',
      ),
    /다른 작업에 이미 연결/,
  )
})

test('잘못된 plan 화면 매핑을 경고한다', () => {
  const broken = structuredPlan.replace(
    '| UI-ESG-1176P | 사업장 관리 - 담당자 추가 | IA-GHG-REF-CORP | WK-GHG-REF |',
    [
      '| UI-ESG-1176P | 사업장 관리 - 담당자 추가 | IA-GHG-REF-CORP | WK-GHG-REF |',
      '| UI-ESG-1176P | 중복 화면 | IA-NOT-FOUND | WK-NOT-FOUND |',
    ].join('\n'),
  )
  const plan = parsePlan(broken)
  const issues = plan.catalogIssues.join('\n')

  assert.match(issues, /중복 화면ID: UI-ESG-1176P/)
  assert.match(issues, /존재하지 않는 IA키: IA-NOT-FOUND/)
  assert.match(issues, /존재하지 않는 작업키: WK-NOT-FOUND/)
})

test('작업 검색 문자열은 plan 화면ID 화면명 IA 경로를 포함한다', () => {
  const plan = parsePlan(structuredPlan)
  const haystack = taskSearchText(plan, plan.tasks[0])

  assert.match(haystack, /ui-esg-1176p/)
  assert.match(haystack, /사업장 관리 - 담당자 추가/)
  assert.match(haystack, /온실가스 관리 › 기준정보 › 법인·사업장/)
})

test('화면명의 Markdown 표 파이프 엔티티를 복원한다', () => {
  const encoded = structuredPlan.replace(
    '사업장 관리 - 담당자 추가',
    '사업장 관리 &#124; 담당자 추가',
  )
  assert.equal(parsePlan(encoded).screens[0].title, '사업장 관리 | 담당자 추가')
})

test('IA 순환과 작업 IA 범위 밖 화면 연결을 경고한다', () => {
  const broken = structuredPlan
    .replace(
      '| IA-GHG |  | 대분류 | 온실가스 관리 | 1 |',
      '| IA-GHG | IA-GHG-REF-CORP | 대분류 | 온실가스 관리 | 1 |\n| IA-OTHER |  | 대분류 | 기타 | 2 |',
    )
    .replace(
      '| UI-ESG-1176P | 사업장 관리 - 담당자 추가 | IA-GHG-REF-CORP | WK-GHG-REF |',
      '| UI-ESG-1176P | 사업장 관리 - 담당자 추가 | IA-OTHER | WK-GHG-REF |',
    )
  const issues = parsePlan(broken).catalogIssues.join('\n')

  assert.match(issues, /IA 순환 참조:/)
  assert.match(issues, /작업 IA 범위 밖:/)
})

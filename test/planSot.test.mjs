import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyLabels,
  applyRoster,
  applyTitle,
  applyWeeks,
  completionAction,
  parsePlan,
  refreshDerived,
  serializePlan,
  taskPhase,
} from '../src/lib/planMd.js'

const plan = `# SoT 계획

- 프로젝트 기간: 2026-09-01 ~ 2026-09-11 (2주)
- 공수 단위: 건
- 프론트 담당자: 박민수, 홍길동
- 최종 수정: 2026-09-01

## 주차 일정

| 주차 | 시작 | 종료 |
| --- | --- | --- |
| 1주 | 2026-09-01 | 2026-09-04 |
| 2주 | 2026-09-07 | 2026-09-11 |

## 대분류별 주차 공수

| 대분류 | 1주 | 2주 |
| --- | --- | --- |
| 온실가스 관리 | 99 | 99 |

## 종료 기준 누적 완료율

| 대분류 | 물량 | 1주 | 2주 |
| --- | --- | --- | --- |
| 온실가스 관리 | 99 | 0% | 0% |

## IA

| IA키 | 상위 IA키 | 구분 | 명칭 | 순서 |
| --- | --- | --- | --- | --- |
| IA-GHG |  | 대분류 | 온실가스 관리 | 1 |
| IA-GHG-REF | IA-GHG | 중분류 | 기준정보 | 1 |
| IA-GHG-RES | IA-GHG | 중분류 | 배출량 결과 | 2 |

## 작업 목록

| ID | 작업키 | IA키 | 대분류 | 중분류 | 공수 | 시작 | 종료 | 백엔드 | 퍼블담당 | 검수담당 | 상태 | 진행률 | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | WK-REF | IA-GHG-REF | 온실가스 관리 | 기준정보 | 9 | 2026-09-01 | 2026-09-03 | 최영수 | 박민수 | - | 퍼블 | 25 |  |
| T02 | WK-RES | IA-GHG-RES | 온실가스 관리 | 배출량 결과 | 9 | 2026-09-07 | 2026-09-10 | 최영수 | - | 홍길동 | 대기 | 0 |  |

## 화면 목록

| 화면ID | 화면명 | IA키 | 작업키 |
| --- | --- | --- | --- |
| UI-ESG-100M | 기준정보 목록 | IA-GHG-REF | WK-REF |
| UI-ESG-101P | 기준정보 등록 | IA-GHG-REF | WK-REF |
| UI-ESG-200M | 배출량 결과 | IA-GHG-RES | WK-RES |
`

const row = (md, prefix) => md.split('\n').find((line) => line.startsWith(prefix))

test('공수는 작업키에 연결된 화면 수로 계산되고 저장할 때 공수 칸에 기록된다', () => {
  const parsed = parsePlan(plan)
  assert.deepEqual(parsed.tasks.map((task) => task.effort), [2, 1])

  const withoutScreen = { ...parsed, screens: parsed.screens.filter((screen) => screen.id !== 'UI-ESG-101P') }
  const saved = serializePlan(withoutScreen)
  assert.match(row(saved, '| T01 |'), /\| 기준정보 \| 1 \|/)
  assert.equal(refreshDerived(withoutScreen).tasks[0].effort, 1)
})

test('주차 공수와 누적 완료율 표는 작업 일정에서 다시 계산해 저장한다', () => {
  const parsed = parsePlan(plan)
  assert.deepEqual(parsed.weeklyLoad, [{ category: '온실가스 관리', values: [2, 1] }])

  const saved = serializePlan(parsed)
  assert.equal(row(saved, '| 온실가스 관리 | 2 |'), '| 온실가스 관리 | 2 | 1 |')
  assert.equal(row(saved, '| 온실가스 관리 | 3 |'), '| 온실가스 관리 | 3 | 67% | 100% |')
  assert.equal(row(saved, '| **전체** |'), '| **전체** | **3** | **66.7%** | **100.0%** |')
})

test('담당자 표가 없으면 프론트 담당자 메타와 작업 백엔드로 명단을 만든다', () => {
  const parsed = parsePlan(plan)
  assert.deepEqual(parsed.people, [
    { name: '박민수', backend: false, pub: true, qa: true },
    { name: '홍길동', backend: false, pub: true, qa: true },
    { name: '최영수', backend: true, pub: false, qa: false },
  ])
  assert.deepEqual(parsed.backendMembers, ['최영수'])
  assert.deepEqual(parsed.members, ['박민수', '홍길동'])
})

test('담당자 명단을 편집하면 담당자 표를 만들고 이름 변경을 작업에 반영한다', () => {
  const parsed = parsePlan(plan)
  const people = [
    { name: '박민수', backend: false, pub: true, qa: false },
    { name: '홍길동B', backend: false, pub: false, qa: true },
    { name: '최영수', backend: true, pub: false, qa: false },
    { name: '이영희', backend: false, pub: true, qa: true },
  ]
  const saved = serializePlan(applyRoster(parsed, people, { 홍길동: '홍길동B' }))
  const reparsed = parsePlan(saved)

  assert.ok(saved.indexOf('## 담당자') < saved.indexOf('## 작업 목록'))
  assert.match(saved, /\| 홍길동B \|  \|  \| O \|/)
  assert.match(saved, /- 프론트 담당자: 박민수, 홍길동B, 이영희/)
  assert.equal(reparsed.tasks[1].qa, '홍길동B')
  assert.deepEqual(reparsed.pubMembers, ['박민수', '이영희'])
  assert.deepEqual(reparsed.qaMembers, ['홍길동B', '이영희'])
  assert.equal(serializePlan(reparsed), saved)
})

test('배정이 남은 사람을 명단에서 빼거나 역할을 지우면 저장을 막는다', () => {
  const parsed = parsePlan(plan)
  assert.throws(
    () => applyRoster(parsed, [{ name: '최영수', backend: true }, { name: '홍길동', qa: true }]),
    /박민수\(퍼블\) 배정이 남아 있는 작업: T01/,
  )
  assert.throws(
    () => applyRoster(parsed, [...parsed.people, { name: '박민수', pub: true }]),
    /중복된 이름: 박민수/,
  )
})

test('주차 일정을 바꾸면 주차 표 · 프로젝트 기간 · 파생 표 머리글이 함께 바뀐다', () => {
  const parsed = parsePlan(plan)
  const weeks = [...parsed.weeks, { name: '3주', start: '2026-09-14', end: '2026-09-18' }]
  const saved = serializePlan(applyWeeks(parsed, weeks))

  assert.match(saved, /- 프로젝트 기간: 2026-09-01 ~ 2026-09-18 \(3주\)/)
  assert.match(saved, /\| 3주 \| 2026-09-14 \| 2026-09-18 \|/)
  assert.match(saved, /\| 대분류 \| 1주 \| 2주 \| 3주 \|/)
  assert.match(saved, /\| 대분류 \| 물량 \| 1주 \| 2주 \| 3주 \|/)
  assert.equal(parsePlan(saved).weeks.length, 3)
})

test('겹치거나 순서가 뒤바뀐 주차는 저장을 막는다', () => {
  const parsed = parsePlan(plan)
  assert.throws(
    () => applyWeeks(parsed, [parsed.weeks[1], parsed.weeks[0]]),
    /앞 주차\(2주\)와 날짜가 겹치거나 순서가 뒤바뀝니다/,
  )
  assert.throws(() => applyWeeks(parsed, [{ name: '1주', start: '2026-09-05', end: '2026-09-01' }]), /시작일이 종료일보다 늦습니다/)
})

test('표시 이름을 바꾸면 상태 코드는 그대로 두고 단계·완료 버튼 문구가 바뀐다', () => {
  const parsed = parsePlan(plan)
  const labels = { ...parsed.labels, 퍼블: '계획', 퍼블담당: '계획담당', 대분류: '업무' }
  const saved = serializePlan(applyLabels(parsed, labels))
  const reparsed = parsePlan(saved)

  assert.match(saved, /## 표시 설정/)
  assert.match(saved, /\| 퍼블 \| 계획 \|/)
  assert.match(row(saved, '| T01 |'), /\| 퍼블 \| 25 \|/)
  assert.equal(reparsed.labels.퍼블담당, '계획담당')
  assert.equal(reparsed.tasks[0].status, '퍼블')
  assert.equal(completionAction(reparsed.tasks[0], reparsed.labels).label, '계획 완료')
  assert.equal(taskPhase({ status: '퍼블', progress: 50 }, reparsed.labels).label, '계획 완료 · 검수 대기')
  assert.throws(() => applyLabels(parsed, { ...labels, 검수: '계획' }), /상태 이름은 서로 달라야/)
})

test('상태 칸에 표시 이름이 적혀 있어도 상태 코드로 읽는다', () => {
  const renamed = serializePlan(applyLabels(parsePlan(plan), { ...parsePlan(plan).labels, 퍼블: '계획' }))
  const handEdited = renamed.replace('| 박민수 | - | 퍼블 | 25 |', '| 박민수 | - | 계획 | 25 |')
  assert.equal(parsePlan(handEdited).tasks[0].status, '퍼블')
})

test('페이지 제목은 plan 첫 줄 제목으로 저장되고 빈 값은 막는다', () => {
  const saved = serializePlan(applyTitle(parsePlan(plan), '  ESG 운영 보드  '))
  assert.equal(saved.split('\n')[0], '# ESG 운영 보드')
  assert.equal(parsePlan(saved).title, 'ESG 운영 보드')
  assert.throws(() => applyTitle(parsePlan(plan), '   '), /페이지 제목을 입력/)
})

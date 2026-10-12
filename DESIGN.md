# Static Schedule Design System

## 1. Atmosphere & Identity

조용하고 밀도 높은 사내 운영 보드다. 장식보다 정보의 위치와 상태를 빠르게 읽는 것이 우선이며, 흰 패널과 옅은 청회색 경계, 단일 파란색 상호작용 강조가 시각적 서명이다. 기존 화면의 엑셀형 표와 우측 drawer 패턴을 유지한다.

## 2. Color

| Role | Token / value | Usage |
| --- | --- | --- |
| Page | `--bg: #f5f7fb` | 전체 배경 |
| Panel | `--panel: #ffffff` | 패널, drawer, 표 |
| Border | `--line: #e3e8f0` | 패널과 입력 경계 |
| Text | `--text: #1e293b` | 본문과 제목 |
| Muted | `--muted: #64748b` | 설명, 보조 값 |
| Accent | `--blue: #2f6fed` | 선택, 저장, focus |
| Success | `#047857` on `#ecfdf5` | 저장/완료 |
| Warning | `#92400e` on `#fffbeb` | 대기/주의 |
| Error | `#b91c1c` on `#fef2f2` | 오류/삭제 |

새 색은 기존 semantic 역할로 표현할 수 없을 때만 이 표에 먼저 추가한다. 담당자 색은 `src/components/ui.jsx`의 고정 palette를 사용한다.

## 3. Typography

| Level | Size | Weight | Usage |
| --- | --- | --- | --- |
| H1 | 22px | 700 | 화면 제목 |
| Drawer title | 18px | 600 | 편집 drawer 제목 |
| H2 | 15px | 600 | 패널 제목 |
| Body | 14px | 400 | 기본 UI |
| Control | 13px | 400–700 | 입력과 버튼 |
| Caption | 12px | 400–600 | 메타데이터, 도움말 |
| Micro | 11px | 400–600 | 배지, 완료 시각 |

기본 글꼴은 `-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Pretendard, Malgun Gothic, sans-serif`다. 식별자와 시각은 `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace`를 쓴다.

## 4. Spacing & Layout

- 기본 단위는 4px다. 주 사용 간격은 4, 8, 12, 16, 20, 24px다.
- `.shell`은 최대 1440px이며 페이지 scroll을 소유한다.
- task sheet는 `.sheet-wrap`이 세로/가로 scroll을 소유하고, 표는 최소 1240px 너비를 보존한다.
- filter/action 영역은 wrapping cluster다. 좁은 화면에서도 컨트롤이 겹치지 않고 다음 줄로 이동한다.
- drawer는 desktop에서 최대 440px, 640px 이하에서는 전체 너비다.

## 5. Components

### Panel
- **Structure**: 제목/도움말 + 내용.
- **Variants**: default, error, guide.
- **States**: 내용 있음, 비어 있음, 오류.
- **Accessibility**: 오류는 `role="alert"`로 노출한다.

### Form control
- **Structure**: 위쪽 label + input/select + 필요 시 아래 도움말/오류.
- **States**: default, hover, focus, disabled, invalid.
- **Accessibility**: placeholder를 label 대신 쓰지 않고 visible label을 유지한다.

### Action button
- **Variants**: primary blue, ghost, destructive red.
- **States**: default, hover, active, focus-visible, disabled, busy.
- **Accessibility**: 동작을 설명하는 텍스트/`aria-label`을 제공하고 destructive 동작은 확인을 거친다.

### Task sheet
- **Structure**: sticky header + task rows + 선택적 detail row.
- **Variants**: read-only, admin edit, maintain edit.
- **States**: normal, selected, expanded, unassigned, empty.
- **Accessibility**: 셀 control 조작은 행 펼침을 유발하지 않으며 모든 control은 키보드로 접근 가능하다.
- **Layout**: `.sheet-wrap`이 scroll owner다.

### Editor drawer
- **Structure**: backdrop + title/close header + labeled grid form + footer actions.
- **Variants**: memo, task add, task edit.
- **States**: create/edit, validation error, saving/disabled.
- **Accessibility**: `role="dialog"`, `aria-modal`, Escape 닫기, focusable 요소 내부 순환, 명시적 취소/저장 버튼.
- **Layout**: 오른쪽 고정 drawer이며 mobile에서는 full-width다.

## 6. Motion & Interaction

- 상태 변화는 즉시 보여 주며 width/opacity/transform만 100–250ms로 전환한다.
- drawer는 별도 장식 animation 없이 즉시 열려 운영 속도를 우선한다.
- `prefers-reduced-motion`에서는 비필수 pulse를 끈다.
- 행 추가/수정은 drawer 저장 시 한 번만 Markdown 저장을 요청한다. 삭제는 확인 후 즉시 저장한다.

## 7. Depth & Surface

전략은 **borders-first mixed**다. 일반 패널과 표는 1px 경계와 미세한 tonal shift로 구분하고, 화면 위에 뜨는 drawer만 방향성 shadow를 사용한다. 새로운 일반 카드에 shadow를 추가하지 않는다.

## 8. Accessibility Constraints & Accepted Debt

- WCAG 2.2 AA를 목표로 하며 본문 4.5:1, 큰 글자/비텍스트 control 3:1 대비를 유지한다.
- 모든 입력은 label과 focus 표시를 가지며, 삭제는 대상 작업명을 포함한 확인 문구를 쓴다.
- 375px에서 drawer form은 한 열로 재배치되고 한국어 label/버튼 문구가 잘리거나 한 글자만 고립되지 않아야 한다.
- 기존 task sheet는 업무상 2차원 데이터 표이므로 좁은 화면에서 가로 scroll을 유지한다.

### Accepted Debt

| Item | Location | Why accepted | Exit |
| --- | --- | --- | --- |
| 기존 CSS의 일부 색/간격이 변수화되지 않음 | `src/styles.css` | 이번 요청은 기능 추가이며 전면 token refactor는 사용자 변경과 충돌 위험이 큼 | 별도 디자인 정리 작업에서 통합 |
| React 개발 진단 도구 미설치 | project tooling | 런타임 의존성 없는 현재 배포 계약과 요청 범위를 보존 | 사용자가 dev dependency 추가를 승인할 때 |

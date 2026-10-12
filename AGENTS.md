# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-27
**Commit:** 3a27e07
**Branch:** main

## OVERVIEW

Internal ESG scheduling board: a React 18/Vite UI reads and edits dated Markdown
plans through a dependency-free Node HTTP API. Root `plan-YYMMDD.md` files are the
single runtime source of truth for schedule, IA, and task-to-screen mappings.

## STRUCTURE

```text
static-schedule/
├── src/                    # React UI and Markdown plan codec
│   ├── components/         # Dashboard, schedule, task, and screen views
│   └── lib/                # Markdown plan state, IA, and screen mapping
├── server/                 # Shared auth and plan API plus production server
├── plan-YYMMDD.md          # Versioned, mutable schedule data
├── vite.config.js          # Dev server plus the production API middleware
└── docker-compose.yml      # Persistent deployment with root mounted at /data
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| App loading, saving, tabs | `src/App.jsx` | Owns polling, optimistic concurrency, and read/admin mode |
| Markdown plan parsing | `src/lib/planMd.js` | Parses tasks, IA, and screens; preserves unmanaged Markdown |
| Main schedule table | `src/components/TaskTable.jsx` | Largest UI/behavior hotspot |
| Maintain settings drawers | `src/components/MaintainEditors.jsx` | Roster, week schedule, page title and label editors |
| Screen hierarchy display | `src/components/ScreenList.jsx` | Consumes the selected plan's IA and screen tables |
| Task-to-screen mapping | `src/lib/planMd.js` | Resolves plan-owned stable work keys and IA paths |
| Plan file HTTP API | `server/planApi.mjs` | Shared by Vite development and production; `POST /plan-version` copies the latest plan to today's date |
| Admin sessions | `server/auth.mjs` | HMAC cookie; password is re-read per request |
| Production serving | `server/index.mjs` | Serves `dist/` and mounts auth/API on one port |
| Development middleware | `vite.config.js` | Reuses `server/auth.mjs` and `server/planApi.mjs` |
| Deployment operations | `README.md`, `DEPLOY.txt` | Docker and direct Node workflows |

## CODE MAP

LSP was unavailable during generation; symbols and import relationships were
measured with validated ast-grep searches.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `App` | React component | `src/App.jsx` | 1 | Browser application coordinator |
| `parsePlan` / `serializePlan` | functions | `src/lib/planMd.js` | 1 module | Markdown-to-state round trip |
| `phaseKey` / `syncStatusProgress` | functions | `src/lib/planMd.js` | 2 modules | Task workflow state rules |
| `TaskTable` | React component | `src/components/TaskTable.jsx` | 1 | Editing and read-only task surface |
| `screensForTask` / `screenIaPath` | functions | `src/lib/planMd.js` | 2 modules | Plan-owned screen association and IA path |
| `ownerColor` | function | `src/components/ui.jsx` | 3 modules | Stable owner color assignment |
| `createPlanApi` | factory | `server/planApi.mjs` | 2 modules | `/plan-file` and `/plan-dates` middleware |
| `createAuth` | factory | `server/auth.mjs` | 2 modules | `/admin/*` authentication middleware |
| `envValue` | function | `server/env.mjs` | 2 modules | Environment and `.env` precedence |


## CONVENTIONS

- Plans are named exactly `plan-YYMMDD.md`; latest date is the default.
- Root plan Markdown is the database. Saves preserve unmanaged sections and create
  `plan-YYMMDD.md.bak` immediately before replacement.
- Stored sections: `# 제목`, `## 담당자`, `## 표시 설정`, `## 주차 일정`, `## IA`, `## 작업 목록`,
  `## 화면 목록`, `## 릴리즈 이력`. Derived on every save (`refreshDerived`/`serializePlan`): task `공수`
  (linked screen count), `프로젝트 기간`, `## 대분류별 주차 공수`, `## 종료 기준 누적 완료율`. Never hand-maintain
  derived values in code paths; recompute them.
- Task `상태` cells store the codes 대기/퍼블/검수; display names come from `## 표시 설정`.
- `/maintain` owns structural edits (task rows, roster, weeks, labels, page title, version copy);
  `/admin` edits assignment, status, progress, memo and releases only.
- `/` is read-only; `/admin` exposes editing, while `PUT /plan-file` remains the
  authoritative authorization boundary.
- Development and production must reuse `createAuth` and `createPlanApi`; do not
  create a second API implementation in Vite.
- IA and screen mappings live inside each plan file. Runtime and builds must not depend
  on external screen-map JSON or Domain Atlas.
- UI text and operational documentation are primarily Korean.
- Port `5180`, `PLAN_DIR`, and `Asia/Seoul` timestamps are deployment contracts.

## ANTI-PATTERNS (THIS PROJECT)

- Do not reintroduce `screen-map.json`, generated `screens.json`, or runtime Atlas calls.
- Do not scrape authoritative screen assignments from task notes in structured plans;
  use `## IA`, stable task keys, and `## 화면 목록`.
- Do not silently accept duplicate screen IDs or broken IA/work-key references.
- Do not treat read-only controls as the security boundary; server-side `PUT`
  authorization is mandatory.
- Do not add production runtime dependencies casually: the final Docker image runs
  `server/index.mjs` without `node_modules`.

## UNIQUE STYLES

- Structured plans carry an IA tree plus stable work-key screen assignments.
- Legacy plans synthesize IA and screen rows only from their own task table and notes.
- Concurrent plan saves use file `mtime` as an optimistic lock and return `409`
  with the current plan.
- Admin sessions are stateless HMAC cookies keyed by the live password; changing
  `.env` invalidates existing sessions without a restart.

## COMMANDS

```bash
npm install
npm run dev
npm test
npm run build
PLAN_DIR="$PWD" npm start
docker compose up -d --build
docker compose logs -f
docker compose down
```

## NOTES

- `npm test` covers plan IA/screen parsing, legacy fallback, serialization, integrity
  warnings, plan-owned search text, derived effort/weekly tables, roster/week/label/title edits
  (`test/planSot.test.mjs`), and the version-copy API (`test/planApi.test.mjs`).
- `TaskTable.jsx`, `App.jsx`, `src/lib/planMd.js`, `src/styles.css`, and
  `ScreenList.jsx` are the main review hotspots.
- `dist/`, backup files, local `.env`, and `.DS_Store` are intentionally ignored.

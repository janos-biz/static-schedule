// 계획 파일(plan-YYMMDD.md) 읽기/쓰기 API.
//
// 개발(vite dev 미들웨어)과 운영(docker 안의 node 서버)이 같은 코드를 쓴다.
// planDir 만 다르다.
//   - 개발: 프로젝트 루트
//   - 운영: docker-compose.yml 이 있는 폴더를 컨테이너의 /data 로 마운트한 것
import fs from 'node:fs/promises'
import path from 'node:path'

// 날짜별 계획 파일: plan-YYMMDD.md (예: plan-260806.md)
const PLAN_RE = /^plan-(\d{6})\.md$/

// 서버 시간대(TZ) 기준 오늘 날짜를 파일명 형식(YYMMDD)으로.
export const todayYYMMDD = (now = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0')
  return `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

// canWrite(req) 로 저장 권한을, canVersion(req) 로 새 버전 파일 만들기 권한을 판단한다.
// 읽기(GET)는 누구나, 저장(PUT)은 로그인한 사람만, 버전 복제(POST /plan-version)는 /maintain 역할만.
export function createPlanApi(
  planDir,
  { canWrite = () => true, canVersion = () => true, today = todayYYMMDD } = {},
) {
  const root = path.resolve(planDir)
  const planPath = (date) => path.resolve(root, `plan-${date}.md`)
  const backupPath = (date) => path.resolve(root, `plan-${date}.md.bak`)

  // 날짜 목록을 최신순으로. 파일명에서만 뽑으므로 경로 조작이 끼어들 수 없다.
  const listDates = async () => {
    const names = await fs.readdir(root)
    return names
      .map((name) => name.match(PLAN_RE)?.[1])
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))
  }

  const readPlan = async (date) => {
    const file = planPath(date)
    const [content, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
    return { date, content, mtime: stat.mtimeMs }
  }

  const json = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }

  // ?date=260806 이 없으면 가장 최근 날짜를 쓴다.
  const resolveDate = async (raw) => {
    const dates = await listDates()
    if (dates.length === 0) {
      return { error: `계획 파일(plan-YYMMDD.md)이 없습니다. (${root})` }
    }
    if (!raw) return { date: dates[0], dates }
    if (!/^\d{6}$/.test(raw)) return { error: '날짜 형식이 올바르지 않습니다. (YYMMDD)' }
    if (!dates.includes(raw)) return { error: `plan-${raw}.md 파일이 없습니다.` }
    return { date: raw, dates }
  }

  // connect 스타일 미들웨어. 우리 경로가 아니면 next() 로 넘긴다.
  return async function planApi(req, res, next) {
    try {
      const [url, search] = (req.url ?? '').split('?')
      if (url !== '/plan-file' && url !== '/plan-dates' && url !== '/plan-version') return next()

      if (url === '/plan-dates') {
        return json(res, 200, { dates: await listDates() })
      }

      // 최신 plan 파일을 내용 그대로 복제해 plan-<오늘>.md 를 만든다. 기존 파일은 절대 덮어쓰지 않는다.
      if (url === '/plan-version') {
        if (req.method !== 'POST') return next()
        if (!canVersion(req)) {
          return json(res, 401, { error: '버전 업데이트 권한이 없습니다. /maintain 에서 다시 로그인해 주세요.' })
        }
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const { date: source, baseMtime } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const dates = await listDates()
        const target = today()
        if (!source || source !== dates[0]) {
          return json(res, 409, { error: '최신 plan 파일을 보고 있을 때만 새 버전을 만들 수 있습니다.', dates })
        }
        if (dates.includes(target)) {
          return json(res, 409, { error: `plan-${target}.md 가 이미 있습니다. 오늘 버전은 하나만 만들 수 있습니다.`, dates })
        }
        const current = await readPlan(source)
        if (baseMtime && Math.abs(current.mtime - baseMtime) > 1) {
          return json(res, 409, { error: '다른 사용자가 먼저 저장했습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.', dates })
        }
        // wx: 그 사이 같은 이름이 생겼으면 실패한다(동시 클릭 대비).
        try {
          await fs.writeFile(planPath(target), current.content, { encoding: 'utf8', flag: 'wx' })
        } catch (err) {
          if (err?.code !== 'EEXIST') throw err
          return json(res, 409, { error: `plan-${target}.md 가 이미 있습니다.`, dates: await listDates() })
        }
        return json(res, 201, { ...(await readPlan(target)), dates: await listDates() })
      }

      // 화면에서 편집 UI를 감추는 것과 별개로, 파일을 실제로 바꾸는 길은 여기서 막는다.
      if (req.method === 'PUT' && !canWrite(req)) {
        return json(res, 401, { error: '편집 권한이 없습니다. /admin 에서 다시 로그인해 주세요.' })
      }

      const raw = new URLSearchParams(search ?? '').get('date') ?? ''
      const resolved = await resolveDate(raw)
      if (resolved.error) return json(res, 404, { error: resolved.error })
      const { date, dates } = resolved

      if (req.method === 'GET') {
        return json(res, 200, { ...(await readPlan(date)), dates })
      }

      if (req.method === 'PUT') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const { content, baseMtime } = JSON.parse(Buffer.concat(chunks).toString('utf8'))

        if (typeof content !== 'string' || !content.includes('작업 목록')) {
          return json(res, 400, { error: '저장할 내용이 올바르지 않습니다.' })
        }

        const current = await readPlan(date)
        // 다른 사람이 먼저 저장했으면 덮어쓰지 않는다.
        if (baseMtime && Math.abs(current.mtime - baseMtime) > 1) {
          return json(res, 409, { error: '다른 사용자가 먼저 저장했습니다.', ...current, dates })
        }

        await fs.writeFile(backupPath(date), current.content, 'utf8')
        await fs.writeFile(planPath(date), content, 'utf8')
        const stat = await fs.stat(planPath(date))
        return json(res, 200, { ok: true, date, mtime: stat.mtimeMs })
      }

      next()
    } catch (err) {
      json(res, 500, { error: String(err?.message ?? err) })
    }
  }
}

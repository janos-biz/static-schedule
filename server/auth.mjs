// /admin(편집 화면)과 /maintain(작업 구조 관리) 비밀번호. 읽기 전용 화면과
// 계획 파일 읽기(GET)는 그대로 열려 있고, 저장(PUT /plan-file)만 두 역할 중
// 하나로 로그인한 사람에게 허용한다.
//
// 세션 저장소를 두지 않는다. 쿠키에 `만료시각.서명` 만 담고, 서명은 비밀번호를 열쇠로 한
// HMAC 이라 서버가 다시 떠도 그대로 유효하다. 비밀번호를 바꾸면 기존 쿠키는 전부 무효가 된다.
import crypto from 'node:crypto'

const MAX_AGE = 12 * 60 * 60 // 초. 하루 업무시간이 덮이는 길이.
const ROLES = {
  admin: {
    path: '/admin',
    cookie: 'schedule_admin',
    env: 'ADMIN_PASSWORD',
    label: '편집',
  },
  maintain: {
    path: '/maintain',
    cookie: 'schedule_maintain',
    env: 'MAINTAIN_PASSWORD',
    label: '유지보수',
  },
}

// 로그인 실패가 쌓이면 잠시 막는다. 사내망이라 정교할 필요는 없고, 무작정 대입만 못 하게 한다.
const MAX_FAILS = 5
const LOCK_MS = 60 * 1000

const sign = (password, exp) =>
  crypto.createHmac('sha256', password).update(String(exp)).digest('hex')

// 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다.
const sameSecret = (a, b) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const readCookie = (req, name) =>
  (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? ''

const clientKey = (req) =>
  (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?'

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

// 비밀번호 getter는 요청마다 불린다(.env 를 그때그때 읽는다). 빈 값이면 해당 화면은 잠긴다.
export function createAuth(getAdminPassword, getMaintainPassword = () => '') {
  const fails = new Map()
  const passwordFor = (role) =>
    role === 'maintain' ? getMaintainPassword() : getAdminPassword()

  const isRoleAuthed = (req, role) => {
    const config = ROLES[role]
    const password = passwordFor(role)
    if (!password) return false
    const [exp, sig] = readCookie(req, config.cookie).split('.')
    if (!exp || !sig) return false
    if (Number(exp) * 1000 < Date.now()) return false
    return sameSecret(sig, sign(password, exp))
  }

  const isAuthed = (req) =>
    Object.keys(ROLES).some((role) => isRoleAuthed(req, role))

  const json = (res, status, body, cookie) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (cookie) res.setHeader('Set-Cookie', cookie)
    res.end(JSON.stringify(body))
  }

  // 사내망은 http 라서 Secure 는 붙이지 않는다. HttpOnly 라 스크립트로는 못 읽는다.
  const cookieFor = (role, value, maxAge) =>
    `${ROLES[role].cookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`

  return {
    isAuthed,
    isAdmin: (req) => isRoleAuthed(req, 'admin'),
    isMaintainer: (req) => isRoleAuthed(req, 'maintain'),

    // connect 스타일 미들웨어. 역할별 인증 API가 아니면 next() 로 넘긴다.
    middleware: async function auth(req, res, next) {
      const [url] = (req.url ?? '').split('?')
      const role = Object.keys(ROLES).find((key) => url.startsWith(`${ROLES[key].path}/`))
      if (!role) return next()

      try {
        return await handle(role, url, req, res, next)
      } catch (err) {
        return json(res, 500, { error: String(err?.message ?? err) })
      }
    },
  }

  async function handle(role, url, req, res, next) {
    const config = ROLES[role]
    const password = passwordFor(role)

    if (url === `${config.path}/session` && req.method === 'GET') {
      return json(res, 200, { configured: Boolean(password), authed: isRoleAuthed(req, role) })
    }

    if (url === `${config.path}/logout` && req.method === 'POST') {
      return json(res, 200, { ok: true }, cookieFor(role, '', 0))
    }

    if (url === `${config.path}/login` && req.method === 'POST') {
      if (!password) {
        return json(res, 503, {
          error: `${config.label} 비밀번호가 설정돼 있지 않습니다. 서버 폴더의 .env 에 ${config.env} 를 넣고 다시 시도해 주세요.`,
        })
      }

      const key = `${role}:${clientKey(req)}`
      const record = fails.get(key)
      if (record && record.count >= MAX_FAILS && record.until > Date.now()) {
        const left = Math.ceil((record.until - Date.now()) / 1000)
        return json(res, 429, { error: `로그인 시도가 많습니다. ${left}초 후에 다시 시도해 주세요.` })
      }

      const body = await readBody(req)
      if (typeof body.password !== 'string' || !sameSecret(body.password, password)) {
        const count = (record?.until > Date.now() ? record.count : 0) + 1
        fails.set(key, { count, until: Date.now() + LOCK_MS })
        return json(res, 401, { error: '비밀번호가 맞지 않습니다.' })
      }

      fails.delete(key)
      const exp = Math.floor(Date.now() / 1000) + MAX_AGE
      return json(
        res,
        200,
        { ok: true },
        cookieFor(role, `${exp}.${sign(password, exp)}`, MAX_AGE),
      )
    }

    return next()
  }
}

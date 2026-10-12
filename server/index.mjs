#!/usr/bin/env node
// 운영용 서버. vite build 결과물(dist)을 그대로 내보내면서
// 계획 파일 API(/plan-file, /plan-dates)를 같은 포트에서 처리한다.
//
// 환경 변수
//   PLAN_DIR        계획 파일(plan-YYMMDD.md)이 있는 폴더. docker 에서는 /data (기본값: 현재 폴더)
//   DIST_DIR        정적 파일 폴더 (기본값: <프로젝트>/dist)
//   PORT            수신 포트 (기본값: 5180)
//   ADMIN_PASSWORD  /admin 편집 화면 비밀번호. 보통은 환경변수 대신 계획 파일 폴더의 .env 에 적는다
//   MAINTAIN_PASSWORD /maintain 작업 구조 관리 화면 비밀번호. ADMIN_PASSWORD와 별도로 쓴다
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlanApi } from './planApi.mjs'
import { createAuth } from './auth.mjs'
import { envValue } from './env.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLAN_DIR = path.resolve(process.env.PLAN_DIR || process.cwd())
const DIST_DIR = path.resolve(process.env.DIST_DIR || path.join(HERE, '..', 'dist'))
const PORT = Number(process.env.PORT || 5180)
const ROOT_DIR = path.join(HERE, '..')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const auth = createAuth(
  () => envValue('ADMIN_PASSWORD', [PLAN_DIR, ROOT_DIR]),
  () => envValue('MAINTAIN_PASSWORD', [PLAN_DIR, ROOT_DIR]),
)
const planApi = createPlanApi(PLAN_DIR, { canWrite: auth.isAuthed, canVersion: auth.isMaintainer })

// dist 안의 파일만 내보낸다. 없는 경로는 index.html 로 떨어뜨린다(주소의 ?date= 만 쓰므로 충분).
async function sendStatic(req, res) {
  const [url] = (req.url ?? '/').split('?')
  const wanted = url === '/' ? '/index.html' : decodeURIComponent(url)
  let file = path.resolve(DIST_DIR, `.${wanted}`)

  // dist 바깥으로 나가는 경로는 받지 않는다.
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR + path.sep)) file = path.join(DIST_DIR, 'index.html')

  let body
  try {
    body = await fs.readFile(file)
  } catch {
    file = path.join(DIST_DIR, 'index.html')
    try {
      body = await fs.readFile(file)
    } catch {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.end(`빌드 결과물이 없습니다. npm run build 후 다시 실행하세요. (${DIST_DIR})`)
    }
  }

  const ext = path.extname(file)
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
  // 파일명에 해시가 붙는 assets 만 오래 캐시하고, index.html 은 매번 새로 받게 한다.
  res.setHeader(
    'Cache-Control',
    file.startsWith(path.join(DIST_DIR, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-store',
  )
  res.end(req.method === 'HEAD' ? undefined : body)
}

const server = http.createServer((req, res) => {
  // POST 는 역할별 login · logout 에만 쓴다.
  if (!['GET', 'HEAD', 'PUT', 'POST'].includes(req.method)) {
    res.statusCode = 405
    return res.end()
  }
  auth.middleware(req, res, () => planApi(req, res, () => sendStatic(req, res)))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[static-schedule] http://0.0.0.0:${PORT}`)
  console.log(`[static-schedule] 계획 파일 폴더: ${PLAN_DIR}`)
  console.log(
    envValue('ADMIN_PASSWORD', [PLAN_DIR, ROOT_DIR])
      ? '[static-schedule] 편집(/admin) 비밀번호: 설정됨'
      : `[static-schedule] 편집(/admin) 비밀번호가 없습니다. ${PLAN_DIR}/.env 에 ADMIN_PASSWORD 를 넣어 주세요.`,
  )
  console.log(
    envValue('MAINTAIN_PASSWORD', [PLAN_DIR, ROOT_DIR])
      ? '[static-schedule] 유지보수(/maintain) 비밀번호: 설정됨'
      : `[static-schedule] 유지보수(/maintain) 비밀번호가 없습니다. ${PLAN_DIR}/.env 에 MAINTAIN_PASSWORD 를 넣어 주세요.`,
  )
})

// docker stop 에 곧바로 반응하도록.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

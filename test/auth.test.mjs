import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAuth } from '../server/auth.mjs'
import { createPlanApi } from '../server/planApi.mjs'

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })

const close = (server) => new Promise((resolve) => server.close(resolve))

const startAuthServer = async (password = 'admin-secret', maintainPassword = '') => {
  const auth = createAuth(() => password, () => maintainPassword)
  const server = http.createServer((req, res) => {
    auth.middleware(req, res, () => {
      res.statusCode = auth.isAuthed(req) ? 200 : 401
      res.end()
    })
  })
  return { auth, server, origin: await listen(server) }
}

test('admin password creates a session that authorizes protected writes', async (t) => {
  const { server, origin } = await startAuthServer()
  t.after(() => close(server))

  const login = await fetch(`${origin}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin-secret' }),
  })

  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')
  assert.match(cookie, /^schedule_admin=/)

  const protectedResponse = await fetch(`${origin}/protected`, {
    headers: { Cookie: cookie },
  })
  assert.equal(protectedResponse.status, 200)

  const session = await fetch(`${origin}/admin/session`, {
    headers: { Cookie: cookie },
  })
  assert.deepEqual(await session.json(), { configured: true, authed: true })
})

test('plan writes reject requests without an authenticated session', async (t) => {
  const planDir = await fs.mkdtemp(path.join(os.tmpdir(), 'static-schedule-auth-'))
  await fs.writeFile(
    path.join(planDir, 'plan-260904.md'),
    '# 테스트 계획\n\n## 작업 목록\n\n| ID | 중분류 |\n| --- | --- |\n| T01 | 기존 작업 |\n',
  )
  t.after(() => fs.rm(planDir, { recursive: true, force: true }))

  const auth = createAuth(() => 'admin-secret')
  const planApi = createPlanApi(planDir, { canWrite: auth.isAuthed })
  const server = http.createServer((req, res) => {
    auth.middleware(req, res, () =>
      planApi(req, res, () => {
        res.statusCode = 404
        res.end()
      }),
    )
  })
  t.after(() => close(server))
  const origin = await listen(server)

  const response = await fetch(`${origin}/plan-file?date=260904`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: '# 테스트 계획\n\n## 작업 목록\n', baseMtime: 0 }),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    error: '편집 권한이 없습니다. /admin 에서 다시 로그인해 주세요.',
  })
})

test('maintain password creates its own session and rejects the admin password', async (t) => {
  const { server, origin } = await startAuthServer('admin-secret', 'maintain-secret')
  t.after(() => close(server))

  const wrongRole = await fetch(`${origin}/maintain/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin-secret' }),
  })
  assert.equal(wrongRole.status, 401)

  const login = await fetch(`${origin}/maintain/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'maintain-secret' }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')
  assert.match(cookie, /^schedule_maintain=/)

  const session = await fetch(`${origin}/maintain/session`, {
    headers: { Cookie: cookie },
  })
  assert.deepEqual(await session.json(), { configured: true, authed: true })
})

test('admin and maintain cookies do not authenticate the other role session', async (t) => {
  const { server, origin } = await startAuthServer('admin-secret', 'maintain-secret')
  t.after(() => close(server))

  const adminLogin = await fetch(`${origin}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin-secret' }),
  })
  const adminCookie = adminLogin.headers.get('set-cookie')

  const maintainSession = await fetch(`${origin}/maintain/session`, {
    headers: { Cookie: adminCookie },
  })
  assert.deepEqual(await maintainSession.json(), { configured: true, authed: false })
})

test('maintain session authorizes plan writes', async (t) => {
  const planDir = await fs.mkdtemp(path.join(os.tmpdir(), 'static-schedule-maintain-'))
  const planFile = path.join(planDir, 'plan-260904.md')
  const original = '# 테스트 계획\n\n## 작업 목록\n\n| ID | 중분류 |\n| --- | --- |\n| T01 | 기존 작업 |\n'
  await fs.writeFile(planFile, original)
  t.after(() => fs.rm(planDir, { recursive: true, force: true }))

  const auth = createAuth(() => 'admin-secret', () => 'maintain-secret')
  const planApi = createPlanApi(planDir, { canWrite: auth.isAuthed })
  const server = http.createServer((req, res) => {
    auth.middleware(req, res, () =>
      planApi(req, res, () => {
        res.statusCode = 404
        res.end()
      }),
    )
  })
  t.after(() => close(server))
  const origin = await listen(server)

  const login = await fetch(`${origin}/maintain/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'maintain-secret' }),
  })
  const cookie = login.headers.get('set-cookie')
  const current = await fetch(`${origin}/plan-file?date=260904`).then((response) => response.json())
  const updated = original.replace('기존 작업', '유지보수 작업')

  const save = await fetch(`${origin}/plan-file?date=260904`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ content: updated, baseMtime: current.mtime }),
  })

  assert.equal(save.status, 200)
  assert.equal(await fs.readFile(planFile, 'utf8'), updated)
})

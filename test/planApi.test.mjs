import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { createPlanApi } from '../server/planApi.mjs'

const call = async (api, method, url, body) => {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
  req.method = method
  req.url = url
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(text) {
      this.body = text ? JSON.parse(text) : null
    },
  }
  let passed = false
  await api(req, res, () => {
    passed = true
  })
  return { status: res.statusCode, body: res.body, passed }
}

const setup = async (files) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-api-'))
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(dir, name), content)
  return dir
}

test('버전 업데이트는 최신 plan을 내용 그대로 plan-<오늘>.md 로 복제한다', async () => {
  const dir = await setup({ 'plan-261001.md': '# 옛판\n## 작업 목록\n', 'plan-261008.md': '# 최신\n## 작업 목록\n' })
  const api = createPlanApi(dir, { today: () => '261009' })
  const { mtime } = (await call(api, 'GET', '/plan-file?date=261008')).body

  const created = await call(api, 'POST', '/plan-version', { date: '261008', baseMtime: mtime })

  assert.equal(created.status, 201)
  assert.equal(created.body.date, '261009')
  assert.deepEqual(created.body.dates, ['261009', '261008', '261001'])
  assert.equal(await fs.readFile(path.join(dir, 'plan-261009.md'), 'utf8'), '# 최신\n## 작업 목록\n')
  assert.equal(await fs.readFile(path.join(dir, 'plan-261008.md'), 'utf8'), '# 최신\n## 작업 목록\n')
})

test('버전 업데이트는 최신이 아닌 파일 · 이미 있는 오늘 파일 · 권한 없는 요청을 막는다', async () => {
  const dir = await setup({ 'plan-261001.md': '# 옛판\n', 'plan-261008.md': '# 최신\n' })

  const notLatest = await call(createPlanApi(dir, { today: () => '261009' }), 'POST', '/plan-version', { date: '261001' })
  assert.equal(notLatest.status, 409)

  const sameDay = await call(createPlanApi(dir, { today: () => '261008' }), 'POST', '/plan-version', { date: '261008' })
  assert.equal(sameDay.status, 409)
  assert.match(sameDay.body.error, /plan-261008\.md 가 이미 있습니다/)

  const denied = await call(
    createPlanApi(dir, { today: () => '261009', canVersion: () => false }),
    'POST',
    '/plan-version',
    { date: '261008' },
  )
  assert.equal(denied.status, 401)
  assert.deepEqual((await fs.readdir(dir)).sort(), ['plan-261001.md', 'plan-261008.md'])
})

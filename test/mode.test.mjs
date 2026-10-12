import test from 'node:test'
import assert from 'node:assert/strict'

const loadMode = async (pathname) => {
  globalThis.window = { location: { pathname } }
  return import(`../src/lib/mode.js?path=${encodeURIComponent(pathname)}-${Date.now()}`)
}

test('root route is read-only while admin route is editable', async (t) => {
  t.after(() => {
    delete globalThis.window
  })

  const root = await loadMode('/')
  assert.equal(root.canEdit, false)

  const admin = await loadMode('/admin')
  assert.equal(admin.canEdit, true)
})

test('maintain route is editable with structural task permissions only there', async (t) => {
  t.after(() => {
    delete globalThis.window
  })

  const maintain = await loadMode('/maintain')
  assert.equal(maintain.canEdit, true)
  assert.equal(maintain.canMaintain, true)

  const admin = await loadMode('/admin/')
  assert.equal(admin.canEdit, true)
  assert.equal(admin.canMaintain, false)

  const root = await loadMode('/')
  assert.equal(root.canMaintain, false)
})

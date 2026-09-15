import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UpdateController, type UpdateBackend } from './updateController.ts'

test('启动立即检查，但发现更新不会自行下载或安装', async () => {
  let checks = 0
  let downloads = 0
  let installs = 0
  const backend: UpdateBackend = {
    async check() { checks++; return '0.2.0' },
    async download() { downloads++ },
    async install() { installs++ }
  }
  const c = new UpdateController('0.1.0', true, backend, () => {})
  c.start(true)
  await c.check()
  c.stop()
  assert.equal(checks, 1)
  assert.equal(c.current.state, 'available')
  assert.equal(c.current.latest, '0.2.0')
  assert.equal(downloads, 0)
  assert.equal(installs, 0)
})

test('点击更新走下载、进度和安装，重复点击只执行一次', async () => {
  let downloads = 0
  let installs = 0
  const states: string[] = []
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    async download(progress) { downloads++; progress(50); await Promise.resolve() },
    async install() { installs++ }
  }, (s) => states.push(`${s.state}:${s.percent ?? ''}`))
  await c.check()
  await Promise.all([c.installNow(), c.installNow(), c.check()])
  assert.equal(downloads, 1)
  assert.equal(installs, 1)
  assert.ok(states.includes('downloading:50'))
  assert.equal(c.current.state, 'installing')
})

test('下载失败保留新版本通知，可以重试，失败时不会安装', async () => {
  let downloads = 0
  let installs = 0
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    async download() { if (++downloads === 1) throw new Error('network failed') },
    async install() { installs++ }
  }, () => {})
  await c.check()
  await c.installNow()
  assert.equal(c.current.state, 'error')
  assert.equal(c.current.latest, '0.2.0')
  assert.equal(installs, 0)
  await c.installNow()
  assert.equal(installs, 1)
  assert.equal(c.current.message, undefined)
})

test('没有更新时点击不会安装，开发运行不会访问更新后端', async () => {
  let calls = 0
  const backend: UpdateBackend = {
    async check() { calls++; return null },
    async download() { assert.fail('unexpected download') },
    async install() { assert.fail('unexpected install') }
  }
  const c = new UpdateController('0.1.0', true, backend, () => {})
  await c.check()
  await c.installNow()
  assert.equal(c.current.state, 'latest')
  const dev = new UpdateController('0.1.0', false, backend, () => {})
  dev.start(true)
  await dev.check()
  await dev.installNow()
  assert.equal(calls, 1)
  assert.equal(dev.current.state, 'dev')
})

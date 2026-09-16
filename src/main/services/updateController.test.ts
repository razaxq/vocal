import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UpdateController, type UpdateBackend } from './updateController.ts'

test('自动更新启动检查并下载，退出前不安装', async () => {
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
  assert.equal(checks, 1)
  assert.equal(c.current.state, 'ready')
  assert.equal(c.current.latest, '0.2.0')
  assert.equal(downloads, 1)
  assert.equal(installs, 0)
  assert.equal(c.installOnQuit, true)
  c.stop()
  assert.equal(c.installOnQuit, false)
})

test('关闭自动更新不后台检查，手动检查不下载，手动安装仍可使用', async () => {
  let checks = 0
  let downloads = 0
  const restartFlags: boolean[] = []
  const c = new UpdateController('0.1.0', true, {
    async check() { checks++; return '0.2.0' },
    async download() { downloads++ },
    async install(restart) { restartFlags.push(restart) }
  }, () => {})
  c.start(false)
  await Promise.resolve()
  assert.equal(checks, 0)
  await c.check()
  assert.equal(downloads, 0)
  assert.equal(c.installOnQuit, false)
  await c.installNow()
  assert.equal(downloads, 1)
  assert.deepEqual(restartFlags, [true])
})

test('检查未完成时关闭自动更新，不启动下载', async () => {
  let finish!: (version: string) => void
  const c = new UpdateController('0.1.0', true, {
    check() { return new Promise(resolve => { finish = resolve }) },
    async download() { assert.fail('unexpected download') },
    async install() { assert.fail('unexpected install') }
  }, () => {})
  c.start(true)
  c.start(false)
  finish('0.2.0')
  await c.check()
  assert.equal(c.current.state, 'available')
  assert.equal(c.installOnQuit, false)
})

test('后台下载与手动更新共用下载，退出安装不重启；重新启用可使用已下载更新', async () => {
  let finish!: () => void
  let downloads = 0
  const restarts: boolean[] = []
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    download() { downloads++; return new Promise(resolve => { finish = resolve }) },
    async install(restart) { restarts.push(restart) }
  }, () => {})
  c.start(true)
  await new Promise(resolve => setImmediate(resolve))
  c.start(false)
  finish()
  await c.check()
  assert.equal(c.current.state, 'ready')
  assert.equal(c.installOnQuit, false)
  c.start(true)
  assert.equal(c.installOnQuit, true)
  await Promise.all([c.installNow(false), c.installNow(false)])
  assert.equal(downloads, 1)
  assert.deepEqual(restarts, [false])
  c.stop()
})

test('下载过程中点击更新不会重复下载；安装失败重试复用已下载文件', async () => {
  let finish!: () => void
  let downloads = 0
  let installs = 0
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    download() { downloads++; return new Promise(resolve => { finish = resolve }) },
    async install() { if (++installs === 1) throw new Error('busy') }
  }, () => {})
  c.start(true)
  await new Promise(resolve => setImmediate(resolve))
  const pending = c.installNow()
  finish()
  await pending
  assert.equal(c.current.state, 'error')
  assert.equal(c.installOnQuit, false)
  await c.installNow()
  assert.equal(downloads, 1)
  assert.equal(installs, 2)
  c.stop()
})

test('后台下载失败可在下次检查重试，不自动安装', async () => {
  let downloads = 0
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    async download() { if (++downloads === 1) throw new Error('offline') },
    async install() { assert.fail('unexpected install') }
  }, () => {})
  c.start(true)
  await c.check()
  assert.equal(c.current.state, 'error')
  assert.equal(c.installOnQuit, false)
  await c.check()
  assert.equal(c.current.state, 'ready')
  assert.equal(c.installOnQuit, true)
  c.stop()
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

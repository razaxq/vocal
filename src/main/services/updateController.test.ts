import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UpdateController, type UpdateBackend } from './updateController.ts'

test('关闭自动更新后仍定时检查，退出后停止检查', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  let checks = 0
  const c = new UpdateController('0.1.0', true, {
    async check() { checks++; return null },
    async download() { assert.fail('unexpected download') },
    async install() { assert.fail('unexpected install') }
  }, () => {})
  c.start(false)
  await c.check()
  assert.equal(checks, 1)
  t.mock.timers.tick(6 * 60 * 60 * 1000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2)
  c.stop()
  t.mock.timers.tick(6 * 60 * 60 * 1000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2)
})

test('录音及识别期间暂缓安装，空闲后自动安装且只执行一次', async () => {
  let idle = false
  let downloads = 0
  let installs = 0
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    async download() { downloads++ },
    async install(restart) { assert.equal(restart, true); installs++ }
  }, () => {}, () => idle)
  c.start(true)
  await c.check()
  assert.equal(c.current.state, 'ready')
  await c.resumeAutoUpdate()
  assert.equal(installs, 0)
  idle = true
  await Promise.all([c.resumeAutoUpdate(), c.resumeAutoUpdate()])
  assert.equal(downloads, 1)
  assert.equal(installs, 1)
  c.stop()
})

test('等待识别结束期间关闭自动更新，空闲后仍需手动安装', async () => {
  let idle = false
  let installs = 0
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    async download() {},
    async install() { installs++ }
  }, () => {}, () => idle)
  c.start(true)
  await c.check()
  c.start(false)
  idle = true
  await c.resumeAutoUpdate()
  assert.equal(installs, 0)
  await c.installNow()
  assert.equal(installs, 1)
  c.stop()
})

test('检查尚未返回时点击更新，不与自动更新互相等待或重复安装', async () => {
  let finish!: (version: string) => void
  let downloads = 0
  let installs = 0
  const c = new UpdateController('0.1.0', true, {
    check() { return new Promise(resolve => { finish = resolve }) },
    async download() { downloads++ },
    async install() { installs++ }
  }, () => {})
  c.start(true)
  const pending = c.installNow()
  finish('0.2.0')
  await pending
  assert.equal(downloads, 1)
  assert.equal(installs, 1)
  c.stop()
})

test('开启自动更新时启动检查、下载并立即安装重启', async () => {
  let checks = 0
  let downloads = 0
  let installs = 0
  const backend: UpdateBackend = {
    async check() { checks++; return '0.2.0' },
    async download() { downloads++ },
    async install(restart) { assert.equal(restart, true); installs++ }
  }
  const c = new UpdateController('0.1.0', true, backend, () => {})
  c.start(true)
  await c.check()
  assert.equal(checks, 1)
  assert.equal(c.current.state, 'installing')
  assert.equal(c.current.latest, '0.2.0')
  assert.equal(downloads, 1)
  assert.equal(installs, 1)
  c.stop()
})

test('关闭自动更新仍在启动时检查并提示，点击后才下载和安装', async () => {
  let checks = 0
  let downloads = 0
  const restartFlags: boolean[] = []
  const c = new UpdateController('0.1.0', true, {
    async check() { checks++; return '0.2.0' },
    async download() { downloads++ },
    async install(restart) { restartFlags.push(restart) }
  }, () => {})
  c.start(false)
  await c.check()
  assert.equal(checks, 1)
  assert.equal(c.current.state, 'available')
  assert.equal(downloads, 0)
  await c.installNow()
  assert.equal(downloads, 1)
  assert.deepEqual(restartFlags, [true])
  c.stop()
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
  c.stop()
})

test('下载中关闭自动更新不安装，重新启用后直接安装已下载更新', async () => {
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
  assert.deepEqual(restarts, [])
  c.start(true)
  await c.resumeAutoUpdate()
  assert.equal(downloads, 1)
  assert.deepEqual(restarts, [true])
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
  await c.installNow()
  assert.equal(downloads, 1)
  assert.equal(installs, 2)
  c.stop()
})

test('后台下载失败可在下次检查重试，成功后才安装', async () => {
  let downloads = 0
  let installs = 0
  const c = new UpdateController('0.1.0', true, {
    async check() { return '0.2.0' },
    async download() { if (++downloads === 1) throw new Error('offline') },
    async install() { installs++ }
  }, () => {})
  c.start(true)
  await c.check()
  assert.equal(c.current.state, 'error')
  assert.equal(installs, 0)
  await c.check()
  assert.equal(c.current.state, 'installing')
  assert.equal(installs, 1)
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

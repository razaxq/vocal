import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const helper = resolve('resources/update-portable.ps1')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vocal 便携 O'Brien-test-"))
  const stage = join(root, '.vocal-update-test')
  const payload = join(stage, 'payload')
  await mkdir(join(root, 'data', 'models'), { recursive: true })
  await mkdir(join(root, 'resources'))
  await mkdir(join(payload, 'resources'), { recursive: true })
  await writeFile(join(root, 'Vocal.exe'), 'old exe')
  await writeFile(join(root, 'resources', 'app.asar'), 'old app')
  await writeFile(join(root, 'data', 'config.json'), 'user config')
  await writeFile(join(root, 'data', 'models', 'model.onnx'), 'user model')
  await writeFile(join(payload, 'Vocal.exe'), 'new exe')
  await writeFile(join(payload, 'resources', 'app.asar'), 'new app')
  const config = join(stage, 'apply.json')
  return { root, stage, payload, config }
}

test('Windows 便携更新替换程序，保留配置和模型', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  await writeFile(f.config, JSON.stringify({ appDir: f.root, stage: f.stage, parentPid: 0, restart: false }))
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-ConfigPath', f.config], { windowsHide: true })
  assert.equal(await readFile(join(f.root, 'Vocal.exe'), 'utf8'), 'new exe')
  assert.equal(await readFile(join(f.root, 'resources', 'app.asar'), 'utf8'), 'new app')
  assert.equal(await readFile(join(f.root, 'data', 'config.json'), 'utf8'), 'user config')
  assert.equal(await readFile(join(f.root, 'data', 'models', 'model.onnx'), 'utf8'), 'user model')
  assert.equal(await readFile(join(f.stage, 'backup', 'Vocal.exe'), 'utf8'), 'old exe')
})

test('更新助手拒绝越界暂存目录及携带 data 的更新包', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  await writeFile(f.config, JSON.stringify({ appDir: f.root, stage: tmpdir(), parentPid: 0, restart: false }))
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-ConfigPath', f.config]
  await assert.rejects(run('powershell.exe', args, { windowsHide: true }))
  await mkdir(join(f.payload, 'data'))
  await writeFile(f.config, JSON.stringify({ appDir: f.root, stage: f.stage, parentPid: 0, restart: false }))
  await assert.rejects(run('powershell.exe', args, { windowsHide: true }))
  assert.equal(await readFile(join(f.root, 'Vocal.exe'), 'utf8'), 'old exe')
})

test('新程序启动失败时恢复旧程序和资源', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture()
  t.after(() => rm(f.root, { recursive: true, force: true }))
  // 测试 exe 是纯文本，启动必定失败，触发真实的回滚分支。
  await writeFile(f.config, JSON.stringify({ appDir: f.root, stage: f.stage, parentPid: 0, restart: true }))
  await assert.rejects(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-ConfigPath', f.config], { windowsHide: true }))
  assert.equal(await readFile(join(f.root, 'Vocal.exe'), 'utf8'), 'old exe')
  assert.equal(await readFile(join(f.root, 'resources', 'app.asar'), 'utf8'), 'old app')
  assert.equal(await readFile(join(f.root, 'data', 'models', 'model.onnx'), 'utf8'), 'user model')
  assert.equal(JSON.parse(await readFile(join(f.stage, 'result.json'), 'utf8')).ok, false)
})

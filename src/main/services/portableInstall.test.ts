import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import type { PortableUpdater } from './portableUpdater'

const require = createRequire(import.meta.url)
const source = buildSync({ entryPoints: ['src/main/services/portableUpdater.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false,
  external: ['electron', 'extract-zip'] }).outputFiles[0]!.text

for (const restart of [true, false]) {
  test(`便携更新助手使用正确重启设置（restart=${restart}）`, async () => {
    let guards = 0
    let quits = 0
    let detached = 0
    let manifest: { restart: boolean; parentPid: number } | undefined
    const child = Object.assign(new EventEmitter(), { unref() { detached++ }, kill() { assert.fail('unexpected kill') } })
    const module = { exports: {} as { PortableUpdater: typeof PortableUpdater } }
    runInNewContext(source, { module, exports: module.exports,
      process: { pid: 123, env: {}, resourcesPath: 'C:\\Vocal\\resources' },
      require: (name: string) => {
        if (name === 'electron') return { app: { getPath: () => 'C:\\Vocal\\Vocal.exe', quit() { quits++ } } }
        if (name === 'node:fs/promises') return {
          async copyFile() {}, async rm() {}, async readFile() { return 'ready' },
          async writeFile(_path: string, value: string) { manifest = JSON.parse(value) }
        }
        if (name === 'node:child_process') return { spawn: () => child }
        if (name === 'extract-zip') return () => assert.fail('unexpected extraction')
        return require(name)
      }
    })
    const updater = new module.exports.PortableUpdater(() => { guards++ })
    Object.assign(updater, { stage: 'C:\\Vocal\\.vocal-update-test' })
    await updater.install(restart)
    assert.equal(manifest?.restart, restart)
    assert.equal(manifest?.parentPid, 123)
    assert.equal(guards, restart ? 2 : 0)
    assert.equal(quits, 1)
    assert.equal(detached, 1)
  })
}

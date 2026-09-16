import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import type { UpdaterService } from './updater'

// Exercise the real service and controller, mocking only platform/update backends.
const source = buildSync({ entryPoints: ['src/main/services/updater.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, supported: { 'dynamic-import': false },
  external: ['electron', 'electron-updater', './portableUpdater'] }).outputFiles[0]!.text

for (const installed of [true, false]) {
  for (const failure of [false, true]) {
    test(`${installed ? '安装版' : '便携版'}退出时安装、不重启，失败仍正常退出（失败=${failure}）`, async () => {
      let exited = 0
      let prevented = 0
      let beforeInstall = 0
      const restarts: boolean[] = []
      const app = Object.assign(new EventEmitter(), {
        isPackaged: true, getVersion: () => '0.1.0',
        quit() {
          let blocked = false
          app.emit('before-quit', { preventDefault() { blocked = true; prevented++ } })
          if (!blocked) exited++
        }
      })
      const au = Object.assign(new EventEmitter(), {
        autoDownload: true, autoInstallOnAppQuit: true,
        async checkForUpdates() { return { updateInfo: { version: '0.2.0' } } },
        async downloadUpdate() {},
        quitAndInstall(_silent: boolean, restart: boolean) {
          restarts.push(restart)
          if (failure) au.emit('error', new Error('installer failed'))
          else app.quit()
        }
      })
      class PortableUpdater {
        async check() { return '0.2.0' }
        async download() {}
        async install(restart: boolean) {
          restarts.push(restart)
          if (failure) throw new Error('helper failed')
          app.quit()
        }
      }
      const module = { exports: {} as { UpdaterService: typeof UpdaterService } }
      runInNewContext(source, { module, exports: module.exports, setInterval, clearInterval,
        require: (name: string) => {
          if (name === 'electron') return { app }
          if (name === 'electron-updater') return { autoUpdater: au }
          if (name === './portableUpdater') return { PortableUpdater }
          throw new Error('Unexpected import ' + name)
        }
      })
      const service = new module.exports.UpdaterService(installed, () => {}, () => { beforeInstall++ })
      service.start(true)
      await service.check()
      assert.equal(service.current.state, 'ready')
      assert.equal(exited, 0)
      app.quit()
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(restarts, [false])
      assert.equal(prevented, 1)
      assert.equal(exited, 1)
      assert.equal(beforeInstall, 0)
      if (installed) {
        assert.equal(au.autoDownload, false)
        assert.equal(au.autoInstallOnAppQuit, false)
      }
      service.stop()
    })
  }
}

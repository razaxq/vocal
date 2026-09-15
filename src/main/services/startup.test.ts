import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StartupService, STARTUP_ARG } from './startup.ts'

const STARTUP_NAME = 'net.dtft.vocal'

const executable = "C:\\Users\\Jane Doe\\Vocal 便携版\\Vocal.exe"

function fixture(supported = true) {
  let registered = false
  let approved = false
  let writes = 0
  let refuseWrite = false
  const api = {
    getLoginItemSettings(options: { path: string; args: string[] }) {
      assert.equal(options.path, executable)
      assert.deepEqual(options.args, [STARTUP_ARG])
      return {
        openAtLogin: registered,
        launchItems: registered ? [{ name: STARTUP_NAME, scope: 'user', enabled: approved }] : []
      }
    },
    setLoginItemSettings(settings: {
      name: string; path: string; args: string[]; openAtLogin: boolean; enabled: boolean
    }) {
      assert.equal(settings.path, executable)
      assert.equal(settings.name, STARTUP_NAME)
      assert.deepEqual(settings.args, [STARTUP_ARG])
      writes++
      if (!refuseWrite) {
        registered = settings.openAtLogin
        approved = settings.enabled
      }
    }
  }
  return {
    service: new StartupService(api, executable, supported, STARTUP_NAME),
    get writes() { return writes },
    disableInWindows() { approved = false },
    refuse() { refuseWrite = true }
  }
}

test('开机自启使用实际程序路径，关闭后移除启动项', () => {
  const f = fixture()
  assert.equal(f.service.isEnabled(), false)
  f.service.setEnabled(true)
  assert.equal(f.service.isEnabled(), true)
  f.service.setEnabled(false)
  assert.equal(f.service.isEnabled(), false)
})

test('Windows 禁用启动项后如实显示关闭，读取不会擅自重新启用', () => {
  const f = fixture()
  f.service.setEnabled(true)
  f.disableInWindows()
  assert.equal(f.service.isEnabled(), false)
  assert.equal(f.writes, 1)
  f.service.setEnabled(true)
  assert.equal(f.service.isEnabled(), true)
})

test('系统没有写入启动项时报告失败，避免界面误报成功', () => {
  const f = fixture()
  f.refuse()
  assert.throws(() => f.service.setEnabled(true), /未生效/)
  assert.equal(f.service.isEnabled(), false)
})

test('开发运行不注册 Electron 为开机启动程序', () => {
  const f = fixture(false)
  assert.equal(f.service.isEnabled(), false)
  assert.throws(() => f.service.setEnabled(true), /安装版或便携版/)
  assert.equal(f.writes, 0)
})

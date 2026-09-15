export const STARTUP_ARG = '--autostart'

interface LoginItems {
  getLoginItemSettings(options: { path: string; args: string[] }): {
    openAtLogin: boolean
    launchItems: Array<{ name: string; scope: string; enabled: boolean }>
  }
  setLoginItemSettings(settings: {
    name: string; path: string; args: string[]; openAtLogin: boolean; enabled: boolean
  }): void
}

/** 系统启动项是状态来源，尊重用户在 Windows 设置中的禁用操作。 */
export class StartupService {
  private api: LoginItems
  private executable: string
  private supported: boolean
  private appId: string

  constructor(api: LoginItems, executable: string, supported: boolean, appId: string) {
    this.api = api
    this.executable = executable
    this.supported = supported
    this.appId = appId
  }

  isEnabled(): boolean {
    if (!this.supported) return false
    const status = this.api.getLoginItemSettings({ path: this.executable, args: [STARTUP_ARG] })
    return status.openAtLogin && status.launchItems.some(
      (item) => item.name === this.appId && item.scope === 'user' && item.enabled
    )
  }

  setEnabled(enabled: boolean): void {
    if (!this.supported) throw new Error('请在安装版或便携版中设置开机自启')
    this.api.setLoginItemSettings({
      // getLoginItemSettings 的 openAtLogin 按 AppUserModelId 查找启动项。
      name: this.appId, path: this.executable, args: [STARTUP_ARG],
      openAtLogin: enabled, enabled
    })
    if (this.isEnabled() !== enabled) {
      throw new Error('开机自启设置未生效，请检查 Windows 的启动应用设置')
    }
  }
}

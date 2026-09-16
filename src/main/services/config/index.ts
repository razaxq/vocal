/** 配置持久化。electron-store 落盘到 userData/config.json，zod 负责校验与补默认值。 */
import Store from 'electron-store'
import { configSchema, defaultConfig, applyConfigPatch } from '@shared/config'
import type { AppConfig, ConfigPatch } from '@shared/ipc'

export class ConfigService {
  private store = new Store<{ config: AppConfig }>({ name: 'config' })
  private cache: AppConfig

  constructor() {
    const raw = this.store.get('config')
    const parsed = configSchema.safeParse(raw ?? {})
    this.cache = (parsed.success ? parsed.data : defaultConfig()) as AppConfig
    this.store.set('config', this.cache)
  }

  get(): AppConfig { return this.cache }

  set(patch: ConfigPatch): AppConfig {
    const merged = applyConfigPatch(this.cache, patch)
    this.cache = merged
    this.store.set('config', merged)
    return merged
  }
}

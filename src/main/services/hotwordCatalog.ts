import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { MAX_CATALOG_BYTES, parseCatalog, type HotwordCatalog } from '../../shared/hotwordCatalog.ts'
import type { HotwordCatalogStatus } from '../../shared/ipc'

export const CATALOG_URL = 'https://raw.githubusercontent.com/razaxq/vocal/main/src/shared/network-hotwords.json'
const WEEK = 7 * 24 * 60 * 60 * 1000

export class HotwordCatalogService {
  private catalog: HotwordCatalog
  private checkedAt = 0
  private state: HotwordCatalogStatus['state'] = 'idle'
  private message: string | undefined
  private checking: Promise<HotwordCatalogStatus> | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private controller: AbortController | undefined
  private file: string
  private fetcher: (url: string, init?: RequestInit) => Promise<Response>
  private changed: () => void
  private publish: (status: HotwordCatalogStatus) => void

  constructor(
    file: string,
    bundled: HotwordCatalog,
    fetcher: (url: string, init?: RequestInit) => Promise<Response>,
    changed: () => void,
    publish: (status: HotwordCatalogStatus) => void
  ) {
    this.file = file
    this.fetcher = fetcher
    this.changed = changed
    this.publish = publish
    this.catalog = parseCatalog(bundled)
  }

  get current(): HotwordCatalogStatus {
    return { ...this.catalog, words: [...this.catalog.words], state: this.state,
      checkedAt: this.checkedAt || undefined, message: this.message }
  }

  async load(): Promise<void> {
    try {
      if ((await stat(this.file)).size > MAX_CATALOG_BYTES) return
      const cached = JSON.parse(await readFile(this.file, 'utf8'))
      const catalog = parseCatalog(cached.catalog)
      if (catalog.version < this.catalog.version) return
      if (catalog.version === this.catalog.version && JSON.stringify(catalog) !== JSON.stringify(this.catalog)) return
      this.catalog = catalog
      if (Number.isFinite(cached.checkedAt) && cached.checkedAt <= Date.now()) this.checkedAt = cached.checkedAt
    } catch { /* 缺失或损坏时使用随软件附带的词库。 */ }
  }

  start(auto: boolean): void {
    this.stop()
    if (!auto) return
    const due = (): void => { if (Date.now() - this.checkedAt >= WEEK) void this.check() }
    due()
    this.timer = setInterval(due, 24 * 60 * 60 * 1000)
    this.timer.unref()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  dispose(): void { this.stop(); this.controller?.abort() }

  check(): Promise<HotwordCatalogStatus> {
    if (this.checking) return this.checking
    this.checking = this.download().finally(() => { this.checking = null })
    return this.checking
  }

  private async save(catalog: HotwordCatalog, checkedAt: number): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file + '.tmp', JSON.stringify({ catalog, checkedAt }), 'utf8')
    await rename(this.file + '.tmp', this.file)
  }

  private async download(): Promise<HotwordCatalogStatus> {
    this.state = 'checking'
    this.message = undefined
    this.publish(this.current)
    this.controller = new AbortController()
    const timeout = setTimeout(() => this.controller?.abort(), 15000)
    try {
      const response = await this.fetcher(CATALOG_URL, { signal: this.controller.signal, redirect: 'error', headers: { 'Cache-Control': 'no-cache' } })
      if (!response.ok || !response.body) throw new Error('词库下载失败')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_CATALOG_BYTES) throw new Error('词库文件过大')
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      const next = parseCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (next.version < this.catalog.version ||
          (next.version === this.catalog.version && JSON.stringify(next) !== JSON.stringify(this.catalog))) {
        throw new Error('词库版本不匹配')
      }
      const changed = next.version > this.catalog.version
      const checkedAt = Date.now()
      await this.save(next, checkedAt)
      this.catalog = next
      this.checkedAt = checkedAt
      this.state = changed ? 'updated' : 'latest'
      if (changed) this.changed()
    } catch {
      this.state = 'error'
      this.message = '更新失败，继续使用本地词库'
    } finally {
      clearTimeout(timeout)
      this.controller = undefined
    }
    this.publish(this.current)
    return this.current
  }
}

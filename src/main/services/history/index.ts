/**
 * 历史记录：JSONL 追加文件 + 内存索引。
 *
 * 为什么不用 SQLite：
 *   better-sqlite3 是整个项目唯一需要 C++ 工具链的依赖，Windows 上意味着
 *   用户得先装 Visual Studio Build Tools（~6GB）才能 npm install。
 *   而这里的负载只有「追加一条、列最近 N 条、按 id 删、算个总数」——
 *   连索引都用不上。为它引入编译依赖不划算。见 ADR-0006。
 *
 * 容量估算：每天 50 条、每条 ~300 字，两年约 36k 条 / 10MB。
 * 全量读进内存完全没问题，启动解析 ~50ms。超过 MAX_ENTRIES 自动压缩。
 *
 * 崩溃安全：追加是单行 append，进程被杀最多丢最后一行；
 * 加载时跳过解析不了的行，不会因为半行 JSON 就打不开。
 */
import {
  existsSync, readFileSync, appendFileSync, writeFileSync, renameSync, mkdirSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import type { Transcript } from '@shared/types'
import type { HistoryStats } from '@shared/ipc'

/** 超过这个条数就在下次启动时压缩，只保留最近的。 */
const MAX_ENTRIES = 20_000

export class HistoryService {
  private file: string
  /** 最新的在前 */
  private entries: Transcript[] = []
  private dirty = false

  /** 路径由调用方给（主进程传 userData），这样这个类不依赖 electron，可以直接跑测试。 */
  constructor(file: string) {
    this.file = file
    mkdirSync(dirname(this.file), { recursive: true })
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return

    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch {
      return
    }

    const out: Transcript[] = []
    for (const line of raw.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        const t = JSON.parse(s) as Transcript
        if (t && typeof t.id === 'string') out.push(t)
      } catch {
        // 上次进程被杀留下的半行，跳过
      }
    }

    // 文件是按时间追加的，倒过来就是最新在前
    out.reverse()
    this.entries = out

    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_ENTRIES)
      this.dirty = true
      this.compact()
    }
  }

  /** 整体重写，用临时文件 + rename 保证不会写到一半留下坏文件。 */
  private compact(): void {
    if (!this.dirty) return
    const tmp = `${this.file}.tmp`
    // 存回时间正序，和追加的顺序一致
    const body = this.entries
      .slice()
      .reverse()
      .map((t) => JSON.stringify(t))
      .join('\n')
    writeFileSync(tmp, body ? body + '\n' : '', 'utf8')
    renameSync(tmp, this.file)
    this.dirty = false
  }

  insert(t: Transcript): void {
    this.entries.unshift(t)
    try {
      appendFileSync(this.file, JSON.stringify(t) + '\n', 'utf8')
    } catch {
      // 写不进去就只留在内存里，不能因为历史写失败打断语音输入
      this.dirty = true
    }
  }

  list(limit = 50, offset = 0): Transcript[] {
    return this.entries.slice(offset, offset + limit)
  }

  delete(id: string): void {
    const before = this.entries.length
    this.entries = this.entries.filter((t) => t.id !== id)
    if (this.entries.length !== before) {
      this.dirty = true
      this.compact()
    }
  }

  /** 统计：累计字数、录音总时长，用来和「打字」做对比。 */
  stats(): HistoryStats {
    let chars = 0
    let totalMs = 0
    for (const t of this.entries) {
      chars += t.final.length
      totalMs += t.durationMs
    }
    return { count: this.entries.length, chars, totalMs }
  }

  close(): void {
    this.compact()
  }
}

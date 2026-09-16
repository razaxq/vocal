/**
 * 模型下载器（主进程）。
 *
 * 之前下模型只能跑 `npm run models` —— 对开发者没问题，
 * 对拿到安装包的人就是死路。这里把整条链路搬进应用：
 * 下载 → 解压 → 剔除冗余文件 → 校验，全程有进度，可取消。
 *
 * 解压优先用系统 tar，不支持 bzip2 时回落到纯 JS 实现。
 */
import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat, readdir, readFile, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ModelEntry } from '@shared/modelRegistry'
import type { ModelProgress } from '@shared/ipc'

export type ProgressFn = (p: ModelProgress) => void

export class ModelDownloader {
  /** 正在下载的任务，id → 中止控制器 */
  private active = new Map<string, AbortController>()

  private root: string
  private onProgress: ProgressFn

  constructor(root: string, onProgress: ProgressFn) {
    this.root = root
    this.onProgress = onProgress
  }

  isDownloading(id: string): boolean {
    return this.active.has(id)
  }

  cancel(id: string): void {
    this.active.get(id)?.abort()
  }

  cancelAll(): void {
    for (const c of this.active.values()) c.abort()
    this.active.clear()
  }

  /** 删掉已下载的模型，腾空间用。 */
  async remove(entry: ModelEntry): Promise<void> {
    await rm(join(this.root, entry.dir), { recursive: true, force: true })
  }

  async download(entry: ModelEntry): Promise<void> {
    if (this.active.has(entry.id)) return

    const ctrl = new AbortController()
    this.active.set(entry.id, ctrl)
    const emit = (p: Partial<ModelProgress>): void => {
      // Terminal notifications must see the task as finished (reload may run synchronously).
      if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') this.active.delete(entry.id)
      this.onProgress({ id: entry.id, phase: 'downloading', received: 0, total: 0, ...p })
    }

    const targetDir = join(this.root, entry.dir)
    // 带上真实扩展名：有些解压器靠它判断格式，而且出问题时用户自己也能找到
    const tmpFile = join(tmpdir(), `vocal-model-${entry.id}-${Date.now()}.tar.bz2`)

    try {
      emit({ phase: 'queued' })
      await mkdir(this.root, { recursive: true })

      if (entry.archive === 'files') {
        const { downloadModelFiles } = await import('../../../../scripts/download-model-files.mjs')
        await downloadModelFiles(entry, targetDir, ctrl.signal, (received, total) => emit({ received, total }))
        const size = await dirSize(targetDir)
        emit({ phase: 'done', received: size, total: size })
        return
      }

      /* ---------- 下载 ---------- */
      const res = await fetch(entry.url, { redirect: 'follow', signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status} —— 下载地址可能变了`)
      if (!res.body) throw new Error('响应没有 body')

      const total = Number(res.headers.get('content-length') ?? 0)
      let received = 0
      let lastEmit = 0

      const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
      // 进度统计必须放在写入管道内。提前监听 body 的 data 会让它立即流动，
      // 下面 await mkdir 期间收到的块就会丢失，连归档的 BZh 文件头也保不住。
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          const now = Date.now()
          // 限流：下载几百 MB 时每个 chunk 都推会把 IPC 打爆
          if (now - lastEmit > 200) {
            lastEmit = now
            emit({ phase: 'downloading', received, total })
          }
          callback(null, chunk)
        }
      })

      await mkdir(dirname(tmpFile), { recursive: true })
      await pipeline(body, progress, createWriteStream(tmpFile), { signal: ctrl.signal })
      emit({ phase: 'downloading', received, total })

      /* ---------- 解压 ---------- */
      if (entry.archive === 'raw') {
        // 单文件模型（silero_vad.onnx），下下来直接放好
        await mkdir(targetDir, { recursive: true })
        const name = Object.values(entry.files)[0] ?? 'model.onnx'
        await rm(join(targetDir, name), { force: true })
        await rename(tmpFile, join(targetDir, name))
      } else {
        emit({ phase: 'extracting', received: total, total })
        await mkdir(targetDir, { recursive: true })
        // prune 直接当成解压时的排除项：归档里常同时带 fp32 和 int8 两份权重，
        // 我们只用 int8。三语 Paraformer 那个 fp32 有 831MB，
        // 「先老实写下来再删掉」纯属折磨磁盘。
        const { extractTarBz2 } = await import('../../../../scripts/extract-tar-bz2.mjs')
        await extractTarBz2(tmpFile, targetDir, { exclude: entry.prune })
        await rm(tmpFile, { force: true })
      }

      /* ---------- 兜底再删一次 ---------- */
      // 解压时已经排除过了，这里是为了老目录（之前版本下过的）也能被清干净
      for (const p of entry.prune) {
        await rm(join(targetDir, p), { recursive: true, force: true })
      }

      /* ---------- 补上上游没给的词表 ---------- */
      // byte-level BPE 的模型只带二进制 .model，而 sherpa 的热词编码
      // 要的是文本词表。缺了它热词会在编码阶段失败并被静默跳过，
      // 所以这里现场生成一份，当作解压的一部分。
      if (entry.generateBpeVocab) {
        const { from, to } = entry.generateBpeVocab
        const { toVocabText } = await import('../../../../scripts/bbpe-vocab.mjs')
        const raw = await readFile(join(targetDir, from))
        await writeFile(join(targetDir, to), toVocabText(raw), 'utf8')
      }

      /* ---------- 校验 ---------- */
      emit({ phase: 'verifying', received: total, total })
      const missing = Object.values(entry.files).filter((f) => !existsSync(join(targetDir, f)))
      if (missing.length > 0) {
        const actual = await readdir(targetDir).catch(() => [] as string[])
        throw new Error(
          `解压后缺少 ${missing.join(', ')}。实际目录内容：${actual.slice(0, 8).join(', ') || '空'}`
        )
      }

      const size = await dirSize(targetDir)
      emit({ phase: 'done', received: size, total: size })
    } catch (e) {
      await rm(tmpFile, { force: true }).catch(() => undefined)

      if (ctrl.signal.aborted) {
        // 取消时把半成品清掉，免得下次被当成「已下载」
        if (entry.archive !== 'files') await rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
        emit({ phase: 'cancelled', message: '已取消' })
      } else {
        emit({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      if (this.active.get(entry.id) === ctrl) this.active.delete(entry.id)
    }
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (d: string): Promise<void> => {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else total += (await stat(p).catch(() => ({ size: 0 }))).size
    }
  }
  await walk(dir)
  return total
}

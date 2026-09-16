import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, access, readdir, rm, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import extract from 'extract-zip'
import pkg from '../../../package.json'
import type { UpdateBackend } from './updateController'
import { selectPortableRelease, type PortableRelease } from './portableRelease'

export class PortableUpdater implements UpdateBackend {
  private release: PortableRelease | null = null
  private stage: string | null = null
  private stageVersion: string | null = null
  private beforeInstall: () => void
  private repository = pkg.repository.url.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '')

  constructor(beforeInstall: () => void) { this.beforeInstall = beforeInstall }

  async check(): Promise<string | null> {
    await this.cleanupCompleted()
    const res = await fetch(`https://api.github.com/repos/${this.repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000)
    })
    if (res.status === 404) { this.release = null; return null }
    if (!res.ok) throw new Error(`检查更新失败（HTTP ${res.status}），请稍后重试`)
    this.release = selectPortableRelease(await res.json(), app.getVersion(), this.repository)
    return this.release?.version ?? null
  }

  async download(onProgress: (percent: number) => void): Promise<void> {
    if (!this.release) throw new Error('请先检查更新')
    if (this.stage && this.stageVersion === this.release.version) { onProgress(100); return }
    this.stage = null
    // 同盘暂存，退出后可用目录重命名完成替换和回滚。
    const stage = await mkdtemp(join(dirname(app.getPath('exe')), '.vocal-update-'))
    const archive = join(stage, 'update.zip')
    const payload = join(stage, 'payload')
    try {
      const res = await fetch(this.release.url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
      if (!res.ok || !res.body) throw new Error(`更新下载失败（HTTP ${res.status}）`)
      const hash = createHash('sha256')
      let received = 0
      let lastPercent = -1
      const expected = this.release.size
      const progress = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          hash.update(chunk)
          const percent = Math.min(100, Math.floor(received / expected * 100))
          if (percent !== lastPercent) { lastPercent = percent; onProgress(percent) }
          callback(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), progress, createWriteStream(archive))
      if (received !== expected || hash.digest('hex') !== this.release.sha256) {
        throw new Error('更新文件校验失败，请重试')
      }
      await mkdir(payload)
      await extract(archive, {
        dir: payload,
        onEntry(entry) {
          const name = entry.fileName.replaceAll('\\', '/')
          const type = (entry.externalFileAttributes >>> 16) & 0o170000
          if (type === 0o120000 || name.split('/').some((p) => p === '..') ||
              /^(data|\.vocal-update-[^/]*)(\/|$)/i.test(name)) {
            throw new Error('更新包包含不允许替换的文件')
          }
        }
      })
      await access(join(payload, 'Vocal.exe'))
      await access(join(payload, 'resources', 'app.asar'))
      this.stage = stage
      this.stageVersion = this.release.version
    } catch (e) {
      // stage 来自当前程序目录内的 mkdtemp，不接受网络提供的路径。
      if (dirname(stage) === dirname(app.getPath('exe'))) await rm(stage, { recursive: true, force: true })
      throw e
    }
  }

  private async cleanupCompleted(): Promise<void> {
    const root = dirname(app.getPath('exe'))
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.name.startsWith('.vocal-update-') || !entry.isDirectory()) continue
      const stage = join(root, entry.name)
      if (dirname(stage) !== root || (await lstat(stage)).isSymbolicLink()) continue
      const result = await readFile(join(stage, 'result.json'), 'utf8').catch(() => '')
      if (!result) continue
      const manifest = await readFile(join(stage, 'apply.json'), 'utf8').catch(() => '')
      if (!manifest) continue
      const owner = JSON.parse(manifest) as { appDir?: string; stage?: string }
      if (owner.appDir !== root || owner.stage !== stage) continue
      const outcome = JSON.parse(result.replace(/^\uFEFF/, '')) as { ok: boolean }
      if (outcome.ok) {
        await rm(stage, { recursive: true, force: true }).catch(() => {})
      } else {
        const reported = join(stage, 'reported')
        if (await access(reported).then(() => false, () => true)) {
          await writeFile(reported, 'reported')
          throw new Error('上次更新未能完成，已尝试恢复原版本。请重试更新')
        }
      }
    }
  }

  async install(restart = true): Promise<void> {
    if (restart) this.beforeInstall()
    if (!this.stage) throw new Error('更新尚未下载完成')
    const helper = join(this.stage, 'apply.ps1')
    await copyFile(join(process.resourcesPath, 'update-portable.ps1'), helper)
    const configPath = join(this.stage, 'apply.json')
    await writeFile(configPath, JSON.stringify({
      appDir: dirname(app.getPath('exe')), stage: this.stage, parentPid: process.pid,
      restart
    }))
    await rm(join(this.stage, 'ready'), { force: true })
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', helper, '-ConfigPath', configPath
    ], { detached: true, windowsHide: true, stdio: 'ignore' })
    let failed: Error | undefined
    child.on('error', (e) => { failed = e })
    child.on('exit', (code) => { failed = new Error(`更新助手提前退出（${code}）`) })
    // 助手确认路径和更新包后才退出本程序，启动失败时仍能在界面重试。
    for (let i = 0; i < 100; i++) {
      if (failed) throw failed
      const ready = await readFile(join(this.stage, 'ready'), 'utf8').catch(() => '')
      if (ready === 'ready') {
        try { if (restart) this.beforeInstall() } catch (e) { child.kill(); throw e }
        child.unref()
        app.quit()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    child.kill()
    throw new Error('更新助手启动超时，请重试')
  }
}

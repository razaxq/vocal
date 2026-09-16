/** Pinned, hashed model assets. Publish the directory only after every file verifies. */
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function downloadModelFiles(entry, target, signal, onProgress = () => {}) {
  const assets = entry.downloads
  if (!assets?.length || assets.some(a => !/^[a-zA-Z0-9_.-]+$/.test(a.file) || a.file === '..' || !/^[a-f0-9]{64}$/.test(a.sha256))) {
    throw new Error('模型下载清单无效')
  }
  await mkdir(dirname(target), { recursive: true })
  const staging = await mkdtemp(join(dirname(target), '.model-download-'))
  const total = assets.reduce((sum, a) => sum + a.bytes, 0)
  let received = 0
  let last = 0
  try {
    for (const asset of assets) {
      const response = await fetch(asset.url, { signal, redirect: 'follow' })
      if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`)
      const hash = createHash('sha256')
      let size = 0
      const progress = new Transform({ transform(chunk, _encoding, cb) {
        size += chunk.length; received += chunk.length; hash.update(chunk)
        if (size > asset.bytes) { cb(new Error('模型文件大小不符')); return }
        if (Date.now() - last > 200) { last = Date.now(); onProgress(received, total) }
        cb(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(join(staging, asset.file), { flags: 'wx' }), { signal })
      if (size !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error('模型文件校验失败，请重新下载')
    }
    signal?.throwIfAborted()
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
    onProgress(total, total)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

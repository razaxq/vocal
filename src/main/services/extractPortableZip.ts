import { createWriteStream } from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { openPromise } from 'yauzl'

/** Extract only regular files/directories into a newly created, private staging directory. */
export async function extractPortableZip(archive: string, destination: string): Promise<void> {
  // Never reuse a tree that could already contain symlinks or junctions.
  await mkdir(destination)
  const root = await realpath(destination)
  const zip = await openPromise(archive, { strictFileNames: true, validateEntrySizes: true })
  const seen = new Set<string>()
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName
      const type = (entry.externalFileAttributes >>> 16) & 0o170000
      if (![0, 0o100000, 0o040000].includes(type) || (entry.externalFileAttributes & 0x400)) {
        throw new Error('更新包包含符号链接或特殊文件')
      }
      const directory = name.endsWith('/') || type === 0o040000 || !!(entry.externalFileAttributes & 0x10)
      const parts = (name.endsWith('/') ? name.slice(0, -1) : name).split('/')
      // Apply Windows path rules on every platform, including ADS and device names.
      if (parts.some(part => !part || /[\x00-\x1f<>:"|?*\\]/.test(part) || /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) ||
          /^(data|\.vocal-update-.*)$/i.test(parts[0]!)) {
        throw new Error('更新包包含不允许替换的路径')
      }
      const key = parts.join('/').toLowerCase()
      if (seen.has(key)) throw new Error('更新包包含重复路径')
      seen.add(key)
      const target = join(root, ...parts)
      const local = relative(root, target)
      if (!local || isAbsolute(local) || local.split(sep).includes('..')) {
        throw new Error('更新包路径超出暂存目录')
      }
      if (entry.isEncrypted() || (directory && entry.uncompressedSize !== 0)) {
        throw new Error('更新包包含无效文件')
      }
      if (directory) {
        await mkdir(target, { recursive: true })
      } else {
        await mkdir(dirname(target), { recursive: true })
        const input = await zip.openReadStreamPromise(entry)
        // Exclusive creation rejects existing final-component links/files instead of following them.
        await pipeline(input, createWriteStream(target, { flags: 'wx' }))
      }
    }
  } finally {
    zip.close()
  }
}

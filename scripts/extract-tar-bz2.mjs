/**
 * 解压 .tar.bz2。先用系统的 tar，不行就用纯 JS 兜底。
 *
 * 为什么要兜底：Windows 自带的 tar 是 bsdtar，各版本编进去的解压器不一样，
 * 有的根本不带 bzip2 —— 表现是一句 `Unrecognized archive format`，
 * 而这时候文件本身是好的。命令行脚本以前靠「失败了再试 7z」躲过去，
 * 可应用里不能假设用户装了 7z。
 *
 * 纯 JS 路径慢一些（300MB 的包大约 65s，系统 tar 约 25s），但它总是能用，
 * 而且模型只下这一次。所以顺序是：快的先试，不行退到一定能成的那条。
 *
 * exclude 不只是省事：三语 Paraformer 的包里带着一份 831MB 的 fp32 权重，
 * 我们只要 int8。解压时就跳过，比「先写 831MB 再删掉」省得多。
 */
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, open } from 'node:fs/promises'
import { join, dirname } from 'node:path'

/** bzip2 的魔数。文件头不对就不用往下试了，那是下载出了问题，不是解压。 */
export async function assertBzip2(file) {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(3)
    const { bytesRead } = await fh.read(buf, 0, 3, 0)
    if (bytesRead === 3 && buf.toString('latin1') === 'BZh') return
    const head = Buffer.alloc(120)
    const r = await fh.read(head, 0, 120, 0)
    const text = head.subarray(0, r.bytesRead).toString('utf8').replace(/\s+/g, ' ').trim()
    throw new Error(
      `下下来的不是 bzip2 归档（开头是「${text.slice(0, 80)}」）。`
      + '多半是网络被拦截或者下载地址失效了。'
    )
  } finally {
    await fh.close()
  }
}

export async function extractTarBz2(archive, targetDir, { exclude = [] } = {}) {
  await assertBzip2(archive)
  await mkdir(targetDir, { recursive: true })
  try {
    await systemTar(archive, targetDir, exclude)
  } catch (e) {
    await jsExtract(archive, targetDir, exclude)
  }
}

function systemTar(archive, targetDir, exclude) {
  return new Promise((resolve, reject) => {
    // 不写 -j：让 bsdtar 自己按魔数判断压缩方式，比写死更宽容
    const args = ['-xf', archive, '-C', targetDir, '--strip-components=1']
    for (const p of exclude) args.push(`--exclude=${p}`)
    const p = spawn('tar', args, { windowsHide: true })
    let stderr = ''
    p.stderr?.on('data', (d) => { stderr += String(d) })
    p.on('error', (err) => reject(err))
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar 退出码 ${code}${stderr ? `：${stderr.slice(0, 200)}` : ''}`))
    })
  })
}

async function jsExtract(archive, targetDir, exclude) {
  const [{ default: bz2 }, tar] = await Promise.all([
    import('unbzip2-stream'),
    import('tar-stream')
  ])

  const skip = (rel) => exclude.some((p) => rel === p || rel.startsWith(p + '/'))

  await new Promise((resolve, reject) => {
    const extract = tar.extract()

    extract.on('entry', (header, stream, next) => {
      // 等价于 --strip-components=1
      const rel = header.name.split('/').slice(1).join('/')
      if (!rel || header.type !== 'file' || skip(rel)) {
        stream.resume()
        stream.on('end', next)
        return
      }
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('error', reject)
      stream.on('end', () => {
        const dest = join(targetDir, rel)
        mkdir(dirname(dest), { recursive: true })
          .then(() => writeFile(dest, Buffer.concat(chunks)))
          .then(() => next())
          .catch(reject)
      })
    })

    extract.on('error', reject)
    extract.on('finish', resolve)

    const src = createReadStream(archive)
    src.on('error', reject)
    const d = bz2()
    d.on('error', (e) => reject(new Error(`bzip2 解压失败：${e.message}`)))
    src.pipe(d).pipe(extract)
  })
}

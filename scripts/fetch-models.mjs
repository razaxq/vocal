#!/usr/bin/env node
/**
 * 下载并解压 sherpa-onnx 模型到 data/models（便携模式，和程序放一起）。
 *
 *   npm run models                     下载默认那套（缺什么下什么）
 *   npm run models -- --model zipformer-zh   只下某一个（id 见 --list）
 *   npm run models -- --all            把注册表里所有可选模型都下了
 *   npm run models:list                看有哪些模型、哪些已就位
 *   npm run models -- --force          重新下载
 *   npm run models -- --dest D:\models 指定目录
 *
 * 解压依赖系统自带的 tar。Windows 10 1803+ 自带 bsdtar（支持 bz2），
 * 没有的话装 7-Zip 并把 7z 加进 PATH，脚本会自动回落。
 */
import { createWriteStream, existsSync, mkdirSync, rmSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const registry = JSON.parse(readFileSync(join(here, 'models.json'), 'utf8'))

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const destArg = args.indexOf('--dest')
const modelArg = args.indexOf('--model')

const SLOTS = ['streaming', 'offline', 'punct', 'vad']
/** 不指定就下这套 —— 和 src/shared/modelRegistry.ts 的 DEFAULT_MODEL_IDS 对应 */
const DEFAULTS = {
  streaming: 'paraformer-zh-en',
  offline: 'sensevoice-2024',
  punct: 'ct-transformer',
  vad: 'silero'
}

function allEntries() {
  return SLOTS.flatMap((slot) => registry[slot].map((m) => ({ ...m, slot })))
}

/** 本次要处理哪些模型。 */
function selected() {
  if (has('--all')) return allEntries()
  if (modelArg >= 0 && args[modelArg + 1]) {
    const id = args[modelArg + 1]
    const found = allEntries().find((m) => m.id === id)
    if (!found) {
      console.error(`没有 id 为「${id}」的模型。用 npm run models:list 看可选项。`)
      process.exit(1)
    }
    // 单独下一个流式/定稿模型时，标点和 VAD 也得在
    return [found, ...allEntries().filter((m) => m.slot === 'punct' || m.slot === 'vad')]
  }
  return allEntries().filter((m) => DEFAULTS[m.slot] === m.id)
}

/**
 * 便携模式：模型和程序放一起，在项目根的 data/models。
 * 和主进程 setupDataDir() 的口径保持一致 —— 那边是 exe 旁边的 data/，
 * 开发时是项目根的 data/，这个脚本总是在项目根跑，所以直接用它。
 */
function defaultDest() {
  if (destArg >= 0 && args[destArg + 1]) return args[destArg + 1]
  return join(here, '..', 'data', 'models')
}

const dest = defaultDest()

function human(bytes) {
  return bytes > 1 << 30
    ? `${(bytes / (1 << 30)).toFixed(2)} GB`
    : `${(bytes / (1 << 20)).toFixed(1)} MB`
}

function statusOf(item) {
  const dir = join(dest, item.dir)
  const want = Object.values(item.files)
  const missing = want.filter((f) => !existsSync(join(dir, f)))
  return { dir, ok: missing.length === 0, missing }
}

async function download(url, outPath) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let seen = 0
  let lastPrint = 0

  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    seen += chunk.length
    const now = Date.now()
    if (now - lastPrint > 400) {
      lastPrint = now
      const pct = total ? ` ${((seen / total) * 100).toFixed(1)}%` : ''
      process.stdout.write(`\r    ${human(seen)}${total ? ` / ${human(total)}` : ''}${pct}   `)
    }
  })
  await pipeline(body, createWriteStream(outPath))
  process.stdout.write('\r' + ' '.repeat(50) + '\r')
}

function extract(archivePath, targetDir) {
  mkdirSync(targetDir, { recursive: true })
  let r = spawnSync('tar', ['-xjf', archivePath, '-C', targetDir, '--strip-components=1'], {
    stdio: 'inherit'
  })
  if (r.status === 0) return

  console.log('    tar 解压失败，尝试 7z…')
  const tmpTar = archivePath.replace(/\.bz2$/, '')
  r = spawnSync('7z', ['x', '-y', `-o${dirname(archivePath)}`, archivePath], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('解压失败：系统里既没有可用的 tar 也没有 7z')
  r = spawnSync('7z', ['x', '-y', `-o${targetDir}`, tmpTar], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('解压 tar 失败')
  rmSync(tmpTar, { force: true })
  console.log('    注意：7z 路径不会自动 strip 顶层目录，如有多余层级请手动调整。')
}

function prune(dir, patterns) {
  for (const p of patterns) {
    const target = join(dir, p)
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
    }
  }
}

async function main() {
  console.log(`模型目录：${dest}\n`)
  mkdirSync(dest, { recursive: true })

  if (has('--list')) {
    for (const slot of SLOTS) {
      const label = { streaming: '流式识别', offline: '定稿重转写', punct: '标点', vad: '语音检测' }[slot]
      console.log(`  【${label}】`)
      for (const m of registry[slot]) {
        const s = statusOf(m)
        const mark = s.ok ? '\x1b[32m✓\x1b[0m' : '·'
        const def = DEFAULTS[slot] === m.id ? ' (默认)' : ''
        console.log(`    ${mark} ${m.id.padEnd(22)} ${m.name}${def}`)
        console.log(`      ${m.langs} · 约 ${m.approxMB} MB · ${m.note}`)
      }
      console.log('')
    }
    console.log('  下某一个：npm run models -- --model <id>')
    return
  }

  const items = selected()
  let done = 0

  for (const item of items) {
    const s = statusOf(item)
    if (s.ok && !has('--force')) {
      console.log(`  ✓ ${item.name}（已就位）`)
      continue
    }

    console.log(`  ↓ ${item.name} — ${item.langs} — 约 ${item.approxMB} MB`)
    const targetDir = join(dest, item.dir)

    if (item.archive === 'raw') {
      mkdirSync(targetDir, { recursive: true })
      await download(item.url, join(targetDir, Object.values(item.files)[0]))
    } else {
      const tmp = join(tmpdir(), `vocal-${item.id}.tar.bz2`)
      await download(item.url, tmp)
      console.log(`    解压中（${human(statSync(tmp).size)}）…`)
      extract(tmp, targetDir)
      rmSync(tmp, { force: true })
      prune(targetDir, item.prune)
    }

    const after = statusOf(item)
    if (!after.ok) {
      console.error(`  ✗ ${item.name} 校验失败，缺少：${after.missing.join(', ')}`)
      console.error(`    看一眼 ${targetDir} 的实际结构，可能要调 models.json 里的 dir / files`)
      process.exitCode = 1
    } else {
      console.log(`  ✓ ${item.name}`)
      done++
    }
  }

  console.log(`\n完成，本次处理 ${done} 个模型。`)
  if (!has('--all')) {
    console.log('还有其它可选模型，用 npm run models:list 查看。')
  }
}

main().catch((e) => {
  console.error('\n失败：', e.message)
  process.exit(1)
})

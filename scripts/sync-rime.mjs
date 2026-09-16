/** 固定到同一个上游提交，保留原始词典和许可，再生成完整检索词库。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { selectRimeWords } from '../src/shared/rimeDictionary.ts'

const directory = new URL('../resources/dictionaries/rime-ice/', import.meta.url)
const headers = { 'User-Agent': 'Vocal-dictionary-sync' }
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
async function download(url, api = false) {
  const response = await fetch(url, { headers: api ? headers : { 'User-Agent': 'Vocal-dictionary-sync' }, signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`下载失败：${response.status} ${url}`)
  return response.text()
}
const commit = JSON.parse(await download('https://api.github.com/repos/iDvel/rime-ice/commits?path=cn_dicts/base.dict.yaml&per_page=1', true))[0]
if (!/^[a-f0-9]{40}$/.test(commit?.sha)) throw new Error('上游版本无效')
const prefix = `https://raw.githubusercontent.com/iDvel/rime-ice/${commit.sha}/`
const [dictionary, license] = await Promise.all([
  download(prefix + 'cn_dicts/base.dict.yaml'), download(prefix + 'LICENSE')
])
if (!license.includes('GNU GENERAL PUBLIC LICENSE')) throw new Error('请检查上游许可变更')
const selected = selectRimeWords(dictionary)
if (selected.words.length < 500_000) throw new Error('上游词库不完整')
let old
try { old = JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8')) } catch { /* 首次生成。 */ }
const sha256 = createHash('sha256').update(dictionary).digest('hex')
// Preserve upstream attribution in the runtime bundle without shipping the raw dictionary.
const headerEnd = dictionary.search(/^---\s*$/m)
if (headerEnd < 0) throw new Error('原词典缺少头部边界，请检查来源声明')
await mkdir(directory, { recursive: true })
await writeFile(new URL('UPSTREAM-NOTICES.txt', directory), dictionary.slice(0, headerEnd))
if (old?.source?.revision === commit.sha && old?.source?.sha256 === sha256 && old?.source?.selection === 'full-pinyin-v2') {
  console.log('雾凇词库已是最新'); process.exit(0)
}
const catalog = {
  version: (old?.version ?? 1) + 1,
  updatedAt: selected.date,
  source: {
    id: 'rime-ice', revision: commit.sha, file: 'cn_dicts/base.dict.yaml',
    license: 'GPL-3.0', sha256, selection: 'full-pinyin-v2', eligibleCount: selected.eligibleCount
  },
  words: selected.words, readings: selected.readings
}
await mkdir(directory, { recursive: true })
await writeFile(new URL('base.dict.yaml', directory), dictionary)
await writeFile(new URL('LICENSE', directory), license)
await writeFile(new URL('catalog.json', directory), JSON.stringify(catalog) + '\n')
console.log(`雾凇 ${commit.sha}: ${selected.words.length} 个词条参与检索`)

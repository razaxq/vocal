/** 固定到同一个上游提交，保留原始词典和许可，再生成可供 ASR 加权的子集。 */
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
if (selected.words.length !== 500) throw new Error('上游词库不完整')
let old
try { old = JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8')) } catch { /* 首次生成。 */ }
const sha256 = createHash('sha256').update(dictionary).digest('hex')
if (old?.source?.revision === commit.sha && old?.source?.sha256 === sha256) {
  console.log('雾凇词库已是最新'); process.exit(0)
}
const catalog = {
  version: (old?.version ?? 1) + 1,
  updatedAt: selected.date,
  source: {
    id: 'rime-ice', revision: commit.sha, file: 'cn_dicts/base.dict.yaml',
    license: 'GPL-3.0', sha256, selection: 'frequency-3-12-v1', eligibleCount: selected.eligibleCount
  },
  words: selected.words
}
await mkdir(directory, { recursive: true })
await writeFile(new URL('base.dict.yaml', directory), dictionary)
await writeFile(new URL('LICENSE', directory), license)
await writeFile(new URL('catalog.json', directory), JSON.stringify(catalog, null, 2) + '\n')
console.log(`雾凇 ${commit.sha}: ${selected.eligibleCount} 个候选，启用 ${selected.words.length} 个高频词`)

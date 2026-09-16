/** Real local-model comparison. No network requests, audio capture or text injection. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { LocalCorrector } from '../../src/asr-worker/corrector.ts'
import { HotwordIndex } from '../../src/shared/hotwordRetrieval.ts'

const registry = JSON.parse(readFileSync('scripts/models.json', 'utf8'))
const dictionary = new HotwordIndex(JSON.parse(readFileSync('resources/dictionaries/rime-ice/catalog.json', 'utf8')))
const examples = [
  ['完全就是给拦柜用的', '完全就是给懒鬼用的'],
  ['完全就是给懒鬼用的', '完全就是给懒鬼用的'],
  ['这家店的拦柜很旧了', '这家店的拦柜很旧了'],
  ['今天天气很好', '今天天气很好'],
  ['今天天汽很好', '今天天气很好'],
  ['程序会自动更新', '程序会自动更新'],
  ['你找到你最喜欢的工作，我也很高心。', '你找到你最喜欢的工作，我也很高兴。'],
  ['请打开 GitHub，版本是 v0.1.9。', '请打开 GitHub，版本是 v0.1.9。'],
  ['我想使用完整词库', '我想使用完整词库'],
  ['这个软件可以提高工作效率', '这个软件可以提高工作效率'],
  ['我们明天早上九点开会', '我们明天早上九点开会'],
  ['请支付一百二十三元', '请支付一百二十三元'],
  ['张晓明正在调试 Vocal', '张晓明正在调试 Vocal']
]
const custom = process.argv.slice(2).join(' ')
const report = []
for (const entry of registry.correction) {
  const root = join('data/models', entry.dir)
  if (!existsSync(join(root, entry.files.model))) { console.log(`缺少 ${entry.name}，运行 npm run models -- --model ${entry.id}`); process.exitCode = 1; continue }
  const started = performance.now()
  const model = await LocalCorrector.create(join(root, entry.files.model), join(root, entry.files.vocab), entry.correctionMode)
  const loadMs = Math.round(performance.now() - started)
  const results = []
  try {
    for (const [input, expected] of custom ? [[custom, null]] : examples) {
      const t = performance.now()
      const output = await model.correct(input, ['张晓明', 'Vocal'], dictionary)
      const row = { input, output, expected, matches: expected === null ? null : output === expected, ms: Math.round(performance.now() - t) }
      results.push(row)
      console.log(`${entry.name} | ${row.ms} ms | ${input} → ${output}${row.matches === false ? '（未达到预期）' : ''}`)
    }
    report.push({ model: entry.id, loadMs, results })
  } finally { await model.dispose() }
}
writeFileSync('data/correction-report.json', JSON.stringify({ createdAt: new Date().toISOString(), note: '小样本功能检查，不代表通用准确率；耗时仅为本机文本纠错。', report }, null, 2))
console.log('结果：data/correction-report.json')

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HotwordIndex } from './hotwordRetrieval.ts'

test('从读音召回初稿中没有的同音词，较长词优先，英文和标点不跨界', () => {
  const index = new HotwordIndex({ words: ['权利', '权力', '人工智能', '重庆', '女儿'],
    readings: ['quan li', 'quan li', 'ren gong zhi neng', 'chong qing|zhong qing', 'nv er'] })
  assert.deepEqual(index.retrieve('人工只能保障权利'), ['人工智能', '权利', '权力'])
  assert.deepEqual(index.retrieve('重庆女儿'), ['重庆', '女儿'])
  assert.deepEqual(index.retrieve('权，利 English'), [])
  assert.deepEqual(index.retrieve('人工只能保障权利', 1), ['人工智能'])
  assert.deepEqual(index.retrieve('权利', 0), [])
})

test('全量词库参与检索，候选有界且不限于旧的前 500 词', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../resources/dictionaries/rime-ice/catalog.json', import.meta.url), 'utf8'))
  const index = new HotwordIndex(catalog)
  assert.ok(catalog.words.indexOf('苏州工业园区') > 500)
  assert.ok(index.retrieve('苏州工业园区').includes('苏州工业园区'))
  assert.ok(index.retrieve('阿不思邓布利多').includes('阿不思·邓布利多'))
  assert.ok(index.retrieve('人工智能自然语言处理语音识别软件开发中国经济发展'.repeat(30)).length <= 64)
  assert.deepEqual(index.retrieve(''), [])
})

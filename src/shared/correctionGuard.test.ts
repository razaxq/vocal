import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCorrections, similarSound } from './correctionGuard.ts'

test('同音与前后鼻音纠错保留原格式，拒绝不同读音和改写', () => {
  assert.ok(similarSound('拦柜', '懒鬼'))
  assert.ok(similarSound('心', '兴'))
  assert.equal(similarSound('拦柜', '懒人'), false)
  assert.equal(applyCorrections('完全就是给拦柜用的。', [
    { start: 5, source: '拦柜', target: '懒鬼', margin: 4 },
    { start: 0, source: '完全', target: '全部', margin: 10 }
  ], []), '完全就是给懒鬼用的。')
})

test('个人热词、中文数字、时间、英文和代码保持原样', () => {
  assert.equal(applyCorrections('拦柜', [{ start: 0, source: '拦柜', target: '懒鬼', margin: 20 }], ['拦柜']), '拦柜')
  assert.equal(applyCorrections('九点开会', [{ start: 0, source: '九', target: '就', margin: 20 }], []), '九点开会')
  assert.equal(applyCorrections('`拦柜` v1.2', [{ start: 1, source: '拦柜', target: '懒鬼', margin: 20 }], []), '`拦柜` v1.2')
  assert.equal(applyCorrections('https://站点/拦柜', [{ start: 11, source: '拦柜', target: '懒鬼', margin: 20 }], []), 'https://站点/拦柜')
})

test('重叠候选只应用置信差距较大的一项；失效偏移不改动', () => {
  assert.equal(applyCorrections('拦柜', [
    { start: 0, source: '拦柜', target: '懒鬼', margin: 10 },
    { start: 0, source: '拦', target: '烂', margin: 5 },
    { start: 10, source: '拦', target: '懒', margin: 100 }
  ], []), '懒鬼')
})

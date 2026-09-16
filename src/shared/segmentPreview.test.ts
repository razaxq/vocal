import test from 'node:test'
import assert from 'node:assert/strict'
import { SegmentPreview } from './segmentPreview.ts'

test('上一句定稿只替换对应段，保留下一句预览并忽略迟到的旧 partial', () => {
  const preview = new SegmentPreview()
  preview.partial(0, '人工只能')
  preview.partial(1, '下一句')
  assert.equal(preview.live, '人工只能下一句')
  assert.equal(preview.finish(0), '人工只能')
  assert.equal(preview.live, '下一句')
  preview.partial(0, '旧结果')
  assert.equal(preview.live, '下一句')
  preview.finish(1)
  assert.equal(preview.live, '')
  preview.reset()
  preview.partial(0, '新会话')
  assert.equal(preview.live, '新会话')
})

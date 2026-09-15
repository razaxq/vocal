import { test } from 'node:test'
import assert from 'node:assert/strict'
import registry from '../../scripts/models.json' with { type: 'json' }

/**
 * 模型 id 必须全局唯一，不能只在自己的槽位里唯一。
 *
 * 主进程按 id 查模型时是**跨槽位**找的（findAnyModel / installed 映射表），
 * 所以一旦流式和定稿有同名 id，下载、删除、安装状态全会串到另一个上去。
 * 实际差点踩到：离线三语 Paraformer 和流式三语 Paraformer
 * 一开始都叫 paraformer-zh-en-yue。
 */
test('模型 id 跨槽位唯一', () => {
  const seen = new Map<string, string>()
  const reg = registry as unknown as Record<string, unknown>
  for (const [slot, list] of Object.entries(reg)) {
    if (!Array.isArray(list)) continue          // 文件里有个 $comment 字段
    for (const m of list as Array<{ id: string }>) {
      const prev = seen.get(m.id)
      assert.equal(prev, undefined, `id「${m.id}」同时出现在 ${prev} 和 ${slot}`)
      seen.set(m.id, slot)
    }
  }
})

test('每个模型的必填字段都在', () => {
  const reg = registry as unknown as Record<string, unknown>
  for (const [slot, list] of Object.entries(reg)) {
    if (!Array.isArray(list)) continue
    for (const m of list as Array<Record<string, unknown>>) {
      for (const key of ['id', 'name', 'kind', 'url', 'dir', 'files']) {
        assert.ok(m[key], `${slot} 里的「${m['id']}」缺 ${key}`)
      }
      assert.ok((m['files'] as Record<string, string>)['tokens'] || slot === 'punct' || slot === 'vad',
        `${m['id']} 缺 tokens`)
    }
  }
})

/**
 * 口语清洗的实时预览。
 *
 * 清洗规则是「删东西」，而删错了是最难发现的故障 ——
 * 用户只会觉得「这个软件偶尔吞字」，不会想到是过滤词设猛了。
 * 所以调参的时候必须能当场看到效果，而不是配完去赌。
 *
 * 默认样例里故意混了两类内容：该删的（嗯、那个、我我我）和
 * 绝对不能删的（叠词「刚刚」、实词位置的「这个方案」）。
 */
import { useMemo, useState } from 'react'
import { cleanupSpeech } from '@shared/textCleanup'
import type { AppConfig } from '@shared/ipc'
import { Textarea, Button } from './ui'

const SAMPLES = [
  '嗯，那个，我我我觉得这个方案不太行，就是说性能上刚刚测下来差挺多的。',
  '呃，然后呢，我们上线了，对吧，然后监控看着还行。',
  'um, I mean, 这个 bug 在 useEffect 里，基本上就是依赖数组写漏了。'
]

export function CleanupPreview({ cfg }: { cfg: AppConfig }): React.ReactElement {
  const [input, setInput] = useState(SAMPLES[0] ?? '')

  const result = useMemo(
    () => cleanupSpeech(input, {
      level: cfg.cleanup.level,
      protect: cfg.cleanup.protectHotwords ? cfg.hotwords : [],
      extraFillers: cfg.cleanup.extraFillers
    }),
    [input, cfg.cleanup.level, cfg.cleanup.protectHotwords, cfg.cleanup.extraFillers, cfg.hotwords]
  )

  return (
    <div className="space-y-2.5">
      <Textarea
        value={input}
        rows={3}
        onChange={setInput}
        placeholder="粘一段识别结果进来看看会被清成什么样"
      />

      <div className="flex flex-wrap gap-1.5">
        {SAMPLES.map((s, i) => (
          <Button key={i} variant="ghost" onClick={() => setInput(s)}>样例 {i + 1}</Button>
        ))}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <div className="mb-1 text-[11px] font-medium text-[var(--fg-subtle)]">清洗后</div>
        {result.text ? (
          <p className="text-[13px] leading-relaxed text-[var(--fg)]">{result.text}</p>
        ) : (
          <p className="text-[13px] italic text-[var(--fg-subtle)]">（全被清掉了 —— 力度太猛）</p>
        )}
        <div className="mt-2 text-[11px] text-[var(--fg-subtle)]">
          {input.length} 字 → {result.text.length} 字
          {result.removed > 0 && <span className="text-[var(--accent)]">　删了 {result.removed} 字</span>}
        </div>
      </div>

      {cfg.cleanup.level === 'off' && (
        <p className="text-[11px] text-[var(--warn)]">清洗已关闭，上面是原样输出。</p>
      )}
    </div>
  )
}

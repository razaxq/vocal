/** 极简电平条。只为了让人确认「它真的听见了」。 */
import { useEffect, useRef } from 'react'

const BARS = 5

export function Waveform({ level, active }: { level: number; active: boolean }): React.ReactElement {
  const history = useRef<number[]>(Array(BARS).fill(0))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    history.current = [...history.current.slice(1), Math.min(1, level * 6)]
    const el = ref.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('[data-bar]').forEach((bar, i) => {
      const v = history.current[i] ?? 0
      bar.style.height = `${8 + v * 20}px`
    })
  }, [level])

  return (
    <div ref={ref} className="flex h-8 w-9 shrink-0 items-center justify-center gap-[3px]">
      {Array.from({ length: BARS }).map((_, i) => (
        <span
          key={i}
          data-bar=""
          className={`w-[3px] rounded-full transition-[height] duration-75 ${
            active ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
          }`}
          style={{ height: '8px' }}
        />
      ))}
    </div>
  )
}

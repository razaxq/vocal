/**
 * 热键录制器。
 *
 * 之前是从下拉里挑「CtrlRight」这种名字 —— 用户得先知道自己想按的那个键
 * 在 uiohook 里叫什么。改成「点一下开始录，按你想用的键」。
 *
 * 顺带解决一个真实的坑：uiohook 的键名和浏览器 KeyboardEvent.code
 * 不是一套（ControlRight vs CtrlRight），录制器负责翻译，
 * 用户永远不用接触内部名字。
 *
 * 录到不适合当热键的键（字母、数字、Enter 之类）会当场说明原因，
 * 而不是存进去等到注册时才炸。
 */
import { useEffect, useRef, useState } from 'react'
import { fromKeyboardCode, isSafeKey, displayKey } from '@shared/hotkeys'
import { Button, Badge } from './ui'

export function HotkeyRecorder({ value, onChange }: {
  value: string
  onChange: (key: string) => void
}): React.ReactElement {
  const [recording, setRecording] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!recording) return

    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.code === 'Escape') { setRecording(false); setRejected(null); return }

      const key = fromKeyboardCode(e.code)
      if (key) {
        onChange(key)
        setRecording(false)
        setRejected(null)
      } else {
        setRejected(e.code)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    boxRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, onChange])

  const safe = isSafeKey(value)

  return (
    <div>
      <div
        ref={boxRef}
        tabIndex={-1}
        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 outline-none transition-colors ${
          recording
            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
            : 'border-[var(--border)] bg-[var(--surface)]'
        }`}
      >
        {recording ? (
          <span className="text-[13px] text-[var(--fg)]">
            按下你想用的键…
            <span className="ml-2 text-[11px] text-[var(--fg-muted)]">Esc 取消</span>
          </span>
        ) : (
          <kbd className="rounded-md border border-[var(--border)] bg-[var(--surface-2)]
                          px-2 py-0.5 font-mono text-[12px] text-[var(--fg)]">
            {displayKey(value)}
          </kbd>
        )}

        <Button variant={recording ? 'ghost' : 'default'} onClick={() => {
          setRecording(!recording); setRejected(null)
        }}>
          {recording ? '取消' : '重新录制'}
        </Button>
      </div>

      {rejected && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--danger)]">
          「{rejected}」不能当热键。只能用修饰键（Ctrl / Alt / Shift / Win，左右分开）
          或功能键（F1–F24）—— 字母数字键当热键会把正常打字全吃掉。
        </p>
      )}

      {!recording && !rejected && (
        <p className="mt-1.5">
          {safe ? (
            <Badge tone="ok">单独按下时对目标应用无副作用</Badge>
          ) : (
            <Badge tone="warn">
              这个键部分应用有自己的用途（按住说话时不会被吞掉，会一起传过去）
            </Badge>
          )}
        </p>
      )}
    </div>
  )
}

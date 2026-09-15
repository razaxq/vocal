/**
 * 悬浮面板。用户 99% 的时间只看到这个东西，所以它只做三件事：
 * 告诉你在录、给你看识别到了什么、出错时说人话。
 *
 * 长输入的显示策略：已定稿的文本灰一点（它已经在目标窗口里了），
 * 正在说的这段黑一点。这样用户一眼能看出「哪些已经上屏、哪些还在路上」。
 */
import { useEffect, useRef, useState } from 'react'
import type { SessionState } from '@shared/types'
import { MicCapture } from '@renderer/shared/capture'
import { applyTheme, watchSystemTheme, type ThemeMode } from '@renderer/shared/theme'
import { Waveform } from './Waveform'

const LABEL: Record<SessionState, string> = {
  idle: '',
  arming: '准备中',
  listening: '正在听',
  finalizing: '整理中',
  consolidating: '润色中',
  injecting: '输入中',
  error: '出错了'
}

export function Panel(): React.ReactElement {
  const [state, setState] = useState<SessionState>('idle')
  const [committed, setCommitted] = useState('')
  const [live, setLive] = useState('')
  const [level, setLevel] = useState(0)
  const [toast, setToast] = useState<{ level: string; text: string } | null>(null)
  const capture = useRef<MicCapture | null>(null)
  const [theme, setTheme] = useState<ThemeMode>('system')
  /** 关掉流式识别时面板收成一条：只报「在听」，不显示文本和字数 */
  const [compact, setCompact] = useState(false)
  /**
   * 主进程给的进场 / 退场信号；退场动画放完它才 hide 窗口。
   * null = 还没显示过：此时要静静地保持透明，不能去放退场动画
   * （退场动画是从 opacity 1 开始的，窗口刚显示就会闪一下）。
   */
  const [visible, setVisible] = useState<boolean | null>(null)
  const tailRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 只有真的滚下去了才在顶部加渐隐，否则第一行会被无谓削掉一点
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const mic = new MicCapture(
      (samples) => window.vocal.sendAudioFrame(samples),
      (rms) => setLevel(rms)
    )
    capture.current = mic

    /** 按当前配置（重新）打开麦克风。设置里换了设备也走这里。 */
    const openMic = async (): Promise<void> => {
      const cfg = await window.vocal.getConfig()
      setTheme(cfg.ui.theme as ThemeMode)
      setCompact(cfg.models.streaming === 'none')
      try {
        await mic.init({
          deviceId: cfg.audio.deviceId,
          echoCancellation: cfg.audio.echoCancellation,
          noiseSuppression: cfg.audio.noiseSuppression,
          autoGainControl: cfg.audio.autoGainControl
        })
      } catch (e) {
        setToast({ level: 'error', text: `麦克风打开失败：${String(e)}` })
      }
    }

    void openMic()
    const off = window.vocal.onAudioConfigChanged(() => { void openMic() })

    return () => { off(); void mic.dispose() }
  }, [])

  // 主题：设置窗口改了会广播过来，跟随系统时还要监听系统切换
  useEffect(() => {
    applyTheme(theme)
    return watchSystemTheme(theme, () => applyTheme(theme))
  }, [theme])

  useEffect(() => window.vocal.onThemeChanged((m) => setTheme(m as ThemeMode)), [])
  useEffect(() => window.vocal.onPanelLayout((l) => setCompact(l.compact)), [])
  useEffect(() => window.vocal.onPanelVisible(setVisible), [])

  useEffect(() => {
    const offState = window.vocal.onStateChanged((s) => {
      setState(s)
      if (s === 'listening') capture.current?.open()
      if (s !== 'listening' && s !== 'arming') capture.current?.close()
      if (s === 'idle') { setCommitted(''); setLive('') }
    })
    const offPartial = window.vocal.onPartial((p) => {
      setCommitted(p.committed)
      setLive(p.live)
    })
    const offFinal = window.vocal.onTranscript((t) => {
      setCommitted(t.final)
      setLive('')
    })
    const offToast = window.vocal.onToast((m) => {
      setToast(m)
      setTimeout(() => setToast(null), 3200)
    })
    return () => { offState(); offPartial(); offFinal(); offToast() }
  }, [])

  // 文字变长时始终把最新内容滚进视野
  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end' })
    const el = scrollRef.current
    if (el) setScrolled(el.scrollTop > 2)
  }, [committed, live])

  const busy = state === 'listening' || state === 'arming'
  const working = state === 'finalizing' || state === 'consolidating' || state === 'injecting'
  const hasText = Boolean(committed || live)

  // 没有 backdrop-blur：底色本来就有 94% 不透明度，透过去的那 6% 糊不糊
  // 根本看不出来，而它是这个置顶透明窗口里最贵的一件事 ——
  // 每一帧都要采样一次背后的整块屏幕，进出动画期间正好抖给你看。
  const shell = 'flex h-full w-full items-center rounded-2xl shadow-2xl ' +
                'ring-1 ring-black/10 ' +
                (visible === null ? 'opacity-0' : visible ? 'panel-in' : 'panel-out')
  const bg = { background: 'color-mix(in srgb, var(--surface) 94%, transparent)' }

  // 没有流式模型 → 没有实时文本可显示，只留波形和一行状态
  if (compact) {
    return (
      <div className="h-screen w-screen p-1.5">
        <div className={`${shell} gap-2.5 px-3.5`} style={bg}>
          <Waveform level={level} active={busy} />
          <p className="min-w-0 flex-1 truncate text-[13px] text-[var(--fg-muted)]">
            {LABEL[state] || '按住热键说话'}
          </p>
        </div>
        {toast && <Toast toast={toast} />}
      </div>
    )
  }

  return (
    <div className="h-screen w-screen p-1.5">
      <div className={`${shell} gap-3 px-4`} style={bg}>
        <Waveform level={level} active={busy} />

        <div className="min-w-0 flex-1">
          {hasText ? (
            <div
              ref={scrollRef}
              onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
              className={`scrollbar-none max-h-[52px] overflow-y-auto text-[15px] leading-snug ${
                scrolled ? 'mask-fade-top' : ''
              }`}
            >
              {/* 已定稿 = 已经在目标窗口里了，灰一点 */}
              <span className="text-[var(--fg-muted)]">{committed}</span>
              {/* 正在说的这段，还没上屏 */}
              <span className="text-[var(--fg)]">{live}</span>
              <div ref={tailRef} />
            </div>
          ) : (
            <p className="text-[13px] text-[var(--fg-muted)]">{LABEL[state] || '按住热键说话'}</p>
          )}

          {hasText && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--fg-subtle)]">
              {working && <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-current" />}
              {LABEL[state]}
              <span className="tabular-nums">· {committed.length + live.length} 字</span>
            </p>
          )}
        </div>

      </div>

      {toast && <Toast toast={toast} />}
    </div>
  )
}

function Toast({ toast }: { toast: { level: string; text: string } }): React.ReactElement {
  return (
    <div className={`absolute inset-x-3 -bottom-1 translate-y-full rounded-lg px-3 py-1.5
                     text-[12px] shadow-lg ${
      toast.level === 'error' ? 'bg-[var(--danger)] text-white'
      : toast.level === 'warn' ? 'bg-[var(--warn)] text-white'
      : 'bg-[var(--fg)] text-[var(--bg)]'
    }`}>
      {toast.text}
    </div>
  )
}

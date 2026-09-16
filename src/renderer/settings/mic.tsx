/**
 * 麦克风选择。
 *
 * 设备名只有在拿到麦克风权限后才可见（浏览器的隐私限制），
 * 所以进页面就开一次麦再立刻关掉，换来一份有名字的列表。
 * 悬浮面板本来就常驻持有麦克风，这里多开一瞬不改变什么。
 */
import { useEffect, useRef, useState } from 'react'
import type { AppConfig, ConfigPatch } from '@shared/ipc'
import { Section, Row, Select, Button } from './ui'

const SYSTEM_DEFAULT = ''

export function MicSection({ cfg, patch }: {
  cfg: AppConfig
  patch: (p: ConfigPatch) => Promise<void>
}): React.ReactElement {
  const [devices, setDevices] = useState<Array<[string, string]>>([])
  const [denied, setDenied] = useState(false)
  const [level, setLevel] = useState(0)
  const [testing, setTesting] = useState(false)
  const live = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null)

  const enumerate = async (): Promise<void> => {
    const all = await navigator.mediaDevices.enumerateDevices()
    setDevices(
      all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
         .map((d, i) => [d.deviceId, d.label || `麦克风 ${i + 1}`] as [string, string])
    )
  }

  useEffect(() => {
    void (async () => {
      try {
        // 只为拿设备名，开完即关
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        s.getTracks().forEach((t) => t.stop())
      } catch {
        setDenied(true)
      }
      await enumerate()
    })()
    navigator.mediaDevices.addEventListener('devicechange', enumerate)
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate)
  }, [])

  const stopTest = (): void => {
    const l = live.current
    if (!l) return
    cancelAnimationFrame(l.raf)
    l.stream.getTracks().forEach((t) => t.stop())
    void l.ctx.close()
    live.current = null
    setTesting(false)
    setLevel(0)
  }

  const startTest = async (): Promise<void> => {
    stopTest()
    const id = cfg.audio.deviceId
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: id ? { deviceId: { exact: id } } : true
    })
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)

    // 噪声门限 + 快起慢落的包络。
    // 直接把 RMS 乘个系数显示的话，条子永远落不回去：房间底噪本身就有
    // 0.01 上下，自动增益还会在你说完之后把底噪一起放大，
    // 看上去就是「说完一句，绿条一直亮着」。
    const FLOOR = 0.01
    let env = 0
    const tick = (): void => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      const rms = Math.sqrt(sum / buf.length)
      const v = rms <= FLOOR ? 0 : Math.min(1, (rms - FLOOR) * 8)
      env = v > env ? v : env * 0.82        // 起得快，落得稳
      setLevel(env < 0.01 ? 0 : env)
      if (live.current) live.current.raf = requestAnimationFrame(tick)
    }
    live.current = { stream, ctx, raf: requestAnimationFrame(tick) }
    setTesting(true)
  }

  // 切设备时正在测就换过去；卸载时一定要关掉，否则麦克风指示灯一直亮着
  useEffect(() => { if (testing) void startTest() }, [cfg.audio.deviceId])
  useEffect(() => stopTest, [])

  const a = cfg.audio
  return (
    <Section title="麦克风" hint={denied ? '请在 Windows 设置中允许麦克风访问' : undefined}>
      <Row label="设备">
        <div className="flex items-center gap-2">
          <Select
            value={a.deviceId ?? SYSTEM_DEFAULT}
            onChange={(v) => patch({ audio: { ...a, deviceId: v === SYSTEM_DEFAULT ? null : v } })}
            options={[[SYSTEM_DEFAULT, '系统默认'], ...devices]}
            className="max-w-xs flex-1"
          />
          <Button
            variant={testing ? 'default' : 'primary'}
            onClick={() => (testing ? stopTest() : void startTest())}
          >
            {testing ? '停止' : '测试'}
          </Button>
        </div>

        {testing && (
          <div className="mt-2.5 max-w-xs">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${level * 100}%`, transition: 'width 60ms linear' }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">说话时观察音量变化</p>
          </div>
        )}
      </Row>

    </Section>
  )
}

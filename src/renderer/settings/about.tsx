/**
 * 关于页：这个程序在这台机器上占了什么。
 *
 * 资源统计不是凑数的 —— 常驻的语音输入必须回答「它是不是一直在吃我的内存」。
 * 模型常驻是这个方案最大的代价（几百 MB 起），与其让用户去任务管理器里
 * 对着五个同名的 Vocal 进程猜，不如按角色列清楚：主进程、界面、
 * 流式识别、定稿识别各占多少。关掉流式模型能省多少，这里一眼看得见。
 */
import { useEffect, useState } from 'react'
import type { AppConfig, AppStats, UpdateStatus } from '@shared/ipc'
import { Page, Section, Row, Button, Note, Toggle } from './ui'
import { useModelStatus, mb } from './models'

function fmtMB(v: number): string {
  return v >= 1024 ? `${(v / 1024).toFixed(2)} GB` : `${v.toFixed(0)} MB`
}

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${s % 60} 秒`
  return `${s} 秒`
}

export function AboutTab({ cfg, patch }: {
  cfg: AppConfig
  patch: (p: Partial<AppConfig>) => Promise<void>
}): React.ReactElement {
  const { status } = useModelStatus()
  const [stats, setStats] = useState<AppStats | null>(null)

  useEffect(() => {
    const tick = (): void => { void window.vocal.appStats().then(setStats) }
    tick()
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [])

  const modelBytes = status
    ? Object.values(status.installed).reduce((sum, m) => sum + m.bytes, 0)
    : 0

  return (
    <Page title="关于" desc="Vocal —— Windows 桌面语音输入，识别全部在本机完成。">
      <Section title="资源占用">
        {stats ? (
          <>
            <div className="flex items-baseline gap-6">
              <div>
                <div className="text-[11px] text-[var(--fg-subtle)]">内存</div>
                <div className="mt-0.5 text-[22px] font-semibold tabular-nums text-[var(--fg)]">
                  {fmtMB(stats.totalMemoryMB)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--fg-subtle)]">CPU</div>
                <div className="mt-0.5 text-[22px] font-semibold tabular-nums text-[var(--fg)]">
                  {stats.processes.reduce((s, p) => s + p.cpu, 0).toFixed(1)}
                  <span className="ml-0.5 text-[12px] font-normal text-[var(--fg-muted)]">%</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--fg-subtle)]">已运行</div>
                <div className="mt-0.5 text-[22px] font-semibold tabular-nums text-[var(--fg)]">
                  {fmtUptime(stats.uptimeMs)}
                </div>
              </div>
            </div>

            <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {stats.processes.map((p) => (
                <div key={p.label} className="flex items-center gap-3 py-2 text-[12px]">
                  <span className="w-24 shrink-0 text-[var(--fg)]">{p.label}</span>
                  <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full
                                  bg-[var(--surface-hover)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{
                        width: `${Math.min(100, (p.memoryMB / Math.max(1, stats.totalMemoryMB)) * 100)}%`
                      }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right tabular-nums text-[var(--fg-muted)]">
                    {fmtMB(p.memoryMB)}
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-[var(--fg-subtle)]">
                    {p.cpu.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
            <Note>识别模型常驻内存，关掉流式或定稿其中一层能省下大约一半。</Note>
          </>
        ) : (
          <div className="text-[13px] text-[var(--fg-subtle)]">读取中…</div>
        )}
      </Section>

      <Section title="存储">
        <Row label="数据目录">
          <code className="block break-all rounded-lg border border-[var(--border)]
                           bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[11px]">
            {status?.dataDir ?? '—'}
          </code>
          {status && !status.portable && (
            <div className="mt-2"><Note tone="warn">程序目录不可写，已回落到用户目录。</Note></div>
          )}
          <div className="mt-2">
            <Button variant="default" size="sm" onClick={() => void window.vocal.openModelsDir()}>
              打开模型目录
            </Button>
          </div>
        </Row>

        <Row label="模型占用">
          <span className="text-[13px] tabular-nums text-[var(--fg)]">{mb(modelBytes)}</span>
        </Row>
      </Section>

      <UpdateSection cfg={cfg} patch={patch} portable={stats?.portable ?? false} />

      <Section title="版本">
        <Row label="Vocal">
          <span className="text-[13px] tabular-nums text-[var(--fg)]">{stats?.version ?? '—'}</span>
        </Row>
        <Row label="Electron">
          <span className="text-[13px] tabular-nums text-[var(--fg-muted)]">
            {stats?.electron ?? '—'}
          </span>
        </Row>
        <Row label="安装方式">
          <span className="text-[13px] text-[var(--fg-muted)]">
            {stats ? (stats.portable ? '便携版' : '安装版') : '—'}
          </span>
        </Row>
      </Section>

      <Section title="隐私">
        <p className="text-[12px] leading-relaxed text-[var(--fg-muted)]">
          语音、文字、历史都只存在这台电脑上。唯一联网的是「整理」，默认关闭，关着就完全离线。
        </p>
      </Section>
    </Page>
  )
}

/**
 * 更新。
 *
 * 安装版后台下载，下完不打断 —— 等下次退出应用自动装上。
 * 语音输入随时可能被热键叫起来，弹「立即重启」的框把人从正在写的
 * 东西里拽出来是最糟的做法，所以「立即重启更新」只做成一个按钮，
 * 用户想现在装才点。
 */
function UpdateSection({ cfg, patch, portable }: {
  cfg: AppConfig
  patch: (p: Partial<AppConfig>) => Promise<void>
  portable: boolean
}): React.ReactElement {
  const [st, setSt] = useState<UpdateStatus | null>(null)
  useEffect(() => window.vocal.onUpdateStatus(setSt), [])

  const line = ((): string => {
    if (!st) return ''
    switch (st.state) {
      case 'dev': return '开发模式下不检查更新。'
      case 'checking': return '正在检查…'
      case 'latest': return '已经是最新版本。'
      case 'available': return `有新版本 ${st.latest ?? ''}，去 GitHub Releases 下载。`
      case 'downloading': return `正在后台下载 ${st.latest ?? ''}… ${st.percent ?? 0}%`
      case 'ready': return `${st.latest ?? ''} 已下载完成，下次退出 Vocal 时自动装上。`
      case 'error': return `检查更新失败：${st.message ?? ''}`
      default: return ''
    }
  })()

  return (
    <Section title="更新">
      {!portable && (
        <Row label="自动更新" hint="后台下载，退出时装上，不打断你">
          <Toggle
            checked={cfg.update.auto}
            onChange={(b) => patch({ update: { ...cfg.update, auto: b } })}
          />
        </Row>
      )}
      <Row label="检查">
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            onClick={() => void window.vocal.checkUpdate().then(setSt)}
            disabled={st?.state === 'checking' || st?.state === 'downloading'}
          >
            检查更新
          </Button>
          {st?.state === 'ready' && (
            <Button variant="primary" onClick={() => void window.vocal.installUpdate()}>
              立即重启更新
            </Button>
          )}
        </div>
        {line && <div className="mt-2"><Note tone={st?.state === 'error' ? 'danger' : 'muted'}>{line}</Note></div>}
        {portable && (
          <div className="mt-2">
            <Note>便携版不自动覆盖安装 —— 你的数据就在程序旁边，交给安装器去写风险太大。有新版本会在这里提示，手动下载替换即可。</Note>
          </div>
        )}
      </Row>
    </Section>
  )
}

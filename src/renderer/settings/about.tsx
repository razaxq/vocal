/**
 * 关于页：这个程序在这台机器上占了什么。
 *
 * 资源统计不是凑数的 —— 常驻的语音输入必须回答「它是不是一直在吃我的内存」。
 * 模型常驻是这个方案最大的代价（几百 MB 起），与其让用户去任务管理器里
 * 对着五个同名的 Vocal 进程猜，不如按角色列清楚：主进程、界面、
 * 流式识别、定稿识别各占多少。关掉流式模型能省多少，这里一眼看得见。
 */
import { useEffect, useState } from 'react'
import type { AppStats, UpdateStatus } from '@shared/ipc'
import { Page, Section, Row, Button, Note, ErrorDetails } from './ui'
import { useModelStatus, mb } from './models'
import changelog from '@shared/changelog.json'

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

export function AboutTab({ updateStatus }: {
  updateStatus: UpdateStatus | null
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
    <Page title="关于" desc={<>
      Vocal：本地语音输入工具，历史保存在本机；AI 整理会向所选服务发送文字。
      <span className="mt-1 block">
        由 <a href="https://blog.dtft.net/about/" target="_blank" rel="noopener noreferrer"
          className="text-[var(--accent)] underline underline-offset-2">Ramos</a> 开发
      </span>
    </>}>
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

      <UpdateSection st={updateStatus} />

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

      <Section title="更新日志">
        <div className="divide-y divide-[var(--border)]">
          {changelog.map((entry) => (
            <article key={entry.version} className="py-4 first:pt-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-[13px] font-medium text-[var(--fg)]">v{entry.version}</h3>
                <time dateTime={entry.date} className="text-[12px] tabular-nums text-[var(--fg-subtle)]">
                  {entry.date}
                </time>
                {stats?.version === entry.version && (
                  <span className="text-[12px] text-[var(--accent)]">当前版本</span>
                )}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-[var(--fg-muted)]">
                {entry.changes.map((change) => <li key={change}>{change}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </Section>
    </Page>
  )
}

/** 检查、下载、安装用同一个入口，发行方式不出现在操作说明里。 */
function UpdateSection({ st }: {
  st: UpdateStatus | null
}): React.ReactElement {
  const [actionError, setActionError] = useState('')
  const busy = st?.state === 'checking' || st?.state === 'downloading' || st?.state === 'installing'
  const act = async (): Promise<void> => {
    setActionError('')
    try {
      if (st?.latest) await window.vocal.installUpdate()
      else await window.vocal.checkUpdate()
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
  }

  const line = ((): string => {
    if (!st) return ''
    switch (st.state) {
      case 'dev': return '开发模式下不检查更新。'
      case 'checking': return '正在检查…'
      case 'latest': return '已是最新版本'
      case 'available': return `有新版本 ${st.latest ?? ''}`
      case 'downloading': return `正在下载 ${st.latest ?? ''}… ${st.percent ?? 0}%`
      case 'ready': return `${st.latest ?? ''} 已下载，可重启更新`
      case 'installing': return '正在更新，完成后自动重启…'
      case 'error': return ''
      default: return ''
    }
  })()

  return (
    <Section title="更新">
      <Row label="版本更新">
        <div className="flex items-center gap-2">
          <Button
            variant={st?.latest ? 'primary' : 'default'}
            onClick={() => void act()}
            disabled={busy}
          >
            {st?.state === 'downloading' ? '正在下载…'
              : st?.state === 'installing' ? '正在更新…'
                : st?.state === 'checking' ? '正在检查…'
                  : st?.state === 'ready' ? '重启更新'
                    : st?.latest ? (st.state === 'error' ? '重试更新' : '立即更新') : '检查更新'}
          </Button>
        </div>
        {line && !actionError && <div className="mt-2"><Note>{line}</Note></div>}
        {(actionError || st?.state === 'error') && (
          <div className="mt-2"><ErrorDetails title="更新失败，请重试" detail={actionError || st?.message} /></div>
        )}
      </Row>
    </Section>
  )
}

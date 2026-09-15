/**
 * 模型管理页。
 *
 * 目标是把命令行彻底赶出用户视野：当前在用哪个、哪些下好了、各占多少磁盘、
 * 下载进度、失败原因、删除腾空间 —— 全在这一页里完成。
 *
 * 之前的做法是启动时弹个框说「缺模型，去跑 npm run models」，
 * 那对拿到安装包的人等于死路。
 */
import { useEffect, useState, useCallback } from 'react'
import type { AppConfig, ModelStatusInfo, ModelProgress } from '@shared/ipc'
import { modelsOf, type ModelEntry } from '@shared/modelRegistry'
import { Page, Section, Row, Button, Badge } from './ui'

const mb = (b: number): string =>
  b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB` : `${(b / (1 << 20)).toFixed(0)} MB`

const PHASE_LABEL: Record<ModelProgress['phase'], string> = {
  queued: '排队中',
  downloading: '下载中',
  extracting: '解压中',
  verifying: '校验中',
  done: '完成',
  error: '失败',
  cancelled: '已取消'
}

export function ModelsTab({ cfg, patch }: {
  cfg: AppConfig
  patch: (p: Partial<AppConfig>) => Promise<void>
}): React.ReactElement {
  const [status, setStatus] = useState<ModelStatusInfo | null>(null)
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({})

  const reload = useCallback(() => {
    void window.vocal.modelsStatus().then(setStatus)
  }, [])

  useEffect(reload, [reload])

  useEffect(() => {
    return window.vocal.onModelProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.id]: p }))
      // 下完/删完/出错都要刷新磁盘占用和「已下载」标记
      if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') reload()
    })
  }, [reload])

  const required = status && !status.ready

  return (
    <Page
      title="模型"
      desc="识别全部在本机完成，不联网。模型文件不随程序分发，第一次用需要下载。"
    >
      {required && (
        <div className="rounded-xl border border-[var(--warn)] bg-[var(--surface)] p-4">
          <div className="text-[13px] font-medium text-[var(--warn)]">还不能开始识别</div>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-muted)]">
            缺少：{status.missing.join('、')}。
            下面把带「当前使用」标记的模型下载完就能用了，大约 {mb(545 * (1 << 20))}。
          </p>
        </div>
      )}

      <ModelGroup
        slot="streaming"
        title="流式模型"
        desc="说话时实时出字用的。中英混排选 Paraformer；纯中文可以试 Zipformer，2025 年的新模型更准，但英文单词会被音译。"
        cfg={cfg} patch={patch} status={status} progress={progress}
        inactive={cfg.asrProfile === 'final-only'}
        inactiveNote="当前引擎档位是「只离线」，不加载流式模型"
      />

      <ModelGroup
        slot="offline"
        title="定稿模型"
        desc="每句说完后重转写一遍用的，决定最终文字的准确率。"
        cfg={cfg} patch={patch} status={status} progress={progress}
        inactive={cfg.asrProfile === 'streaming-only'}
        inactiveNote="当前引擎档位是「只流式」，不做重转写"
      />

      <ModelGroup
        slot="punct"
        title="标点模型"
        desc="给识别结果补标点。必需，没有它输出会是一长串没有断句的文字。"
        cfg={cfg} patch={patch} status={status} progress={progress} fixed
      />

      {status && (
        <Section title="存储">
          <Row
            label="数据目录"
            hint={status.portable
              ? '便携模式：配置、历史、模型都在程序旁边，整个文件夹拷走就能换机器用。'
              : '程序目录不可写（多半装在了 Program Files），已回落到用户目录。'}
          >
            <code className="block break-all rounded-lg border border-[var(--border)]
                             bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[11px]">
              {status.dataDir}
            </code>
            <div className="mt-2 flex items-center gap-3">
              {status.portable
                ? <Badge tone="ok">便携模式</Badge>
                : <Badge tone="warn">非便携</Badge>}
              <Button variant="ghost" onClick={() => void window.vocal.openModelsDir()}>
                打开模型目录
              </Button>
            </div>
          </Row>
        </Section>
      )}
    </Page>
  )
}

function ModelGroup({ slot, title, desc, cfg, patch, status, progress, fixed, inactive, inactiveNote }: {
  slot: 'streaming' | 'offline' | 'punct'
  title: string
  desc: string
  cfg: AppConfig
  patch: (p: Partial<AppConfig>) => Promise<void>
  status: ModelStatusInfo | null
  progress: Record<string, ModelProgress>
  /** 这个槽位没有可选项，只有一个必需模型 */
  fixed?: boolean
  inactive?: boolean
  inactiveNote?: string
}): React.ReactElement {
  const list = modelsOf(slot)
  const current = fixed ? list[0]?.id : (cfg.models as Record<string, string>)[slot]

  return (
    <Section title={title} hint={desc}>
      {inactive && <Badge tone="neutral">{inactiveNote}</Badge>}
      <div className="space-y-2">
        {list.map((m) => (
          <ModelRow
            key={m.id}
            model={m}
            active={m.id === current}
            selectable={!fixed}
            dimmed={inactive}
            installed={status?.installed[m.id]?.installed ?? false}
            bytes={status?.installed[m.id]?.bytes ?? 0}
            progress={progress[m.id]}
            onSelect={() => {
              if (fixed) return
              void patch({ models: { ...cfg.models, [slot]: m.id } })
            }}
          />
        ))}
      </div>
    </Section>
  )
}

function ModelRow({ model, active, selectable, dimmed, installed, bytes, progress, onSelect }: {
  model: ModelEntry
  active: boolean
  selectable: boolean
  dimmed?: boolean
  installed: boolean
  bytes: number
  progress?: ModelProgress
  onSelect: () => void
}): React.ReactElement {
  const busy = progress && !['done', 'error', 'cancelled'].includes(progress.phase)
  const pct = progress && progress.total > 0
    ? Math.min(100, (progress.received / progress.total) * 100)
    : null

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
          : 'border-[var(--border)]'
      } ${dimmed ? 'opacity-55' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--fg)]">{model.name}</span>
            {active && <Badge tone="ok">当前使用</Badge>}
            {installed
              ? <Badge tone="neutral">已下载 {mb(bytes)}</Badge>
              : <Badge tone="warn">未下载 约 {model.approxMB} MB</Badge>}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--fg-muted)]">{model.langs}</div>
          <div className="mt-1 text-[11px] leading-relaxed text-[var(--fg-subtle)]">{model.note}</div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {busy ? (
            <Button variant="default" size="sm"
                    onClick={() => void window.vocal.cancelModelDownload(model.id)}>
              取消
            </Button>
          ) : installed ? (
            <>
              {selectable && !active && (
                <Button variant="primary" size="sm" onClick={onSelect}>使用</Button>
              )}
              <Button variant="danger" size="sm"
                      onClick={() => void window.vocal.deleteModel(model.id)}>
                删除
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => void window.vocal.downloadModel(model.id)}>
              下载
            </Button>
          )}
        </div>
      </div>

      {busy && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width]"
              style={{ width: pct !== null ? `${pct}%` : '100%' }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--fg-subtle)]">
            <span>{PHASE_LABEL[progress.phase]}</span>
            {progress.phase === 'downloading' && progress.total > 0 && (
              <span>{mb(progress.received)} / {mb(progress.total)}</span>
            )}
          </div>
        </div>
      )}

      {progress?.phase === 'error' && (
        <p className="mt-2 rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-[11px]
                      leading-relaxed text-[var(--danger)]">
          下载失败：{progress.message}
        </p>
      )}

      {active && !installed && !busy && (
        <p className="mt-2 text-[11px] text-[var(--warn)]">
          这是当前选中的模型，但还没下载 —— 点右边的「下载」。
        </p>
      )}
    </div>
  )
}

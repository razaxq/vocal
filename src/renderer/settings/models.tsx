/**
 * 模型选择与下载。
 *
 * 只有一个动作：点哪个就用哪个。没下载的点了直接开始下 ——
 * 之前「选一个 + 再点下载」是两步，而这两步永远同向，合成一步。
 * 「不使用」是列表里的一行，不是另一个开关：不用这一层，就选那一行。
 */
import { useEffect, useState, useCallback } from 'react'
import type { AppConfig, ModelStatusInfo, ModelProgress, AsrStatus } from '@shared/ipc'
import { modelsOf, MODEL_NONE, type ModelEntry } from '@shared/modelRegistry'
import { Section, Button } from './ui'

export const mb = (b: number): string =>
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

/** 模型状态 + 下载进度的订阅。识别页和关于页共用。 */
export function useModelStatus(): {
  status: ModelStatusInfo | null
  progress: Record<string, ModelProgress>
  reload: () => void
} {
  const [status, setStatus] = useState<ModelStatusInfo | null>(null)
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({})

  const reload = useCallback(() => {
    void window.vocal.modelsStatus().then(setStatus)
  }, [])

  useEffect(reload, [reload])

  useEffect(() => window.vocal.onModelProgress((p) => {
    setProgress((prev) => ({ ...prev, [p.id]: p }))
    // 下完 / 删完 / 出错都要刷新磁盘占用和「已下载」标记
    if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') reload()
  }), [reload])

  return { status, progress, reload }
}

/** 顶部的「还不能开始识别」警示条。 */
export function MissingModelsNotice({ status }: {
  status: ModelStatusInfo | null
}): React.ReactElement | null {
  if (!status || status.ready) return null
  return (
    <div className="mb-5 rounded-lg border border-[var(--warn)] bg-[var(--surface-2)] px-3.5 py-2.5
                    text-[12px] text-[var(--warn)]">
      还不能识别：{status.missing.join('、')} 未就绪。选中的模型会自动开始下载。
    </div>
  )
}

export function ModelGroup({ slot, title, hint, cfg, patch, status, progress, fixed, allowNone }: {
  slot: 'streaming' | 'offline' | 'punct'
  title: string
  hint?: string
  cfg: AppConfig
  patch: (p: Partial<AppConfig>) => Promise<void>
  status: ModelStatusInfo | null
  progress: Record<string, ModelProgress>
  /** 这个槽位没得选，只有一个必需模型 */
  fixed?: boolean
  /** 允许选「不使用」—— 两层都关掉就没法识别了，由调用方判断 */
  allowNone?: boolean
}): React.ReactElement {
  const list = modelsOf(slot)
  const current = fixed ? list[0]?.id : (cfg.models as Record<string, string>)[slot]

  /**
   * 选中即启用；没下载就顺手开始下 —— 这两件事从来不会分开做。
   * 固定槽位（标点）没得选，但点一下仍然要能触发下载，否则缺了就没有入口。
   */
  const select = (id: string): void => {
    if (id === MODEL_NONE) {
      if (!fixed && id !== current) void patch({ models: { ...cfg.models, [slot]: id } })
      return
    }
    if (!fixed && id !== current) void patch({ models: { ...cfg.models, [slot]: id } })
    if (!status?.installed[id]?.installed) void window.vocal.downloadModel(id)
  }

  return (
    <Section title={title} hint={hint}>
      <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {!fixed && (
          <PickRow
            active={current === MODEL_NONE}
            disabled={!allowNone}
            name="不使用"
            sub={allowNone ? '跳过这一层' : '流式和定稿不能同时关闭'}
            onSelect={() => allowNone && select(MODEL_NONE)}
          />
        )}
        {list.map((m) => (
          <ModelRow
            key={m.id}
            model={m}
            active={m.id === current}
            installed={status?.installed[m.id]?.installed ?? false}
            bytes={status?.installed[m.id]?.bytes ?? 0}
            progress={progress[m.id]}
            onSelect={() => select(m.id)}
          />
        ))}
      </div>
    </Section>
  )
}

/** 左侧的选中标记 + 名称 + 副标题，模型行和「不使用」行共用。 */
function PickRow({ active, disabled, name, sub, onSelect, right, below }: {
  active: boolean
  disabled?: boolean
  name: string
  sub?: string
  onSelect: () => void
  right?: React.ReactNode
  below?: React.ReactNode
}): React.ReactElement {
  return (
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onSelect() }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect() }
      }}
      className={`px-2 py-2.5 transition-colors ${
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-[var(--surface-hover)]'
      } ${active ? 'bg-[var(--accent-soft)]' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border
                          transition-colors ${
          active ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border-strong)]'
        }`}>
          {active && (
            <svg width="9" height="7" viewBox="0 0 9 7" aria-hidden>
              <path d="M1 3.6L3.4 6 8 1" fill="none" stroke="white" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[var(--fg)]">{name}</div>
          {sub && <div className="mt-0.5 text-[11px] text-[var(--fg-subtle)]">{sub}</div>}
        </div>

        {right && (
          <div className="flex shrink-0 items-center gap-2.5"
               onClick={(e) => e.stopPropagation()}>
            {right}
          </div>
        )}
      </div>
      {below}
    </div>
  )
}

function ModelRow({ model, active, installed, bytes, progress, onSelect }: {
  model: ModelEntry
  active: boolean
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
    <PickRow
      active={active}
      name={model.name}
      sub={`${model.langs} · ${model.note}`}
      onSelect={onSelect}
      right={
        busy ? (
          <Button variant="default" size="sm"
                  onClick={() => void window.vocal.cancelModelDownload(model.id)}>
            取消
          </Button>
        ) : installed ? (
          <>
            <span className="text-[11px] tabular-nums text-[var(--fg-subtle)]">{mb(bytes)}</span>
            <Button variant="danger" size="sm"
                    onClick={() => void window.vocal.deleteModel(model.id)}>
              删除
            </Button>
          </>
        ) : (
          <span className="text-[11px] tabular-nums text-[var(--fg-subtle)]">
            约 {model.approxMB} MB
          </span>
        )
      }
      below={
        <>
          {busy && (
            <div className="mt-2 pl-[26px]">
              <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-hover)]">
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
            <p className="mt-2 pl-[26px] text-[11px] text-[var(--danger)]">
              下载失败：{progress.message}
            </p>
          )}

          {active && !installed && !busy && (
            <p className="mt-2 pl-[26px] text-[11px] text-[var(--warn)]">
              还没下载。点这一行开始下载。
            </p>
          )}
        </>
      }
    />
  )
}

/**
 * 换模型后的重载状态。
 *
 * 以前这里写的是「换模型后重启 Vocal 生效」—— 那是把实现的限制直接
 * 转嫁给用户。现在主进程会把两个 ASR 工作进程换掉，这行只是告诉用户
 * 那一两秒正在发生什么。
 */
export function AsrStatusLine(): React.ReactElement | null {
  const [st, setSt] = useState<AsrStatus | null>(null)

  useEffect(() => window.vocal.onAsrStatus((s) => {
    setSt(s)
    if (s.state === 'ready') setTimeout(() => setSt(null), 2500)
  }), [])

  if (!st) return null
  const text = st.state === 'loading'
    ? '正在重新加载模型…'
    : st.state === 'ready'
      ? '模型已切换，可以直接说话。'
      : `模型加载失败：${st.message ?? ''}`

  return (
    <p className={`mb-4 text-[12px] ${
      st.state === 'error' ? 'text-[var(--danger)]' : 'text-[var(--fg-muted)]'
    }`}>
      {text}
    </p>
  )
}

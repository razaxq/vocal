/**
 * 模型选择与下载。
 *
 * 只有一个动作：点哪个就用哪个。没下载的点了直接开始下 ——
 * 之前「选一个 + 再点下载」是两步，而这两步永远同向，合成一步。
 * 「不使用」是列表里的一行，不是另一个开关：不用这一层，就选那一行。
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import type { AppConfig, ModelStatusInfo, ModelProgress, AsrStatus } from '@shared/ipc'
import { modelsOf, MODEL_NONE, type ModelEntry } from '@shared/modelRegistry'
import { Section, Button, ErrorDetails } from './ui'

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
  asrStatus: AsrStatus | null
  reload: () => void
} {
  const [status, setStatus] = useState<ModelStatusInfo | null>(null)
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({})
  const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null)

  const reload = useCallback(() => {
    void window.vocal.modelsStatus().then(value => {
      setStatus(value)
      setAsrStatus(previous => previous ?? value.asr ?? null)
    })
  }, [])

  useEffect(reload, [reload])
  useEffect(() => window.vocal.onModelsChanged(reload), [reload])
  useEffect(() => window.vocal.onAsrStatus(setAsrStatus), [])

  useEffect(() => window.vocal.onModelProgress((p) => {
    setProgress((prev) => ({ ...prev, [p.id]: p }))
    // 下完 / 删完 / 出错都要刷新磁盘占用和「已下载」标记
    if (p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') reload()
  }), [reload])

  return { status, progress, reload, asrStatus }
}

/** 顶部的「还不能开始识别」警示条。 */
export function MissingModelsNotice({ status }: {
  status: ModelStatusInfo | null
}): React.ReactElement | null {
  if (!status || status.ready) return null
  return (
    <div className="mb-5 rounded-lg border border-[var(--warn)] bg-[var(--surface-2)] px-3.5 py-2.5
                    text-[12px] text-[var(--warn)]">
      请下载所需模型：{status.missing.join('、')}。
    </div>
  )
}

export function ModelGroup({ slot, title, hint, cfg, patch, status, progress, fixed, allowNone, asrStatus }: {
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
  asrStatus?: AsrStatus | null
}): React.ReactElement {
  const list = modelsOf(slot)
  const current = fixed ? list[0]?.id : (cfg.models as Record<string, string>)[slot]
  const target = slot !== 'punct' ? asrStatus?.targets?.[slot] : undefined
  const switching = asrStatus?.state === 'loading'
  const error = asrStatus?.state === 'error' ? asrStatus.message : undefined

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
      {/*
        行与行之间靠间距分开，不用横线。
        之前是「上下包边 + divide-y」，选中行的绿色底就被那两条直线切成方角 ——
        圆角的高亮块卡在两条直线中间，怎么看都像没做完。
        列表本身已经在一个有标题的小节里，不需要再画线来说明「这几行是一组」。
      */}
      <div className="space-y-1">
        {!fixed && (
          <PickRow
            active={current === MODEL_NONE}
            disabled={!allowNone}
            name="不使用"
            sub={allowNone ? undefined : '至少保留一种识别模型'}
            onSelect={() => allowNone && select(MODEL_NONE)}
            right={target === MODEL_NONE && switching ? <LoadingIcon label={asrStatus?.message ?? '正在切换模型'} /> : undefined}
            below={target === MODEL_NONE && error ? <div className="mt-2 pl-[26px]"><ErrorDetails title="模型切换失败" detail={error} /></div> : undefined}
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
            switching={m.id === target && switching}
            switchLabel={asrStatus?.message}
            switchError={m.id === target ? error : undefined}
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
        if (e.target !== e.currentTarget) return
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect() }
      }}
      className={`rounded-lg px-2.5 py-2.5 transition-colors ${
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-[var(--surface-hover)]'
      } ${active ? 'bg-[var(--accent-soft)] ring-1 ring-inset ring-[var(--accent-ring)]' : ''}`}
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

function ModelRow({ model, active, installed, bytes, progress, onSelect, switching, switchLabel, switchError }: {
  model: ModelEntry
  active: boolean
  installed: boolean
  bytes: number
  progress?: ModelProgress
  onSelect: () => void
  switching?: boolean
  switchLabel?: string
  switchError?: string
}): React.ReactElement {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletePending = useRef(false)
  const remove = async (): Promise<void> => {
    if (deletePending.current) return
    deletePending.current = true
    setDeleting(true)
    setDeleteError('')
    try {
      await window.vocal.deleteModel(model.id)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      deletePending.current = false
      setDeleting(false)
    }
  }
  const busy = progress && !['done', 'error', 'cancelled'].includes(progress.phase)
  const pct = progress && progress.total > 0
    ? Math.min(100, (progress.received / progress.total) * 100)
    : null

  return (
    <PickRow
      active={active}
      disabled={deleting}
      name={model.name}
      sub={[model.langs, model.note].filter(Boolean).join(' · ')}
      onSelect={onSelect}
      right={
        <>
        {switching && !deleting && <LoadingIcon label={switchLabel ?? '正在切换模型'} />}
        {busy ? (
          <Button variant="default" size="sm"
                  onClick={() => void window.vocal.cancelModelDownload(model.id)}>
            取消
          </Button>
        ) : installed ? (
          <>
            <span className="text-[11px] tabular-nums text-[var(--fg-subtle)]">{mb(bytes)}</span>
            <button type="button" title={deleting ? '正在删除' : '删除模型'}
              aria-label={deleting ? `正在删除 ${model.name}` : `删除 ${model.name}`}
              aria-busy={deleting} disabled={deleting || switching} onClick={() => void remove()}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:text-[var(--fg-subtle)] disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              {deleting ? <LoadingIcon label="正在删除" /> : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
                </svg>
              )}
            </button>
          </>
        ) : (
          <span className="text-[11px] tabular-nums text-[var(--fg-subtle)]">
            下载约 {model.downloadBytes ? mb(model.downloadBytes) : `${model.approxMB} MB`}
          </span>
        )}
        </>
      }
      below={
        <>
          {switchError && !busy && !deleting && <div className="mt-2 pl-[26px]" onClick={e => e.stopPropagation()}>
            <ErrorDetails title="模型切换失败" detail={switchError} />
          </div>}
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

          {deleteError && (
            <p role="alert" className="mt-2 pl-[26px] text-[11px] text-[var(--danger)]">
              删除失败：{deleteError}
            </p>
          )}
          {!installed && !busy && !deleting && model.installedBytes && (
            <p className="mt-1 pl-[26px] text-[11px] text-[var(--fg-subtle)]">
              安装后约 {mb(model.installedBytes)}
            </p>
          )}
          {!installed && progress?.phase === 'error' && (
            <div className="mt-2 pl-[26px]" onClick={(e) => e.stopPropagation()}>
              <ErrorDetails title="下载失败，请重新下载" detail={progress.message} />
            </div>
          )}

          {active && !installed && !busy && !deleting && (
            <p className="mt-2 pl-[26px] text-[11px] text-[var(--warn)]">
              点击下载
            </p>
          )}
        </>
      }
    />
  )
}

function LoadingIcon({ label }: { label: string }): React.ReactElement {
  return <span role="status" aria-label={label} title={label} className="inline-flex h-4 w-4 shrink-0 text-current">
    <svg className="animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  </span>
}

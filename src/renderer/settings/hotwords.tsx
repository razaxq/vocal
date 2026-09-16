import { useEffect, useState } from 'react'
import type { AppConfig, HotwordCatalogStatus } from '@shared/ipc'
import { findModel } from '@shared/modelRegistry'
import { Button, LineList, Note, Row, Section, Toggle } from './ui'

export function useHotwordCatalog(): HotwordCatalogStatus | null {
  const [status, setStatus] = useState<HotwordCatalogStatus | null>(null)
  useEffect(() => {
    let live = true
    let received = false
    const off = window.vocal.onHotwordCatalog(value => { received = true; setStatus(value) })
    void window.vocal.getHotwordCatalog().then(value => {
      if (live && !received) setStatus(value)
    }).catch(() => { /* 手动更新可重试。 */ })
    return () => { live = false; off() }
  }, [])
  return status
}

export function HotwordsSection({ cfg, patch }: {
  cfg: AppConfig; patch: (value: Partial<AppConfig>) => Promise<void>
}): React.ReactElement {
  const status = useHotwordCatalog()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const prefs = cfg.networkHotwords
  const streaming = findModel('streaming', cfg.models.streaming)?.kind === 'online-zipformer'
  const offline = findModel('offline', cfg.models.offline)?.kind === 'offline-transducer'
  const update = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try { await window.vocal.checkHotwordCatalog() } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  return (
    <>
      <Section title="雾凇词库" hint="按词频选取 500 个词，离线可用">
        <Row label="使用基础词库">
          <Toggle checked={prefs.enabled} ariaLabel="使用基础词库" onChange={enabled => patch({ networkHotwords: { ...prefs, enabled } })} />
        </Row>
        <Row label="自动更新词库" hint="每周检查一次">
          <Toggle checked={prefs.autoUpdate} disabled={!prefs.enabled} ariaLabel="自动更新词库"
            onChange={autoUpdate => patch({ networkHotwords: { ...prefs, autoUpdate } })} />
        </Row>
        <Row label={status ? `${status.words.length} 个词 · ${status.updatedAt}` : '词库'}>
          <Button size="sm" disabled={busy || status?.state === 'checking'} onClick={() => void update()}>
            {busy || status?.state === 'checking' ? '正在更新…' : '更新词库'}
          </Button>
        </Row>
        {(failed || status?.state === 'error') && <Note tone="warn">更新失败，继续使用本地词库</Note>}
        {status?.state === 'latest' && !failed && <Note>词库已是最新</Note>}
        {status?.state === 'updated' && !failed && <Note>词库已更新，下次录音生效</Note>}
        {status && (
          <p className="mt-2 text-[12px] text-[var(--fg-muted)]">
            来源：<a className="underline underline-offset-2" href="https://github.com/iDvel/rime-ice" target="_blank" rel="noopener noreferrer">雾凇拼音</a>
            {' · '}GPL-3.0
          </p>
        )}
        {status && (
          <details className="mt-2 text-[12px] text-[var(--fg-muted)]">
            <summary className="cursor-pointer">查看词语</summary>
            <p className="mt-2">已从 {status.source.eligibleCount.toLocaleString()} 个候选中选取，非完整词库。</p>
            <p className="mt-2 max-h-36 select-text overflow-y-auto leading-relaxed">{status.words.join('、')}</p>
          </details>
        )}
      </Section>
      <Section title="个人热词" hint="填写常用人名、地名或术语">
        <LineList value={cfg.hotwords} rows={5} placeholder={'张晓明\n苏州工业园区\nVocal'}
          onChange={hotwords => patch({ hotwords })} />
        <Note>{streaming && offline ? '当前模型均支持优先识别热词。'
          : streaming || offline ? `当前仅${streaming ? '流式' : '定稿'}模型支持优先识别热词。`
            : '当前模型不支持优先识别热词，可选择 Zipformer。'}</Note>
      </Section>
    </>
  )
}

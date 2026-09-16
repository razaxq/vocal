import { useEffect, useRef, useState } from 'react'
import type { AppConfig, ConfigPatch, HotwordCatalogStatus } from '@shared/ipc'
import { findModel } from '@shared/modelRegistry'
import { Button, Note, Row, Section, Toggle, Textarea } from './ui'

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
  cfg: AppConfig; patch: (value: ConfigPatch) => Promise<void>
}): React.ReactElement {
  const status = useHotwordCatalog()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const prefs = cfg.networkHotwords
  const offline = findModel('offline', cfg.models.offline)?.kind === 'offline-transducer'
  const [draft, setDraft] = useState(cfg.hotwords.join('\n'))
  const [dirty, setDirty] = useState(false)
  const [composing, setComposing] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [saveError, setSaveError] = useState(false)
  useEffect(() => {
    if (!dirty) setDraft(cfg.hotwords.join('\n'))
  }, [cfg.hotwords, dirty])
  const save = async (): Promise<void> => {
    if (composing || savingRef.current || !dirty) return
    savingRef.current = true
    setSaving(true)
    setSaveError(false)
    try {
      await patch({ hotwords: [...new Set(draft.split(/\r?\n/).map(s => s.trim()).filter(Boolean))] })
      setDirty(false)
    } catch { setSaveError(true) }
    finally { savingRef.current = false; setSaving(false) }
  }
  const update = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try { await window.vocal.checkHotwordCatalog() } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  return (
    <>
      <Section title="雾凇词库" hint="完整基础词库，按读音辅助定稿">
        <Row label="使用基础词库">
          <Toggle checked={prefs.enabled} ariaLabel="使用基础词库" onChange={enabled => patch({ networkHotwords: { ...prefs, enabled } })} />
        </Row>
        <Row label="自动更新词库" hint="每周检查一次">
          <Toggle checked={prefs.autoUpdate} disabled={!prefs.enabled} ariaLabel="自动更新词库"
            onChange={autoUpdate => patch({ networkHotwords: { ...prefs, autoUpdate } })} />
        </Row>
        <Row wideLabel label={status ? `${status.wordCount.toLocaleString()} 个词 · ${status.updatedAt}` : '词库'}>
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
            <summary className="cursor-pointer">词库示例</summary>
            <p className="mt-2">以下仅预览 {status.words.length} 个词，全部词条均参与检索。</p>
            <p className="mt-2 max-h-36 select-text overflow-y-auto leading-relaxed">{status.words.join('、')}</p>
          </details>
        )}
      </Section>
      <Section title="个人热词" hint="填写常用人名、地名或术语">
        <fieldset disabled={saving} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}>
          <Textarea value={draft} rows={5} placeholder={'张晓明\n苏州工业园区\nVocal'}
            onChange={value => { setDraft(value); setDirty(true); setSaveError(false) }} />
        </fieldset>
        <Row label="每行一个，保存后下次录音生效">
          <Button size="sm" disabled={!dirty || composing || saving} onClick={() => void save()}>
            {saving ? '正在保存…' : dirty ? '保存热词' : '已保存'}
          </Button>
        </Row>
        {saveError && <Note tone="warn">保存失败，请重试</Note>}
        <Note>{offline ? '词库和个人热词仅用于定稿，不影响实时预览。'
          : '使用热词需选择 Zipformer 定稿模型。'}</Note>
      </Section>
    </>
  )
}

import { useState } from 'react'
import type { AppConfig, ConfigPatch } from '@shared/ipc'
import { Page, Section, Row, Toggle, Note } from './ui'

export function GeneralTab({ cfg, patch }: {
  cfg: AppConfig
  patch: (p: ConfigPatch) => Promise<void>
}): React.ReactElement {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async (value: ConfigPatch): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError('')
    try { await patch(value) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  return (
    <Page title="通用">
      <Section title="启动">
        <Row label="开机自启" hint="登录 Windows 后在后台运行">
          <Toggle checked={cfg.ui.launchAtLogin} disabled={saving} ariaLabel="开机自启"
            onChange={(enabled) => void save({ ui: { ...cfg.ui, launchAtLogin: enabled } })} />
        </Row>
      </Section>
      <Section title="更新">
        <Row label="自动更新" hint="发现新版后自动下载安装并重启">
          <Toggle checked={cfg.update.auto} disabled={saving} ariaLabel="自动更新"
            onChange={(auto) => void save({ update: { ...cfg.update, auto } })} />
        </Row>
      </Section>
      <Note>启动时会自动检查更新；关闭自动更新后仅提示。</Note>
      {saving && <Note>正在保存…</Note>}
      {error && <Note tone="danger">{error}</Note>}
    </Page>
  )
}

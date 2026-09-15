/**
 * 设置窗口。
 *
 * 侧栏按「一次语音输入依次经过什么」排：触发 → 识别 → 清洗 → 整理 → 上屏，
 * 一页就是流水线上的一站，下面一条横线隔开与流程无关的几页。
 * 不写分组标题 —— 顺序本身已经说明了关系，标题只是又一行要读的字。
 *
 * 说明文字能省则省：选项名本身说清楚了就不再解释一遍。
 * 不用圆点 + 文字表示设置状态 —— 那看着像在报告某种运行状况。
 *
 * 所有颜色走 styles.css 的 token，不写死、不用 dark: 变体。
 */
import { useEffect, useState } from 'react'
import type { AppConfig, HistoryStats } from '@shared/ipc'
import type { Transcript } from '@shared/types'
import { MODEL_NONE } from '@shared/modelRegistry'
import {
  Page, Section, Row, Select, Input, Num, Toggle, Note, LineList, Textarea,
  WindowControls, AppMark
} from './ui'
import { HOTKEY_CHOICES as KEYS } from '@shared/hotkeys'
import { useModelStatus, MissingModelsNotice, ModelGroup, AsrStatusLine } from './models'
import { MicSection } from './mic'
import { AboutTab } from './about'
import { applyTheme, watchSystemTheme, type ThemeMode } from '@renderer/shared/theme'
import { CleanupPreview } from './CleanupPreview'

type Tab = 'hotkey' | 'asr' | 'cleanup' | 'polish' | 'inject' | 'appearance' | 'history' | 'about'

/** 前五项是流水线，后三项是别的。分界线画在 PIPELINE 和 OTHER 之间。 */
const PIPELINE: Array<[Tab, string]> = [
  ['hotkey', '触发'],
  ['asr', '识别'],
  ['cleanup', '清洗'],
  ['polish', '整理'],
  ['inject', '上屏']
]
const OTHER: Array<[Tab, string]> = [
  ['appearance', '外观'],
  ['history', '历史'],
  ['about', '关于']
]

export function Settings(): React.ReactElement {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [tab, setTab] = useState<Tab>('hotkey')

  useEffect(() => { void window.vocal.getConfig().then(setCfg) }, [])

  // 主题：配置变了立刻应用；跟随系统时还要监听系统切换
  const theme = (cfg?.ui.theme ?? 'system') as ThemeMode
  useEffect(() => {
    applyTheme(theme)
    return watchSystemTheme(theme, () => applyTheme(theme))
  }, [theme])

  // 主进程要求跳页签（首次启动没模型时跳「识别」）
  useEffect(() => window.vocal.onGotoTab((t) => setTab(t as Tab)), [])

  const patch = async (p: Partial<AppConfig>): Promise<void> => {
    setCfg(await window.vocal.setConfig(p))
  }

  if (!cfg) {
    return <div className="p-8 text-[13px] text-[var(--fg-muted)]">加载中…</div>
  }

  const navItem = ([id, label]: [Tab, string]): React.ReactElement => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`mb-0.5 w-full rounded-lg px-3 py-[7px] text-left text-[14px] transition-colors ${
        tab === id
          ? 'bg-[var(--surface)] font-medium text-[var(--fg)] shadow-sm'
          : 'text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex h-screen bg-[var(--surface)] text-[var(--fg)]">
      <nav className="w-48 shrink-0 overflow-y-auto border-r border-[var(--border)]
                      bg-[var(--surface-2)] px-3 pb-3">
        <AppMark />
        {PIPELINE.map(navItem)}
        <div className="my-2.5 border-t border-[var(--border)]" />
        {OTHER.map(navItem)}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 不透明的一条：内容从它下面滚过去，不会压到窗口边缘 */}
        <div className="drag z-20 flex h-9 shrink-0 items-center justify-end
                        bg-[var(--surface)]">
          <WindowControls />
        </div>
        <main className="flex-1 overflow-y-auto px-8 pb-8 pt-2">
          {tab === 'hotkey' && <HotkeyTab cfg={cfg} patch={patch} />}
          {tab === 'asr' && <AsrTab cfg={cfg} patch={patch} />}
          {tab === 'cleanup' && <CleanupTab cfg={cfg} patch={patch} />}
          {tab === 'polish' && <PolishTab cfg={cfg} patch={patch} />}
          {tab === 'inject' && <InjectionTab cfg={cfg} patch={patch} />}
          {tab === 'appearance' && <AppearanceTab cfg={cfg} patch={patch} />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'about' && <AboutTab cfg={cfg} patch={patch} />}
        </main>
      </div>
    </div>
  )
}

type TabProps = { cfg: AppConfig; patch: (p: Partial<AppConfig>) => Promise<void> }

/* ============================================================ */

function HotkeyTab({ cfg, patch }: TabProps): React.ReactElement {
  const h = cfg.hotkey
  return (
    <Page title="触发">
      <Section>
        <Row label="触发方式">
          <Select
            value={h.mode}
            onChange={(v) => patch({ hotkey: { ...h, mode: v as never } })}
            options={[
              ['hold', '按住说话，松开结束'],
              ['toggle', '按一下开始，再按一下结束'],
              ['doubleTap', '双击开始，单击结束']
            ]}
            className="max-w-xs"
          />
        </Row>

        {h.mode === 'toggle' ? (
          <Row label="组合键">
            <Input
              value={h.accelerator}
              onChange={(v) => patch({ hotkey: { ...h, accelerator: v } })}
              mono
              className="max-w-xs"
            />
          </Row>
        ) : (
          <Row label="按键">
            <Select
              value={h.key}
              onChange={(key) => patch({ hotkey: { ...h, key } })}
              options={KEYS.map((c) => [c.key, c.label] as [string, string])}
              className="max-w-sm"
            />
          </Row>
        )}

        <Row label="防抖间隔" hint="忽略这段时间内的重复触发">
          <Num
            value={h.debounceMs}
            min={0}
            max={2000}
            suffix="毫秒"
            onChange={(n) => patch({ hotkey: { ...h, debounceMs: n } })}
          />
        </Row>

        <Row label="最短说话时长" hint="短于此值视为误触，直接丢弃">
          <Num
            value={h.minHoldMs}
            min={0}
            max={2000}
            suffix="毫秒"
            onChange={(n) => patch({ hotkey: { ...h, minHoldMs: n } })}
          />
        </Row>

        {h.mode === 'doubleTap' && (
          <Row label="双击间隔">
            <Num
              value={h.doubleTapWindowMs}
              min={150}
              max={800}
              suffix="毫秒"
              onChange={(n) => patch({ hotkey: { ...h, doubleTapWindowMs: n } })}
            />
          </Row>
        )}
      </Section>

      <Note>
        录音中按 <kbd className="rounded border border-[var(--border)] px-1 font-mono">Esc</kbd> 取消，已输入的文字会撤回。
      </Note>
    </Page>
  )
}

/* ============================================================ */

function AsrTab({ cfg, patch }: TabProps): React.ReactElement {
  const { status, progress } = useModelStatus()

  return (
    <Page title="识别">
      <MissingModelsNotice status={status} />
      <AsrStatusLine />

      <MicSection cfg={cfg} patch={patch} />

      <Section title="断句">
        <Row label="停顿多久算一句" hint="调大一点，想措辞的停顿就不会被切断">
          <Num
            value={cfg.asr.endpointSilenceMs}
            min={400}
            max={5000}
            suffix="毫秒"
            onChange={(n) => patch({ asr: { ...cfg.asr, endpointSilenceMs: n } })}
          />
        </Row>
      </Section>

      <Section title="内存">
        <Row label="空闲卸载模型" hint="0 = 一直常驻。卸载后下次按热键多等一两秒">
          <Num
            value={cfg.asr.idleUnloadMin}
            min={0}
            max={240}
            suffix="分钟"
            onChange={(n) => patch({ asr: { ...cfg.asr, idleUnloadMin: n } })}
          />
        </Row>
      </Section>

      <ModelGroup
        slot="streaming"
        title="流式模型"
        hint="说话时实时出字。点哪个用哪个，没下载的会自动开始下载。"
        cfg={cfg} patch={patch} status={status} progress={progress}
        allowNone={cfg.models.offline !== MODEL_NONE}
      />

      <ModelGroup
        slot="offline"
        title="定稿模型"
        hint="每句说完后重转写一遍，决定最终准确率。"
        cfg={cfg} patch={patch} status={status} progress={progress}
        allowNone={cfg.models.streaming !== MODEL_NONE}
      />

      <ModelGroup
        slot="punct"
        title="标点模型"
        hint="必需。没有它输出会是一长串不断句的文字。"
        cfg={cfg} patch={patch} status={status} progress={progress} fixed
      />

      <Section title="热词" hint="人名、术语、缩写。这些词永远不会被「清洗」当成口语词删掉。">
        <LineList
          value={cfg.hotwords}
          rows={7}
          placeholder={'Kubernetes\nsherpa-onnx\nLoRA'}
          onChange={(hotwords) => patch({ hotwords })}
        />
        <Note>
          {cfg.models.streaming.startsWith('zipformer')
            ? '当前流式模型支持热词加权，填进去的词在识别时会被优先考虑。'
            : '要让热词真的提高识别准确率，流式模型得选 Zipformer —— Paraformer 和 SenseVoice 是 CTC 模型，引擎层面就没有热词这条路径。'}
        </Note>
      </Section>
    </Page>
  )
}

/* ============================================================ */

function CleanupTab({ cfg, patch }: TabProps): React.ReactElement {
  return (
    <Page title="清洗">
      <Section title="口语清洗" hint="删掉「嗯 / 呃 / 那个」这类语气词和口吃重复。纯规则，离线也生效。">
        <Row label="力度">
          <Select
            value={cfg.cleanup.level}
            onChange={(v) => patch({ cleanup: { ...cfg.cleanup, level: v as never } })}
            options={[
              ['standard', '标准'],
              ['light', '轻度'],
              ['off', '关闭']
            ]}
            className="max-w-xs"
          />
        </Row>
        <Row label="保护热词">
          <Toggle
            checked={cfg.cleanup.protectHotwords}
            onChange={(b) => patch({ cleanup: { ...cfg.cleanup, protectHotwords: b } })}
            label="热词表里的词不会被删"
          />
        </Row>
        <Row label="额外过滤词" hint="你自己的口头禅" stack>
          <LineList
            value={cfg.cleanup.extraFillers}
            rows={3}
            onChange={(extraFillers) => patch({ cleanup: { ...cfg.cleanup, extraFillers } })}
          />
        </Row>
        <Row label="实时预览" stack>
          <CleanupPreview cfg={cfg} />
        </Row>
      </Section>
    </Page>
  )
}

/* ============================================================ */

/**
 * 整理独立成页。
 *
 * 它本来和「口语清洗」挤在同一页，但两者除了都作用于文字之外没什么关系：
 * 清洗是本地规则、永远在跑、微秒级；整理要联网、要配接口、默认还得先开开关。
 * 更要命的是大模型的 Base URL / Key 这些也只服务于整理，
 * 放在别的页里就成了「一页装三件事」。现在一页只讲一件事，接口配置跟着它走。
 */
function PolishTab({ cfg, patch }: TabProps): React.ReactElement {
  const on = cfg.consolidation.mode !== 'off'
  const llmReady = cfg.llm.enabled && cfg.llm.apiKey.length > 0

  return (
    <Page title="整理">
      <Section title="书面化整理" hint="把口语句式改写成书面语、合并被停顿切碎的句子。需要联网。">
        <Row label="启用">
          <Toggle
            checked={on}
            onChange={(b) => patch({
              consolidation: { ...cfg.consolidation, mode: b ? 'onFinish' : 'off' }
            })}
            label={on ? '开启' : '关闭，只做本地清洗'}
          />
        </Row>
        {on && (
        <>
        <Row label="时机">
          <Select
            value={cfg.consolidation.mode}
            onChange={(v) => patch({ consolidation: { ...cfg.consolidation, mode: v as never } })}
            options={[
              ['onFinish', '说完后整理一次'],
              ['rolling', '边说边分段整理']
            ]}
            className="max-w-xs"
          />
          {!llmReady && <div className="mt-2"><Note tone="warn">下面的接口还没配好，这一层不会生效。</Note></div>}
        </Row>
        <Row label="起步字数" hint="短于此值不整理">
          <Num
            value={cfg.consolidation.minChars}
            suffix="字"
            onChange={(n) => patch({ consolidation: { ...cfg.consolidation, minChars: n } })}
          />
        </Row>
        <Row label="最多替换" hint="超过就只留在历史里，不改已上屏的文字">
          <Num
            value={cfg.consolidation.maxReplaceChars}
            suffix="字"
            onChange={(n) => patch({ consolidation: { ...cfg.consolidation, maxReplaceChars: n } })}
          />
        </Row>
        </>
        )}
      </Section>

      <Section title="接口" hint="任何 OpenAI 兼容端点。超时或出错自动回落到未整理的文本。">
        <Row label="启用">
          <Toggle
            checked={cfg.llm.enabled}
            onChange={(b) => patch({ llm: { ...cfg.llm, enabled: b } })}
            label={llmReady ? '已配置' : '还需要填 API Key'}
          />
        </Row>
        <Row label="Base URL">
          <Input
            value={cfg.llm.baseUrl}
            onChange={(v) => patch({ llm: { ...cfg.llm, baseUrl: v } })}
            mono
          />
        </Row>
        <Row label="API Key">
          <Input
            type="password"
            value={cfg.llm.apiKey}
            onChange={(v) => patch({ llm: { ...cfg.llm, apiKey: v } })}
            mono
            placeholder="sk-…"
          />
        </Row>
        <Row label="模型">
          <Input
            value={cfg.llm.model}
            onChange={(v) => patch({ llm: { ...cfg.llm, model: v } })}
            mono
            className="max-w-xs"
          />
        </Row>
        <Row label="超时">
          <Num
            value={cfg.llm.timeoutMs}
            suffix="毫秒"
            onChange={(n) => patch({ llm: { ...cfg.llm, timeoutMs: n } })}
          />
        </Row>
        <Row label="提示词" stack>
          <Textarea
            value={cfg.llm.consolidatePrompt}
            rows={10}
            mono
            onChange={(v) => patch({ llm: { ...cfg.llm, consolidatePrompt: v } })}
          />
        </Row>
      </Section>
    </Page>
  )
}

/* ============================================================ */

function AppearanceTab({ cfg, patch }: TabProps): React.ReactElement {
  const t = cfg.ui.theme
  return (
    <Page title="外观">
      <Section title="主题">
        <div className="grid max-w-md grid-cols-3 gap-2">
          {([
            ['system', '跟随系统'],
            ['light', '浅色'],
            ['dark', '深色']
          ] as Array<[typeof t, string]>).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => void patch({ ui: { ...cfg.ui, theme: mode } })}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                t === mode
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <ThemeSwatch mode={mode} />
              <div className="mt-2 text-[13px] text-[var(--fg)]">{label}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="悬浮面板">
        <Row label="跟随光标" hint="部分应用不上报光标位置，会退到屏幕底部">
          <Toggle
            checked={cfg.ui.followCaret}
            onChange={(b) => patch({ ui: { ...cfg.ui, followCaret: b } })}
          />
        </Row>
      </Section>
    </Page>
  )
}

/** 三个色块示意，不依赖当前生效的主题 —— 直接写死各自的代表色。 */
function ThemeSwatch({ mode }: { mode: 'system' | 'light' | 'dark' }): React.ReactElement {
  const pairs: Record<string, Array<[string, string]>> = {
    light: [['#ffffff', '#e6e8eb'], ['#67c23a', '#67c23a']],
    dark: [['#242528', '#35363a'], ['#85ce61', '#85ce61']],
    system: [['#ffffff', '#e6e8eb'], ['#242528', '#35363a']]
  }
  return (
    <div className="flex h-8 overflow-hidden rounded-md border border-[var(--border)]">
      {pairs[mode]!.map(([bg, bd], i) => (
        <div key={i} className="flex-1" style={{ background: bg, borderRight: `1px solid ${bd}` }} />
      ))}
    </div>
  )
}

/* ============================================================ */

function InjectionTab({ cfg, patch }: TabProps): React.ReactElement {
  return (
    <Page title="上屏">
      <Section>
        <Row label="策略">
          <Select
            value={cfg.injection.strategy}
            onChange={(v) => patch({ injection: { ...cfg.injection, strategy: v as never } })}
            options={[
              ['auto', '自动'],
              ['unicode', '模拟键入'],
              ['clipboard', '剪贴板粘贴']
            ]}
            className="max-w-xs"
          />
        </Row>
        {cfg.injection.strategy === 'auto' && (
          <Row label="切换阈值" hint="超过就改走剪贴板">
            <Num
              value={cfg.injection.clipboardThreshold}
              suffix="字"
              onChange={(n) => patch({ injection: { ...cfg.injection, clipboardThreshold: n } })}
            />
          </Row>
        )}
        <Row label="恢复剪贴板">
          <Toggle
            checked={cfg.injection.restoreClipboard}
            onChange={(b) => patch({ injection: { ...cfg.injection, restoreClipboard: b } })}
            label="粘贴后还原原来的内容"
          />
        </Row>
      </Section>

      <Section title="上屏时机">
        <Row label="模式">
          <Select
            value={cfg.streaming.injectMode}
            onChange={(v) => patch({ streaming: { ...cfg.streaming, injectMode: v as never } })}
            options={[
              ['segment', '每句说完后追加'],
              ['live', '边说边上屏']
            ]}
            className="max-w-xs"
          />
          {cfg.streaming.injectMode === 'live' && (
            <div className="mt-2">
              <Note tone="warn">靠退格改写，识别过程中自己动光标会删错东西。</Note>
            </div>
          )}
        </Row>
      </Section>

      <Section title="强制走剪贴板的应用" hint="少数应用会吞掉模拟按键。填进程名。">
        <LineList
          value={cfg.injection.clipboardOnlyApps}
          rows={4}
          placeholder={'WINWORD.EXE\nEXCEL.EXE'}
          onChange={(clipboardOnlyApps) => patch({ injection: { ...cfg.injection, clipboardOnlyApps } })}
        />
      </Section>

      <Note>无法向管理员权限运行的窗口注入文字 —— 这是 Windows 的 UIPI 限制。</Note>
    </Page>
  )
}

/* ============================================================ */

function HistoryTab(): React.ReactElement {
  const [items, setItems] = useState<Transcript[]>([])
  const [stats, setStats] = useState<HistoryStats | null>(null)

  const reload = (): void => {
    void window.vocal.listHistory(100, 0).then(setItems)
    void window.vocal.historyStats().then(setStats)
  }
  useEffect(reload, [])

  const savedMin = stats ? Math.max(0, stats.chars / 60 - stats.totalMs / 60000) : 0

  return (
    <Page title="历史">
      {stats && (
        <Section>
          <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
            <Stat label="累计" value={stats.count.toLocaleString()} unit="次" />
            <Stat label="字数" value={stats.chars.toLocaleString()} unit="字" />
            <Stat
              label="比打字省下"
              value={savedMin.toFixed(0)}
              unit="分钟"
              hint="按 60 字/分估算"
            />
          </div>
        </Section>
      )}

      {items.length === 0 ? (
        <Section>
          <div className="py-8 text-center text-[13px] text-[var(--fg-subtle)]">
            还没有记录。按住热键说句话试试。
          </div>
        </Section>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <div key={t.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--fg)]">
                {t.final}
              </p>
              <div className="mt-2.5 flex items-center gap-3 text-[11px] text-[var(--fg-subtle)]">
                <span>{new Date(t.createdAt).toLocaleString('zh-CN')}</span>
                <span className="tabular-nums">{(t.durationMs / 1000).toFixed(1)}s</span>
                <span>{t.segmentCount} 段</span>
                {t.target?.processName && <span>{t.target.processName}</span>}
                <button
                  onClick={() => void window.vocal.deleteHistory(t.id).then(reload)}
                  className="ml-auto text-[var(--fg-subtle)] transition-colors hover:text-[var(--danger)]"
                >删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

function Stat({ label, value, unit, hint }: {
  label: string; value: string; unit: string; hint?: string
}): React.ReactElement {
  return (
    <div className="px-4 py-4 text-center">
      <div className="text-[11px] text-[var(--fg-subtle)]">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--fg)]">
        {value}<span className="ml-1 text-[12px] font-normal text-[var(--fg-muted)]">{unit}</span>
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-[var(--fg-subtle)]">{hint}</div>}
    </div>
  )
}

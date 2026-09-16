/** 主进程 ↔ 渲染进程的 IPC 契约。通道名集中在这里，避免字符串散落。 */
import type {
  SessionState, Transcript, HotkeyConfig, ConsolidationMode,
  InjectionStrategy, InjectionResult, InjectMode, Segment
} from './types'
import type { CleanupLevel } from './textCleanup'
import type { HotwordCatalog } from './hotwordCatalog'

export const CH = {
  // renderer → main（invoke）
  configGet: 'config:get',
  configSet: 'config:set',
  hotwordCatalogGet: 'hotwords:catalog:get',
  hotwordCatalogCheck: 'hotwords:catalog:check',
  hotwordCatalogStatus: 'hotwords:catalog:status',
  historyList: 'history:list',
  historyDelete: 'history:delete',
  historyStats: 'history:stats',
  modelsStatus: 'models:status',
  modelsDownload: 'models:download',
  modelsCancel: 'models:cancel',
  modelsDelete: 'models:delete',
  modelsChanged: 'models:changed',
  modelsOpenDir: 'models:openDir',
  appStats: 'app:stats',
  updateCheck: 'update:check',
  updateGet: 'update:get',
  updateInstall: 'update:install',
  winMinimize: 'win:minimize',
  winClose: 'win:close',
  injectText: 'inject:text',
  sessionCancel: 'session:cancel',

  // main → renderer（send）
  stateChanged: 'state:changed',
  partial: 'asr:partial',
  segment: 'asr:segment',
  transcript: 'asr:transcript',
  levelMeter: 'audio:level',
  toast: 'ui:toast',
  modelsProgress: 'models:progress',
  themeChanged: 'ui:theme',
  audioChanged: 'audio:config',
  asrStatus: 'asr:status',
  panelLayout: 'ui:panel-layout',
  panelVisible: 'ui:panel-visible',
  updateStatus: 'update:status',

  // renderer → main（send，音频上行）
  audioFrame: 'audio:frame',
  audioStarted: 'audio:started',
  audioStopped: 'audio:stopped'
} as const

export interface AppConfig {
  hotkey: HotkeyConfig
  models: {
    streaming: string
    offline: string
  }
  asr: {
    /** 停顿多久算一句说完（毫秒） */
    endpointSilenceMs: number
    /** 空闲多少分钟后卸载模型，0 = 常驻 */
    idleUnloadMin: number
  }
  injection: {
    strategy: InjectionStrategy
    /** 超过这个长度一律走剪贴板 */
    clipboardThreshold: number
    /** 逐字符注入时每个字符之间的间隔（ms），0 = 不限速 */
    charDelayMs: number
    /** 用完剪贴板后恢复原内容 */
    restoreClipboard: boolean
    /** 这些进程名强制走剪贴板（有些应用会吞掉合成的 Unicode 键） */
    clipboardOnlyApps: string[]
  }
  streaming: {
    injectMode: InjectMode
    showLivePanel: boolean
  }
  cleanup: {
    level: CleanupLevel
    extraFillers: string[]
    protectHotwords: boolean
  }
  consolidation: {
    mode: ConsolidationMode
    minChars: number
    rollingChars: number
    maxReplaceChars: number
  }
  llm: {
    enabled: boolean
    baseUrl: string
    apiKey: string
    model: string
    prompt: string
    consolidatePrompt: string
    timeoutMs: number
  }
  audio: {
    deviceId: string | null
    echoCancellation: boolean
    noiseSuppression: boolean
    autoGainControl: boolean
  }
  hotwords: string[]
  networkHotwords: { enabled: boolean; autoUpdate: boolean }
  ui: {
    theme: 'system' | 'light' | 'dark'
    followCaret: boolean
    launchAtLogin: boolean
  }
  update: {
    /** 启动时及运行期间自动检查新版本 */
    auto: boolean
  }
}

/** 一个模型的下载/解压进度。 */
export interface ModelProgress {
  id: string
  phase: 'queued' | 'downloading' | 'extracting' | 'verifying' | 'done' | 'error' | 'cancelled'
  received: number
  total: number
  message?: string
}

export interface HotwordCatalogStatus extends HotwordCatalog {
  state: 'idle' | 'checking' | 'latest' | 'updated' | 'error'
  checkedAt?: number
  message?: string
}

/** 某个模型在本机的状态，设置界面直接渲染这个。 */
export interface InstalledModel {
  id: string
  installed: boolean
  /** 已占用磁盘（字节），未下载为 0 */
  bytes: number
}

export interface ModelStatusInfo {
  ready: boolean
  missing: string[]
  root: string
  /** 每个模型 id 的安装状态和占用空间 */
  installed: Record<string, InstalledModel>
  /** 当前实际在用的是哪两个模型 */
  active: { streaming: string; offline: string }
  /** 数据目录，便携模式下就是程序旁边的 data/ */
  dataDir: string
  portable: boolean
}

/** 一个进程的实时占用。关于页用它展示资源统计。 */
export interface ProcStat {
  /** 中文可读名：主进程 / 悬浮面板 / 流式识别 … */
  label: string
  memoryMB: number
  cpu: number
}

export interface AppStats {
  version: string
  electron: string
  /** 当前数据目录采用便携布局 */
  portable: boolean
  uptimeMs: number
  totalMemoryMB: number
  processes: ProcStat[]
}

/** 自动更新的状态。 */
export interface UpdateStatus {
  state: 'idle' | 'dev' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
  /** 当前运行的版本 */
  version: string
  /** 检测到的新版本号 */
  latest?: string
  percent?: number
  message?: string
}

/** ASR 引擎当前状态，换模型时用来告诉用户「正在重载」。 */
export interface AsrStatus {
  state: 'loading' | 'ready' | 'error'
  message?: string
}

export interface HistoryStats {
  count: number
  chars: number
  totalMs: number
}

/** 面板收到的实时状态。 */
export interface PanelPartial {
  /** 已定稿并上屏的文本 */
  committed: string
  /** 正在说的这段的实时文本 */
  live: string
}

/** preload 暴露给渲染进程的 API 形状。 */
export interface VocalBridge {
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  getHotwordCatalog(): Promise<HotwordCatalogStatus>
  checkHotwordCatalog(): Promise<HotwordCatalogStatus>
  onHotwordCatalog(cb: (status: HotwordCatalogStatus) => void): () => void
  listHistory(limit: number, offset: number): Promise<Transcript[]>
  deleteHistory(id: string): Promise<void>
  historyStats(): Promise<HistoryStats>
  modelsStatus(): Promise<ModelStatusInfo>
  downloadModel(id: string): Promise<void>
  cancelModelDownload(id: string): Promise<void>
  deleteModel(id: string): Promise<void>
  openModelsDir(): Promise<void>
  appStats(): Promise<AppStats>
  checkUpdate(): Promise<UpdateStatus>
  getUpdateStatus(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  minimizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  injectText(text: string): Promise<InjectionResult>
  cancelSession(): Promise<void>
  listInputDevices(): Promise<Array<{ id: string; label: string }>>

  sendAudioFrame(samples: Float32Array): void
  notifyAudioStarted(): void
  notifyAudioStopped(): void

  onStateChanged(cb: (s: SessionState) => void): () => void
  onPartial(cb: (p: PanelPartial) => void): () => void
  onSegment(cb: (s: Segment) => void): () => void
  onTranscript(cb: (t: Transcript) => void): () => void
  onLevel(cb: (rms: number) => void): () => void
  onToast(cb: (msg: { level: 'info' | 'warn' | 'error'; text: string }) => void): () => void
  onModelProgress(cb: (p: ModelProgress) => void): () => void
  onModelsChanged(cb: () => void): () => void
  onThemeChanged(cb: (mode: string) => void): () => void
  /** 麦克风设置变了，面板要重新打开采集 */
  onAudioConfigChanged(cb: () => void): () => void
  onAsrStatus(cb: (s: AsrStatus) => void): () => void
  /** 关掉流式识别后面板要收窄，主进程算好了推过来 */
  onPanelLayout(cb: (l: { compact: boolean }) => void): () => void
  /** 面板进场 / 退场。退场动画放完主进程才真正 hide 窗口 */
  onPanelVisible(cb: (v: boolean) => void): () => void
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  /** 主进程要求跳到某个页签，比如首次启动跳到「模型」 */
  onGotoTab(cb: (tab: string) => void): () => void
}

declare global {
  interface Window { vocal: VocalBridge }
}

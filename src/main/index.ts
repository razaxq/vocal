/** 应用入口：装配所有服务，注册 IPC，管理生命周期。 */
import {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, nativeTheme, net
} from 'electron'
import { join, dirname } from 'node:path'
import { mkdirSync, accessSync, readdirSync, readFileSync, constants } from 'node:fs'
import { CH } from '@shared/ipc'
import type { AppConfig, ConfigPatch, AsrStatus } from '@shared/ipc'
import type { SessionState, InjectionTarget, CleanupConfig } from '@shared/types'
import type { InstalledModel, ModelProgress, AppStats, ProcStat, UpdateStatus } from '@shared/ipc'
import { ConfigService } from './services/config'
import { HistoryService } from './services/history'
import { LlmService } from './services/llm'
import { TextInjector } from './services/injector'
import { HotkeyService } from './services/hotkey'
import { AsrEngine } from './services/asr/engine'
import { ModelReloadQueue } from './services/asr/modelReloadQueue'
import { checkModels, resolveModelPaths, modelsRoot, modelInstallInfo } from './services/asr/models'
import { modelsOf, deriveProfile, MODEL_NONE } from '@shared/modelRegistry'
import { ModelDownloader } from './services/asr/downloader'
import { SessionController } from './services/session'
import {
  createPanelWindow, positionPanel, EXIT_MS, DWELL_MS, REVEAL_MS
} from './windows/panelWindow'
import { openSettingsWindow } from './windows/settingsWindow'
import { UpdaterService } from './services/updater'
import { APP_ID } from './windows/appIdentity'
import { StartupService, STARTUP_ARG } from './services/startup'
import { applyConfigPatch } from '@shared/config'
import { HotwordCatalogService } from './services/hotwordCatalog'
import { mergeHotwords, parseCatalog } from '@shared/hotwordCatalog'

// 必须在创建任何窗口之前设置，让 Windows 使用 Vocal 的任务栏身份。
app.setAppUserModelId(APP_ID)

// 只允许一个实例：热键和低级键盘钩子不能有两份
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

/**
 * 便携模式：配置、历史、模型全部放在程序旁边的 data/ 目录，
 * 而不是 %APPDATA%\Vocal。整个文件夹拷走就能换机器用，卸载也不留残留。
 *
 * 必须在 app ready 之前调用 —— setPath('userData') 之后
 * electron-store、HistoryService、模型目录会自动跟着走，
 * Chromium 的缓存也一并搬过去。
 *
 * 唯一的例外是装到了不可写的位置（比如手动装进 Program Files）。
 * 探测一下写权限，不行就老实回落到 %APPDATA%，而不是静默失败。
 */
function setupDataDir(): { dir: string; portable: boolean } {
  const base = app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()

  // 安装版走 %APPDATA%：NSIS 升级会重写安装目录，数据放在那儿会被升级
  // 连锅端掉。便携版（zip 解压出来的）才把 data/ 放在 exe 旁边。
  // 区分方式是卸载程序 —— NSIS 一定在安装目录里留一个，zip 里绝不会有。
  if (app.isPackaged && isInstalled(base)) {
    return { dir: app.getPath('userData'), portable: false }
  }

  const dir = join(base, 'data')
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
    app.setPath('userData', dir)
    return { dir, portable: true }
  } catch {
    // 解压到了不可写的位置（比如 Program Files），老实回落
    return { dir: app.getPath('userData'), portable: false }
  }
}

/** 安装目录里有没有 NSIS 留下的卸载程序。 */
function isInstalled(base: string): boolean {
  try {
    return readdirSync(base).some((f) => /^Uninstall .*\.exe$/i.test(f))
  } catch {
    return false
  }
}

const dataDir = setupDataDir()

let panel: BrowserWindow | null = null
let tray: Tray | null = null
let config: ConfigService
let history: HistoryService
let asr: AsrEngine
let hotkeys: HotkeyService
let session: SessionController
let downloader: ModelDownloader
let updater: UpdaterService
let startup: StartupService
let hotwordCatalog: HotwordCatalogService
let hotwordsPending = false
let modelMaintenance = false
let asrStatus: AsrStatus | null = null
function publishAsrStatus(status: AsrStatus): void {
  asrStatus = status
  broadcast(CH.asrStatus, status)
}

/**
 * 面板的显隐都是分步的（先压暗再显示、先放动画再藏），中间挂着定时器。
 * 下一次显隐开始前必须把上一轮没跑完的全部取消 —— 否则旧的那一步会在
 * 新会话开始之后才醒来，把刚显示出来的面板又藏一次。
 */
const panelTimers: NodeJS.Timeout[] = []
function cancelPanelTimers(): void {
  while (panelTimers.length) clearTimeout(panelTimers.pop())
}

function toPanel(channel: string, payload?: unknown): void {
  if (panel && !panel.isDestroyed()) panel.webContents.send(channel, payload)
}

/** 推给所有活着的窗口 —— 模型进度和主题变更两个窗口都要收到。 */
function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/**
 * 没有流式模型时面板收窄 —— 那块实时文本区永远是空的，
 * 420px 宽的浮窗在屏幕中间白占地方。
 */
function panelCompact(cfg: AppConfig): boolean {
  return cfg.models.streaming === MODEL_NONE
}

/** 清洗配置：热词自动纳入保护词，避免专有名词被当成填充词删掉。 */
function cleanupConfigOf(cfg: AppConfig): CleanupConfig {
  return {
    level: cfg.cleanup.level,
    protect: cfg.cleanup.protectHotwords ? recognitionHotwords(cfg).map(w => w.text) : [],
    extraFillers: cfg.cleanup.extraFillers
  }
}

function recognitionHotwords(cfg: AppConfig) {
  return mergeHotwords(cfg.hotwords, [])
}

function applyHotwords(): void {
  if (session.current !== 'idle' && session.current !== 'error') {
    hotwordsPending = true
    return
  }
  hotwordsPending = false
  const cfg = config.get()
  asr.updateHotwords(recognitionHotwords(cfg))
  asr.updateDictionary(cfg.networkHotwords.enabled ? hotwordCatalog.data : undefined)
  asr.updateCleanup(cleanupConfigOf(cfg))
}

async function bootstrap(): Promise<void> {
  config = new ConfigService()
  const bundledHotwords = parseCatalog(JSON.parse(readFileSync(join(
    app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
    'dictionaries/rime-ice/catalog.json'
  ), 'utf8')))
  hotwordCatalog = new HotwordCatalogService(
    join(app.getPath('userData'), 'network-hotwords.json'), bundledHotwords,
    (url, init) => net.fetch(url, init),
    () => { if (config.get().networkHotwords.enabled) applyHotwords() },
    status => broadcast(CH.hotwordCatalogStatus, status)
  )
  await hotwordCatalog.load()
  startup = new StartupService(app, app.getPath('exe'), app.isPackaged && process.platform === 'win32', APP_ID)
  syncStartupConfig()
  history = new HistoryService(join(app.getPath('userData'), 'history.jsonl'))

  const getConfig = (): AppConfig => config.get()
  const injector = new TextInjector(getConfig)
  const llm = new LlmService(getConfig)

  panel = createPanelWindow(panelCompact(config.get()))
  // 麦克风权限：面板窗口需要 getUserMedia
  panel.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })

  const cfg = getConfig()
  nativeTheme.themeSource = cfg.ui.theme
  const status = checkModels(cfg.models)

  asr = new AsrEngine(
    resolveModelPaths(cfg.models),
    deriveProfile(cfg.models),
    recognitionHotwords(cfg),
    cleanupConfigOf(cfg),
    cfg.asr.endpointSilenceMs,
    cfg.asr.idleUnloadMin,
    {
      onPartial: (seg, text) => session.onPartial(seg, text),
      onSegment: (seg, text, meta) => void session.onSegment(seg, text, meta),
      onSessionComplete: (id) => void session.onSessionComplete(id),
      onError: (msg, fatal) => session.onError(msg, fatal)
    },
    cfg.networkHotwords.enabled ? hotwordCatalog.data : undefined
  )

  session = new SessionController(asr, injector, llm, history, getConfig, {
    onState: (s: SessionState) => {
      toPanel(CH.stateChanged, s)
      // 说话期间请求的重载攒到这里做，不打断正在进行的一次输入
      if (s === 'idle' && reloadQueue.pending) void reloadAsr(config.get())
      else if ((s === 'idle' || s === 'error') && hotwordsPending) applyHotwords()
      if (s === 'idle' || s === 'error') void updater?.resumeAutoUpdate()
    },
    onPartial: (p) => toPanel(CH.partial, p),
    onSegment: (s) => toPanel(CH.segment, s),
    onTranscript: (t) => toPanel(CH.transcript, t),
    onToast: (level, text) => toPanel(CH.toast, { level, text }),
    setCapture: (on) => toPanel(on ? CH.audioStarted : CH.audioStopped),
    showPanel: (_target: InjectionTarget) => {
      if (!panel || panel.isDestroyed()) return
      // 上一次的退场还在排队就取消掉。
      // 不取消的话，紧接着再按一次热键（防抖只有 300ms，而退场链路要
      // DWELL + EXIT = 650ms），旧的定时器会在新会话开始后才醒来，
      // 把刚显示出来的面板又藏一次。
      cancelPanelTimers()
      positionPanel(panel, getConfig().ui.followCaret, panelCompact(getConfig()))

      // 压到全透明再 show：show() 的第一帧是合成器里的旧画面，
      // 渲染进程管不到它，只能让它显示在一个透明的窗口上。见 REVEAL_MS。
      panel.setOpacity(0)
      panel.showInactive()   // 关键：显示但不激活，焦点留在目标应用
      toPanel(CH.panelVisible, true)
      panelTimers.push(setTimeout(() => {
        if (panel && !panel.isDestroyed()) panel.setOpacity(1)
      }, REVEAL_MS))
    },
    hidePanel: () => {
      // 三步：停留让用户看完 → 通知面板放退场动画 → 动画放完再 hide。
      // 直接 hide 的话进场有动画、退场没有，比两边都没有更别扭。
      cancelPanelTimers()
      panelTimers.push(setTimeout(() => {
        toPanel(CH.panelVisible, false)
        panelTimers.push(setTimeout(() => {
          if (panel && !panel.isDestroyed()) panel.hide()
        }, EXIT_MS))
      }, DWELL_MS))
    }
  })

  reloadQueue = new ModelReloadQueue({
    getConfig,
    blocked: () => modelMaintenance || (session.current !== 'idle' && session.current !== 'error'),
    check: cfg => checkModels(cfg.models),
    downloading: cfg => [...Object.values(cfg.models), 'ct-transformer'].some(id => downloader?.isDownloading(id)),
    publish: publishAsrStatus,
    load: async cfg => {
      await asr.reload(resolveModelPaths(cfg.models), deriveProfile(cfg.models), cfg.asr.endpointSilenceMs, cfg.asr.idleUnloadMin)
      hotwordsPending = false
      asr.updateHotwords(recognitionHotwords(config.get()))
      asr.updateDictionary(config.get().networkHotwords.enabled ? hotwordCatalog.data : undefined)
      asr.updateCleanup(cleanupConfigOf(config.get()))
    }
  })

  if (status.ready) {
    asr.start().catch((e) => {
      toPanel(CH.toast, { level: 'error', text: `ASR 启动失败：${e instanceof Error ? e.message : String(e)}` })
    })
  } else {
    // 没模型：不弹系统对话框，直接把设置窗口开到模型页让用户点下载。
    // 弹框只能告诉你「缺了」，然后你还得自己去跑命令 —— 那不叫引导。
    if (!process.argv.includes(STARTUP_ARG)) openSettingsWindow('asr')
  }

  hotkeys = new HotkeyService({
    onStart: () => { if (!modelMaintenance && updater?.current.state !== 'installing') session.start() },
    onStop: () => session.stop(),
    onCancel: () => void session.cancel()
  })
  try {
    hotkeys.apply(cfg.hotkey)
  } catch (e) {
    // 不弹系统对话框 —— 托盘应用弹框很突兀，而且用户多半正在别的窗口干活。
    // 面板的 toast 够用，真要改还是得进设置窗口。
    toPanel(CH.toast, {
      level: 'error',
      text: `热键注册失败：${e instanceof Error ? e.message : String(e)}`
    })
  }

  downloader = new ModelDownloader(modelsRoot(), (p: ModelProgress) => {
    broadcast(CH.modelsProgress, p)
    if (p.phase === 'queued' || p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') {
      const selected = config.get().models
      if (Object.values(selected).includes(p.id) || p.id === 'ct-transformer') void reloadAsr(config.get())
    }
  })

  // 两种发行方式共用检查和通知；安装方式交给更新服务处理。
  updater = new UpdaterService(!dataDir.portable, (st: UpdateStatus) => {
    broadcast(CH.updateStatus, st)
  }, () => {
    if (session.current !== 'idle' && session.current !== 'error') {
      throw new Error('请先结束当前语音输入，再点击更新')
    }
  }, () => session.current === 'idle' || session.current === 'error')
  updater.start(cfg.update.auto)

  registerIpc(injector)
  hotwordCatalog.start(cfg.networkHotwords.enabled && cfg.networkHotwords.autoUpdate)
  createTray()
}

function syncStartupConfig(): AppConfig {
  const current = config.get()
  const enabled = startup.isEnabled()
  return current.ui.launchAtLogin === enabled ? current
    : config.set({ ui: { ...current.ui, launchAtLogin: enabled } })
}

function registerIpc(injector: TextInjector): void {
  ipcMain.handle(CH.configGet, () => syncStartupConfig())
  ipcMain.handle(CH.configSet, (_e, patch: ConfigPatch) => {
    const before = config.get()
    const candidate = applyConfigPatch(before, patch)
    if (before.ui.launchAtLogin !== candidate.ui.launchAtLogin) {
      // 系统确认成功后才保存，失败时界面保留原来的开关状态。
      startup.setEnabled(candidate.ui.launchAtLogin)
    }
    const next = config.set(patch)

    if (JSON.stringify(before.hotkey) !== JSON.stringify(next.hotkey)) {
      try { hotkeys.apply(next.hotkey) } catch { /* 交给 UI 提示 */ }
    }
    if (
      JSON.stringify(before.cleanup) !== JSON.stringify(next.cleanup) ||
      JSON.stringify(before.hotwords) !== JSON.stringify(next.hotwords) ||
      before.networkHotwords.enabled !== next.networkHotwords.enabled
    ) {
      applyHotwords()
    }
    if (JSON.stringify(before.networkHotwords) !== JSON.stringify(next.networkHotwords)) {
      hotwordCatalog.start(next.networkHotwords.enabled && next.networkHotwords.autoUpdate)
    }
    if (
      JSON.stringify(before.models) !== JSON.stringify(next.models) ||
      before.asr.endpointSilenceMs !== next.asr.endpointSilenceMs
    ) {
      const targets: Partial<AppConfig['models']> = {}
      for (const slot of ['streaming', 'offline', 'correction'] as const) {
        if (before.models[slot] !== next.models[slot]) targets[slot] = next.models[slot]
      }
      void reloadAsr(next, Object.keys(targets).length ? targets : next.models)
      broadcast(CH.panelLayout, { compact: panelCompact(next) })
    }
    if (before.update.auto !== next.update.auto) {
      updater.start(next.update.auto)
    }
    if (before.asr.idleUnloadMin !== next.asr.idleUnloadMin) {
      asr.setIdleUnloadMin(next.asr.idleUnloadMin)
    }
    if (JSON.stringify(before.audio) !== JSON.stringify(next.audio)) {
      // 面板常驻持有麦克风流，换设备得让它重新开一次
      broadcast(CH.audioChanged)
    }
    if (before.ui.theme !== next.ui.theme) {
      // nativeTheme 管的是窗口边框和原生控件，CSS token 管的是页面内容，两边都要设
      nativeTheme.themeSource = next.ui.theme
      broadcast(CH.themeChanged, next.ui.theme)
    }
    return next
  })

  ipcMain.handle(CH.historyList, (_e, limit: number, offset: number) => history.list(limit, offset))
  ipcMain.handle(CH.historyDelete, (_e, id: string) => history.delete(id))
  ipcMain.handle(CH.historyStats, () => history.stats())
  ipcMain.handle(CH.modelsStatus, () => {
    const c = config.get()
    const installed: Record<string, InstalledModel> = {}
    for (const slot of ['streaming', 'offline', 'punct', 'vad', 'correction'] as const) {
      for (const m of modelsOf(slot)) {
        installed[m.id] = { id: m.id, ...modelInstallInfo(m) }
      }
    }
    return {
      ...checkModels(c.models),
      installed,
      active: { ...c.models },
      asr: asrStatus,
      dataDir: dataDir.dir,
      portable: dataDir.portable
    }
  })

  ipcMain.handle(CH.modelsDownload, (_e, id: string) => {
    const entry = findAnyModel(id)
    if (!entry) throw new Error(`没有 id 为 ${id} 的模型`)
    void downloader.download(entry)
  })
  ipcMain.handle(CH.modelsCancel, (_e, id: string) => downloader.cancel(id))
  ipcMain.handle(CH.modelsDelete, async (_e, id: string) => {
    const entry = findAnyModel(id)
    if (!entry) throw new Error('找不到这个模型')
    if (modelMaintenance) throw new Error('有模型正在处理，请稍后重试')
    if (reloadQueue.running) throw new Error('模型正在切换，请稍后重试')
    if (downloader.isDownloading(id)) throw new Error('请先取消下载，再删除模型')
    const selected = config.get().models
    const inUse = selected.streaming === id || selected.offline === id || selected.correction === id || entry.kind === 'punct-ct-transformer'
    if (inUse && session.current !== 'idle' && session.current !== 'error') {
      throw new Error('请先结束当前语音输入，再删除正在使用的模型')
    }
    modelMaintenance = true
    try {
      // Windows 会锁住正在被识别进程使用的权重，释放进程后才能删除。
      if (inUse) await asr.dispose()
      await downloader.remove(entry)
    } finally {
      modelMaintenance = false
      broadcast(CH.modelsChanged)
      if (inUse || reloadQueue.pending) await reloadAsr(config.get())
    }
  })
  ipcMain.handle(CH.modelsOpenDir, () => shell.openPath(modelsRoot()))

  ipcMain.handle(CH.appStats, (): AppStats => {
    // 同类型的进程会有多个（每个窗口一个 Tab），按名字合并后更好读
    const merged = new Map<string, ProcStat>()
    for (const m of app.getAppMetrics()) {
      const label = procLabel(m)
      const prev = merged.get(label)
      const memoryMB = m.memory.workingSetSize / 1024
      const cpu = m.cpu.percentCPUUsage
      if (prev) {
        prev.memoryMB += memoryMB
        prev.cpu += cpu
      } else {
        merged.set(label, { label, memoryMB, cpu })
      }
    }
    const processes = [...merged.values()].sort((a, b) => b.memoryMB - a.memoryMB)
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      portable: dataDir.portable,
      uptimeMs: Math.round(process.uptime() * 1000),
      totalMemoryMB: processes.reduce((sum, p) => sum + p.memoryMB, 0),
      processes
    }
  })

  ipcMain.handle(CH.updateCheck, () => updater.check())
  ipcMain.handle(CH.updateGet, () => updater.current)
  ipcMain.handle(CH.updateInstall, () => updater.installNow())
  ipcMain.handle(CH.hotwordCatalogGet, () => hotwordCatalog.current)
  ipcMain.handle(CH.hotwordCatalogCheck, () => hotwordCatalog.check())

  // 无边框窗口自己画标题栏，最小化和关闭得走 IPC
  ipcMain.handle(CH.winMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.handle(CH.winClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.handle(CH.sessionCancel, () => session.cancel())
  ipcMain.handle(CH.injectText, (_e, text: string) => injector.inject({ text }))

  ipcMain.on(CH.audioFrame, (_e, samples: Float32Array) => session.pushAudio(samples))
}

/**
 * 换模型 / 改断句阈值后重新加载引擎。
 *
 * 以前这里要求用户手动重启软件 —— 但需要重启的其实只有两个 ASR 工作进程，
 * 主进程、热键、托盘、悬浮面板都不需要动。既然它们本来就是独立进程，
 * 换掉就行，用户只需要等模型加载那一两秒。
 *
 * 正在说话时不动：等这次会话结束再说，否则音频流会断在半截。
 */
let reloadQueue: ModelReloadQueue
function reloadAsr(cfg: AppConfig, targets?: Partial<AppConfig['models']>): Promise<void> {
  return targets ? reloadQueue.request(targets)
    : reloadQueue.pending ? reloadQueue.resume() : reloadQueue.request(cfg.models)
}

/** 进程类型名转成人话。getAppMetrics 给的是 Browser/Tab/Utility 这种。 */
function procLabel(m: Electron.ProcessMetric): string {
  if (m.type === 'Browser') return '主进程'
  const name = m.name ?? m.serviceName ?? ''
  if (name.includes('asr-stream')) return '流式识别'
  if (name.includes('asr-finalize')) return '定稿识别'
  if (name.includes('vocal-correction')) return '同音纠错'
  if (m.type === 'Tab') return '窗口界面'
  if (m.type === 'GPU') return '图形渲染'
  return name || m.type
}

/** 在四个槽位里按 id 找模型。 */
function findAnyModel(id: string) {
  for (const slot of ['streaming', 'offline', 'punct', 'vad', 'correction'] as const) {
    const m = modelsOf(slot).find((x) => x.id === id)
    if (m) return m
  }
  return undefined
}

function createTray(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(app.getAppPath(), 'resources', 'tray.png')
  const icon = nativeImage.createFromPath(iconPath)

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('Vocal — 按住热键说话')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '设置…', click: () => openSettingsWindow() },
    { label: '打开数据目录', click: () => void shell.openPath(dataDir.dir) },
    { label: '打开模型目录', click: () => void shell.openPath(modelsRoot()) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]))
  tray.on('double-click', () => openSettingsWindow())
}

app.whenReady().then(bootstrap)

// 托盘常驻应用：关掉所有窗口不退出
app.on('window-all-closed', () => { /* noop */ })

app.on('will-quit', () => {
  hotwordCatalog?.dispose()
  updater?.stop()
  downloader?.cancelAll()
  hotkeys?.dispose()
  void asr?.dispose()
  history?.close()
})

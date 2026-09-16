/** 渲染进程 ↔ 主进程的唯一桥。contextIsolation 打开，渲染进程拿不到 node。 */
import { contextBridge, ipcRenderer } from 'electron'
import { CH } from '../shared/ipc'
import type {
  VocalBridge, AppConfig, PanelPartial, HistoryStats, ModelStatusInfo, ModelProgress,
  AppStats, AsrStatus, UpdateStatus, HotwordCatalogStatus
} from '../shared/ipc'
import type { SessionState, Transcript, InjectionResult, Segment } from '../shared/types'

function sub<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.off(channel, h)
}

const api: VocalBridge = {
  getConfig: () => ipcRenderer.invoke(CH.configGet) as Promise<AppConfig>,
  setConfig: (patch) => ipcRenderer.invoke(CH.configSet, patch) as Promise<AppConfig>,
  getHotwordCatalog: () => ipcRenderer.invoke(CH.hotwordCatalogGet) as Promise<HotwordCatalogStatus>,
  checkHotwordCatalog: () => ipcRenderer.invoke(CH.hotwordCatalogCheck) as Promise<HotwordCatalogStatus>,
  onHotwordCatalog: (cb) => sub<HotwordCatalogStatus>(CH.hotwordCatalogStatus, cb),
  listHistory: (limit, offset) =>
    ipcRenderer.invoke(CH.historyList, limit, offset) as Promise<Transcript[]>,
  deleteHistory: (id) => ipcRenderer.invoke(CH.historyDelete, id) as Promise<void>,
  historyStats: () => ipcRenderer.invoke(CH.historyStats) as Promise<HistoryStats>,
  modelsStatus: () => ipcRenderer.invoke(CH.modelsStatus) as Promise<ModelStatusInfo>,
  downloadModel: (id) => ipcRenderer.invoke(CH.modelsDownload, id) as Promise<void>,
  cancelModelDownload: (id) => ipcRenderer.invoke(CH.modelsCancel, id) as Promise<void>,
  deleteModel: (id) => ipcRenderer.invoke(CH.modelsDelete, id) as Promise<void>,
  openModelsDir: () => ipcRenderer.invoke(CH.modelsOpenDir) as Promise<void>,
  appStats: () => ipcRenderer.invoke(CH.appStats) as Promise<AppStats>,
  checkUpdate: () => ipcRenderer.invoke(CH.updateCheck) as Promise<UpdateStatus>,
  getUpdateStatus: () => ipcRenderer.invoke(CH.updateGet) as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke(CH.updateInstall) as Promise<void>,
  minimizeWindow: () => ipcRenderer.invoke(CH.winMinimize) as Promise<void>,
  closeWindow: () => ipcRenderer.invoke(CH.winClose) as Promise<void>,
  injectText: (text) => ipcRenderer.invoke(CH.injectText, text) as Promise<InjectionResult>,
  cancelSession: () => ipcRenderer.invoke(CH.sessionCancel) as Promise<void>,
  listInputDevices: async () => {
    // preload 跑在渲染侧，但 tsconfig.node 没有 DOM lib，所以这里显式取一下
    type Dev = { kind: string; deviceId: string; label: string }
    const md = (globalThis as {
      navigator?: { mediaDevices?: { enumerateDevices(): Promise<Dev[]> } }
    }).navigator?.mediaDevices
    if (!md) return []
    const devices = await md.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ id: d.deviceId, label: d.label || '默认麦克风' }))
  },

  sendAudioFrame: (samples) => ipcRenderer.send(CH.audioFrame, samples),
  notifyAudioStarted: () => ipcRenderer.send(CH.audioStarted),
  notifyAudioStopped: () => ipcRenderer.send(CH.audioStopped),

  onStateChanged: (cb) => sub<SessionState>(CH.stateChanged, cb),
  onPartial: (cb) => sub<PanelPartial>(CH.partial, cb),
  onSegment: (cb) => sub<Segment>(CH.segment, cb),
  onTranscript: (cb) => sub<Transcript>(CH.transcript, cb),
  onLevel: (cb) => sub<number>(CH.levelMeter, cb),
  onToast: (cb) => sub(CH.toast, cb),
  onModelProgress: (cb) => sub<ModelProgress>(CH.modelsProgress, cb),
  onModelsChanged: (cb) => sub<void>(CH.modelsChanged, cb),
  onThemeChanged: (cb) => sub<string>(CH.themeChanged, cb),
  onAudioConfigChanged: (cb) => sub<void>(CH.audioChanged, () => cb()),
  onAsrStatus: (cb) => sub<AsrStatus>(CH.asrStatus, cb),
  onPanelLayout: (cb) => sub<{ compact: boolean }>(CH.panelLayout, cb),
  onPanelVisible: (cb) => sub<boolean>(CH.panelVisible, cb),
  onUpdateStatus: (cb) => sub<UpdateStatus>(CH.updateStatus, cb),
  onGotoTab: (cb) => sub<string>('ui:goto-tab', cb)
}

contextBridge.exposeInMainWorld('vocal', api)

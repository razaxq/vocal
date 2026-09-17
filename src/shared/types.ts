/** 跨进程共享的领域类型。主进程 / 渲染进程 / 两个 ASR 工作进程都引用这里。 */

import type { CleanupLevel } from './textCleanup'
import type { RecognitionHotword, HotwordCatalog } from './hotwordCatalog'

/** 会话生命周期。UI 的每一种视觉状态都对应其中之一。 */
export type SessionState =
  | 'idle'          // 待命，面板隐藏
  | 'arming'        // 热键已按下，正在开麦（通常 < 80ms）
  | 'listening'     // 正在录音 + 流式解码，已定稿的段会陆续上屏
  | 'finalizing'    // 热键已松开，正在等最后一段定稿
  | 'consolidating' // 长输入结束后的 LLM 整理
  | 'injecting'     // 正在把文本送进目标窗口
  | 'error'

/** 文本注入策略。 */
export type InjectionStrategy =
  | 'unicode'    // SendInput + KEYEVENTF_UNICODE，逐字符送，像真打字
  | 'clipboard'  // 写剪贴板 + 模拟 Ctrl+V，长文本唯一靠谱的做法
  | 'auto'       // 按长度 / 目标应用自动选择（默认）

/** 上屏时机。 */
export type InjectMode =
  | 'segment'  // 每段定稿后追加（默认）。文字每隔几秒出现一批，不会回退改写，最安全
  | 'live'     // 流式 partial 也上屏，靠退格差分改写。最像输入法，但用户中途动光标会出事

export interface InjectionTarget {
  hwnd: number
  processName: string
  windowTitle: string
}

export interface InjectionRequest {
  text: string
  strategy?: InjectionStrategy
  /** 流式上屏时，先删掉上次已经打上去的 n 个字符再打新的 */
  replaceLastChars?: number
}

export interface InjectionResult {
  ok: boolean
  used: Exclude<InjectionStrategy, 'auto'>
  charsWritten: number
  /** 实际走通之前失败过的策略，用来在日志里看降级链 */
  fellBackFrom?: string[]
  error?: string
}

/** 热键触发方式。 */
export type HotkeyMode =
  | 'hold'      // 按住说话，松开结束（最像对讲机，也最不容易误触）
  | 'toggle'    // 按一下开始，再按一下结束（长输入用这个，手不用一直按着）
  | 'doubleTap' // 双击某键开始，再单击结束

export interface HotkeyConfig {
  keyboardEnabled: boolean
  mouseEnabled: boolean
  keyboardInFullscreen: boolean
  mouseInFullscreen: boolean
  mouseButton: 'left' | 'middle' | 'leftMiddle'
  mode: HotkeyMode
  /** hold / doubleTap 用 uiohook 的键名，例如 'RightControl'、'F2' */
  key: string
  /** toggle 用 Electron accelerator，例如 'Control+Shift+Space' */
  accelerator: string
  doubleTapWindowMs: number
  /** 两次触发之间的最小间隔，防手抖连按 */
  debounceMs: number
  /** hold 模式下按住时间短于这个值视为误触，直接丢弃这次录音 */
  minHoldMs: number
  /** 鼠标触发按住多久后开始录音 */
  mouseHoldDelayMs: number
}

/** ASR 引擎档位。 */
export type AsrProfile =
  | 'streaming-only'   // 只用流式模型，最低延迟，精度一般
  | 'streaming+final'  // 流式实时显示 + 每段用 SenseVoice 重转写后上屏（默认）
  | 'final-only'       // 不流式，每段录完再转，精度最高、延迟最大

/** 长输入整理的时机。 */
export type ConsolidationMode =
  | 'off'      // 不整理
  | 'onFinish' // 会话结束后整理一次，整体替换已上屏文本（默认）
  | 'rolling'  // 每积累一个段落就整理一次，替换该段落

/**
 * 流式模型的路径。kind 决定 sherpa 的配置形状：
 * paraformer 是 CTC（encoder + decoder），zipformer 是 transducer（多一个 joiner）。
 */
export interface StreamingModelPaths {
  kind: 'online-paraformer' | 'online-zipformer'
  encoder: string
  decoder: string
  joiner?: string
  tokens: string
}

/**
 * 定稿模型有三种形状，对应 sherpa 的三套配置：
 *   sense-voice —— CTC，单文件。自带 ITN（「二零二六年」→「2026 年」），没有热词
 *   paraformer  —— CTC，单文件。没有 ITN，也没有热词
 *   transducer  —— encoder + decoder + joiner。**支持热词**，但没有 ITN
 * kind 决定 finalize.ts 走哪个分支，写错 sherpa 会直接报「没有给出任何模型」。
 */
export interface OfflineModelPaths {
  kind: 'offline-sense-voice' | 'offline-paraformer' | 'offline-transducer'
  /** sense-voice 用 */
  model: string
  /** transducer 用 */
  encoder?: string
  decoder?: string
  joiner?: string
  tokens: string
  /** byte-level BPE 模型要用它才能把自然词编码成热词 */
  bpeVocab?: string
}

export interface ModelPaths {
  streaming: StreamingModelPaths
  offline: OfflineModelPaths
  punct: string
  vad: string
  correction?: { model: string; vocab: string; mode: 'csc' | 'mlm' }
}

/** 音频采集参数。固定 16k 单声道，直接喂模型，不做二次重采样。 */
export const AUDIO = {
  sampleRate: 16000,
  channels: 1,
  /**
   * AudioWorklet 每次投递的采样点数 = 100ms @16k。
   * 再小只会增加 IPC 次数，流式模型内部本来就按 ~600ms 的 chunk 解码。
   */
  frameSize: 1600
} as const

/* ============================================================
 * 一次语音输入的产物
 * ============================================================ */

/** 一个由 endpoint 切出来的语音片段。 */
export interface Segment {
  index: number
  /** 流式引擎给出的实时文本（无标点或弱标点） */
  streamText: string
  /** SenseVoice 重转写 + 标点 + 规则清洗之后的文本；未定稿时为 undefined */
  finalText?: string
  /** 规则层删掉了多少字 */
  cleanedChars?: number
  /** 从该段第一帧音频到定稿的耗时 */
  latencyMs?: number
  /** 已经写进目标窗口了吗 */
  injected: boolean
}

export interface Transcript {
  id: string
  createdAt: number
  /** 各段流式原文拼接 */
  raw: string
  /** 各段定稿文本拼接（含规则清洗） */
  polished: string
  /** LLM 整理之后的文本；未整理时等于 polished */
  final: string
  durationMs: number
  segmentCount: number
  /** 注入到哪个窗口，用于「按应用记住风格」 */
  target?: InjectionTarget
}

/* ============================================================
 * 流式进程协议
 * ============================================================ */

export type StreamCommand =
  | { type: 'init'; models: ModelPaths; hotwords: RecognitionHotword[]; enabled: boolean
      /** 停顿多久算一句说完（毫秒） */
      endpointSilenceMs: number }
  | { type: 'session:start'; sessionId: string }
  | { type: 'audio'; sessionId: string; samples: Float32Array }
  | { type: 'session:stop'; sessionId: string }
  | { type: 'hotwords:update'; hotwords: RecognitionHotword[] }
  | { type: 'shutdown' }

export type StreamEvent =
  | { type: 'ready' }
  /** 当前正在说的这一段的实时文本，会被不断覆盖 */
  | { type: 'partial'; sessionId: string; segment: number; text: string }
  /**
   * 检测到句子边界。sampleIndex 是本次会话截至此刻已消费的采样点总数，
   * 主进程用它从自己的缓冲里精确切出这一段的音频交给定稿进程。
   */
  | { type: 'endpoint'; sessionId: string; segment: number; text: string; sampleIndex: number }
  | { type: 'session:ended'; sessionId: string; segments: number; totalSamples: number }
  | { type: 'error'; sessionId?: string; message: string; fatal: boolean }

/* ============================================================
 * 定稿进程协议（独立进程，与流式解码并行，互不阻塞）
 * ============================================================ */

export type FinalizeCommand =
  | {
      type: 'init'
      models: ModelPaths
      cleanup: CleanupConfig
      /**
       * full      —— 重转写 + 标点 + 清洗（默认）
       * punct-only —— 只加载标点模型，给「只用流式」档位补标点和清洗。
       *              省掉 SenseVoice 那 230MB，但标点不能省：
       *              流式模型一个标点都不带，不补就是一长串连字。
       */
      mode: 'full' | 'punct-only'
      /** 只有 transducer 定稿模型吃得下；CTC 模型（SenseVoice）传了也没用 */
      hotwords: RecognitionHotword[]
      dictionary?: HotwordCatalog
    }
  | {
      type: 'finalize'
      sessionId: string
      segment: number
      samples: Float32Array
      /** 流式结果，定稿失败或明显异常时拿它兜底 */
      streamText: string
    }
  | {
      /** punct-only 档位用：没有音频，只有流式文本要过标点和清洗 */
      type: 'punctuate'
      sessionId: string
      segment: number
      text: string
    }
  | { type: 'cleanup:update'; cleanup: CleanupConfig }
  | { type: 'dictionary:update'; dictionary?: HotwordCatalog }
  | { type: 'hotwords:update'; hotwords: RecognitionHotword[] }
  | { type: 'shutdown' }

export type FinalizeEvent =
  | { type: 'ready' }
  | {
      type: 'finalized'
      sessionId: string
      segment: number
      text: string
      cleanedChars: number
      latencyMs: number
      /** true 表示定稿结果被判定异常，回落到了流式文本 */
      fellBack: boolean
    }
  | { type: 'error'; sessionId?: string; segment?: number; message: string; fatal: boolean }

export interface CleanupConfig {
  level: CleanupLevel
  protect: string[]
  extraFillers: string[]
}

export type CorrectionCommand =
  | { type: 'init'; model: NonNullable<ModelPaths['correction']>; hotwords: RecognitionHotword[]; dictionary?: HotwordCatalog }
  | { type: 'correct'; result: Extract<FinalizeEvent, { type: 'finalized' }> }
  | { type: 'hotwords:update'; hotwords: RecognitionHotword[] }
  | { type: 'dictionary:update'; dictionary?: HotwordCatalog }
  | { type: 'shutdown' }

/**
 * 模型注册表的类型化访问。
 *
 * 数据本体在 scripts/models.json —— 那份 JSON 同时被下载脚本（.mjs，
 * 不能 import TS）和主进程读取，所以只能放在 JSON 里，两边共用一份。
 * 改可选模型列表只改那个文件，不用碰代码。
 */
import registry from '../../scripts/models.json'
import type { AsrProfile } from './types'

export type StreamingKind = 'online-paraformer' | 'online-zipformer'

export interface ModelEntry {
  id: string
  name: string
  langs: string
  note: string
  kind: string
  url: string
  dir: string
  approxMB: number
  /** 官方发布资产的压缩包大小，和安装后磁盘占用分别展示。 */
  downloadBytes?: number
  installedBytes?: number
  archive?: string
  files: Record<string, string>
  prune: string[]
  /**
   * 有些模型的 tar 包里只有 sentencepiece 的二进制 .model，
   * 而 sherpa 的热词编码要的是文本词表。解压后现场生成一份。
   */
  generateBpeVocab?: { from: string; to: string }
}

export type ModelSlot = 'streaming' | 'offline' | 'punct' | 'vad'

const REG = registry as unknown as Record<ModelSlot, ModelEntry[]>

export function modelsOf(slot: ModelSlot): ModelEntry[] {
  return REG[slot] ?? []
}

export function findModel(slot: ModelSlot, id: string): ModelEntry | undefined {
  return modelsOf(slot).find((m) => m.id === id)
}

/** 找不到指定 id 时回落到该槽位的第一个 —— 配置里的 id 过时了也不至于起不来。 */
export function resolveModel(slot: ModelSlot, id: string): ModelEntry {
  const found = findModel(slot, id)
  if (found) return found
  const first = modelsOf(slot)[0]
  if (!first) throw new Error(`模型注册表里没有 ${slot} 槽位的任何条目`)
  return first
}

export const DEFAULT_MODEL_IDS = {
  streaming: 'paraformer-zh-en',
  offline: 'sensevoice-2024',
  punct: 'ct-transformer',
  vad: 'silero'
} as const

export const STREAMING_IDS = modelsOf('streaming').map((m) => m.id)
export const OFFLINE_IDS = modelsOf('offline').map((m) => m.id)

/** 槽位置为「不使用」时存这个值。 */
export const MODEL_NONE = 'none'

/**
 * 从模型选择推导引擎档位。
 *
 * 之前档位是个独立设置，和模型选择各说各话 —— 用户得先懂「流式 / 定稿」
 * 两个词，再去理解档位和模型的对应关系。其实档位完全是模型选择的结果：
 * 选了哪几层，就是哪个档位。所以档位不再是配置项，而是这里算出来的。
 */
export function deriveProfile(models: { streaming: string; offline: string }): AsrProfile {
  const hasStream = models.streaming !== MODEL_NONE
  const hasOffline = models.offline !== MODEL_NONE
  if (hasStream && hasOffline) return 'streaming+final'
  if (hasStream) return 'streaming-only'
  return 'final-only'
}

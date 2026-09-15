/**
 * 模型路径解析与完整性检查。
 *
 * 路径来自「注册表 + 用户选了哪个」。模型不进安装包（几百 MB），
 * 首次启动检测缺失后引导下载到 data/models —— 便携模式下
 * userData 已经被指到程序旁边的 data/，这里跟着走就行。
 */
import { app } from 'electron'
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelPaths } from '@shared/types'
import { resolveModel, DEFAULT_MODEL_IDS, MODEL_NONE, type ModelEntry } from '@shared/modelRegistry'

export const modelsRoot = (): string => join(app.getPath('userData'), 'models')

function fileOf(root: string, m: ModelEntry, key: string): string {
  return join(root, m.dir, m.files[key] ?? '')
}

export interface ModelSelection {
  streaming: string
  offline: string
}

export function resolveModelPaths(
  sel: ModelSelection = { streaming: DEFAULT_MODEL_IDS.streaming, offline: DEFAULT_MODEL_IDS.offline },
  root = modelsRoot()
): ModelPaths {
  // 'none' 表示这一层不用 —— 路径留空，对应的工作进程根本不会去加载
  const stOff = sel.streaming === MODEL_NONE
  const offOff = sel.offline === MODEL_NONE
  const st = stOff ? null : resolveModel('streaming', sel.streaming)
  const off = offOff ? null : resolveModel('offline', sel.offline)
  const punct = resolveModel('punct', DEFAULT_MODEL_IDS.punct)
  const vad = resolveModel('vad', DEFAULT_MODEL_IDS.vad)

  return {
    streaming: st
      ? {
          kind: st.kind as ModelPaths['streaming']['kind'],
          encoder: fileOf(root, st, 'encoder'),
          decoder: fileOf(root, st, 'decoder'),
          ...(st.files['joiner'] ? { joiner: fileOf(root, st, 'joiner') } : {}),
          tokens: fileOf(root, st, 'tokens')
        }
      : { kind: 'online-paraformer' as const, encoder: '', decoder: '', tokens: '' },
    offline: off
      ? {
          kind: off.kind as ModelPaths['offline']['kind'],
          // sense-voice 是单文件；transducer 是三件套，两边的 files 键不一样
          model: off.files['model'] ? fileOf(root, off, 'model') : '',
          ...(off.files['encoder'] ? { encoder: fileOf(root, off, 'encoder') } : {}),
          ...(off.files['decoder'] ? { decoder: fileOf(root, off, 'decoder') } : {}),
          ...(off.files['joiner'] ? { joiner: fileOf(root, off, 'joiner') } : {}),
          ...(off.files['bpeVocab'] ? { bpeVocab: fileOf(root, off, 'bpeVocab') } : {}),
          tokens: fileOf(root, off, 'tokens')
        }
      : { kind: 'offline-sense-voice' as const, model: '', tokens: '' },
    punct: fileOf(root, punct, 'model'),
    vad: fileOf(root, vad, 'model')
  }
}

export interface ModelStatus {
  ready: boolean
  missing: string[]
  root: string
}

/**
 * 检查当前这套选择齐不齐。设为「不使用」的层直接跳过 ——
 * 用户主动关掉的东西不该报缺失。
 */
export function checkModels(
  sel: ModelSelection = { streaming: DEFAULT_MODEL_IDS.streaming, offline: DEFAULT_MODEL_IDS.offline }
): ModelStatus {
  const p = resolveModelPaths(sel)
  const checks: Array<[string, string]> = [['标点模型', p.punct]]

  if (sel.streaming !== MODEL_NONE) {
    checks.push(['流式模型', p.streaming.encoder], ['流式模型', p.streaming.decoder],
                ['流式词表', p.streaming.tokens])
    if (p.streaming.joiner) checks.push(['流式模型', p.streaming.joiner])
  }
  if (sel.offline !== MODEL_NONE) {
    checks.push(['定稿词表', p.offline.tokens])
    // sense-voice 单文件，transducer 三件套 —— 按实际有哪几个查
    for (const f of [p.offline.model, p.offline.encoder, p.offline.decoder, p.offline.joiner]) {
      if (f) checks.push(['定稿模型', f])
    }
  }

  const missing = [...new Set(checks.filter(([, f]) => !existsSync(f)).map(([n]) => n))]
  return { ready: missing.length === 0, missing, root: modelsRoot() }
}

/** 某个模型下载好了没，以及占了多少磁盘 —— 设置界面直接渲染这个。 */
export function modelInstallInfo(m: ModelEntry): { installed: boolean; bytes: number } {
  const dir = join(modelsRoot(), m.dir)
  const installed = Object.values(m.files).every((f) => existsSync(join(dir, f)))
  return { installed, bytes: installed ? dirSize(dir) : 0 }
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) total += dirSize(p)
      else total += statSync(p).size
    }
  } catch { /* 目录不在就是 0 */ }
  return total
}

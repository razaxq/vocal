/**
 * scripts/bbpe-vocab.mjs 是纯 JS（下载脚本用的是 .mjs，没法 import TS），
 * 主进程也要用同一份实现，所以在这里给它一个类型声明，
 * 而不是把逻辑复制两遍 —— 复制出来的两份迟早会分叉。
 */
declare module '*/bbpe-vocab.mjs' {
  export function parseSentencePieceModel(buf: Buffer): Array<{ piece: string; score: number }>
  export function toVocabText(buf: Buffer): string
}

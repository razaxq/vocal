/**
 * scripts/extract-tar-bz2.mjs 是纯 JS（命令行下载脚本是 .mjs，没法 import TS），
 * 主进程复用同一份实现，所以在这里给它类型，而不是把逻辑抄两遍。
 */
declare module '*/extract-tar-bz2.mjs' {
  export function assertBzip2(file: string): Promise<void>
  export function extractTarBz2(
    archive: string,
    targetDir: string,
    opts?: { exclude?: string[] }
  ): Promise<void>
}

declare module '*/download-model-files.mjs' {
  export function downloadModelFiles(entry: import('../shared/modelRegistry').ModelEntry, target: string,
    signal?: AbortSignal, onProgress?: (received: number, total: number) => void): Promise<void>
}

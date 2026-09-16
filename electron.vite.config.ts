import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer')
}

export default defineConfig({
  main: {
    // 原生模块（koffi / uiohook-napi / sherpa-onnx-node / better-sqlite3）必须外置，
    // 不能被打包器内联，否则 .node 二进制找不到。
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // 两个 ASR 工作进程由 utilityProcess.fork 拉起，各自需要独立产物。
          // 分成两个进程是为了让流式解码和定稿重转写真正并行。
          stream: resolve('src/asr-worker/stream.ts'),
          finalize: resolve('src/asr-worker/finalize.ts'),
          correction: resolve('src/asr-worker/correction.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // preload 走 CommonJS，sandbox 下更稳
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          panel: resolve('src/renderer/panel/index.html'),
          settings: resolve('src/renderer/settings/index.html')
        }
      }
    }
  }
})

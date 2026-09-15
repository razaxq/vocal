# ADR-0001：不把 ququ 作为 submodule

- 状态：已采纳
- 日期：2026-09-14

## 背景

立项时考虑把 [yan5xu/ququ](https://github.com/yan5xu/ququ)（Apache-2.0，Electron + Python FunASR 的中文语音输入工具）作为 submodule 引入，以复用其 ASR 能力和交互设计。

## 调研结论

拉取 `master` 逐文件读过之后：

1. **ASR 层不可复用**。ququ 用 Python + FunASR + torch，通过子进程通信。本项目选 sherpa-onnx（C++/ONNX，Node 原生绑定）。引入 ququ 等于同时背上一个 1~2GB 的 Python 运行时。
2. **Windows 支持是名义上的**。`package.json` 里有 `build:win`，但 `prebuild:win` 依赖 `scripts/prepare-embedded-python.js`，而该脚本的 Python 运行时下载 URL 写死了 `apple-darwin`（第 79 行），在 Windows 上直接失败。Releases 里也只有 macOS ARM64 一个产物。
3. **注入层必须重写**。`src/helpers/clipboard.js` 的 Windows 分支是 `spawn("powershell", SendKeys "^v")`，每次注入起一个 PowerShell 进程，延迟 300~800ms，且不支持流式改写。
4. **热键层必须重写**。`hotkeyManager.js` 用 Electron `globalShortcut` 做 F2 双击，拿不到 keyup，做不了「按住说话」。

## 决策

**不引入 submodule。** 建独立仓库，从零实现。

ququ 的价值在于**交互设计思路**和**中文语音后处理 prompt**，这两样已经分别写进 `docs/DESIGN.md` 和 `src/shared/config.ts` 的 `DEFAULT_PROMPT`。需要对读时随手 `git clone` 即可，不必绑进构建图。

## 后果

- ✅ 依赖树干净，构建图里没有永不被 import 的死代码
- ✅ 不受上游重构影响
- ⚠️ 失去「跟随上游升级」的可能 —— 但鉴于技术栈完全不同，这个可能本来也不存在
- 📌 Apache-2.0 允许借鉴与再实现；若将来直接复制其代码片段，需在 `NOTICE` 中标注来源

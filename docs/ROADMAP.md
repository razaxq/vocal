# 路线图

原则：**先杀红色风险，再加功能。** 每个阶段都以「能不能在真机上跑通」为完成标准，不以「代码写完了」为标准。

---

## 已经验证过的（骨架搭建时在 Linux 容器里跑过）

- ✅ 依赖树可解析。踩到一个坑：`@vitejs/plugin-react@6` 要求 `vite@8`，而 `electron-vite@5` 的 peer 只到 `vite@7`，所以固定用 `@vitejs/plugin-react@^5.2.0`。
- ✅ `npm run typecheck` 干净通过（main / preload / asr-worker / renderer 四套）。
- ✅ `electron-vite build` 产物正确：`out/main/index.js`、`out/main/asr-worker.js`、
      `out/preload/index.cjs`、两个渲染页面，`pcm-worklet.js` 被正确复制到 `out/renderer/`。
- ✅ `__dirname` 在 ESM 产物里被 electron-vite 自动注入为 `import.meta.dirname`。
- ⚠️ **Electron 44 的 `clipboard.readText()` / `writeText()` 已经改成返回 Promise**，
      老教程和 ququ 里的同步写法会静默出错（`writeText(Promise)` 会写进一个 `[object Promise]`）。
      代码里已经 await 过了。
- ✅ 规则层口语清洗 `npm run test:cleanup` 9/9 通过（含「不能误删叠词和实词」的反例）
- ✅ 历史存储 `npm run test:history` 7/7 通过（含「半行 JSON 不能丢掉全部历史」）
- ✅ **在 Windows 实机上确认**：`npm test` 16/16 通过
- ✅ **零编译依赖已验证**：koffi / uiohook-napi / sherpa-onnx-node 三者的 Windows 二进制
      都由包自带或 optionalDependency 提供；唯一需要 node-gyp 的 better-sqlite3 已移除（ADR-0006）
- ❌ 原生模块能否在 **Electron 里** 加载仍未验证 —— 这是 M0 的核心任务

---

## M0 — 穿刺验证（1~2 天）

目标：证明三个最危险的假设成立。探针脚本已经写好，直接跑：

```powershell
npm run m0:native      # R2 三个原生模块能不能在 Electron 里加载 + koffi 结构体对齐
npm run m0:focus       # R3 focusable:false 的面板会不会夺焦（自动判定）
npm run m0:roundtrip   # R1 自己开靶子窗口打字再读回来比对（自动判定）
npm run m0:inject      # R1 往任意窗口打字，需要你自己看一眼（补充验证 Win32 原生控件）
npm run m1:asr         # sherpa 配置字段 + 模型加载 + 解码耗时（自动判定）
npm test               # 26 个单元测试：口语清洗 / 历史存储 / 语音门限
```

- [x] `npm install` 走通（已完成：零编译依赖，见 ADR-0006）
- [x] `npm run typecheck` / `npm test` 在 Windows 实机通过（16/16）
- [x] **R2 通过** `npm run m0:native` —— Electron 44.3.0 / Node 24.20.0 / x64 上
      sherpa-onnx-node v1.13.8（onnxruntime 1.28.2）正常加载，三个 Recognizer 导出齐全。
      **这是最大的一个风险，现在可以确定 ASR 方案不用换了。**
- [x] **koffi 结构体对齐通过** —— `sizeof(INPUT) = 40`，联合体布局正确
- [x] **R3 通过** `npm run m0:focus` —— `focusable:false` + `showInactive()` 之后
      前台窗口句柄未变，面板不夺焦
- [x] **R1 通过（SendInput 层面）** `npm run m0:inject` —— 48/48 条全部被系统接受
- [x] **R1 字符正确性通过** `npm run m0:roundtrip` —— 42/42 条被接受，
      读回来的输入框内容和预期逐字符一致（中文 / 英文 / 数字 / 破折号）。
      靶子是 Chromium 控件，等价于 Chrome / VS Code / 微信桌面版
- [ ] **R1 补充**：在记事本（Win32 原生控件）里手动跑一次 `npm run m0:inject`，
      两类控件都过才算彻底通过
- [x] **uiohook 键名修正** —— 第一次探测发现 `RightControl` 根本不存在，
      uiohook 的枚举叫 `CtrlRight`。键名白名单已收进 `src/shared/hotkeys.ts`，
      配置校验、设置下拉、热键注册三处共用
- [x] `npm run models` 四个模型全部下载并校验通过
- [x] **`npm run m1:asr` 通过** —— 6/6。sherpa 的配置字段名和模型路径全对，
      标点模型输出正确（「今天天气不错，我们出去走走吧，你觉得呢？」）。
      实测数据已写回 DESIGN §5：
      SenseVoice 解码 5 秒片段 **107ms**（估 80~250ms）、补标点 **3ms**（估 20~50ms）、
      三个模型加载合计 ~2s（两进程并行约 1s）、磁盘占用 **531 MB**
- [x] **抓到 R7**：SenseVoice 对 5 秒纯静音幻觉出「我.」。
      已加语音门限 + 定稿健全性两道防线（`src/shared/audioGate.ts`，10 个回归测试）
- [ ] R5：这台机器装了火绒，看 uiohook 的低级钩子会不会被拦（等 M1 接热键时暴露）

> 任何一项不过，停下来改方案，不要往前写。
> R1 不过 → 改用 napi-rs 写原生模块；R2 不过 → 换 whisper.cpp 的 Node 绑定；
> R3 不过 → 改用无窗口的托盘图标提示。

## M1 — 最小闭环（3~5 天）

「按住右 Ctrl 说话，松开后文字出现在记事本里」。

- [ ] 热键 hold 模式（uiohook）
- [ ] 面板窗口 + AudioWorklet 采集 + IPC 上行
- [ ] ASR 工作进程：只接 SenseVoice（`final-only` 档），不做流式
- [ ] 注入：只做 unicode 通路
- [ ] 跑通端到端，用秒表量延迟，填进 DESIGN.md §5 的实测列

## M2 — 分段流水线（3~5 天）

- [ ] 接入流式 Paraformer，面板实时显示 partial
- [ ] 拆出 finalize 进程，按 endpoint 切段并行定稿
- [ ] 每段定稿后追加上屏（`injectMode: 'segment'`）
- [ ] `SessionAudioBuffer.compact()` 长录音内存回收，跑一次 10 分钟连续口述看内存曲线
- [x] R7 已处理：语音门限 + 定稿健全性（`src/shared/audioGate.ts`）
- [ ] 用真实短语音（1~2 秒）复核门限阈值，确认没有误杀
- [ ] `asrProfile` 三档可切

## M2.5 — 文本整理（2~3 天）

- [x] 规则层 `textCleanup.ts` + 回归测试（已完成，`npm run test:cleanup` 9/9）
- [ ] 接 LLM 做书面化整理，`onFinish` 模式跑通
- [ ] R8 专项测试：说到一半自己敲几个字、移动光标、切窗口，确认三道闸都拦得住
- [ ] `rolling` 模式（长输入边说边分段整理）
- [ ] 整理前后对照放进历史，方便判断提示词好不好

## M3 — 产品化（1 周）

- [ ] 设置窗口全部控件可用
- [ ] SQLite 历史 + 统计面板（字数、时长、对比打字的估算节省）
- [ ] 剪贴板通路 + auto 策略 + 应用黑名单
- [ ] Esc 取消 / 错误提示 / 首次启动引导（模型下载进度）
- [ ] 托盘、开机自启、单实例

## M4 — 让它真的好用（持续）

- [ ] 边说边上屏（`injectMode: 'live'`，默认关，先内测）
- [ ] 按应用记忆不同的整理风格（写代码 vs 写邮件）
- [ ] 打包签名 + 自动更新

## 性能实验（M2 之后，独立于主线）

- [ ] **DirectML GPU 加速**。sherpa-onnx 认 `provider: 'directml'`，但 npm 预编译的
      `sherpa-onnx-win-x64` 只带 CPU 版 onnxruntime，包里没有 DirectML.dll，
      直接设会静默回落到 CPU（已验证）。要用上得换带 DML 的 onnxruntime 并补 DLL。
      收益主要在定稿那一趟。参考 vocotype-cli 的 `files/`，见 [ADR-0004](adr/0004-prior-art.md)。
- [ ] `numThreads` 调优：两个工作进程各占几个核最划算
- [ ] 流式模型的 `rule2MinTrailingSilence` 调优 —— 它直接决定「多久上一次屏」

## 二期候选（不承诺）

- TSF 输入法前端（复用同一套 ASR 服务）
- 语音纠错指令（「把刚才那句改成……」）
- 本地小模型做书面化整理，去掉云端依赖（Qwen3-1.7B + llama.cpp）
- 从历史记录里自动挖掘候选热词
- WH_KEYBOARD_LL 原生模块，支持吞掉任意按键

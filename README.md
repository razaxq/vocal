# Vocal

Windows 桌面语音输入。按住一个键说话，松开，文字出现在你正在用的那个输入框里。

目标不是「能把语音转成字」，而是**让语音真的能当成一种输入法来用** —— 任何应用、任何输入框、全本地、不抢焦点。

> 状态：可用。注入、热键、焦点保持、流式 + 分段定稿都已在 Windows 实机跑通
> （SenseVoice 重转写 5 秒语音实测 107ms）。设计与取舍见 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 下载

去 [Releases](https://github.com/razaxq/vocal/releases) 拿最新版，两个包选一个：

| 包 | 适合 | 数据位置 | 自动更新 |
|---|---|---|---|
| `Vocal-Setup-x.y.z.exe` | 大多数人 | `%APPDATA%\Vocal` | ✅ 后台下载，退出时装上 |
| `Vocal-x.y.z-win.zip` | 想随身带、不想装东西 | 解压目录里的 `data/` | ❌ 只提示有新版 |

装完先进设置的「识别」页把模型下下来（约 500MB，一次性）。

> 没有代码签名，第一次运行 Windows 会弹 SmartScreen 蓝框，点「更多信息 → 仍要运行」。
> 证书一年要几百刀，个人项目先不买。介意的话可以自己 clone 下来构建。

---

## 是什么

```
按住右 Ctrl ──> 说话 ──> 每说完一句，文字就出现在光标处
                 │
                 ├─ 悬浮条实时显示识别结果，Esc 随时撤回
                 └─ 松开后（长文本）自动整理成书面语
```

- **全本地**。sherpa-onnx + ONNX Runtime，不需要 Python、不需要显卡、断网可用。
- **流式 + 分段定稿**。说话时实时出字；每说完一句立刻用离线模型重转写那一段再上屏。
  长篇口述是「每隔几秒出一批字」，不会憋到最后一次性吐出来。
- **中英混排**。「这个 bug 在 useEffect 里」能正确出。
- **自动标点 + 数字格式化**。「二零二六年三点五万」→「2026 年 3.5 万」。
- **口语清洗**。自动删掉「嗯 / 呃 / 那个 / 就是说」和「我我我」这类口吃重复。
  纯规则、不用模型、离线也生效，叠词（刚刚 / 看看 / 谢谢）不会被误伤。
- **书面化整理**（可选）。长输入说完后把口语句式改写成书面表达、合并碎句、自动分段。
  这一层需要接大模型；不配就只有上面那些，依然完全离线。
- **热词表**。锁住人名、项目名、缩写，同时保护它们不被清洗规则误删。

## 技术栈

| 层 | 选型 | 为什么 |
|---|---|---|
| 壳 | Electron 44 + electron-vite | 需要渲染进程的 `AudioWorklet` 做低延迟采集 |
| 识别 | sherpa-onnx（流式 Paraformer + SenseVoice + CT-Transformer） | C++/ONNX，有预编译 Node 绑定，无 Python 依赖 |
| 进程模型 | 主进程 + 流式进程 + 定稿进程 | 两个 ASR 进程并行，说下一句时上一句已在另一个核上定稿 |
| 注入 | koffi FFI → `SendInput` + `KEYEVENTF_UNICODE` | 无需编译工具链，等价于真的打字 |
| 热键 | `uiohook-napi` + Electron `globalShortcut` | 前者提供 keyup（按住说话），后者能吞掉组合键 |
| 存储 | JSONL + electron-store | 零编译依赖是硬约束，见 [ADR-0006](docs/adr/0006-no-native-build.md) |

完整的取舍过程见 [`docs/DESIGN.md`](docs/DESIGN.md) 和 [`docs/adr/`](docs/adr)。

## 开始

```powershell
# 依赖（纯预编译，不需要编译工具链）
npm install

# 下载模型（约 500MB）。也可以跳过这步，启动后在设置的「识别」页点着下
npm run models
npm run models:list     # 只看状态

# 开发
npm run dev

# 单元测试（不需要模型，秒出）
npm test

# 环境验证（需要 Electron 和模型）
npm run m0:native      # 原生模块能不能在 Electron 里加载
npm run m0:roundtrip   # SendInput 打字再读回来比对
npm run m1:asr         # sherpa 配置 + 模型加载 + 解码耗时

# 打包
npm run dist            # 产物在 release/
```

**环境要求**：Windows 10 1809+ / x64、Node 22+。**不需要 Visual Studio、不需要 Python** ——
所有原生模块都是预编译的，`npm install` 不会跑 node-gyp。
解压模型用系统自带的 `tar`（Windows 10 1803+ 自带），没有的话装 7-Zip 并加进 PATH。

书面化整理是可选的，在设置的「整理」页填 base URL / key / model（任何 OpenAI 兼容端点）。
不填就纯离线跑，其余功能一个不少。

## 已知限制

- **无法向管理员权限的窗口注入**。本应用以 `asInvoker` 运行，Windows 的 UIPI 会拦截跨完整性级别的输入注入。提权会导致反向的问题（无法注入普通进程），两头不可兼得。
- **部分反作弊游戏屏蔽合成输入**。不在目标场景内。
- **仅 Windows x64**。代码里没有为跨平台留抽象层。
- **模型常驻要吃几百 MB 内存**。三处可以压：只用流式模型（省掉定稿模型）、
  只用定稿模型（省掉流式模型）、以及默认开着的「空闲 10 分钟卸载模型」。
  实时占用在设置的「关于」页按进程列得很清楚，不用去任务管理器猜。

## 目录

```
.github/          CI 与发版流水线
build/            图标（icon.svg 是源）
docs/             设计文档、ADR、发布流程
scripts/          模型清单与下载脚本
src/shared/       跨进程类型、配置、规则清洗（textCleanup.ts）
src/main/         主进程：热键、会话编排、音频缓冲、注入、Win32 FFI
src/asr-worker/   两个工作进程：stream.ts（流式）、finalize.ts（定稿）
src/renderer/     悬浮面板与设置窗口
```

完整目录见 [`docs/DESIGN.md` §8](docs/DESIGN.md)，发布流程见 [`docs/RELEASE.md`](docs/RELEASE.md)。

## 致谢

- [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) — 识别、标点、VAD 全部模型与运行时
- [yan5xu/ququ](https://github.com/yan5xu/ququ) — 中文语音输入的交互设计与后处理提示词思路
- [233stone/vocotype-cli](https://github.com/233stone/vocotype-cli) — Windows 文本注入的实现参考，
  它的失败降级链和 `dwExtraInfo` 打标记都被吸收进来了

两个项目都是 Apache-2.0。本项目未复用其代码，取舍过程见
[ADR-0001](docs/adr/0001-no-ququ-submodule.md) 和 [ADR-0004](docs/adr/0004-prior-art.md)。

## 许可

MIT

# ADR-0004：同类项目对比与借鉴

- 状态：已采纳
- 日期：2026-09-14

## 调研对象

| 项目 | 栈 | 许可 | 结论 |
|---|---|---|---|
| [yan5xu/ququ](https://github.com/yan5xu/ququ) | Electron + Python/FunASR(torch) | Apache-2.0 | 不引入，见 [ADR-0001](0001-no-ququ-submodule.md) |
| [233stone/vocotype-cli](https://github.com/233stone/vocotype-cli) | Python + funasr_onnx | Apache-2.0 | 不引入代码，但借鉴三处实现细节 |

vocotype-cli 的 README 致谢里写明参考了 QuQu —— 这两个项目是同一支脉络。
它是商业产品 vocotype.com 的开源 CLI 版，GUI 和 Pro 功能闭源。

## vocotype-cli 验证了什么

它的 `app/output.py` 是 `SendInput` + `KEYEVENTF_UNICODE`，长文本走剪贴板 + 合成 Ctrl+V ——
**和 [ADR-0002](0002-text-injection.md) 独立得出的是同一套方案**，连 `INPUT` / `KEYBDINPUT`
结构体定义都对得上。这意味着我们最大的技术风险 R1 在真实环境里是走得通的，风险等级下调。

## 借鉴的三处

### 1. 失败自动降级

它的 `type_text()` 是一条链：`keyboard.write → 剪贴板 → 逐字符 Unicode`，前一个返回
False 就试下一个。我们原来的实现是选中一种策略、失败就报错。

已改：`TextInjector.inject()` 现在构造策略链并逐个尝试，全失败时至少把文本留在剪贴板。
注入失败的原因五花八门（应用过滤合成输入、剪贴板被别的程序占用），有备胎才不会让
用户说了半天一个字没出来。

### 2. dwExtraInfo 打标记

它填 `GetMessageExtraInfo()`，我们原来填 0。

已改：填固定魔数 `VOCAL_INJECT_TAG`。比 `GetMessageExtraInfo()` 更有用 ——
那个值不可控也认不出来，而固定魔数能让低级键盘钩子认出「这是我自己打的字」并放行，
避免注入的字符反过来触发热键逻辑。

### 3. 自定义词典是刚需

它把「20 个自定义词条」当成 Pro 版卖点。印证了热词表不是锦上添花，
而是语音输入能否替代打字的分水岭 —— 人名和术语认不出来，用户就得回去手改，一切体验归零。

## 我们比它好的地方（记下来，别退化）

| | vocotype-cli | Vocal |
|---|---|---|
| SendInput 调用次数 | 每字符一次（50 字 = 50 次系统调用） | 每批 200 条 INPUT 一次投递 |
| 热键 | `keyboard.add_hotkey`，只有 keydown，toggle 式 | uiohook 拿 keyup，支持按住说话 |
| 识别 | 整段录完再转，无流式 | 流式实时出字 + 分段并行定稿 |
| 语种 | `speech_paraformer-large_...zh-cn-vocab8404`，纯中文 | 双语流式 Paraformer + SenseVoice（zh/en/ja/ko/粤） |

注：它 README 宣称「精准识别中英混合」，但 `funasr_config.py` 里配的是纯中文模型。

## 待验证的发现：DirectML

它在 `files/` 里塞了 `DirectML.dll`（18MB）和 `DXCore.dll`，配合 `funasr_onnx`
（ONNX Runtime 路线，不是 torch）就能在 Windows 上吃 GPU —— 不挑卡，
Intel / AMD / NVIDIA 通吃，不需要 CUDA。

我们能不能用上，验过了，结论是**能，但不是开箱即用**：

- `sherpa-onnx-c-api.dll` 里确实有 `directml` provider（错误串 `DirectML is for Windows only. Fallback to cpu!`）
- 但 npm 预编译的 `sherpa-onnx-win-x64@1.13.8` 只带 CPU 版 `onnxruntime.dll`，包里**没有 DirectML.dll**
- 所以直接写 `provider: 'directml'` 会静默回落到 CPU

要真用上得换成带 DML 的 onnxruntime 并补上 DirectML.dll。收益主要在定稿那一趟
（SenseVoice，现在估算 150~400ms/段），流式那趟本来就够快。已列进 ROADMAP 的
性能实验，M0~M2 跑完再做。

## 许可

两个项目都是 Apache-2.0，借鉴思路与再实现没有问题。
本项目未复制其任何代码；若将来直接复用代码片段，需在 `NOTICE` 中标注来源。

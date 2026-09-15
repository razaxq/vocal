# ADR-0002：文本注入用 SendInput + 剪贴板混合，不做 TSF

- 状态：已采纳（第一阶段）
- 日期：2026-09-14

## 候选方案

| 方案 | 结论 |
|---|---|
| TSF Text Service（真·输入法） | 推迟。DLL 注入每个进程、需双架构签名、崩溃波及宿主、调试困难；而语音输入用不上它最大的优势（候选交互） |
| SendInput + `KEYEVENTF_UNICODE` | **采用（主通路）** |
| 剪贴板 + 合成 Ctrl+V | **采用（长文本通路）** |
| `PostMessage(WM_CHAR)` | 否决。需精确定位子窗口句柄，Chromium/Electron 系不接受 |
| UI Automation `TextPattern` | 否决。控件实现率太低 |
| PowerShell `SendKeys`（ququ 的做法） | 否决。每次起进程，延迟 300~800ms |

## 决策

`TextInjector` 按 `config.injection.strategy` 选择：

- `auto`（默认）：≤80 字走 SendInput，>80 字或命中应用黑名单走剪贴板
- 流式改写强制走 SendInput（剪贴板无法退格重写）

`TextInjector` 是接口，二期若加 TSF 前端只需新增一个实现。

## 已知限制（必须在 README 里写明）

- 以 `asInvoker` 运行，无法向管理员权限窗口注入（UIPI）。提权会导致反向的问题，两头不可兼得。
- 部分反作弊游戏屏蔽合成输入。

## 前提条件

悬浮面板必须 `focusable: false` + `showInactive()`。面板一旦夺焦，SendInput 会打到面板自己身上。

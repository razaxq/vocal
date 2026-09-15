# ADR-0003：热键用 globalShortcut + uiohook 双后端

- 状态：已采纳
- 日期：2026-09-14

## 问题

「按住说话」需要 keyup 事件。Electron 的 `globalShortcut` 只回调 keydown。

## 各方案的缺口

| 能力 | `globalShortcut` | `uiohook-napi` | 自写 WH_KEYBOARD_LL |
|---|---|---|---|
| keyup | ✗ | ✓ | ✓ |
| 吞掉按键 | ✓ | ✗ | ✓ |
| 需要编译工具链 | ✗ | ✗（有 prebuild） | ✓（napi-rs） |

## 决策

双后端，按模式分派：

- `hold` / `doubleTap` → uiohook，**默认键右 Ctrl**。单独按修饰键在绝大多数应用里是空操作，所以「不能吞按键」这个缺陷无害。

  > **键名有坑（M0 实测踩到）**：uiohook 的枚举里右 Ctrl 叫 `CtrlRight`，不是 `RightControl`。
  > 写错只会在注册热键那一刻抛运行时错误，类型检查和单元测试都拦不住。
  > 现在可用键名集中在 `src/shared/hotkeys.ts` 的 `HOTKEY_CHOICES` ——
  > 配置 schema 拿它做 enum 校验、设置界面拿它渲染下拉、HotkeyService 报错时列出它，
  > 三处共用一份，不给打错字的机会。
  > 完整枚举里的修饰键只有：`Ctrl` / `CtrlRight` / `Alt` / `AltRight` /
  > `Shift` / `ShiftRight` / `Meta` / `MetaRight`。
- `toggle` → globalShortcut。组合键必须吞掉，否则会触发目标应用自己的快捷键。

## 何时重新考虑

用户强烈要求用非修饰键（如 F2）做按住说话时，需要自写 napi-rs 原生模块，在 `WH_KEYBOARD_LL` 回调里返回 1 吞掉按键。`HotkeyService` 的后端可替换，届时不动上层。

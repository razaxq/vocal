# 应用资源

- `icon.png`、`tray.png`：通过 Qt 资源系统编入程序。
- `changelog.json`：关于页与 Release 说明共用的更新日志。
- `dictionaries/rime-ice/`：完整雾凇派生词库、上游原文和来源许可。

`native/scripts/package.ps1` 只打包运行时词库与许可，不打包原始 `base.dict.yaml`。
Windows 任务栏和 EXE 图标来自 `build/icon.ico`，图标源文件是 `build/icon.svg`。

模型不进入安装包。正式运行时由 Qt 用户数据目录保存模型、设置和历史；
开发预览使用 `data/models` 与 `data/native-preview`。

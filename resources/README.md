# 运行时资源

打包时由 `electron-builder.yml` 的 `extraResources` 复制进 `process.resourcesPath`，
开发时从项目根目录读（见 `main/windows/settingsWindow.ts` 的 `iconPath()`）。

| 文件 | 用途 |
|---|---|
| `tray.png` / `tray@2x.png` | 托盘图标，32 / 64 px |
| `icon.png` | 窗口图标（开发时用；打包后窗口跟 exe 图标走） |

模型**不在这里**，也不进仓库（500MB+）。它们下载到用户数据目录的 `models/`：
便携版是 exe 旁边的 `data/models`，安装版是 `%APPDATA%\Vocal\models`。
在设置的「识别」页点一下就开始下载。

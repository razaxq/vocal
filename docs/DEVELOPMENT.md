# 开发指南

当前应用使用 C++20 / Qt Quick。Windows 工具链为 Qt 6.8.3、MinGW 13.1、sherpa-onnx 1.13.8。

## 环境与运行

```powershell
./native/scripts/setup.ps1
./native/scripts/dev.ps1 run
```

重建前从托盘退出原生预览。首次运行在识别页下载模型；调试配置位于 `data/native-preview`，模型位于 `data/models`。

```powershell
./native/scripts/dev.ps1 test             # C++ 测试
./native/scripts/dev.ps1 migration-tests  # 已下载模型的完整流程验证
./native/scripts/package.ps1 -Installer  # 本地安装包，需 NSIS
```

详细工具路径、独立打包和验证边界见 [原生开发指南](../native/README.md) 与 [验证记录](../native/VALIDATION.md)。

## 主要目录

| 目录 | 内容 |
|---|---|
| `native/src` | C++ 控制器、录音、模型进程、系统触发、文字输入及更新 |
| `native/qml` | Qt Quick 设置界面和录音悬浮条 |
| `native/tests` | C++、识别流程、发布和独立部署测试 |
| `native/scripts` | 开发环境、构建、打包和发布脚本 |
| `scripts/models.json` | 模型登记及固定下载地址 |
| `scripts/dictionary` | 雾凇派生词库生成工具与校验 |
| `resources` | 更新日志、图标和完整词库 |
| `build` | 图标源文件及 ICO，不是编译输出 |
| `data` | 本机工具链、模型、测试证据和构建产物，不进 Git |

版本号来自根目录 `package.json`，更新日志位于 `resources/changelog.json`。
根目录 npm 不含应用依赖，仅提供命令入口及无外部依赖的词库工具。
`native/dependencies` 的独立锁文件仅用于取得原生推理 DLL，不包含 Electron。

## 词库维护

```powershell
npm test           # 生成结果、来源和许可证校验
npm run sync:rime   # 联网更新固定上游版本
```

词库同步也由 GitHub Actions 每周运行。运行应用无需 Node.js；Node 只用于开发时获取 SDK 和维护词库。

旧 Electron 源码与测试已从工作区移除，需要对照时查看 v0.1.x Git 标签。
历史设计决策和研究记录保留，不作为当前构建说明。

# Vocal Native — C++ / Qt Quick

业务逻辑由 C++20 实现，Qt Quick/QML 负责界面；
运行时不启动 Electron、Node.js、Python 或 WebEngine。v1.0.0 起使用原生安装包。

## 本机调试

```powershell
./native/scripts/dev.ps1 run
```

重建前从托盘退出正在运行的原生版。单击或双击托盘图标均可恢复设置窗口。
测试全局触发前退出 Electron Vocal，避免两个程序同时录音。

- 设置页沿用旧版的九个标签、880×640 窗口、192 像素侧栏及浅色/深色绿色主题。
- 键盘支持按住、切换、双击及自定义按键；鼠标支持左键、中键、左键＋中键。
- 键盘与鼠标分别控制全屏触发。Esc 仅取消键盘录音。
- 默认关闭流式；定稿默认 Paraformer 三语；纠错默认 MacBERT。
- 流式、定稿、纠错在独立进程中运行，各自加载、切换和卸载。
- 原生模型下载支持进度、取消、校验、解压和删除反馈。
- 完整雾凇词库参与定稿候选检索/纠错，个人热词点击保存后生效，不随输入重载模型。
- 录音按停顿/最长 30 秒切段，按顺序定稿；最终结果覆盖流式预览。
- 悬浮条沿用旧版的紧凑/实时文字布局、五条波形和进出动画，设置窗口隐藏后也能显示。
- 本地口语清理、可选 AI 整理、Unicode/剪贴板输入、剪贴板恢复、历史记录均已接入。
- 可设置空闲卸载；唤醒时先采集录音，等待模型准备好。
- 关于页包含进程内存/CPU、模型占用、更新入口和更新日志。
- 开机自启仅允许独立部署包。开发包不自动安装更新；正式原生通道只接受
  `Vocal-Native-Setup-<version>.exe`，不会安装现有 Electron 发布文件。

开发配置和历史保存在 `data/native-preview`，不读取或覆盖 Electron 的设置和 API Key。
模型目录复用 `data/models`；**在原生版删除模型也会删除这里的共享模型文件**。
录音临时文件在识别结束后清理，历史只存文字。

## 构建环境

已验证 Windows、Qt 6.8.3、MinGW 13.1、sherpa-onnx 1.13.8。
工具位于忽略目录 `data/native-tools`，无需修改系统 PATH。

```powershell
./native/scripts/setup.ps1
./native/scripts/dev.ps1 build
```

`setup.ps1` 从独立锁文件安装 sherpa 的原生 SDK DLL，不安装 Electron。识别和纠错复用一份 CPU ONNX Runtime，
不打包 Node 绑定，也不打包第二份纠错运行库或 DirectML 库。
`-QtRoot`、`-Toolchain`、`-RuntimeDirectory` 可指定其他工具路径，`-BuildDirectory` 可指定构建目录。不要并发配置/构建同一个目录。

## 验证

```powershell
./native/scripts/dev.ps1 test
./native/scripts/dev.ps1 integration
./native/scripts/dev.ps1 migration-tests
./native/scripts/dev.ps1 smoke
./native/scripts/dev.ps1 capture-probe
./native/scripts/dev.ps1 input-probe
```

`migration-tests` 使用模型自带公开音频、隔离配置和临时目录，检查：
MacBERT/BERT 语料、流式增量、完整定稿/纠错/清理/历史流程、连续两段、
仅流式识别，以及九个标签页和两种悬浮条的浅色/深色截图。
不读取个人 API Key、不发送私人录音、不向日常应用输入测试内容。

直接运行测试脚本时先将 Qt/MinGW DLL 目录放入当前进程 PATH：

```powershell
python native/tests/migration_protocol.py --app data/native-build/bin/vocal-native.exe --models data/models --screens data/native-ui-check/pages
```

完整证据及限制见 [VALIDATION.md](VALIDATION.md)。不能把固定样例通过等同于通用准确率，
也不能把自动测试等同于用户在任意应用中的全局触发与文字输入已经通过。

## 独立部署预览

```powershell
./native/scripts/package.ps1 -Installer
```

需预装 NSIS，或传入 `-NsisPath <makensis.exe>`。生成新的本地暂存目录、最大压缩 ZIP、SHA-256 清单及 NSIS 预览安装包，位置为 `data/native-dist`。
支持 `-BuildDirectory data/native-migration-build` 和 `-OutputDirectory <新目录>`。已有同名产物时停止，避免混入旧文件。打包不包含模型或原始 `base.dict.yaml`。
安装详情默认展开；发布者为 Ramos；完成页可启动应用。
部署包可独立启动，不依赖开发用 Qt PATH。

这是本地预览，不是公开发布操作。更新通道、安装/卸载、自启、签名和完整第三方分发声明
仍须在正式原生版本发布前验收。相关来源见 [THIRD-PARTY.md](THIRD-PARTY.md)。
macOS 的系统快捷键、文字注入、登录项以及实机部署尚未移植/验证。

## Actions 与正式构建

CI 已接入 Windows Qt 编译、C++ 测试、QML 检查、安装包/ZIP 以及无 SDK PATH 的部署检查。
普通推送和手动运行仅上传 artifacts；推送匹配 `package.json` 的 `vX.Y.Z` 标签才发布。
程序、安装器和更新标记共用根目录版本号；本地默认开发模式，`-Release` 才启用正式更新通道。

```powershell
./native/scripts/ci.ps1 -Release
```

流水线配置与本地验证见 [VALIDATION.md](VALIDATION.md)，云端执行结果以对应提交的 Actions 为准。
详见 [发布说明](../docs/RELEASE.md)。旧 Electron 用户到 Qt 的自动迁移尚未接入。

# Vocal Native — C++ / Qt Quick

业务逻辑由 C++20 实现，Qt Quick/QML 负责界面；
运行时不启动 Electron、Node.js、Python 或 WebEngine。v1.0.0 起使用原生安装包。

## 本机调试

```powershell
./native/scripts/dev.ps1 run
```

重建前从托盘退出正在运行的原生版。单击或双击托盘图标均可恢复设置窗口。
测试全局触发前退出其他语音输入程序，避免同时录音。

- 设置页沿用旧版的九个标签、880×640 窗口、192 像素侧栏及浅色/深色绿色主题。
- 键盘支持按住、切换、双击及自定义按键；鼠标支持左键、中键、左键＋中键。
- 键盘与鼠标分别控制全屏触发。Esc 仅取消键盘录音。
- 默认关闭流式；定稿默认 Paraformer 三语；纠错默认 MacBERT。
- 流式、定稿、纠错在独立进程中运行，各自加载、切换和卸载。
- 模型按顺序排队下载，支持单独取消、校验、解压和删除反馈。
- 左下角和托盘的语音输入总开关同步；关闭后停止录音并退出模型进程，记住原模型选择。
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
安装器与应用使用同一套浅色配色、绿色主色和 8 DIP 圆角控件；按钮与启动开关采用 GDI+ 抗锯齿绘制，
保留 Windows 按钮的鼠标、键盘与辅助功能语义，不增加运行时依赖。窗口圆角与阴影交给 Windows DWM。
窗口采用单列布局，主按钮两侧留白相等；36 DIP 自定义标题栏与设置页一致，支持拖动、最小化和关闭。
安装前关闭直接退出；安装完成后关闭与“完成”一致，遵循“打开 Vocal”开关。复制文件期间仍禁用关闭。
默认安装到 `Programs/Vocal`，首页可修改位置；安装详情默认展开，完成页通过开关选择启动应用。
旧版升级沿用已登记的安装目录。
中文与英文随系统语言选择；发布者为 Ramos。
安装器布局在 `installer/design.nsh`，其流程回归可运行 `tests/installer_ui.py`（使用隔离目录与无副作用载荷）。
标题栏源文件为 `installer/frame.cpp`，打包脚本用现有 Qt MinGW 工具链编译小型 x86 辅助 DLL，
仅供 NSIS 在临时目录加载，不安装到应用目录。手工运行 makensis 前可执行 `scripts/installer-frame.ps1`。
文件夹选择器在 `installer/folder-dialog.cpp` 的独立 STA 线程运行，使用同线程的隐藏窗口承载系统对话框，
避免 Shell 扩展和跨线程模态消息阻塞 NSIS。确认/取消时即传回结果，由主线程定时读取，
不等待系统对话框收尾；取消保留原路径，Shell 清理在后台完成。
`tests/installer_ui.py` 覆盖中文路径、连续选择/取消、主窗口响应和选择结束后的恢复时间。
部署包可独立启动，不依赖开发用 Qt PATH。

安装目录中的 `plugins/` 集中存放 Qt 插件，`qml/` 为界面运行库，`resources/` 为词库等资源，
`licenses/` 为许可文件；主程序和依赖 DLL 保留在根目录。个人配置、历史和下载模型保存在用户数据目录。

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

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
- 录音持续缓存，按 20 ms 音频帧检测停顿，在停顿内部切段并保留下一句开头；后台按顺序定稿、纠错。
- 默认自动分段：依据句内停顿节奏和当前片段长度寻找短停顿，通常约 220–480 ms；很短的片段最多等待约 650 ms，减少碎片。关闭自动分段后才使用手动设置的停顿时长。
- 结束录音后只处理剩余音频片段，基于已定稿文本做全文纠错和累计标点；不再重新识别整段录音覆盖预览。随后进行可选 AI 整理、输入和历史保存。
- 每次新增定稿片段，用累计的未加标点文本生成完整预览；不把上次带标点的预览重新送入模型。过期结果丢弃，来源未变则复用结果。SenseVoice 自带标点，不叠加 CT-Transformer。
- 悬浮窗可选全部内容、最新三行（默认）或不显示文字。全部内容先变宽再变高，达到屏幕可用高度后可滚动查看；无需启用流式模型。
- 输出时机可选识别完成后输出（新配置默认）或预览输出。旧版两种输入时机迁移为预览输出，保留原有边说边输入的行为。
- 本地口语清理、可选 AI 整理、Unicode/剪贴板输入、剪贴板恢复、历史记录均已接入。
- 最终文字调整先选中需替换的片段，再一次替换；长文本在自动模式下使用粘贴，不再逐字退格重写。保留原有内容、焦点与替换长度保护。连续输出等待上一次输入完成后再替换，尚未发送的预览合并为最新内容。
- 可设置空闲卸载；唤醒时先采集录音，等待模型准备好。
- 识别页新增“麦克风预热”，默认开启：设备保持打开，未触发的音频直接丢弃，不保存、不识别；关闭预热或语音输入总开关后释放空闲设备，退出程序也释放设备。录音期间关闭预热则在本次结束后释放。
- 麦克风打开、读取与 PCM 缓存由独立 C++ 采集线程处理，界面短暂繁忙或模型加载不会阻止采集；会话之间隔离缓存。消费积压超过 120 秒时明确报错，不覆盖未处理音频。
- Windows 使用设备原生录音格式并请求 40 ms 缓冲；先发起采集，再恢复未就绪模型。收到首批音频前悬浮窗显示“麦克风准备中”，之后显示“正在听”。
- 关于页包含进程内存/CPU、模型占用、更新入口和更新日志。
- 开机自启仅允许独立部署包。开发包不自动安装更新；正式原生通道只接受
  `Vocal-Native-Setup-<version>.exe`，不会安装现有 Electron 发布文件。

开发配置和历史保存在 `data/native-preview`，不读取或覆盖 Electron 的设置和 API Key。
模型目录复用 `data/models`；**在原生版删除模型也会删除这里的共享模型文件**。
录音临时文件在识别结束后清理，历史只存文字。

分段仍是基于音量和停顿的音频边界检测，并非语义完整性分类，也不能保证与标点模型生成的每个逗号重合。
没有可检测停顿时不会仅因文本应有逗号而切音频，也不会为凑满 30 秒而切断连续说话。
单段连续音频达到 120 秒时结束本次录音并处理缓存。整段纠错按重叠文本窗口处理，失败时保留逐段结果。
只缓存触发后的待处理音频和分段临时文件，识别结束或取消后删除；不再额外保存一份整场录音。
最终全文纠错使用已经逐段纠错的文本，不回退到原始识别结果。数字保护同时检查原词和候选词，避免语言模型把“已”误改成“一”等数字。

MacBERT 允许高置信度的非同音单字纠错，非同音候选使用更严格门槛；数字、个人热词、代码和英文标识继续受保护。普通 BERT 仍使用同音词库候选。现有纠错保持文字长度，不能增删字或调整语序。

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
python native/tests/segmentation_pipeline.py --app data/native-build/bin/vocal-native.exe --models data/models --output data/segmentation-check
python native/tests/preview_stability.py --app data/native-build/bin/vocal-native.exe --models data/models --output data/preview-stability.json
python native/tests/capture_startup.py --app data/native-build/bin/vocal-native.exe --models data/models --output data/capture-startup-check/pipeline.json
```

`segmentation_pipeline.py` 将三段公开语音与停顿连续送入实际分段路径，覆盖仅定稿、定稿加流式、
仅流式、关闭纠错四种手动分段组合，并用 400 ms 停顿检查启用/禁用流式时的自动分段；
同时检查累计原文标点、两种输出时机、最终全文纠错、历史合并和三种悬浮窗模式。
`overlay_preview.py --app <程序路径> --output <截图目录>` 检查浅/深色、中文/英文和先加宽再加高的布局。

`preview_stability.py` 重放预览退化样例，核对数字保护与现有同音纠错；不读取用户历史或录音。

`correction_context.py --app data/native-ci-build/bin/vocal-native.exe --models data/models --output data/correction-context/results.json` 用两个真实模型检查高置信度非同音纠错、原有同音纠错和正确/受保护文本；词库开关分别测试。需要先设置 Qt/MinGW DLL 的 PATH。

`capture_startup.py` 对比模型加载前、加载后送入相同公开音频的完整结果，检查开头缓存。
它不测量真实麦克风启动耗时；`capture-probe` 另报告设备打开、首批音频到达时间及实际缓冲大小，不保存录音。
`vocal-native-probe.exe --capture-warm` 检查预热后的实际首包耗时与界面线程心跳，不保存录音。
`native-capture` 使用模拟设备检查慢速启动、首尾包、消费延迟、连续触发、取消隔离、空闲丢弃和设备切换。
`capture_latency.py --probe <vocal-native-probe.exe> --app <vocal-native.exe> --models <模型目录> --output <JSON>`
交替测量开启/关闭预热的真实首包延迟，并单独测量公开音频的模型加载与推理；麦克风音频不保存、不识别。

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

## 调试记录与重放

「通用 → 调试 → 保存调试记录」默认关闭。开启后每次触发单独保存到数据目录的 `debug/时间-编号/`，点击「打开记录文件夹」即可找到。麦克风预热和设置页试音不保存。关闭后停止新增，不删除已有记录，也不自动上传。

- `audio.wav`：进入识别流水线的完整单声道 float32 音频，包含静默和各分段间隙，不做有损转换。48 kHz 约 11.5 MB/min，16 kHz 约 3.8 MB/min。
- `events.jsonl`：按序号、相对时间记录采集包、分段采样边界、三个 worker 的输入/输出、ASR 热词重识别的中间结果、标点结果是否采用、清理、预览、AI 原始/保护后结果、输入请求、完成或错误。`output.idle` 是应用内部输入完成状态，不代表任意第三方编辑器内容均已核验。
- `session.json`：版本/构建、系统、设置、模型目录与文件大小/修改时间、音频校验、最终结果和结束状态。API 密钥不保存，接口地址移除认证信息、查询参数和片段。
- `debug/assets/`：按内容校验值共享的词库快照。分享记录时需一并提供该会话引用的词库文件；不复制模型权重。

后台串行写入，不在 UI/采集线程写磁盘；普通退出会排空写入。静默、取消和异常也保留已有音频并标记状态；保存失败会在调试小节提示，识别继续运行。意外断电/强制结束可能留下不完整文件。录制期间修改设置仍须先结束录音。

已有 Qt/MinGW DLL PATH 的终端中，可以重放记录的本地模型请求：

```powershell
python native/scripts/replay-debug.py "记录目录" --app data/native-ci-build/bin/vocal-native.exe --models data/models --output data/replay.json
```

工具复用原来的分段边界、模型输入和词库，比较各阶段新旧结果；不会打开麦克风、写入其他应用或调用云服务。它用于定位识别差异，不模拟原始 GUI 时序、设备故障或外部编辑器；需要相同的模型权重和相应版本。保存的模型文件大小/修改时间不是权重校验值。词库在会话中更新、没有结束的流式尾段等情况不能完整重放，工具会明确报错。

## Actions 与正式构建

CI 已接入 Windows Qt 编译、C++ 测试、QML 检查、安装包/ZIP 以及无 SDK PATH 的部署检查。
普通推送和手动运行仅上传 artifacts；推送匹配 `package.json` 的 `vX.Y.Z` 标签才发布。
程序、安装器和更新标记共用根目录版本号；本地默认开发模式，`-Release` 才启用正式更新通道。

```powershell
./native/scripts/ci.ps1 -Release
```

流水线配置与本地验证见 [VALIDATION.md](VALIDATION.md)，云端执行结果以对应提交的 Actions 为准。
详见 [发布说明](../docs/RELEASE.md)。旧 Electron 用户到 Qt 的自动迁移尚未接入。

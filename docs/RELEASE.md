# 构建与发布

## GitHub Actions

新的发布流程打包 **C++ / Qt Quick 版（Windows x64）**。已发布的 Electron 历史版本保持不变。

| 入口 | 执行内容 | 是否公开发布 |
| --- | --- | --- |
| `main` / `codex/**` 推送、Pull Request | Qt 编译、C++ 测试、QML 检查、安装包/ZIP、独立运行检查；词库生成工具校验 | 否，下载 Actions artifacts |
| 手动运行 `ci` 或 `release` | 构建和上传测试产物 | 否 |
| 推送 `vX.Y.Z` 标签 | 校验版本 → Qt 构建/测试/打包 → 校验 GitHub 附件 → 发布 Release | 是 |

工作流：`.github/workflows/ci.yml`、`native-build.yml`、`release.yml`。
使用 GitHub 托管 Windows runner；Qt 6.8.3 / MinGW 13.1 缓存可复用。
构建 Python 工具固定在 `native/requirements-build.txt`；原生 SDK 独立锁定在
`native/dependencies/package-lock.json`，原生任务不安装 Electron。
安装器使用 NSIS 3.12。只有发布 job 获得 `contents: write`，其他 job 只读。

测试证据和截图保留 14 天。CI 不下载大型语音模型，不访问麦克风、不向其他应用输入文字。
完整公开音频识别回归仍由 `native/scripts/dev.ps1 migration-tests` 在备有模型的环境执行。

## 发布附件

- **`Vocal-Native-Setup-X.Y.Z.exe`：安装版，推荐使用。**
- `Vocal-Native-X.Y.Z-win-x64.zip`：解压运行版。
- `SHA256SUMS.txt`：两个包的 SHA-256。

安装包使用 LZMA solid，ZIP 使用最大压缩。模型和原始 `base.dict.yaml` 不随安装包发布。
包含派生词库、组件许可证、MinGW 上游声明、Qt SPDX 组件清单。
解压版和安装版均使用原生应用的 AppData 配置目录；解压版不是随 U 盘携带配置的模式。

Qt 更新器读取 GitHub Release API，只接受匹配版本的 `Vocal-Native-Setup-*.exe`，
校验 GitHub 提供的 SHA-256 和文件大小；不需要 Electron 的 `latest.yml` 或 `.blockmap`。
启动时自动检查，自动更新开关控制是否随后下载安装。
应用内更新静默安装到当前程序目录，等待旧进程及模型退出后覆盖文件并重启；
直接双击安装包仍显示安装向导。v1.0.1 及更早的客户端不传静默参数，首次升级仍会显示向导。
本地开发包带 `development: true`，不会安装正式更新；标签构建为 `false`。

**Electron 到 Qt 的自动迁移尚未实现。** 本流程不向旧 Electron 更新器推送 Qt 安装器，
也不自动迁移其配置、API Key、模型或历史。首次原生版本需手动安装，数据目录和安装目录独立。

## 发布新版本

1. 修改根目录 `package.json` 的版本（可用 `npm version patch --no-git-tag-version` 同步锁文件）。
2. 更新 `resources/changelog.json`，提交并推送代码，确认 CI 通过。
3. 对该提交创建同版本标签并推送，例如 `v1.0.0`。不要重用已发布标签。

程序版本、Windows 文件属性、安装器和更新标记均从该版本派生。标签不匹配时停止构建。
发布脚本先校验本地包，再上传到草稿，验证所有附件的大小和 GitHub SHA-256，最后明确取消 Draft。
失败时保留草稿便于重跑；已经公开的版本只有附件完全相同时才视为成功，不覆盖不同附件。
首次 Qt 发布仍需安装/升级/卸载和日常输入的人工验收；目前未配置代码签名。

## 本地复现 Actions 构建

```powershell
./native/scripts/setup.ps1
# 一次性安装 NSIS，或给 ci.ps1 传入 -NsisPath <makensis.exe>
choco install nsis --version=3.12 -y
./native/scripts/ci.ps1 -Release
```

产物：`data/native-ci-dist`；测试证据：`data/native-ci-check`。
输出目录已有同名产物时脚本停止，避免 ZIP 增量打包夹带旧文件。
若需再次打包，可给 `ci.ps1` 或 `package.ps1` 指定新的 `-OutputDirectory`。
本地执行不会创建标签、推送代码或发布 Release。

仅检查待发布附件：

```powershell
./native/scripts/publish.ps1 -Tag v1.0.0 -ArtifactDirectory data/native-ci-dist -ValidateOnly
```

省略 `-ValidateOnly` 会实际发布，应由标签触发的发布 job 执行。
原生运行/调试和迁移验收见 [native/README.md](../native/README.md) 与
[native/VALIDATION.md](../native/VALIDATION.md)。

## 历史版本

当前工作区只维护 Qt 原生版。旧 Electron 源码可从 v0.1.x Git 标签查看；历史 GitHub Release
与旧更新清单保留，避免中断已安装旧版用户的下载入口。新版本只构建和发布 Qt 包。

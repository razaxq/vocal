# 发布到 GitHub

## 一次性准备

1. **仓库地址已填好**：`package.json` 的 `repository.url` 指向
   `https://github.com/razaxq/vocal.git`。electron-builder 用它决定把产物传到哪个 Release，
   electron-updater 用它决定去哪里查新版本。
   **改仓库名或换账号时这里必须跟着改** —— 填错不会报错，只会让自动更新永远显示「已经是最新版本」。

2. **图标已就位**：`build/icon.ico`（16~256 七个尺寸）和 `resources/tray.png`。

3. **`.gitignore` 已挡住 `data/`**（模型 1.5GB、配置、历史）和 `node_modules/`。

4. **仓库必须是公开的**，否则 Release 附件要 token 才能下载，自动更新会失效。

5. **开发者和链接**：`package.json` 的 `author` 为 Ramos，`homepage` 和开发者链接为 `https://blog.dtft.net/about/`；`repository` 保留 GitHub 仓库地址。`electron-builder.yml` 配置完整版权、Issues 反馈入口和 Releases 更新入口。开发者名称用于文件属性和安装信息，不等同于代码签名的已验证发布者。

## 出什么格式

**不要用 RAR。** 它是私有格式，Windows 不能双击打开，用户还得先装 WinRAR ——
在一个「装完就能用」的项目上加一道安装 WinRAR 的门槛，没有道理。

发两个产物，各有各的人群：

| 产物 | 给谁 | 数据在哪 | 自动更新 |
|---|---|---|---|
| **`Vocal-Setup-x.y.z.exe`（NSIS，推荐）** | 大多数用户，按向导安装 | `%APPDATA%\Vocal` | ✅ |
| `Vocal-x.y.z-win.zip` | 解压即用，方便迁移或随身携带 | exe 旁边的 `data/` | ✅ |

Release 说明顶部将「安装版（推荐）」下载链接放在第一位，「便携版」放在第二位。

启动只检查版本，「关于」旁显示红点；用户点击后下载并重启更新。
安装版使用 NSIS；便携版下载同一 Release 的 `Vocal-*-win.zip`，校验 GitHub 资产的
SHA-256 和大小后，由独立助手替换程序文件，保留 `data/`，失败时恢复备份。
ZIP 必须由 GitHub Release 资产提供有效的 `digest`，缺失时拒绝安装。

两者由**卸载程序**区分：NSIS 一定会在安装目录里留一个 `Uninstall Vocal.exe`，
zip 里绝不会有。程序据此判断自己是哪一种（见 `main/index.ts` 的 `setupDataDir`）。

为什么安装版不把数据放在 exe 旁边：NSIS 升级本质上是「卸载再安装」，会重写整个安装目录。
数据放那儿，每次自动更新都会连锅端掉用户的模型和历史。

## 发一个版本

```powershell
# 1. 改版本号 —— 会自动改 package.json、提交、打一个 v0.1.1 的 tag
npm version patch          # 或 minor / major

# 2. 把提交和 tag 一起推上去
git push --follow-tags
```

`git push` 默认**不推 tag**，而 release 流水线是被 tag 触发的。
只 `git push` 的话 CI 会跑、Release 不会有；只 `git push --tags` 的话版本号
留在本地没同步上去。`--follow-tags` 两件事一起做，是这里唯一正确的写法。

GitHub Actions（`.github/workflows/release.yml`）会在 Windows runner 上
`npm ci` → 类型检查 → 测试 → 打包 → 上传到对应的 Release。
整个过程 10 分钟上下，大头是下载 Electron 和压包。

**Release 页面空的？** 先看 Actions 里 `release` 这个 workflow 有没有跑过。
它只在 `v*` 的 tag 被推上来时触发 —— 平时往 main 推代码只会跑 `ci`，
不会产出任何文件。

产物里有个 `latest.yml`，那是 electron-updater 查版本用的清单。
**不要手动编辑 Release 的附件列表**，删了它自动更新就废了。

## 本地打包（不发布）

安装版与便携 ZIP 使用 `compression: maximum`；压缩更耗时，实际体积以产物为准。安装器默认展开安装详情（`build/installer.nsh`）。词库资源采用白名单，仅打包派生词表、GPL 许可、来源和上游声明；原始 `base.dict.yaml` 留在源码中。发布时保留 GitHub 的源码下载入口，供用户获取同版本的词库原始文件及生成代码。

```bash
npm run dist          # 出 release/ 目录，不上传
npm run pack          # 只解包，不做安装器，调试用
```

## 代码签名

没签名的话，用户第一次运行会看到 SmartScreen 的蓝色警告框，要点「更多信息 → 仍要运行」。
这不是能靠配置绕过的 —— 需要一张 OV/EV 代码签名证书（每年几百到上千美元），
EV 证书才能立刻获得 SmartScreen 信誉，OV 证书要靠下载量慢慢积累。

个人项目通常就先不签，在 README 里说明一句。要签的话把证书塞进 Actions secrets，
然后在 `electron-builder.yml` 的 `win` 下加 `certificateSubjectName` 或用
`CSC_LINK` / `CSC_KEY_PASSWORD` 环境变量。

## 模型不进安装包

四个模型加起来 500MB+。打进去会让安装包无法增量更新，也让「只想试试」的人望而却步。
首次启动检测缺失 → 设置窗口直接开到「识别」页，点一下就开始下载。
这一条不要改。

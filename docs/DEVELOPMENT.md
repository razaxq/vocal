# 开发指南

## 环境与运行

在 Windows x64 环境中使用 Node.js 22 或更新版本。

```powershell
npm ci
npm run dev
```

首次运行可在设置的「识别」页下载模型，也可以执行 `npm run models` 下载默认模型组合。
模型解压使用项目内的解压逻辑，支持纯 JavaScript 回退。

```powershell
npm run typecheck  # 类型检查
npm test           # 单元测试，不需要下载识别模型
npm run build      # 构建应用
npm run pack       # 生成解包后的 Windows 应用
npm run dist       # 生成安装包和便携包，输出到 release/
```

依赖包含预编译的原生模块。请使用 `npm ci` 安装，并保留锁文件中的平台可选依赖。

## 主要模块

| 模块 | 实现 |
|---|---|
| 桌面界面 | Electron、React、electron-vite |
| 语音识别 | sherpa-onnx；默认流式 Zipformer 中文、定稿 Zipformer 中英 |
| 标点 | CT-Transformer |
| 进程 | 主进程、界面进程，以及独立的流式与定稿识别进程 |
| 文字输入 | Windows SendInput 与剪贴板回退 |
| 快捷键 | uiohook-napi、Electron globalShortcut |
| 配置与历史 | electron-store、JSONL |

模型列表和下载地址位于 `scripts/models.json`。修改默认模型时，需要同步
`src/shared/modelRegistry.ts` 和 `scripts/fetch-models.mjs`。
应用内更新日志位于 `src/shared/changelog.json`，发布时应与 `package.json` 的版本号保持一致。

## 更多文档

- [架构设计](DESIGN.md)
- [路线图与验证记录](ROADMAP.md)
- [技术决策](adr/)
- [发布流程](RELEASE.md)

## 参考项目

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)：模型分发与推理运行时。
- [ququ](https://github.com/yan5xu/ququ)：语音输入交互与后处理思路。
- [vocotype-cli](https://github.com/233stone/vocotype-cli)：Windows 文字输入实现参考。

ququ 和 vocotype-cli 的借鉴范围记录在 [ADR-0001](adr/0001-no-ququ-submodule.md)
与 [ADR-0004](adr/0004-prior-art.md)。

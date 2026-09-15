# ADR-0006：去掉 better-sqlite3，保持零编译依赖

- 状态：已采纳
- 日期：2026-09-14
- 取代：[ADR-0005](0005-long-form-pipeline.md) 无关；修改 DESIGN §4.5 的打包分发部分

## 触发

在 Windows 实机上第一次 `npm install` 就挂了：

```
npm error path D:\project\vocal\node_modules\better-sqlite3
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c node-gyp rebuild
npm error gyp ERR! find VS You need to install the latest version of Visual Studio
npm error gyp ERR! find VS including the "Desktop development with C++" workload.
```

## 调查

逐个检查四个原生模块在 Windows x64 上的二进制来源：

| 模块 | 来源 | 需要 C++ 工具链 |
|---|---|---|
| koffi | `@koromix/koffi-win32-x64`（optionalDependency 里的预编译包） | 否 |
| uiohook-napi | 包内 `prebuilds/win32-x64/uiohook-napi.node`，走 node-gyp-build | 否 |
| sherpa-onnx-node | `sherpa-onnx-win-x64`（optionalDependency） | 否 |
| **better-sqlite3** | 无预编译，必须 node-gyp rebuild | **是** |

**四个里只有一个需要编译。** 为了它，每个用户都得先装 Visual Studio Build Tools
（含 C++ 工作负载，约 6GB）才能跑起来 —— 对一个「装完就能用」的桌面工具来说，
这是不可接受的入门门槛。

## 考虑过的方案

| 方案 | 结论 |
|---|---|
| 要求用户装 VS Build Tools | 否决。6GB 的前置条件，劝退绝大多数人 |
| `node:sqlite`（Node 24 内置，Electron 44 = Node 24.20） | 否决。Electron 的 Node 构建是否包含它没有权威说法，赌不起；而且我们也不需要 SQL |
| `sql.js`（SQLite 编译成 WASM） | 否决。为了不用的功能背 1.5MB wasm 和手动持久化 |
| **JSONL 追加文件 + 内存索引** | **采纳** |

## 决策

历史记录改用 JSONL。`HistoryService` 的对外接口一行没变，上层无感。

这个负载本来就不需要数据库：

- 追加一条（每次语音输入结束时一次）
- 列最近 N 条（打开设置页时）
- 按 id 删一条（很少）
- 算 count / chars / totalMs（三个累加）

没有 join、没有 where、没有排序需求（文件本身就是时间序）。
容量估算：每天 50 条、每条 ~300 字，两年约 36k 条 / 10MB，全量读进内存启动解析 ~50ms。
超过 20000 条在下次启动时自动压缩。

实现要点：

- 追加是单行 `appendFileSync`，进程被杀最多丢最后一行
- 加载时跳过解析失败的行 —— **不能因为一行半截 JSON 就丢掉全部历史**（有测试覆盖）
- 删除是「重写临时文件 + rename」，保证不会留下写到一半的坏文件
- 历史写失败不抛出，只标脏 —— 绝不能因为记日志失败打断语音输入

`HistoryService` 不再 import electron（路径由主进程传入），因此可以直接跑单元测试：
`npm test`，7 个用例。

## 连带改动

- `package.json`：移除 `better-sqlite3`、`@types/better-sqlite3`、`@electron/rebuild`；
  删掉 `postinstall` 和 `rebuild` 脚本 —— 现在没有任何东西需要重建
- `electron-builder.yml`：`asarUnpack` 去掉 better-sqlite3，补上 `@koromix/**`
  （koffi 的平台二进制在这个 scope 下，留在 asar 里会加载不了）
- `package-lock.json` 重新干净生成。**注意**：在 Linux 上做增量 `npm install` 会
  把其它平台的 optional 依赖从 lock 里剔掉，必须 `rm -rf node_modules package-lock.json`
  重新解析，否则 Windows 上装不到 `sherpa-onnx-win-x64` 和 `@koromix/koffi-win32-x64`

## 结果

整个项目零编译依赖。`npm install` 不再执行任何 node-gyp，不需要 Python、不需要 VS。

## 什么时候重新考虑

历史记录需要全文搜索、或者条数上到十万级时。届时 `node:sqlite` 大概率已经在
Electron 里稳定可用，换回去只需要改 `HistoryService` 一个文件。

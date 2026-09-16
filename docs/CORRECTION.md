# 本地同音纠错与调试

默认使用 MacBERT。可在设置 → 识别 → 同音纠错模型中更换，选择「不使用」关闭纠错。
一次只加载一个纠错模型。它在定稿完成后、最终文字进入悬浮条和目标输入框前处理。
流式预览仍会变化；纠错不处理每次流式刷新。标点模型继续保留。

## 模型

| 模型 | 下载大小 | 处理方式 |
|---|---:|---|
| MacBERT 中文纠错 | 约 453 MiB | 专用中文纠错，再用整句语境筛选同音候选 |
| BERT 中文纠错 · 轻量 | 约 99 MiB | INT8 中文掩码语言模型，仅对雾凇同音候选评分 |

这是两种不同的模型，不是同时开启的两层。BERT 是通用语境模型，不是专门微调的纠错模型。
MacBERT 在当前例句上的效果更好。下载大小是实际 ONNX 文件加词表，不等于运行内存。
开启雾凇词库才能使用整词同音候选；关闭后 MacBERT 仅执行直接纠错，BERT 不做改动。

模型不放进安装包。下载固定版本并验证每个文件的 SHA256 和大小；取消或校验失败不安装半成品。

- MacBERT：[模型与许可证](https://huggingface.co/shibing624/macbert4csc-base-chinese)，revision `615e6e09ef9a69ec487bc7c641ec3a311e2c11b9`。
- BERT：[ONNX 转换模型](https://huggingface.co/Xenova/bert-base-chinese)，revision `18b8e1c8e40928dbaa1f7e7f49a4c64c94f6785b`；[原始模型](https://huggingface.co/google-bert/bert-base-chinese)。
- 词库沿用雾凇基础词库；来源和授权见 `resources/dictionaries/rime-ice/SOURCE.md`。

## 本地运行

```powershell
npm run models -- --model macbert4csc
npm run models -- --model bert-chinese-int8
npm run dev
```

在识别页切换纠错模型、保持雾凇词库开启，然后正常按快捷键说话。
修改发生在本地工作区，尚未提交或发布时，已安装的版本不会获得这些改动。

也可以只测试文本，不录音、不向其它窗口输入：

```powershell
npm run m1:correction
npm run m1:correction -- "完全就是给拦柜用的"
```

两种模型依次执行，结果及耗时写入 `data/correction-report.json`。
内置 13 句包含 3 个待纠错误句和 10 个正确句，用于功能调试，不代表通用准确率。
当前本机测试：MacBERT 13/13 与预期一致；BERT 11/13，其中「拦柜→懒鬼」「高心→高兴」未改动。
必须结合更多真实口述验证误改率，不能据此宣布某个模型准确率为 100%。

## 行为与限制

- 保留原句结构和格式，只接受同音或前后鼻音近音替换，置信差距不足时保留原文。
- 保护个人热词、英文、数字（含中文数字）、时间、网址和反引号内代码；未标注的中文人名仍可能被误改。
- 每个窗口最多评估 12 组同音词；长句分窗口处理，纠错计算预算约 2 秒，剩余文字保留原样。
- 模型缺失、加载或推理失败保留识别结果；纠错进程崩溃或 15 秒无返回时也回退。
- 纠错进程与识别进程隔离，避免 Windows ONNX Runtime DLL 冲突。随识别空闲策略卸载；关于页单独显示「同音纠错」占用。
- 当前使用 CPU，不需要 GPU，也不会发送识别文字到云端。

## 验证

```powershell
npm test
npm run build
npm run m0:correction  # 真实 Electron 子进程、顺序、个人热词与故障回退
npm run m0:hotwords    # 构建后的设置页切换与保存
```

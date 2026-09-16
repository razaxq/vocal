# 雾凇拼音词库

来源：https://github.com/iDvel/rime-ice

源码仓库中的 `base.dict.yaml` 是上游基础词库的未修改副本；程序运行时只读取 `catalog.json`，安装版和便携版不包含原始词典。随包的 `LICENSE` 是上游 GPL-3.0 许可证全文，`UPSTREAM-NOTICES.txt` 保留原词典头部的来源与修订说明。

`catalog.json` 是 Vocal 根据基础词库生成的派生数据，同样按 GPL-3.0 提供。它记录了原始提交 SHA、文件 SHA-256、上游词库日期、候选词数和筛选方法。原词典数据和生成结果与应用代码分开存放，Vocal 自有代码的许可见仓库根目录 LICENSE。

Vocal 于 2026-09-16 将基础词库转换为完整词条与多音读法对应的 JSON 格式（`full-pinyin-v2`），执行去重、排序和格式校验。后续词典变更的上游日期与提交见 `catalog.json` 的 `updatedAt` 和 `source.revision`；Vocal 的转换修改记录见仓库提交历史。

## 获取对应源码

在 [Vocal 发布页](https://github.com/razaxq/vocal/releases) 选择与软件版本相同的标签，下载该页免费提供的 **Source code (zip)** 或 **Source code (tar.gz)**。其中包含原始词典、许可证、`scripts/sync-rime.mjs`、`src/shared/rimeDictionary.ts` 和依赖清单。安装目录内的应用许可为 `resources/licenses/Vocal-MIT.txt`。

单独更新的词表可按 `catalog.json` 的 `source.revision`，从 `https://raw.githubusercontent.com/iDvel/rime-ice/<revision>/cn_dicts/base.dict.yaml` 获取精确的上游原始文件，并用 `source.sha256` 校验；Vocal 仓库的 [词库历史](https://github.com/razaxq/vocal/commits/main/resources/dictionaries/rime-ice) 保留对应的原始数据和生成代码。`npm run sync:rime` 默认同步上游最新版本；重现旧词表应对该快照的原始词典使用 `selectRimeWords`，不要重新同步最新上游。

生成方法：运行 `npm run sync:rime`。完整读取基础词库的有效数据行，按词去重，保留不同读音，按最高词频排序（同频按 Unicode 顺序）。`words` 与 `readings` 按位置对应，读音以空格分隔音节、多音以 `|` 分隔。当前快照包含 541,809 个不同词条；不再按长度或前 500 词截取。为防止引擎语法注入，更新时仍校验字符、长度和读音格式。代码见 `scripts/sync-rime.mjs` 和 `src/shared/rimeDictionary.ts`。

这是完整的 `base.dict.yaml` 基础词库，不包含雾凇的扩展库、腾讯库或英文库，不代表当前网络热度。定稿时按本句读音检索候选，不把全部词条同时加权。个人词语可在 Vocal 的「个人热词」中添加。

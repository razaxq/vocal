# 雾凇拼音词库

来源：https://github.com/iDvel/rime-ice

此目录中的 `base.dict.yaml` 是上游基础词库的未修改副本，保留原始来源说明；`LICENSE` 是该上游提交的 GPL-3.0 许可证全文。

`catalog.json` 是 Vocal 根据基础词库生成的派生数据，同样按 GPL-3.0 提供。它记录了原始提交 SHA、文件 SHA-256、上游词库日期、候选词数和筛选方法。原词典数据和生成结果与应用代码分开存放，Vocal 自有代码的许可见仓库根目录 LICENSE。

生成方法：运行 `npm run sync:rime`。完整读取基础词库的有效数据行，按词去重，保留不同读音，按最高词频排序（同频按 Unicode 顺序）。`words` 与 `readings` 按位置对应，读音以空格分隔音节、多音以 `|` 分隔。当前快照包含 541,809 个不同词条；不再按长度或前 500 词截取。为防止引擎语法注入，更新时仍校验字符、长度和读音格式。代码见 `scripts/sync-rime.mjs` 和 `src/shared/rimeDictionary.ts`。

这是完整的 `base.dict.yaml` 基础词库，不包含雾凇的扩展库、腾讯库或英文库，不代表当前网络热度。定稿时按本句读音检索候选，不把全部词条同时加权。个人词语可在 Vocal 的「个人热词」中添加。

# 雾凇拼音词库

来源：https://github.com/iDvel/rime-ice

此目录中的 `base.dict.yaml` 是上游基础词库的未修改副本，保留原始来源说明；`LICENSE` 是该上游提交的 GPL-3.0 许可证全文。

`catalog.json` 是 Vocal 根据基础词库生成的派生数据，同样按 GPL-3.0 提供。它记录了原始提交 SHA、文件 SHA-256、上游词库日期、候选词数和筛选方法。原词典数据和生成结果与应用代码分开存放，Vocal 自有代码的许可见仓库根目录 LICENSE。

生成方法：运行 `npm run sync:rime`。保留 3–12 个常用汉字组成的词，去重后按上游词频从高到低取 500 个；词频相同时按 Unicode 字典顺序排序。筛选代码见 `scripts/sync-rime.mjs` 和 `src/shared/rimeDictionary.ts`。

这是基础词库的识别加权子集，不是完整输入法词库，也不代表当前网络热度。未启用词语仍可由语音模型正常识别；个人词语可在 Vocal 的「个人热词」中添加。

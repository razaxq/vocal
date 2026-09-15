# 打包资源

打包前需要放进来：

- `icon.ico` — 应用图标，256×256 起，建议含 16/32/48/256 多尺寸
- （可选）`installerIcon.ico` / `uninstallerIcon.ico`

`../resources/tray.png` 是托盘图标（建议 16×16 和 32×32 两套，命名 `tray.png` / `tray@2x.png`）。

这两个文件缺失时：托盘会退化成空白图标（不影响功能），但 `npm run dist` 会在图标步骤报错。

# MTKB 内置资源

本目录由 `npm run import:mtkb` 从「SAMA-*-MTKB-可交付版.zip」导入，打包后位于 `resources/mtkb`。

```text
mtkb/
├── sama-docs/          → 启动时安装到 %APPDATA%\SAMA\sama-data\kb\docs\通用\MTKB
├── 数据库包/            → Electron 内 node:sqlite 只读检索（共通/设备/电路）
├── mtkb.py             → 可选：python mtkb.py serve（独立 HTTP API）
└── 前端API对接说明.md
```

- 大体积 `.sqlite3` 默认不提交 Git（见根目录 `.gitignore`）。
- 缺库时先运行：`npm run import:mtkb`
- 更新电路库：把新的 `电路数据库.sqlite3` + `circuit.zip` 用 `npm run import:circuit` 接入（写入 `数据库包/专有数据库` 与 `sama-docs/.../circuit-cases`）。
- 更新资料：替换本目录并提高 `sama-docs/bundle.json` 的 `bundle_version`，下次启动会重装托管子目录。

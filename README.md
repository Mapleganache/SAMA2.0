# SAMA 2.0 · 数控机床故障诊断 Agent

SAMA 2.0 是一个面向数控磨床/机床的故障诊断 Agent。输入机型、工况、冷热态、现象或报警号后，它会检索本地知识库与历史案例，生成多路候选方案，再由 Judge 评分选优，最终给出待验证的主方向、排查步骤和引用来源。

仓库只保留 SAMA 本体：

```
SAMA/
├─ README.md
├─ 使用说明.md
└─ sama2.0/          # 应用源码
```

数据库不随 Git 分发，单独提供。

## 快速开始

```sh
cd sama2.0
npm ci
npm start
```

浏览器打开：

```
http://127.0.0.1:3920/
```

把数据库放到 `sama2.0/data/sama_full.sqlite`，或启动前设置：

```powershell
$env:SAMA2_SQLITE_PATH='D:\SAMA\SAMA-DB-20261122\sama_full.sqlite'
```

没有数据库时页面仍能打开，但知识库检索不可用。

## 数据库

数据库是本地 SQLite 文件，不是 HTTP 接口。只要 schema 与 `release_meta.full_archive_version=1` 一致，换库只需要接路径：

- `SAMA2_SQLITE_PATH` 环境变量；或
- `sama2.0/sama-database.json` 的 `dbPath`；或
- 默认位置 `sama2.0/data/sama_full.sqlite`。

## 中英文

页面右上角 `EN / 中文` 切换界面与回答语言；也可以：

```powershell
$env:SAMA2_LANGUAGE='en'
```

## 测试

```sh
cd sama2.0
npm test
```

测试不需要真实 API Key；通过不代表诊断准确率达标。

## 许可与数据

代码仅供内部诊断辅助使用。数据库内容来自公开机床资料摘录与历史案例，专业审核未完成，不能替代现场安全确认和厂家手册。

详细安装、使用、API 和故障排查见 [使用说明.md](使用说明.md)。

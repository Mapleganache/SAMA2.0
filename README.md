# SAMA 2.0 数控机床故障诊断 Agent

基于 LangChain/LangGraph 的多路诊断 Agent：本地知识库检索 → 多方案生成 → Judge 选优。

**本仓库只放代码，不再随 Git 分发数据库。** 数据库单独打包，按下面的“数据库接入”接上即可。

---

## 一、数据库接入（最重要）

当前数据库**不是 HTTP/远程接口**，是本地 **SQLite 文件**。

以后换数据库，**不需要改代码**，只需要把数据库路径接上：

### 方式 A：放到默认位置

```
sama2.0/data/sama_full.sqlite
```

### 方式 B：环境变量指定路径

```powershell
$env:SAMA2_SQLITE_PATH='D:\SAMA\SAMA-DB-20261122\sama_full.sqlite'
```

### 方式 C：配置文件

```json
// sama2.0/sama-database.json
{
  "enabled": true,
  "dbPath": "data/sama_full.sqlite",
  "mode": "reference"
}
```

`dbPath` 可以是相对 `sama2.0/` 的路径，也可以是绝对路径。

接入层：

```
sama2.0/sama-sqlite/connection.mjs
sama2.0/sama-sqlite/library.mjs
```

> 只要数据库 schema 和 `release_meta.full_archive_version=1` 保持一致，**只接路径即可**。  
> 如果以后换成 MySQL/PostgreSQL/HTTP 数据库，才需要改这两层适配；当前版本不支持网络数据库。

---

## 二、拉取后启动

需要 Node.js **22.13 或更高版本**。

```sh
git clone https://gitee.com/maplegannache/sama2.0.git
cd sama2.0/sama2.0
npm ci
npm start
```

`npm ci` 不会还原数据库；如果没有 `database-pack`，安装会正常完成并提示跳过。

把数据库放到 `sama2.0/data/sama_full.sqlite`，或设置 `SAMA2_SQLITE_PATH` 后再启动。

浏览器打开：

```
http://127.0.0.1:3920/
```

首次使用在页面“设置”里填 API Key；也可以创建 `sama2.0/settings.json`，参考 [配置示例](sama2.0/settings.example.json)。不要提交密钥。

---

## 三、数据库包

代码仓库不包含 `sama_full.sqlite`。数据库单独提供：

```
SAMA-DB-20261122/
├─ sama_full.sqlite
├─ README.md
└─ SHA256.txt
```

把 `sama_full.sqlite` 放到 `sama2.0/data/`，或设置 `SAMA2_SQLITE_PATH`。

数据库是只读 SQLite，不随代码提交。

---

## 四、目录

```
sama2.0/
├─ server.mjs             HTTP 服务与前端静态资源
├─ graph.mjs              LangGraph 主流程
├─ stages.mjs             分类/多路/汇总
├─ retrieval-tree.mjs     检索树
├─ judge.mjs              方案选优
├─ public/                前端
├─ sama-sqlite/           SQLite 接入层
├─ scripts/               建图、数据库准备
├─ tests/                 测试
└─ data/                  数据库放这里（不随 Git）
```

---

## 五、测试

```sh
cd sama2.0
npm test
```

测试不需要真实 API Key；通过不代表诊断准确率达标。

---

## 六、说明

- 代码与数据库分离：代码仓库约几 MB，数据库约 1.5 GB；
- 没有数据库时页面可以启动，但知识库检索不可用；
- 换库后如提示词图不一致，运行：

```sh
cd sama2.0
node scripts/build-term-graph.mjs
```

- 当前默认 `reference` 模式，资料的专业审核仍待完成；历史数值不能直接当本机阈值。

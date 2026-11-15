# SAMA 资料库与知识图谱改造方案

日期：2026-11-12
对象：`E:\SAMA_机床资料整合_20261105`（E 盘整合库）与现网 `sama_v2_final`
结论：**E 盘整合库不能直接当知识库；正确做法是用 v2 管线重跑源资料，图谱只移植“带类型边”，不要换库。**

---

## 一、先说结论

| 方案 | 结论 |
|---|---|
| 直接把 E 盘库设为生产库 | ❌ 50 题库外仅 4/50、1/50 |
| 把 E 盘新资料 `reference_allowed` 全开 | ❌ 重新入库后 3/50、0/50 |
| **按 v2 管线重跑 `E:\机床数据`** | ✅ 唯一可行方向 |
| 图谱直接换成 kg_fix 版本 | ❌ 旧分支，会回退角色/IDF/域词表 |
| **移植 kg_fix 的“带类型边”到现网** | ✅ 可作为 P2 |

现网 v2 基线（50 题库外）：**原因 17/50、处置 12/50**。

---

## 二、E 盘库为什么不行

| 项 | 数值 | 问题 |
|---|---:|---|
| 片段总数 | 204,684 | — |
| `reference_allowed=1` | 66,593 | 只有旧磨床资料可检索 |
| `reference_allowed=0` | 138,091 | 新资料全部隔离 |
| 新资料片段 | 5,731 | **page 级粗切**，和 v2 的细切重复 |
| cases / alarm_codes / 参数表 | 0 | 没有病例、报警、参数实体 |
| assets | 17,755 | 只有元数据，没进检索 |

重新入库实验（放行 5,723 条 + 删 50 题原文）结果：

| 指标 | v2 | E 原库 | 重新入库 |
|---|---:|---:|---:|
| 原因 | **17/50** | 4/50 | 3/50 |
| 处置 | **12/50** | 1/50 | 0/50 |
| “无法可靠诊断” | 少 | 34/50 | 33/50 |

原因三条：

1. 新资料是**整页原文**，不是案例/报警/参数结构；
2. 同一批文档 v2 已经切成 20 万条细片段，E 库的 5,731 条是更粗的重复；
3. 50 题问的是“某案例的原因/处理”，粗页面里没有可直接引用的答案。

---

## 三、改造目标（三层）

```
数据层：细切 + 实体表 + 准入标记
   ↓
库层：v2 schema + catalog/assets 分离
   ↓
检索层：typed-edge 图谱 + 现有角色/IDF
```

---

## 四、数据层：按 v2 管线重跑，不要转存 page chunks

### 4.1 输入

- 源资料：`E:\机床数据`（88 个可用文件）；
- 参考：E 盘库的 `file_sources`/`full_assets` 只用来补**目录与资产元数据**，不导入它的 `full_fragments`。

### 4.2 处理步骤

```powershell
# 1) 正文细切（去目录页、严格标题）
python -X utf8 D:\SAMA\audit\ingest\clean_chunk_v2.py

# 2) 表格解析（DOCX + 文本层 PDF）
python -X utf8 D:\SAMA\audit\ingest\v2_tables.py
python -X utf8 D:\SAMA\audit\ingest\pdf_tables.py

# 3) 案例/报警/参数结构化
python -X utf8 D:\SAMA\audit\ingest\pilot_parse.py
python -X utf8 D:\SAMA\audit\ingest\siemens_parse.py

# 4) 合并成新库
node D:\SAMA\audit\ingest\v2_final_build.mjs
```

### 4.3 必须产出的实体

| 表 | 最低数量 | 用途 |
|---|---:|---|
| `full_fragments`（细切正文） | ≥ 200,000 | 检索底座 |
| `cases` | ≥ 800 | 案例问答 |
| `alarm_codes` | ≥ 650 | 报警号查表 |
| `param_table` | ≥ 300 | 参数查表 |
| `doc_blocks` | ≥ 1,000 | 表格块回溯 |

### 4.4 准入规则

| 数据类型 | `reference_allowed` | 说明 |
|---|---|---|
| 88 个可用文件细切正文 | 1 | 经抽样核对后放行 |
| 案例/报警/参数实体 | 1 | 结构化产物 |
| 视频/CSF/图片 | 0 | 只进 catalog，不进检索 |
| 未核对 OCR | 0 或 1（按抽样） | 先小批验证 |

**不要**把 E 库的 138,091 条隔离片段整体翻成 1；那是旧表行 + 粗页面，会稀释检索。

---

## 五、库层：v2 schema + 目录分离

1. 生产库继续用 v2 schema（`full_fragments`/`full_postings`/`cases`/`alarm_codes`/`param_table`/`doc_blocks`）；
2. 新建 `catalog_assets`（或复用 `full_assets`）存 250 个文件的来源、页码、SHA、视频/CSF 元数据；
3. `file_sources.path` 统一为 Windows 路径，便于回溯；
4. `full_corpus_stats`/`full_term_stats` 重建；
5. `PRAGMA integrity_check` 必须为 `ok`。

---

## 六、图谱层：只移植“带类型边”，不换库

### 6.1 现网问题（kg_fix 诊断正确）

- `MECHANISM` 滑动窗连边（污染—中心孔）；
- `BRIDGES.terms` 团内全连接（现象一次注射整团油品）；
- `kgNeighbors` 无序返回；
- 建图 `maxNbr=10` 单向截断；
- 双向 `includes` 子串污染。

### 6.2 移植内容

| 从 kg_fix 取 | 保留现网 |
|---|---|
| `SUGGESTS`（现象→机理） | 83 词 `LEXICON`（含刀塔/刀库/伺服） |
| `EXPERT_EDGES` | `lexiconHash` 自动重建 |
| `REL_BETA`（suggests 1.0 / expert .85 / cooccur .5 / hit .3） | 精确 DF + 角色分类 + IDF 权重 |
| `kgNeighborsWeighted` + 有序返回 | `minHops`/重复地板/ΔG 不动 |
| `cooccur` rank 归一化 | 单元测试 |

### 6.3 建图 v2

```powershell
$env:SAMA2_SQLITE_PATH='<新库路径>'
node D:\SAMA\SAMA\sama2.0\scripts\build-term-graph.mjs
```

产出要求：`version:2`、边带 `rel`、`fingerprint` + `lexiconHash`；旧 v1 图自动触发重建。

### 6.4 验收（kg-verify）

- 齿面粗糙度 → 爬行/导轨（suggests），不整团注入油品；
- 抱轴 → 静压/动静压，且排在 cooccur 前；
- 污染 不含 中心孔（或仅 cooccur）；
- 刀塔/刀库/伺服 仍在图中；
- `kgNeighborsWeighted` 前 3 名符合预期。

---

## 七、检索层（后置，不在本轮）

- `D_pack`：树返回候选池 + 分级，MMR 取 4–6 条进观察，不再倒整条 hop；
- `ExpandOneHop`：ReAct 的 `search_knowledge` 改为“回树一跳”，仅核对缺口触发；
- 监督者的 2 次检索统一走同一入口；
- 以上都需要先改树返回结构和工具注入，属于 P3。

---

## 八、实施顺序与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 用 v2 管线重跑源资料，产出新库 | 片段 ≥20 万、案例 ≥800、报警 ≥650、参数 ≥300 |
| P1 | 准入与目录分离 | `reference_allowed=1` 只含细切+实体；catalog 可查 |
| P2 | typed-edge 图谱移植 + v2 建图 | kg-verify 全过；`test-retrieval-tree` 绿 |
| P3 | 50/50 评测 | 库外原因 ≥17、处置 ≥12；库内原因 ≥46、处置 ≥42 |
| P4 | 达标才切换生产 | 备份 + 回滚开关 |

### 评测命令

```powershell
# 库内
$env:EVAL_ITEMS='D:\SAMA-data\corpus\机床数据\eval50\items.json'
$env:EVAL_PORT='3920'; $env:EVAL_OUT='...\run_in.jsonl'
node D:\SAMA\audit\ingest\eval40-run.mjs
$env:EVAL_RUN='...\run_in.jsonl'; $env:EVAL_SCORE='...\score_in.json'
node D:\SAMA\audit\ingest\eval40-score.mjs
```

---

## 九、回滚

1. 生产库备份：`data\sama_full.sqlite` → `sama_full.v2.bak`；
2. 切换只改 `SAMA2_SQLITE_PATH`，不改代码默认值；
3. 词图备份：`term-graph.json`；重建失败时回拷；
4. `lexiconHash` 不一致会自动触发重建，回滚后需手动重建一次。

---

## 十、明确不要做

- ❌ 把 E 盘整合库直接设为生产库；
- ❌ 把 138,091 条隔离片段整体 `reference_allowed=1`；
- ❌ 把 5,731 条 page 级片段直接灌进 v2（重复 + 粗粒度）；
- ❌ 用 kg_fix 的旧分支覆盖现网 `retrieval-tree.mjs`（会回退角色/IDF/域词表）；
- ❌ 在没有 v2 图谱的情况下删除旧图；
- ❌ 用“模型觉得够了”停树，或把 `(S_n−S_{n−1})_+` 当 gain。

---

## 十一、一句话

> **E 盘库是“目录”，v2 库才是“病例库”。**  
> 要提升，就把源资料按 v2 管线重跑、把图谱换成带类型边；换库和翻准入标记都解决不了问题。

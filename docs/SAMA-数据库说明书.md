# SAMA 2.0 数据库说明书

日期：2026-11-03  
分发版本：`database-pack/manifest.json` · `version=2026-10-27` · `full_archive_version=1`  
配置：`sama2.0/sama-database.json`  
配套：[Agent 结构报告书](./SAMA-Agent结构报告书.md) · [算法数学推导](./SAMA-算法数学推导.md) 第 10 节 · 旧接口摘记 `sama2.0/DATABASE.md`

本说明书描述**当前随 Git 分发的只读 SQLite 主库**：它从哪来、里面有什么表、Agent 怎样查、什么条件下故意查不到、如何更新。公式推导不在这里重复。

---

## 1. 定位

主库文件还原后为 `sama2.0/data/sama_full.sqlite`（约 1.31 GiB，SHA-256 见清单）。Git 里不存展开库，只存 16 个 gzip 分片（合计约 249 MiB）。

它同时承担两件事：

1. **核对试点**（20 条 `units`）：带人工整理的摘要、子系统、限制、出处行号。引用 id 形如 `sqlite_curated:行号`。
2. **全量原文片段**（198,953 条 `full_fragments`，其中默认参考层 66,593 条）：机器转换文本 + 倒排。引用 id 形如 `sqlite_fragment:行号`。另有历史案例关系表、旧库行。

**原 PDF、LAD、图像未打进 Git。** 库内路径是来源元数据，不能假定在另一台电脑打得开。缺图资料不能用来补造图中参数。

正式批准维修资料数：`professionalApproved = 0`。默认模式 `reference`：允许把机械原文当参考，**不允许当成已核验的本机指令**。

Agent 侧入口：

- `search_knowledge` → `library.mjs` → `sama-sqlite/library.mjs`
- `search_mtkb`（SQLite 开启时）同样读本地库，不再请求 `http://127.0.0.1:8765`

关闭 SQLite（`sama-database.json` 里 `enabled: false`）才回退 `knowledge/*.md`。

---

## 2. 还原与校验

`npm ci` 的 `postinstall` 调用 `scripts/prepare-db.mjs`。

流程：

1. 读 `database-pack/manifest.json`，确认 `format=sama-sqlite-gzip-parts-v1`。
2. 若 `data/sama_full.sqlite` 已存在且大小、SHA 与清单一致：直接复用。
3. 若已存在但指纹不同：**不覆盖**，退出。请先备份移走，或设 `SAMA2_SKIP_DB_PREPARE=1` 并用 `SAMA2_SQLITE_PATH` 指自有库。
4. 否则按 `parts[]` 顺序读分片，逐片校验 SHA，gunzip，再校验整库字节数与 SHA、压缩流整体 SHA。失败删除半成品。

手动重做：`npm run setup:db`。

发布新库（仅打包者需要 Python）：`scripts/pack-database.py 新数据库 --out 新分片目录`。不要把密钥、`settings.json`、用户日志打进包。

自有库必须是当前适配器表结构。任意 SQLite 文件不能自动兼容。打开时检查：

- `PRAGMA query_only=ON`、`trusted_schema=OFF`（只读）
- `release_meta.full_archive_version = '1'`（全量）
- 试点适配器另查 `direct_adapter_version = '1'`（与全量同文件时两套元数据都在）

---

## 3. 四种模式

配置项 `mode`，可被 `SAMA2_SQLITE_MODE` 覆盖。

| 模式 | 试点 | 全量原文 / 历史案例 | 含义 |
| --- | --- | --- | --- |
| `reference`（默认） | `experiment_allowed=1` 且来源核验状态在白名单 | `reference_allowed=1` 的片段可进 | 开发参考；专业适用性待审 |
| `reviewed` | 同上试点规则，但 `production`/`reviewed` **不返回**原文片段和未核案例 | 仅试点 | 仍不是维修专家认证 |
| `production` | 必须 `production_allowed=1` 且 `expert_status='approved'` | 不返回原文/案例 | 本分发 **0 条**，查询常为空 |
| `catalog` | 放宽设备类别，可看非磨床实例 | 来源查阅 | 不批准维修操作 |

试点来源核验白名单：`selected_fields_pdf_visual_checked`、`original_markdown_exact_checked_pdf_pending`。`expert_status='rejected'` 永不返回。

`SAMA2_SQLITE_EXCLUDE_CASES=1` 时排除 `kind=case` 及路径含「实例宝典」的片段，用于留出集类评测。

---

## 4. 规模（本分发清单 `counts`）

| 表或统计 | 数量 | 说明 |
| --- | ---: | --- |
| `units` | 20 | 核对试点 |
| `full_fragments` | 198,953 | 全部切段 |
| 其中 `reference_allowed` | 66,593 | 默认参考层 |
| `full_assets` | 17,591 | 图像/BLOB 元数据，文件未打包 |
| `case_relations` | 479 | 旧案例原表关系 |
| `legacy_rows` | 63,076 | 旧库记录 |

`assetsBundled=false`，`originalSourcesBundled=false`。

---

## 5. 表与字段（Agent 实际用到的）

下列按代码 SQL 归纳。未在查询里出现的列不臆造。

### 5.1 发布元数据

`release_meta(key, value)`  
至少含 `full_archive_version`、`direct_adapter_version`。

### 5.2 试点层

| 表 | 作用 |
| --- | --- |
| `units` | 一条试点资料。`id` 如 `C08-30`、`H3842-2`。含 `subsystem`、`kind`、`expert_status`、`experiment_allowed`、`production_allowed`、`machine_model`、`controller_model`、`source_check_status`、`limitations` |
| `retrieval_profiles` | `unit_id` → `summary`、`structure_requirement`、`search_length` |
| `evidence` / `unit_evidence` | 原文定位、`raw_text`、行号、`locator` |
| `sources` | 标题、版本、`relative_path`、`pdf_path` |
| `search_vocabulary` | 预建词表（含「代用」等） |
| `search_postings` | `term, unit_id, title_tf, body_tf` |
| `unit_links` | 例如「选油前提」：`from_id` → `to_id`，`relation`、`reason` |
| `diagnostic_paths` | 历史原因 / 处理 / 引句。`cause_kind` 如 `historical_source_assertion` |
| `parameters` | 数值参数。`allow_as_threshold=1` 才能当阈值；本分发几乎不可用 |

引用：`sqlite_curated:` + `units.rowid`（即 `citation_row`）。精确续查 `searchLibrary('sqlite_curated:12')` 会先把 rowid 还原成 `units.id` 再查。

### 5.3 全量层

| 表 | 作用 |
| --- | --- |
| `full_fragments` | `id`（`FR-` + 24 位 hex）、`title`、`token_length`、`reference_allowed`、`subsystems_json`、`machine_type`、`file_id`、`content_sha256`、`hierarchy`、`line_start/end`、`table_json`、`context_json` |
| `full_postings` | 倒排 `term, fragment_id, title_tf, body_tf` |
| `full_term_stats` | `term, document_frequency` |
| `full_corpus_stats` | `fragment_count, avg_length`（当前 66593 与约 161.90，对**参考层**） |
| `file_sources` | `path`、`title`、`version_text` |
| `content_blobs` | `sha256` → `raw_text`、`clean_text` |
| `full_assets` | 资源指纹与来源，无内嵌文件 |
| `case_relations` | `case_number`、`chapter`、`symptom`、`possible_cause`、`action`、`machine_type`、`line_*`、`missing_json` |
| `legacy_rows` | 旧结构兼容行 |

引用：`sqlite_fragment:` + `full_fragments.rowid`；案例 `sqlite_case:` + `case_relations.rowid`。内容指纹 id `FR-` 24 hex 可精确打开一条片段，仍受 `reference_allowed`、子系统、案例隔离限制。

`machine_type`：`grinder` 磨床历史；`generic` 通用；其它在非 catalog 下可能被挡。

---

## 6. 检索流水线（程序顺序）

对用户查询 $q$：

1. **领域拒绝**（`library.mjs`）：`domain` 含电路 / 电气 / PLC / LAD → 直接「没有该领域」。液压等当机械。空 domain 不拒绝。
2. **查询过长**（>8000 字）拒绝。
3. **电路专有词**（LAD、PMC、梯形图、急停、部分品牌专有）在非 catalog 下返回「原图核验未完成」，不给正文。
4. **精确引用 id** `sqlite_curated|fragment|case:数字`：按 rowid 取一条，仍过模式墙。`production`/`reviewed` 不允许用 fragment/case 绕过。
5. **明确机床型号** `磨床型号 XYZ`：库中无该型号核验文档 → 拒绝套用其它型号。FANUC/SIEMENS 不当成机床型号。
6. **确定阈值类**（油压/温度 + 「确定值/必须更换/设多少」）：没有 `allow_as_threshold` 且已批准的本机参数 → 拒绝给数。
7. **「第×章实例 n」**：走 `case_relations`。多章节重复编号必须补章节，不能默认第八章。非磨床实例非 catalog 不进参考集。
8. **试点 BM25**（见算法文档 §10.2）最多 4 条。
9. **全量 BM25** 取 40 条再焦点重排、去近重。
10. **拼盘**：试点第一（及前提关联）+ 原文补足，总上限 4，再按 3400 字符装进工具文本。装不下的 id 写在「完整性提示」里。

油雾 + 压力 + 「直接用于未知型号」类问句会多一段适用性提示：进气压力 ≠ 本机主轴供油。

格式化文本固定带标准头：`SQLite全量资料（reference，开发参考；未经维修专家复核）…`

---

## 7. 返回记录长什么样

试点块至少包括：标题、`sqlite_curated:n`、子系统、审核状态、结构适用、机床型号（常为未知）、摘要、限制、出处行号、证据 id。案例会标明「原例历史处理不可直接用于本机」。

片段块：`sqlite_fragment:n`、用途「未经专业审核的原文参考」、机床型号未知、摘录、限制、来源标题、文本行、内容指纹前 16 位。

案例块：`sqlite_case:n`、症状 / 作者原因 / 历史处理 / 缺失字段 JSON。

Agent 的出处核对只认这些完整 id 字符串出现在**该路观察**里。模型在成稿里编造 `sqlite_curated:99999` 会被拒绝。

---

## 8. 共现图（给检索树，不是给 BM25）

`sama-sqlite/term-graph.mjs` + `scripts/build-term-graph.mjs`：

- 输入：`full_postings` + 诊断词表
- 输出：`term-graph.json`（节点、PMI 边、库指纹）
- 运行时 `kgNeighbors` 与静态桥接合并

换库后执行 `npm run build:graph`。指纹对不上则扩展时不用语料边，诊断不中断。

---

## 9. 故意查不到的边界（验收时不要当成 bug）

| 查询意图 | 程序行为 |
| --- | --- |
| 领域=电路 | 领域拒绝 |
| STUDER PMC 急停 | 原图/LAD 未核验 |
| 不存在的型号 `ZXQ987654321` 的报警 | 无专属资料，不借用 |
| 「油压应该设多少 MPa 确定值」 | 无本机阈值 |
| `mode=production` 查润滑油代用 | 0 条（没有 approved） |
| 「实例 30」不写章节 | 多章节重复，要求补章节 |
| 伪造 `sqlite_fragment:1` 而观察是 `sqlite_fragment:10` | 出处核对失败 |
| 留出集已删的 4 条案例 | 跳多少跳都没有金标全文 |
| 路径含实例宝典且评测排除案例 | 不返回 |

「库里有相关段落」≠「本轮工具文本里出现了」。预算、近重抑制、模式墙都会挡住。

---

## 10. 与 Markdown 笔记的关系

`sama2.0/knowledge/*.md` 是 SQLite **关闭时**的回退。命中格式 `knowledge/文件#0-字节`。当前默认 SQLite 开启，诊断主路径不靠这些短笔记。不要把短笔记里的经验句当成全量库的审核结论。

---

## 11. 给二次开发的约束

- 只读打开。不要在诊断进程里 `INSERT`。
- 绑定参数查询，不要把用户字符串拼进 SQL。
- 新增引用前缀必须同步改 `grounding.mjs` 的正则，并加「观察没有则失败」的测试。
- 改倒排或词表后重跑 `build:graph` 与 `npm run test:db`。
- 行号 id 绑定**当前分发**。换库后 `sqlite_fragment:12129` 可能指向另一段。跨版本应同时保留清单 SHA。
- 评测诊断准确率时：冻结题目、模型、模式、是否排除案例；不要用 Judge 桩分当质量分。

---

## 12. 测试入口

| 命令 | 覆盖 |
| --- | --- |
| `npm run test:db` | 还原指纹、相对路径、工具 invoke、伪造 id、领域/型号/LAD、production 空集、LangGraph 真接线（假模型） |
| `node henry/scripts/检索评估.mjs` | 12 道开发题指定 ID（需已还原库） |
| `node test-retrieval-tree.mjs` | 真实库 C08-29/33 等跳数与正控召回 |

这些测试不计算维修答案准确率。

---

## 13. 运维检查清单

- [ ] `data/sama_full.sqlite` 大小 = `manifest.databaseBytes`（1404489728）
- [ ] SHA = `manifest.databaseSha256`
- [ ] `pragma integrity_check` 为 `ok`
- [ ] `select count(*) from units` = 20
- [ ] `full_fragments` = 198953
- [ ] 打开只读，`full_archive_version=1`
- [ ] 诊断页能搜到 `C08-30` 且观察含 `sqlite_curated:`
- [ ] 换机部署后 PDF 路径不可用是预期，不是还原失败

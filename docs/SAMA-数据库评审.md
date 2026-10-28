# SAMA 2.0 数据库评审报告

- 评审日期：2026-10-28
- 被评版本：`D:\SAMA\SAMA` 工作区（HEAD `27f82eb` + 本地未提交改动 14 个文件）
- 数据库：`sama2.0/data/sama_full.sqlite`，1,404,489,728 字节（1.34 GiB），文件时间 2026-10-27 18:51（本次评审期间未变）
- 数据库清单：`sama2.0/database-pack/manifest.json`（16 个分片，249.1 MB 压缩，格式 `sama-sqlite-gzip-parts-v1`）
- 评审方式：只读开库（`PRAGMA query_only`）、SQL 统计、检索接口黑盒调用、旧 Markdown 基线对照；不调用模型的部分全部可复现

---

## 一、总体结论

**库本身是健康的，接入方式也正确；问题在「可检索范围」和「语料配比」，不在完整性。**

| 维度 | 结论 |
|---|---|
| 完整性 | 通过：`integrity_check=ok`、外键违规 0、行数与清单完全一致、大小与 SHA 匹配 |
| 结构合理性 | 骨架合理（分层 + 关系表 + 发布元数据），但保留了 75 张 legacy 表和 6.3 万行旧数据，读起来重 |
| 数据质量 | 明显偏科：33.5% 片段可检索、90.8% 是通用机械手册、64.3% 无子系统 |
| 接入正确性 | 通过：工具名未变、引用 ID 可续查、伪造被拒、模式与领域边界生效 |
| 实测效果 | 可追溯性提升（0 → 1~6 条可解析引用），但检索精度不足，评分未体现收益 |

---

## 二、结构与完整性

### 2.1 表规模（实测行数）

| 表 | 行数 | 用途 |
|---|---|---|
| `full_fragments` | 198,953 | 全量原文片段（检索主表） |
| `content_blobs` | 213,302 | 去重后的正文 |
| `full_postings` | 4,379,477 | 词项倒排（BM25） |
| `full_term_stats` | 268,939 | 词项文档频率 |
| `case_relations` | 479 | 历史案例（原表转写） |
| `file_sources` | 154 | 来源文件 |
| `units` | 20 | 人工核对试点 |
| `parameters` | 6 | 参数条目（`allow_as_threshold=1` 为 0） |
| `legacy_rows` / `legacy_tables` | 63,076 / 75 | 旧库残留 |
| `import_issues` | 26,068 | 导入问题记录 |

### 2.2 索引

现有 6 个非隐式索引：

- `full_fragments_source (file_id, line_start)`
- `full_fragments_release (reference_allowed, domain, machine_type)`
- `full_postings_fragment (fragment_id)`
- `file_sources_hash (sha256)`
- `legacy_rows_key (database_id, table_name, record_key)`
- `search_postings_unit (unit_id)`

**没有**：`content_sha256` 上的索引（去重查询要全表扫）、FTS5 虚表（BM25 由手写 SQL 完成）。

### 2.3 完整性核对

- `PRAGMA integrity_check` → `ok`；`PRAGMA foreign_key_check` → 0 行。
- 逐表行数与 `manifest.counts` 完全一致；库文件大小与 `databaseBytes` 一致。
- `release_meta.full_archive_version = 1`，适配器启动时校验，版本不符直接拒绝打开（`sama-sqlite/library.mjs:18`）。

---

## 三、数据质量

| 指标 | 实测 | 影响 |
|---|---|---|
| 可检索片段 | 66,593 / 198,953 = **33.5%** | 三分之二的库内容检索不到 |
| 机型分布 | generic 180,720（90.8%）、grinder 12,196（6.1%）、mill_or_center 2,605、lathe 1,874、unknown 1,558 | 磨床专属语料过少，通用手册稀释结果 |
| 来源集中度 | 前六名全是《机械设计手册》第 1–6 卷（40,759 / 35,454 / 33,518 / 24,718 / 23,354 / 18,558） | 约 17.6 万条通用内容 |
| 无子系统标签 | 128,022（64.3%） | `subsystem` 过滤大面积落空 |
| 正文为空 | 3,196（1.6%） | 命中后「原文摘录」为空 |
| 内容重复 | 去重后 187,581，冗余 11,372；单条最多重复 1,371 次 | 跨文件重复仍可能挤占结果（检索期只按 `file_id|hierarchy` 去重） |
| 平均片段长度 | 92.8 token（min 1，max 17,069） | 超长片段可能撑爆预算 |
| 审核状态 | `units` 20 条全 `pending`，`production_allowed=0` | `production` 模式必然空结果 |
| 参数阈值 | `parameters` 6 条，`allow_as_threshold=1` 为 0 | 「油压/温度该设多少」永远拒绝给数（当前是正确行为，但等于该能力为空） |
| 导入问题 | `import_issues` 26,068 行 | 未消费的历史问题清单 |

---

## 四、检索与引用协议

### 4.1 检索路径

1. `library.mjs` 判断 `sama-database.json` 的 `enabled`，决定走 SQLite 还是旧 Markdown；
2. `sama-sqlite/library.mjs#searchRecords` 做领域/机型/LAD/参数/案例/片段 ID 的边界判断，再做 BM25；
3. BM25 用 `full_postings` 主键按 `term` 查找，按 `reference_allowed=1` 过滤，限制 16 条候选；
4. 渲染成带 `sqlite_curated|fragment|case:数字` 的文本，总预算 ≤ 3,400 字符（`search_mtkb` 路径 3,200）；
5. `grounding.mjs` 校验方案里的数字、ID、URL 是否真的出现在证据里。

### 4.2 边界行为（实测均符合设计）

| 场景 | 行为 |
|---|---|
| 领域非机械 | 直接回「本地知识库没有该领域的文档」 |
| 电路/LAD/急停/STUDER 等 | 回「原图/LAD 核验未完成，未进入正常维修参考」 |
| 未登记型号 | 回「尚无经核验的型号专属资料，不能借用其他型号」 |
| 问确定油压/更换温度 | 回「没有可适用的已核验阈值」 |
| 案例多章节重号 | 要求补章节，不默认第八章 |
| 伪造 `sqlite_curated:99999999` | 回「没有对应的 SQLite 证据 ID」 |
| 真实 ID 续查 | 能命中对应记录（如 `sqlite_curated:13` → H2713-5 静压轴承温升） |
| `production` 模式 | 返回 0 条（因为无 approved 记录） |

### 4.3 性能

- 单次检索首查 11–378 ms，热查 3–128 ms；查询计划显示 `full_postings` 走主键（`term`），没有全表扫描。
- 冷启动代价：`npm ci` 的 postinstall 对 1.34 GiB 做还原 + SHA-256，实测约 60–77 s。

### 4.4 精度问题（核心短板）

用「外圆磨床、磨削中、热机、主轴发热伴异响」实测，返回 4 条：

1. `sqlite_curated:13` H2713-5 静压轴承温升 —— **直接相关**
2. `sqlite_fragment:145125` 机床床身刚度设计 —— 不相关
3. `sqlite_fragment:27715` 圆度、圆柱度公差值 —— 不相关
4. `sqlite_fragment:12176` 实例34 中心孔咬毛 —— 弱相关

即命中率约 1/4。模型不得不在答案里逐条声明「不适用」，答案变长，反而被 Judge 判完整性/简洁性差。

---

## 五、接入方式评审

- **分流**：`sama2.0/library.mjs` 保留领域过滤；SQLite 开启时调用 `sama-sqlite/library.mjs`，关闭时回落旧 Markdown（`knowledge/*.md` 共 6 篇，合计不到 3 KB）。回落路径仍可用，但覆盖极窄。
- **工具契约**：`search_knowledge`、`search_mtkb` 名称与入参未变；SQLite 开启后 `search_mtkb` 不再需要 8765 服务，直接读本地库（`tools.mjs:77-85`）。
- **设备信息**：由程序填入 `facts.machine`，模型另传的 brand/domain 被忽略；未知型号不会被标成匹配。
- **失败处理**：SQLite 异常时返回「SQLite检索失败…未改查旧 Markdown，不得声称已命中」，不会静默降级成旧库。
- **配置**：`sama-database.json` 默认 `enabled=true`、`mode=reference`、相对路径 `data/sama_full.sqlite`，换启动目录不影响定位（有测试覆盖）。

结论：**接线正确，没有绕过准入、没有静默回退、引用协议闭环**。

---

## 六、实测效果（有库 vs 无库）

同题、同模型、只切换 `sama-database.json.enabled`：

| 题 | 有库引用 | 有库 Judge | 无库引用 | 无库 Judge |
|---|---|---|---|---|
| 主轴发热伴异响 | 6 条（全可解析） | 7.35 | 0 | 9.05 |
| 工件表面振纹 | 1 条 | 6.95 | 0 | 8.80 |
| 丝杠预紧后间隙超差 | 5 条 | 7.00 | 0 | 7.85 |
| **均值** | **4 条** | **7.10** | **0** | **8.57** |

- 可追溯性：0 → 1~6 条，且每条都能按 ID 续查到原文（这是数据库带来的真实收益）。
- 评分：Judge 一致低约 1.5 分。归因是「通用手册噪声 → 答案更长更谨慎 → 完整性/简洁性被扣分」，不是引用错误。
- 注意：该组 accuracy 值是在量纲修复前采集的（0.72/0.85 这类），不能横向比较，仅 Judge 分可比。

2026-10-28 复测（当前版本、交付路径）：振纹题 5 路、3 条引用、Judge 7.55、accuracy 8；密纹题 5 路、2 条引用、Judge 7.25、accuracy 8。accuracy 已回到 0–10 整数。

---

## 七、风险清单

| 级别 | 问题 | 位置 | 说明 |
|---|---|---|---|
| P0 | 可检索比例仅 33.5% | `sama-sqlite/library.mjs` 的 `f.reference_allowed=1` | 用户体感「库很大但查不到」 |
| P0 | 检索精度低（通用手册占 90.8%） | BM25 全库统一打分 | 噪声挤掉磨床资料，拖低评分 |
| P1 | 案例查询依赖查询词里的章节 | `caseLookup`（`sama-sqlite/library.mjs:30-39`） | 子 agent 自己改写查询时会丢章节，导致误报「多章节重号」并转追问 |
| P1 | 去重按 `file_id|hierarchy`，不按内容 | `sama-sqlite/library.mjs:101-103` | 跨文件重复内容仍会占位 |
| P1 | 3,196 条空正文参与检索 | 数据层 | 命中后渲染空摘录 |
| P1 | `production` 模式恒空、20 条试点全 pending | 数据/流程 | 能力等于未开放，需明确产品口径 |
| P2 | `content_sha256` 无索引 | schema | 去重/统计查询要全表扫 |
| P2 | 26,068 条 `import_issues` 未处理 | 数据层 | 导入质量不可见 |
| P2 | 75 张 legacy 表 + 6.3 万行旧数据 | schema | 增加理解成本，未见读取方 |

---

## 八、建议（按收益排序）

1. **提高可检索比例**：确认 `reference_allowed` 的判定来源；若只是「未审核」，按模式放开（`reference` 允许未审核并标注，`catalog` 全开）。
2. **按来源/机型加权**：`grinder`、`case_relations`、`units` 加分；`generic` 每份结果限 1 条；`subsystem` 命中优先。
3. **案例查询用原始问题**：`search_mtkb` 保留 `facts` 与用户原句，避免子 agent 改写后丢失章节号。
4. **按内容去重**：结果集按 `content_sha256` 去重，或加索引后预过滤。
5. **空正文前置过滤**：检索条件加 `length(clean_text) > 0`。
6. **补齐审核闭环**：把 20 条试点转 `approved`，或明确公告「本版本无已批准资料」。
7. **补索引**：`full_fragments(content_sha256)`；视查询需要评估 FTS5。
8. **数据体检进 CI**：把本次的统计固化成脚本，随分发包一起跑。

---

## 附：复现

```powershell
cd D:\SAMA\SAMA\sama2.0
# 完整性 + 行数 + 结构
D:\SAMA\_node\node.exe ..\..\audit\audit-structure.mjs
# 检索延迟与查询计划
D:\SAMA\_node\node.exe ..\..\audit\bench.mjs
# 有库/无库对照（需要 API Key）
D:\SAMA\_node\node.exe ..\..\audit\audit-ab.mjs
```

原始数据：`D:\SAMA\audit\report-structure.json`、`report-ab.json`、`report-ab2.json`、`report-after.json`。

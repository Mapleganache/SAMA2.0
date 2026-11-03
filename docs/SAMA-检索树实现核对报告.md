# SAMA 多跳检索树：实现核对报告

- 日期：2026-11-03
- 对照文档：`docs/多跳图扩展检索树落地报告.md`
- 被测代码：`D:\SAMA\SAMA` 工作区（HEAD `593551d` + 未提交改动）
- 结论版本：**公式基本实现，但多跳在真实库上不触发；报告 §7.3/§8 状态过时**

---

## 一、结论摘要

| 维度 | 结论 |
|---|---|
| §3 分温入口 | ✅ 与报告一致，测试覆盖 |
| §4 树、ΔG、beam | ✅ 公式与代码一致，测试覆盖 |
| §5 共现图、指纹 | ✅ 参数与懒重建一致 |
| §6 默认超参 | ✅ 逐项一致 |
| §7.1 已落地项 | ✅ 脚本与测试都在 |
| §7.3 / §8「尚未改代码」 | ❌ **过时**：`evidence.mjs` 已实现并接入，只是未提交 |
| §8.5「mechanism<θ 不得中选」 | ⚠️ 实现为排序优先，不是硬否决 |
| §8.2 片段分级公式 | ⚠️ 实现用 `max(子系统重叠率, 桥接命中)`，不是二值子系统相等 |
| **多跳是否生效** | ❌ **真实库上 `hopCost=0` 仍只跳 1 跳**（gain 口径问题） |

---

## 二、核对方法

1. 读报告，抽出 §3–§9 的可验证条目；
2. 对照代码：`retrieval-tree.mjs`、`term-graph.mjs`、`embed.mjs`、`config.mjs`、`stages.mjs`、`reactLoop.mjs`、`judge.mjs`、`evidence.mjs`；
3. 跑测试：`test-retrieval-tree.mjs`、`test-brief/rules/gates/guard-run/flow`、`tests/database*.mjs`、`tests/retrieval.test.mjs`；
4. 做真实库实验：同一问题在 `hopCost=0.15/0.05/0` 下的跳数、路径分与命中记录。

测试全部通过；检索树测试输出 `hopsUsed C08-29=1 C08-34=1 C08-35=1`。

---

## 三、逐条核对

| 报告条目 | 代码位置 | 核对结果 |
|---|---|---|
| §3.2 候选池 `Q0 = Core ∪ Bridge ∪ {x} ∪ MechanismSlots` | `entryCandidatePool`、`firstQueryForLane` | ✅ |
| §3.2 `prior = β·s_lex + (1−β)·rule`，`s_lex=0.35+0.65·Jaccard` | `mixPrior`、`lexicalPrior` | ✅ |
| §3.3 五路温度 `0.35/0.5/0.85/1.0/0.95` | `config.mjs:41`、`laneTemperature` | ✅ |
| §3.3 低温 `τ≤0.4` 取 argmax | `:175` | ✅ |
| §3.3 Softmax + 可复现 RNG + 碰撞重抽 3 次 | `sampleSoftmax`、`entryCollides` | ✅ |
| §3.3 MMR 备选 | `pickMmr` | ✅ |
| §4.1 种子：桥接词按“命中词长+词长”排序取前 4 | `:75-90`、`:281` | ✅ |
| §4.1 三源邻域 | `termsFromHits`、`kgNeighbors`、`corpusNeighbors` | ✅ |
| §4.1 只拒绝查询字符串全等 | `:309` | ✅ |
| §4.1 无新文档弃 | `:311` | ✅ |
| §4.1 `ΔG≤0` 不进 beam | `:316` | ✅ |
| §4.1 beam `K∈{3,5,7}`、近重复 `>0.8` 只留一条 | `clampBeamK`、`diversifyBeam` | ✅ |
| §4.2 `s=α·s_vec+(1−α)·s_lex`，`s_lex=r/(r+5)`，`r=0` 用 `0.5·s_vec` | `:199-203` | ✅ |
| §4.2 默认 `hash`，`SAMA2_EMBED=jaccard` 回退 | `embed.mjs:46-50`、`config.mjs:55` | ✅ |
| §4.3–4.4 `ΔG=γ^{n−1}(gain−λ)`、`budget=12`、`fuse=16` | `:314-316`、`config.mjs:49-50` | ✅ |
| §4.5 γ 不影响“跳不跳” | 符号取于 `gain−λ` | ✅ |
| §4.6 不写死两跳 | 测试断言 `hopsUsed>=1` | ✅ |
| §4.7 删除整句 Jaccard 过滤 | `:309` | ✅ |
| §5 PMI 建图 `minCo=2 / minPmi=1.2 / maxNbr=10` | `term-graph.mjs:42-44` | ✅ |
| §5 指纹 = `count(full_postings)` | `term-graph.mjs:93` | ✅（实测 4,379,477 与库一致） |
| §5 指纹不符告警 + 走空图 + 懒重建 | `term-graph.mjs:102-144`、`retrieval-tree.mjs:365` | ✅（重建会写仓库内 json，属副作用） |
| §6 默认超参表 | `config.mjs:41-55` | ✅ |
| §7.1 `build:graph`、规格进仓、无密钥测试 | `package.json`、`tests/retrieval.test.mjs` | ✅ |
| §7.3 / §8「尚未改代码」 | `evidence.mjs` 已存在并被 `stages.mjs:3/135`、`judge.mjs:2/177`、`reactLoop.mjs:213/290` 引用 | ❌ 报告过时（文件仍是 git 未跟踪 `??`） |
| §8.2 `s_fit` 公式 | `evidence.mjs:47` 用 `max(子系统重叠率, 桥接命中)` | ⚠️ 与报告的二值子系统相等不一致 |
| §8.5 mechanism 阈值 | `judge.mjs:195-197` 是排序优先；全组都低于阈值时仍会产出冠军 | ⚠️ 不是“不得中选” |
| §8.5 过程分不替代 Total | `judge.mjs:199` 用作 tie-break | ⚠️ 报告未写 |

---

## 四、关键实验：多跳在真实库上不触发

问题（C08-29）：

> 数控磨床，磨削中，热机，加工齿轮时齿面粗糙度始终达不到工艺要求，电气和机械多次检修都没有改善。最可能的原因是什么？

三档代价：

```
hopCost=0.15 → hops=1, G=0.544
hopCost=0.05 → hops=1, G=0.544
hopCost=0    → hops=1, G=0.544   ← 代价降到 0 仍然不跳
```

拆开看分数：

```
种子：curated:2(61.7), fragment:12129(200.2), fragment:111996(42.3)
S0 = 0.5255

+机械油 → 新文档 91977、12131            S=0.5252
+添加剂 → 新文档 curated:15、18、12165    S=0.5165
+供油   → 新文档 curated:15、18、94065    S=0.5198
```

**扩展查询确实返回了新文档，但路径分 S 反而下降**，`gain=max(S_n−S_0,0)=0`，`ΔG≤0`，候选全部被 `:316` 拒掉。

原因在 `S` 的定义：

```
S = α·cos(问题, 路径文本) + (1−α)·r/(r+5)
```

- 路径文本随扩展变长 → 余弦被稀释；
- 查询变长后 BM25 最高分 `r` 也会降；
- 两个分量同时下降，扩展越充分分越低。

所以**公式实现是对的，但 gain 的口径与“多跳扩展”目标相反**：真实语料上树退化为 1 跳。

---

## 五、是否满足要求

- **按报告公式逐条实现**：基本满足（§3–§6）。
- **“多跳图扩展检索树”在真实数据上生效**：不满足。`hopCost=0` 仍停 1 跳。
- **报告准确性**：§7.3/§8 的状态描述已过时；§8.5 的“硬否决”与实现不符。

---

## 六、修复建议（按优先级）

1. **改 gain 口径（最关键）**
   现在：
   ```js
   const S_n = scorePathSet(x, T2, docs2, alpha, vec)
   const gain = Math.max(S_n - π.S, 0)
   ```
   建议改为“新文档相对问题的最佳相关度”，不再把整条路径拼进余弦：
   ```js
   const docScore = Math.max(...newDocs.map((d) => scorePathSet(x, [], [d], 1, vec)))
   const gain = Math.max(docScore - π.S, 0)   // 或 S_n = Math.max(π.S, docScore)
   ```
   或者把 `s_vec` 改成“对路径内每篇文档取 max 后再平均”，避免长文本稀释。
2. **mechanism 阈值写成硬否决**（或把报告改成“排序优先”）：两处必须一致。
3. **提交 `evidence.mjs` 并更新报告 §7.3/§8**：状态改为“已实现、待提交”；§8.2 补上 `max(重叠率, 桥接命中)` 的实际公式。
4. **测试补真实库跳转用例**：现在的“高代价停 1 跳 / 代价 0 允许跳”用的是合成 store（分数能涨）；要加一条真实库用例：`λ=0` 时，若新文档命中桥接词，`hopsUsed` 必须 ≥2。

---

## 七、验收标准（建议写进下轮任务）

| 项 | 标准 |
|---|---|
| 真实库跳数 | C08-29 在 `hopCost=0` 时 `hopsUsed≥2`，且第二跳有 `newDocs` |
| 代价单调性 | `hopCost=0.15` 时允许停在 1；`0` 时不得仍为 1 |
| 分数口径 | 扩展后 `S_n` 不因路径变长而系统性下降（用新文档最佳分验证） |
| 报告一致性 | §7.3/§8 状态、§8.2 公式、§8.5 机制阈值与代码一致 |
| 回归 | 六套测试 + `tests/retrieval.test.mjs` 全绿 |

## 八、复现

```powershell
cd D:\SAMA\SAMA\sama2.0
D:\SAMA\_node\node.exe test-retrieval-tree.mjs
D:\SAMA\_node\node.exe --test tests/database.test.mjs tests/database-flow.test.mjs tests/retrieval.test.mjs
# 跳数与分数实验
D:\SAMA\_node\node.exe D:\SAMA\audit\hop-cost-test.mjs
D:\SAMA\_node\node.exe D:\SAMA\audit\hop-gain-test.mjs
```

# SAMA Agent 与 Judge 代码审查报告

日期：2026-11-14  
范围：`sama2.0` 当前主代码（未提交）  
目的：在参数调优收益见顶后，检查 Agent/Judge 层还有哪些结构性改动值得做。

---

## 一、摘要

当前问题不是“参数不够好”，而是：

1. **Agent 已经产出结构化证据 `direction.support_obs`，Judge 却没用**；
2. **Judge 的 `coverage` 会膨胀**，一条泛化 SUPPORT 就能进 AMBIG；
3. **`precise` 是全局判定**，证据包里任意实体就放行所有方案；
4. **WEAK 状态下准确性仍有 80% 来自 LLM 作文分**；
5. **判分失败的 fallback 用中性 5 分参与排名**，污染评测。

实测佐证：

- `entryMode=mmr` 50 题：主选原因 17→17（净胜 0），但“任一方案”原因 18→22（+4）；
- 说明**候选覆盖变好，但主选没转化**——瓶颈在证据→选优，不在检索。

---

## 二、Agent 侧审查

### A1. `direction.support_obs` 已产出，但 Judge 没用

位置：`prompts.mjs:53`

```json
"direction":{"main_direction":"...","support_obs":["sqlite_或obsId"],...}
```

问题：

- `scorer.planCitations()` 只从 `plan.plan` 正文正则抓 id；
- 正文没写 id、但 `support_obs` 有 → 判成“无引用”；
- 正文写了错误 id → 照样算引用；
- 无法做 claim 级校验。

建议：

```js
const cites = [
  ...(plan.direction?.support_obs || []),
  ...planCitations(plan),
]
```

并优先信任 `support_obs`，正文只做补充。

优先级：**P0**

---

### A2. 最终 JSON 没有 `claims`

现状：只有 `final` 整段 Markdown，Judge 只能整段猜。

建议在收束 JSON 增加：

```json
"claims":[
  {"text":"...","evidenceIds":["CASE-003"]}
]
```

Judge 用 claim 级支持率替代整段正则。

优先级：**P1**

---

### A3. `mustFinish` 只看步数/工具数，不看证据质量

位置：`reactLoop.mjs:178-179`

```js
const stepCap = lane.stepCount >= ctx.maxStep
const mustFinish = stepCap || executed >= ctx.toolLimit
```

问题：到上限就强制收束，即使没有 SUPPORT/NEAR。

建议增加第三种收束：

```
reason = 'insufficient_evidence'
只交付待测项，不生成维修步骤
```

优先级：**P2**

---

### A4. `toolLimit` 是混合计数，检索容易被挤掉

位置：`config.mjs`、`reactLoop.mjs`

`lookup_alarm`、`ask_user`、`record_measurement` 与 `search_knowledge` 共用 4 次预算。

建议拆分：

```
retrievalBudget：search / expand
lookupBudget：alarm / case / param
interactionBudget：ask_user
```

优先级：**P2**

---

### A5. 复杂路仍可用 `ask_user`

工具列表包含 `ask_user`，与“直接回答，不要向我提问”冲突。

建议：复杂路由禁用 `ask_user`，只在简单/缺字段场景保留。

优先级：**P2**

---

### A6. 观察截断可能丢关键证据

- `obsPrefix=200`
- Judge 只取最后 3 条观察，每条 500 字
- 方案正文截 2600 字

长方案/多跳时，前面的关键参数可能被截掉。

建议：

- Judge 输入改为“证据包摘要 + claims”，不再塞完整观察；
- 保留所有引用 id 对应的原文片段。

优先级：**P1**

---

### A7. 监督者只检查，不回写

`superviseMid` 在成稿后查缺字段，但不会把缺口重新注入检索。

建议：缺字段时触发一次 `expand_tree`，再收束；仍缺才标 `need_info`。

优先级：**P2**

---

## 三、Judge 侧审查

### J1. `coverage` 膨胀（最严重）

位置：`scorer.mjs:59-63`

```js
const supportRatio = supportInPack ? supportCited / supportInPack : 0
const coverage = Math.max(packCoverage, supportRatio)
```

只要引用 1 条 SUPPORT，`supportRatio=1`，`coverage=1`，直接进 AMBIG。

建议：

```js
const coverage = 0.7 * packCoverage + 0.3 * supportRatio
```

或直接只用 `packCoverage`。

优先级：**P0**

---

### J2. `precise` 是全局，不是“本方案”

位置：`judge.mjs:85`

```js
const precise = packHasEntity(index)
```

证据包里任意方案有实体，所有方案都能走覆盖排序。

建议：

```js
const precise = feature.tier === 3
```

优先级：**P0**

---

### J3. WEAK 下准确性仍主要是 LLM 作文分

位置：`scorer.mjs:11-15, 100`

```
WEAK: e=0.2, a=0.8
```

库外基本全 WEAK，等于 80% 还是 LLM 分。

建议：

- WEAK：`a=0.1`，或直接 `accuracy=E`；
- 只保留 safety/feasibility 由 LLM 打。

优先级：**P1**

---

### J4. fallback 用中性 5 分参与排名

位置：`judge.mjs:90-104`

```js
scores: { accuracy:5, safety:5, ... }
```

判分失败时生成一排 5 分方案，还会被 eval 当正常 top1。

建议：

- `unscored: true`；
- 排名排除；
- 评测单独统计，不混入准确率。

优先级：**P1**

---

### J5. 阈值全是硬编码

```
TAU_COVERAGE = 0.30
TAU_EVIDENCE = 7
mechanism >= 5
融合权重 0.7/0.5/0.2
```

没有校准。

建议用 50 题做单阈值扫描，每次只动一个，净胜 ≥3 才改。

优先级：**P1**

---

### J6. 机制门 `mechanism < 5` 可能误杀

正确方案机制分 4 会被直接排除。

建议先统计 50 题里被 veto 的方案，确认误杀率，再决定是否降到 4。

优先级：**P1**

---

### J7. Judge 输入截断

`judgeUser`：方案 2600 字、观察 3×500 字。  
关键参数（如 `0018#`、`024#`）可能被截掉。

建议改为“claims + 证据包”，而不是完整观察。

优先级：**P1**

---

## 四、优先级汇总

| 优先级 | 改动 | 预期 |
|---|---|---|
| **P0** | Judge 用 `direction.support_obs` 做引用 | 消除“正文没写 id”误判 |
| **P0** | `precise` 改为 per-plan | 防止全局实体放行 |
| **P0** | `coverage` 去掉 `max(supportRatio)` | 防止 1 条 SUPPORT 就 AMBIG |
| **P1** | 加 `claims[].evidenceIds` | claim 级支持率 |
| **P1** | fallback 标 unscored | 评测不再被污染 |
| **P1** | WEAK 降 LLM 准确性权重 | 库外不靠作文分 |
| **P1** | 阈值校准、机制门统计 | 减少误杀 |
| **P2** | 拆分工具预算 | 检索不被挤掉 |
| **P2** | `insufficient_evidence` 收束 | 减少无证据硬写 |
| **P2** | 监督者缺口回写 | 成稿前补检 |

---

## 五、建议的验收方式

| 改动 | 验收 |
|---|---|
| P0 三项 | 20 题冒烟 + 50 题配对，主选原因净胜 ≥3 |
| claims | 引用覆盖率提升，幻觉引用下降 |
| fallback | 无排名题数下降，且不计入准确率 |
| 机制门 | 被 veto 的正确方案数 ≤1/50 |
| 工具预算 | 检索调用次数不下降 |

---

## 六、与参数调优的关系

已确认：

- 树参数（λ、hopFuse、entryMode 等）在 50 题上没有稳定主选收益；
- `entryMode=mmr` 只提升“任一方案”覆盖（+4），主选不变；
- 因此下一步收益更可能来自 **证据→选优**，而不是继续调树。

---

## 七、一句话

> **Agent 有结构化证据，Judge 还在正则扫正文；`coverage` 和 `precise` 又过松，导致“引用一条泛化 SUPPORT”就能左右冠军。**  
> 先做 P0 三项，再谈阈值和权重。

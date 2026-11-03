# Cursor 任务书：检索树增益口径 + 报告一致性

- 仓库：`D:\SAMA\SAMA`，分支 `Riley`
- 依据：`docs/SAMA-检索树实现核对报告.md`
- 目标：让两跳在真实库上真的会触发；把实现、报告、验收三处口径对齐

---

## 背景（一句话）

机制已实现，但真实库上 `hopCost=0` 仍只跳 1 跳。根因是路径分 `S` 随扩展文本变长而下降，`gain` 恒为 0。

实测：

```
hopCost=0.15 / 0.05 / 0 → 全部 hopsUsed=1, G=0.544
S0=0.5255；+机械油 S=0.5252；+添加剂 S=0.5165
```

扩展查询确实返回了新文档（91977、12131、curated:15…），但分数不升反降。

---

## P0-1 改 gain 口径（让扩展有机会被采纳）

文件：`sama2.0/retrieval-tree.mjs`，候选循环里（当前 `:313-316`）：

```js
// 现在
const S_n = scorePathSet(x, T2, docs2, alpha, vec)
const gain = Math.max(S_n - π.S, 0)
const delta = γ ** (n - 1) * (gain - λ)
```

改成“新文档相对问题的最佳相关度”，不再把整条路径拼进余弦：

```js
const docScore = newDocs.reduce((best, doc) => {
  const s = scorePathSet(x, [], [doc], 1, vec)   // 只看单篇文档与问题的匹配
  return Math.max(best, s)
}, 0)
const S_n = Math.max(π.S, docScore)
const gain = Math.max(S_n - π.S, 0)
const delta = γ ** (n - 1) * (gain - λ)
```

要求：

- `π.S` 仍随路径单调不减（`Math.max` 保证）；
- `scorePathSet` 的 `alpha=1` 表示只取向量分，不参与 lex 混合；
- 不要改 `ΔG` 公式、不要改预算/保险丝语义。

### 验收

- C08-29 整句、`hopCost=0` → `hopsUsed >= 2`，第二跳 `records.length > 0`；
- 同题 `hopCost=0.15` 允许停在 1（不强制跳）；
- 第二跳路径里应出现 `机械油 / 添加剂 / 供油` 这类机理词。

---

## P0-2 mechanism 阈值：硬否决或改报告，二选一

现状：`judge.mjs:195-197` 只把 `mechanism >= MECHANISM_THETA(5)` 作为排序优先；当五路全低于 5 时仍产生冠军。

报告 §8.5 写的是「mechanism<θ 则不得中选」。

推荐按报告改硬否决：

```js
function rankByDirectionalFit(ranked) {
  const eligible = ranked.filter((row) => (row.layers?.mechanism ?? 0) >= MECHANISM_THETA)
  const pool = eligible.length ? eligible : ranked   // 全不达标时保留保底，但要在 note 里写明
  ...
}
```

并在 `judgePlans` 的 `note` 里追加 `全组机制分低于阈值，按总分保底` 的说明。

若决定保留“排序优先”，则必须把报告 §8.5 改成“优先”并说明理由。

### 验收

- 构造一组 `mechanism=4`、总分为最高 的方案，确认不会被选中（除非全组都不达标）；
- `judge` 日志里能看到 `mechanismGated` 或等价标记。

---

## P1-1 提交 `evidence.mjs` 并更新报告

- `sama2.0/evidence.mjs` 目前是 git 未跟踪（`??`），但 `stages.mjs:3/135`、`judge.mjs:2/177`、`reactLoop.mjs:213/290` 已经在 import 它——**这是一个隐形的未提交依赖**，必须提交。
- 更新 `docs/多跳图扩展检索树落地报告.md`：
  - §7.3、§8 的“尚未改代码”改成“已实现（`evidence.mjs`），待提交”；
  - §8.2 的公式补上实际实现：`aligned = max(子系统重叠率, 桥接命中)`；
  - §8.5 的 mechanism 处理与最终实现保持一致（硬否决或排序优先）。

### 验收

- `git status` 里不再有 `?? sama2.0/evidence.mjs`；
- 报告中的三条状态与代码一致。

---

## P1-2 补一条真实库跳转测试

`test-retrieval-tree.mjs` 现在的“高代价停 1 跳 / 代价 0 允许跳”用的是合成 store，分数能涨，测不出真实库的稀释问题。

新增：

```js
const q = '数控磨床，磨削中，热机，加工齿轮时齿面粗糙度始终达不到工艺要求…'
const t0 = await runSqliteTree({ origin: q, firstQuery: q, hopCost: 0 })
assert.ok(t0.hopsUsed >= 2, `真实库 λ=0 应至少两跳，实际 ${t0.hopsUsed}`)
assert.ok(t0.hops[1]?.records?.length > 0)
```

### 验收

- 该用例在旧实现上失败、在新实现上通过；
- `npm test` 全绿。

---

## P2 `s_fit` 公式对齐

`evidence.mjs:47` 的实现是：

```js
const aligned = Math.max(overlap, bridgeHit)
```

报告 §8.2 写的是二值 `1[子系统相等]`。两者不必相同，但必须写清楚：

- 若保留现实现：在报告 §8.2 补公式与理由（桥接词是同义扩展，比严格子系统相等更宽松）；
- 若要严格对齐：改代码并在测试里固定 `τ+/τ-` 的判分样例。

---

## 不要做的事

- 不要为了“让跳数变大”而降低 `grounding` 或删引用核对；
- 不要把 `hopCost` 默认值改成 0 来掩盖 gain 口径问题；
- 不要改留出集（4 条案例已删，跳多少跳都查不到，验证跳数请用仍在库里的 C08-33/C08-29）。

## 复现命令

```powershell
cd D:\SAMA\SAMA\sama2.0
D:\SAMA\_node\node.exe D:\SAMA\audit\hop-cost-test.mjs
D:\SAMA\_node\node.exe D:\SAMA\audit\hop-gain-test.mjs
D:\SAMA\_node\node.exe test-retrieval-tree.mjs
D:\SAMA\_node\node.exe --test tests/database.test.mjs tests/database-flow.test.mjs tests/retrieval.test.mjs
```

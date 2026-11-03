# Cursor 任务书：让检索树的两跳真正生效 + 修回归

- 仓库：`D:\SAMA\SAMA`，分支 `Riley`
- 涉及文件：`sama2.0/retrieval-tree.mjs`、`sama2.0/reactLoop.mjs`、`sama2.0/sama-sqlite/term-graph.mjs`、`sama2.0/scripts/build-term-graph.mjs`、`sama2.0/tests/database-flow.test.mjs`
- 背景：80/20 留出集测试（4 条案例）中，8 题全部 `hopsUsed = 1`，两跳从未发生；同时 `database-flow` 有一条测试回归。

---

## 一、现状证据（修之前先复现）

1. 中文整句入口，检索树只跳 1 跳：

```
C08-29 => hopsUsed=1, path=[原句]
C08-34 => hopsUsed=1
C08-35 => hopsUsed=1
```

2. 原因：`retrieval-tree.mjs:302` 的去重判据

```js
if (jaccard(q2, π.lastQuery) >= 0.85) continue
```

实测 `jaccard(原句, 原句+" 爬行") = 0.978`，因为 `splitTerms`（`:531`）按空格切词，中文整句被当成**一个 term**，追加一个词后整串仍高度相似 → 所有候选被过滤 → `cands` 为空 → 直接 break。

3. 只删这条判据还不够：第二跳查询仍是“整句 + 一个词”，BM25 返回的还是原来三条，被 `excludeIds` 去重后 `records=0`。

4. 桥接词顺序错误：`bridgeTerms` 按 BRIDGES 行顺序取词。C08-34 先命中“烧伤”（粗糙行），得到

```
['爬行','导轨','润滑','油品', '润滑脂','皂液','中心孔']
```

`slice(0,3)` 取到 `爬行/导轨/润滑`，而正确答案那一组 `润滑脂/皂液/中心孔` 被挤掉。

5. 回归：`tests/database-flow.test.mjs:32` 失败，`expected 'complex' actual 'no_plan'`。原因是 `reactLoop.mjs:75` 注入的树文本

```
observation: `${lane.id}-tree\n${options.treeSearch.text}`
```

没有 `formatSearch` 那句标准头「SQLite全量资料（reference，开发参考；未经维修专家复核）…缺失不得补造」，桩模型断言失败 → 五路全挂。

---

## 二、改动清单（按顺序）

### P0-1 删除整串 Jaccard 过滤

`retrieval-tree.mjs:302`

```js
// 前
if (jaccard(q2, π.lastQuery) >= 0.85) continue

// 后
if (q2 === π.lastQuery) continue
```

term 唯一性已由 `:298` 的 `!π.terms.includes(c)` 保证，不需要再做整串相似度过滤。

### P0-2 种子词改用桥接词

`retrieval-tree.mjs:274`

```js
// 前
const seedTerms = splitTerms(t0)

// 后
const bridge = bridgeTerms(t0)
const seedTerms = bridge.length ? bridge.slice(0, 4) : splitTerms(t0)
```

同时把 `splitTerms`（`:531`）改成按标点切：

```js
function splitTerms(query) {
  return String(query || '')
    .split(/[\s，,。；;！!？?\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
```

### P0-3 桥接词按“具体程度”排序

`retrieval-tree.mjs:75` 整体替换：

```js
export function bridgeTerms(query) {
  const text = String(query || '')
  const scored = new Map()
  for (const row of BRIDGES) {
    const hit = text.match(row.re)
    if (!hit) continue
    for (const term of row.terms) {
      const score = hit[0].length + term.length
      scored.set(term, Math.max(scored.get(term) || 0, score))
    }
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term)
}
```

### P1-1 树文本补标准头（修回归）

`retrieval-tree.mjs` 的 `formatTree` 第一行前加：

```js
const HEADER = 'SQLite全量资料（reference，开发参考；未经维修专家复核）。资料中的条件、历史处理和数值均不是本机结论；缺失不得补造。'
```

把 `HEADER` 拼到返回文本最前面（保持后面 `本路检索树（…）` 结构不变）。

### P1-2 图谱与库绑定

`term-graph.mjs`：

- `buildTermGraph` 产物加字段 `fingerprint`：用 `select count(*) from full_postings` 或 `full_fragments` 的 `count(*)`（二者择一，写进图里）；
- `loadTermGraph` 增加可选参数 `expectedFingerprint`；不匹配时返回 `emptyGraph()` 并 `console.warn('term-graph 与当前库不一致，请重建')`；
- `scripts/build-term-graph.mjs` 输出 fingerprint；
- `package.json` 的 `postinstall` 追加 `node scripts/build-term-graph.mjs`（或在 `prepare-db.mjs` 末尾调用），保证换库后图跟着重建。

注意：重建要读 `full_postings`，耗时需实测；若超过 5 s，改为“指纹不符时在首次检索前懒重建”，不要阻塞 `npm ci`。

---

## 三、必须新增的测试

`test-retrieval-tree.mjs`：

1. 中文整句入口必须跳两跳：

```js
const tree = await runSqliteTree({ origin: q, firstQuery: q, beamK: 3, topK: 3 })
assert.ok(tree.hopsUsed >= 2)
```

2. 桥接词顺序：

```js
const words = bridgeTerms('外圆磨床死顶尖中心孔咬毛、顶尖烧伤')
assert.ok(['润滑脂', '中心孔', '皂液'].includes(words[0]))
```

3. 正控召回（C08-33 仍在库里）：

```js
const q = '大型数控曲轴磨床，JOG 移动工作台时导轨运行滞涩、运动沉重，工作台自重 5 吨以上'
const tree = await runSqliteTree({ origin: q, firstQuery: q })
assert.ok(tree.records.some((r) => r.id === 'sqlite_curated:6'))
```

`tests/database-flow.test.mjs`：保留现有断言，另加一条“树路径也必须含标准头”，防止 P1-1 回退。

---

## 四、验收标准

| 项 | 标准 |
|---|---|
| 跳数 | 三道留出题（C08-29/34/35）`hopsUsed >= 2` |
| 第二跳有效 | 第二跳 `records.length > 0`，且不全被 `excludeIds` 去重 |
| 桥接词 | C08-34 首词属于 `润滑脂/中心孔/皂液` |
| 正控 | C08-33 症状查询召回 `sqlite_curated:6` |
| 回归 | `node --test tests/database-flow.test.mjs` 通过，全套测试全绿 |
| 图谱 | 换库后 `term-graph.fingerprint` 与库不一致时能自动重建/告警 |

预期改动前后对比（实测数据）：

| 版本 | 跳数 | 第二跳新记录 | 路径示例 |
|---|---|---|---|
| 现状 | 1 | 0 | 仅原句 |
| 只删 Jaccard | 2 | 0 | 原句 → 爬行 |
| 删 Jaccard + 桥接种子 | 2 | 3 | 爬行 → 导轨 → 润滑 → 润滑剂选择… |

---

## 五、不要做的事

- 不要放宽 `grounding` 或删掉引用核对来“让答案通过”；
- 不要把留出集测试的结论（0 全中）当成算法失败——那 4 条记录已被从库里删除，跳多少跳都查不到；验证两跳请用仍在库里的案例（如 C08-33）；
- 不要提交 `data/`、`audit/`、`term-graph.full.bak`；
- 改完请把“改动文件 + 测试输出 + 三题 hopsUsed”一起贴出来。

## 六、复现命令

```powershell
cd D:\SAMA\SAMA\sama2.0
D:\SAMA\_node\node.exe test-retrieval-tree.mjs
D:\SAMA\_node\node.exe --test tests/database-flow.test.mjs tests/retrieval.test.mjs
# 两跳诊断（留出库）
$env:SAMA2_SQLITE_PATH='D:\SAMA\audit\holdout\sama_holdout.sqlite'
D:\SAMA\_node\node.exe D:\SAMA\audit\tree-diag.mjs
```

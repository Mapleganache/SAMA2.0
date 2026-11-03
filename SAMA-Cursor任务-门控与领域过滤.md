# 给 Cursor 的任务：修两个会让 SAMA「不回答」的问题

- 仓库：`D:\SAMA\SAMA`，分支 `Riley`，HEAD `593551d`
- 测试命令（改动后必须全绿）：

```powershell
cd D:\SAMA\SAMA\sama2.0
D:\SAMA\_node\node.exe test-brief.mjs
D:\SAMA\_node\node.exe --test tests/database.test.mjs tests/database-flow.test.mjs
D:\SAMA\_node\node.exe test-rules.mjs; D:\SAMA\_node\node.exe test-gates.mjs
D:\SAMA\_node\node.exe test-guard-run.mjs; D:\SAMA\_node\node.exe test-flow.mjs
```

---

## 问题一：`domain` 误杀，导致检索被自己关掉

### 现象

问「液压油乳化起泡、换油周期缩短」，SAMA 回答里写「本地知识库无匹配资料」，然后按通用液压逻辑编了一份方案——**没有引到库里的 C08-31，也没写出 6411 添加剂、N32 汽轮机油**。

### 复现

```js
searchLibrary('液压油乳化起泡 换油周期缩短')                 // → [1] C08-31 ✅
searchLibrary('液压油乳化起泡 换油周期缩短', { domain: '液压' }) // → 「本地知识库没有该领域的文档。」❌
```

### 根因

`library.mjs:8-9`：

```js
const area = String(domain || '').trim()
if (area && area !== '机械') return '本地知识库没有该领域的文档。'
```

- 精确字符串比较，任何不是「机械」的值（液压/润滑/主轴/进给/冷却）都被拒；
- 这段守卫来自 `108226b`（2026-10-19，只有 Markdown 机械笔记时写的），
  10-27 接 SQLite（`bf0f99e`）后，守卫仍排在数据库判断**之前**，SQLite 分支永远轮不到；
- `tools.mjs:24` 的 schema 是自由文本 `domain: text`，描述只写「非机械就说明没有该领域」，
  模型看到液压题自然会填 `domain: "液压"`。

### 影响

所有子系统明确的题都可能自断检索：液压、润滑、主轴、进给、冷却。
C08-31 的答案缺关键内容、C29 首次「无匹配」、都可能与此有关。

### 修法（推荐 B）

A. 最小改动：把守卫改成「只在明确非机械领域（电路/电气/PLC/LAD）时拒绝」。
B. **白名单归一化（推荐）**：`机械/液压/润滑/主轴/进给/冷却/机床` 全部归一为「机械」；未知值**忽略而非拒绝**；只是电路类交给 `searchRecords` 里已有的 LAD 守卫。
C. 从 `search_knowledge` 的 schema 删掉 `domain`，只留 `subsystem`。
D. 顺手在 `sub_step` 日志里记 `args` 摘要（至少 domain/subsystem/query 前 50 字），`reactLoop.mjs:168` 现在只记 tool 名。

### 验收

- 上面那条复现命令，`domain: '液压'` 必须返回 C08-31；
- 问 C08-31 的题，答案里出现 `sqlite_curated:*` 引用，且包含「6411 / 抗水性」或「N32 汽轮机油」中至少一项；
- 电路/LAD 题仍然拒绝（现有 `database.test.mjs` 有覆盖）。

---

## 问题二：缺一项条件就整轮追问，回答直接终止（还会循环）

### 现象

问题里没写「空载还是磨削」「冷机还是热机」，SAMA 只回一句「请写出至少一个现象 / 还有什么工况」，**不产出任何方案**。
第二组 5 题里有 4 题是这样被挡住的；混合 50 条测试里有 26 条（52%）没进答题环节。

更糟的是：用户回一句「不知道」，`composeSessionQuery` 会把回复拼进 query，缺的字段仍然缺，
于是**再问一遍同样的问题**——来回追问，永远不进入采样。

### 复现

- 题：`数控磨床，磨削中，热机，液压油变质、乳化、起泡……`（原样，不含「压力」词）→ `need_info`，4 ms 返回；
- 题：`关于「静压轴承温升过高」，在磨床维修中应该怎么理解和应用？` → 同样 `need_info`（知识题被当故障题）；
- 回「不知道」→ 仍是同样的追问。

### 根因

`graph.mjs:51`：

```js
if (gap.missing.length && (config.forceMultiAgent || hard?.level === 'complex' || !hard)) {
  return { ...base, complexity, next: 'need_info', need: {...} }
}
```

- `gaps.mjs:76` 的 `missingFields` 要求四项全齐：`machine / phenomenon / load / thermal`；
- 缺任意一项 → `need_info`；`need_info` 是**终点节点**（`graph.mjs:283` 直连 END），没有兜底；
- 缺了「工况/冷热」这种**可以用假设处理**的字段，也照样拦；
- 知识型问题（怎么理解/原理/适用边界）不在 `complexity.isConcept` 的识别范围，落进故障门控；
- `composeSessionQuery`（`gaps.mjs:113`）只是拼接文本，不记录“已经问过什么”，所以会重复追问。

### 修法（推荐分级软门控）

**核心原则：只有“完全没法下手”时才问；能用假设处理的，先答再列待确认。**

1. **知识题分流**（`complexity.mjs`）
   扩展现有 `isConcept`：命中「怎么理解 / 是什么 / 为什么 / 原理 / 区别 / 注意事项 / 适用边界 / 怎么选」且**不含**「怎么办 / 怎么修 / 排查 / 处理 / 维修」→ 判为 `simple`。
   这类题直接走 `answerSimple`（它本来就会查库），不进四要素门控。

2. **门控分级**（`gaps.mjs` 新增 `gateDecision`，`graph.mjs` 调用）

```js
// gaps.mjs
export function gateDecision(query, { mode = 'soft' } = {}) {
  const { fields, missing } = missingFields(query)
  if (isKnowledgeQuery(query)) return { action: 'answer', assumptions: [] }
  const hardMissing = missing.filter((k) => k === 'machine' || k === 'phenomenon')
  if (missing.length === 0) return { action: 'sample', assumptions: [] }
  if (hardMissing.length === 2) {              // 既没机型也没现象：确实没法答
    return { action: 'ask', questions: questionsFor(query).questions }
  }
  if (mode === 'hard') return { action: 'ask', questions: questionsFor(query).questions }
  const assumptions = []
  if (missing.includes('load')) assumptions.push('未提供工况，按「磨削中」假设')
  if (missing.includes('thermal')) assumptions.push('未提供冷热态，按「热机」假设')
  if (missing.includes('machine')) assumptions.push('机型未知，不套用其他型号的参数')
  return { action: 'sample', assumptions, pending: questionsFor(query).questions }
}
```

3. **结果里带假设和待确认**

   `pack()` 增字段：`assumptions: string[]`、`pendingQuestions: string[]`；
   答案头部加一行：`（按假设作答：未提供工况，按磨削中处理；未提供冷热态，按热机处理）`；
   末尾仍附「### 待确认问题」，但**不阻断交付**。

4. **防循环**

   `session` 里记录已问字段；同一字段问过 **2 次**后强制转软门控（`assumptions` 兜底），
   避免「回复不知道 → 再问一遍」的死循环。

5. **可配置**

   `config.mjs` 增加 `gateMode`：`SAMA2_GATE=soft|hard`，默认 `soft`；`server.mjs` 接受 `body.gateMode`。
   保留 `hard` 给“必须四要素齐全才能答”的严格场景。

### 验收（必须新增测试）

| 用例 | 期望 |
|---|---|
| `液压油乳化、起泡，换油周期缩短`（无工况/冷热） | 交付方案 + `assumptions` 两条 + 待确认问题，不再 `need_info` |
| `关于「静压轴承温升过高」怎么理解` | 走 simple，直接答，不追问 |
| `磨床有问题`（无机型、无现象） | 仍然追问（这条是唯一允许硬拦的） |
| 连续两次回「不知道」 | 第二次后转假设作答，不再重复同一问题 |
| `SAMA2_GATE=hard` | 行为回退到当前版本 |
| 现有 6 套测试 | 全绿（`test-flow.mjs` 里「有一路提问时不交付」的断言要区分：那是指采样后，不是入口门控） |

### 风险

- 放宽后，通用答案会变多。用 `assumptions` + 答案头标注来控制，不要静默假设；
- `machine` 缺失但 `phenomenon` 存在时走假设，要明确写「机型未知，不套用其他型号参数」，避免越界；
- 不要放宽到「四项全缺也答」——那只会产出废话。

---

## 建议实施顺序

1. 先修 `domain`（一行 + 归一化），跑 10 题验证检索能否引到 C08-31；
2. 再加 `gateDecision` + 知识题分流，跑同一批题看交付率；
3. 最后补 `assumptions/pendingQuestions` 的展示与防循环；
4. 每步跑第 0 节全部测试，并对比「交付率 / 引用命中 / 原因命中」三项指标。

## 附：现有证据文件

- `D:\SAMA\audit\mixed-run.jsonl`、`mixed-result.json`：50 条混合测试记录（26 条未答、15 条部分命中）
- `D:\SAMA\audit\check-c0831.mjs`：domain 误杀复现脚本
- `docs/SAMA-案例测试报告.md`、`docs/SAMA-案例测试明细.md`：完整数据与逐条明细

# SAMA minHops / maxStep / topK 网格测试报告

日期：2026-11-13  
样本：库外 20 题 × 8 组 = 160 题  
目的：在上一轮最优组合基础上，回退 minHops、maxStep、topK，验证能否恢复到基线水平。

---

## 一、结论

**本轮最优（并列）：**

1. `minHops=0，maxStep=16，topK=5`：原因 6/20、处置 5/20、任一 7/6；
2. `minHops=1，maxStep=16，topK=3`：原因 6/20、处置 5/20、任一 7/6。

同 20 题基线：**原因 9/20、处置 6/20**。

> 本轮把上一轮的 5/25 拉回到 6/20，但**仍低于基线 9/6**，不能上线。

---

## 二、实验设置

### 2.1 数据

- 库：`sama_v2_holdout50.sqlite`（库外）；
- 题：`eval50/sub20.json`（前 20 题）；
- 判分：`eval40-score.mjs`。

### 2.2 固定参数

| 参数 | 值 | 说明 |
|---|---:|---|
| beam K | 7 | 上一轮最优 |
| γ | 0.8 | 上一轮最优 |
| hops | 4 | 上一轮最优 |
| λ（hopCost） | 0.05 | 上一轮最优 |
| ρ（beam 随机度） | 0.2 | 上一轮最优 |
| noNewStop | 2 | 固定 |
| retBudget | 12 | 按用户要求 |
| D_pack | 关闭 | 基线兼容 |
| 回树 | 关闭 | 基线兼容 |
| 词表 | 48 | 基线兼容 |
| Judge | 强制影子 | 只按总分 |

### 2.3 变量（8 组）

```
minHops ∈ {0, 1}
maxStep ∈ {8, 16}
topK    ∈ {3, 5}
```

---

## 三、结果

| 排名 | minHops | maxStep | topK | 原因 | 处置 | 任一原因 | 任一处置 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| **1** | **0** | **16** | **5** | **6/20** | **5/20** | **7/20** | **6/20** |
| **1** | **1** | **16** | **3** | **6/20** | **5/20** | **7/20** | **6/20** |
| 3 | 1 | 8 | 3 | 6/20 | 4/20 | 7/20 | 5/20 |
| 4 | 0 | 8 | 5 | 5/20 | 5/20 | 5/20 | 5/20 |
| 5 | 0 | 8 | 3 | 4/20 | 3/20 | 4/20 | 3/20 |
| 6 | 0 | 16 | 3 | 4/20 | 3/20 | 5/20 | 3/20 |
| 7 | 1 | 8 | 5 | 4/20 | 3/20 | 5/20 | 4/20 |
| 8 | 1 | 16 | 5 | 3/20 | 2/20 | 4/20 | 3/20 |

### 同 20 题基线

| 配置 | 原因 | 处置 |
|---|---:|---:|
| 基线（K=3、γ=0.6、hops=2、λ=0.15、预算 12、maxStep 8、minHops=0、topK=3） | **9/20** | **6/20** |
| 本轮最优（minHops=0、maxStep=16、topK=5） | 6/20 | 5/20 |

---

## 四、规律

1. **maxStep=16 优于 8**：  
   同样 topK 下，16 比 8 多 1–2 题；8 步不够用。

2. **topK 与 minHops 有交互**：
   - `minHops=0` → `topK=5` 更好（6/5）；
   - `minHops=1` → `topK=3` 更好（6/5）；
   - `minHops=1 + topK=5 + maxStep=16` 最差（3/2）。

3. **minHops 不是越大越好**：  
   0 和 1 都能到 6/5，但组合错了会掉到 3/2。

4. **仍差基线 3 题**：  
   消融有效（5/25 → 6/20），但没有恢复到 9/6。

---

## 五、差距来源

本轮只回退了 3 项，仍有 5 项非基线固定值：

| 参数 | 基线 | 本轮 |
|---|---:|---:|
| beamK | 3 | **7** |
| γ | 0.6 | **0.8** |
| hops | 2 | **4** |
| λ | 0.15 | **0.05** |
| ρ | 0 | **0.2** |

因此 6/20 不能归因于 minHops/maxStep/topK；剩余 3 题差距很可能来自这 5 项。

---

## 六、建议

### 最后一组对照（20 题）

从本轮最优出发，**只保留 maxStep=16、topK=5，其余全部回基线**：

```
minHops=0
maxStep=16
topK=5
beamK=3
γ=0.6
hops=2
λ=0.15
ρ=0
预算=12
```

判定：

| 结果 | 结论 |
|---|---|
| 回到 9/6 或更高 | 收益来自 maxStep/topK，可保留 |
| 只有 6/5 左右 | 该区域整体不适合，直接回基线 |

### 最终原则

- 不再扩网格；
- 先回到基线 9/6；
- 任何新参数必须在基线上单独 +1 题以上才保留；
- 最后用 50 题验证。

---

## 七、复现

```powershell
$env:SAMA2_SQLITE_PATH='D:\SAMA-data\corpus\机床数据\sama_v2_holdout50.sqlite'
$env:SAMA2_PORT='3966'
$env:SAMA2_PACK='0'
$env:SAMA2_EXPAND='0'
$env:SAMA2_LEXICON='48'
$env:SAMA2_JUDGE_SHADOW='1'
$env:SAMA2_TREE_BEAM_K='7'
$env:SAMA2_TREE_GAMMA='0.8'
$env:SAMA2_TREE_HOPS='4'
$env:SAMA2_TREE_HOP_COST='0.05'
$env:SAMA2_TREE_BEAM_RHO='0.2'
$env:SAMA2_TREE_NONEW='2'
$env:SAMA2_TREE_RET_BUDGET='12'
$env:SAMA2_TREE_MIN_HOPS='0'
$env:SAMA2_MAX_STEP='16'
$env:SAMA2_TREE_TOP_K='5'
node D:\SAMA\SAMA\sama2.0\server.mjs
```

批量脚本：`D:\SAMA\audit\grid3-minhops-maxstep-topk.ps1`。

---

## 八、文件

| 文件 | 内容 |
|---|---|
| `run_m*_s*_k*.jsonl` | 8 组回答 |
| `score_m*_s*_k*.json` | 8 组判分 |
| `grid3_summary.json` | 汇总 |

环境已恢复：词图 82 节点、`lexiconHash=ed12830d`；3966 已关闭；默认参数未改。

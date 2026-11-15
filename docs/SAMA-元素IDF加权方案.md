# SAMA 查询元素 IDF/DF 加权方案

日期：2026-11-10
背景：五路入口目前按“元素是否被本路抽中”给权重，导致 `加工`、`故障`、`系统` 这类高频泛词与 `编辑`、`刀塔`、`9177` 同权，入口被拉向泛化结果。
目标：用 `full_term_stats` 的 DF 给每个元素算“特异度”，在每路的温度加权里压掉泛词、抬高专有词；不改 BM25 主排序，只改入口种子融合的权重。

---

## 一、思路总览

```
元素 t
  ├─ DF(t)          ← full_term_stats（多字词用 bigram 交集）
  ├─ IDF(t)         ← 平滑对数 IDF
  ├─ s(t)           ← 归一化特异度 ∈ (0,1]
  └─ w_i(t)         ← e_i(t)·exp((p(t)+β·s(t))/τ_i) / Z_i
                        │        │        │
                        │        │        └─ 本路温度（低温集中、高温摊平）
                        │        └─ 领域先验（词表/桥接/代号）
                        └─ 本路是否抽中该元素（1 或 α）
```

然后每路用自己的 `w_i(t)` 做**加权 RRF 种子融合**，得到不同的种子文档，再进入原来的 ΔG 扩展。

对应文献：

| 工作 | 借用的思想 |
|---|---|
| Salton & Buckley (1988) | TF-IDF 词项加权框架 |
| Robertson & Spärck Jones (1976) | 相关性与词项权重的概率模型，IDF 的来源 |
| Robertson & Zaragoza (2009) | BM25 的词项权重 `log((N-df+0.5)/(df+0.5))` |
| Church & Gale (1995) | IDF 作为“词项特异度”的解释 |
| Kageura & Umino (1996) | 术语度（termhood）与领域特异性 |
| Lavrenko & Croft (2001)；Abdul-Jaleel et al. (2004) | 查询扩展/反馈中的词项选择与 RM3 |
| Carpineto & Romano (2012) | 查询扩展词项加权的综述 |
| Cormack et al. (2009) | Reciprocal Rank Fusion（种子融合） |
| Lv & Zhai (2011) | BM25+ 的下界思想（泛词不归零） |

---

## 二、数学定义

### 2.1 语料与 DF

语料 `C = {d_1, …, d_N}`，本库 `N = 204,894` 条片段。

对词项 `t`：

```
D(t) = { d ∈ C : t ∈ d }
df(t) = |D(t)|
```

`full_term_stats(term, document_frequency)` 直接给出 `df`。

### 2.2 多字词的 DF

本库 postings 是 **CJK bigram + 英文/数字 token**，所以多字词要按 bigram 处理。

对词项 `t`，令 `G(t)` 为其 bigram 集合（`t` 长度为 2 时 `G(t)={t}`）：

```
D(t) = ⋂_{g ∈ G(t)} D(g)
df(t) = |D(t)|
```

精确算法是对 postings 求交集；工程上可用上界近似：

```
df̂(t) = min_{g ∈ G(t)} df(g)     // df(t) ≤ df̂(t)
```

`df̂` 偏大 → IDF 偏小 → 权重偏保守，不会把专有词抬得过高。

### 2.3 平滑 IDF

两种经典形式：

```
RSJ:      idf_RSJ(t) = log( (N - df(t) + 0.5) / (df(t) + 0.5) )
对数平滑:  idf_log(t) = log( 1 + N / df(t) )
```

`idf_RSJ` 在高 DF 时会变负（BM25 里通常截断到 0），`idf_log` 恒正。为了处理 `df = 0`（OCR/分词缺失），再加平滑常数 `κ`：

```
idf_κ(t) = log( 1 + N / (df(t) + κ) ),   κ = 1
```

性质：

- `df → 0`：`idf_κ → log(1 + N/κ)`，取最大值；
- `df → N`：`idf_κ → log(2) ≈ 0.69`，不会归零；
- 单调递减，满足“越常见越不特异”。

### 2.4 归一化特异度

在本题的元素集合 `E` 内做 max 归一化：

```
s(t) = idf_κ(t) / max_{t' ∈ E} idf_κ(t')     ∈ (0, 1]
```

这样 `s(t)` 与语料规模无关，跨题可比。

### 2.5 每路的元素权重

记：

- `p(t) ∈ [0,1]`：领域先验（词表/桥接 0.85，代号 0.7，raw 0.55）；
- `e_i(t) ∈ {1, α}`：本路是否抽中该元素，`α = 0.15`（软下界，不归零）；
- `τ_i`：本路温度（0.35 / 0.5 / 0.85 / 1.0 / 0.95）；
- `β ∈ [0,1]`：IDF 影响强度，建议 `β = 0.6`。

定义未归一化分数：

```
u_i(t) = e_i(t) · exp( ( p(t) + β · s(t) ) / τ_i )
```

归一化权重：

```
w_i(t) = u_i(t) / Σ_{t' ∈ E} u_i(t')
```

**为什么用 exp + 温度**：这是 Boltzmann/softmax 形式。

- `τ_i → 0`：`w_i` 趋向 one-hot，只强调分数最高的元素（低温路 = 近似 MAP）；
- `τ_i → ∞`：`w_i` 趋向均匀，多元素平摊（高温路 = 探索）。

`β` 控制 IDF 的相对贡献：`β=0` 退化为“只看先验和是否抽中”；`β=1` 时 IDF 与先验同权。

---

## 三、真实数值示例

从生产库 `full_term_stats` 实测（N = 204,894，κ = 1）：

| 元素 | df | idf_κ | s(t) |
|---|---:|---:|---:|
| 编辑 | 447 | 6.130 | 0.667 |
| 程序 | 1,762 | 4.765 | 0.519 |
| 输入 | 3,263 | 4.156 | 0.452 |
| 故障 | 2,954 | 4.254 | 0.463 |
| 加工 | 5,294 | 3.681 | 0.401 |
| 系统 | 10,025 | 3.065 | 0.334 |
| 报警 | 2,043 | 4.618 | 0.503 |
| 刀塔 | 55 | 8.223 | 0.895 |
| 刀库 | 228 | 6.802 | 0.740 |
| 换刀 | 384 | 6.281 | 0.684 |
| 9177 | 21 | 9.186 | 1.000 |

取 `p = 0.85`、`β = 0.6`、`κ = 1`。

### 3.1 低温路（τ = 0.35，抽中 编辑/输入/程序）

| 元素 | e | p+β·s | exp(·/0.35) | w |
|---|---:|---:|---:|---:|
| 编辑 | 1 | 1.250 | 35.5 | **0.362** |
| 输入 | 1 | 1.121 | 24.6 | 0.251 |
| 程序 | 1 | 1.161 | 27.6 | 0.282 |
| 系统 | 0.15 | 1.050 | 3.02 | 0.031 |
| 加工 | 0.15 | 1.091 | 3.39 | 0.035 |
| 故障 | 0.15 | 1.128 | 3.77 | 0.038 |

泛词 `系统/加工/故障` 即使出现在句子里，权重也被压到 3–4%。

### 3.2 高温路（τ = 0.95，抽中 系统/加工/故障）

| 元素 | e | exp(·/0.95) | w |
|---|---:|---:|---:|
| 系统 | 1 | 3.02 | **0.274** |
| 加工 | 1 | 3.15 | 0.286 |
| 故障 | 1 | 3.28 | 0.298 |
| 编辑 | 0.15 | 0.56 | 0.051 |
| 输入 | 0.15 | 0.49 | 0.044 |
| 程序 | 0.15 | 0.51 | 0.046 |

这条路的“主题”就是泛词，所以它们被抽中时仍占 ~86%；但这是该路的职责（探索泛化），不是所有路都这样。

### 3.3 刀塔题示例（τ = 0.5，抽中 刀塔/报警/系统）

`刀塔 s=0.895`、`报警 s=0.503`、`系统 s=0.334`：

```
刀塔: exp((0.85+0.537)/0.5) = 16.1
报警: exp((0.85+0.302)/0.5) = 10.0
系统: exp((0.85+0.200)/0.5) = 8.2
```

`刀塔` 权重约为 `系统` 的 2 倍，比现在的“同权”更合理。

---

## 四、种子融合（把权重真正用上）

只把词拼进查询不改变 BM25 排序（实测重复“编辑 输入”3 次，排序完全不变），所以要在**检索结果层**融合。

对每路 `i`：

```
R_q(d) = 1 / (k + rank_q(d)),   k = 60        // Reciprocal Rank Fusion
S_i(d) = λ · R_{q0}(d) + (1-λ) · Σ_{t∈E} w_i(t) · R_t(d)
```

- `q0`：原句查询（保底召回）；
- `R_t(d)`：单词项 `t` 的检索排名分；
- `λ = 0.5`：原句与元素各占一半；
- 取 `top-K` 作为该路种子文档。

`k=60` 来自 RRF 的经验值（Cormack et al., 2009），作用是压住极端高排名文档的支配性。

### 4.1 完整算法

```
for lane i in 1..5:
  E = queryElements(q)                 // 词表 + 桥接 + 代号 + bigram
  for t in E:
    df_t = dfOf(t)                     // bigram 交集或 min 近似
    idf_t = log(1 + N/(df_t+1))
    s_t = idf_t / max_idf(E)
  picked = sampleSoftmax(E, prior, τ_i, m_i)
  for t in E:
    e_t = picked.has(t) ? 1 : 0.15
    u_t = e_t * exp((p_t + β*s_t)/τ_i)
  w_t = u_t / Σ u
  seed_i = topK( λ*RRF(q0) + (1-λ)*Σ_t w_t*RRF(t) )
  tree_i = ΔG 扩展(seed_i, τ_i)
```

---

## 五、实现位置

| 文件 | 改动 |
|---|---|
| `sama-sqlite/term-stats.mjs`（新增） | 从 `full_term_stats` 读 DF，带缓存；`dfOf(term)` 处理 bigram 交集 |
| `retrieval-tree.mjs` `elementPrior` | 增加 `β·s(t)` 项；元素对象带 `s` |
| `retrieval-tree.mjs` `buildLaneEntries` | 权重公式 `u_t`、归一化 `w_t` |
| `retrieval-tree.mjs` `runRetrievalTree` | 种子融合已有，权重改为新 `w_t` |
| `config.mjs` | 新增 `treeIdfBeta`（默认 0.6）、`treeIdfKappa`（默认 1） |

性能：元素 ≤ 12 个，DF 查询可一次预加载 `full_term_stats` 到 `Map`（约 10–20 万行，内存几十 MB），或按需查询并缓存；对单题耗时影响 < 10ms。

---

## 六、评测方案

| 指标 | 定义 |
|---|---|
| 有效路比例 | 5 路中命中“正确域”的路数（人工/LLM 判定） |
| 正确域召回 | 删除案例的同类域文档是否进入任一路种子 |
| 端到端准确率 | 20/50 题库的原因、处置两列 |
| 消融 | β=0 / β=0.6 / β=1.0 三组 |

预期：

- β=0.6 时，泛词权重从 ~20% 降到 3–5%，专有词权重提升 2–3 倍；
- 有效路比例应从 1/5 提升到 3/5 左右；
- 端到端准确率不一定立刻提升（库外仍受知识缺失限制），但“答偏到润滑”的情况应显著减少。

---

## 七、风险与边界

1. **IDF 不等于领域重要性**：`故障` 虽是泛词，但在“是否故障”语境里仍需保留，所以用 `α=0.15` 软下界，不归零；
2. **bigram 交集成本**：精确交集需要读 postings；可用 `min df` 近似，偏保守；
3. **OCR/分词噪声**：`编码器` 的 bigram 可能查不到（实测 `编码器` 整词 df=0），必须走 bigram；
4. **温度与 IDF 耦合**：低温路本身会放大高分元素，需要同时限制 `β·s` 不要让低温路完全 one-hot；
5. **不要用 IDF 改 BM25 主排序**：只改入口权重，避免破坏现有 92% 的库内表现。

---

## 八、参考文献

1. Salton, G., & Buckley, C. (1988). Term-weighting approaches in automatic text retrieval. *Information Processing & Management*, 24(5), 513–523.
2. Robertson, S. E., & Spärck Jones, K. (1976). Relevance weighting of search terms. *Journal of the American Society for Information Science*, 27(3), 129–146.
3. Robertson, S., & Zaragoza, H. (2009). The probabilistic relevance framework: BM25 and beyond. *Foundations and Trends in Information Retrieval*, 3(4), 333–389.
4. Church, K. W., & Gale, W. A. (1995). Inverse document frequency (IDF): A measure of term specificity.
5. Kageura, K., & Umino, B. (1996). Methods of automatic term recognition: A review. *Terminology*, 3(2), 259–289.
6. Frantzi, K., Ananiadou, S., & Mima, H. (2000). Automatic recognition of multi-word terms: the C-value/NC-value method. *International Journal on Digital Libraries*, 3(2), 115–130.
7. Lavrenko, V., & Croft, W. B. (2001). Relevance-based language models. *SIGIR 2001*.
8. Abdul-Jaleel, N., Allan, J., Croft, W. B., et al. (2004). UMass at TREC 2004: Novelty and HARD.
9. Carpineto, C., & Romano, G. (2012). A survey of automatic query expansion in information retrieval. *ACM Computing Surveys*, 44(1), 1–50.
10. Cormack, G. V., Clarke, C. L. A., & Buettcher, S. (2009). Reciprocal rank fusion outperforms Condorcet and individual rank learning methods. *SIGIR 2009*.
11. Lv, Y., & Zhai, C. (2011). Lower-bounding term frequency normalization. *CIKM 2011* (BM25+).
12. Amati, G., & van Rijsbergen, C. J. (2002). Probabilistic models of information retrieval based on measuring the divergence from randomness. *ACM TOIS*, 20(4), 357–389.

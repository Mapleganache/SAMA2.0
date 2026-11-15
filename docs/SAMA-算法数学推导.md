# SAMA 2.0 算法数学推导

日期：2026-11-03  
代码对照：`retrieval-tree.mjs`、`embed.mjs`、`evidence.mjs`、`judge.mjs`、`score.mjs`、`sama-sqlite/library.mjs`、`curated-library.mjs`、`query-analysis.mjs`、`term-graph.mjs`、`grounding.mjs`  
配套：[Agent 结构报告书](./SAMA-Agent结构报告书.md) · [数据库说明书](./SAMA-数据库说明书.md)

本文只推导**程序里实际在算的式子**。排序分、路径分、加权分都不是维修正确率，也不是故障原因的后验概率。

记号约定：用户原题 $x$；第 $i$ 路入口查询 $q_i$；路径词集合 $T$；命中文档集合 $D$；跳号 $n$ 从种子之后的第一次扩展起计。$(z)_{+}=\max(z,0)$。分数无特别说明时裁到 $[0,1]$ 或 $[0,10]$。

---

## 1. 分词与集合相似度

中文不按空格切。`tokensOf` / `embed.tokenize`：

1. 去掉空白、转小写。
2. 长度 $\ge 2$ 的连续字母数字词。
3. 字 bigram，最多 40（路径 Jaccard）或 48（向量）。

Jaccard：

$$
J(a,b)=\frac{|A\cap B|}{|A\cup B|}
$$

$A=\mathrm{tokensOf}(a)$。两边都空则 $J=1$。跨路入口撞车阈值 `OVERLAP_LIMIT=0.5`；beam 近重复 `PATH_OVERLAP_LIMIT=0.8`。

---

## 2. 稀疏余弦 $s_{\mathrm{vec}}$

默认 `treeEmbed=hash`，无外网嵌入。词频向量 $\mathrm{tf}(\cdot)\in\mathbb{R}^{V}$：

$$
s_{\mathrm{vec}}(u,v)=\cos(\mathrm{tf}(u),\mathrm{tf}(v))=\frac{\sum_t \mathrm{tf}_u(t)\,\mathrm{tf}_v(t)}{\lVert\mathrm{tf}_u\rVert_2\,\lVert\mathrm{tf}_v\rVert_2}
$$

结果夹到 $[0,1]$。`SAMA2_EMBED=jaccard` 时 $s_{\mathrm{vec}}$ 退回 Jaccard。接 BGE 只换 `resolveScoreVec`，后面的 $\Delta G$ 不动。

---

## 3. 第 0 步：分温 Softmax 入口

### 3.1 候选池

$$
\mathcal{Q}_0=\mathrm{Core}(x)\cup\mathrm{Bridge}(x)\cup\{x\}\cup\mathrm{MechanismSlots}(x)
$$

槽位改写 `firstQueryForLane`：第 1 路原句；第 2 路原句+桥接；第 3 路只要机理词；第 4 路润滑脂 / 添加剂；第 5 路反热变形词。

桥接 `BRIDGES`：题面匹配正则后，把对应机理词按「命中词长 + 桥接词长」排序。例如粗糙度题补上爬行、导轨、润滑、油品。

### 3.2 先验

$$
\mathrm{prior}(q)=\beta\,s_{\mathrm{lex}}(x,q)+(1-\beta)\,\mathrm{rule}(q)
$$

$\beta=$ `treePriorBeta` 默认 $0.5$。

$$
s_{\mathrm{lex}}(x,q)=0.35+0.65\,J(x,q)
$$

再裁到 $[0,1]$。`rule` 给机理槽加分、给「热变形」类槽减分（实现里是槽位启发式，不是学习到的势函数）。

### 3.3 Softmax 抽样

第 $i$ 路温度 $\tau_i\in(0.35,0.5,0.85,1.0,0.95)$。

- $\tau_i\le 0.4$：直接 $q_i=\arg\max_q \mathrm{prior}(q)$（几乎总是原句）。
- 否则 Boltzmann：

$$
P_i(q)=\frac{\exp\bigl(\mathrm{prior}(q)/\tau_i\bigr)}{\sum_{q'}\exp\bigl(\mathrm{prior}(q')/\tau_i\bigr)}
$$

RNG 为种子 `seedBase+i` 的 Mulberry32，可复现。$\tau$ 越大分布越平，越容易抽到桥接词。

撞车：若 $J(q_i,q_j)>0.5$，重抽最多 `treeEntryRetry=3` 次，失败回退槽位改写。

同一 $\tau_i$ 传给该路 ReAct 提议温度，所以「分温」同时作用在检索入口和成稿采样。

### 3.4 MMR 模式（可选）

`SAMA2_TREE_ENTRY=mmr` 时：

$$
\mathrm{MMR}(q)=\lambda\,\mathrm{prior}(q)-(1-\lambda)\max_{q'\in S} J(q,q')
$$

$\lambda=$ `treeMmrLambda` 默认 $0.5$。贪心取 $K$ 条。默认仍是 Softmax。

---

## 4. 路径分与扩展增益

### 4.1 种子分（第 0 跳，不扣代价）

入口 $t_0$ 检索 Top-$K$ 得 $D_0$。种子词 $T_0$ 取桥接前 4 个，否则按标点切 $t_0$。

$$
s(x,T,D)=\alpha\,s_{\mathrm{vec}}+(1-\alpha)\,s_{\mathrm{lex}}^{\mathrm{norm}}
$$

$\alpha=$ `treeAlpha` 默认 $0.5$。$s_{\mathrm{vec}}$ 对 $\mathrm{text}(T,D)$。BM25 原始分 $r=\max_{d\in D}\mathrm{score}(d)$：

$$
s_{\mathrm{lex}}^{\mathrm{norm}}=\frac{r}{r+5}
$$

$r=0$ 时用 $0.5\,s_{\mathrm{vec}}$ 顶上。$S_0=s(x,T_0,D_0)$，$G_0=S_0$。此时 `hopsUsed=1`。

### 4.2 为什么不能对整条路径再算一次余弦

旧实现：

$$
S_n=s(x,T_n,D_n)
$$

$T$、$D$ 变长后，$s_{\mathrm{vec}}$ 被稀释。实测 C08-29 整句：$S_0\approx 0.5255$，加「机械油」后路径分 $0.5252$，增益恒为 0，连 $\lambda=0$ 都不跳。

### 4.3 现行增益口径

本跳检索结果 $R$ 拆成新篇 $R_{\mathrm{new}}=R\setminus D$ 与重复 $R_{\mathrm{rep}}=R\cap D$。对每篇单独打分，只取向量分（$\alpha=1$），不把路径词拼进去。

$$
s(x,d)=s(x,\emptyset,\{d\})\big|_{\alpha=1},\qquad
\mathrm{docScore}_n=\max_{d\in R}s(x,d)
$$

路径展示分不加重复奖励，单调不减：

$$
S_n=\max(S_{n-1},\mathrm{docScore}_n)
$$

即时收益才允许「再命中」：

$$
f(h)=\mathbf{1}_{h=2}+\tfrac12\mathbf{1}_{h=3},\qquad
\mathrm{gain}_n=\mathrm{clamp}_{[0,1]}\max\bigl(g_{\mathrm{new}},g_{\mathrm{rep}}\bigr)
$$

$g_{\mathrm{new}}=\max_{d\in R_{\mathrm{new}}}s(x,d)$。$\mathrm{gain}_n=g_{\mathrm{new}}$，**只累计新篇**，重复不加进 $G$。exclude 后若空则回退含重复的 top-$K$；重复篇相关度须 $\ge 0.8\times$ 种子首篇，否则当无候选。`treeNoNewStop` 默认 $1$（一次空转即停）。最终路径若扩展跳全无新篇，回退到种子的 $D_0/T_0$，避免词表漂移抬高 $G$。

机理篇相对题面的余弦常低于种子篇。若仍用 $(S_n-S_{n-1})_{+}$，重复命中时 $S$ 不变，gain 又是 0。

### 4.4 回报与停机

$$
G=S_0+\sum_{n\ge 1}\gamma^{n-1}(\mathrm{gain}_n-\lambda_{\mathrm{hop}})
$$

代码：`delta = γ^{n-1} * (gain - λ)`。$\gamma=$ `treeGamma` 默认 $0.6$，$\lambda_{\mathrm{hop}}=$ `treeHopCost` 默认 **$0.15$**（不要为了多跳而改成 0）。

因为 $\gamma^{n-1}>0$：

$$
\Delta G_n>0\iff \mathrm{gain}_n>\lambda_{\mathrm{hop}}
$$

停机阈值与跳数 $n$、折扣 $\gamma$ **无关**。$\gamma$ 只影响累加进 $G$ 的后期增益大小，从而影响 beam 排序：同样幅度的跳，早出现的更值钱。

数值：$\lambda=0.15$、新篇 $\mathrm{gain}=0.10$ → $\Delta G=-0.05$，不跳；$\mathrm{gain}=0.22$ → $+0.07$，`hopsUsed=2`。仅重复时 $\mathrm{gain}=0$，不抬 $G$。$\lambda=0$ 时只要**新篇** gain $>0$ 就会跳。保险丝 `treeHopFuse=16`、检索次数 `treeRetBudget=12` 不是业务上界。旧配置 `treeHops=2` 不作为业务停机。

查询与上一跳字符串全等：直接弃。邻域先按便宜分做 Softmax / Gumbel 无放回抽样（`treeHopSample`，默认 `softmax`，温度继承路温），**只对抽中的边做 BM25 + $\Delta G$**。随机不取消 $\Delta G\le 0$ 丢弃。

Beam 宽 $K\in\{3,5,7\}$，默认 3。邻域来自：命中抽词 ∪ 静态 `BRIDGES` / `kgNeighbors` ∪ 共现图。

---

## 5. 共现图 PMI

离线脚本 `scripts/build-term-graph.mjs` 读 `full_postings`，写入 `term-graph.json`。

词表 `LEXICON`（爬行、导轨、机械油、静压…）。词 $a$ 的文档集：其所有字 bigram 在倒排里的 **交集**。

$$
\mathrm{PMI}(a,b)=\ln\frac{\mathrm{co}(a,b)\cdot N}{\mathrm{df}(a)\,\mathrm{df}(b)}
$$

$N=$ `full_corpus_stats.fragment_count`，$\mathrm{co}$ 为两词文档集交的大小。边条件：$\mathrm{co}\ge 2$ 且 $\mathrm{PMI}\ge 1.2$。邻居按 $\mathrm{PMI}\cdot\ln(1+\mathrm{co})$ 排序，最多 10 个。运行时与静态 KG 合并。图谱指纹与库不一致时退回空图，不中断诊断。

这是诊断词扩展用的无向加权图，不是因果图。

---

## 6. 证据契合 $s_{\mathrm{fit}}$ 与三档

对树输出的每条文档 $d$：

$$
\begin{aligned}
\mathrm{overlap}&=\frac{|S(d)\cap S(x)|}{\max\bigl(|S(d)|,|S(x)|\bigr)} \\
\mathrm{bridgeHit}&=\mathbf{1}[\mathrm{Bridge}(x)\text{ 有词出现在 }d] \\
\mathrm{aligned}&=\max(\mathrm{overlap},\mathrm{bridgeHit}) \\
s_{\mathrm{fit}}&=\eta\cos(\mathrm{tf}(d),\mathrm{tf}(x))+(1-\eta)\,\mathrm{aligned}
\end{aligned}
$$

$S(\cdot)$ 是子系统集合：导轨、主轴、进给、液压、冷却、砂轮、顶尖、润滑。$\eta=0.65$。桥接命中比「子系统必须相等」松：题面写粗糙度、没写导轨时，近邻爬行案例仍可对齐。

仅有「磨床 / 磨削」等泛词且 $\mathrm{aligned}=0$、余弦 $<0.55$ 时，把 $s_{\mathrm{fit}}$ 压到 $\tau_{-}$ 以下。

$$
g(d,x)=\begin{cases}
\mathrm{SUPPORT} & s_{\mathrm{fit}}\ge 0.42 \\
\mathrm{NEAR} & 0.18\le s_{\mathrm{fit}}<0.42 \\
\mathrm{IRRELEVANT} & s_{\mathrm{fit}}<0.18
\end{cases}
$$

`sqlite_curated:*` 且已达 NEAR 时抬到 SUPPORT（试点条目优先）。观察区顺序：SUPPORT ⊕ NEAR ⊕ IRRELEVANT。

过程分：

$$
r_{\mathrm{proc}}=\begin{cases}
2 & \text{含 SUPPORT} \\
1 & \text{仅 NEAR} \\
0 & \text{否则}
\end{cases}
$$

---

## 7. FLARE 补检

$\{d:g=\mathrm{SUPPORT}\}=\emptyset$ 时构造一次补查询，取路径词与桥接词中 $s_{\mathrm{vec}}$ 最大者接到现象短句上。新文档是否并入仍用第 4.4 节同一条 $\Delta G$，增益同样走 `nextPathScore`（单篇文档口径）。$\Delta G\le 0$ 就停。这不是硬两跳。

---

## 8. 方向卡与 ALCE 封顶

主方向 $m$ 允许进入，当且仅当存在观察 $d$ 满足 $g(d,x)\in\{\mathrm{SUPPORT},\mathrm{NEAR}\}$ 且文本提到 $m$。通识集 $\{\text{热变形},\text{砂轮不平衡},\text{冷却液},\ldots\}$ 不满足上式则从 `main_direction` 删掉。

成稿主因没有 `obsId` / `sqlite_*`：

$$
A\leftarrow\min(A,5)
$$

有引用则不封顶。这是引用支撑约束，不是把金标写进提示词。

---

## 9. 加权评判与 mechanism 否决

模型输出五项 $A,\mathrm{Saf},F,C,B\in[0,10]$，程序：

$$
\mathrm{Total}=0.30\,A+0.25\,\mathrm{Saf}+0.20\,F+0.15\,C+0.10\,B
$$

保留两位小数。平分时先比安全，再比准确性，再比路号。

`accuracy` 在程序侧再经 ALCE 封顶。`mechanism` 默认回退到封顶后的 $A$。否决：

$$
\mathrm{mechanism}<\theta,\quad \theta=5
$$

该路不得进入候选池。若全组都低于 $\theta$，保留原排名作保底，日志 `mechanismFallback=true`。有的过、有的不过：`mechanismGated=true`。

交付前两名：对否决后的排序取 `ranked[0]`、`ranked[1]`。准确性专评只审计第一名，不改名次。

---

## 10. SQLite BM25 类排序

资料排序在**已通过准入**的候选上做。分数再高也不能把 LAD / 未知型号专属报警 / 未批准阈值拉进维修参考。试点索引与全量倒排**分数不跨库相加**。

### 10.1 查询分析

英文小写，「粘」→「黏」。按标点和「但 / 但是 / 不过 / 然而」分句。表示缺少测量或限制回答方式的分句（「没有压力实测」「不要直接换油」）不进入排序词；「没有油压」作为故障现象保留。

查询扩展（仅当原句没有该词，且权重更低）：油液 + 冬季/升温恢复 → 低温、黏温、润滑油；导轨运动不稳 + 用油 → 润滑剂、速度、载荷。扩展不是已确认根因。

### 10.2 核对试点

标题词频三倍：$TF(t,d)=3\,TF_{\mathrm{title}}+TF_{\mathrm{body}}$。$N$ 为当前准入试点数。

$$
IDF(t)=\ln\left(1+\frac{N-df_t+0.5}{df_t+0.5}\right)
$$

$$
K_d=1.2\left(0.25+0.75\frac{L_d}{\overline L}\right)
$$

$$
s(t,d)=w_t\,IDF(t)\,\frac{2.2\,TF(t,d)}{TF(t,d)+K_d}
$$

$2.2=1+1.2$，即 BM25 的 $k_1=1.2$、$b=0.75$。词权 $w_t$：二字词 1（词表命中 3）；三字及以上词表 5；英文数字 3；「代用」12；扩展词 0.9。标题明确覆盖低温 / 润滑剂选择时整条 $\times 1.6$。首位若有「选油前提」关联且关联条也过准入，插入第二位（关系决定位置，不虚构分数）。最多 4 条。

演算例子见 `henry/SQLite检索优化数学推导.md`（D01、H3842-2）。

### 10.3 全量片段

同一饱和式。$N=66593$，$\overline L\approx 161.90$ 来自 `full_corpus_stats`。SQL 先取基础分最高 40 条 `reference_allowed=1` 的片段，再按焦点乘 1.5：导轨+爬行/润滑/摩擦；乳化+检查/污染；油雾。同源同层级本次最多一段。与试点拼盘：先放排序第一的试点（及前提关联），再用原文补足。油雾题不把无关试点占位。

返回受 3400 字符预算限制。排名进前 4 **不保证**文本一定返回。

---

## 11. 出处核对 $\kappa$

规范化 $\kappa$：NFKC、数字与单位去空格、`Nm`→`N·m`、`um`→`μm`、转小写。方案中每个扭矩 / 间隙 / 压力串必须是 $\kappa(\text{观察})$ 的子串。`0.02` 与 `0.020` 不同。引用 id 用完整匹配集合，不允许 `sqlite_curated:12` 命中观察里的 `sqlite_curated:123`。

$G=1$ 当且仅当全部数值规格都在观察里。边界题是否补满五路看 $G=0$ 或安全分 $<6$ 或成稿含「信息不足」。

---

## 12. 其它程序规则（非学习算法）

- 安全抽查：0–10 整数，阈值 $\theta_B=6$。
- 工具重复：参数 JSON 键排序 + NFKC 后字符串相等。
- 观察重复：前 200 字相同。
- Markdown 知识库回退（SQLite 关闭时）：词与 bigram 命中计数排序，不是 BM25。

---

## 13. 超参一览（默认）

| 符号 | 配置 | 值 | 作用 |
| --- | --- | --- | --- |
| $\tau_i$ | `laneTemps` | 0.35…0.95 | 入口 + 提议温度 |
| $\gamma$ | `treeGamma` | 0.6 | 后期增益折扣 |
| $\lambda_{\mathrm{hop}}$ | `treeHopCost` | 0.15 | 是否再跳 |
| $\alpha$ | `treeAlpha` | 0.5 | 种子分向量/词法混合 |
| $K$ | `treeBeamK` | 3 | beam 宽 |
| $\eta$ | `FIT_ETA` | 0.65 | $s_{\mathrm{fit}}$ |
| $\tau_{+},\tau_{-}$ | SUPPORT / NEAR | 0.42 / 0.18 | 三档 |
| $\theta$ | `MECHANISM_THETA` | 5 | 机理否决 |
| $A_{\mathrm{cap}}$ | `ACCURACY_CAP` | 5 | 无引用封顶 |
| $k_1,b$ | 写死 | 1.2, 0.75 | BM25 |
| PMI 阈 | 写死 | 1.2 | 共现边 |

不要为了「多跳」把 $\lambda_{\mathrm{hop}}$ 改成 0 来掩盖增益口径；不要把留出集金标写进公式。

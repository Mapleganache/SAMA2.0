# SAMA 数据库与知识图谱：检索推理效果差的原因分析

日期：2026-11-12  
对象：`sama2.0/data/sama_full.sqlite`、`sama-sqlite/term-graph.json`、`sama-sqlite/library.mjs`、`retrieval-tree.mjs`、`evidence.mjs`  
配套：[数据库说明书](./SAMA-数据库说明书.md) · [算法数学推导](./SAMA-算法数学推导.md) · [知识图谱遍历与推理链长度报告](./SAMA-知识图谱遍历与推理链长度报告.md) · [库内库外测试报告](./datasets/SAMA-库内库外测试报告.md)  
复现脚本：`D:\SAMA\audit\db-kg-diag.mjs`、`D:\SAMA\audit\retrieval-pollution-diag.mjs`  
状态：**诊断报告，不改代码**

---

## 0. 结论先说

效果差的主因不是「ΔG 公式写错了」，也不是「完全没有图谱」，而是下面这条因果链：

1. **可检索层被通用机械手册与表格行淹没**，磨床专属、已核验内容极少；  
2. **倒排是字 bigram + 未校准 BM25**，高频噪声词与标准号撞车会抢排；  
3. **试点 curated 无条件插队**，错误试点会被分级抬成 SUPPORT；  
4. **所谓知识图谱只是词共现 PMI 图**，不是「现象→机理→处置」因果图，且 hub 节点跨域串味；  
5. **路径相关分 $s$ 是字面余弦**，机理篇对题面的 $s$ 常低于现象篇，再叠加 $\lambda=0.15$ 与 `limit≤4`，多跳经常买不起或买不到新篇；  
6. 阅读器再精，也只能在被污染的 $D_{\mathrm{pack}}$ 上生成——**证据层错了，后面核对与评判救不回原因正确率**。

库内有答案时可到约 69% 全中；答案删掉后掉到 0–26%（见库内库外报告）。这说明瓶颈首先是**记忆是否存在且能否被正确选中**，其次才是生成。

---

## 1. 数据库现状（2026-11-12 实测）

库文件约 **1.57 GB**。`full_corpus_stats`：

| 量 | 值 |
| ---: | ---: |
| 片段总数 $N$ | 204,894 |
| `reference_allowed=1` | **72,534**（约 35%） |
| 倒排 postings | 5,426,991 |
| 词项统计条数 | 309,080 |
| 平均 token 长（全库） | 95.2 |
| 平均 token 长（可参考层） | 163.1 |

### 1.1 机型分布：磨床几乎不在可参考层

| `machine_type` | 全库片段 | 其中 `reference_allowed` |
| --- | ---: | ---: |
| generic | 180,720 | **66,531** |
| grinder | 12,236 | **102** |
| unknown | 4,900 | 3,342 |
| mill_or_center | 4,781 | 2,176 |
| lathe | 2,257 | 383 |

可参考层里，**通用资料约占 92%**，磨床专属只占 **0.14%（102/72534）**。磨床诊断题在统计上更像是在「机械设计手册 + 少量案例」里找针。

### 1.2 片段形态：表格行主导

| `kind` | 全库 | 可参考 |
| --- | ---: | ---: |
| `table_row` | 161,842 | 48,853 |
| `paragraph` | 30,391 | 21,844 |
| `case_entry` | 842 | 842 |
| `alarm_entry` | 676 | 676 |
| `param_entry` | 319 | 319 |

可参考层近 **2/3 是表格行**。DF 最高的 bigram 几乎全是表格/公式噪声：

| term | DF |
| --- | ---: |
| 表列 | 48,885 |
| 本行 | 48,854 |
| mathrm | 15,346 |
| gb | 14,641 |
| 摘自 | 14,382 |
| 参数 | 7,976 |
| 系统 | 10,025 |

短片段（`<40` token）15,087 条，长片段（`>800`）1,817 条：一端过碎、一端过长，都不适合「一篇一机理」的阅读器打包。

### 1.3 来源头部：手册压过维修案例

可参考层 top 来源（按片段数）：

1. 《机械设计手册》第七版第 1–6 卷合计约 **65,622**  
2. FANUC 电气维修 500 例 913  
3. 钻削扩削铰削 909  
4. SIEMENS 维修案例 708  
5. 各类表格汇总、参数/警报手册数百级  

维修「案例条目 / 报警表」合计约 **1.5k** 量级，相对手册是噪声级。

### 1.4 试点与准入：几乎没有「已批准记忆」

| 项 | 值 |
| --- | ---: |
| `units`（试点） | 20，全部 `expert_status=pending` |
| `production_allowed` | **0** |
| `parameters.allow_as_threshold` | **0 / 6** |
| `alarm_codes` | 676（存在性查表可用） |
| `case_relations` | 479（磨床仅 **7**；铣/加工中心 270；车床 197） |

默认模式 `reference`：允许未核验原文当参考，**不允许当本机指令**。`production` 模式对本分发几乎恒空。这在产品上正确，但意味着检索系统长期在「大而脏的参考层」上工作，没有干净的金标准子集可退。

### 1.5 历史案例机型偏置

`case_relations` 以铣床/加工中心、车床为主。磨床诊断若误命中这些案例，阅读器会把「龙门铣 / 刀库 / 西门子车床刀塔」写成磨床方案——实测里「中心孔咬毛」题的第 4 条已出现西门子龙门铣案例。

---

## 2. 「知识图谱」实际是什么

文件：`sama-sqlite/term-graph.json`（本次重建后：`nodeCount=82`，`fingerprint=5426991`，与库一致）。

### 2.1 构建公式

词表 `LEXICON` 约 83 个手写诊断词（磨床润滑 + 车铣电气扩展）。对词 $t$，文档集取字 bigram 倒排的交集：

$$
D(t)=\bigcap_{g\in G(t)} D(g),\qquad \mathrm{df}(t)=|D(t)|
$$

$G(t)$ 为 $t$ 的相邻二字。边权用点互信息：

$$
\mathrm{PMI}(a,b)=\ln\frac{\mathrm{co}(a,b)\cdot N}{\mathrm{df}(a)\,\mathrm{df}(b)}
$$

入边条件：$\mathrm{co}\ge 2$ 且 $\mathrm{PMI}\ge 1.2$。邻居按 $\mathrm{PMI}\cdot\ln(1+\mathrm{co})$ 排序，**代码里 `maxNbr` 写入元数据，但当前 `buildTermGraph` 未按 10 截断邻居**，实测平均出度约 **25.5**（有向边 2090 / 82）。

### 2.2 它不是因果图谱

边表示「两词常共现于同一片段」，**不表示**「$a$ 导致 $b$」或「测 $a$ 可验证 $b$」。  
例如 `抱轴—咬毛` 的 $\mathrm{PMI}\approx 8.04$ 但 $\mathrm{co}=2$：稀有共现把 PMI 抬爆，边很「强」、证据很弱。

稀有强边示例（$\mathrm{PMI}\ge 5,\ \mathrm{co}\le 3$）：抱轴↔咬毛/拉毛/烧伤/顶尖，油漆↔咬毛，拉毛↔刀塔/卡盘……这些边会把路径从磨床主轴问题拽到车铣夹具或反之。

### 2.3 Hub 节点跨域串味

出度最高的词：

| 节点 | 出度 | 前几邻居（示例） |
| --- | ---: | --- |
| 主轴 | 57 | 换刀、刀库、编码器、伺服 |
| 润滑 | 55 | 润滑脂、添加剂、供油、轴承 |
| 间隙 | 53 | 轴承、丝杠、导轨、超差 |
| 导轨 | 52 | 丝杠、气缸、驱动器、爬行 |
| 伺服 | 48 | 编码器、驱动器、反馈、主轴 |

磨床「主轴发热」一旦走到图邻域，很容易扩到 **换刀/刀库/伺服**（来自铣床语料共现），而不是「油品—间隙—供油」这一条更贴磨床静压/润滑的链。图在磨床域曾有用；扩词表之后，**覆盖变宽，判别力下降**。

### 2.4 与静态 BRIDGES 双轨

运行时邻域 =

$$
\mathcal{N}(t)=\mathrm{StaticBridge}(t)\cup\mathrm{CorpusPMI}(t)\cup\mathrm{HitExtract}(R)
$$

BRIDGES 是规则表（粗糙→爬行/导轨/润滑…），方向对、覆盖窄。Corpus PMI 覆盖宽、方向弱。两者并集后，**便宜边抽样（Softmax）更容易抽到高连通 hub**，而不是题面特异桥。

### 2.5 指纹不一致时的静默降级

`loadTermGraph(file, fingerprint)` 在指纹不匹配时返回**空图**并告警。`ensureTermGraph` 会重建，但在重建完成前或重建失败时，树只剩 BRIDGES + 命中抽词。生产上曾出现 fingerprint 漂移（旧图 5,416,025 vs 库 5,426,991）；重建后已对齐，但说明图与库**没有强制同事务版本**，漂移会悄悄关掉 PMI 扩展。

---

## 3. 检索层数学：为什么「搜得到」不等于「搜得对」

### 3.1 查询切成字 bigram

`library.mjs` 的 `terms(q)`：汉字串切成长度 2 的 bigram，英文/数字整词保留。停用表很小（数控、磨床、资料…），**挡不住「参数、系统、方法、表列」这类超高 DF 词**。

查询 $q$ 得到带权词项 $\{(t_i,w_i)\}$。有扩展词时 $w=0.6$，普通汉字 bigram $w=1$，字母数字 $w=4$。

### 3.2 BM25 变体（实现式）

对可参考片段 $f$，实现近似：

$$
\mathrm{score}(f)=\sum_{t\in q\cap f} w_t\cdot \mathrm{idf}(t)\cdot \frac{(3\,\mathrm{tf}^{\mathrm{title}}+ \mathrm{tf}^{\mathrm{body}})\cdot 2.2}{3\,\mathrm{tf}^{\mathrm{title}}+ \mathrm{tf}^{\mathrm{body}}+1.2\bigl(0.25+0.75\cdot L_f/\bar L\bigr)}
$$

其中

$$
\mathrm{idf}(t)=\ln\Bigl(1+\frac{N-\mathrm{df}(t)+0.5}{\mathrm{df}(t)+0.5}\Bigr)
$$

问题不在有没有 IDF，而在：

1. **语料 $N$ 被手册表格主导** →「参数」「系统」的 idf 被压低，但绝对命中次数仍巨大，长表行容易累计出分；  
2. **标准号 / 报警号同形**：题面 `9177` 与 `JB/T 9177` 锻造标准共享 token，BM25 会把手册表行打到前列（实测：刀塔 9177 报警题第 2、3 条是锻造标准摘录）；  
3. **`config()` 把 `limit` 硬夹在 $[1,4]$**：

```text
limit = max(1, min(4, Number(o.limit)||4))
```

树即使设 `topK=5/8`，底层也最多回 4 条。这直接削弱「加大 beam 换第二跳」的设想。

### 3.3 curated 强制插队

在 BM25 候选之后：

$$
\mathrm{out} \leftarrow [\mathrm{curated}_0]\ +\ \mathrm{TopFragments}
$$

试点只要在 curated 检索里有分，**稳占第 1 槽**，占掉 `limit=4` 的 1/4。  
实测无关题：

| 题面 | 被插到第 1 的试点 |
| --- | --- |
| 加工中心换刀不到位 | **C08-29 齿面粗糙度/导轨爬行** |
| 刀塔 9177 报警 | **C08-32 冬季液压失灵** |
| 主轴发热空载刚开机 | **C08-35 汽油洗主轴箱抱轴** |

### 3.4 分级把错误试点抬成 SUPPORT

`evidence.gradeRecord`：

$$
\text{若 } id=\texttt{sqlite\_curated:*}\ \text{且}\ s_{\mathrm{fit}}\ge \tau_{\mathrm{near}}=0.18
\quad\Rightarrow\quad
s_{\mathrm{fit}}\leftarrow\max(s_{\mathrm{fit}},\tau_{\mathrm{support}}=0.42)
$$

换刀题上 C08-29 的 fit 可到 0.42 量级 → **直接 SUPPORT**。MMR 打包保底「至少 1 SUPPORT」时，错误试点反而被优先保进 $D_{\mathrm{pack}}$。  
这是「检索噪声 × 分级偏置」的乘性错误，不是单一 bug。

### 3.5 契合分 $s_{\mathrm{fit}}$ 本身偏字面

$$
s_{\mathrm{fit}}=\eta\cos(\mathrm{tf}(x),\mathrm{tf}(d))+(1-\eta)\max(\mathrm{overlap}_{\mathrm{子系统}},\mathrm{bridgeHit})
$$

$\eta=0.65$。$\mathrm{tf}$ 仍是字 bigram。子系统 overlap 靠正则（导轨/主轴/…）。  
后果：

- 题面与手册目录句「字面像」→ fit 虚高；  
- 机理短文用同义表述（抗爬性、46 号机械油）→ 余弦偏低；  
- 错误 curated 只要擦到 NEAR 阈值就被抬到 SUPPORT。

---

## 4. 检索树推理：多跳为什么经常走不动或走歪

### 4.1 目标函数（现行）

种子：

$$
S_0=s(x,T_0,D_0),\qquad G_0=S_0
$$

扩展（只计新篇）：

$$
\mathrm{gain}_n=\max_{d\in R_{\mathrm{new}}} s(x,d),\qquad
\Delta G_n=\gamma^{n-1}(\mathrm{gain}_n-\lambda)
$$

$$
\Delta G_n>0 \iff \mathrm{gain}_n>\lambda
$$

默认 $\gamma=0.6$，$\lambda=0.15$。折扣不改变单步门槛，只改变累计 $G$ 里远期跳的权重。

### 4.2 字面 $s$ 与机理篇的系统性偏低

对题面 $x=$「齿面粗糙度…热机…磨削」与机理篇 $d=$「导轨油抗爬 / 机械油代用」：

$$
\cos(\mathrm{tf}(x),\mathrm{tf}(d))
$$

共享 bigram 往往少于「齿面粗糙度公差」这类现象篇。设机理篇 $s(x,d)=0.10\sim 0.14$，则

$$
\mathrm{gain}-\lambda \le 0.14-0.15 < 0 \Rightarrow \Delta G\le 0
$$

**正确机理在数学上买不起第二跳**；错误但字面更近的篇反而可能 `gain>\lambda`。  
这不是 λ「设大了」这么简单：根因是 **$s$ 度量与诊断目标不对齐**。把 λ 降到 0 可以多跳，但会放大噪声边（见生产上空转/路径漂移的旧观察）。

### 4.3 Top-K 过小 + limit≤4 → 新篇集合常空

记种子集 $D_0=\mathrm{TopK}_K(q_0)$。第 $n$ 跳查询 $q_n=\mathrm{join}(T\cup\{c\})$ 若仍落在同一主题簇，BM25 常返回

$$
R\subseteq D_0 \quad\Rightarrow\quad R_{\mathrm{new}}=\emptyset \quad\Rightarrow\quad \mathrm{gain}=0
$$

再叠加 `treeNoNewStop=1`，一次空转即停。加大 beam/topK 本可缓解，但 **library 硬限制 4** 把扩容卡死。

### 4.4 入口桥接「帮一把也绑一把」

粗糙度题种子词常被钉成 `爬行→导轨→润滑→油品`。这在 C08-29 上正确；对「换刀不到位」也会被图/桥接到 `接近开关→电磁阀→导轨→润滑`，再被 curated C08-29 污染，**路径看起来像磨床润滑故事**。

### 4.5 Best-of-N 不修正证据

五路独立 PR-RAG，评判

$$
S(y)=0.30A+0.25B+0.20C+0.15D+0.10E
$$

$G$ 不进 $S$，但 $G$ 决定各路 $D_{\mathrm{pack}}$。若五路种子都被同一错误 curated 占槽，则

$$
\mathbb{P}(\text{至少一路证据正确})\approx 1-(1-p)^N
$$

中的 $p$ **并不独立**——多样性入口被「强制第 1 条试点」抵消。覆盖率公式失效。

### 4.6 打包与回树救不了「库错」

现行 PR-RAG：MMR 在 SUPPORT/NEAR 上取 $M\in[4,6]$，再查必须 `ExpandOneHop`。这提高了阅读器信息密度，但：

- 输入候选已被 §3 污染；  
- `Core(gap)` 只修核对缺数 / mustCheck，**不会把错误主方向换成正确案例**；  
- 库外删除答案后，袋里根本没有金句，回树也找不到。

---

## 5. 问题清单（按层）

### A. 数据层

| ID | 问题 | 证据 |
| --- | --- | --- |
| A1 | 可参考层被通用手册/表格淹没 | generic 66,531 / ref 72,534；手册六卷 ~65k |
| A2 | 磨床专属可参考片段极少 | grinder ref = 102 |
| A3 | 无已批准生产记忆 | production_allowed=0，expert 全 pending |
| A4 | 历史案例机型偏铣/车 | case_relations 磨床 7 / 479 |
| A5 | 表格噪声 DF 极高 | 表列/本行 DF≈4.8e4 |
| A6 | 参数阈值不可用 | allow_as_threshold 全 0 |
| A7 | 外部机床数据大量 `reference_allowed=0` | 见机床数据整理报告；灌了也不进默认检索 |

### B. 索引与检索层

| ID | 问题 | 证据 |
| --- | --- | --- |
| B1 | 字 bigram 无语义 | embed/library 均 bigram |
| B2 | 标准号与报警号撞车 | 9177 → JB/T 9177 表行 |
| B3 | `limit` 硬封顶 4 | `library.mjs` `config()` |
| B4 | curated 强制第 1 | 换刀/9177/发热题实测 |
| B5 | 电路/LAD/专有设备常直接拒检 | 正则短路返回空（设计如此，但用户题会「搜不到」） |
| B6 | 精确型号无专属资料则整题拒检 | 防乱借，但也造成「有近邻也不给」 |

### C. 图谱层

| ID | 问题 | 证据 |
| --- | --- | --- |
| C1 | 共现图 ≠ 因果图 | PMI 定义 |
| C2 | 稀有共现 PMI 爆炸 | co=2 → PMI≈8 |
| C3 | hub 跨域（主轴↔换刀/刀库） | 出度表 |
| C4 | `maxNbr` 未真正截断 | 平均出度 25.5 |
| C5 | 指纹漂移会空图降级 | loadTermGraph 行为 |

### D. 推理与分级层

| ID | 问题 | 证据 |
| --- | --- | --- |
| D1 | $s$ 与诊断目标不对齐 | 机理篇 gain 常 < λ |
| D2 | curated→SUPPORT 抬分 | `gradeRecord` |
| D3 | 多跳常 1 跳停 | λ、K、无新篇、noNewStop |
| D4 | 五路证据相关，BoN 增益被抵消 | curated 插队 |
| D5 | 打包/回树不能创造缺失知识 | 库外 0–26% |

---

## 6. 综合：效果差的机制叙事

把一次复杂题推理写成：

$$
x \xrightarrow{\text{分词}} q
\xrightarrow{\mathrm{BM25}+\text{curated插队}} D_0
\xrightarrow{\text{图扩展}+\Delta G} \pi^\star
\xrightarrow{\text{分级+MMR}} D_{\mathrm{pack}}
\xrightarrow{p_\theta} y
\xrightarrow{\text{核对/评判}} y^\star
$$

每一环的误差形式不同：

1. **$q$**：bigram 丢失「词级」单位；扩展词少。  
2. **$D_0$**：先验质量 $P(\text{金句}\in\mathrm{Top4})$ 被手册先验压低；再被错误 curated 挤占。  
3. **$\pi^\star$**：若金句不在 $D_0$ 邻域，或 $s(\text{金句})<\lambda$，图边再对也扩不动；若边是跨域 hub，路径漂移。  
4. **$D_{\mathrm{pack}}$**：错误 SUPPORT 被保底留下；正确 NEAR 可能被 MMR 挤掉。  
5. **$y$**：模型擅长把袋里的句子写成像样方案——**忠实幻觉**：格式对、出处过核对、原因仍错。  
6. **评判 $S(y)$**：奖励可执行性与安全表述，不直接惩罚「选错案例」。

因此线上观感是：有时「说得很专业」，对照金标准却偏；库外更差。这与早期评测「有原文 69% / 删原文 0–26%」一致。

---

## 7. 实测样例（2026-11-12）

脚本：`retrieval-pollution-diag.mjs`（默认 λ=0.15，beam=3）。

| 题 | BM25 第 1 条 | 树跳数 / 路径 | 打包问题 |
| --- | --- | --- | --- |
| 齿面粗糙度 | curated C08-29（对） | 1；爬行→导轨 | 尚可 |
| 中心孔咬毛 | curated C08-34（对） | 2；润滑脂→…→拉毛 | 混入其它 curated/NEAR |
| 换刀不到位 | **C08-29 粗糙度（错）** | 1；接近开关→…→润滑 | **错误 SUPPORT 进袋** |
| 刀塔 9177 | **C08-32 冬季液压（错）** + JB/T 9177 表行 | 1 | 报警语义被标准号淹没 |
| 主轴发热 | **C08-35 汽油抱轴（偏）** | 1；润滑→间隙→供油 | 方向尚可，试点故事过强 |
| 导轨爬行润滑油 | C08-29（大致对） | 3 | 相对最好 |

对照说明：**不是所有题都差**；「库内金句强、题面与试点同簇」时系统可用。差在**分布外题、同形异义、跨机型题**，而这正是现场更多的形态。

---

## 8. 数学上「改什么才对症」（方向，非本期施工单）

按期望收益排序（仍服从：不削弱核对、不把 $(S_n-S_{n-1})_+$ 当 gain、不默认网页）。

1. **检索层去污染（最高杠杆）**  
   - 取消或条件化 curated 插队：仅当 curated 的 $s_{\mathrm{fit}}\ge\tau_{\mathrm{support}}$ 或 id/子系统匹配才插入；  
   - 去掉「curated ∧ ≥NEAR ⇒ SUPPORT」抬分；  
   - `limit` 与树的 $K$ 对齐，去掉硬封顶 4；  
   - 报警号/标准号分流：数字 token 在 `alarm_codes` / 案例标题命中时压制手册 `JB/T|GB/T` 表行。

2. **可参考层分层**  
   - 手册表行降权或默认不进诊断检索；  
   - 提高 `case_entry` / `alarm_entry` / 磨床 `paragraph` 的先验；  
   - 尽快让一小批 `production_allowed=1` 金句存在，供生产模式与评测。

3. **图边质量控制**  
   - 真正执行 `maxNbr`；提高 $\mathrm{co}$ 下限或对 $\mathrm{PMI}$ 用 $\mathrm{PMI}/\sqrt{\mathrm{co}}$ 等稀有惩罚；  
   - 按 `machine_type` 建子图，避免磨床主轴连到铣床刀库；  
   - 图指纹与库版本强制同发布。

4. **相关分与停机**  
   - $s$ 引入子系统 / 卡片 / IDF 元素权重（已有方案文档），再谈调 λ；  
   - 在 $s$ 校准前，不建议为了「看起来多跳」把 λ 降到 0。

5. **评测**  
   - 分开报：检索命中@K、路径是否含金句、打包是否含金句、成稿原因/处置；  
   - 继续区分库内/库外；不要只用 hopsUsed 当改进指标。

---

## 9. 一句话

数据库很大，但**可检索的诊断信号很稀**；图谱有边，但**边是共现不是机理**；检索树在用**字面相似度买跳**，再被 **curated 插队与 SUPPORT 抬分** 绑住。  
所以搜索推理效果差，是数据先验 × 索引单位 × 插队策略 × 非因果图 × 字面 $s$ 的乘积，而不是单一超参没调好。

---

## 附录 A. 关键路径

| 模块 | 路径 |
| --- | --- |
| 主库 | `sama2.0/data/sama_full.sqlite` |
| 词图 | `sama2.0/sama-sqlite/term-graph.json` |
| 图构建 | `sama2.0/sama-sqlite/term-graph.mjs` |
| BM25 | `sama2.0/sama-sqlite/library.mjs` `searchRecords` |
| 树与 ΔG | `sama2.0/retrieval-tree.mjs` |
| 分级打包 | `sama2.0/evidence.mjs` |
| 诊断脚本 | `D:\SAMA\audit\db-kg-diag.mjs`、`retrieval-pollution-diag.mjs` |

## 附录 B. 与旧报告的差异

2026-11-09《知识图谱遍历与推理链长度报告》写 LEXICON≈48、非磨床无节点。此后词表已扩到 ~83 并含换刀/伺服等，**覆盖问题部分缓解，跨域 hub 污染上升**。旧报告中「默认几乎总是 1 跳」在今日样例里仍常见，但个别题（导轨爬行、咬毛）可到 2–3 跳；根因分析应从「没节点」转为「有节点但边不纯 + 检索层污染」。

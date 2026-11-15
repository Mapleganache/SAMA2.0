# SAMA 证据门控与选优方案（文献依据）

日期：2026-11-12  
对照报告：[SAMA-当前版本总结与问题报告-20261112.md](./SAMA-当前版本总结与问题报告-20261112.md)  
代码：`scorer.mjs` `rankScored` / `fusePlanScore`，`judge.mjs`，`evidence.mjs` `decorateTree`  
文献目录：`docs/文献-证据门控与选优/`  
状态：**方案与规格，未改代码**

---

## 0. 结论先说

当前最大问题不是图谱、也不是回树，而是 **选优层把「引用了任意 SUPPORT」当成强证据，硬覆盖五维总分**。库外 20 题从基线 5/3 掉到 1/0，正是这条规则在泛化文档上被利用。

文献对这件事的共识非常明确：

- 检索质量必须先分档，**不能默认 retrieved = useful**（CRAG、RGB、Barnett FP1）；  
- **引用质量 ≠ 答案正确**（ALCE、细粒度引用评估）；  
- 证据、忠实度、答案相关性是 **三轴**，不能并成一个字典序（ARES）；  
- 无精确条目时应 **拒绝自信交付**，而不是换一篇泛化 SUPPORT 当冠军（RGB negative rejection、Kadavath）。

因此本期只改 **Judge 覆盖条件 + 证据置信度 + 库外影子模式**；D_pack 自适应 M 单独 A/B；图谱继续冻结。

---

## 1. 现网问题（对照代码，不只对照报告）

### 1.1 报告已钉死的因果链

```
库外没有精确 CASE/AL/PARAM
  → 所有方案 tier ≤ 2
  → 任意 SUPPORT 引用即可 dictionary-order 压过「没引用但方向对」的稿
  → 多题退到同一泛化片段（如 sqlite_fragment:204412）
  → 主选变成「引用泛化 SUPPORT」，备选里正确方向被换掉
```

20 题：基线 5/3 → 当前 1/0。003 曾出现「备选 yes/yes、主选 partial/no」。

### 1.2 代码里实际在优化什么

`extractPlanEvidence`：

$$
\mathrm{tier}=\begin{cases}
3 & \text{引用了 CASE/AL/PARAM 实体 id}\\
2 & \text{引用了任意 SUPPORT}\\
1 & \text{只引用 NEAR}\\
0 & \text{否则}
\end{cases}
$$

$$
\mathrm{coverage}=\frac{|\text{引用且在包内的 id}|}{|D_{\mathrm{pack}}|}
$$

`fusePlanScore`：

$$
E=10\bigl(0.45\,T+0.25\,C+0.15\,S+0.15\,M\bigr),\quad T=\mathrm{tier}/3
$$

$$
\mathrm{accuracy}=\min\bigl(0.7E+0.3\cdot A_{\mathrm{LLM}},\; \mathrm{cap}(\mathrm{tier})\bigr)
$$

$\mathrm{cap}=(5,6.5,8,10)$。伪造 id 再把 accuracy 封到 4。

`rankScored` 的比较键是 **字典序**：

$$
\pi^\star=\arg\max\;(\mathrm{tier},\; E,\; \mathrm{total},\; \mathrm{safety},\; \mathrm{accuracy})
$$

两处都会让泛化 SUPPORT 赢：

1. **排序**：tier 2 永远压过 tier 1/0，无论 total 差多少。  
2. **分数**：accuracy 的 70% 来自 E；tier 2 时 $T=2/3$，即使 coverage=0.10，$E$ 仍可 $>5$，再把 LLM 的原因分压扁。

`coverage` 还不是「必查项覆盖」，只是「引用了袋子里百分之几」。包越大，coverage 越容易停在报告说的 6%–15%，但 **tier 2 已经足够夺冠**。

### 1.3 和数据层的耦合

库外没有实体条目时，SUPPORT 经常是手册/近邻泛化篇。`gradeRecord` 对 `sqlite_curated:*` 还有 NEAR→SUPPORT 抬分。于是：

> 系统会奖励「会引用袋子里看起来像证据的东西」，而不是「原因对上了本机那条精确证据」。

这就是报告第 5 节的核心矛盾。图谱、入口、IDF 实验失败，不能用来推迟修 Judge：它们改的是 $D$，当前崩在 $D$ 已经给定之后的 **选 $\pi^\star$**。

### 1.4 次要问题（本期不混进 P0）

| 编号 | 现象 | 为何先不并刀 |
| --- | --- | --- |
| P1 | 库外无精确条目，准确率有天花板 | 数据工程，改 Judge 只能「少错」 |
| P2 | 无 SUPPORT 时 M=8–10 | 与 Judge 一起上无法归因 |
| P3 | 回树触发率未统计 | 通道已接，先回归不要改语义 |
| P6 | PMI 图 hub 串味 | 带类型边 0/20，冻结 |

---

## 2. 文献怎么说（只收能对上现网的）

PDF 均在 `docs/文献-证据门控与选优/`。已有副本同时在 `文献-方向契合与证据选路/`。

### 2.1 检索质量必须分档，不能「有引用就信」

**CRAG**（Yan et al., 2024, arXiv:2401.15884）  
检索评估器输出 Correct / Ambiguous / Incorrect。Correct 才用原检索；Incorrect 丢掉（他们默认联网，SAMA **不采用网页**）；Ambiguous 才混合。核心句：RAG 的可靠性取决于检索质量，检索错了必须改动作，而不是继续当金标准。

映射到 SAMA：现在的 tier 2 =「袋子里有一篇 SUPPORT」≈ CRAG 的 Ambiguous，却被当成 Correct。

**RGB**（Chen et al., AAAI 2024, arXiv:2309.01431）  
四个能力：噪声鲁棒、**负拒绝**、信息整合、反事实鲁棒。LLM 在「检索集里没有答案」时最弱，倾向硬编。库外正是 Negative Rejection 场景。

**Seven Failure Points**（Barnett et al., CAIN 2024, arXiv:2401.05856）  
FP1 Missing Content：问题在库里没有答案时，系统会被「相关但不够」的文档骗出回答。FP6 Incorrect Specificity：返回太泛。库外主选引用同一泛化片段，就是 FP1+FP6。

**The Power of Noise**（Cuconasu et al., SIGIR 2024, arXiv:2401.14887）  
**语义相近但不含答案的 distractor 比随机噪声更伤。** 库外 SUPPORT 正是这类 distractor：字面像、不是那条案例。把它们的引用权放到 total 之上，等于系统性地偏好伤害项。

### 2.2 引用 / 忠实 ≠ 正确

**ALCE**（Gao et al., EMNLP 2023, arXiv:2305.14627）  
评测拆成 fluency / correctness / citation quality。ELI5 上最好模型仍有约一半陈述缺完整引用支持。反过来也成立：citation 好不等于 correctness 高——可以完整引用一篇不对题的文档。

**Fine-grained citation**（Zhang et al., 2024, arXiv:2406.15264）  
引用支持应分成 full / partial / no。二值「引用了 SUPPORT」抹掉 partial。SAMA 的 tier 2 正是二值门。

**Self-RAG**（Asai et al., ICLR 2024, arXiv:2310.11511）  
用不同 reflection token：是否相关（ISREL）、是否支持生成（ISSUP）、是否有用（ISUSE）。**相关且被引用，不等于最终该回答。** 我们不训练这些 token，但程序上必须分开：tier/coverage 是 ISREL/ISSUP，total 才接近 ISUSE。字典序用 ISSUP 覆盖 ISUSE，违反 Self-RAG 的拆分。

**Knowledge Conflicts**（Longpre et al., 2021, arXiv:2109.05052）  
检索到的替代事实会覆盖参数知识。库外泛化 SUPPORT 相当于「替代事实」：不是反事实，但是错误实例。门控越硬，冲突时越听检索。

### 2.3 评估必须三轴，LLM Judge 有偏

**ARES**（Saad-Falcon et al., NAACL 2024, arXiv:2311.09476）  
RAG 评估三轴：**context relevance / answer faithfulness / answer relevance**。好系统三者都高。SAMA 现在用 faithfulness 的粗代理（tier）去选 relevance 冠军。

**LLM-as-a-Judge**（Zheng et al., NeurIPS 2023, arXiv:2306.05685）  
位置偏、冗长偏、自我增强。引用一串 id、写得更像「有依据」的稿更吃分。`0.7E+0.3A_LLM` 把这种表面依据再放大。

**RankGPT**（Sun et al., EMNLP 2023, arXiv:2304.09542）  
LLM 适合做 **文档重排**，不是用「有没有引用」做方案总排序。方案排序应仍以任务效用为主，证据只做约束/展示。

**Let's Verify Step by Step**（Lightman et al., 2023, arXiv:2305.20050）  
过程监督优于只看结果。SAMA 已有 mechanism 层。用引用 tier 覆盖总分，等于丢掉过程分——库外 003 备选方向对、主选引用完整但错，就是 outcome 信号压过 process。

### 2.4 不确定时不要装成确定

**Kadavath et al.**（2022, arXiv:2207.05221）  
模型对「自己会不会」有一定校准，显式不确定比装懂好。程序侧对应：包内无实体条目 ⇒ 高不确定 ⇒ 证据只展示，不改 winner。

**Adaptive-RAG**（Jeong et al., NAACL 2024, arXiv:2403.14403）  
按复杂度选策略，不是一条管道走到底。SAMA 已有 simple/complex；缺的是 **按证据置信度** 选「门控排序 vs 影子排序」。库外 = 证据策略应降档，不是升档。

**Lost in the Middle**（Liu et al., TACL 2024, arXiv:2307.03172）  
上下文变长，中间证据被读丢。无 SUPPORT 时把 M 从 5 拉到 8–10，可能提高召回，也可能制造 FP4（有答案抽不出来）。必须单独 A/B。

---

## 3. 文献 → 现网对照表

| 现网行为 | 文献定性 | 应改成 |
| --- | --- | --- |
| 任意 SUPPORT ⇒ tier 2 ⇒ 字典序第一 | CRAG 把 Ambiguous 当成 Correct | 仅 Correct（实体）或高置信 Ambiguous 才覆盖 |
| coverage=6%–15% 仍覆盖 | ALCE/细粒度：partial 不能当 full | 覆盖门槛 $\tau_C$ 或证据分 $\tau_E$ |
| 库外无实体仍硬门控 | RGB 负拒绝失败；Barnett FP1 | 影子模式：证据展示，按 total 选 |
| accuracy=0.7E+0.3A | Zheng 冗长/依据外表偏 | 低置信时提高 $A_{\mathrm{LLM}}$ 权重 |
| curated NEAR 抬成 SUPPORT | Cuconasu distractor | 不在本期改分级；门控侧不把弱 SUPPORT 当 Correct |
| 无 SUPPORT 则 M=8–10 | Lost in the Middle；Barnett FP3/FP4 | 冻结默认 M=5，单独 A/B |
| 带类型图谱 | 已 0/20 | 继续冻结 |

---

## 4. 方案：条件门控选优（CG-Rank）

名称：**Conditional Gate Ranking**。不训练、不联网、不改 ΔG、不改核对、不动图。

### 4.1 证据状态机（CRAG 的本地版）

对每条方案，先算现有 `feature`，再映射状态：

$$
\mathrm{state}(y)=\begin{cases}
\texttt{CORRECT} & \mathrm{tier}=3\\[4pt]
\texttt{AMBIG} & \mathrm{tier}=2 \land \bigl(C\ge \tau_C \lor E\ge \tau_E\bigr) \land \mathrm{contradiction}=0\\[4pt]
\texttt{WEAK} & \text{otherwise}
\end{cases}
$$

建议初值（来自报告第 4 节，可用 20 题校准，不拿留出金答案做跳数验证）：

$$
\tau_C=0.30,\qquad \tau_E=7
$$

包级标志：

$$
\mathrm{precise}(D)=\mathbf{1}[\exists d\in D:\ \mathrm{id}(d)\text{ 为 CASE/AL/PARAM}]
$$

库外 / 无精确条目：$\mathrm{precise}=0$。

### 4.2 谁可以覆盖总分

$$
\mathrm{override}(y,D)=\bigl[\mathrm{state}(y)=\texttt{CORRECT}\bigr]
\;\lor\;
\bigl[\mathrm{precise}(D)=1 \land \mathrm{state}(y)=\texttt{AMBIG}\bigr]
$$

- 有精确条目且方案真正引用了它 → 允许证据覆盖（这是门控存在的理由：防止「写得好但不引用案例」压过「引用了本机案例」）。  
- 仅有泛化 SUPPORT → **不覆盖**。  
- 无精确条目（典型库外）→ 全组影子模式。

### 4.3 两套排序

**交付排序**（改 `rankScored`）：

$$
\pi^\star=
\begin{cases}
\arg\max\limits_{y\in\mathcal{Y}_+} (\mathrm{tier},\,E,\,\mathrm{total}) & \exists y:\mathrm{override}(y,D)=1\\[8pt]
\arg\max\limits_{y\in\mathcal{Y}_+} (\mathrm{total},\,\mathrm{safety},\,\mathrm{mechanism}) & \text{影子模式}
\end{cases}
$$

$\mathcal{Y}_+$ 仍是 `eligible`：无伪造 id、mechanism≥5、safety≥2。这一条保留。

影子模式下证据 **照常写入** `evidence.tier/coverage/score` 和展示栏，**不进入比较键**。这就是报告说的「库外 Judge 影子模式」。

**推荐条** `recommendable` 收紧为：

$$
\mathrm{recommendable} \iff \mathrm{eligible}\land \mathrm{state}\in\{\texttt{CORRECT},\texttt{AMBIG}\}\land \mathrm{safety}\ge 3
$$

影子模式冠军若 WEAK：界面继续「只交付待验证方向」，但 **winner 按总分选**，不再把泛化引用稿送去当第一名。

### 4.4 accuracy 融合随状态变权（ARES 三轴）

现式 $0.7E+0.3A$ 在 WEAK 时把 distractor 写进 accuracy。改为：

$$
\mathrm{accuracy}=
\begin{cases}
\min(0.7E+0.3A,\;10) & \texttt{CORRECT}\\
\min(0.5E+0.5A,\;8) & \texttt{AMBIG}\\
\min(0.2E+0.8A,\;6.5) & \texttt{WEAK}
\end{cases}
$$

伪造 id 仍封顶 4。  
CORRECT 保持「证据权重大」——有实体条目时这是对的。WEAK 把权交回 LLM 五维和过程分。

不把 $G$（检索路径分）加进 $S$。文献（报告既有约束）要求记忆选择与成稿选择分离。

### 4.5 coverage 口径（可选但建议同期改）

现 $C=|\mathrm{cited}|/|D_{\mathrm{pack}}|$ 随 M 漂移，M=8–10 时更难到 0.30。改为：

$$
C'=\max\bigl(C_{\mathrm{pack}},\; C_{\mathrm{support}}\bigr)
$$

$$
C_{\mathrm{support}}=\begin{cases}
n_{\mathrm{SUPPORT\ cited}}/n_{\mathrm{SUPPORT\ in\ pack}} & n_{\mathrm{SUPPORT\ in\ pack}}>0\\
0 & \text{otherwise}
\end{cases}
$$

$C_{\mathrm{support}}$ 已有 `supportRatio`，只是没进覆盖门槛。AMBIG 判定用 $C'$ 代替 $C$。

不要用 `gaps.mjs` 的机型/冷热四项当 coverage——那是门控提问，不是证据缺口。

### 4.6 与核对的关系

`checkGrounding` 继续做数字/id 硬约束，**不合并进 rankScored**。三套裁判维持：

| 裁判 | 管什么 |
| --- | --- |
| ΔG | 树跳不跳 |
| grounding | 数值是否在观察里 |
| CG-Rank | 谁当冠军、能不能推荐拆卸步骤 |

文献上这对应 ARES 的 faithfulness（grounding）与 answer relevance（选优）分离。

---

## 5. 为什么这么改能对上失败模式

### 5.1 直接修 5/3 → 1/0

失败机制：五路里有一路方向对但少引 SUPPORT，另一路引用泛化 SUPPORT。字典序选后者。

CG-Rank 下库外 $\mathrm{precise}=0$，走影子模式，winner 回到 total。预期回到基线量级（≥5/3），这是 P0 验收。

003 类「备选对、主选错」应变为主选对，或至少主选不再被泛化引用换掉。

### 5.2 库内有实体条目时门控仍在

库内 50 题基线 46/42，说明 **有金句时引用约束是正收益**。override 在 CORRECT 时仍启用，避免「文笔好但不引案例」赢。这是门控当初要解决的事，不能整段删掉。

### 5.3 不靠训练 Self-RAG / 不联网 CRAG

Self-RAG 要训 reflection token；CRAG Incorrect 默认网页。产品约束禁止这两条。用 **可编程的 state** 代替评估器网络，用 **影子模式** 代替网页补检。

### 5.4 不把不确定装成确定

RGB + Kadavath + Barnett FP1：没答案时最差的是自信的错答。`recommendable=false` 保留；只改「谁是 winner」。用户仍看到待验证方向，但第一名不再是那篇 204412。

---

## 6. D_pack 自适应 M：单独方案，不与 P0 绑死

`decorateTree` 现：有 SUPPORT 则 M=`treePackM`(5)，否则 `max(8, baseM)`。

文献：

- Lost in the Middle：M 变大，中间证据掉点；  
- Cuconasu：不含答案的近邻篇是 distractor；  
- Barnett FP3/FP4：袋变大反而抽不出。

故：

1. P0 实验时 **冻结 M=5**，否则无法归因 1/0。  
2. 之后 A/B：`M=5` vs `无 SUPPORT 时 M=8`，20 题原因不下降才留自适应。  
3. 若 A/B 显示稀释，则无 SUPPORT 时宁可 M=5 + unknown，也不灌 10 条 NEAR。

MMR $\lambda=0.75$、丢掉 IRRELEVANT、保底 1 SUPPORT+1 NEAR：与 Carbonell MMR / 既有 PR-RAG 规格一致，**不动**。

---

## 7. 明确不做

| 做法 | 原因 |
| --- | --- |
| 训练 Self-RAG / CRAG 评估器 | 无标注训练环；程序 state 已够用 |
| Incorrect → 网页 | 产品关网页；网文不能当本机判据 |
| 再上带类型图谱 | 20 题 0/0 |
| 再开元素 IDF 入口 | 与基线持平且削弱原句 BM25 |
| 用 $(S_n-S_{n-1})_+$ 当 gain | 机理篇差分为 0 |
| 把 G 加进评判 | 检索长路径 ≠ 可执行 |
| 用留出金答案验证跳数 | 既有约束 |
| 把 coverage 改成 gaps 四项 | 那是提问门控 |
| 同期改自适应 M 和 Judge | 无法归因 |

---

## 8. 落地顺序与验收

### 步骤（只动 `scorer.mjs` + 少量 `judge.mjs` 展示文案）

1. 实现 `state` / `override` / 影子模式；`rankScored` 按 §4.3。  
2. `fusePlanScore` 按 §4.4 变权；`recommendable` 按 §4.3。  
3. coverage 改 $C'$（§4.5）。  
4. 冻结 `packSize=treePackM`（临时关自适应）。  
5. 单测：  
   - tier2 coverage=0.1 不压过高 total；  
   - tier3 仍压过未引用实体的高 total；  
   - 伪造 id 仍封顶；  
   - precise=0 时排序键不含 tier。  
6. 20 题库外：原因/处置 **≥5/3**，且不再出现「多题主选同一泛化 SUPPORT 硬夺冠」。  
7. 20 题不应用留出金句做 hop 统计；只看主选对错与是否换冠。  
8. 通过后再 50 题 in/out：库内不显著掉（≥46/42），库外目标 ≥17/12 是 **数据天花板**，P0 只要求不低于基线 17/12 的「不回退」；20 题先回到 5/3。

自适应 M 的 A/B 列为 P1，**另开实验开关** `SAMA2_PACK_ADAPT=0/1`。

### 伪代码

```text
function CG_Rank(plans, pack):
    precise ← pack has CASE/AL/PARAM
    for y in plans:
        f ← extractPlanEvidence(y, pack)
        y.state ← CORRECT | AMBIG | WEAK   # §4.1
        y.accuracy ← fuse(f, y.A_llm, y.state)  # §4.4
        y.override ← (state=CORRECT) or (precise and state=AMBIG)
        y.recommendable ← eligible and state in {CORRECT,AMBIG} and safety≥3
    if any(y.override):
        sort by (tier, E, total)
    else:                          # 影子模式
        sort by (total, safety, mechanism)
    return ranked, shadow=not any(override)
```

---

## 9. 风险

- **库内回归**：若大量库内题没有实体 id、只有 fragment SUPPORT，影子模式会关掉门控，可能让「文笔好」赢。缓解：实体检测覆盖 CASE/SCASE/AL/PARAM **以及** `sqlite_curated:` 且 grade=SUPPORT 且 fit≥0.42 可视为 soft-precise，但 **必须 fit 高**；宁可不把 curated 抬成 CORRECT（历史上 curated 插队是污染源）。  
- **$\tau_C=0.30$ 过严**：AMBIG 几乎进不去，全走影子。库内有实体时仍有 CORRECT。先死守「不覆盖」，再用 20 题看 AMBIG 触发率。  
- **Judge JSON 截断**：与门控无关，继续 high effort / 6000 tokens。  
- **小样本 ±2**：20 题过了必须 50 题复核。

---

## 10. 一句话

CRAG/RGB/ALCE/ARES 说的是同一件事：**没有精确证据时，引用不能当正确性。**  
现网 `rankScored` 用 tier 字典序把 Ambiguous 当成 Correct，所以库外 5/3 变成 1/0。  
改法是条件覆盖 + 库外影子模式：有实体才让证据改冠军，否则证据只展示、总分说话。图谱和入口先别动。

---

## 附录 A. 文献包

路径：`docs/文献-证据门控与选优/`

| 文件 | 出处 | 本方案角色 |
| --- | --- | --- |
| `Yan-2024-CRAG.pdf` | arXiv:2401.15884 | Correct/Ambiguous/Incorrect 状态机 |
| `Chen-2024-RGB.pdf` | AAAI 2024 / 2309.01431 | 负拒绝；库外不应硬答 |
| `Barnett-2024-Seven-Failure-Points-RAG.pdf` | CAIN 2024 / 2401.05856 | FP1 缺内容、FP6 过于泛 |
| `Cuconasu-2024-Power-of-Noise.pdf` | SIGIR 2024 / 2401.14887 | 近邻 distractor 伤害 > 随机噪声 |
| `Gao-2023-ALCE-Citations.pdf` | EMNLP 2023 / 2305.14627 | 引用质量 ≠ 正确性 |
| `Zhang-2024-Fine-Grained-Citation.pdf` | 2406.15264 | full/partial/no，禁止二值 SUPPORT 门 |
| `Asai-2023-Self-RAG.pdf` | ICLR 2024 / 2310.11511 | ISREL/ISSUP 不得覆盖 ISUSE |
| `SaadFalcon-2024-ARES.pdf` | NAACL 2024 / 2311.09476 | 相关 / 忠实 / 答案相关 三轴 |
| `Zheng-2023-LLM-as-Judge.pdf` | NeurIPS 2023 / 2306.05685 | Judge 外表依据偏 |
| `Sun-2023-RankGPT.pdf` | EMNLP 2023 / 2304.09542 | LLM 适合重排文档，不适合用引用选总冠军 |
| `Jeong-2024-Adaptive-RAG.pdf` | NAACL 2024 / 2403.14403 | 按证据置信度降档策略 |
| `Kadavath-2022-Know-What-They-Know.pdf` | 2207.05221 | 不确定就不要装确定 |
| `Liu-2023-Lost-in-the-Middle.pdf` | TACL 2024 / 2307.03172 | 自适应 M 必须单独 A/B |
| `Lightman-2023-Verify-Step-by-Step.pdf` | 2305.20050 | 过程分不可被引用分覆盖 |
| `Longpre-2021-Knowledge-Conflicts.pdf` | 2109.05052 | 检索冲突时硬门控会听错文档 |

## 附录 B. 与 11-12 报告建议的差异

报告原文建议：

> tier=3，或 tier=2 且 coverage≥0.30 或 E≥7，才允许覆盖；库外影子。

本方案 **采纳**，并补三处代码级约束：

1. AMBIG 覆盖必须 `precise(D)=1`，防止库外用「coverage 凑到 0.30 的泛化袋」重新夺冠；  
2. WEAK 时 accuracy 权重改 0.2/0.8，否则字典序关了、E 仍会从总分里把冠军拽回去；  
3. P0 实验冻结自适应 M，避免二次混淆。

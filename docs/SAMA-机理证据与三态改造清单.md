# SAMA 改造清单：机理卡、鉴别追问、三态输出（修订）

日期：2026-11-09（修订，吸收评审：不得按字面改 `fitScore` / `unknown`）  
依据：桌面报告《工业智能 Agent 从封闭知识库问答向开放故障诊断转型》  
现状：`sama2.0/`（检索树 + 证据分级 + 前两名交付 + v2 结构化查表）  
配套：[原因与方法分项表](./SAMA-原因与方法分项表.md) · [测试总报告](./datasets/SAMA-测试总报告.md)

不要换模型，不要加长通用 Prompt，不要上实时振动 FFT，不要改 `fitScore` 主公式。按这份**修订后**的清单改程序和评价口径。

---

## 0. 边界（先于一切实现）

当前生产口径（2026-11-08）：库内 50 题原因 **92%** / 处置 **84%**；库外 50 题 34% / 24%；结构化表 676 报警 + 319 参数 + 844 案例（不限磨床）。按字面改打分或 unknown，会把查表题和库内案例一并做坏。

| 护栏 | 规则 |
| --- | --- |
| 路由隔离 | `unknown` / 两节标题 / 机理 veto / 鉴别问 **只对 complex（含 boundary 采样）生效**。simple 走查表状态 `lookup_hit / lookup_miss / lookup_none`。 |
| 打分主路径 | `fitScore` 的 `cosine / overlap / bridgeHit` **不改**。卡片只加 `+CARD_FIT_BONUS`（默认 0.08），且仅磨床域。 |
| 开关 | `SAMA2_CARDS=0` 关闭卡片加成、veto、鉴别问（标题兜底和 simple 查表状态仍保留）。 |
| 反证 | against 先做否定词处理；拿不准只降权，不 veto。非磨床题卡片只作参考，不 veto。 |
| 评测 | 主指标是 **50/50 题库 + 40 题回归**，不是留出 8 题。 |

---

## 1. 评价口径（P0）

报告要的四格：原因对方法对 / 原因对方法错 / 原因错方法对 / 都错。主表见 `docs/SAMA-原因与方法分项表.md`。

冻结题库：

- 库内 50 / 库外 50：`D:\SAMA-data\corpus\机床数据\eval50\`
- 40 题开卷/闭卷回归：`D:\SAMA-data\corpus\机床数据\eval40\`
- 留出 8 题 + 正控 31/32/33 **只作历史对照**，不入消融主表。

### 1.1 成稿两节标题（程序兜底，只对 complex）

交付文本需要：

- `### 原因（待验证）`
- `### 方法（仅针对上一节）`

`prompts.mjs` 的 `mustFinish` 写上这两节（提高概率）。**成稿后**由 `ensureTwoSections()` 检查：缺标题则按段落切分插入；`unknown` 时不保留拆卸/换件方法节。校验失败可视为已由程序补全，不必为标题再调一次模型。

simple 查表 **不强制** 两节。

---

## 2. 机理卡（P2）：附加特征，不是重写打分

### 2.1 `sama2.0/mechanism-cards.mjs`

第一批 2 张，对应现 `BRIDGES[0]/[5]` 与 `BRIDGES[1]/[3]`。顶尖咬毛第二批。

每张卡：`id, subsystem, domain:'grind', structure, mechanism, symptoms, support, against, discriminate, nextCheck, repair`。

`against` 用短键而不是整句，便于否定处理，例如：

- 导轨卡：`冷机同样差` / `已换导轨油` / `振纹`+`砂轮转速`
- 主轴卡：`冷机同样发热` / `已换油仍抱轴`

匹配规则：

1. 命中键之前 8 字内出现 `不/没/未/无/非` → **不是 veto**，只降权。
2. 键本身没出现 → 不处理。
3. 键出现且无否定 → grind 域才 veto；非磨床域只标 `reference`。

磨床域判定（只看用户原文/已识别机型，**不用**「按磨削中假设」）：

- 正向：磨床 / 外圆磨 / 砂轮 / STUDER / 斯图特 / MIKROSA 等
- 反向：车床 / 加工中心 / 铣床 / 刀库 / 换刀，且没有磨床词 → 非磨床
- 机型未知 → 参考，不 veto、不加分、不问鉴别

### 2.2 接到现有代码（修订）

| 文件 | 改法 |
| --- | --- |
| `retrieval-tree.mjs` `BRIDGES` | **不改**。检索扩展仍走原桥接词。 |
| `evidence.mjs` `fitScore` | **不改** `aligned = max(overlap, bridgeHit)`。`gradeRecord` 在 `fitScore` 之后、且 `cardsEnabled && isGrindDomain` 时 `score += 0.08`（命中该卡 mechanism/support 词）。 |
| `evidence.mjs` `fallbackDirection` / `sanitizeDirection` | 磨床域且卡未被 against 打死时，可用卡的 `mechanism` 填空的主方向；已被 veto 的卡不得作 `main_direction`。 |
| `prompts.mjs` | 观察区多一段【机理约束】（当前命中卡 + 反证）。非磨床标「仅参考」。 |
| `brief.mjs` | 命中卡的 `nextCheck` **追加**进必查项，不替换模型简报。 |
| 开关 | `resolveConfig().cardsEnabled`，环境变量 `SAMA2_CARDS`（默认开，`=0` 关）。 |

---

## 3. 鉴别性追问（P3）

四项门控仍然只管机型/现象/工况/冷热。鉴别问 **不是** 第五项必填。

同时满足才问 **1 句**（问句必须来自卡，禁止模型自造）：

1. `cardsEnabled`
2. 磨床域
3. `askedCounts.discriminate < 1`
4. 第一、第二名属于**不同**机理卡
5. **低置信**：没有结构化 `SUPPORT`（无 `case_entry` / `alarm_entry` 注入），且 `processScore < 2`（或两卡分差 &lt; 0.5）
6. 两张卡的 `discriminate` 有尚未在原文出现答案的问句

有结构化命中（库内 92% 的主路径）**不问**。非磨床不问。

实现：`sampleWave` 在五路树 + `decorateTree` 之后、ReAct 之前若命中，直接 `need_info` 只问这一句。补完后 `askedCounts.discriminate = 1`，进入评分，不重开追问。

---

## 4. 第三态 unknown（P1）

### 4.1 判定（按路由）

**simple**

```
lookupStatus =
  报警/参数/案例表命中     → lookup_hit     // 正常查表答案
  明确有报警号但表中没有   → lookup_miss    // 已有「查不到」约束，不是 unknown
  无查表意图               → lookup_none    // 概念题，保持现 simple 答复
```

**complex / boundary 采样**

```
status =
  有结构化 SUPPORT（案例/报警条目）或 processScore>=2 且有 sqlite 引用 → confirmed
  processScore==1 或 仅有 NEAR                                         → provisional
  processScore==0 且无 NEAR 且无结构化命中
    或（磨床域下两张卡都被 against 打死）                              → unknown
```

`unknown` **不得**因 `processScore==0` 打到 simple 上。complex 只要命中 `case_entry`/`alarm_entry` 就不是 unknown。

`unknown` 时：不输出拆卸/换件/定油压步骤；正文保留缺口与转交现场；页面第一张卡不用绿框「推荐」，标题改为「无法可靠诊断」。

不要用模型自称的置信度百分比。

---

## 5. 明确不要做

- 不换大模型、不把 Prompt 加到「请一步步深呼吸」
- 不把 `hopCost` 改成 0 来制造两跳
- 不把留出集金标写回提示词或树
- 不接 FFT / 包络谱；不引入 Neo4j
- 不让五路互相讨论选冠军
- 不把合成案例写进 SQLite
- 不放开 `ask_user` 在补充之后继续追问轴承型号
- **不改 `fitScore` 主公式，不用 8 题留出当消融主指标**

---

## 6. 实施顺序与验收

| 顺序 | 项 | 验收 |
| --- | --- | --- |
| P0 | 分项表 + 两节标题程序兜底 | `test-flow` 复杂题成稿含两节标题；simple 不含强制标题 |
| P1 | `diagnosisStatus` 仅 complex；simple 用 lookup | 报警查表不是 unknown；全 IRRELEVANT 的 complex 为 unknown |
| P2 | 卡片附加分 + 开关 + against 否定 + domain | `SAMA2_CARDS=0` 时 `fitScore` 与改前一致；「没有换过导轨油」不 veto |
| P3 | 鉴别问低置信触发、只问 1 句 | 有结构化 SUPPORT 不问；磨床双卡且无 SUPPORT 才问 |
| P4 | 50/50 + 40 题回归作消融底表 | 见分项表；本轮不跑满量评测，只把口径冻住 |

对照实验列：当前 Agent / +标题兜底 / +unknown / +卡片 / +鉴别问。测试案例和评价口径冻结后才能比。

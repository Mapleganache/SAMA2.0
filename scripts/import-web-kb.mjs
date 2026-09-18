/**
 * 从已审核的公开资料写入知识库（非整本盗版入库）
 * 运行：node scripts/import-web-kb.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const docsRoot = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'sama',
  'sama-data',
  'kb',
  'docs',
)
const tools = path.join(
  os.homedir(),
  '.cursor',
  'projects',
  'c-Users-Desktop-SAMA',
  'agent-tools',
)

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true })
}

function writeDoc(rel, content) {
  const abs = path.join(docsRoot, rel)
  ensureDir(path.dirname(abs))
  fs.writeFileSync(abs, String(content).trim() + '\n', 'utf8')
  console.log('wrote', rel, 'chars=', String(content).length)
}

function clipAround(text, needle, before = 200, after = 3500) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return ''
  return text.slice(Math.max(0, i - before), Math.min(text.length, i + after))
}

function extractChunks(text, needles, maxPer = 4000, limit = 120000) {
  const parts = []
  let total = 0
  for (const n of needles) {
    const c = clipAround(text, n, 80, maxPer)
    if (!c) continue
    parts.push(`### 摘录：${n}\n\n${c.trim()}`)
    total += c.length
    if (total >= limit) break
  }
  return parts.join('\n\n---\n\n')
}

ensureDir(docsRoot)

writeDoc(
  'SOURCES_AUDIT.md',
  `# 知识库网络资料审核记录

审核日期：2026-08-04
原则：不收录盗版全书；优先官方公开 PDF 要点摘录 + 可核验公开技术笔记；每条注明出处。

## 通过（已收入）

| 来源 | 类型 | 处理 |
|------|------|------|
| FANUC America PICTURE 产品页 | 官方公开 | 整理为 PICTURE 能力概述 |
| 本机已有 B-66284CM/EN PDF | 用户自有手册 | 已抽取文本（先前完成） |
| Zappettini：FANUC PMC / Turning | 公开技术 wiki（引用官方手册编号） | 中文整理 PMC 与车床循环要点 |
| Siemens SINUMERIK Fundamentals 6FC5398-1BP40-3BA1 | 官方公开 PDF | 关键编程要点摘录 |
| Mitsubishi M800/M80 Programming Manual（官网） | 官方公开 PDF | 关键编程/结构要点摘录 |
| Heidenhain TNC 640 ISO / Cycle（官网） | 官方公开 PDF | 关键模式与循环要点摘录 |
| 行业公开 PMC 地址说明 | 公开技术文 | 整理电气/PMC 地址与排查 |

## 拒绝 / 不整本入库

| 来源 | 原因 |
|------|------|
| Scribd / pdfcoffee / 不明网盘整本 FANUC 手册 | 版权不明或疑似盗版整本 |
| GitCode「开源」B-66284 整本镜像 | 版权归属不清，不重复整本入库（用户本机已有合法 PDF） |
| cncmanuals.com 整本镜像站 | 不整本爬取；仅参考目录结构核对 |

## 使用注意

摘录仅供本机 RAG 检索辅助维修写码。正式参数、报警与安全以机床随机说明书和厂家授权手册为准。
`,
)

writeDoc(
  'FANUC/picture_from_official_public.md',
  `# FANUC PICTURE（CAD PICTURE）公开资料整理

> 来源审核：FANUC America 产品页 https://www.fanucamerica.com/products/software/fanuc-picture ；手册编号 B-66284EN/CM。用户本机已有完整操作 PDF 抽取件。

## 是什么
在 PC 上设计 CNC 用户画面（HMI），转换后由机床标准液晶屏直接显示，无需另配 PC 显示。

## 官方强调能力
- 多分辨率 / 触摸屏 / 虚拟键盘 / 多语言
- WYSIWYG 编辑：按键、开关、按钮、灯、刻度等控件
- 多数对象可调参数；偏「画图+填参数」，而非写底层程序
- 工程、变量、描述与翻译可导入导出
- 支持定时/事件驱动脚本做复杂逻辑
- 随机床与产线演进可改 HMI

## 维修写码注意（结合本机手册）
- 工程 \`.fp2\` 是索引；画面本体多为 \`FPicture*.xml\`，根节点 \`<FANUCPicture>\`，常为 UTF-16
- 带输入数值显示用 FPInput；键入缓冲 FPKyInBf 一屏通常一个
- 宏读写：\`rdmacro\` / \`wrmacro\`；焦点索引不可重复
- 交付：PC 编辑 → 转换 MEM → 卡/网络加载 → 机上验证
`,
)

writeDoc(
  '通用/CIRCUIT/pmc_signal_map_reviewed.md',
  `# 机床电路 / FANUC PMC 信号地图（审核整理）

> 主要依据公开技术文对官方手册 B-61863E、B-64724EN、B-64725EN 的转述整理。地址范围因 PMC 型号而异，以本机电气图与 PMC 说明书为准。

## 三层结构
\`\`\`
CNC  <--G--  PMC(梯子)  <--X--  机床(开关/阀/电机)
     --F-->           --Y-->
\`\`\`
零件程序跑在 CNC；实物在机床侧；中间 PMC 扫描执行机床厂梯子。

## 地址字母（PMC 视角）
| 字母 | 含义 | 典型用途 |
|------|------|----------|
| X | 机床→PMC 输入 | 限位、压力、急停、刀库确认 |
| Y | PMC→机床 输出 | 电磁阀、接触器、冷却泵、灯 |
| F | CNC→PMC | M 选通、循环中、报警状态 |
| G | PMC→CNC | 启动/进给保持、FIN、联锁、模式 |
| R | 内部继电器 | 中间逻辑 |
| A | 信息/报警请求 | 机床厂自定义报警信息 |
| K | 保持型继电器 | 断电保持的选项开关 |
| T/C | 定时器/计数器 | 润滑间隔、计数 |
| D | 数据表 | 刀套表、托盘数据等 |

固定输入（多机常见，仍需核对）：急停 \`*ESP\` 常在 X8.4；SKIP 等有固定位。

## M 代码握手（无报警却卡住的常见原因）
1. CNC 发出 M 码 + 选通 MF（如 F7.0）
2. 梯子解码并驱动 Y，等待反馈 X
3. 梯子回 FIN（如 G4.3）后 CNC 才执行下一段
若 MF=1 而 FIN=0：多半在等某个 X（门、压力、刀套）。先拍照 STATUS 再复位。

## 机上排查顺序
1. CNC 报警屏 + PMC 报警
2. 诊断等待状态（倍率 0、联锁、主轴到达等）
3. STATUS 看 MF/FIN 与相关 X
4. 核对 K 继电器相对备份是否被改
5. 梯子 STOP 则整机无响应——先查 PMC 运行状态

## 安全
改梯子/K/D 前完整备份（含 .LAD）。不明 K 位可能关乎整机行为。
`,
)

writeDoc(
  '通用/CIRCUIT/machine_power_estop.md',
  `# 机床电气：电源与急停回路（维修向）

> 综合通用机床电气实践整理；具体端子与 PMC 地址以随机电气说明书为准。

## 读图顺序
1. 进线电源：断路器、接触器、变压器、稳压/滤波器
2. 急停回路：常闭串联（蘑菇头、安全门、抱闸联锁等）
3. CNC/伺服/主轴电源模块灯语
4. I/O 端子排 ↔ 电气图 ↔ PMC X/Y 表

## 常见无电/无法启动
- 急停未复位或通道抖动
- 柜门联锁、安全继电器未吸合
- 电源模块报警（过压/欠压/缺相）
- 24V 控制电源熔断

## 轴不动但无明确报警
- 模式不对（非 JOG/MDI）
- 进给保持 / 倍率 0
- 使能与抱闸：Y 有指令但机械不动 → 查阀/接触器/抱闸电源
- 伺服准备好信号未到 PMC

## 注意
伺服/电源模块断电后电容可能残留高压；编码器/光缆勿热插拔。
`,
)

writeDoc(
  '通用/GCODE/turning_cycles_g70_g76.md',
  `# 车床复合循环 G70–G76（FANUC 系常用，审核整理）

> 依据公开技术文对官方车床编程手册（如 B-64724EN-1）的归纳。G 代码体系 A/B/C 与单行/双行格式因系统而异。

## 一览
| 代码 | 作用 |
|------|------|
| G70 | 精车：沿 P–Q 轮廓走一刀 |
| G71 | 外径/内径轴向粗车 |
| G72 | 端面径向粗车 |
| G73 | 仿形/固定余量分层 |
| G74 | 端面啄钻/端面切槽 |
| G75 | 外径/内径切槽 |
| G76 | 多刀螺纹 |

## G71 双行（常见）
\`\`\`
G71 U(切深半径) R(退刀)
G71 P(起始N) Q(结束N) U(X余量直径) W(Z余量) F(进给)
\`\`\`
轮廓在 P～Q；粗车用循环 F，轮廓内 F/S 常留给 G70。

## G76 双行（常见）
\`\`\`
G76 P(精次数+倒角+牙角) Q(最小切入) R(精余量)
G76 X Z P(牙高) Q(首切入) F(导程)
\`\`\`

## 注意
- Type I/II 轮廓限制不同（单调性等）
- 刀尖半径补偿与复合循环顺序要核对
- 空运行/图形确认后再首件
`,
)

writeDoc(
  '通用/GCODE/milling_cycles_g80_g89.md',
  `# 铣床固定循环 G80–G89（常用对照）

> 通用 ISO/FANUC 铣床习惯整理；具体参数字（R/Z/Q/P）以本机编程说明书为准。

## 常用
| 代码 | 含义 |
|------|------|
| G80 | 取消固定循环 |
| G81 | 钻孔 |
| G82 | 钻孔+暂停 |
| G83 | 深孔啄钻 |
| G84 | 攻丝 |
| G85 | 镗孔（进给退出） |
| G86 | 镗孔（主轴停、快速退） |
| G87 | 背镗（选项） |
| G89 | 镗孔+暂停 |

## 典型结构概念
定位到孔位 → 快速到 R 平面 → 切削到 Z → 按循环方式退回 → 下一孔。

## 相关
- G98/G99：返回初始平面 / R 平面（FANUC 常见）
- 平面 G17/G18/G19；刀长 G43；半径 G41/G42
`,
)

writeDoc(
  '通用/GCODE/modal_and_prep.md',
  `# G 代码模态与准备功能速查

## 几乎处处要先确认
- G20/G21 或公英制设定
- G90/G91 绝对/增量
- G94/G95 每分/每转进给（车床）
- G17/G18/G19 平面
- G54–G59 工件坐标系
- 刀具与补偿：T、D/H、G40/G41/G42、G43/G49

## 运动
- G00 快速；G01 直线；G02/G03 圆弧（IJK 或 R）
- G04 暂停

## 安全习惯
1. 安全高度 / 退刀平面
2. 空运行与图形
3. 首件降倍率
4. 宏与公共变量勿冲突
`,
)

writeDoc(
  'FANUC/operation_popular_series.md',
  `# 流行 FANUC 系统操作要点（0i / 30i / 31i）

> 对照公开操作/维护手册体系（如 B-64694、B-64724、B-64725 系列）。具体以本机版本为准。

## 模式
- EDIT 编辑；MEM/AUTO 自动；MDI；JOG；HANDLE 手轮；REF 回零

## 常用画面
位置、程序、刀补、坐标系、报警、诊断、参数、宏变量、PMC

## 报警处理
记录号与附加信息 → 查报警篇 → 结合 PMC STATUS / 伺服灯语 → 确认机械安全后再复位

## 参数
改前备份；注意需断电生效项；行程、螺补、编码器相关勿盲目改

## 与 PICTURE / 梯子
用户画面与 PMC 多为机床厂配置；改动需备份并验证 MEM / LAD
`,
)

writeDoc(
  'SIEMENS/sinumerik_operation_notes.md',
  `# SINUMERIK 操作要点（840D sl / 828D）

> 依据西门子公开操作/编程文档体系整理。

## 操作区域概念
机床、参数、程序、诊断等分区；通道与模式要分清。

## 程序
MPF 主程序 / SPF 子程序常见；DIN 66025 基础 + 西门子扩展（CYCLE、FRAME 等）。

## 诊断
报警缓冲区；驱动相关看 SINAMICS 状态；PLC 侧看机床厂信号。

## 注意
机床厂可能屏蔽或改名部分功能；以本机随机文档为准。
`,
)

writeDoc(
  'MITSUBISHI/m80_operation_notes.md',
  `# 三菱 M80/M800 操作与编程注意

> 依据三菱官网公开编程手册结构整理。

## 程序格式
- 程序头常用 %（EOR）
- 程序段以 EOB 结束；外部设备注意换行格式
- N 序号用于检索/跳转

## 准备功能
G00 定位、G01 直线、G02/G03 圆弧；坐标系与固定循环参数字以手册表格为准。

## 与 FANUC 的差异
参数体系、PLC 地址、部分循环格式不同，勿硬套 FANUC 经验。
`,
)

writeDoc(
  'HEIDENHAIN/tnc640_operation_notes.md',
  `# HEIDENHAIN TNC 640 操作要点

> 依据官方 ISO / Cycle 手册公开内容整理。

## 模式
手动/手轮、MDI、编程、试运行、程序运行（连续/单段）

## 编程风格
Klartext 对话与 ISO 可能并存；TOOL CALL、Q 参数、CYCL DEF 是常见要素。

## 循环
钻孔/攻丝/口袋等固定循环组；测头循环视选项。

## 注意
选项位（附加轴、倾斜面、RTCP 等）由机床厂启用；功能有无以本机为准。
`,
)

const siemensPath = path.join(tools, 'bcc9aaf4-74ea-41e2-b6db-e2c3eeb41de3.txt')
const mitsuPath = path.join(tools, 'da1a6b2f-c019-4449-b5d0-73341052ef2e.txt')
const hhIsoPath = path.join(tools, 'a04cb17e-5a6f-4422-a5af-e4e4855b9803.txt')
const hhCycPath = path.join(tools, '5961a3ff-e7a5-46e0-b3eb-b80768990cb0.txt')

if (fs.existsSync(siemensPath)) {
  const siemens = fs.readFileSync(siemensPath, 'utf8')
  writeDoc(
    'SIEMENS/sinumerik_fundamentals_excerpt.md',
    `# SINUMERIK 840D sl / 828D 编程基础摘录

> 来源：Siemens 官方 Programming Manual Fundamentals，订单号 6FC5398-1BP40-3BA1（公开 PDF）。以下为要点摘录，非整本复制。

${extractChunks(
  siemens,
  [
    'Fundamental Principles of NC Programming',
    'G0',
    'G1',
    'G2',
    'G17',
    'G54',
    'G90',
    'G91',
    'Tool radius compensation',
    'CYCLE81',
    'Frames',
    'M30',
  ],
  3200,
  90000,
)}
`,
  )
} else {
  console.warn('Siemens extract missing:', siemensPath)
}

if (fs.existsSync(mitsuPath)) {
  const mitsu = fs.readFileSync(mitsuPath, 'utf8')
  writeDoc(
    'MITSUBISHI/m80_programming_excerpt.md',
    `# 三菱 M800/M80 编程手册要点摘录

> 来源：Mitsubishi Electric CNC 官网公开 Programming Manual（Machining Center System）。要点摘录，非整本。

${extractChunks(
  mitsu,
  [
    'Program start',
    'Preparatory function',
    'G00',
    'G01',
    'G02',
    'G17',
    'G40',
    'G41',
    'G54',
    'G90',
    'G91',
    'Fixed cycle',
    'G80',
    'G81',
    'G83',
    'Coordinate system',
  ],
  3000,
  90000,
)}
`,
  )
} else {
  console.warn('Mitsubishi extract missing:', mitsuPath)
}

if (fs.existsSync(hhIsoPath)) {
  const hhIso = fs.readFileSync(hhIsoPath, 'utf8')
  writeDoc(
    'HEIDENHAIN/tnc640_iso_excerpt.md',
    `# HEIDENHAIN TNC 640 ISO 编程要点摘录

> 来源：HEIDENHAIN 官方 TNC 640 ISO Programming User's Manual（content.heidenhain.de）。要点摘录。

${extractChunks(
  hhIso,
  [
    'Modes of operation',
    'Manual Operation',
    'Program Run',
    'Test Run',
    'NC fundamentals',
    'G00',
    'G01',
    'G02',
    'G17',
    'G40',
    'G41',
    'G54',
    'TOOL CALL',
    'Q parameters',
  ],
  3000,
  90000,
)}
`,
  )
} else {
  console.warn('Heidenhain ISO extract missing:', hhIsoPath)
}

if (fs.existsSync(hhCycPath)) {
  const hhCyc = fs.readFileSync(hhCycPath, 'utf8')
  writeDoc(
    'HEIDENHAIN/tnc640_cycles_excerpt.md',
    `# HEIDENHAIN TNC 640 固定循环要点摘录

> 来源：官方 Cycle Programming 手册。要点摘录。

${extractChunks(
  hhCyc,
  [
    'Available cycle groups',
    'Fixed Cycles: Drilling',
    'CYCL DEF',
    'Drilling',
    'Tapping',
    'Pocket',
    'Touch probe',
  ],
  3500,
  80000,
)}
`,
  )
} else {
  console.warn('Heidenhain cycles extract missing:', hhCycPath)
}

console.log('done docsRoot=', docsRoot)

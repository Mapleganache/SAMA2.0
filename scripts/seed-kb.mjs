/**
 * SAMA 知识库种子文档
 * 运行：node scripts/seed-kb.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const docsRoot = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'sama',
  'sama-data',
  'kb',
  'docs',
)

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true })
}

function writeDoc(rel, content, { overwrite = false } = {}) {
  const abs = path.join(docsRoot, rel)
  ensureDir(path.dirname(abs))
  if (!overwrite && fs.existsSync(abs)) return abs
  fs.writeFileSync(abs, content.trim() + '\n', 'utf8')
  return abs
}

ensureDir(docsRoot)

writeDoc(
  'README.md',
  `# SAMA 知识库资料目录

把说明书放入对应文件夹（.md / .txt / .xml / .nc / .pdf）：

| 目录 | 内容 |
|------|------|
| \`FANUC/\` | FANUC 操作、G 代码、PICTURE |
| \`SIEMENS/\` | 西门子 840D 等 |
| \`MITSUBISHI/\` | 三菱 M80 等 |
| \`HEIDENHAIN/\` | 海德汉 TNC 等 |
| \`通用/CIRCUIT/\` | 机床电气与电路 |
| \`通用/GCODE/\` | 跨品牌 G 代码要点 |

## 记忆不会丢

索引在 \`kb/index.json\`。**资料没改就只在首次构建后持久使用**，启动直接加载，不会每次重学。
资料有增删改时会自动检测并重建一次，或手动点设置里的「构建/更新知识库」。
`,
  { overwrite: true },
)

writeDoc(
  '通用/GCODE/gcode_basics.md',
  `# G 代码基础（数控编程常用）

## 准备与单位
- G20：英制；G21：公制（mm）
- G90：绝对坐标；G91：增量坐标
- G94：每分钟进给；G95：每转进给（车床常见）

## 运动
- G00：快速定位（空程，注意安全高度）
- G01：直线切削，需指定 F 进给
- G02：顺时针圆弧；G03：逆时针圆弧（IJK 或 R）

## 平面与坐标系
- G17：XY 平面；G18：ZX；G19：YZ
- G54～G59：工件坐标系选择

## 刀具与补偿
- T：换刀；D/H：刀补号（铣）
- G40：取消刀补；G41/G42：左右刀补
- G43：长度补偿正向（铣）

## 固定循环（铣，常见）
- G81：钻孔；G83：深孔啄钻；G84：攻丝；G85：镗孔
注意：格式与参数因系统而异，以机床说明书为准。

## 车床常用
- G71：外径粗车复合循环；G70：精车
- G72：端面粗车；G73：仿形
- G74：端面啄钻；G75：外径切槽
- G76：螺纹切削循环

## 安全习惯
1. 先空运行 / 图形检查刀路
2. G00 下刀前确认 Z 安全高度
3. 首件降低进给与转速倍率
4. 宏程序注意公共变量范围与冲突
`,
)

writeDoc(
  'FANUC/g76_thread.md',
  `# G76 螺纹切削循环（FANUC 常用格式）

G76 常分两行：

第一行：G76 P______ Q______ R______
- P：精加工次数 / 倒角量 / 牙型角（位数依系统）
- Q：最小切入量
- R：精加工余量

第二行：G76 X__ Z__ P__ Q__ F__
- X/Z：终点
- P：牙高（半径值，常以最小输入单位）
- Q：第一次切入量
- F：导程

注意：不同 FANUC 系列定义可能不同，以本机说明书为准。
`,
)

writeDoc(
  'FANUC/g71_turning.md',
  `# G71 外径粗车复合循环（FANUC 车床）

常见双行格式：

G71 U(切深) R(退刀)
G71 P(起始N) Q(结束N) U(X余量) W(Z余量) F(进给)

- 轮廓由 P～Q 之间的程序段描述
- U/W 为精车余量（直径/长度方向注意系统约定）
- 随后常用 G70 P.. Q.. 做精车

检查：凸凹轮廓是否适合复合循环；注意刀尖半径与干涉。
`,
)

writeDoc(
  'FANUC/picture_overview.md',
  `# FANUC PICTURE 概要（画面软件 / CAD PICTURE）

官方操作说明书常见编号：B-66284CM（中文）/ B-66284EN（英文）。
用于制作 CNC 用户画面，转换生成 MEM 后下载到机床。

## 工程文件
- \`.fp2\`：工程索引（很小的文本指针）
- \`FPicture*.xml\`：真正的画面定义，根节点 \`<FANUCPicture>\`，多为 UTF-16
- 不要用自造的 \`<FPScreen>/<FPLabel>\` 假格式代替真实 XML

## 核心控件
- **带输入的数值显示（FPInput）**：显示 + 可写入
- **键入缓冲（FPKyInBf）**：一屏通常一个；对准焦点后键入，按 INPUT 写入
- **Read/Write**：常用 \`rdmacro(变量号, 99, 0)\` / \`wrmacro(变量号, 0, 0, 99, 0)\`
- **Watch PMC**：监视地址（案例常见 D2950）

## 焦点索引
- 同屏内 Focus Index（1 以上）不可重复
- 0 = 不参加焦点
- 复制控件后必须改索引，否则报「焦点索引重复」

## 交付流程
1. PC 上编辑画面
2. 转换生成 MEM
3. 存储卡/网络加载到 CNC（需 PICTURE 选项）
4. 机上进入用户画面，INPUT 后用 MDI 查宏变量确认
`,
)

writeDoc(
  'FANUC/fpinput_macros.md',
  `# FANUC PICTURE 宏变量读写（维修常用）

## 读
rdmacro(宏变量号, 99, 0)

## 写（十键/键入缓冲写入时 data1/data2 常为 0）
wrmacro(宏变量号, 0, 0, 99, 0)

## 注意
- 公共变量范围受选项限制（常见 #100～#199、#500～#999 需确认）
- 同屏焦点索引勿冲突
- 改 XML 优先小范围替换；整文件重写可能破坏 UTF-16 格式
- 改完用 PICTURE 打开 .fp2 验证，再生成 MEM
`,
)

writeDoc(
  'FANUC/operation_31i.md',
  `# FANUC 31i / 0i 等操作要点

常见系列：0i / 30i / 31i / 32i。具体以本机操作说明书为准（如 B-64484CM）。

## 常用模式
- EDIT：编辑程序
- MEM/AUTO：自动运行
- MDI：手动数据输入
- JOG / HANDLE：手动 / 手轮

## 常用画面
- 位置、程序、刀补、工件坐标系（G54…）
- 报警 / 诊断 / 系统参数
- 宏变量、PMC 梯子（诊断）

## 报警处理
1. 记录报警号与附加信息
2. 查说明书报警篇
3. 结合诊断位、伺服灯语
4. 复位前确认机械安全

## 参数
- 改参数前备份；注意需断电生效的参数
- 轴行程、螺距补偿、绝对编码器相关参数勿盲目改
`,
)

writeDoc(
  '通用/CIRCUIT/machine_electrical_basics.md',
  `# 机床电气与电路基础（维修向）

## 安全
- 断电、验电、上锁挂牌后再作业
- 高压柜、伺服单元电容可能残留电压
- 严禁违规带电插拔编码器/光缆

## 常见组成
- 主电源 / 断路器 / 接触器 / 变压器
- CNC 电源模块、伺服驱动、主轴驱动
- PMC/PLC 输入输出（按钮、限位、液压、卡盘）
- 急停回路（常闭串联）、安全门、抱闸

## 读图要点
1. 先找电源进线与急停回路
2. 再看 PMC 地址表：X 输入 / Y 输出（或 I/Q 等，因品牌而异）
3. 对照梯形图与实物端子
4. 伺服报警需同时查驱动面板与 CNC 诊断画面

## 常见故障思路
- 无电：进线、断路器、急停是否复位、电源模块灯语
- 轴不动：使能、抱闸、限位、伺服报警、模式（JOG/MDI）
- 随机报警：接地、屏蔽、干扰、电缆破损

电路图以本机床随机电气说明书为准。
`,
)

writeDoc(
  '通用/CIRCUIT/pmc_io_notes.md',
  `# PMC / 梯形图与 I/O 笔记

## FANUC PMC 常见
- X：输入；Y：输出；R：内部继电器；D：数据表；K：保持型
- 急停、门联锁常涉及特定地址，改梯子前先备份

## 排查步骤
1. CNC 诊断画面看实际输入是否变化
2. 万用表测按钮/接近开关到端子排
3. 对照梯子触点与线圈
4. 输出有指令但执行件不动：查驱动电源、阀、接触器
`,
)

writeDoc(
  'SIEMENS/sinumerik_840d_notes.md',
  `# SIEMENS SINUMERIK 要点（840D 等）

- 操作区域：机床、参数、程序、诊断等
- 程序常为 SPF/MPF；注意通道与模式
- 报警看诊断缓冲区；驱动相关看 SINAMICS 状态
- 以本机随机手册（如 6FC5398 系列文档）为准
`,
)

writeDoc(
  'MITSUBISHI/m80_notes.md',
  `# MITSUBISHI M80/M800 要点

- 操作面板分区：位置、程序、刀补、报警
- 报警号查对应说明书（如 IB 系列手册）
- 参数与 PLC 地址规则与 FANUC 不同，勿混用经验硬套
`,
)

writeDoc(
  'HEIDENHAIN/tnc_notes.md',
  `# HEIDENHAIN TNC 要点（如 TNC 640）

- 会话式编程与 ISO 模式可能并存
- 注意参考点、倾斜面、RTCP 相关操作（视选项）
- 报警与手册章节对应查阅随机文档
`,
)

/** 尝试抽取 FANUC LADDER README */
function extractLadderReadme() {
  const desktop = path.join(os.homedir(), 'Desktop')
  let ladderRoot = null
  try {
    for (const name of fs.readdirSync(desktop)) {
      if (/LADDER/i.test(name)) {
        ladderRoot = path.join(desktop, name)
        break
      }
    }
  } catch {
    return
  }
  if (!ladderRoot) return

  function findReadme(dir, depth = 0) {
    if (depth > 4) return null
    let entries = []
    try {
      entries = fs.readdirSync(dir)
    } catch {
      return null
    }
    for (const name of entries) {
      const full = path.join(dir, name)
      let st
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        const hit = findReadme(full, depth + 1)
        if (hit) return hit
      } else if (/^README\.TXT$/i.test(name)) {
        return full
      }
    }
    return null
  }

  const readme = findReadme(ladderRoot)
  if (!readme) return
  const outRel = 'FANUC/ladder_readme_excerpt.md'
  const outAbs = path.join(docsRoot, outRel)
  if (fs.existsSync(outAbs) && fs.statSync(outAbs).size > 1000) {
    console.log('已有 LADDER 摘录，跳过')
    return
  }
  try {
    const text = fs.readFileSync(readme, 'utf8').slice(0, 80_000)
    ensureDir(path.dirname(outAbs))
    fs.writeFileSync(
      outAbs,
      `# FANUC LADDER III README 摘录\n\n来源：${readme}\n\n${text}\n`,
      'utf8',
    )
    console.log('已写入', outAbs)
  } catch (e) {
    console.warn('LADDER README 抽取失败', e.message || e)
  }
}

extractLadderReadme()

writeDoc(
  'FANUC/lad_design_standard.md',
  `# FANUC PMC 梯形设计标准（SAMA 学习参考）

> 用途：让 SAMA 在**设计新梯形**时模仿格式与模块划分，而不是整图抄 Studer 磨削功能。  
> 二进制样板：仓库 \`electron/resources/lad/format_standard_studer.LAD\`（自桌面 studer 复制）。  
> 设计空壳：\`electron/resources/lad/empty_0i_shell.LAD\`（mikrosa **CALLU+空 SP/SPE 骨架**，约 20 网；复制后再写网）。  
> 注意：Fladder 无法接受「仅 END」字面空梯形（\`/init=4\` 会 W-4122）；空壳必须保留多级骨架。

## 1. 文件与助记符格式（必须遵守）

1. 工程是完整 \`.LAD\`（含系统参数/符号/梯形），**不能**从零空 PMC 直接造文件。
2. 设计流程：**复制内置空壳** → \`SrcToMnemonic\` → 改/追加 \`%@3\` 网 → \`MnemonicToSrc\`。
3. 助记符关键段：
   - \`%@1\` 系统/标题
   - \`%@2\` 符号表（地址 + 名称）
   - \`%@3\` 梯形网（\`Nxxxxx:\` + RD/AND/WRT…）
   - \`%@4\` 及后续段
4. 网必须以 \`SPE\`（SUB 72）+ \`END\`（SUB 64）收尾；写回用 mode=1 助记符。
5. Studer 类多级工程有多段 \`CALLU\` + 多个 \`SPE\`：**禁止整图擦掉重建**；新设计优先单级空壳追加。

## 2. 从标准样板学什么 / 不学什么

| 学 | 不学 |
|----|------|
| \`%@1/%@2/%@3\` 分段与网号习惯 | 原样复制磨削/修整/砂轮星三角业务 |
| 符号命名风格（功能英文大写） | 照搬整机 I/O 表到另一台机床 |
| 安全链思路：急停/门/双手 → 允许动作 | 把 Studer 专用 R12xx/Y 灯位当通用必用 |
| 模块拆分：安全 → 模式 → 执行 → 报警 | 「整图删除再生成」当默认手段 |

## 3. 推荐模块顺序（新机床简易设计）

1. **安全**：急停/门关闭 → SAFE_OK  
2. **操作许可**：双手按钮/钥匙 → 允许泵或伺服  
3. **执行**：夹紧 → 到位 → 主动作  
4. **完成与报警**：到位反馈、门开中途动作 → ALM  
5. **指示**：就绪灯 / 报警灯  

示例（液压压机，异于 Studer）：门 + 双手 → 泵 → 夹紧 → 下压 → 灯。

## 4. 地址纪律

1. 新设计优先使用空壳符号表内已有地址，或经验证的 \`X0.*\` / \`R100.*\` / \`Y0.*\`。  
2. 避免盲目使用大号 R/Y；非法地址 → Fladder **E-3123**，梯形不落盘。  
3. 线圈不要写在 X 输入点上。

## 5. SAMA 产品承诺

- ✅ 复制内置空壳并追加设计网，另存桌面  
- ✅ 以本标准 + format_standard_studer 作格式参考  
- ❌ 不承诺 Studer 多级工程整图擦掉重建  
- ❌ 生成结果禁止直接下载到真实机床
`,
  { overwrite: true },
)

/** 尝试从本机 FANUC PICTURE PDF 抽取文本到知识库 */
async function extractLocalPdfs() {
  const candidates = [
    path.join(
      os.homedir(),
      'Desktop',
      'FAUNC PICTURE',
      'FAUNC PICTURE',
      'FANUC PICTURE',
      'B-66284CM_FANUC PICTURE操作_中文_v04_01.pdf',
    ),
    path.join(
      os.homedir(),
      'Desktop',
      'FAUNC PICTURE',
      'FAUNC PICTURE',
      'FANUC PICTURE',
      'FANUC PICTURE B-66284EN_05.pdf',
    ),
  ]

  let PDFParse
  try {
    ;({ PDFParse } = await import('pdf-parse'))
  } catch {
    console.warn('pdf-parse 不可用，跳过 PDF 抽取')
    return
  }

  for (const pdfPath of candidates) {
    if (!fs.existsSync(pdfPath)) {
      console.warn('PDF 不存在，跳过:', pdfPath)
      continue
    }
    const base = path.basename(pdfPath, path.extname(pdfPath)).replace(/[^\w\u4e00-\u9fff\-]+/g, '_')
    const outRel = path.join('FANUC', `pdf_${base}.md`)
    const outAbs = path.join(docsRoot, outRel)
    if (fs.existsSync(outAbs) && fs.statSync(outAbs).size > 1000) {
      console.log('已有抽取结果，跳过:', outRel)
      continue
    }
    try {
      console.log('抽取 PDF:', pdfPath)
      const data = fs.readFileSync(pdfPath)
      const parser = new PDFParse({ data })
      const result = await parser.getText()
      const text = String(result?.text || '').trim()
      if (!text) continue
      // 限制体积，避免索引过大
      const clipped = text.slice(0, 400_000)
      ensureDir(path.dirname(outAbs))
      fs.writeFileSync(
        outAbs,
        `# ${path.basename(pdfPath)}（自动抽取文本）\n\n来源：${pdfPath}\n\n${clipped}\n`,
        'utf8',
      )
      console.log('已写入', outAbs, 'chars=', clipped.length)
      if (typeof parser.destroy === 'function') await parser.destroy()
    } catch (e) {
      console.warn('PDF 抽取失败:', pdfPath, e.message || e)
    }
  }
}

await extractLocalPdfs()
console.log('KB docs seeded at:', docsRoot)

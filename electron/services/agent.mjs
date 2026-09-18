import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { chatWithLlm } from './deepseek.mjs'
import { searchKnowledge, loadSettings } from './store.mjs'
import { getLadderIiiSessionAllow, resolveUsableLadPath } from './fanucLadderIii.mjs'
import {
  parseAndApplyFileWrites,
  parseFileWriteBlocks,
  parseMkdirBlocks,
  mkdirWorkspaceFolder,
  hasTruncatedFileWrites,
  mergeAssistantContinuation,
  readWorkspaceFile,
  listWorkspaceTree,
  ensureWorkspaceSeed,
  writeExternalFile,
} from './workspace.mjs'
import {
  extractLikelyFilePaths,
  extractLikelyDirPaths,
  resolveProjectFiles,
  readTextFile,
} from './safeFs.mjs'
import {
  createFanucPictureProject,
  wantsCreateFp2Project,
  buildFp2Content,
  defaultFanucOutputDir,
  preferredFanucDirs,
} from './fanucPicture.mjs'
import {
  isLadPath,
  readLadProject,
  wantsLadReportFile,
  looksLikeBrokenLadSymbolTable,
  looksLikeHallucinatedLadReport,
  buildLadAnalysisReport,
  buildLadAnalysisBrief,
  buildLadModelContext,
  defaultLadReportPath,
} from './fanucLad.mjs'
import {
  wantsGenerateLad,
  resolveLadTemplate,
} from './fanucLadGenerate.mjs'
import { applyDesktopToolsFromAgent } from './desktop/desktopAgentBridge.mjs'
import { understandImageAttachments, modelAcceptsImages } from './imageUnderstand.mjs'
import {
  extractGrindDims,
  grindHardGeometryBlock,
  isReadCodeTask,
  looksLikeGrindTask,
  repairAssistantGrindGcode,
  wantsGrindProgram,
} from './grindGcode.mjs'
import { rewriteToLibraryRel } from './samaLibrary.mjs'
import {
  applyElecJsonFromText,
  looksLikeElecTask,
  looksLikeElecEdit,
  looksLikePdfReplicaTask,
  buildElecBookFromPdf,
  docsToElecJsonFences,
  renderAndSaveSheet,
  generateSheet,
  pickElecPreviewArt,
} from './electrical/sheetService.mjs'
import { formatLintSummary, lintElecDocs } from './electrical/elecLint.mjs'
import { buildPdfElecBrief } from './electrical/elecPdfBrief.mjs'
import { formatIoDescBrief } from './electrical/elecPdfIoMap.mjs'
import { ELEC_JSON_EXAMPLE, ELEC_JSON_IO_EXAMPLE } from './electrical/elecJson.mjs'

function channelLockRules(channel = '') {
  const ch = String(channel || '')
  if (ch === 'fp') {
    return `【本页只写 FANUC PICTURE】只处理 \`.fp2\` / \`FPicture*.xml\` 画面。禁止改 \`.LAD\`、禁止梯形/PMC、禁止 G 代码。禁止输出 \`sama-allow-lad-edit\` / \`sama-allow-lad-generate\`。写入只用 \`sama-file\` 写 .fp2 或画面 XML。若用户要改梯子，请他选 PLC 下的 **Ladder**。`
  }
  if (ch === 'lad' || ch === 'plc') {
    return `【本页只写 FANUC Ladder】只处理 \`.LAD\` / 助记符 / PMC。禁止写 \`.fp2\`、禁止改画面 XML、禁止写加工程序。改梯用允许卡，禁止声称已下机床。若用户要改画面，请他选 PLC 下的 **PICTURE**。`
  }
  if (ch === 'elec') {
    return `【本页只做电路识图与连通性】验收原则：①与 PDF 位号/I/O 一致 ②列内 wires 首尾相接、无错号 ③每条链路可写成「A → B」。

**工作流**：
1. 用户附电路图 PDF：系统会从 PDF 文本程序化还原 elec-json，并导出 **连通性 md/txt**（元件谁连谁）。你只需短列目录对照，**禁止再手写整本 elec-json**。
2. 用户要改连接关系时，才按改动输出 elec-json（内部中间格式）。
3. 电机页示例：\`\`\`elec-json\n${ELEC_JSON_EXAMPLE}\n\`\`\`
4. 校验不过则拒导出；系统不会偷偷改 JSON。
5. **禁止**生成 SVG/PDF 原理图、禁止手绘 SVG；交付物是连通性表，不是施工图。`
  }
  if (ch === 'cam') {
    return `【本页只有两件事】1）用户给加工图 + 机床型号 → 写出该机床可用的**完整加工程序**（安全开头、工艺分段、M30）；尺寸以识图为准，看不清标存疑。只磨图上标明的磨削面（红线/Ra/「磨削面」），切入磨不要改成整轴纵磨，端面用 Z 向切入，修整不要当磨零件。2）用户给加工程序 → 说明加工的是什么零件，并列出关键参数（外形/直径/长度、余量、砂轮或刀具、进给、转速、行程）。高桥等机若程序里 X0 为成品，Z 才是长度，禁止把 Z21 读成 φ21。看码识件禁止改程序、禁止用 ISO 示意替换厂家循环、禁止删 SVG。禁止写 .LAD / .fp2。禁止输出梯子允许标记。禁止声称已校验、已仿真或已下机床。展示程序用 \`\`\`gcode 围栏即可，用户会点「生成 G 代码文件」落盘；只有用户明确说保存/写成文件时才用 sama-file 写到 \`SAMA文件/01_加工程序/<机床>/\`。`
  }
  return ''
}

function channelAllowsWritePath(channel, filePath) {
  const ch = String(channel || '')
  const p = String(filePath || '')
  const base = path.basename(p)
  if (ch === 'fp') {
    return /\.fp2$/i.test(p) || /\.xml$/i.test(p)
  }
  if (ch === 'lad' || ch === 'plc') {
    if (/\.fp2$/i.test(p) || /^FPicture/i.test(base) || /\.(nc|cnc|ngc|tap|mpf)$/i.test(p)) return false
    return true
  }
  if (ch === 'cam') {
    if (/\.lad$/i.test(p) || /\.fp2$/i.test(p) || /^FPicture/i.test(base)) return false
    if (/^O\d{1,8}$/i.test(base) || /^_N_[A-Z0-9_]+_MPF$/i.test(base)) return true
    return /\.(nc|cnc|ngc|tap|mpf|spf|txt|md|gcode|iso|prg|svg)$/i.test(p)
  }
  if (ch === 'elec') {
    return /\.(svg|dxf|json|md|txt)$/i.test(p)
  }
  return true
}

export async function runAgentTurn({
  mode,
  userText,
  history = [],
  enabledLibraries = [],
  activeFile = '',
  fileContent = '',
  applyFiles = true,
  attachments = [],
  channel = '',
}) {
  ensureWorkspaceSeed()

  const brands = enabledLibraries.map((l) => l.brand)
  const hits = searchKnowledge(userText, brands, 4)

  const libLine = enabledLibraries.length
    ? enabledLibraries.map((l) => `${l.brand} · ${l.title} (${l.version})`).join('；')
    : '（未选择资料库）'

  const kbBlock = hits.length
    ? hits
        .map((h, i) => `[${i + 1}] ${h.brand} / ${h.source}\n${h.content}`)
        .join('\n\n')
    : '（知识库暂无命中片段。禁止编造手册条款或页码；仅可给通用数控思路并标明「非本库」，并建议用户放入说明书后构建索引。）'

  const KB_PRIORITY_RULES = `【知识库第一原则 — 必须遵守】
1. SAMA **没有网页搜索**；禁止假装查过官网或网上资料。
2. 上方若有知识库片段：回答必须优先依据这些片段，并标注出处如 [1] brand/source；与「通用经验」冲突时 **以库为准**。
3. 若无命中：禁止编造具体手册条款、参数号含义或页码；可给排查思路但必须写明「非本库 / 不确定」。
4. 用户附件、LAD 事实卡、当前打开文件的原文，优先级高于空泛经验。
5. 不要用网上常见机床模板覆盖本机符号注释或库内原文。
6. 涉及 FANUC 梯形/PMC/.LAD **设计**：优先遵循知识库 \`FANUC/lad_design_standard.md\`；复制内置 \`empty_0i_shell\` 再写网；参考 \`format_standard_studer\` 的**格式**，不要照搬 Studer 磨削功能；禁止整图擦掉多级 CALLU 重建。
7. 需要打开本机 FANUC LADDER-III / 导出助记符 / 修改 LAD / **基于空壳生成设计 LAD** 时：禁止写长篇「申请书」；只输出标记，界面会出现对应 **允许** 按钮：
\`\`\`sama-allow-ladder path="C:\\\\完整路径\\\\xxx.LAD"
\`\`\`
改梯形或加测试按钮时**必须**用（不要只用 sama-allow-ladder 冒充写入）：
\`\`\`sama-allow-lad-edit path="C:\\\\完整路径\\\\xxx.LAD" name="TEST_BTN" in="X0.1" out="R100.0"
\`\`\`
复制内置空壳并写入设计梯形（**不是从零空 PMC**；另存桌面）：
\`\`\`sama-allow-lad-generate path="C:\\\\完整路径\\\\模板.LAD"
\`\`\`
\`sama-allow-ladder\` 只负责用 Shell（Start-Process）打开 GUI，弹窗由用户点；写梯形必须 \`sama-allow-lad-edit\`（官方 Fladder /cmdfile：SrcToMnemonic→改助记符→MnemonicToSrc）；生成设计必须 \`sama-allow-lad-generate\`。
禁止要求用户在聊天里回复「允许添加」；必须等用户点界面按钮。地址必须落在本机 PMC 合法范围（不要用本机不存在的 X1000/R9000 等；默认用 X0.1 / R100.0）。
写回结果以界面「允许」回执为准：若回执写明失败/占用/0 字节，禁止再写「已成功写入」或「下一步打开 *_edited.LAD」；不得把暂存文件当成原工程已改好。
8. **禁止**说「我无法新建/写入文件」「不能改 Ladder」「不能生成 LAD」。Ask 模式请让用户切到 Agent；Agent 模式用 \`sama-file\` 写文本，用上面的 allow 标记改/生成 \`.LAD\`。说明能力边界时写「复制内置空壳再设计」，不要谎称「从零创建空工程」。演示结果禁止下机床。新对话没有旧记忆不代表能力消失。
9. **MTKB 电路安全规则**：涉及加装伺服、主回路、STO/急停、安全门、制动电阻或 RC 元件时，若当前机床完整型号、驱动器手册、现行电气图、负载/供电数据不足，必须列出缺项；禁止猜测端子号、线径、保护器件额定值和电阻电容最终定值。相似机型案例只能作为参考，不能当作现场接线事实；输出必须标明需由具备资质的电气工程师复核并完成断电验电、校线和安全功能测试。
9b. **电路图交付**：用户要「电路图/原理图」时，系统导出 **元件连通性 md/txt**（谁与谁相连），不渲染 SVG/PDF 施工图。中间仍用 elec-json，用户看到的是连通性表。
9c. **电路连通性验收（系统校验不过则拒导出）**：
   1. **与 PDF 一致**：元器件位号、I/O 地址（X/Y）、端子与附件 PDF **不得有差异**。
   2. **连接正确**：每条回路 Q→KM→M 同号、列内 wires 首尾相接；控制页 KM 与电机页 KM 成对；禁止列内全无连线（断路）。
   - 接触器线圈与主触点位号必须同号（KM25↔KM25↔M6 润滑，禁止写「备用」凑数）。
   - **校验失败即拒导出**：系统**不会**自动改 JSON，必须完整重出合格 elec-json。
10. **磨床 G 代码（SAMA 重点）**：用户给外圆/内圆/无心/锥度磨削任务时，必须按图纸尺寸写出可运行示意程序，并遵守：
   - **按机床体系出码，禁止一套 ISO 套所有磨床**：
     - STUDER S40 / Siemens 840D：R 参数 + L101 纵磨（切入 G91 X，端面 G91 Z，修整 L100/G55），不要写成 \`G01 X成品 Z-长度\`。
     - STUDER/favorit FANUC：X 直径编程正值（φ40 写 X40），Z0 左端向右为负。
     - 高桥 FANUC：X=0 为成品直径，Z 才是长度（Z21≠φ21）；G99、M21、T01；切入振荡 \`M98 P0022\`。
     - MIKROSA SASL32 无心磨：填 \`#540～#550\` Y 切入并调用本机 O8205；修整 O8201 / 廓形 O1111。禁止 G01 X直径 Z纵走。
     - FANUC 磨床循环：切入 \`G75\`（不是车床切槽），平面 \`G78\`。
     - Siemens 未绑 STUDER 宏包：外圆 \`CYCLE4071\`，平面 \`CYCLE4075\`。
     - NUM Flexium：\`G200\` 切入、\`G206\` 纵磨。
     - 无心通磨未绑厂家包：只写目标直径与通磨长度，不要套外圆纵磨。
   - 余量/进给/补偿用 **μm、一位小数**（20.0μm）；程序坐标仍是 G21 毫米，写到 0.0001mm（=0.1μm）。不要把 300μm 余量只写成 0.3。
   - **禁止**用铣削换刀 \`T1 M6\` 冒充换砂轮（NUM 选砂轮除外）。
   - **只磨本次磨削面**：红线、「磨削面」、Ra 标注的那一档才写切削。禁止把未磨的两端台阶也纵磨一遍。
   - **光轴外圆纵磨**（仅直径编程体系）：成品直径 \`d\` 与毛坯 \`stock\` 都要出现；精磨段必须落到成品；轴向覆盖该档长度。
   - **台阶/带肩（明确要磨每一级时）**：每一级磨削直径都要有对应行程。若图上只标磨中间档，就只写那一档。
   - **切入/横磨/振荡**：工件基本不纵走；高桥用振荡子程序，STUDER 840D 用 G91 X，FANUC 用 G75，无心用 Y#540。
   - **轴肩端面**：Z 向切入，禁止改成外圆纵磨。
   - **砂轮修整**：对象是砂轮+金刚笔；STUDER 用 L100，MIKROSA 用 O8201，禁止当工件外圆磨。
   - **锥度**（直径编程体系）：禁止整段恒直径横磨。必须 \`G01\` 同时改变 X 与 Z，程序中必须出现两端成品直径。
   - **内孔**：内径 \`d\`、深度约 \`L\` 必须体现；高桥内圆 X 为该机偏移坐标系。
   - **看码识件**：只解释，不要改程序；高桥 X=0 常为成品直径，Z 才是长度。厂家循环（G75/G78/CYCLE4071/G200/O8205）不要替换成 ISO 纵磨模板，也不要删 SVG。
   - 图面/标题栏若写明机床型号，回答和程序头必须写该型号与对应体系。
   - 若上方出现【磨床硬性几何】JSON，必须按其中的 **dialect** 出码；写错会被系统按该体系重写。
11. **图纸/照片识图**：用户附图时，必须以「识图结果」里的尺寸与结构为准；OCR 与视觉模型不一致时标存疑。禁止编造图上看不清的数字。
`

  let liveFileContent = fileContent || ''
  let liveFilePath = activeFile || ''
  const isExternal = String(activeFile || '').startsWith('external:')
  if (activeFile && !isExternal) {
    try {
      const f = readWorkspaceFile(activeFile)
      liveFileContent = f.content
      liveFilePath = f.path
    } catch {
      // ignore
    }
  } else if (isExternal) {
    liveFilePath = activeFile.replace(/^external:/, '')
  }

  // 可信路径：附件 + 当前外部文件 + 用户消息里出现的允许路径
  const trustedPaths = []
  for (const a of attachments || []) {
    if (a?.path) trustedPaths.push(a.path)
  }
  if (isExternal && liveFilePath) trustedPaths.push(liveFilePath)

  // 自动读取用户消息中的本机文件/工程目录（仅允许桌面/文档/下载等）
  const autoAttachments = []
  const pathCandidates = [
    ...extractLikelyFilePaths(userText),
    ...extractLikelyDirPaths(userText),
  ]
  for (const p of pathCandidates) {
    try {
      if (isLadPath(p)) {
        const lad = readLadProject(p)
        trustedPaths.push(lad.path)
        trustedPaths.push(path.dirname(lad.path))
        autoAttachments.push({
          name: lad.name,
          path: lad.path,
          kind: 'text',
          lad: true,
          content: lad.content,
          symbolCount: lad.symbolCount,
        })
        continue
      }
      const files = resolveProjectFiles(p, { trustedPaths })
      for (const abs of files) {
        trustedPaths.push(abs)
        trustedPaths.push(path.dirname(abs))
        if (isLadPath(abs)) {
          const lad = readLadProject(abs)
          autoAttachments.push({
            name: lad.name,
            path: lad.path,
            kind: 'text',
            lad: true,
            content: lad.content,
            symbolCount: lad.symbolCount,
          })
        } else {
          const { content } = readTextFile(abs)
          autoAttachments.push({
            name: abs.split(/[/\\]/).pop(),
            path: abs,
            kind: 'text',
            content,
          })
        }
      }
    } catch {
      // 忽略不可读路径
    }
  }

  const allAttachments = [...(attachments || []), ...autoAttachments]
  // 去重 path
  const seen = new Set()
  const mergedAttachments = []
  for (const a of allAttachments) {
    const key = a.path || a.name
    if (seen.has(key)) continue
    seen.add(key)
    mergedAttachments.push(a)
  }

  // 若当前无打开内容但自动读到了文件，用第一个作为当前文件上下文
  if (!liveFileContent && mergedAttachments[0]?.content) {
    liveFilePath = mergedAttachments[0].path || mergedAttachments[0].name
    liveFileContent = mergedAttachments[0].content
  }

  // 外部 .LAD：若前端传来的摘要是坏符号表，或空内容，强制重读
  if (isLadPath(liveFilePath)) {
    try {
      if (!liveFileContent || looksLikeBrokenLadSymbolTable(liveFileContent)) {
        const lad = readLadProject(liveFilePath)
        liveFileContent = lad.content
        trustedPaths.push(lad.path)
      }
    } catch {
      /* ignore */
    }
  }
  for (let i = 0; i < mergedAttachments.length; i++) {
    const a = mergedAttachments[i]
    if (!a?.path || !isLadPath(a.path)) continue
    if (a.lad && a.content && !looksLikeBrokenLadSymbolTable(a.content)) continue
    try {
      const lad = readLadProject(a.path)
      mergedAttachments[i] = {
        ...a,
        content: lad.content,
        lad: true,
        symbolCount: lad.symbolCount,
      }
    } catch {
      /* ignore */
    }
  }

  // 有 LAD 时：准备事实卡，供本轮及后续分析遵守（不只为写报告）
  const ladCandidates = [
    isLadPath(liveFilePath) ? liveFilePath : '',
    ...mergedAttachments.map((a) => a.path).filter((p) => p && isLadPath(p)),
    ...extractLikelyFilePaths(userText).filter((p) => isLadPath(p)),
  ].filter(Boolean)
  let ladAbs = ladCandidates[0] || ''
  if (channel === 'fp' || channel === 'cam') ladAbs = ''
  let ladBrief = ''
  const ladPage = channel === 'lad' || channel === 'plc' || channel === 'chat' || !channel

  // 用户要申请/打开 LADDER-III：不走模型编「申请书」，直接让前端弹允许按钮
  const wantsLadderOpen =
    /(向我申请|申请权限|打开\s*LADDER|允许.*LADDER|LADDER.*允许|用\s*LADDER|启动\s*LADDER|打开梯子)/i.test(
      userText,
    )
  const wantsLadEdit =
    /(加(一个)?(测试)?按钮|添加按钮|修改\s*\.?\s*LAD|改梯形|写入符号|按钮添加|允许添加)/i.test(
      userText,
    ) && !/不要|别加|取消/.test(userText)

  // Ask 模式遇到「写文件」：直接指路，避免模型胡说「无法写入」
  const wantsFileWrite =
    mode !== 'agent' &&
    /(新建|创建|写入|保存|生成).{0,12}(文件|页面|html|前端|md|txt|xml|fp2)|写(点|个|一些).{0,8}(前端|内容|文件)/i.test(
      userText,
    )
  if (wantsFileWrite) {
    return {
      content:
        '当前是 **Ask（只问答）**，不会写盘，所以不是「新对话丢了能力」。\n\n请点右上角切到 **Agent**，再说一次要新建/写入什么；Agent 可用 `sama-file` 写到桌面等允许目录。若要改二进制 `.LAD`，在 Agent 里说清路径后点允许卡（MnemonicToSrc）。',
      model: 'sama-mode-hint',
      usage: null,
      citations: [],
      kbHits: 0,
      fileOps: [],
    }
  }

  function resolveTargetLad() {
    const hit = resolveUsableLadPath(ladAbs || '')
    return hit.ok ? hit.path : ''
  }

  if (wantsLadEdit && ladPage) {
    const targetLad = resolveTargetLad()
    if (targetLad) {
      const esc = String(targetLad).replace(/\\/g, '\\\\')
      return {
        content: `请在下方输入区 **逐项** 点「允许」（一次只弹一张，类似 Cursor）。不要只在聊天里回复「允许添加」。

拟操作：调试按钮（允许后脚本写入：SrcToMnemonic → 追加梯级 → MnemonicToSrc）。请先关掉 LADDER-III 占用。

目标：\`${targetLad}\`

\`\`\`sama-allow-lad-edit path="${esc}" name="TEST_BTN" in="X0.1" out="R100.0"
\`\`\``,
        model: 'sama-ladder-allow',
        usage: null,
        citations: [],
        kbHits: 0,
        fileOps: [],
        needAllowLadder: false,
        allowLadderPath: targetLad,
      }
    }
    return {
      content:
        '需要指定 .LAD 路径才能申请修改。请拖入 studer.LAD，或发送完整路径后再说要加按钮/改梯形。',
      model: 'sama-ladder-allow',
      usage: null,
      citations: [],
      kbHits: 0,
      fileOps: [],
    }
  }

  if (wantsLadderOpen && ladPage) {
    let targetLad = resolveTargetLad()
    if (targetLad) {
      const allowed = getLadderIiiSessionAllow()
      return {
        content: allowed
          ? `本会话已允许 LADDER-III。可点击下方按钮打开：\n\n\`\`\`sama-allow-ladder path="${String(targetLad).replace(/\\/g, '\\\\')}"\n\`\`\``
          : `请在本条消息下方点击对应按钮（打开 / 导出分析 / 修改方案）。不要只在聊天里口头批准。\n\n目标文件：\`${targetLad}\`\n\n\`\`\`sama-allow-ladder path="${String(targetLad).replace(/\\/g, '\\\\')}"\n\`\`\``,
        model: 'sama-ladder-allow',
        usage: null,
        citations: [],
        kbHits: 0,
        fileOps: [],
        needAllowLadder: !allowed,
        allowLadderPath: targetLad,
      }
    }
    return {
      content:
        '需要指定 .LAD 路径才能申请打开 LADDER-III。请拖入 studer.LAD，或发送完整路径后再说「向我申请」。',
      model: 'sama-ladder-allow',
      usage: null,
      citations: [],
      kbHits: 0,
      fileOps: [],
    }
  }

  if (ladAbs) {
    try {
      const packed = buildLadModelContext(ladAbs, { maxSymbols: 60 })
      ladBrief = buildLadAnalysisBrief(packed.lad)
      // 对话只用精简上下文，避免 6 万字符号表拖死请求
      liveFilePath = packed.path
      liveFileContent = packed.content
      trustedPaths.push(packed.path)
      for (let i = 0; i < mergedAttachments.length; i++) {
        if (mergedAttachments[i]?.path && isLadPath(mergedAttachments[i].path)) {
          mergedAttachments[i] = {
            ...mergedAttachments[i],
            content: packed.content,
            lad: true,
            symbolCount: packed.symbolCount,
          }
        }
      }
    } catch {
      ladBrief = ''
    }
  }

  const attachBlock = formatAttachments(mergedAttachments)
  const vision = await understandImageAttachments(mergedAttachments, { userText })
  const grindDims = extractGrindDims(`${userText}\n${vision.report || ''}`)
  const grindBlock =
    grindDims &&
    !isReadCodeTask(userText) &&
    (looksLikeGrindTask(userText) || looksLikeGrindTask(vision.report) || vision.imageCount)
      ? `\n\n${grindHardGeometryBlock(grindDims)}`
      : ''
  const visionBlock = [vision.report ? `\n\n${vision.report}` : '', grindBlock]
    .filter(Boolean)
    .join('')

  let elecHint = ''
  let elecPreview = null
  const pdfAtt = mergedAttachments.find(
    (a) => a.kind === 'pdf' || /\.pdf$/i.test(a.path || a.name || ''),
  )
  if ((channel === 'elec' || looksLikeElecTask(userText)) && pdfAtt?.content) {
    try {
      const brief = buildPdfElecBrief(pdfAtt.content)
      elecHint = brief
        ? `\n\n${brief}\n\n清单里已写明的 I/O desc **必须原样写入** io[]；看不清的标 uncertain。若用户要电路图，严格按清单输出 elec-json（系统会导出连通性 md/txt），不要手绘 SVG。`
        : `\n\n【电路图 PDF】已附 PDF，请逐页读附件输出 elec-json。`
    } catch {
      elecHint = '\n\n【电路图 PDF】已附 PDF，但文本解析失败，请对照 OCR/识图。'
    }
  }
  // 树摘要仅 Agent 写沙箱时需要；避免每回合扫盘
  const treeSummary =
    mode === 'agent' && applyFiles ? summarizeTree(listWorkspaceTree()) : '（Ask 模式不加载沙箱树）'
  const trustedLine = trustedPaths.length
    ? trustedPaths.slice(0, 12).join('\n')
    : '（暂无；用户拖入/打开/消息中的合法路径会列入）'

  // —— 生成问题报告：完全不走模型，避免被上文「逐行假分析」污染 ——
  if (ladAbs && wantsLadReportFile(userText)) {
    try {
      const settings = loadSettings()
      const report = buildLadAnalysisReport(ladAbs, {
        fladderPath: settings.fladderPath || '',
        // 有同目录助记符即可核验；已允许时再尝试 CLI 导出
        tryExportMnemonic: getLadderIiiSessionAllow(),
      })
      let outPath = defaultLadReportPath(ladAbs)
      const mentionedMd = extractLikelyFilePaths(userText).find((p) => /\.md$/i.test(p))
      if (mentionedMd) outPath = mentionedMd
      const written = writeExternalFile(outPath, report.markdown, {
        trustedPaths: [...trustedPaths, outPath, path.dirname(outPath), ladAbs],
      })
      const profile = report.profile?.label || 'FANUC PMC'
      const mneLine = report.mnemonicLoaded
        ? `- 助记符：已载入（急停链路/互锁可核验）${report.mnemonicPath ? ` \`${report.mnemonicPath}\`` : ''}`
        : getLadderIiiSessionAllow()
          ? `- 助记符：未载入（已允许 LADDER-III，但导出未成功；可放置同目录 *_mnemonic.txt）`
          : `- 助记符：未载入（建议点允许后导出，或把助记符与 LAD 放同目录）`
      const needAllow = !getLadderIiiSessionAllow()
      const content = `已生成 **完整证据级问题分析报告**（程序化解包 + 符号表${report.mnemonicLoaded ? ' + 助记符追溯' : ''}，**未使用**模型临场发挥，也不套其它机型数据）。

- 机型：${profile}
- 有效符号：${report.symbolCount} 条
- 已证实问题：${report.issueCount ?? 0} 条
- 安全链路已证实：${report.confirmedSafetyCount ?? 0} 条
${mneLine}
- 路径：\`${written.path}\`
- 大小：${written.bytes} 字节
${
  needAllow
    ? `
下方会出现 **允许 / 拒绝** 按钮。点「允许」后可用 LADDER-III，并在下次报告中尝试导出助记符以补全急停链路证据。

\`\`\`sama-allow-ladder path="${ladAbs.replace(/\\/g, '\\\\')}"
\`\`\`
`
    : ''
}

请在下方「生成的文件」**双击打开**查看。报告分「已证实 / 待人工 / 线索」，不要把待人工项当成已确认致命缺陷。

---
【文件操作结果】
✓ 已${written.created ? '创建' : '保存'}：${written.path}（${written.bytes} 字节） [本机]（双击打开）`

      return {
        content,
        model: 'sama-lad-report',
        usage: null,
        citations: [],
        kbHits: 0,
        fileOps: [
          {
            ok: true,
            path: written.path,
            created: written.created,
            bytes: written.bytes,
            external: true,
          },
        ],
        autoLoaded: autoAttachments.map((a) => a.path),
        needAllowLadder: needAllow,
        allowLadderPath: ladAbs,
      }
    } catch (e) {
      return {
        content: `生成问题报告失败：${e.message || e}\n请确认 .LAD 可解压，或新开对话后再试。`,
        model: 'sama-lad-report',
        usage: null,
        citations: [],
        kbHits: 0,
        fileOps: [],
        autoLoaded: autoAttachments.map((a) => a.path),
      }
    }
  }

  // —— 仅用户明确要「演示 LAD」才走液压压机模板；日常改梯不弹样例 ——
  if (
    (channel === 'lad' || channel === 'plc' || channel === 'chat' || !channel) &&
    (/sama-allow-lad-generate/i.test(userText) || /演示\s*(LAD|梯子|梯形)/i.test(userText)) &&
    wantsGenerateLad(userText)
  ) {
    const tpl = resolveLadTemplate('')
    if (!tpl.ok) {
      return {
        content: `可以基于**内置骨架空壳**设计新梯形（复制 \`empty_0i_shell.LAD\`＝CALLU+空 SP/SPE，再在末级 SPE 前写网；**禁止下机床**）。
空壳不是「仅 END」字面空工程（Fladder /init=4 会丢梯形）；设计标准见知识库 \`FANUC/lad_design_standard.md\`。

当前未找到外壳：${tpl.error}

请先在本机运行一次 \`node scripts/build-builtin-lad-shells.mjs\`，或把 mikrosa/studer 放到桌面。`,
        model: 'sama-lad-generate',
        usage: null,
        citations: [],
        kbHits: 0,
        fileOps: [],
        autoLoaded: autoAttachments.map((a) => a.path),
      }
    }
    const esc = tpl.path.replace(/\\/g, '\\\\')
    return {
      content: `可以。将**复制内置空壳**并写入一套**液压压机**简易逻辑（门安全/双手/泵/夹紧/下压），与 Studer 磨削功能不同；另存桌面新 \`.LAD\`。

- 外壳：\`${tpl.path}\`
- 格式学习：知识库 \`FANUC/lad_design_standard.md\` + 内置 \`format_standard_studer.LAD\`
- 方式：复制空壳 → SrcToMnemonic → 追加设计网 → MnemonicToSrc
- **禁止下载到真实机床**

请在下方点 **允许基于模板生成演示 LAD**（请先关掉 LADDER-III GUI）。

\`\`\`sama-allow-lad-generate path="${esc}"
\`\`\``,
      model: 'sama-lad-generate',
      usage: null,
      citations: [],
      kbHits: 0,
      fileOps: [],
      autoLoaded: autoAttachments.map((a) => a.path),
      needAllowLadder: true,
      allowLadderPath: tpl.path,
    }
  }


  const ladRules = ladBrief
    ? `
${ladBrief}

【分析纪律】
- 排查故障时优先对照上面的真实符号名与地址类型，再结合用户描述的现象。
- 可以提出假设，但必须区分「符号表事实」与「未反汇编的梯级猜测」。
- 禁止因为摘要截断或旧错误格式就断言「工程无注释」。
- **忽略本对话历史里**任何「逐行扫完全部 X/Y/G」「把空地址当故障」「把拼写当致命」的旧结论；那些是错误模板。
- **禁止**输出「逐地址/逐行」超长表格（把全部 X/Y/G 扫一遍）。会超出长度上限并中途截断。
- 用户若要求「逐行分析/全部检查」：只给 **摘要 + 高价值问题（通常 ≤15 条）**；完整版请用户说「生成问题报告」。
- 地址空缺、命名不统一、拼写脏词：最多「低/可维护性」，不要升成高危/致命。
- 「模式互锁/急停硬线」未见梯形图与电气图前只能写「待证」。
- **禁止**输出「高价值问题」清单却全是待证猜测；完整版必须让用户说「生成问题报告」（系统程序化写 md）。
- **禁止**把润滑/变频器 OK 等无关地址说成 MODE1/2/3。
- **默认用简洁中文对话回答**；不要输出超长 \`\`\`sama-file\`\`\`。
- 用户要「分析报告 / 问题报告 / 完整错误分析」时系统会程序化写 md；你不要再编一份矛盾报告。
- 禁止套用通用车铣 I/O 模板改写本机符号注释。
- 禁止在报告里写入与本机无关的其它客户机型数据或路径。
`
    : ''

  const ladRulesForPrompt = channel === 'fp' || channel === 'cam' ? '' : ladRules
  const pictureRules =
    channel === 'fp' || channel === 'chat' || !channel
      ? `
【FANUC PICTURE 事实 — 必须遵守】
1. \`.fp2\` = 很小的工程索引文本，系统**允许创建/写入**。示例内容：
3Xi
FPicture1
"[RETURN]"3206""1
"FPicture1"3207""0
2. 真正的画面是同目录 \`FPicture1.xml\` 等，根节点必须是 \`<FANUCPicture>\`（UTF-16），不是 .fp2 本体。
3. 禁止编造 \`<FPScreen>/<FPLabel>/<FPInit>\` 假格式。
4. 禁止说「无法访问桌面」或「系统不允许 .fp2」。
5. 用户给文件夹时：优先改已加载的 FPicture*.xml；若要求生成工程，用绝对路径同时写 \`.fp2\` + \`FPicture1.xml\`。
6. 不要把画面写到 projects/studer-step/step_param.xml（除非用户明确要求改沙箱示例）。

写回示例：
\`\`\`sama-file path="C:\\\\Users\\\\...\\\\AUTO FIND CENTER20200302\\\\SAMA_GEN.fp2"
${buildFp2Content('FPicture1').replace(/\r\n/g, '\n').trim()}
\`\`\`
以及同目录 FPicture1.xml（完整 <FANUCPicture>...）。
`
      : ''

  const systemAsk = `你是 SAMA，机床维修与数控写码助手（Ask＝只问答，本模式不写盘）。
已接入：${libLine}
${KB_PRIORITY_RULES}
知识库：
${kbBlock}

【强制】桌面/文档/下载下的路径可以读。若下方已有附件内容，禁止说「无法访问桌面」。
若用户要求新建/写入/保存文件（含 Ladder、前端页面、md、xml）：不要编假梯子糊弄；明确说「请切换到右上角 **Agent** 模式，我就能用 sama-file 写入；改 .LAD 点允许卡」。
${ladRulesForPrompt}
附件：
${attachBlock}
${visionBlock}${elecHint}
当前文件：${liveFilePath || '（无）'}
${liveFileContent ? `内容：\n\`\`\`\n${String(liveFileContent).slice(0, 14000)}\n\`\`\`` : ''}
Ask 不要输出 sama-file。
Ask 不要输出 sama-tool / sama-allow-desktop（桌面操作请用户切到 Agent）。
用户附图时必须以「识图结果」为准，看不清的尺寸标存疑，禁止编造。
机械设计 / 电气设计 / Ladder / PICTURE / 加工是独立对话，直接回答用户问题。Ladder 与 PICTURE 功能禁止混用。加工页只做「看图出码」和「看码识件」。禁止声称已改机床梯形、已下发、已在外部 CAD 里改好工程。
${channelLockRules(channel)}
`

  const systemAgent = `你是 SAMA Agent。你可以**真正写入**用户桌面/文档/下载与工程沙箱中的文件（用 sama-file）。新开对话也有此能力，与有没有旧聊天无关。
禁止说「无法新建文件」「不能写入 Ladder3」「请手动粘贴」。除非路径非法或用户未给路径。

【Desktop Tool — Windows 桌面操作】
你可以通过 SAMA Desktop Tool 操作当前 Windows（限允许目录与策略）。
可用能力：
- 文件 / 启动应用 / 窗口 / 安全 shell
- 截图：screenshot.screen | screenshot.window | screenshot.region
- UI：ui.tree / ui.find / ui.findElement（UIA→OCR 逐级查找）；ui.click / ui.clickElement 需确认
- 键鼠：mouse.* / keyboard.*（需确认，禁止空口说「已点击」）
- OCR：ocr.available / ocr.image（不可用时会如实返回，勿假装识别成功）
- 多步任务：desktop.runPlan（steps + verify + retries + fallbacks）；desktop.observe 观察桌面
- dryRun: true 可预览计划不执行副作用
- Android：adb.devices / emulator.open / android.installApk（装 APK 需确认；无设备时如实报错，不假装成功）
- 机床软件：cnc.probe / cnc.openApp / cnc.openLad（仅 GUI）/ cnc.openPicture / cnc.backupNc；**禁止**用 Desktop 工具假装已改梯子或已下机床
调用方式（JSON）：
\`\`\`sama-tool
{"tool":"cnc.openApp","args":{"name":"ladder3"}}
\`\`\`
高风险用 sama-allow-desktop。优先「点击名为安装的按钮」(ui.clickElement)，不要只给裸坐标。
规则：
1. **禁止**在未看到【Desktop 工具结果】成功前声称「已经打开/已经删除/已经点击/已经安装」。
2. 路径用「桌面/」「文档/」「下载/」「workspace/」或允许根下的绝对路径；禁止 C:\\Windows 等系统目录。
3. LAD / Fladder **改写/导出助记符**仍走 sama-allow-ladder / lad-edit；Desktop 的 cnc.openLad 只打开 GUI。
4. 多步任务用 desktop.runPlan，让系统做观察/重试/回退；不要假装自己点了好几步。
5. APK/ADB：没有在线设备时说明原因（未装 adb / 模拟器未开 / unauthorized），禁止谎称安装成功。
6. **禁止**声称已向真实机床发送程序、启停主轴、改 PMC 在线；本层只有本机文件与软件 GUI。
7. **工业对话**：机械设计 / 电气设计 / Ladder / PICTURE / 加工各自独立，历史不串。Ladder 只写 .LAD，PICTURE 只写 .fp2/画面 XML，禁止混用。加工页只做看图出完整程序、看程序识零件与参数。**禁止**自动改机床 .LAD、自动下发。**禁止**空口吐长程序后声称已校验/已仿真/已下机床。
${channelLockRules(channel)}
${KB_PRIORITY_RULES}

【写文件能力 — 必须遵守】
1. 文本类（.md/.html/.xml/.txt/.nc/.fp2 等）：直接输出 \`\`\`sama-file path="相对路径或绝对路径"\`\`\`，系统会落盘。
2. 用户说「在 ladder3 / LADDER 里新建个文件、写点前端」：在桌面创建例如 \`C:\\\\Users\\\\...\\\\Desktop\\\\ladder3_demo.html\`（或用户指定目录），写入简单 HTML；**不要**假装改 LADDER-III 软件内部。
3. 二进制 \`.LAD\`：**禁止**用 sama-file 覆盖；改梯形只输出 \`sama-allow-lad-edit\`，等用户点允许后由脚本 MnemonicToSrc 写回。
4. 禁止覆盖用户未授权的系统目录。
5. **SAMA文件库**（桌面与工程沙箱各一份，已分类）：
   - \`SAMA文件/01_加工程序\` \`02_图纸\` \`04_梯形图\` \`05_画面\` \`06_说明文档\` \`07_其它\`
   - \`SAMA文件/03_电路图/<机床型号>/\`：整本 HTML/PDF、连通性 md/txt、\`单页/\` 下各页 SVG；知识库在 \`03_电路图/_知识库_circuit-cases/\`
   - 新建文件夹：\`\`\`sama-mkdir path="SAMA文件/01_加工程序/STUDER_S40"\`\`\`
   - 相对路径会按类型归类；FANUC 加工程序写到 \`SAMA文件/01_加工程序/<机床型号>/Oxxxx\`（程序号当文件名，**不要加 .nc**）。西门子写 \`_N_名字_MPF\`。
   - 加工页展示代码用 \`\`\`gcode 围栏，不要主动超长 sama-file；用户会点「生成 G 代码文件」。
${pictureRules}
工程沙箱树（参考）：
${treeSummary}
可信路径：
${trustedLine}
${ladRulesForPrompt}
当前文件：${liveFilePath || '（无）'}
\`\`\`
${String(liveFileContent || '').slice(0, 14000)}
\`\`\`
附件：
${attachBlock}
${visionBlock}${elecHint}
知识库：
${kbBlock}

【写文件】禁止用 sama-file 覆盖 .LAD（改 LAD 走 allow）。分析类问题优先对话回答，禁止用超长 sama-file 灌一整本报告。
仅当用户明确要求落盘 md 时再写短文件；完整事实报告可由系统程序化生成。
`

  const userWithAttach =
    mergedAttachments.length
      ? `${userText}\n\n【本回合附件】\n${mergedAttachments
          .map((a) => `- ${a.name}${a.path ? ` (${a.path})` : ''}${a.kind === 'image' ? '（图片）' : ''}`)
          .join('\n')}${vision.report ? `\n\n${vision.report}` : ''}${grindBlock}`
      : userText

  const historyLimit = ladAbs ? 3 : 12
  const historyCharCap = ladAbs ? 1200 : 8000
  const settingsNow = loadSettings()
  const passImages =
    vision.imageParts.length > 0 &&
    modelAcceptsImages(settingsNow.provider, settingsNow.model)
  const userMessage =
    passImages
      ? {
          role: 'user',
          content: [
            { type: 'text', text: userWithAttach },
            ...vision.imageParts,
          ],
        }
      : { role: 'user', content: userWithAttach }

  const messages = [
    { role: 'system', content: mode === 'agent' ? systemAgent : systemAsk },
    ...history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m, i, arr) => {
        if (i === arr.length - 1 && m.role === 'user' && m.content === userText) return false
        return true
      })
      // 丢掉污染历史：超长逐行表 / 幻觉安全审计
      .filter((m) => {
        if (!ladAbs || m.role !== 'assistant') return true
        const c = String(m.content || '')
        if (c.length > 3500 && /严重度|逐行/.test(c)) return false
        if (looksLikeHallucinatedLadReport(c)) return false
        if ((c.match(/\| X\d{4}\.\d \|/g) || []).length >= 12) return false
        return true
      })
      .slice(-historyLimit)
      .map((m) => ({
        role: m.role,
        content: String(m.content || '').slice(0, historyCharCap),
      })),
    userMessage,
  ]

  let result
  const replicaOk =
    pdfAtt?.content &&
    looksLikePdfReplicaTask(userText) &&
    !looksLikeElecEdit(userText) &&
    (channel === 'elec' || looksLikeElecTask(userText))
  if (replicaOk) {
    const book = buildElecBookFromPdf(pdfAtt.content)
    const bookLint = lintElecDocs(book.docs, { pdfReferenceText: pdfAtt.content })
    if (book.docs.length && !(bookLint.errors || []).length) {
      const tocLines = (book.toc || []).map((t) => `/${t.no} ${t.title}`).join('\n')
      result = {
        content: `已按附件 PDF 程序化还原电路连通性（${book.docs.length} 页）。\n\n目录：\n${tocLines}\n\n【elec-json 由 PDF 文本还原；系统将导出连通性 md/txt，不渲染原理图。】\n\n${docsToElecJsonFences(book.docs)}`,
        model: 'pdf-text',
        usage: {},
        finishReason: 'stop',
      }
    }
  }
  if (!result) {
    result = await chatWithLlm({
      messages,
      maxTokens: ladAbs ? 2048 : 8192,
      timeoutMs: vision.imageCount ? 180000 : undefined,
    })
  }

  let fileOps = []
  let content = result.content
  let finishReason = result.finishReason
  if (elecPreview?.path) {
    fileOps.push({
      ok: true,
      path: elecPreview.path,
      created: true,
      bytes: elecPreview.bytes,
    })
  }
  if (vision.userNote) {
    content = `${vision.userNote}\n\n${content}`
  }
  const grindChannel = channel === 'cam' || channel === 'chat' || !channel
  const skipGrindRepair = isReadCodeTask(userText)
  if (grindChannel && grindDims && !skipGrindRepair) {
    const grindFix = repairAssistantGrindGcode(content, grindDims, {
      force: wantsGrindProgram(userText),
      userText,
    })
    content = grindFix.content
  } else if (grindChannel && !skipGrindRepair && wantsGrindProgram(userText)) {
    const lateDims = extractGrindDims(`${vision.report || ''}\n${content}`)
    if (lateDims) {
      const grindFix = repairAssistantGrindGcode(content, lateDims, {
        force: true,
        userText,
      })
      content = grindFix.content
    }
  }

  // LAD 对话被长度截断：不自动续写超长表（会越续越卡），直接提示改用程序化报告
  if (ladAbs && finishReason === 'length') {
    content = `${String(content || '').trim()}

---
【系统提示】回复因长度上限中断（LAD 分析默认限制约 2048 tokens），所以会停在表格半截，并不是死机。
请不要再要求「把全部 X/Y/G 逐行扫完」。改为：
1. 问具体现象/报警号做针对性排查；或
2. 说「导出分析报告」由系统写完整事实版 md（可双击打开）。`
  }

  // 截断续写：仅对明确落盘且未闭合的 sama-file；最多 1 轮，避免「分析」卡住数分钟
  if (mode === 'agent' && applyFiles && wantsLadReportFile(userText) === false) {
    // 分析对话：若模型仍开了超长 sama-file，直接丢掉文件块，只保留说明文字
    if (/```sama-file/i.test(content) && content.length > 8000) {
      content =
        content.replace(/```sama-file\s+path\s*=\s*["'][^"']+["']\s*\r?\n[\s\S]*?(?:```|$)/gi, '').trim() +
        '\n\n（已忽略过长的文件写入块，避免卡住；完整事实报告可再说「导出分析报告」。）'
    }
  } else if (mode === 'agent' && applyFiles) {
    let rounds = 0
    while (
      rounds < 1 &&
      (hasTruncatedFileWrites(content) ||
        (finishReason === 'length' && /```sama-file/i.test(content)))
    ) {
      rounds += 1
      const cont = await chatWithLlm({
        messages: [
          ...messages,
          { role: 'assistant', content: content.slice(-12000) },
          {
            role: 'user',
            content:
              '输出被截断。请用很短续写闭合 ```sama-file（若有）；不要再展开长表格。优先结束。',
          },
        ],
        maxTokens: 1024,
        temperature: 0.2,
      })
      content = mergeAssistantContinuation(content, cont.content)
      finishReason = cont.finishReason
      if ((cont.content || '').length < 20) break
    }
    if (hasTruncatedFileWrites(content)) {
      content += '\n```'
    }
  }

  // 生成 fp / fp2：仅 PICTURE 页（或主对话）
  if (
    applyFiles !== false &&
    wantsCreateFp2Project(userText) &&
    (channel === 'fp' || channel === 'chat' || !channel)
  ) {
    const dirHints = [
      ...extractLikelyDirPaths(userText),
      ...mergedAttachments.map((a) => (a.path ? path.dirname(a.path) : '')).filter(Boolean),
      ...preferredFanucDirs().filter((d) => {
        try {
          return fs.existsSync(d)
        } catch {
          return false
        }
      }),
      defaultFanucOutputDir(),
    ]
    const targetDir = dirHints.find(Boolean)
    if (targetDir) {
      try {
        const created = createFanucPictureProject(targetDir, {
          projectName: 'SAMA_GEN',
          screenName: 'FPicture1',
          trustedPaths: [...trustedPaths, targetDir],
          comment: 'SAMA auto-generated screen',
          overwriteXml: false,
        })
        fileOps.push({
          ok: true,
          path: created.fp2Path,
          created: true,
          bytes: Buffer.byteLength(buildFp2Content('FPicture1'), 'utf8'),
          external: true,
        })
        fileOps.push({
          ok: true,
          path: created.xmlPath,
          created: created.xmlCreated,
          bytes: 0,
          external: true,
        })
        // 覆盖模型“无法生成 fp2”的错误说法
        content = `可以。已直接生成 FANUC PICTURE 工程文件：

- \`${created.fp2Path}\`（工程索引 .fp2）
- \`${created.xmlPath}\`（画面 XML，根节点 FANUCPicture）

用 **FANUC PICTURE** 打开上面的 \`.fp2\` 即可。
说明：\`.fp2\` 是工程索引；真正画面在同目录 \`FPicture*.xml\`。

${created.hint}

---
（模型原文仅供参考，若与上方冲突以实际落盘为准）
${result.content}`
      } catch (e) {
        content = `尝试生成 .fp2 失败：${e.message || e}\n\n${result.content}`
      }
    }
  }

  if (mode === 'agent' && applyFiles) {
    // FANUC/fp 意图时，禁止再污染 step_param.xml
    let writeText = content
    if (wantsCreateFp2Project(userText)) {
      writeText = writeText.replace(
        /```sama-file\s+path\s*=\s*["']projects\/studer-step\/step_param\.xml["']\s*\r?\n[\s\S]*?```/gi,
        '',
      )
    }
    // 误把报告写进 .LAD：自动改写为旁路 .md
    writeText = rewriteLadReportTargets(writeText)
    // 丢掉模型写的「无注释」假报告，避免覆盖正确事实
    writeText = stripMisleadingLadReports(writeText)
    const blocked = parseFileWriteBlocks(writeText).filter((b) => !channelAllowsWritePath(channel, b.path))
    if (blocked.length) {
      writeText = stripSamaFileBlocksForPaths(
        writeText,
        blocked.map((b) => b.path),
      )
      for (const b of blocked) {
        fileOps.push({
          ok: false,
          path: b.path,
          error:
            channel === 'fp'
              ? 'PICTURE 页只写 .fp2 / 画面 XML，请切到对应页'
              : channel === 'lad' || channel === 'plc'
                ? 'Ladder 页不写画面或加工程序，请切到对应页'
                : '加工页不写 .LAD / .fp2，请切到对应页',
        })
      }
    }
    for (const d of parseMkdirBlocks(writeText)) {
      try {
        const rel = rewriteToLibraryRel(d.path)
        const r = mkdirWorkspaceFolder(rel)
        fileOps.push({
          ok: true,
          path: r.path,
          created: true,
          bytes: 0,
          mkdir: true,
        })
      } catch (e) {
        fileOps.push({
          ok: false,
          path: d.path,
          error: e.message || String(e),
        })
      }
    }
    const writes = parseAndApplyFileWrites(writeText, { trustedPaths })
    fileOps = [...fileOps, ...writes]
  }

  if (channel === 'elec' || looksLikeElecTask(userText) || /```elec-json/i.test(content || '')) {
    try {
      const pdfRef = mergedAttachments
        .filter((a) => a.kind === 'pdf' || /\.pdf$/i.test(a.path || a.name || ''))
        .map((a) => String(a.content || ''))
        .join('\n')
      if (pdfRef && looksLikePdfReplicaTask(userText) && !looksLikeElecEdit(userText)) {
        const book = buildElecBookFromPdf(pdfRef)
        const bookLint = lintElecDocs(book.docs, { pdfReferenceText: pdfRef })
        if (book.docs.length && !(bookLint.errors || []).length) {
          const stripped = String(content || '')
            .replace(/```elec-json\s*\r?\n[\s\S]*?```/gi, '')
            .trim()
          content = `${stripped}\n\n【elec-json 由附件 PDF 文本程序化还原（位号/I/O/连线以 PDF 为准）。系统将导出连通性表。】\n\n${docsToElecJsonFences(book.docs)}`
        }
      }
      const arts = await applyElecJsonFromText(content, {
        sourceText: content,
        pdfReferenceText: pdfRef,
      })
      const rejected = arts.find((a) => a.rejected)
      if (rejected) {
        const errList = rejected.errors || rejected.layoutErrors || []
        const errLines = formatLintSummary({ errors: errList }, { max: 24 })
        let retryArts = null
        let retryNote = ''
        if (/```elec-json/i.test(content || '') && errList.length) {
          const ioBrief = pdfRef ? formatIoDescBrief(pdfRef) : ''
          const fixUser = [
            '【校验驳回·系统自动请求重出】上一版 elec-json 未通过，请在本回复输出**修正后的完整多段 elec-json**（覆盖全部页，不要只解释）。',
            errLines,
            ioBrief,
            '重点：①I/O 每项 desc 必填且与 PDF 一致 ②电机列 wires 首尾相接 ③rails 仅 R/S/T/PE ④Q/KM 同号。',
          ]
            .filter(Boolean)
            .join('\n\n')
          try {
            const retryResult = await chatWithLlm({
              messages: [
                ...messages,
                { role: 'assistant', content: String(content || '').slice(0, 14000) },
                { role: 'user', content: fixUser },
              ],
              maxTokens: 8192,
            })
            retryArts = await applyElecJsonFromText(retryResult.content, {
              sourceText: retryResult.content,
              pdfReferenceText: pdfRef,
            })
            const retryRejected = retryArts.find((a) => a.rejected)
            if (!retryRejected) {
              content = `${retryResult.content.trim()}\n\n---\n【已按校验意见自动重出并通过】`
              retryNote = '（系统已自动重出 1 次并通过校验）'
              for (const art of retryArts) {
                if (art.path) fileOps.push({ ok: true, path: art.path, created: true, bytes: art.bytes })
                if (art.txtPath) fileOps.push({ ok: true, path: art.txtPath, created: true })
              }
              const previewArt = pickElecPreviewArt(retryArts)
              if (previewArt?.markdown || previewArt?.connectivityText) elecPreview = previewArt
            } else {
              const retryErr = formatLintSummary(
                { errors: retryRejected.errors || retryRejected.layoutErrors || [] },
                { max: 18 },
              )
              retryNote = `\n\n【自动重出仍未通过】${retryErr}`
            }
          } catch {
            // 重试失败则保留原拒出说明
          }
        }
        if (!retryArts || retryArts.find((a) => a.rejected)) {
          content = `${String(content || '').trim()}\n\n---\n【连通性不合格，未导出】${errLines}${retryNote}\n\n请按 9c 规则**完整重出** elec-json（与 PDF 一致、连接正确）。系统**不会**自动改 JSON。`
        }
      } else {
        for (const art of arts) {
          if (art.path) {
            fileOps.push({
              ok: true,
              path: art.path,
              created: true,
              bytes: art.bytes,
            })
          }
          if (art.txtPath) {
            fileOps.push({ ok: true, path: art.txtPath, created: true })
          }
        }
        const previewArt = pickElecPreviewArt(arts)
        if (previewArt?.markdown || previewArt?.connectivityText) elecPreview = previewArt
        if (
          !arts.length &&
          !elecPreview &&
          channel === 'elec' &&
          /生成|出图|画|连通|电路/.test(userText) &&
          !looksLikeElecEdit(userText) &&
          !/```elec-json/i.test(content || '')
        ) {
          elecPreview = await generateSheet({ template: 'power1' })
          fileOps.push({
            ok: true,
            path: elecPreview.path,
            created: true,
            bytes: elecPreview.bytes,
          })
          if (elecPreview.txtPath) {
            fileOps.push({ ok: true, path: elecPreview.txtPath, created: true })
          }
        }
      }
    } catch {
      // 出图失败不阻断回答
    }
  }

  // 注：LAD「问题报告」已在上方短路程序化生成，此处不再让模型掺和

  if (fileOps.length) {
    content = `${stripFileOpsFooter(content)}\n\n---\n【文件操作结果】\n${formatFileOpLines(fileOps).join('\n')}`
  }

  // Desktop Tool：Agent 模式解析 sama-tool / 意图兜底，SAFE 实执行；CONFIRM 生成批准卡标记
  let desktopOps = []
  if (mode === 'agent' && applyFiles !== false) {
    const desk = await applyDesktopToolsFromAgent({ mode, userText, content })
    content = desk.content
    desktopOps = desk.desktopOps || []
  }

  return {
    content,
    model: result.model,
    usage: result.usage,
    citations: hits.map((h) => `${h.brand} / ${h.source}`),
    sources: hits.map((h, i) => {
      const raw = String(h.content || '')
      const titleMatch = raw.match(/【([^】]{1,80})】/)
      const snippet = raw
        .replace(/【[^】]*】/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240)
      return {
        n: i + 1,
        id: h.id,
        brand: h.brand,
        source: h.source,
        title: titleMatch?.[1] || String(h.source || '').split(/[/\\]/).pop() || h.source,
        snippet,
        score: h.score,
      }
    }),
    kbHits: hits.length,
    desktopOps,
    fileOps,
    plcSample: elecPreview?.markdown || elecPreview?.connectivityText
      ? {
          title: elecPreview.doc?.page?.title || '电路连通性',
          electrical: {
            connectivityText: elecPreview.connectivityText || elecPreview.markdown,
            markdown: elecPreview.markdown,
            path: elecPreview.path,
            txtPath: elecPreview.txtPath,
            deviceCount: elecPreview.deviceCount,
            edgeCount: elecPreview.edgeCount,
          },
        }
      : undefined,
    autoLoaded: autoAttachments.map((a) => a.path),
  }
}

/** 同一路径只提示一行保存结果 */
function formatFileOpLines(ops) {
  const seen = new Set()
  const lines = []
  for (const op of ops || []) {
    const key = String(op.path || '')
      .replace(/\\/g, '/')
      .toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    lines.push(
      op.ok
        ? op.mkdir
          ? `✓ 已创建文件夹：${op.path}`
          : `✓ 已${op.created ? '创建' : '保存'}：${op.path}（${op.bytes} 字节）${op.external ? ' [本机]' : ''}（双击打开）`
        : `✗ 拒绝：${op.path} — ${op.error}`,
    )
  }
  return lines
}

function stripFileOpsFooter(text) {
  return String(text || '').replace(/\n*---\n【文件操作结果】[\s\S]*$/u, '').replace(/\n*---\n【LAD 事实报告已落盘】[\s\S]*$/u, '')
}

/** 从模型回复里删掉指向指定路径的 sama-file 块（含未闭合） */
function stripSamaFileBlocksForPaths(text, paths) {
  const keys = new Set(
    (paths || [])
      .filter(Boolean)
      .map((p) =>
        String(p)
          .replace(/\\/g, '/')
          .toLowerCase(),
      ),
  )
  if (!keys.size) return text
  const s = String(text || '')
  let out = ''
  let last = 0
  const openRe = /```sama-file\s+path\s*=\s*["']([^"']+)["']\s*\r?\n/gi
  let m
  while ((m = openRe.exec(s)) !== null) {
    out += s.slice(last, m.index)
    const raw = m[1].trim()
    const bodyStart = m.index + m[0].length
    const after = s.slice(bodyStart)
    const closeMatch = after.match(/\r?\n```/)
    const end = closeMatch ? bodyStart + closeMatch.index + closeMatch[0].length : s.length
    const norm = raw.replace(/\\/g, '/').toLowerCase()
    const base = path.basename(norm)
    const drop = [...keys].some((k) => norm === k || path.basename(k) === base)
    if (!drop) out += s.slice(m.index, end)
    last = end
    openRe.lastIndex = end
  }
  out += s.slice(last)
  return out
}

/** 若 sama-file 指向 .LAD 但正文是 Markdown 报告，改写到旁路 .md */
function rewriteLadReportTargets(text) {
  const blocks = parseFileWriteBlocks(text)
  if (!blocks.length) return text
  let out = text
  for (const b of blocks) {
    if (!/\.lad$/i.test(b.path)) continue
    const body = b.content || ''
    const looksMd =
      /^\s*#\s+/m.test(body) ||
      /问题分析|分析报告/i.test(body) ||
      (/\|[-:]+\|/m.test(body) && body.length > 200)
    if (!looksMd) continue
    const mdPath = `${b.path}_问题分析报告.md`
    const q1 = `path="${b.path}"`
    const q2 = `path='${b.path}'`
    if (out.includes(q1)) out = out.replace(q1, `path="${mdPath}"`)
    else if (out.includes(q2)) out = out.replace(q2, `path='${mdPath}'`)
  }
  return out
}

function summarizeTree(nodes, prefix = '') {
  const lines = []
  for (const n of nodes) {
    if (n.type === 'folder') {
      lines.push(`${prefix}${n.name}/`)
      if (n.children?.length) {
        lines.push(summarizeTree(n.children, `${prefix}  `))
      }
    } else {
      lines.push(`${prefix}${n.name}`)
    }
  }
  return lines.filter(Boolean).join('\n')
}

function formatAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return '（无附件）'
  return attachments
    .slice(0, 8)
    .map((a, i) => {
      const head = `[附件${i + 1}] ${a.name || '未命名'}${a.path ? `\n路径: ${a.path}` : ''}`
      const limit =
        a.lad || isLadPath(a.path || a.name || '')
          ? 14000
          : a.kind === 'folder'
            ? 24000
            : 8000
      const body =
        a.kind === 'image'
          ? '（图片：已交识图通道，见「识图结果」）'
          : String(a.content || '').slice(0, limit)
      return `${head}\n\`\`\`\n${body}\n\`\`\``
    })
    .join('\n\n')
}

/** 去掉模型生成的误导性 LAD 分析（声称无注释、通用模板幻觉等） */
function stripMisleadingLadReports(text) {
  const blocks = parseFileWriteBlocks(text)
  if (!blocks.length) return text
  let out = text
  for (const b of blocks) {
    if (!/\.md$/i.test(b.path)) continue
    const body = b.content || ''
    const bad =
      /几乎没有有意义的注释|注释缺失是最严重|所有输入无功能注释|可维护性极差/.test(body) ||
      looksLikeBrokenLadSymbolTable(body) ||
      looksLikeHallucinatedLadReport(body)
    if (!bad) continue
    const fence = '```'
    const q1 = `${fence}sama-file path="${b.path}"\n${b.content}`
    const q2 = `${fence}sama-file path='${b.path}'\n${b.content}`
    if (out.includes(q1 + '\n```')) out = out.replace(q1 + '\n```', '')
    else if (out.includes(q2 + '\n```')) out = out.replace(q2 + '\n```', '')
    else if (out.includes(q1)) out = out.replace(q1, '')
    else if (out.includes(q2)) out = out.replace(q2, '')
  }
  return out
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

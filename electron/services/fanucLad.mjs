/**
 * FANUC LADDER-III .LAD 工程读取
 * .LAD 实为 ZIP：内含 MAP.TXT / TITLE / XSYMBOL / Pn.#LA 等
 * 梯形图逻辑：经 LADDER-III 导出助记符后再解析（见 fanucMnemonic / fanucLadderIii）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { decodeTextBuffer, repairCommonMojibake } from './textEncoding.mjs'
import {
  findSidecarMnemonic,
  parseMnemonic,
} from './fanucMnemonic.mjs'
import {
  analyzeSafetyChains,
  discoverInterlockPairCandidates,
  enrichPairsWithMnemonic,
} from './fanucLadEvidence.mjs'
import { exportMnemonicViaLadderIiiSync, probeLadderIii } from './fanucLadderIii.mjs'

export function isLadPath(filePath) {
  return /\.lad$/i.test(String(filePath || ''))
}

function extractZipToTemp(absZip, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  // Windows 10+ / macOS / Linux：tar 可解标准 ZIP
  execFileSync('tar', ['-xf', absZip, '-C', destDir], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

function readTextLoose(abs) {
  if (!abs || !fs.existsSync(abs)) return ''
  const buf = fs.readFileSync(abs)
  if (!buf.length) return ''
  const { text } = decodeTextBuffer(buf, { prefer: ['gb18030', 'gbk', 'utf-8', 'shift_jis'] })
  return repairCommonMojibake(text).trim()
}

/** 从 XSYMBOL 抽出「地址 + 注释」对（FANUC 多为 TSV：地址\\t注释\\t...\\r\\n） */
export function extractSymbolPairs(buf, limit = 2000) {
  const text = buf.toString('latin1')
  const pairs = []
  const seen = new Set()

  // 优先按行+制表符解析（LADDER-III 常见导出格式）
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (pairs.length >= limit) break
    const cols = line.split('\t').map((s) => s.trim()).filter(Boolean)
    if (cols.length < 2) continue
    const addr = cols[0]
    if (!/^[XYFGRAKTCD]\d{1,5}(?:\.\d)?$/i.test(addr)) continue
    // 取第一个非地址、非纯数字碎片的注释列
    let comment = ''
    for (let k = 1; k < cols.length; k++) {
      const c = cols[k]
      if (/^[XYFGRAKTCD]\d/i.test(c)) continue
      if (/^\d+\.\d+$/.test(c)) continue
      if (c.length < 2) continue
      comment = c
      break
    }
    if (!comment) continue
    const key = `${addr.toUpperCase()}|${comment}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ addr: addr.toUpperCase(), comment })
  }

  if (pairs.length >= 20) return pairs

  // 回退：扫描最长地址后跟 ASCII 注释
  const re = /([XYFGRAKTCD]\d{4}(?:\.\d)?|[XYFGRAKTCD]\d{1,5}\.\d)/gi
  let m
  while ((m = re.exec(text)) && pairs.length < limit) {
    const addr = m[1].toUpperCase()
    let j = m.index + m[1].length
    while (j < buf.length && (buf[j] === 0 || buf[j] === 9 || buf[j] === 32)) j++
    let comment = ''
    while (j < buf.length && buf[j] >= 32 && buf[j] < 127 && comment.length < 48) {
      comment += String.fromCharCode(buf[j])
      j++
    }
    comment = comment.trim()
    if (comment.length < 2) continue
    if (/^[0-9.]+$/.test(comment)) continue
    if (/^[XYFGRAKTCD]\d/i.test(comment)) continue
    const key = `${addr}|${comment}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ addr, comment })
  }
  return pairs
}

function walkFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) walkFiles(full, base, out)
    else out.push({ rel: path.relative(base, full).split(path.sep).join('/'), size: st.size, abs: full })
  }
  return out
}

/**
 * 把 .LAD 读成可检索/可对话的文本摘要
 */
const ladProjectCache = new Map()

export function clearLadProjectCache(absPath) {
  if (!absPath) {
    ladProjectCache.clear()
    return
  }
  ladProjectCache.delete(path.resolve(absPath).toLowerCase())
}

export function readLadProject(absPath) {
  const abs = path.resolve(absPath)
  if (!fs.existsSync(abs)) throw new Error(`文件不存在：${abs}`)
  const st = fs.statSync(abs)
  if (!st.isFile()) throw new Error('只能读取普通 .LAD 文件')
  if (st.size > 16 * 1024 * 1024) throw new Error('LAD 文件过大（>16MB）')

  const cacheKey = abs.toLowerCase()
  const cached = ladProjectCache.get(cacheKey)
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.value
  }

  const value = readLadProjectUncached(abs, st)
  ladProjectCache.set(cacheKey, { mtimeMs: st.mtimeMs, size: st.size, value })
  // 最多缓存 6 个工程，避免占内存
  if (ladProjectCache.size > 6) {
    const first = ladProjectCache.keys().next().value
    ladProjectCache.delete(first)
  }
  return value
}

function readLadProjectUncached(abs, st) {
  const tmp = path.join(os.tmpdir(), `sama-lad-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  try {
    extractZipToTemp(abs, tmp)
  } catch (e) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    throw new Error(`无法解压 .LAD（应为 FANUC LADDER-III ZIP）：${e.message || e}`)
  }

  try {
    const members = walkFiles(tmp)
    const byName = Object.fromEntries(members.map((m) => [m.rel.toUpperCase(), m]))

    const title = readTextLoose(byName['TITLE']?.abs || '')
    const mapTxt = readTextLoose(byName['MAP.TXT']?.abs || '')
    const option = readTextLoose(byName['OPTION']?.abs || '')
    const zipInfo = readTextLoose(byName['ZIPMEMBERINFO.TXT']?.abs || '')
    const sysInf = readTextLoose(byName['_SYSINF.TXT']?.abs || '')

    let symbols = []
    const symMember = members.find((m) => /^XSYMBOL/i.test(path.basename(m.rel)))
    if (symMember) {
      symbols = extractSymbolPairs(fs.readFileSync(symMember.abs), 2500)
    }

    const ladderLevels = members
      .filter((m) => /\.#LA$/i.test(m.rel) || /^P\d+\.#LA$/i.test(path.basename(m.rel)))
      .map((m) => ({ rel: m.rel, size: m.size }))

    const lines = []
    lines.push(`# FANUC LADDER 工程摘要`)
    lines.push('')
    lines.push(`来源文件：${abs}`)
    lines.push(`大小：${st.size} 字节`)
    lines.push(`符号条数：${symbols.length}`)
    lines.push('')
    lines.push('> 地址格式应为 X0000.0 这类完整地址；注释来自 XSYMBOL，不是空的。')
    lines.push('> G=PMC→CNC，F=CNC→PMC，R=内部继电器。不要把 G 当成内部继电器。')
    lines.push('> MAP 中文日期按 GBK/GB18030 解码；异常时再查编码，不等于工程损坏。')
    lines.push('')
    if (title) {
      lines.push('## TITLE')
      lines.push(title.replace(/\s{2,}/g, ' | ').trim())
      lines.push('')
    }
    if (mapTxt) {
      lines.push('## 内存映射 MAP.TXT')
      lines.push(mapTxt)
      lines.push('')
    }
    if (option) {
      lines.push('## OPTION')
      lines.push(option.slice(0, 2000))
      lines.push('')
    }
    if (ladderLevels.length) {
      lines.push('## 梯子程序块')
      for (const m of ladderLevels) {
        lines.push(`- ${m.rel}（${m.size} 字节）`)
      }
      lines.push('')
      lines.push('说明：`.#LA` 为二进制梯形图，需用 FANUC LADDER-III 打开编辑。此处提供符号与工程信息供维修检索。')
      lines.push('')
    }
    if (symbols.length) {
      const preview = symbols.slice(0, 80)
      lines.push(`## 符号表摘录（共 ${symbols.length} 条，下列 ${preview.length} 条）`)
      lines.push('| 地址 | 注释 |')
      lines.push('|------|------|')
      for (const s of preview) {
        lines.push(`| ${s.addr} | ${s.comment.replace(/\|/g, '/')} |`)
      }
      if (symbols.length > preview.length) {
        lines.push('')
        lines.push(`… 另有 ${symbols.length - preview.length} 条已解析在内存，分析时以事实卡为准。`)
      }
      lines.push('')
    }
    if (zipInfo) {
      lines.push('## 成员清单 ZIPMEMBERINFO')
      lines.push(zipInfo.slice(0, 2500))
      lines.push('')
    }
    lines.push('## 包内文件')
    for (const m of members) {
      lines.push(`- ${m.rel}（${m.size}）`)
    }
    if (sysInf) {
      lines.push('')
      lines.push('## _SYSINF.TXT（节选）')
      lines.push(sysInf.split('\n').slice(0, 40).join('\n'))
    }

    const content = lines.join('\n')
    return {
      ok: true,
      name: path.basename(abs),
      path: abs,
      kind: 'text',
      lad: true,
      size: st.size,
      memberCount: members.length,
      symbolCount: symbols.length,
      symbols,
      title,
      mapTxt,
      option,
      ladderLevels,
      content: content.slice(0, 120_000),
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/** 是否明确要求把分析报告写成 md 文件 / 生成问题报告 */
export function wantsLadReportFile(text) {
  const s = String(text || '')
  if (/(分析报告|问题分析报告|问题报告|代码问题报告|LAD.?报告|梯子.?报告|完整.{0,6}(错误|问题)?分析)/i.test(s))
    return true
  if (/错误分析|完整报告|事实报告|证据报告/.test(s)) return true
  if (/分析代码问题|代码问题分析|工程问题分析|符号表问题/.test(s)) return true
  if (/(输出|写|生成|保存|导出|重新生成).{0,20}(报告|问题分析|代码问题|错误分析)/i.test(s)) return true
  if (/(报告|分析).{0,12}(写到|保存到|导出到|生成到).{0,20}(\.md|桌面|本机)/i.test(s)) return true
  if (/(分析|检查).{0,8}(代码|工程|符号).{0,8}问题/.test(s) && /(报告|导出|生成|写)/.test(s)) return true
  return false
}

/** 是否像「请分析 LAD / 写问题报告」——仅用于判断要不要落盘报告文件 */
export function wantsLadAnalysisReport(text, { hasLadContext = false } = {}) {
  return wantsLadReportFile(text) && (hasLadContext || /(\.lad\b|梯子|梯形|PMC|LADDER)/i.test(String(text || '')))
}

/** 检测摘要是否被错误拆成 X0 / 000.0 */
export function looksLikeBrokenLadSymbolTable(text) {
  const s = String(text || '')
  const bad = (s.match(/\|\s*[XYFGRAKTCD]0\s*\|\s*0{1,4}\.\d\s*\|/gi) || []).length
  const good = (s.match(/\|\s*[XYFGRAKTCD]\d{4}\.\d\s*\|\s*[A-Za-z*]/gi) || []).length
  return bad >= 5 && good < 3
}

function symMap(symbols) {
  const m = new Map()
  for (const s of symbols || []) m.set(String(s.addr).toUpperCase(), s.comment)
  return m
}

function findSym(map, ...addrs) {
  for (const a of addrs) {
    const c = map.get(String(a).toUpperCase())
    if (c) return { addr: String(a).toUpperCase(), comment: c }
  }
  return null
}

function listByPrefix(symbols, re, limit = 80) {
  const hit = (symbols || []).filter((s) => re.test(s.addr) || re.test(s.comment))
  const rank = (a) => {
    const t = a.addr[0]
    if (t === 'X' || t === 'Y') return 0
    if (t === 'G' || t === 'F') return 1
    if (t === 'A' || t === 'K') return 2
    return 3
  }
  hit.sort((a, b) => rank(a) - rank(b) || a.addr.localeCompare(b.addr))
  return hit.slice(0, limit)
}

function ensureAddrs(map, list, addrs) {
  const out = [...list]
  const have = new Set(out.map((s) => s.addr))
  for (const a of addrs) {
    const s = findSym(map, a)
    if (s && !have.has(s.addr)) {
      out.push(s)
      have.add(s.addr)
    }
  }
  return out
}

function detectMachineProfile(title, symbols) {
  const t = String(title || '')
  const blob = `${t} ${(symbols || []).slice(0, 80).map((s) => s.comment).join(' ')}`
  const grind =
    /STUDER|MIKROSA|SCHAUDT|WALTER|BLOHM|WHEEL|GRIND|DRESS|砂轮|磨床/i.test(blob) ||
    (symbols || []).some((s) => /WHEEL|GRIND|DRESS|BARREL|TAILSTOCK|TAIK|WH\s*1|WH\s*2/i.test(s.comment))
  let brand = '通用 FANUC PMC'
  let series = ''
  if (/STUDER/i.test(t)) {
    brand = 'STUDER'
    series = (t.match(/S\d{2}(?:-\d)?/i) || [])[0] || ''
  } else if (/MIKROSA/i.test(t)) brand = 'MIKROSA'
  else if (/SCHAUDT/i.test(t)) brand = 'SCHAUDT'
  const cnc = (t.match(/0i-?\s*[A-Z0-9]+|30i|31i|32i|0ITF|0i-TF|0I-F/i) || [])[0] || ''
  return {
    brand,
    series,
    cnc,
    grind,
    label: [brand, series, cnc].filter(Boolean).join(' · ') || brand,
  }
}

const COMMENT_TYPO_RE =
  /SWTICH|BOTTON|CYCEL|RUNNIG|GRIDNG|TAIKSTCOK|TAISTOCK|CONTRL(?!O)|CONTRO(?![Ll])|\bCONTR\b|PNUM\.|BAPSS|SOFTSWTICH|MOTOR\s+STAT\b/i

/** 标准接口位（仅当符号表注释吻合时写入报告） */
const STD_G_HINTS = [
  ['G0008.4', /ESP|\*ESP|E-?STOP/i, 'CNC 急停相关（常见 NC*ESP）'],
  ['G0008.5', /\*SP|^SP$/i, '主轴停止相关'],
  ['G0007.2', /^ST$/i, '循环启动 ST'],
  ['G0008.7', /ERS/i, '外部复位'],
  ['G0004.3', /FIN/i, '杂项完成 FIN'],
]

/**
 * 给模型的紧凑事实卡：每次对话有 LAD 时都注入，保证后续分析不误判
 */
export function buildLadAnalysisBrief(absPathOrLad) {
  const lad = typeof absPathOrLad === 'string' ? readLadProject(absPathOrLad) : absPathOrLad
  const symbols = lad.symbols || []
  const map = symMap(symbols)
  const byType = {}
  for (const s of symbols) {
    const t = s.addr[0]
    ;(byType[t] ||= []).push(s)
  }
  const mapTxt = lad.mapTxt || ''
  const netZero =
    /Netcomment\s+-+H\s+-+H\s+000000H/i.test(mapTxt) || /Netcomment[\s\S]{0,40}0\.0KB/i.test(mapTxt)
  const profile = detectMachineProfile(lad.title, symbols)
  const levels = lad.ladderLevels || []
  const esp = findSym(map, 'G0008.4')
  const eStopX = findSym(map, 'X0008.4')
  const lines = []
  lines.push('【LAD/PMC 已核实事实——后续分析必须遵守】')
  lines.push(`- 文件：${lad.path}`)
  lines.push(`- 机型画像：${profile.label}${profile.grind ? '（外圆/砂轮磨床类 I/O）' : ''}`)
  lines.push(`- TITLE：${String(lad.title || '').replace(/\s+/g, ' ').trim() || '（无）'}`)
  lines.push(`- 有效符号：${symbols.length}（来自 XSYMBOL，注释真实存在）`)
  lines.push(
    `- 类型计数：${Object.keys(byType)
      .sort()
      .map((t) => `${t}=${byType[t].length}`)
      .join(' ')}`,
  )
  lines.push(`- Netcomment：${netZero ? '0（网络段无注释，这是真实短板）' : '非空'}`)
  if (levels.length) {
    lines.push(`- 程序块：${levels.map((m) => `${m.rel}:${m.size}B`).join('；')}`)
  }
  lines.push('- 地址约定：X/Y=机侧I/O；F=CNC→PMC；G=PMC→CNC；R=内部继电器。禁止把 G 叫内部继电器。')
  lines.push('- 地址格式：完整如 X0000.0，禁止拆成 X0 + 000.0，也禁止据此说「重复定义/无注释」。')
  lines.push('- MAP 中文日期按 GBK 解码；仍异常时再查编码，不等于工程损坏。')
  lines.push('- .#LA 为二进制梯形图，未见反汇编前不要编造具体梯级逻辑；可据符号+现象做排查假设并标明不确定。')
  lines.push('- 【严禁】把符号注释改写成「通用机床模板名」（例如把 WH1 MOTOR STAR 说成主轴正转、把 ED3 说成 E-STOP、把 COVER L. 说成开门阀）。')
  lines.push('- 【严禁】把「未用 LADDER-III/电气图确认」写成「已确认致命缺陷」。')
  if (esp) lines.push(`- 急停给 CNC 的常见接口位：${esp.addr} = ${esp.comment}（不要误用 G0000.x ED*）`)
  if (eStopX) lines.push(`- 机侧急停输入：${eStopX.addr} = ${eStopX.comment}`)
  const keyIo = [
    'X0000.0',
    'X0008.4',
    'Y0000.0',
    'Y0000.6',
    'Y0000.7',
    'Y0005.1',
    'Y0005.2',
    'G0008.4',
  ]
  const present = keyIo.map((a) => findSym(map, a)).filter(Boolean)
  if (present.length) {
    lines.push('- 关键 I/O（必须用下列真名）：')
    for (const s of present) lines.push(`  - ${s.addr} = ${s.comment}`)
  }
  lines.push('- 禁止结论：「几乎没有注释」「可维护性极差因为没注释」「符号全是默认空名」。')
  lines.push('- 禁止把 password=0、fromsiz、地址不连续、LEVEL 体积小单独升级为「高危故障」。')
  return lines.join('\n')
}

/** 给模型的精简 LAD 正文（避免 6 万字符号表拖死请求） */
export function buildLadModelContext(absPathOrLad, { maxSymbols = 80 } = {}) {
  const lad = typeof absPathOrLad === 'string' ? readLadProject(absPathOrLad) : absPathOrLad
  const symbols = lad.symbols || []
  const map = symMap(symbols)
  const profile = detectMachineProfile(lad.title, symbols)
  const pick = []
  const want = new Set()
  const add = (addr) => {
    const s = findSym(map, addr)
    if (s && !want.has(s.addr)) {
      want.add(s.addr)
      pick.push(s)
    }
  }
  // 磨床相关优先
  for (const s of symbols) {
    if (
      /WHEEL|GRIND|DRESS|BARREL|COOL|HYD|AIR|LUB|ESTOP|E-STOP|LIMIT|OVERRIDE|MODE|MPG|SERVO|STAR|DELTA|CW|CCW|COVER|ALARM|ESP/i.test(
        s.comment,
      )
    ) {
      if (!want.has(s.addr)) {
        want.add(s.addr)
        pick.push(s)
      }
    }
    if (pick.length >= maxSymbols) break
  }
  for (const a of ['G0008.4', 'G0008.5', 'G0007.2', 'G0000.0', 'G0000.3', 'Y0000.0', 'X0008.4']) add(a)
  for (const s of symbols) {
    if (pick.length >= maxSymbols) break
    if (!want.has(s.addr)) {
      want.add(s.addr)
      pick.push(s)
    }
  }

  const lines = []
  lines.push(buildLadAnalysisBrief(lad))
  lines.push('')
  lines.push(`## 机型：${profile.label}`)
  lines.push('## TITLE')
  lines.push(String(lad.title || '').replace(/\s+/g, ' ').trim() || '（无）')
  lines.push('')
  lines.push('## MAP.TXT')
  lines.push((lad.mapTxt || '').slice(0, 1200))
  lines.push('')
  lines.push('## 程序块')
  for (const m of lad.ladderLevels || []) {
    lines.push(`- ${m.rel}（${m.size} 字节）`)
  }
  lines.push('')
  lines.push(`## 符号摘录（共 ${symbols.length}，下列 ${pick.length} 条，注释必须原样引用）`)
  lines.push('| 地址 | 注释 |')
  lines.push('|------|------|')
  for (const s of pick) {
    lines.push(`| ${s.addr} | ${s.comment.replace(/\|/g, '/')} |`)
  }
  lines.push('')
  lines.push('（完整符号表已在本地解析；分析时以事实卡为准，勿要求或粘贴全部符号。）')
  return {
    path: lad.path,
    content: lines.join('\n'),
    symbolCount: symbols.length,
    lad,
  }
}

/** 为报告准备助记符：同目录侧车文件 → 可选 LADDER-III CLI 导出 */
export function resolveMnemonicForReport(ladPath, opts = {}) {
  const fladderConfigured = opts.fladderPath || ''
  const probe = probeLadderIii(fladderConfigured)
  let mnemonicPath = opts.mnemonicPath || findSidecarMnemonic(ladPath) || ''
  let exportNote = ''
  let exportError = ''

  if (!mnemonicPath && opts.tryExportMnemonic !== false && probe.found) {
    const exp = exportMnemonicViaLadderIiiSync(ladPath, {
      fladderPath: fladderConfigured || probe.fladderPath,
      outPath: path.join(
        path.dirname(path.resolve(ladPath)),
        `${path.basename(ladPath, path.extname(ladPath))}_mnemonic.txt`,
      ),
    })
    if (exp.ok) {
      mnemonicPath = exp.mnemonicPath
      exportNote = `已通过 LADDER-III CLI 导出：${mnemonicPath}`
    } else {
      exportError = exp.error || '导出失败'
    }
  }

  const mnemonic = mnemonicPath ? parseMnemonic(mnemonicPath, { sourceLabel: mnemonicPath }) : null
  return {
    mnemonicPath: mnemonicPath || '',
    mnemonic: mnemonic?.ok ? mnemonic : null,
    probe,
    exportNote,
    exportError,
    parseError: mnemonicPath && mnemonic && !mnemonic.ok ? mnemonic.error : '',
  }
}

/**
 * 基于真实符号表生成分析报告（不依赖模型临场发挥）
 * @param {string} absPath
 * @param {{ fladderPath?: string, tryExportMnemonic?: boolean, mnemonicPath?: string }} [opts]
 */
export function buildLadAnalysisReport(absPath, opts = {}) {
  const lad = readLadProject(absPath)
  const mnemonicInfo = resolveMnemonicForReport(absPath, opts)
  const symbols = lad.symbols || []
  const map = symMap(symbols)
  const byType = {}
  for (const s of symbols) {
    const t = s.addr[0]
    ;(byType[t] ||= []).push(s)
  }
  const levels = lad.ladderLevels || []
  const mapTxt = lad.mapTxt || ''
  const option = lad.option || ''
  const netZero =
    /Netcomment\s+-+H\s+-+H\s+000000H/i.test(mapTxt) || /Netcomment[\s\S]{0,40}0\.0KB/i.test(mapTxt)
  const profile = detectMachineProfile(lad.title, symbols)
  const now = new Date().toISOString().slice(0, 10)
  const title = (lad.title || '').replace(/\s+/g, ' ').trim()
  const typos = symbols.filter((s) => COMMENT_TYPO_RE.test(s.comment))
  const tinyBlocks = levels.filter((m) => /P\d+\.#LA/i.test(m.rel) && m.size > 0 && m.size < 64)
  const alarmX = symbols.filter(
    (s) =>
      s.addr.startsWith('X') &&
      /ALARM|ERR|OVERLOAD|LIMIT|ESTOP|E-STOP|EMERG|FAULT|PRESS|DOOR|COVER|SAFE|SWITCH/i.test(s.comment),
  )

  const pairsPending = []
  // 通用：按注释发现对立对（不写死某机型地址）；禁止再用「X3.0/1/2 一定是 MODE」这类臆测
  const discovered = discoverInterlockPairCandidates(symbols)
  // 保留少数「注释+地址」强特征的历史磨床对，但必须注释吻合
  const star = findSym(map, 'Y0000.6')
  const delta = findSym(map, 'Y0000.7')
  if (star && delta && /STAR/i.test(star.comment) && /DELTA/i.test(delta.comment)) {
    discovered.push({
      key: `${star.addr}|${delta.addr}`,
      kind: '星三角互锁',
      a: star,
      b: delta,
      note: '同属 WH1 电机接触器，须在 LADDER-III 确认互锁。',
    })
  }
  const cw = findSym(map, 'Y0005.1')
  const ccw = findSym(map, 'Y0005.2')
  if (cw && ccw && /CW/i.test(cw.comment) && /CCW/i.test(ccw.comment)) {
    discovered.push({
      key: `${cw.addr}|${ccw.addr}`,
      kind: '正反转互锁',
      a: cw,
      b: ccw,
      note: '注释为 WH.CW/CCW，须确认不能同时接通。',
    })
  }
  const seenPair = new Set()
  for (const d of discovered) {
    const k = `${d.kind}|${[d.a.addr, d.b.addr].sort().join('|')}`
    if (seenPair.has(k)) continue
    seenPair.add(k)
    pairsPending.push(d)
  }

  const mnemonic = mnemonicInfo.mnemonic
  const enrichedPairs = enrichPairsWithMnemonic(pairsPending, mnemonic)
  pairsPending.length = 0
  pairsPending.push(...enrichedPairs)

  const safety = analyzeSafetyChains(symbols, mnemonic)

  const stdG = []
  for (const [addr, re, hint] of STD_G_HINTS) {
    const s = findSym(map, addr)
    if (s && re.test(s.comment)) stdG.push({ ...s, hint })
  }

  const resetA = findSym(map, 'X0002.7')
  const resetB = findSym(map, 'X0008.0')

  const grindGroups = profile.grind
    ? {
        safety: ensureAddrs(
          map,
          listByPrefix(symbols, /E-?STOP|ESTOP|OVERLOAD|LIMIT|AREA|PRESS|COVER|SAFE|ALARM RESET|BYPASS|BYP/i, 40),
          ['X0008.4', 'Y0000.0', 'G0008.4', 'R0706.0', 'A0000.0', 'A0001.2'],
        ),
        wheel: ensureAddrs(
          map,
          listByPrefix(symbols, /WHEEL|WH\s*[12]|GRIND|DRESS|BARREL|BARRIER|ENGAGE|INT\.WH|EXT\.WH|WH\.CW|WH\.CCW/i, 45),
          [
            'X0001.2',
            'X0001.3',
            'X0001.4',
            'Y0000.6',
            'Y0000.7',
            'Y0005.1',
            'Y0005.2',
            'Y0004.4',
            'Y0004.5',
            'X0011.3',
            'X0011.5',
          ],
        ),
        media: listByPrefix(symbols, /COOL|HYD|AIR|LUB|PNUM/i, 30),
        ops: ensureAddrs(
          map,
          listByPrefix(symbols, /MODE|OVERRIDE|MPG|CYCLE|SINGLE|M01|SKIP|READY|REF|FOOT/i, 40),
          ['X0003.0', 'X0003.3', 'X0009.6', 'X0009.7', 'G0007.2'],
        ),
      }
    : null

  // 仅当证据成立才写入问题；假问题靠条件挡住，不在报告里列黑名单
  const issues = []
  const pushIssue = (severity, title, evidence, advice) => {
    issues.push({ severity, title, evidence, advice })
  }

  if (!symbols.length) {
    pushIssue('高', '未能解析出有效符号注释', 'XSYMBOL 解析结果为 0 条', '检查 LAD 是否完整、是否为 LADDER-III ZIP')
  } else if (symbols.length < 20) {
    pushIssue('中', '有效符号异常偏少', `仅解析到 ${symbols.length} 条地址→注释`, '核对导出是否缺 XSYMBOL，或符号表是否被清空')
  }

  const weakComments = symbols.filter((s) => {
    const c = String(s.comment || '').trim()
    return !c || c.length < 2 || /^[\d.\s]+$/.test(c) || /^(SYM|SYMBOL|NO\s*NAME|NULL|N\/A|-)$/i.test(c)
  })
  if (symbols.length >= 30 && weakComments.length / symbols.length >= 0.5) {
    pushIssue(
      '中',
      '大量符号缺少有效注释',
      `${weakComments.length}/${symbols.length} 条注释为空或无意义`,
      '在 LADDER-III 补全关键 I/O 注释',
    )
  }

  if (
    looksLikeBrokenLadSymbolTable(
      symbols
        .slice(0, 80)
        .map((s) => `| ${s.addr} | ${s.comment} |`)
        .join('\n'),
    )
  ) {
    pushIssue('高', '符号地址格式异常（疑似被错误拆分）', '出现大量 X0 + 000.0 类碎片形态', '重新解包或从 LADDER-III 再导出')
  }

  const mapDateBroken =
    /Log Date[^\n]*(Äê|ÔÂ|ÈÕ|��)/.test(mapTxt) ||
    (/Log Date/i.test(mapTxt) && !/Log Date[^\n]*\d{4}/.test(mapTxt) && !/年|月|日/.test(mapTxt))
  if (mapDateBroken) {
    pushIssue('低', 'MAP 日志日期仍无法正确解码', 'Log Date 行含乱码或缺少可读日期', '多为导出编码问题，一般不等于工程损坏')
  }

  if (netZero) {
    pushIssue('中', '无网络段注释（Netcomment=0）', 'MAP.TXT Netcomment 长度为 0', '在 LADDER-III 为关键梯级补 Netcomment')
  }
  for (const m of tinyBlocks) {
    pushIssue('中', '程序块异常小', `\`${m.rel}\` 仅 ${m.size} 字节`, '确认是否空壳/占位/导出残缺')
  }
  if (typos.length) {
    pushIssue('低', `符号注释英文拼写脏数据（${typos.length} 处）`, '如 SWTICH/BOTTON/CYCEL 等', '不影响运行；可择机改注释')
  }
  if (resetA && resetB && /ALARM\s*RESET/i.test(resetA.comment) && /ALARM\s*RESET/i.test(resetB.comment)) {
    pushIssue(
      '低',
      '两路报警复位输入（用途待分清）',
      `${resetA.addr}=${resetA.comment}；${resetB.addr}=${resetB.comment}`,
      '对照电气图分清用途，勿直接当逻辑错误',
    )
  }

  // WH2「STAT」对照 WH1「STAR」——很像拼写/缩写不一致
  const wh2s = findSym(map, 'Y0004.4')
  if (wh2s && /MOTOR\s+STAT\b/i.test(wh2s.comment) && star && /STAR/i.test(star.comment)) {
    pushIssue(
      '低',
      'WH2 星点注释写作 STAT（WH1 为 STAR）',
      `${wh2s.addr}=${wh2s.comment}；对照 ${star.addr}=${star.comment}`,
      '核对是否笔误；梯形图仍按实际线圈功能理解',
    )
  }

  // 同一工程里 GRIDNG / GRIND 并存
  const gridng = symbols.filter((s) => /GRIDNG/i.test(s.comment))
  const grindOk = symbols.filter((s) => /\bGRIND\b/i.test(s.comment))
  if (gridng.length && grindOk.length) {
    pushIssue(
      '低',
      '磨削相关注释拼写不一致（GRIDNG vs GRIND）',
      `${gridng
        .slice(0, 3)
        .map((s) => `${s.addr}=${s.comment}`)
        .join('；')} ↔ ${grindOk
        .slice(0, 3)
        .map((s) => `${s.addr}=${s.comment}`)
        .join('；')}`,
      '统一注释便于检索；不影响运行',
    )
  }

  // 注释疑似截断
  const truncatedCmt = symbols.filter((s) => /CONTR$|CONTRO$|CONTRL$|CONT$/i.test(String(s.comment || '').trim()))
  if (truncatedCmt.length >= 2) {
    pushIssue(
      '低',
      `多处注释疑似被截断（${truncatedCmt.length} 处）`,
      truncatedCmt
        .slice(0, 5)
        .map((s) => `${s.addr}=${s.comment}`)
        .join('；'),
      '在 LADDER-III 看完整注释列，必要时加长符号注释',
    )
  }

  // 旁路类符号成簇
  const bypassSyms = safety.bypasses?.length
    ? safety.bypasses
    : symbols.filter((s) => /BYPASS|\bBYP\b|BAPSS|\bBY\s*$/i.test(s.comment))
  if (bypassSyms.length >= 2) {
    pushIssue(
      '中',
      `存在多处旁路/Bypass 类符号（${bypassSyms.length} 处）`,
      bypassSyms
        .slice(0, 6)
        .map((s) => `${s.addr}=${s.comment}`)
        .join('；'),
      '现场查保护「无效」时必须先弄清旁路置位条件，勿当成普通缺陷',
    )
  }

  // 证据层：急停链路 / 旁路接入安全线圈等（有助记符才升「高/中」）
  const confirmedSafety = []
  const pendingSafety = []
  for (const f of safety.findings || []) {
    if (f.tier === 'confirmed') {
      confirmedSafety.push(f)
      const sev = /旁路/.test(f.title) ? '中' : '中'
      pushIssue(sev, f.title, f.evidence, f.advice)
    } else if (f.tier === 'pending') {
      pendingSafety.push(f)
    }
  }

  // 互锁对：同网双线圈升问题；已见互锁只记信息
  for (const p0 of pairsPending) {
    if (p0.mnemonicStatus === 'risk_same_net') {
      pushIssue(
        '高',
        `${p0.kind}`,
        `${p0.a.addr}/${p0.b.addr}：${p0.note}`,
        '同网同时驱动对立输出，优先在 LADDER-III 核对',
      )
    }
  }

  // COVER L. 歧义
  const coverL = findSym(map, 'Y0002.0')
  if (coverL && /^COVER\s*L\.?$/i.test(coverL.comment.trim())) {
    pushIssue(
      '低',
      'Y0002.0 COVER L. 命名歧义',
      `${coverL.addr}=${coverL.comment}（常见为指示灯 Lamp，易被误读成 Left/Lock/开门阀）`,
      '对照电气图确认是灯还是执行机构',
    )
  }

  // 符号很多但梯子偏小 → 可能大量未引用符号
  const ladderBytes = levels.reduce((a, m) => a + (m.size || 0), 0)
  if (symbols.length >= 800 && ladderBytes > 0 && ladderBytes < 12000) {
    pushIssue(
      '低',
      '符号数量相对梯形图体积偏大',
      `${symbols.length} 条符号 / 梯子合计约 ${ladderBytes} 字节`,
      '可能存在大量未引用符号；可在 LADDER-III 查 Unused，并考虑 omit_unusedsym',
    )
  }

  // Message 区过小
  const msgKb = mapTxt.match(/Message[\s\S]{0,80}?([\d.]+)\s*KB/i)
  if (msgKb && Number(msgKb[1]) > 0 && Number(msgKb[1]) < 1.0) {
    pushIssue(
      '低',
      'PMC Message 区很小',
      `MAP 显示 Message 约 ${msgKb[1]}KB`,
      '操作/报警消息可能很少，排故别指望丰富报文提示',
    )
  }

  // 冷却相关输入输出是否成套（磨床）
  if (profile.grind) {
    const coolX = symbols.filter((s) => s.addr.startsWith('X') && /COOL/i.test(s.comment))
    const coolY = symbols.filter((s) => s.addr.startsWith('Y') && /COOL/i.test(s.comment))
    if (coolY.length >= 2 && coolX.length === 0) {
      pushIssue(
        '低',
        '有冷却类 Y 输出但未见冷却类 X 反馈注释',
        `Y 侧 ${coolY.length} 条；X 侧冷却注释 0 条（可能用压力/综合报警代替）`,
        '确认冷却故障是否走 ERR.COOL / 压力开关等其它点',
      )
    }
  }

  // WH1/WH2 命名风格不统一
  const whSpace = symbols.filter((s) => /WH\s+[12]/i.test(s.comment)).length
  const whTight = symbols.filter((s) => /WH[12]/i.test(s.comment)).length
  if (whSpace >= 2 && whTight >= 2) {
    pushIssue(
      '低',
      '砂轮相关注释命名风格不统一（WH1 vs WH 1）',
      `紧凑写法约 ${whTight} 处，空格写法约 ${whSpace} 处`,
      '统一命名便于检索；不影响运行',
    )
  }

  // OPTION：允许网络注释但实际为 0
  if (netZero && /netcmt\s*=\s*[1-9]/i.test(option)) {
    pushIssue(
      '中',
      'OPTION 已开网络注释但工程未写入',
      `OPTION 含 netcmt≠0，且 MAP Netcomment=0`,
      '不是选项关了，而是梯子里没写 Netcomment',
    )
  }
  if (/omit_unusedsym\s*=\s*0/i.test(option) && symbols.length >= 800 && ladderBytes < 12000) {
    pushIssue(
      '低',
      '未开启省略未使用符号（omit_unusedsym=0）',
      'OPTION omit_unusedsym=0，且符号相对梯子偏多',
      '确认无调试需要后可考虑开启，减小符号区',
    )
  }

  // 注释里多余空格（如 WH2  MOTOR）
  const multiSpace = symbols.filter((s) => /\s{2,}/.test(s.comment))
  if (multiSpace.length >= 3) {
    pushIssue(
      '低',
      `多处注释含连续空格（${multiSpace.length} 处）`,
      multiSpace
        .slice(0, 4)
        .map((s) => `${s.addr}=${s.comment}`)
        .join('；'),
      '导出/录入格式问题，建议整理',
    )
  }

  // PRESS.SWITCH 与 PRESS SWITCH 标点不统一
  const pressDot = symbols.filter((s) => /PRESS\./i.test(s.comment)).length
  const pressSp = symbols.filter((s) => /PRESS\s+SWITCH/i.test(s.comment)).length
  if (pressDot && pressSp) {
    pushIssue(
      '低',
      '压力开关注释标点不统一',
      `含 PRESS. 约 ${pressDot} 处；含 PRESS SWITCH 约 ${pressSp} 处`,
      '统一写法便于检索',
    )
  }

  // 尾座相关拼写簇
  const tailBad = symbols.filter((s) => /TAISTOCK|TAIKSTCOK|TAIK\b/i.test(s.comment))
  if (tailBad.length >= 2) {
    pushIssue(
      '低',
      `尾座相关注释拼写混乱（${tailBad.length} 处）`,
      tailBad.map((s) => `${s.addr}=${s.comment}`).join('；'),
      '统一为 TAILSTOCK 等标准拼写',
    )
  }

  // X 地址整字节空段（仅提示映射空洞，不升高危）
  const xBytes = new Set(
    (byType.X || [])
      .map((s) => {
        const m = String(s.addr).match(/^X0*(\d+)\./i)
        return m ? Number(m[1]) : null
      })
      .filter((n) => n != null),
  )
  if (xBytes.size >= 4) {
    const xmin = Math.min(...xBytes)
    const xmax = Math.max(...xBytes)
    const holes = []
    for (let b = xmin; b <= xmax; b++) if (!xBytes.has(b)) holes.push(b)
    if (holes.length >= 2) {
      pushIssue(
        '低',
        `X 输入存在整字节空段（${holes.length} 段）`,
        `在 X${String(xmin).padStart(4, '0')}~X${String(xmax).padStart(4, '0')} 中空缺字节：${holes
          .slice(0, 8)
          .map((b) => `X${String(b).padStart(4, '0')}`)
          .join('、')}`,
        '多为接线映射预留，不一定是缺陷；核对 I/O 表即可',
      )
    }
  }

  // 按钮 PB 与指示灯 L. 难匹配（按归一化名）
  const normIo = (c) =>
    String(c || '')
      .toUpperCase()
      .replace(/BOTTON|BUTTON|\bPB\b|\bL\.?$|LAMP|LIGHT|INDICATOR/gi, '')
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 14)
  const pbs = (byType.X || []).filter((s) => /\bPB\b|BOTTON|BUTTON/i.test(s.comment))
  const lamps = (byType.Y || []).filter((s) => /\bL\.?\s*$|LAMP|LIGHT/i.test(s.comment))
  const lampKeys = new Set(lamps.map((s) => normIo(s.comment)).filter((k) => k.length >= 4))
  const orphanPbs = pbs.filter((s) => {
    const k = normIo(s.comment)
    if (k.length < 4) return false
    // 允许模糊：CYCLE vs CYCEL
    if (lampKeys.has(k)) return false
    for (const lk of lampKeys) {
      if (lk.startsWith(k.slice(0, 5)) || k.startsWith(lk.slice(0, 5))) return false
    }
    return true
  })
  if (pbs.length >= 4 && orphanPbs.length >= 2) {
    pushIssue(
      '低',
      `部分按钮注释难以对应指示灯（约 ${orphanPbs.length}/${pbs.length}）`,
      orphanPbs
        .slice(0, 5)
        .map((s) => `${s.addr}=${s.comment}`)
        .join('；'),
      '可能灯在其它地址或命名差太大；对照面板与电气图',
    )
  }

  // 磨床：砂轮运行输出与星三角/主接触器并存
  const wh1Run = findSym(map, 'Y0004.1')
  if (profile.grind && wh1Run && /WH1.*MOTOR/i.test(wh1Run.comment) && star && delta) {
    pushIssue(
      '低',
      'WH1 同时存在主电机输出与星三角输出',
      `${wh1Run.addr}=${wh1Run.comment}；另有 ${star.addr}/${delta.addr}`,
      '确认星三角切换与主接触器关系，避免重复理解成两套独立启停',
    )
  }

  // 压力开关成套但缺少明确「压力 OK」类 G/Y（仅提示）
  const pressX = symbols.filter((s) => s.addr.startsWith('X') && /PRESS/i.test(s.comment))
  const pressOk = symbols.filter((s) => /PRESS.*OK|OK.*PRESS|PRESSURE\s*OK/i.test(s.comment))
  if (pressX.length >= 3 && pressOk.length === 0) {
    pushIssue(
      '低',
      '有多路压力开关输入，但未见 PRESS OK 类注释',
      pressX.map((s) => `${s.addr}=${s.comment}`).join('；'),
      '压力条件可能编在内部 R 或综合报警；排故时别只找 OK 位',
    )
  }

  // 高速级相对主程序极小（磨床安全扫描提示，不升致命）
  const lv1 = levels.find((m) => /LEVEL1/i.test(m.rel))
  const mainSz = Math.max(...levels.filter((m) => /P\d+/i.test(m.rel)).map((m) => m.size), 0)
  if (profile.grind && lv1 && lv1.size > 0 && lv1.size < 100 && mainSz > 2000) {
    pushIssue(
      '低',
      'LEVEL1 高速级体积很小',
      `${lv1.rel}=${lv1.size}B，而最大 P 程序约 ${mainSz}B`,
      '高速级小很常见；仍建议在 LADDER-III 确认急停/超程等高优逻辑所在级',
    )
  }

  // G 符号异常多（大量系统/扩展位）
  if ((byType.G || []).length >= 300 && (byType.Y || []).length < 80) {
    pushIssue(
      '低',
      'G（PMC→CNC）符号数量远大于机侧 Y',
      `G=${(byType.G || []).length}，Y=${(byType.Y || []).length}`,
      '多数为接口/扩展位属正常；分析时优先 X/Y 与关键 G（如 *ESP、ST）',
    )
  }

  // 双空格已覆盖；CYCLE START 按钮与 CYCEL 灯的配对提示
  const cycPb = (byType.X || []).find((s) => /CYCLE\s*START/i.test(s.comment))
  const cycLamp = (byType.Y || []).find((s) => /CYCEL\s*START|CYCLE\s*START\s*L/i.test(s.comment))
  if (cycPb && cycLamp && /CYCEL/i.test(cycLamp.comment)) {
    pushIssue(
      '低',
      '循环启动按钮与指示灯注释拼写不一致',
      `${cycPb.addr}=${cycPb.comment} ↔ ${cycLamp.addr}=${cycLamp.comment}`,
      '灯侧 CYCEL 应为 CYCLE；不影响运行',
    )
  }

  // 报警器 A 地址与 X 报警输入的粗对应
  const alarmA = (byType.A || []).filter((s) => /ALARM|ERR|OVERLOAD|COVER|LIMIT/i.test(s.comment))
  if (alarmA.length >= 3 && alarmX.length >= 5) {
    pushIssue(
      '低',
      `存在多路 A 类报警器符号（${alarmA.length} 处）`,
      alarmA
        .slice(0, 5)
        .map((s) => `${s.addr}=${s.comment}`)
        .join('；'),
      '对照 PMC 报警号与梯形图 CALL；排故时 A 与 X 可能成对出现',
    )
  }

  // 保持继电器 K 含旁路
  const kBypass = (byType.K || []).filter((s) => /BY|BYP|BYPASS|BAPSS/i.test(s.comment))
  if (kBypass.length >= 1 && bypassSyms.length >= 2) {
    pushIssue(
      '中',
      '保持继电器 K 中存在旁路相关符号',
      kBypass.map((s) => `${s.addr}=${s.comment}`).join('；'),
      'K 旁路可能掉电保持，查保护旁路时优先看这些点',
    )
  }

  // Soft switch 拼写
  const soft = symbols.filter((s) => /SOFTSWTICH|SOFT\s*SWITCH/i.test(s.comment))
  if (soft.some((s) => /SOFTSWTICH/i.test(s.comment))) {
    pushIssue(
      '低',
      '软开关注释拼写错误（SOFTSWTICH）',
      soft.map((s) => `${s.addr}=${s.comment}`).join('；'),
      '应为 SOFTSWITCH',
    )
  }

  const hasEstopX = symbols.some((s) => s.addr.startsWith('X') && /E-?STOP|ESTOP|EMG|EMERGENCY/i.test(s.comment))
  const hasEspG = symbols.some((s) => /^G/i.test(s.addr) && /(\*ESP|NC\*ESP|E-?STOP)/i.test(s.comment))
  if (symbols.length >= 50 && !hasEstopX) {
    pushIssue('中', '符号表中未见机侧急停类 X 注释', '未匹配到含 E-STOP/ESTOP 等的 X 符号', '用电气图确认急停硬线')
  }
  if (symbols.length >= 50 && !hasEspG) {
    pushIssue('中', '符号表中未见给 CNC 的 *ESP/急停类 G 注释', '未匹配到 G 侧 *ESP / NC*ESP 等', '核对 PMC↔CNC 接口表')
  }

  // 去重同名问题标题，并按严重度排序
  const sevRank = { 高: 0, 中: 1, 低: 2 }
  const seenTitle = new Set()
  const sortedIssues = []
  for (const it of issues.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9))) {
    if (seenTitle.has(it.title)) continue
    seenTitle.add(it.title)
    sortedIssues.push(it)
  }
  issues.length = 0
  issues.push(...sortedIssues)

  const p = []
  const line = (s = '') => p.push(s)
  const esc = (s) => String(s || '').replace(/\|/g, '/')

  line(`# FANUC LADDER 完整问题分析报告`)
  line('')
  line(
    mnemonic
      ? `> **证据分级报告**：符号表事实 + 助记符网路核验。**已证实**＝助记符/结构可核对；**待人工**＝仅有符号线索，须电气图或 LADDER-III 确认。禁止把待证项写成致命缺陷。`
      : `> **证据分级报告**：当前仅符号表/MAP（无助记符）。配置 LADDER-III 或将 \`*_mnemonic.txt\` 与 \`.LAD\` 同目录后，可自动核验急停链路与互锁。`,
  )
  line('')
  line(`| 项目 | 内容 |`)
  line(`|------|------|`)
  line(`| 源文件 | \`${lad.path}\` |`)
  line(`| 大小 | ${lad.size} 字节 |`)
  line(`| 报告日期 | ${now} |`)
  line(`| 机型画像 | ${profile.label}${profile.grind ? '（磨床/砂轮类）' : ''} |`)
  line(`| TITLE | ${title || '（无）'} |`)
  line(`| 有效符号 | ${symbols.length} 条 |`)
  line(`| 已证实问题 | ${issues.length} 条 |`)
  line(`| 安全链路已证实 | ${confirmedSafety.length} 条 |`)
  line(`| 待人工核对 | ${pendingSafety.length + pairsPending.filter((x) => x.tier !== 'confirmed').length} 条 |`)
  if (mnemonic) {
    line(
      `| 助记符 | 已载入（${mnemonic.instructionCount} 条指令 / ${mnemonic.netCount} 网）${mnemonicInfo.mnemonicPath ? `；\`${mnemonicInfo.mnemonicPath}\`` : ''} |`,
    )
  } else {
    const why =
      mnemonicInfo.exportError ||
      mnemonicInfo.parseError ||
      (mnemonicInfo.probe.found ? '已找到 fladder 但未导出成功' : '未找到助记符 / fladder.exe')
    line(`| 助记符 | 未载入（${why}） |`)
  }
  if (mnemonicInfo.exportNote) line(`| 导出 | ${mnemonicInfo.exportNote} |`)
  line('')
  line(`---`)
  line('')
  line(`## 一、已证实问题（有证据）`)
  line('')
  line(`| # | 严重度 | 问题 | 证据 | 建议 |`)
  line(`|---|--------|------|------|------|`)
  if (!issues.length) {
    line(`| — | — | 未发现可仅凭当前材料证实的硬缺陷 | — | 补充报警号；有助记符时再生成报告 |`)
  } else {
    issues.forEach((it, i) => {
      line(`| ${i + 1} | ${it.severity} | ${it.title} | ${esc(it.evidence)} | ${it.advice} |`)
    })
  }
  line('')
  line(`---`)
  line('')
  line(`## 二、安全 / 急停链路（助记符追溯）`)
  line('')
  if ((safety.findings || []).length) {
    line(`| 级别 | 结论 | 证据 | 建议 |`)
    line(`|------|------|------|------|`)
    for (const f of safety.findings) {
      const lv = f.tier === 'confirmed' ? '已证实' : f.tier === 'pending' ? '待人工' : '线索'
      line(`| ${lv} | ${esc(f.title)} | ${esc(f.evidence)} | ${esc(f.advice)} |`)
    }
  } else {
    line(`暂无安全链路条目（符号命名可能非标准）。`)
  }
  line('')
  line(
    `> 说明：PMC 侧「已引用急停输入」≠ 硬线已串联双通道；双通道串并联以电气图为准。`,
  )
  line('')
  line(`---`)
  line('')
  line(`## 三、互锁成对核验（按注释发现，非写死地址）`)
  line('')
  if (pairsPending.length) {
    line(`| 级别 | 类型 | 地址 A | 注释 A | 地址 B | 注释 B | 说明 |`)
    line(`|------|------|--------|--------|--------|--------|------|`)
    for (const p0 of pairsPending) {
      const lv = p0.tier === 'confirmed' ? '已证实' : '待人工'
      line(
        `| ${lv} | ${p0.kind} | ${p0.a.addr} | ${esc(p0.a.comment)} | ${p0.b.addr} | ${esc(p0.b.comment)} | ${esc(p0.note)} |`,
      )
    }
  } else {
    line(`未自动匹配到成对 STAR/DELTA、CW/CCW、MODE、DRESS/GRIND 等注释对。`)
  }
  if (!mnemonic) {
    line('')
    line(
      `> 启用助记符核验：① 设置 \`fladder.exe\`；或 ② 导出梯子文本与 \`.LAD\` 同目录（\`原名_mnemonic.txt\`）。`,
    )
  }
  line('')
  line(`---`)
  line('')
  line(`## 四、机型相关 I/O（原文）`)
  line('')
  if (profile.grind) {
    line(`**${profile.brand}${profile.series ? ' ' + profile.series : ''}** 磨床/砂轮类工程摘录。`)
    line('')
    line(`### 安全 / 限位 / 压力 / 门罩`)
    line('')
    line(`| 地址 | 注释（原文） |`)
    line(`|------|--------------|`)
    for (const s of (grindGroups.safety.length ? grindGroups.safety : alarmX).slice(0, 35)) {
      line(`| ${s.addr} | ${esc(s.comment)} |`)
    }
    line('')
    line(`### 砂轮头 / 修整 / 工件`)
    line('')
    line(`| 地址 | 注释（原文） |`)
    line(`|------|--------------|`)
    for (const s of grindGroups.wheel.slice(0, 35)) line(`| ${s.addr} | ${esc(s.comment)} |`)
    line('')
    line(`### 冷却 / 液压 / 气 / 润滑`)
    line('')
    line(`| 地址 | 注释（原文） |`)
    line(`|------|--------------|`)
    for (const s of grindGroups.media.slice(0, 25)) line(`| ${s.addr} | ${esc(s.comment)} |`)
    line('')
    line(`### 操作 / 模式 / 倍率 / 手轮`)
    line('')
    line(`| 地址 | 注释（原文） |`)
    line(`|------|--------------|`)
    for (const s of grindGroups.ops.slice(0, 35)) line(`| ${s.addr} | ${esc(s.comment)} |`)
  } else {
    line(`| 地址 | 注释 |`)
    line(`|------|------|`)
    for (const s of alarmX.slice(0, 40)) line(`| ${s.addr} | ${esc(s.comment)} |`)
  }
  if (typos.length) {
    line('')
    line(`### 拼写脏数据摘录`)
    line('')
    line(`| 地址 | 注释 |`)
    line(`|------|------|`)
    for (const s of typos.slice(0, 25)) line(`| ${s.addr} | ${esc(s.comment)} |`)
  }
  line('')
  line(`---`)
  line('')
  line(`## 五、标准接口与程序结构`)
  line('')
  if (stdG.length) {
    line(`| 地址 | 注释（原文） | 说明 |`)
    line(`|------|--------------|------|`)
    for (const sy of stdG) line(`| ${sy.addr} | ${esc(sy.comment)} | ${sy.hint} |`)
    line('')
  }
  line('```')
  line(mapTxt || '（无 MAP.TXT）')
  line('```')
  line('')
  line(`| 块 | 大小 | 备注 |`)
  line(`|----|------|------|`)
  for (const m of levels) {
    let note = ''
    if (/LEVEL/i.test(m.rel)) note = '高速级'
    if (/P\d+\.#LA/i.test(m.rel) && m.size < 64) note = '异常小'
    if (/P1\.#LA|P4\.#LA/i.test(m.rel) && m.size >= 1000) note = '主要逻辑区'
    line(`| \`${m.rel}\` | ${m.size} B | ${note} |`)
  }
  line('')
  line(`---`)
  line('')
  line(`## 六、符号统计与 X/Y 全表`)
  line('')
  line(`| 类型 | 数量 |`)
  line(`|------|------|`)
  for (const t of Object.keys(byType).sort()) line(`| ${t} | ${byType[t].length} |`)
  line(`| 合计 | ${symbols.length} |`)
  line('')
  line(`### 全部 X`)
  line('')
  line(`| 地址 | 注释 |`)
  line(`|------|------|`)
  for (const sy of byType.X || []) line(`| ${sy.addr} | ${esc(sy.comment)} |`)
  line('')
  line(`### 全部 Y`)
  line('')
  line(`| 地址 | 注释 |`)
  line(`|------|------|`)
  for (const sy of byType.Y || []) line(`| ${sy.addr} | ${esc(sy.comment)} |`)
  line('')
  line(`---`)
  line('')
  line(`## 七、结论与建议`)
  line('')
  line(
    `- **已证实** ${issues.length} 条（见第一节）；其中安全链路核验 ${confirmedSafety.length} 条。`,
  )
  line(
    `- **待人工** ${pendingSafety.length} 条安全项 + ${pairsPending.filter((x) => x.tier !== 'confirmed').length} 条互锁对：不得当作已确认致命缺陷。`,
  )
  if (!mnemonic) {
    line(
      `- 建议：导出助记符后重新「生成问题报告」，以补全急停间接链路与旁路接入证据。`,
    )
  } else {
    line(`- 对照本节助记符样例与电气图；「未见互锁」优先在 LADDER-III 图形界面再确认。`)
  }
  line(`- 修改 \`.LAD\` 必须在 LADDER-III 中进行并备份后下载。`)
  line('')
  line(`---`)
  line('')
  line(`*报告由 SAMA 程序化解包生成（非模型临场发挥）；不绑定特定机型地址表。*`)

  const markdown = p.join('\n')
  return {
    ladPath: lad.path,
    markdown,
    symbolCount: symbols.length,
    bytes: Buffer.byteLength(markdown, 'utf8'),
    profile,
    issueCount: issues.length,
    confirmedSafetyCount: confirmedSafety.length,
    pendingCount: pendingSafety.length,
    mnemonicLoaded: Boolean(mnemonic),
    mnemonicPath: mnemonicInfo.mnemonicPath || '',
  }
}

/** 粗检报告是否像「幻觉模板」（用于丢弃模型假报告） */
export function looksLikeHallucinatedLadReport(text, symbols = []) {
  const s = String(text || '')
  if (!s.trim()) return false
  const map = symMap(symbols)
  let bad = 0
  // 无符号表时：典型「通用机床模板」组合拳
  if (
    /Y0000\.6[^\n]{0,60}SPINDLE\s+FWD/i.test(s) &&
    /G0000\.3[^\n]{0,40}E-?STOP/i.test(s)
  ) {
    bad += 2
  }
  if (/Y0002\.0[^\n]{0,40}COVER\s+OPEN/i.test(s) && /Y0002\.1[^\n]{0,40}COVER\s+CLOSE/i.test(s)) {
    bad += 1
  }
  if (/致命[^\n]{0,30}(急停|伺服使能)/.test(s) && /G0000\.3/.test(s)) bad += 2

  const checks = [
    [
      /Y0000\.6[^\n]{0,40}SPINDLE\s+FWD/i,
      () => {
        const c = map.get('Y0000.6') || ''
        return c && !/SPINDLE\s+FWD/i.test(c)
      },
    ],
    [
      /G0000\.3[^\n]{0,40}E-?STOP/i,
      () => {
        const c = map.get('G0000.3') || ''
        return c && !/E-?STOP|ESP/i.test(c)
      },
    ],
    [
      /Y0001\.[012][^\n]{0,40}SERVO\s+ON/i,
      () => {
        const c = map.get('Y0001.0') || ''
        return map.size > 0 && !/SERVO/i.test(c)
      },
    ],
    [
      /Y0002\.0[^\n]{0,40}COVER\s+OPEN/i,
      () => {
        const c = map.get('Y0002.0') || ''
        return c && !/OPEN/i.test(c)
      },
    ],
  ]
  for (const [re, pred] of checks) {
    if (re.test(s) && pred()) bad += 1
  }
  return bad >= 2
}

export function defaultLadReportPath(ladAbs) {
  return `${path.resolve(ladAbs)}_问题分析报告.md`
}

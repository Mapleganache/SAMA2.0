/**
 * 基于现有 0i PMC 工程外壳，生成带演示梯形的新 .LAD（Fladder MnemonicToSrc）
 * 优先复制仓库内置 empty_0i_shell.LAD（CALLU+空 SP/SPE 骨架），再在末级 SPE 前写入设计网。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  exportMnemonicViaLadderIii,
  importMnemonicViaLadderIii,
  resolveFladderPath,
  resolveUsableLadPath,
  ensureWritableFile,
} from './fanucLadderIii.mjs'
import {
  buildStuderRewriteRungs,
  extractSymbolBits,
} from './fanucLadRewriteRungs.mjs'
import {
  BUILTIN_EMPTY_SHELL,
  BUILTIN_FORMAT_STANDARD,
  builtinLadPath,
  getBuiltinLadDir,
  materializeBuiltinLad,
  readBuiltinManifest,
} from './ladBuiltin.mjs'

function desktopDir() {
  return path.join(os.homedir(), 'Desktop')
}

function bit(addr) {
  const m = String(addr).match(/^([A-Z]+)(\d+)\.(\d+)$/i)
  if (!m) return String(addr || '')
  return `${m[1].toUpperCase()}${String(Number(m[2])).padStart(4, '0')}.${m[3]}`
}

function bitShort(addr) {
  return bit(addr).replace(/^([A-Z]+)0+(\d)/i, '$1$2')
}

function padSym(label) {
  const left = `$1 '${label}'`
  const pad = Math.max(1, 40 - left.length)
  return `${left}${' '.repeat(pad)}'${label}'`
}

function emitRungs(rungs, startN) {
  const lines = []
  let n = startN
  for (const r of rungs) {
    const nn = String(n).padStart(5, '0')
    const cs = r.contacts || []
    cs.forEach((c, i) => {
      const op = (i === 0 ? c.op || 'RD' : c.op || 'AND').padEnd(10)
      const a = bitShort(c.addr).padEnd(8)
      const nm = String(c.name || '').padEnd(8).slice(0, 8)
      if (i === 0) lines.push(` N${nn}: ${op} ${a};(${nm})   "${c.name || ''}"`)
      else lines.push(`         ${op} ${a};(${nm})   "${c.name || ''}"`)
    })
    const coil = r.coil
    if (coil) {
      const op = (coil.op || 'WRT').padEnd(10)
      const a = bitShort(coil.addr).padEnd(8)
      const nm = String(coil.name || '').padEnd(8).slice(0, 8)
      if (!cs.length) lines.push(` N${nn}: ${op} ${a};(${nm})   "${coil.name || ''}"`)
      else lines.push(`         ${op} ${a};(${nm})   "${coil.name || ''}"`)
    }
    n += 1
  }
  return { lines: lines.join('\r\n'), next: n }
}

const R = (op, addr, name) => ({ op, addr, name })

/** 演示用复杂网表（磨床类互锁/时序） */
export function buildDemoRungs() {
  return [
    {
      contacts: [R('RD', 'X0008.4', 'ESP_MAIN'), R('AND', 'X0008.3', 'ESP_SUB'), R('AND.NOT', 'R0706.0', 'ESP_BYP')],
      coil: R('WRT', 'R0100.1', 'ESP_OK'),
    },
    {
      contacts: [R('RD', 'R0100.1', 'ESP_OK'), R('AND.NOT', 'X0008.5', 'MOT_OC')],
      coil: R('WRT', 'R0100.2', 'SAFE_OK'),
    },
    {
      contacts: [R('RD', 'X0003.3', 'LUB_POK'), R('AND', 'X0003.2', 'LUB_LVL')],
      coil: R('WRT', 'R0104.0', 'LUB_OK'),
    },
    {
      contacts: [R('RD', 'R0100.2', 'SAFE_OK'), R('AND', 'R0104.0', 'LUB_OK')],
      coil: R('WRT', 'R0100.0', 'MACH_RDY'),
    },
    { contacts: [R('RD', 'R0100.0', 'MACH_RDY')], coil: R('WRT', 'G0008.4', 'NC_ESP') },
    {
      contacts: [R('RD', 'R0100.0', 'MACH_RDY'), R('AND.NOT', 'R0106.0', 'ALM_LAT')],
      coil: R('WRT', 'G0008.5', 'NC_SP'),
    },
    {
      contacts: [R('RD', 'X0000.0', 'AUTO_KEY'), R('AND', 'R0100.0', 'MACH_RDY'), R('AND.NOT', 'R0101.1', 'MODE_JOG')],
      coil: R('WRT', 'R0101.0', 'MODE_AUTO'),
    },
    {
      contacts: [R('RD', 'X0001.0', 'JOG_KEY'), R('AND', 'R0100.0', 'MACH_RDY'), R('AND.NOT', 'R0101.0', 'MODE_AUTO')],
      coil: R('WRT', 'R0101.1', 'MODE_JOG'),
    },
    { contacts: [R('RD', 'R0101.0', 'MODE_AUTO')], coil: R('WRT', 'Y0000.0', 'AUTO_L') },
    { contacts: [R('RD', 'R0101.1', 'MODE_JOG')], coil: R('WRT', 'Y0001.0', 'JOG_L') },
    { contacts: [R('RD', 'X0003.6', 'DRESS_CYC')], coil: R('WRT', 'R0102.2', 'PROC_LOCK') },
    {
      contacts: [
        R('RD', 'X0000.1', 'GRIND_KEY'),
        R('AND', 'R0101.0', 'MODE_AUTO'),
        R('AND', 'X0004.0', 'WH_REACH'),
        R('AND', 'R0103.0', 'COOL_OK'),
        R('AND.NOT', 'R0102.2', 'PROC_LOCK'),
        R('AND.NOT', 'R0106.0', 'ALM_LAT'),
      ],
      coil: R('WRT', 'R0102.0', 'GRIND_EN'),
    },
    {
      contacts: [
        R('RD', 'X0003.6', 'DRESS_CYC'),
        R('AND', 'R0101.0', 'MODE_AUTO'),
        R('AND.NOT', 'R0102.0', 'GRIND_EN'),
        R('AND.NOT', 'R0106.0', 'ALM_LAT'),
      ],
      coil: R('WRT', 'R0102.1', 'DRESS_EN'),
    },
    { contacts: [R('RD', 'R0102.0', 'GRIND_EN')], coil: R('WRT', 'Y0000.1', 'GRIND_L') },
    { contacts: [R('RD', 'R0102.1', 'DRESS_EN')], coil: R('WRT', 'Y0001.1', 'DRESS_L') },
    { contacts: [R('RD', 'X0008.7', 'COOL_OC')], coil: R('WRT', 'R0103.1', 'COOL_FLT') },
    {
      contacts: [R('RD', 'R0102.0', 'GRIND_EN'), R('OR', 'X0000.3', 'COOL_REQ'), R('AND.NOT', 'R0103.1', 'COOL_FLT')],
      coil: R('WRT', 'Y0002.5', 'GCOOL_V'),
    },
    {
      contacts: [R('RD', 'R0102.1', 'DRESS_EN'), R('AND.NOT', 'R0103.1', 'COOL_FLT')],
      coil: R('WRT', 'Y0002.4', 'DCOOL_V'),
    },
    {
      contacts: [R('RD', 'Y0002.5', 'GCOOL_V'), R('OR', 'Y0002.4', 'DCOOL_V')],
      coil: R('WRT', 'Y0002.6', 'COOL_PMP'),
    },
    {
      contacts: [R('RD', 'Y0002.6', 'COOL_PMP'), R('AND.NOT', 'R0103.1', 'COOL_FLT')],
      coil: R('WRT', 'R0103.0', 'COOL_OK'),
    },
    {
      contacts: [R('RD', 'R0104.0', 'LUB_OK'), R('AND', 'R0100.0', 'MACH_RDY')],
      coil: R('WRT', 'Y0002.1', 'SP_LUB'),
    },
    {
      contacts: [R('RD', 'X0002.1', 'WH_START'), R('AND', 'R0100.0', 'MACH_RDY'), R('AND.NOT', 'Y0005.2', 'WH_CCW')],
      coil: R('WRT', 'R0105.1', 'WH_DIR_CW'),
    },
    {
      contacts: [
        R('RD', 'R0105.1', 'WH_DIR_CW'),
        R('AND', 'X0002.1', 'WH_START'),
        R('AND.NOT', 'Y0005.2', 'WH_CCW'),
        R('AND', 'R0100.0', 'MACH_RDY'),
      ],
      coil: R('WRT', 'Y0005.1', 'WH_CW'),
    },
    {
      contacts: [
        R('RD', 'X0002.1', 'WH_START'),
        R('AND.NOT', 'R0105.1', 'WH_DIR_CW'),
        R('AND.NOT', 'Y0005.1', 'WH_CW'),
        R('AND', 'R0100.0', 'MACH_RDY'),
      ],
      coil: R('WRT', 'Y0005.2', 'WH_CCW'),
    },
    {
      contacts: [R('RD', 'Y0005.1', 'WH_CW'), R('OR', 'Y0005.2', 'WH_CCW'), R('AND.NOT', 'Y0000.7', 'WH_DELTA')],
      coil: R('WRT', 'Y0000.6', 'WH_STAR'),
    },
    {
      contacts: [R('RD', 'R0105.0', 'WH_RUN'), R('AND.NOT', 'Y0000.6', 'WH_STAR')],
      coil: R('WRT', 'Y0000.7', 'WH_DELTA'),
    },
    {
      contacts: [R('RD', 'Y0005.1', 'WH_CW'), R('OR', 'Y0005.2', 'WH_CCW')],
      coil: R('WRT', 'R0105.0', 'WH_RUN'),
    },
    {
      contacts: [R('RD', 'X0008.5', 'MOT_OC'), R('OR', 'X0008.7', 'COOL_OC'), R('OR.NOT', 'X0003.3', 'LUB_POK')],
      coil: R('WRT', 'R0106.1', 'ALM_ANY'),
    },
    {
      contacts: [R('RD', 'R0106.1', 'ALM_ANY'), R('OR', 'R0106.0', 'ALM_LAT'), R('AND.NOT', 'X0007.1', 'ALM_RST')],
      coil: R('WRT', 'R0106.0', 'ALM_LAT'),
    },
    { contacts: [R('RD', 'R0106.0', 'ALM_LAT')], coil: R('WRT', 'Y0007.1', 'ALM_L') },
    {
      contacts: [R('RD', 'X0006.3', 'MPG_X1'), R('OR', 'X0006.4', 'MPG_X10'), R('OR', 'X0006.5', 'MPG_X100')],
      coil: R('WRT', 'R0107.0', 'MPG_OK'),
    },
    {
      contacts: [
        R('RD', 'X0011.5', 'CYC_ST'),
        R('OR', 'R0108.0', 'CYC_RUN'),
        R('AND', 'R0102.0', 'GRIND_EN'),
        R('AND.NOT', 'X0011.6', 'CYC_SP'),
        R('AND.NOT', 'R0106.0', 'ALM_LAT'),
      ],
      coil: R('WRT', 'R0108.0', 'CYC_RUN'),
    },
    {
      contacts: [R('RD', 'R0108.0', 'CYC_RUN'), R('AND', 'R0100.0', 'MACH_RDY')],
      coil: R('WRT', 'G0007.2', 'NC_ST'),
    },
  ]
}

const DEMO_R_SYMBOLS = [
  ['R0100.0', 'MACH_RDY'],
  ['R0100.1', 'ESP_OK'],
  ['R0100.2', 'SAFE_OK'],
  ['R0101.0', 'MODE_AUTO'],
  ['R0101.1', 'MODE_JOG'],
  ['R0102.0', 'GRIND_EN'],
  ['R0102.1', 'DRESS_EN'],
  ['R0102.2', 'PROC_LOCK'],
  ['R0103.0', 'COOL_OK'],
  ['R0103.1', 'COOL_FLT'],
  ['R0104.0', 'LUB_OK'],
  ['R0105.0', 'WH_RUN'],
  ['R0105.1', 'WH_DIR_CW'],
  ['R0106.0', 'ALM_LAT'],
  ['R0106.1', 'ALM_ANY'],
  ['R0107.0', 'MPG_OK'],
  ['R0108.0', 'CYC_RUN'],
]

/** 简易「液压压机」演示网（与 Studer 磨削功能不同；仅用 X0/R100/Y0 族） */
export function buildSimplePressDemoRungs() {
  return [
    {
      contacts: [R('RD', 'X0.0', 'DOOR_CLOSED'), R('AND.NOT', 'X0.7', 'E_STOP')],
      coil: R('WRT', 'R100.0', 'SAFE_OK'),
    },
    {
      contacts: [R('RD', 'X0.1', 'LEFT_HAND'), R('AND', 'X0.2', 'RIGHT_HAND'), R('AND', 'R100.0', 'SAFE_OK')],
      coil: R('WRT', 'R100.1', 'TWO_HAND'),
    },
    {
      contacts: [R('RD', 'R100.1', 'TWO_HAND'), R('AND.NOT', 'R100.4', 'ALM')],
      coil: R('WRT', 'Y0.0', 'PUMP_ON'),
    },
    {
      contacts: [R('RD', 'Y0.0', 'PUMP_ON'), R('AND', 'X0.3', 'CLAMP_REQ'), R('AND', 'R100.0', 'SAFE_OK')],
      coil: R('WRT', 'Y0.1', 'CLAMP'),
    },
    {
      contacts: [R('RD', 'Y0.1', 'CLAMP'), R('AND', 'X0.4', 'CLAMP_OK'), R('AND', 'R100.1', 'TWO_HAND')],
      coil: R('WRT', 'R100.2', 'READY_PRESS'),
    },
    {
      contacts: [R('RD', 'R100.2', 'READY_PRESS'), R('AND', 'X0.5', 'PRESS_PB'), R('AND.NOT', 'R100.4', 'ALM')],
      coil: R('WRT', 'Y0.2', 'PRESS_DOWN'),
    },
    {
      contacts: [R('RD', 'Y0.2', 'PRESS_DOWN'), R('AND', 'X0.6', 'BDC_HIT')],
      coil: R('WRT', 'R100.3', 'PRESS_DONE'),
    },
    {
      contacts: [R('RD', 'Y0.2', 'PRESS_DOWN'), R('AND.NOT', 'X0.0', 'DOOR_CLOSED')],
      coil: R('WRT', 'R100.4', 'ALM'),
    },
    {
      contacts: [R('RD', 'R100.3', 'PRESS_DONE'), R('AND.NOT', 'X0.5', 'PRESS_PB')],
      coil: R('WRT', 'R100.5', 'CYCLE_IDLE'),
    },
    {
      contacts: [R('RD', 'R100.0', 'SAFE_OK'), R('AND.NOT', 'R100.4', 'ALM')],
      coil: R('WRT', 'Y0.3', 'READY_LAMP'),
    },
    {
      contacts: [R('RD', 'R100.4', 'ALM')],
      coil: R('WRT', 'Y0.4', 'ALARM_LAMP'),
    },
  ]
}

const PRESS_R_SYMBOLS = [
  ['R0100.0', 'SAFE_OK'],
  ['R0100.1', 'TWO_HAND'],
  ['R0100.2', 'READY_PRESS'],
  ['R0100.3', 'PRESS_DONE'],
  ['R0100.4', 'ALM'],
  ['R0100.5', 'CYCLE_IDLE'],
]

/** 解析可用作外壳的模板 LAD（优先仓库内置空壳） */
export function resolveLadTemplate(candidate = '') {
  const tried = []
  const push = (p) => {
    if (!p) return
    const abs = path.resolve(String(p))
    if (!tried.includes(abs)) tried.push(abs)
  }

  // 1) 显式候选
  push(candidate)

  // 2) 内置空壳 / 格式标准（materialize 到临时目录，供 Fladder 打开）
  const emptyMat = materializeBuiltinLad(BUILTIN_EMPTY_SHELL)
  if (emptyMat.ok) push(emptyMat.path)
  else push(builtinLadPath(BUILTIN_EMPTY_SHELL))

  const fmtMat = materializeBuiltinLad(BUILTIN_FORMAT_STANDARD)
  if (fmtMat.ok) push(fmtMat.path)

  // 3) 桌面常见工程（兼容旧习惯）
  const desk = desktopDir()
  for (const name of [
    'mikrosa(1).LAD',
    'mikrosa.LAD',
    'studer.LAD',
    'SAMA_COMPLEX_DEMO.LAD',
    'SAMA_DEMO_TEMPLATE.LAD',
  ]) {
    push(path.join(desk, name))
  }

  for (const t of tried) {
    try {
      if (fs.existsSync(t) && /\.lad$/i.test(t) && fs.statSync(t).size > 1000) {
        return {
          ok: true,
          path: t,
          tried,
          builtinDir: getBuiltinLadDir(),
          manifest: readBuiltinManifest(),
        }
      }
    } catch {
      /* skip */
    }
  }
  const resolved = resolveUsableLadPath(candidate)
  if (resolved.ok) return { ok: true, path: resolved.path, tried }
  return {
    ok: false,
    error:
      '未找到可用 LAD 外壳。请确认已运行 scripts/build-builtin-lad-shells.mjs 生成内置 empty_0i_shell.LAD，或把 mikrosa/studer 放到桌面。',
    tried,
    builtinDir: getBuiltinLadDir(),
  }
}

function patchMnemonicWithRungs(text, rungs, extraSymbols = []) {
  const symLines = []
  for (const [addr, name] of extraSymbols) {
    symLines.push(`${bit(addr)} ${name}`)
    symLines.push(padSym(name))
  }
  if (symLines.length && /\r?\n%@3\r?\n/i.test(text)) {
    text = text.replace(/\r?\n%@3\r?\n/i, `\r\n${symLines.join('\r\n')}\r\n%@3\r\n`)
  } else if (symLines.length) {
    throw new Error('助记符缺少 %@3，无法写入符号/梯形')
  }

  const speEnd = text.match(
    /\r?\n (N)(\d+):\s*SUB\s+72[^\n]*\r?\n N(\d+):\s*SUB\s+64[^\n]*\r?\n%\r?\n%@4\r?\n/i,
  )
  if (!speEnd) {
    throw new Error('助记符不是可写回的 mode=1（缺少 SPE/END），请换一个完整工程作模板')
  }
  const startN = Number(speEnd[2])
  const { lines, next } = emitRungs(rungs, startN)
  const nSpe = String(next).padStart(5, '0')
  const nEnd = String(next + 1).padStart(5, '0')
  const block = [
    lines,
    ` N${nSpe}: SUB        72      ; SPE`,
    ` N${nEnd}: SUB        64      ; END`,
    `%`,
    `%@4`,
    '',
  ].join('\r\n')
  text = text.replace(speEnd[0], `\r\n${block}`)
  return { text, rungCount: rungs.length, startNet: startN }
}

function patchMnemonicWithDemo(text) {
  return patchMnemonicWithRungs(text, buildDemoRungs(), DEMO_R_SYMBOLS)
}

function patchMnemonicWithSimplePress(text) {
  return patchMnemonicWithRungs(text, buildSimplePressDemoRungs(), PRESS_R_SYMBOLS)
}

/**
 * @param {{ templateLad?: string, outPath?: string, fladderPath?: string, label?: string, variant?: string }} [opts]
 * variant: 'complex' | 'simple-press'（默认 simple-press：内置空壳+液压压机简易逻辑，异于 Studer 磨削）
 */
export async function generateComplexDemoLad(opts = {}) {
  const fladderPath = opts.fladderPath || ''
  const exe = resolveFladderPath(fladderPath)
  if (!exe) {
    return { ok: false, error: '未找到 fladder.exe，无法生成 LAD（请在设置中填写 LADDER-III 路径）' }
  }

  const variant = String(opts.variant || opts.label || 'simple-press').toLowerCase()
  const isSimple =
    /simple|press|design|简易|压机/.test(variant) && !/complex|复杂|grind|磨/.test(variant)
  const label = opts.label || (isSimple ? 'PRESS' : 'COMPLEX')

  // 简易设计：强制优先内置空壳（不显式传桌面 studer，避免整份磨削工程当底）
  const tpl = resolveLadTemplate(isSimple ? '' : opts.templateLad || '')
  if (!tpl.ok) return { ok: false, error: tpl.error, tried: tpl.tried }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  const outLad =
    opts.outPath ||
    path.join(desktopDir(), `SAMA_DEMO_${label}_${stamp}.LAD`)
  const outMne = outLad.replace(/\.lad$/i, '_mnemonic.txt')
  const outDoc = outLad.replace(/\.lad$/i, '_设计说明.md')

  fs.copyFileSync(tpl.path, outLad)
  ensureWritableFile(outLad)

  const exp = await exportMnemonicViaLadderIii(outLad, {
    fladderPath: exe,
    mode: 1,
    outPath: outMne,
    timeoutMs: 180_000,
  })
  if (!exp.ok) {
    return {
      ok: false,
      error: `导出模板助记符失败：${exp.error || ''}`,
      templateLad: tpl.path,
      ladPath: outLad,
    }
  }

  let patched
  try {
    const raw = fs.readFileSync(exp.mnemonicPath).toString('latin1')
    patched = isSimple ? patchMnemonicWithSimplePress(raw) : patchMnemonicWithDemo(raw)
    fs.writeFileSync(outMne, Buffer.from(patched.text, 'latin1'))
  } catch (e) {
    return { ok: false, error: String(e.message || e), templateLad: tpl.path, ladPath: outLad }
  }

  const imp = await importMnemonicViaLadderIii(outLad, outMne, {
    fladderPath: exe,
    compile: false,
    outPath: outLad,
    timeoutMs: 180_000,
  })
  if (!imp.ok) {
    return {
      ok: false,
      error: `MnemonicToSrc 写回失败：${imp.error || ''}`,
      templateLad: tpl.path,
      ladPath: outLad,
      mnemonicPath: outMne,
      log: imp.log,
    }
  }

  const bytes = imp.bytes || (fs.existsSync(outLad) ? fs.statSync(outLad).size : 0)
  const doc = isSimple
    ? `# SAMA 简易设计工程（液压压机演示）

> **演示用，禁止下载到真实机床。**  
> 流程：复制内置 \`empty_0i_shell.LAD\` → 写入与 Studer **不同** 的压机逻辑（门安全/双手按钮/泵/夹紧/下压）。

| 项 | 内容 |
|----|------|
| 结果 LAD | \`${outLad}\` |
| 助记符 | \`${outMne}\` |
| 外壳 | \`${tpl.path}\` |
| 格式标准参考 | 内置 \`format_standard_studer.LAD\` + 知识库 \`FANUC/lad_design_standard.md\` |
| 新增网数 | ${patched.rungCount}（约从 N${String(patched.startNet).padStart(5, '0')}） |
| 字节 | ${bytes} |

## 模块（刻意非磨削）
门关闭安全、双手同期、液压泵、夹紧到位、下压行程、报警灯/就绪灯。

用 LADDER-III 打开结果文件核对末尾 SPE 前新增梯级。
`
    : `# SAMA 演示梯形工程

> **演示用，禁止下载到真实机床。**  
> 本文件由工程外壳 + 程序化助记符网生成。

| 项 | 内容 |
|----|------|
| 结果 LAD | \`${outLad}\` |
| 助记符 | \`${outMne}\` |
| 模板外壳 | \`${tpl.path}\` |
| 新增网数 | ${patched.rungCount}（约从 N${String(patched.startNet).padStart(5, '0')}） |
| 字节 | ${bytes} |

## 含模块
双通道急停、模式互锁、磨削/修整互斥、冷却泵时序、润滑、砂轮正反转+星三角简化、报警自锁、循环 ST。
`
  try {
    fs.writeFileSync(outDoc, doc, 'utf8')
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    ladPath: outLad,
    mnemonicPath: outMne,
    docPath: outDoc,
    templateLad: tpl.path,
    bytes,
    rungCount: patched.rungCount,
    startNet: patched.startNet,
    variant: isSimple ? 'simple-press' : 'complex',
    note: isSimple
      ? `已从内置空壳复制并写入液压压机简易梯形（异于 Studer 磨削）。禁止下机床。`
      : `已基于模板 \`${path.basename(tpl.path)}\` 生成演示工程（未覆盖模板）。禁止下机床。`,
  }
}

/**
 * 清空 %@3 全部原网，整段替换为新梯形（保留 %@1/%@2 外壳与符号）
 * 注意：对带多级 CALLU 的 Studer 类工程，整段替换常被 Fladder 拒绝；请优先用 rewriteAfterFirstSpe。
 */
export function replaceLadderSection(mnemonicText, rungs, extraSymbols = []) {
  let text = String(mnemonicText || '')
  if (!/%@3/i.test(text) || !/%@4/i.test(text)) {
    throw new Error('助记符缺少 %@3/%@4，无法整段重写')
  }

  const symLines = []
  for (const [addr, name] of extraSymbols) {
    symLines.push(`${bit(addr)} ${name}`)
    symLines.push(padSym(name))
  }
  if (symLines.length) {
    const symBlock = symLines.join('\r\n')
    if (/\r?\n%@3\r?\n/i.test(text)) {
      text = text.replace(/\r?\n%@3\r?\n/i, `\r\n${symBlock}\r\n%@3\r\n`)
    }
  }

  const { lines, next } = emitRungs(rungs, 1)
  const nSpe = String(next).padStart(5, '0')
  const nEnd = String(next + 1).padStart(5, '0')
  const newSection = [
    '%@3',
    lines,
    ` N${nSpe}: SUB        72      ; SPE`,
    ` N${nEnd}: SUB        64      ; END`,
    `%`,
    `%@4`,
  ].join('\r\n')

  const replaced = text.replace(
    /\r?\n?%@3[\s\S]*?%@4/i,
    `\r\n${newSection}`,
  )
  if (replaced === text) {
    throw new Error('未能替换 %@3 段')
  }
  return { text: replaced, rungCount: rungs.length, startNet: 1, endNet: next + 1 }
}

/**
 * Studer 等多级工程：保留第一个 SPE 及之前（一级 CALLU），其后全部清空并写入新网
 */
export function rewriteAfterFirstSpe(mnemonicText, rungs) {
  const raw = String(mnemonicText || '')
  const i3 = raw.search(/%@3/i)
  const i4 = raw.search(/%@4/i)
  if (i3 < 0 || i4 < 0) throw new Error('助记符缺少 %@3/%@4')

  const head = raw.slice(0, i3)
  const oldLadder = raw.slice(i3, i4)
  const tail = raw.slice(i4)
  const lines = oldLadder.split(/\r?\n/)
  const spe1 = lines.findIndex((l) => /SUB\s+72/i.test(l) && /SPE/i.test(l))
  if (spe1 < 0) {
    // 无多级结构：退回整段替换
    return replaceLadderSection(raw, rungs, [])
  }

  const level1 = lines.slice(0, spe1 + 1)
  const speNum = Number(String(lines[spe1]).match(/N(\d+)/i)?.[1] || 0)
  const startN = speNum + 1
  const emitted = emitRungs(rungs, startN)
  const newNetBlock = String(emitted.lines || '')
  const next = emitted.next
  const nSpe = String(next).padStart(5, '0')
  const nEnd = String(next + 1).padStart(5, '0')
  const newLadder = [
    ...level1,
    newNetBlock,
    ` N${nSpe}: SUB        72      ; SPE`,
    ` N${nEnd}: SUB        64      ; END`,
    `%`,
  ].join('\r\n')

  return {
    text: `${head}${newLadder}\r\n${tail}`,
    rungCount: rungs.length,
    startNet: startN,
    endNet: next + 1,
    keptFirstSpeAt: speNum,
  }
}

/**
 * 在最后一个 SPE/END 前追加多网（Studer 等多级工程可写回的稳妥方式）
 */
export function appendRungsBeforeFinalSpe(mnemonicText, rungs) {
  let text = String(mnemonicText || '').replace(/\r\n/g, '\n')
  if (!text.includes('%@3')) throw new Error('助记符缺少 %@3')

  const speEnd = text.match(
    /\n (N)(\d+):\s*SUB\s+72([^\n]*)\n N(\d+):\s*SUB\s+64([^\n]*)\n%\n%@4\n/i,
  )
  if (!speEnd) throw new Error('找不到末尾 SPE/END，无法追加')

  const startN = Number(speEnd[2])
  const { lines, next } = emitRungs(rungs, startN)
  const nSpe = String(next).padStart(5, '0')
  const nEnd = String(next + 1).padStart(5, '0')
  const block = [
    String(lines),
    ` N${nSpe}: SUB        72${speEnd[3]}`,
    ` N${nEnd}: SUB        64${speEnd[5]}`,
    `%`,
    `%@4`,
    '',
  ].join('\n')

  text = text.replace(speEnd[0], `\n${block}`)
  return {
    text: text.replace(/\n/g, '\r\n'),
    rungCount: rungs.length,
    startNet: startN,
    endNet: next + 1,
  }
}

/**
 * Studer 写能力测试：末尾追加一套 Studer 风格逻辑（另存，不覆盖源）
 * 整段清空 Studer 多级工程再导入，Fladder 常因符号表 E-3123 而不落盘；追加可验证。
 * @param {{ templateLad?: string, outPath?: string, fladderPath?: string }} [opts]
 */
export async function rewriteStuderStyleLad(opts = {}) {
  const fladderPath = opts.fladderPath || ''
  const exe = resolveFladderPath(fladderPath)
  if (!exe) {
    return { ok: false, error: '未找到 fladder.exe，无法重写 LAD' }
  }

  const preferred = opts.templateLad || path.join(desktopDir(), 'studer.LAD')
  const tpl = resolveLadTemplate(preferred)
  if (!tpl.ok) return { ok: false, error: tpl.error, tried: tpl.tried }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  const outLad =
    opts.outPath ||
    path.join(desktopDir(), `SAMA_STUDER_REWRITE_${stamp}.LAD`)
  const outMne = outLad.replace(/\.lad$/i, '_mnemonic.txt')
  const outDoc = outLad.replace(/\.lad$/i, '_重写说明.md')

  fs.copyFileSync(tpl.path, outLad)
  ensureWritableFile(outLad)

  const exp = await exportMnemonicViaLadderIii(outLad, {
    fladderPath: exe,
    mode: 1,
    outPath: outMne,
    timeoutMs: 180_000,
  })
  if (!exp.ok) {
    return {
      ok: false,
      error: `导出助记符失败：${exp.error || ''}`,
      templateLad: tpl.path,
      ladPath: outLad,
    }
  }

  let patched
  try {
    const raw = fs.readFileSync(exp.mnemonicPath).toString('latin1')
    const rungs = buildStuderRewriteRungs(extractSymbolBits(raw))
    patched = appendRungsBeforeFinalSpe(raw, rungs)
    fs.writeFileSync(outMne, Buffer.from(patched.text, 'latin1'))
  } catch (e) {
    return { ok: false, error: String(e.message || e), templateLad: tpl.path, ladPath: outLad }
  }

  const imp = await importMnemonicViaLadderIii(outLad, outMne, {
    fladderPath: exe,
    compile: false,
    outPath: outLad,
    timeoutMs: 180_000,
  })
  if (!imp.ok) {
    return {
      ok: false,
      error: `MnemonicToSrc 写回失败：${imp.error || ''}`,
      templateLad: tpl.path,
      ladPath: outLad,
      mnemonicPath: outMne,
      log: imp.log,
    }
  }

  let verified = false
  let verifyNets = 0
  try {
    const afterPath = outLad.replace(/\.lad$/i, '_after_mne.txt')
    const ver = await exportMnemonicViaLadderIii(imp.ladPath || outLad, {
      fladderPath: exe,
      mode: 1,
      outPath: afterPath,
      timeoutMs: 180_000,
    })
    if (ver.ok) {
      const t = fs.readFileSync(ver.mnemonicPath, 'latin1')
      const L = t.slice(t.search(/%@3/i), t.search(/%@4/i))
      verifyNets = [...L.matchAll(/\bN(\d+):/g)].length
      verified = /WRT\s+R100\.3/i.test(L) && /WRT\s+R100\.1/i.test(L) && verifyNets > 301
    }
  } catch {
    /* ignore */
  }

  const resultPath = imp.ladPath || outLad
  const bytes =
    imp.bytes || (fs.existsSync(resultPath) ? fs.statSync(resultPath).size : 0)
  const doc = `# SAMA Studer 写梯形能力测试

> **演示用，禁止下机床。** 未覆盖源文件。

| 项 | 内容 |
|----|------|
| 结果 | \`${resultPath}\` |
| 源 | \`${tpl.path}\` |
| 追加网数 | ${patched.rungCount}（自 N${String(patched.startNet).padStart(5, '0')}） |
| 回导出网数 | ${verifyNets || '—'} |
| 核验 | ${verified ? '通过（含 R100.3 自检且网数增加）' : '未通过'} |
| 字节 | ${bytes} |

## 结论（实测）
- ✅ 可在 Studer 工程**末尾追加**自写梯级并写回二进制
- ❌ 不能把 Studer 多级 CALLU **整段删光再重建**（再导入符号表大量 E-3123，梯形不落盘）
- ✅ 简单外壳（mikrosa）上「清空式扩展」更稳
`

  try {
    fs.writeFileSync(outDoc, doc, 'utf8')
  } catch {
    /* ignore */
  }

  if (!verified) {
    return {
      ok: false,
      error: '写回后回导出未看到新梯级',
      ladPath: resultPath,
      mnemonicPath: outMne,
      templateLad: tpl.path,
      bytes,
      log: imp.log,
    }
  }

  return {
    ok: true,
    ladPath: resultPath,
    mnemonicPath: outMne,
    docPath: outDoc,
    templateLad: tpl.path,
    bytes,
    rungCount: patched.rungCount,
    verified,
    mode: 'append-before-spe',
    note: `已在 \`${path.basename(tpl.path)}\` 副本末尾追加 Studer 风格逻辑（未覆盖源）。禁止下机床。`,
  }
}

export function wantsGenerateLad(text = '') {
  const s = String(text || '')
  if (/sama-allow-lad-generate/i.test(s)) return true
  // 排除「生成…报告/分析」类，避免抢问题报告短路
  if (/(报告|分析|核验)/.test(s) && !/(演示|新建工程|生成工程)/.test(s)) return false
  if (/(生成|新建|创建).{0,12}(演示)?(梯形|LAD|梯子)(工程|文件|图)?/i.test(s)) return true
  if (/(设计|写).{0,8}(一套|一个).{0,8}(复杂)?(梯形|LAD)/i.test(s)) return true
  return false
}

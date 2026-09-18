/**
 * 磨床出码：先识别机床体系，再按该体系生成/校验。
 * 禁止把 STUDER 840D、高桥 X=0、MIKROSA 无心宏一律重写成 ISO 纵磨。
 */
import {
  dialectHardRules,
  dialectInfo,
  looksLikeIsoDiameterProgram,
  ncLooksLikeDialect,
  resolveGrindDialect,
  usesIsoDiameter,
} from './grindDialect.mjs'
import { buildByDialect } from './grindPosts.mjs'
import { fmtAllow, fmtMm as fmt, fmtSize, fmtUm, GRIND_UNIT_NOTE } from './grindUnits.mjs'

const GRIND_HINT =
  /磨床|外圆磨|内圆磨|无心|砂轮|磨削|精磨|粗磨|od\s*grind|cylindrical grind|STUDER|MIKROSA|高桥|SASL|CYCLE407|G75|G78|G200|NUMgrind/i

const OEM_CYCLE =
  /\bG75\b|\bG77\b|\bG78\b|\bG79\b|\bG200\b|\bG206\b|CYCLE407\d|\bL10[01]\b|\bM98\b|P0022|NUMgrind|#540|O8205|M96\s*P8500|G65\s*P8201/i

export function looksLikeGrindTask(text) {
  return GRIND_HINT.test(String(text || ''))
}

export function isReadCodeTask(text) {
  const s = String(text || '')
  if (/看码识件/.test(s)) return true
  if (/不要改程序/.test(s) && /零件|参数|示意图/.test(s)) return true
  if (/说明它加工的是什么零件/.test(s)) return true
  return false
}

export { resolveGrindDialect, dialectInfo } from './grindDialect.mjs'

export function extractMachine(text) {
  const src = String(text || '')
  const m =
    src.match(/STUDER\s+(?:favoritCNC|S\d{2,3})/i) ||
    src.match(/米克罗莎[^\n,]{0,24}/) ||
    src.match(/MIKROSA[^\n,]{0,28}/i) ||
    src.match(/SASL[\d/\s-]{0,12}/i) ||
    src.match(/高桥[^\n,]{0,28}/) ||
    src.match(/NUM\s+Flexium/i) ||
    src.match(/Siemens\s*840D(?:\s*sl)?/i) ||
    src.match(/鹰贝[^\n,]{0,16}/)
  return m ? String(m[0]).replace(/\s+/g, ' ').trim() : ''
}

function withDialect(dims, src = '') {
  if (!dims) return null
  const dialect = resolveGrindDialect(src, dims)
  const info = dialectInfo(dialect)
  return { ...dims, dialect, dialectLabel: info.label }
}

export function wantsGrindProgram(text) {
  if (isReadCodeTask(text)) return false
  return /看图出码|G\s*代码|gcode|\.nc\b|加工程序|参考程序|写出.*程序|写.*程序/i.test(String(text || ''))
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function parseNcMoves(nc) {
  const xz = []
  let x = null
  let z = null
  for (const line of String(nc || '').split(/\r?\n/)) {
    const raw = line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').replace(/%.*$/, '')
    const xm = raw.match(/\bX\s*(-?\d+(?:\.\d+)?)/i)
    const zm = raw.match(/\bZ\s*(-?\d+(?:\.\d+)?)/i)
    if (xm) x = Number(xm[1])
    if (zm) z = Number(zm[1])
    if (x == null && z == null) continue
    if (!/[XZ]/i.test(raw)) continue
    xz.push({ x, z, g01: /\bG0*1\b/i.test(raw), g00: /\bG0*0\b/i.test(raw), line })
  }
  return xz
}

function hasDia(xs, d, tol = 1.2) {
  if (d == null || !xs.length) return false
  return xs.some((x) => Math.abs(Math.abs(x) - d) <= tol)
}

function inferProcess(src, type) {
  const s = String(src || '')
  if (/修整|金刚笔|dress/i.test(s) && /砂轮/.test(s) && !/工件磨削|零件/.test(s)) return 'dress'
  if (/修整|金刚笔/.test(s) && type === 'dress') return 'dress'
  if (/端面|轴肩/.test(s) && /切入|Z\s*向/.test(s)) return 'face'
  if (/端面磨|轴肩端面/.test(s)) return 'face'
  if (/内圆|内孔|衬套/.test(s)) return 'id'
  if (/切入|横磨|plunge|振荡/.test(s)) return 'od_plunge'
  if (/纵磨|往复|traverse/.test(s)) return 'od_traverse'
  return ''
}

function grindStepsOnly(steps) {
  const list = Array.isArray(steps) ? steps : []
  const marked = list.filter((s) => s && s.grind !== false && s.grind !== 'false')
  return marked.length ? marked : list
}

export function extractGrindJson(text) {
  const src = String(text || '')
  const fenced = src.match(/```grind-json\s*([\s\S]*?)```/i)
  const raw = fenced
    ? fenced[1]
    : (src.match(/\{[\s\S]*?"(?:type|process|steps|d_large)"[\s\S]*?\}/) || [])[0]
  if (!raw) return null
  try {
    const j = JSON.parse(raw.trim())
    return withDialect(normalizeDims(j, src), src)
  } catch {
    return null
  }
}

function normalizeDims(j, src = '') {
  if (!j || typeof j !== 'object') return null
  let type = String(j.type || '').toLowerCase()
  let process = String(j.process || '').toLowerCase()
  if (process === 'od_grind') process = type === 'plunge' ? 'od_plunge' : 'od_traverse'
  if (!process) process = inferProcess(src, type)
  if (/plunge|od_plunge|切入/.test(process)) {
    type = type === 'face' ? 'face' : 'plunge'
    process = type === 'face' ? 'face' : 'od_plunge'
  }
  if (/face|端面/.test(process) || type === 'face') {
    type = 'face'
    process = 'face'
  }
  if (/dress|修整/.test(process) || type === 'dress') {
    type = 'dress'
    process = 'dress'
  }
  if (type === 'bore' || process === 'id' || j.bore) {
    type = 'bore'
    process = 'id'
  }

  const machine = j.machine || ''
  const control = j.control || ''

  if (type === 'dress') {
    return {
      type: 'dress',
      process: 'dress',
      d: num(j.d ?? j.wheel_d),
      L: num(j.L ?? j.width ?? j.totalL),
      machine,
      control,
    }
  }

  if (Array.isArray(j.steps) && j.steps.length) {
    const steps = j.steps
      .map((s) => ({
        d: num(s.d ?? s.dia ?? s.diameter),
        L: num(s.L ?? s.length),
        stock: num(s.stock),
        grind: s.grind !== false && s.grind !== 'false',
      }))
      .filter((s) => s.d != null)
    if (!steps.length) return null
    const active = grindStepsOnly(steps)
    const totalL = num(j.totalL) || steps.reduce((a, s) => a + (s.L || 0), 0)
    if (type === 'plunge' || process === 'od_plunge') {
      const g = active[0]
      return {
        type: 'plunge',
        process: 'od_plunge',
        d: g.d,
        L: g.L,
        stock: g.stock,
        totalL: g.L,
        machine,
        control,
        reference: steps.filter((s) => !s.grind),
      }
    }
    if (type === 'face') {
      const g = active[0]
      return {
        type: 'face',
        process: 'face',
        d: g.d,
        L: g.L || 0.2,
        stock: g.stock,
        d_left: num(j.d_left) || (steps[0] && steps[0].d),
        d_right: num(j.d_right) || (steps[steps.length - 1] && steps[steps.length - 1].d),
        machine,
        control,
      }
    }
    if (active.length === 1 && (type === 'shaft' || process === 'od_traverse')) {
      return {
        type: 'shaft',
        process: process || 'od_traverse',
        d: active[0].d,
        L: active[0].L,
        stock: active[0].stock,
        totalL: active[0].L,
        machine,
        control,
        reference: steps.filter((s) => !s.grind),
      }
    }
    return {
      type: 'step_shaft',
      process: process || 'od_traverse',
      steps: active,
      totalL: active.reduce((a, s) => a + (s.L || 0), 0) || totalL,
      stockDelta: num(j.stockDelta),
      machine,
      control,
      reference: steps.filter((s) => !s.grind),
    }
  }

  if (type === 'taper' || (j.d_large != null && j.d_small != null)) {
    return {
      type: 'taper',
      process: 'taper',
      d_large: num(j.d_large),
      d_small: num(j.d_small),
      L: num(j.L ?? j.totalL),
      machine,
      control,
    }
  }
  if (type === 'bore' || j.bore) {
    return { type: 'bore', process: 'id', d: num(j.d), L: num(j.L ?? j.totalL), stock: num(j.stock), machine, control }
  }
  if (type === 'plunge' || process === 'od_plunge') {
    return {
      type: 'plunge',
      process: 'od_plunge',
      d: num(j.d),
      L: num(j.L ?? j.totalL),
      stock: num(j.stock),
      machine,
      control,
    }
  }
  if (type === 'face') {
    return { type: 'face', process: 'face', d: num(j.d), L: num(j.L ?? j.totalL), stock: num(j.stock), machine, control }
  }
  if (j.d != null && (j.L != null || j.totalL != null)) {
    return {
      type: 'shaft',
      process: process || 'od_traverse',
      d: num(j.d),
      L: num(j.L ?? j.totalL),
      stock: num(j.stock),
      machine,
      control,
    }
  }
  return null
}

function grindFaceFromText(src) {
  const m =
    src.match(/磨削(?:中间|面)?[^φΦØø\d]{0,12}[φΦØø]\s*(\d+(?:\.\d+)?)(?:\s*[×xX]\s*(\d+(?:\.\d+)?))?/) ||
    src.match(/红色[^φΦØø\d]{0,16}[φΦØø]\s*(\d+(?:\.\d+)?)(?:\s*[×xX]\s*(\d+(?:\.\d+)?))?/)
  if (!m) return null
  return { d: Number(m[1]), L: m[2] ? Number(m[2]) : null }
}

export function extractGrindDims(text) {
  const fromJson = extractGrindJson(text)
  const machine = extractMachine(text) || fromJson?.machine || ''
  if (fromJson) {
    const dims = machine && !fromJson.machine ? { ...fromJson, machine } : fromJson
    return withDialect(dims, text)
  }

  const src = String(text || '')
  const process = inferProcess(src, '')
  const face = grindFaceFromText(src)

  if (process === 'dress') {
    const w = src.match(/[φΦØø]\s*(400|350|500)[^0-9]{0,8}[×xX]\s*(\d+)/)
    return withDialect(
      {
        type: 'dress',
        process: 'dress',
        d: w ? Number(w[1]) : 400,
        L: w ? Number(w[2]) : 40,
        machine,
      },
      text,
    )
  }

  if (face && (process === 'od_plunge' || process === 'od_traverse' || process === 'face' || process === 'id')) {
    const tag = (obj) => withDialect(obj && machine ? { ...obj, machine } : obj, text)
    if (process === 'id') return tag({ type: 'bore', process: 'id', d: face.d, L: face.L })
    if (process === 'face') return tag({ type: 'face', process: 'face', d: face.d, L: face.L || 0.2 })
    if (process === 'od_plunge') return tag({ type: 'plunge', process: 'od_plunge', d: face.d, L: face.L, stock: face.d + 0.3 })
    return tag({ type: 'shaft', process: 'od_traverse', d: face.d, L: face.L, stock: face.d + 0.3 })
  }

  const allDia = []
  const finishDia = []
  const re = /(?:[φΦØø]|DIA|D)\s*(\d{2,}(?:\.\d+)?)(?:\s*(h\d+))?/g
  let m
  while ((m = re.exec(src))) {
    const d = Number(m[1])
    if (!(d >= 3 && d <= 400)) continue
    allDia.push(d)
    if (m[2] || Number.isInteger(d)) finishDia.push(d)
  }
  const uniq = (arr) => [...new Set(arr.map((x) => Number(x)))]
  const dias = uniq(finishDia.length >= 1 ? finishDia.filter((d) => Number.isInteger(d) || d === Math.round(d)) : allDia)

  const totalM =
    src.match(/总长[^0-9]{0,8}(\d+(?:\.\d+)?)/) ||
    src.match(/\b(140)\s*(?:\+\/-|±)/) ||
    src.match(/\bL\s*=\s*(\d+(?:\.\d+)?)/i)
  const totalL = totalM ? Number(totalM[1]) : null
  const lenHits = [...src.matchAll(/(?:左段|右段|长度|轴向|length)\s*[^0-9]{0,10}(\d+(?:\.\d+)?)/gi)].map(
    (x) => Number(x[1]),
  )
  if (!lenHits.length) {
    for (const n of [85, 55, 80, 60, 50, 45]) {
      if (new RegExp(`\\b${n}\\b`).test(src)) lenHits.push(n)
    }
  }
  const stockHits = [...src.matchAll(/(?:[φΦØø]|D)\s*(\d{2,}\.\d+)/g)]
    .map((x) => Number(x[1]))
    .filter((d) => !Number.isInteger(d))

  const tag = (obj) => withDialect(obj && machine ? { ...obj, machine } : obj, text)

  if (face) {
    return tag({
      type: process === 'od_plunge' ? 'plunge' : 'shaft',
      process: process || 'od_traverse',
      d: face.d,
      L: face.L,
      stock: face.d + 0.3,
    })
  }

  if (dias.length >= 2 && process !== 'od_plunge' && process !== 'face') {
    const dBig = Math.max(...dias.slice(0, 4))
    const dSmall = Math.min(...dias.slice(0, 4))
    if (dBig !== dSmall) {
      const Ls = lenHits.filter((n) => n >= 5 && n < (totalL || 999) - 0.01).slice(0, 2)
      const L1 = Ls[0] || (totalL ? Math.round(totalL * 0.6) : null)
      const L2 = Ls[1] || (totalL && L1 ? totalL - L1 : null)
      const stockBig = stockHits.find((s) => Math.abs(s - dBig) <= 1.2)
      const stockSmall = stockHits.find((s) => Math.abs(s - dSmall) <= 1.2)
      if (L1 && L2) {
        return tag({
          type: 'step_shaft',
          process: 'od_traverse',
          steps: [
            { d: dBig, L: L1, stock: stockBig || dBig + 0.3, grind: true },
            { d: dSmall, L: L2, stock: stockSmall || dSmall + 0.3, grind: true },
          ],
          totalL: totalL || L1 + L2,
        })
      }
    }
  }
  if (dias.length === 1 && totalL) {
    return tag({ type: 'shaft', process: process || 'od_traverse', d: dias[0], L: totalL, stock: stockHits[0] || dias[0] + 0.3 })
  }
  return null
}

export function grindHardGeometryBlock(dims) {
  if (!dims) return ''
  const extra = []
  if (dims.type === 'plunge') {
    extra.push('这是切入/横磨：只磨 grind-json 里的那一档直径，禁止把两端未磨台阶写成纵磨。轴向覆盖轴颈宽度即可，不要用整根总长去卡。')
  } else if (dims.type === 'face') {
    extra.push('这是轴肩/端面：用 Z 向切入，禁止改成外圆纵磨每一档直径。')
  } else if (dims.type === 'dress') {
    extra.push('这是砂轮修整，不是磨零件。禁止按工件外圆纵磨模板重写。')
  } else if (dims.reference?.length) {
    extra.push(`未磨参考直径（不要写进切削行程）：${dims.reference.map((s) => `φ${s.d}`).join('、')}`)
  } else if (dims.type === 'shaft' || dims.type === 'step_shaft') {
    extra.push('只磨 JSON 里的 steps/直径；图上其它台阶若未标磨削面，不要纵磨。')
  }
  const dialect = dims.dialect || 'iso_generic'
  extra.push(dialectHardRules(dialect))
  extra.push(GRIND_UNIT_NOTE)
  extra.push('余量/进给/补偿在注释里写 μm 一位小数（20.0μm），程序里仍写毫米到 0.0001（=0.1μm）。禁止把 300μm 余量只写成 0.3。')
  return `【磨床硬性几何 — 写程序必须命中这些数与体系；写错会被系统按该体系替换】
\`\`\`json
${JSON.stringify(dims, null, 2)}
\`\`\`
${extra.join('\n')}`
}

function ncHasNumber(nc, v) {
  if (v == null) return true
  const n = Number(v)
  if (!Number.isFinite(n)) return false
  const s = String(nc || '')
  const core = fmt(n)
  if (s.includes(core)) return true
  if (Math.abs(n - Math.round(n)) < 1e-6 && new RegExp(`\\b${Math.round(n)}\\b`).test(s)) return true
  return false
}

function validateDialectNc(dims, nc, dialect) {
  const issues = []
  const info = dialectInfo(dialect)
  if (
    /T\s*\d+\s*M\s*6/i.test(nc) &&
    dialect !== 'num_flexium' &&
    !/\bG200\b|\bG230\b|\bG206\b/i.test(nc)
  ) {
    issues.push('出现铣削换刀 T/M6，不像该磨床体系')
  }
  if (ncLooksLikeDialect(nc, dialect)) {
    return { ok: issues.length === 0, issues, moves: parseNcMoves(nc) }
  }
  if (looksLikeIsoDiameterProgram(nc)) {
    issues.push(`写的是 ISO 直径纵磨，与「${info.label}」不符`)
    return { ok: false, issues, moves: parseNcMoves(nc) }
  }
  if (dims.type === 'dress') {
    if (dialect !== 'gaoqiao_fanuc' && dialect !== 'centerless_thru') {
      issues.push(`未出现本机修整循环（${info.pack}）`)
    }
    return { ok: issues.length === 0, issues, moves: parseNcMoves(nc) }
  }
  issues.push(`未出现本机循环/宏（${info.pack}）`)
  const d = dims.d ?? dims.d_large ?? dims.steps?.[0]?.d
  const L = dims.L ?? dims.totalL ?? dims.steps?.[0]?.L
  if (d != null && !ncHasNumber(nc, d)) issues.push(`成品直径 φ${fmt(d)} 未出现`)
  if (L != null && !ncHasNumber(nc, L)) issues.push(`长度 ${fmt(L)} 未出现`)
  return { ok: false, issues, moves: parseNcMoves(nc) }
}

export function validateGrindNc(dims, nc) {
  const dialect = dims?.dialect || resolveGrindDialect(`${dims?.machine || ''} ${dims?.control || ''}`, dims)
  if (dims && !usesIsoDiameter(dialect)) {
    return validateDialectNc({ ...dims, dialect }, nc, dialect)
  }
  const issues = []
  if (dims?.type === 'dress') {
    if (/T\s*\d+\s*M\s*6/i.test(nc)) issues.push('出现铣削换刀 T/M6，不像修整程序')
    return { ok: issues.length === 0, issues, moves: parseNcMoves(nc) }
  }

  const moves = parseNcMoves(nc)
  const xs = moves.map((p) => Math.abs(p.x || 0)).filter((x) => x > 0)
  const cutXs = moves.filter((p) => p.g01).map((p) => Math.abs(p.x || 0))
  const useXs = cutXs.length ? cutXs : xs
  const zs = moves.map((p) => p.z).filter((z) => z != null)

  if (/T\s*\d+\s*M\s*6/i.test(nc)) {
    issues.push('出现铣削换刀 T/M6，不像外圆磨示意程序')
  }

  if (dims.type === 'face') {
    const d = dims.d
    if (d != null && !hasDia(useXs, d, 3) && !hasDia(xs, d, 3)) {
      issues.push(`端面停靠直径 X${fmt(d)} 未出现`)
    }
    const zSpan = zs.length ? Math.abs(Math.max(...zs) - Math.min(...zs)) : 0
    if (zs.length && zSpan < 0.05 && !/\bG0*1\b[^\n]*\bZ/i.test(nc)) {
      issues.push('端面磨应有 Z 向切入')
    }
    return { ok: issues.length === 0, issues, moves }
  }

  if (dims.type === 'plunge') {
    const d = dims.d
    if (d != null && !hasDia(useXs, d, 1.2) && !hasDia(xs, d, 1.2)) {
      issues.push(`成品直径 X${fmt(d)} 未出现`)
    }
    const L = dims.L || 0
    if (L > 0 && zs.length) {
      const zMin = Math.min(...zs)
      const zMax = Math.max(...zs)
      const span = Math.abs(zMax - zMin)
      if (span > L * 3 + 20) {
        issues.push(`切入磨 Z 行程过长（${fmt(span)}，轴颈约 ${fmt(L)}），不要改成整轴纵磨`)
      }
    }
    return { ok: issues.length === 0, issues, moves }
  }

  const L =
    dims.totalL ||
    dims.L ||
    (dims.steps || []).reduce((a, s) => a + (s.L || 0), 0) ||
    0

  const diaList = []
  if (dims.type === 'step_shaft') {
    for (const s of grindStepsOnly(dims.steps || [])) diaList.push(s.d, s.stock)
  } else if (dims.type === 'taper') {
    diaList.push(dims.d_large, dims.d_small)
  } else {
    diaList.push(dims.d, dims.stock)
  }
  const need = diaList.filter((d) => d != null)
  for (const d of need) {
    if (dims.type === 'step_shaft' && dims.steps?.some((s) => s.stock === d) && hasDia(useXs, d, 2)) {
      continue
    }
    if (dims.steps?.some((s) => s.d === d) || d === dims.d || d === dims.d_large || d === dims.d_small) {
      if (!hasDia(useXs, d, 1.2) && !hasDia(xs, d, 1.2)) {
        issues.push(`成品直径 X${fmt(d)} 未出现`)
      }
    }
  }

  if (L > 0 && zs.length && dims.type !== 'bore') {
    const zMin = Math.min(...zs)
    const zMax = Math.max(...zs)
    const coverNeg = Math.abs(zMin + L) / L
    const span = Math.abs(zMax - zMin) / L
    if (coverNeg > 0.25 && span < 0.7) {
      issues.push(`轴向未覆盖约 Z0→Z-${fmt(L)}（当前 Z ${fmt(zMax)} ~ ${fmt(zMin)}）`)
    }
    if (Math.abs(zMin) > L * 1.35 + 8) {
      issues.push(`Z 超出工件长度（Z${fmt(zMin)}，总长约 ${fmt(L)}）`)
    }
  }

  if (dims.type === 'bore' && L > 0 && zs.length) {
    const zMin = Math.min(...zs)
    if (Math.abs(zMin) < L * 0.6) {
      issues.push(`内孔深度未覆盖约 Z-${fmt(L)}`)
    }
  }

  if (need.length && useXs.length) {
    const maxNeed = Math.max(...need)
    const related = useXs.filter((x) => need.some((d) => Math.abs(x - d) <= 3 || Math.abs(x - d / 2) <= 1.2))
    if (related.length === 0 && maxNeed >= 20 && useXs.every((x) => x <= 20)) {
      issues.push('切削 X 与成品直径对不上（像把 X 当成刀位偏移）')
    }
  }

  if (dims.type === 'taper') {
    const big = hasDia(useXs, dims.d_large, 2.5) || hasDia(xs, dims.d_large, 2.5)
    const small = hasDia(useXs, dims.d_small, 2.5) || hasDia(xs, dims.d_small, 2.5)
    if (!(big && small)) issues.push('锥度必须同时出现两端成品直径，禁止恒直径横磨')
  }

  return { ok: issues.length === 0, issues, moves }
}

function buildIsoGrindNc(dims) {
  if (!dims) return ''
  const lines = [
    'O8001',
    'G21 G90',
    dims.machine
      ? `(${dims.machine} 示意 直径编程 X=工件直径 Z0=左端 向右为负)`
      : '(外圆磨示意 直径编程 X=工件直径 Z0=左端 向右为负)',
    `(${GRIND_UNIT_NOTE})`,
  ]

  if (dims.type === 'dress') {
    const w = dims.L || 40
    const d = dims.d || 400
    lines.push(`(砂轮修整示意 φ${fmtSize(d)}×${fmtSize(w)}，下机床前按厂家修整循环改写)`)
    lines.push(`G00 X${fmt(50)} Z${fmt(5)}`)
    lines.push(`G01 X${fmt(0.3)} Z${fmt(2)} F200`)
    lines.push(`G01 X0 F20`)
    lines.push(`G01 Z-${fmt(w)} F200`)
    lines.push(`G00 X${fmt(10)}`)
    lines.push(`G00 Z${fmt(5)}`)
    lines.push('M30')
    return lines.join('\n')
  }

  if (dims.type === 'face') {
    const d = dims.d || 28
    const clear = d + 20
    lines.push(`(轴肩端面 Z 向切入 ${fmtUm(0.2)}，禁止改成外圆纵磨)`)
    lines.push(`G00 X${fmt(clear)} Z${fmt(5)}`)
    lines.push(`G00 X${fmt(d)} Z${fmt(1)}`)
    lines.push(`G01 Z${fmt(0.2)} F50`)
    lines.push('G01 Z0 F6')
    lines.push('G04 P1500')
    lines.push(`G00 Z${fmt(2)}`)
    lines.push(`G00 X${fmt(clear)}`)
    lines.push('M30')
    return lines.join('\n')
  }

  if (dims.type === 'taper' && dims.d_large != null && dims.d_small != null) {
    const L = dims.L || 0
    const clear = Math.max(dims.d_large, dims.d_small) + 10
    lines.push(`G00 X${fmt(clear)} Z${fmt(5)}`)
    lines.push(`G00 X${fmt(dims.d_large)} Z0`)
    lines.push(`G01 X${fmt(dims.d_small)} Z-${fmt(L)} F0.08`)
    lines.push(`G00 X${fmt(clear)} Z${fmt(5)}`)
    lines.push('M30')
    return lines.join('\n')
  }

  if (dims.type === 'plunge') {
    const d = dims.d
    const L = dims.L || 18
    const stock = dims.stock != null ? dims.stock : d + 0.3
    const clear = d + 20
    const allow = fmtAllow(d, stock)
    lines.push(`(切入磨 φ${fmtSize(d)}×${fmtSize(L)}${allow ? ` 余量 ${allow}` : ''}，不纵走整轴)`)
    lines.push(`G00 X${fmt(clear)} Z${fmt(5)}`)
    lines.push(`G00 Z${fmt(-(L / 2))}`)
    lines.push(`G00 X${fmt(stock + 5)}`)
    lines.push(`G01 X${fmt(stock)} F20`)
    lines.push(`G01 X${fmt(d)} F8`)
    lines.push('G04 P2000')
    lines.push(`G00 X${fmt(clear)}`)
    lines.push(`G00 Z${fmt(5)}`)
    lines.push('M30')
    return lines.join('\n')
  }

  if (dims.type === 'bore') {
    const d = dims.d
    const L = dims.L || 15
    const stock = dims.stock != null ? dims.stock : Math.max(0, d - 0.2)
    const allow = fmtAllow(d, stock)
    lines.push(`(内圆磨 φ${fmtSize(d)} 深 ${fmtSize(L)}${allow ? ` 余量 ${allow}` : ''})`)
    lines.push(`G00 X${fmt(Math.max(stock - 5, 1))} Z${fmt(5)}`)
    lines.push(`G00 X${fmt(stock)} Z${fmt(2)}`)
    lines.push(`G01 Z-${fmt(L)} F80`)
    lines.push(`G01 X${fmt(d)} F40`)
    lines.push(`G01 Z-${fmt(L)} F40`)
    lines.push(`G00 X${fmt(Math.max(stock - 5, 1))} Z${fmt(5)}`)
    lines.push('M30')
    return lines.join('\n')
  }

  const steps =
    dims.type === 'step_shaft' && dims.steps?.length
      ? grindStepsOnly(dims.steps)
      : [{ d: dims.d, L: dims.L || dims.totalL, stock: dims.stock }]
  const ds = steps.map((s) => s.d).filter((d) => d != null)
  const clear = (ds.length ? Math.max(...ds) : 50) + 10
  lines.push(`G00 X${fmt(clear)} Z${fmt(5)}`)
  let z0 = 0
  for (const s of steps) {
    if (s.d == null || s.L == null) continue
    const z1 = z0 - s.L
    const stock = s.stock != null ? s.stock : s.d + 0.3
    const allow = fmtAllow(s.d, stock)
    lines.push(`(粗磨 φ${fmtSize(s.d)}${allow ? ` 余量 ${allow}` : ''} 接触 φ${fmt(stock)})`)
    lines.push(`G00 X${fmt(stock)} Z${fmt(z0)}`)
    lines.push(`G01 X${fmt(stock)} Z${fmt(z1)} F0.3`)
    lines.push(`G00 X${fmt(clear)}`)
    lines.push(`(精磨 φ${fmtSize(s.d)})`)
    lines.push(`G00 X${fmt(s.d)} Z${fmt(z0)}`)
    lines.push(`G01 X${fmt(s.d)} Z${fmt(z1)} F0.08`)
    lines.push(`G00 X${fmt(clear)}`)
    z0 = z1
  }
  lines.push(`G00 X${fmt(clear)} Z${fmt(5)}`)
  lines.push('M30')
  return lines.join('\n')
}

export function buildGrindNc(dims) {
  if (!dims) return ''
  const src = `${dims.machine || ''} ${dims.control || ''}`
  const withD = dims.dialect ? dims : withDialect(dims, src)
  return buildByDialect(withD, buildIsoGrindNc)
}

const NC_FENCE = /```(?:gcode|nc|cnc|fanuc|mpf|siemens|iso|num)\s*\r?\n([\s\S]*?)```/i

function extractNcFence(text) {
  const src = String(text || '')
  const tagged = src.match(NC_FENCE)
  if (tagged) return { full: tagged[0], nc: tagged[1], index: tagged.index }
  const re = /```[ \t]*\r?\n([\s\S]*?)```/g
  let m
  while ((m = re.exec(src))) {
    const body = m[1] || ''
    if (/\b(G0*[01]|G21|G90|M30|O\d+)\b/i.test(body) && !/<svg[\s>]/i.test(body)) {
      return { full: m[0], nc: body, index: m.index }
    }
  }
  return null
}

export function repairAssistantGrindGcode(content, dims, { force = false, userText = '' } = {}) {
  if (!dims) return { content, repaired: false, issues: [] }
  const text = String(content || '')
  if (isReadCodeTask(userText)) {
    return { content: text, repaired: false, issues: [], skipped: 'read-code' }
  }
  if (/<svg[\s\S]*<\/svg>/i.test(text) && !wantsGrindProgram(userText) && !force) {
    return { content: text, repaired: false, issues: [], skipped: 'svg' }
  }

  const dims2 = withDialect(dims, `${userText}\n${dims.machine || ''}\n${dims.control || ''}`)
  const dialect = dims2.dialect
  const fence = extractNcFence(text)
  const nc = fence ? fence.nc : ''
  if (nc && OEM_CYCLE.test(nc) && dialect === 'iso_generic') {
    return { content: text, repaired: false, issues: [], skipped: 'oem-cycle' }
  }
  if (!nc && !force) return { content: text, repaired: false, issues: [] }

  const check = nc ? validateGrindNc(dims2, nc) : { ok: false, issues: ['未写出程序'] }
  if (check.ok) return { content: text, repaired: false, issues: [] }

  if (usesIsoDiameter(dialect) && dims2.type === 'dress' && /修整|金刚/.test(text) && nc) {
    return { content: text, repaired: false, issues: check.issues, skipped: 'dress-keep' }
  }

  const built = buildGrindNc(dims2)
  const info = dialectInfo(dialect)
  const note = `【系统已按 ${info.label} 重写】原稿问题：${check.issues.join('；') || '与本机体系/尺寸不符'}。${dialectHardRules(dialect)}`
  const block = `${note}\n\n\`\`\`gcode\n${built}\n\`\`\``
  const next = fence ? text.replace(fence.full, block) : `${text.trim()}\n\n${block}`
  return { content: next, repaired: true, issues: check.issues, nc: built, dialect }
}

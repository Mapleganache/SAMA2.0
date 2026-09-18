import type {
  Bounds,
  GCodeIssue,
  GCodeParseResult,
  GCodePoint,
  MachineLimits,
  MotionType,
  ProgramKind,
  ToolpathSegment,
} from './types'
import { DEFAULT_LIMITS } from './types'

type WordMap = Record<string, number>
type ViewPlane = 'XY' | 'XZ' | 'YZ'

const MOTION_G = new Set([0, 1, 2, 3])
const DRILL_CYCLE_G = new Set([73, 74, 81, 82, 83, 84, 85, 86, 87, 88, 89])
const GRIND_CYCLE_G = new Set([75, 77, 78, 79])

function stripComments(line: string): string {
  let s = line.replace(/\([^)]*\)/g, ' ')
  const semi = s.indexOf(';')
  if (semi >= 0) s = s.slice(0, semi)
  return s.trim()
}

/**
 * 屏蔽 Fanuc Macro B / 参数写入表达式，避免把
 * IF/GOTO、N6933R[#5022*10000]、#赋值 拆成「R[」「*10000]」误报。
 */
function maskFanucMacroB(line: string): { masked: string; hadMacro: boolean } {
  let hadMacro = false
  let s = line
  const mask = (re: RegExp) => {
    s = s.replace(re, (m) => {
      hadMacro = true
      return ' '.repeat(m.length)
    })
  }
  mask(/IF\s*\[[^\]]*\]\s*(?:GOTO\s*\d+|THEN\b)?/gi)
  mask(/\bGOTO\s*\d+/gi)
  mask(/\bWHILE\s*\[[^\]]*\]\s*DO\d*/gi)
  mask(/\bEND\d*\b/gi)
  mask(/\bDO\d+\b/gi)
  mask(/\bG0*10(?!\d)[\s\S]*/gi)
  mask(/\bG0*11(?!\d)/gi)
  mask(/N\s*\d+\s*R\s*\[[^\]]*\]/gi)
  mask(/\[[^\]]*\]/g)
  mask(/#\d+(?:\.\d+)?\s*=\s*[^GMXYZFSIJKABC]*(?=(?:\s*[GMXYZFSIJKABC]\s*[+-]?\d)|\s*$)/gi)
  mask(/#\d+(?:\.\d+)?/g)
  mask(/[*\/]=?/g)
  return { masked: s, hadMacro }
}

function isFalseAddressMatch(raw: string, index: number, letter: string): boolean {
  const before = raw.slice(Math.max(0, index - 3), index).toUpperCase()
  const L = letter.toUpperCase()
  if (L === 'O' && /GOT$/i.test(before)) return true
  if (L === 'E' && /(N|G|L)$/i.test(before)) return true
  if (L === 'T' && /[GL]$/i.test(before)) return true
  if (L === 'Q' && /E$/i.test(before)) return true
  return false
}

function parseWords(raw: string): { words: WordMap; badTokens: string[] } {
  const words: WordMap = {}
  const badTokens: string[] = []
  const re = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)/g
  let m: RegExpExecArray | null
  const consumed = new Set<number>()
  while ((m = re.exec(raw)) !== null) {
    const letter = m[1].toUpperCase()
    if (isFalseAddressMatch(raw, m.index, letter)) continue
    const value = Number(m[2])
    if (!Number.isFinite(value)) {
      badTokens.push(m[0])
      continue
    }
    words[letter] = value
    for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i)
  }
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (/\s/.test(ch) || consumed.has(i)) continue
    if (ch === '%' || ch === '/') continue
    let j = i
    while (j < raw.length && !/\s/.test(raw[j]) && !consumed.has(j)) j++
    const tok = raw.slice(i, j)
    if (tok && !/^[Oo]\d+$/.test(tok)) badTokens.push(tok)
    i = j - 1
  }
  return { words, badTokens: [...new Set(badTokens)] }
}

function collectGCodes(raw: string): number[] {
  const out: number[] = []
  // 不能用 \b：G90G53G01 里后一个 G 前面是数字，\b 会漏掉 G53/G01
  const re = /G0*(\d+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    out.push(Number(m[1]))
  }
  return out
}

function dist(a: GCodePoint, b: GCodePoint, diameter = false): number {
  const dx = diameter ? (b.x - a.x) / 2 : b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.hypot(dx, dy, dz)
}

function emptyBounds(): Bounds {
  return {
    xMin: Infinity,
    xMax: -Infinity,
    yMin: Infinity,
    yMax: -Infinity,
    zMin: Infinity,
    zMax: -Infinity,
  }
}

function expandBounds(b: Bounds, p: GCodePoint) {
  b.xMin = Math.min(b.xMin, p.x)
  b.xMax = Math.max(b.xMax, p.x)
  b.yMin = Math.min(b.yMin, p.y)
  b.yMax = Math.max(b.yMax, p.y)
  b.zMin = Math.min(b.zMin, p.z)
  b.zMax = Math.max(b.zMax, p.z)
}

function resolveTarget(pos: GCodePoint, words: WordMap, absolute: boolean): GCodePoint {
  const axis = (letter: 'X' | 'Y' | 'Z', cur: number) => {
    if (!(letter in words)) return cur
    return absolute ? words[letter] : cur + words[letter]
  }
  let x = axis('X', pos.x)
  let y = axis('Y', pos.y)
  let z = axis('Z', pos.z)
  // 车/磨：U/V/W 永远是增量（U 与 X 同单位，直径编程下 U1 = 直径 +1）
  if ('U' in words) x += words.U
  if ('V' in words) y += words.V
  if ('W' in words) z += words.W
  return { x, y, z }
}

function toGeom(p: GCodePoint, diameter: boolean): GCodePoint {
  return diameter ? { x: p.x / 2, y: p.y, z: p.z } : { ...p }
}

function fromGeom(p: GCodePoint, diameter: boolean): GCodePoint {
  return diameter ? { x: p.x * 2, y: p.y, z: p.z } : { ...p }
}

function approxArc(
  from: GCodePoint,
  to: GCodePoint,
  words: WordMap,
  plane: ViewPlane,
  cw: boolean,
  diameter: boolean,
): { points: GCodePoint[]; error?: string } {
  const getAxes = () => {
    if (plane === 'XY') return { a: 'x' as const, b: 'y' as const, ia: 'I', ib: 'J' }
    if (plane === 'XZ') return { a: 'x' as const, b: 'z' as const, ia: 'I', ib: 'K' }
    return { a: 'y' as const, b: 'z' as const, ia: 'J', ib: 'K' }
  }
  const { a, b, ia, ib } = getAxes()
  const gFrom = toGeom(from, diameter)
  const gTo = toGeom(to, diameter)
  const fa = gFrom[a]
  const fb = gFrom[b]
  const ta = gTo[a]
  const tb = gTo[b]

  let cx: number
  let cy: number
  let radius: number

  if (ia in words || ib in words) {
    cx = fa + (words[ia] ?? 0)
    cy = fb + (words[ib] ?? 0)
    radius = Math.hypot(fa - cx, fb - cy)
  } else if ('R' in words) {
    const r = Math.abs(words.R)
    const dx = ta - fa
    const dy = tb - fb
    const chord = Math.hypot(dx, dy)
    if (chord < 1e-9) {
      return { points: [from, to] }
    }
    if (chord > 2 * r + 1e-4) {
      return {
        points: [from, to],
        error: `圆弧弦长 ${chord.toFixed(3)} 大于 2R=${(2 * r).toFixed(3)}，无法构成圆弧`,
      }
    }
    const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2))
    const mx = (fa + ta) / 2
    const my = (fb + tb) / 2
    const nx = -dy / chord
    const ny = dx / chord
    const sign = (words.R >= 0 ? 1 : -1) * (cw ? 1 : -1)
    cx = mx + sign * h * nx
    cy = my + sign * h * ny
    radius = r
  } else {
    return { points: [from, to] }
  }

  if (radius < 1e-9) return { points: [from, to] }

  let a0 = Math.atan2(fb - cy, fa - cx)
  let a1 = Math.atan2(tb - cy, ta - cx)
  if (cw) {
    while (a1 >= a0) a1 -= Math.PI * 2
  } else {
    while (a1 <= a0) a1 += Math.PI * 2
  }
  const sweep = a1 - a0
  const steps = Math.max(8, Math.min(72, Math.ceil(Math.abs(sweep) / (Math.PI / 24))))
  const points: GCodePoint[] = [from]
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const ang = a0 + sweep * t
    const pa = cx + radius * Math.cos(ang)
    const pb = cy + radius * Math.sin(ang)
    const g: GCodePoint = {
      x: gFrom.x + (gTo.x - gFrom.x) * t,
      y: gFrom.y + (gTo.y - gFrom.y) * t,
      z: gFrom.z + (gTo.z - gFrom.z) * t,
    }
    g[a] = pa
    g[b] = pb
    points.push(i === steps ? to : fromGeom(g, diameter))
  }
  return { points }
}

function checkLimits(p: GCodePoint, line: number, limits: MachineLimits, issues: GCodeIssue[]) {
  const checks: [keyof GCodePoint, number, number, string][] = [
    ['x', limits.xMin, limits.xMax, 'X'],
    ['y', limits.yMin, limits.yMax, 'Y'],
    ['z', limits.zMin, limits.zMax, 'Z'],
  ]
  for (const [axis, min, max, name] of checks) {
    const v = p[axis]
    if (v < min || v > max) {
      issues.push({
        level: 'warn',
        line,
        message: `${name}=${v.toFixed(3)} 超出当前行程 [${min}, ${max}]（可在「行程设置」按本机改）`,
      })
    }
  }
}

const GRIND_HINT =
  /磨床|外圆磨|内圆磨|无心|砂轮|磨削|精磨|粗磨|通磨|切入磨|STUDER|MIKROSA|KRONOS|直径编程|工件直径|favoritCNC|GRINDING|\bGWD\b|\bGW\s+(?:PRESET|DRESS)\b|\bCOMP\.|\bALL HOME\b/i
const LATHE_HINT = /车削|车床|LATHE|G0*71\b|G0*70\b|G0*76\b|G0*72\b|G0*73\b/i
const DIAMETER_HINT = /直径编程|工件直径/i
const OD_GRIND_HINT = /STUDER|favoritCNC/i
const CENTERLESS_HINT = /无心|通磨|\bGW\s|\bGWD\b|GRINDING|MIKROSA|SASL|KRONOS/i

export function detectProgramStyle(source: string): {
  kind: ProgramKind
  plane: ViewPlane
  diameter: boolean
} {
  const head = String(source || '').slice(0, 8000)
  const hasG17 = /G0*17(?!\d)/i.test(head)
  const hasG18 = /G0*18(?!\d)/i.test(head)
  const hasY = /Y\s*[+-]?(?:\d+\.?\d*|\.\d+)/i.test(head)
  const hasX = /X\s*[+-]?(?:\d+\.?\d*|\.\d+)/i.test(head)
  const hasZ = /Z\s*[+-]?(?:\d+\.?\d*|\.\d+)/i.test(head)
  const grind = GRIND_HINT.test(head)
  const lathe = LATHE_HINT.test(head)
  const diameter =
    DIAMETER_HINT.test(head) ||
    (OD_GRIND_HINT.test(head) && !CENTERLESS_HINT.test(head)) ||
    (!grind && (hasG18 || lathe) && !hasY)

  if (grind) {
    const yInfeed = hasY && !hasZ
    return { kind: 'grind', plane: yInfeed ? 'XY' : 'XZ', diameter }
  }
  if (hasG17 && hasY) return { kind: 'mill', plane: 'XY', diameter: false }
  if (hasY && !hasG18 && !lathe) return { kind: 'mill', plane: 'XY', diameter: false }
  if (hasG18 || lathe || (!hasY && hasX && hasZ && !hasG17)) {
    return { kind: 'lathe', plane: 'XZ', diameter: true }
  }
  return { kind: 'mill', plane: 'XY', diameter: false }
}

/** MIKROSA / Fanuc 修整数据：#640.. X 与 #680.. Z 成对，即砂轮廓形 */
export function extractDressProfile(source: string): GCodePoint[] {
  const xs = new Map<number, number>()
  const zs = new Map<number, number>()
  for (const line of String(source || '').split(/\r?\n/)) {
    const m = line.match(/#(\d+)\s*=\s*([+-]?\d+(?:\.\d+)?)/)
    if (!m) continue
    const n = Number(m[1])
    const v = Number(m[2])
    if (n >= 640 && n <= 679) xs.set(n, v)
    else if (n >= 680 && n <= 719) zs.set(n, v)
  }
  const pts: GCodePoint[] = []
  for (let i = 0; i < 40; i++) {
    const x = xs.get(640 + i)
    const z = zs.get(680 + i)
    if (x == null || z == null) {
      if (pts.length) break
      continue
    }
    pts.push({ x, y: 0, z })
  }
  return pts.length >= 3 ? pts : []
}

type CycleState = {
  code: number
  z: number
  r: number
  q: number
}

function hasMoveWord(words: WordMap): boolean {
  return 'X' in words || 'Y' in words || 'Z' in words || 'U' in words || 'V' in words || 'W' in words
}

/**
 * 解析 G 代码，生成 2D/3D 刀路折线与校验问题。
 */
export function parseGcode(
  source: string,
  limits: MachineLimits = DEFAULT_LIMITS,
): GCodeParseResult {
  const issues: GCodeIssue[] = []
  const segments: ToolpathSegment[] = []
  const bounds = emptyBounds()
  const usedAxes = { x: false, y: false, z: false }
  const style = detectProgramStyle(source)
  let kind = style.kind
  let pos: GCodePoint = { x: 0, y: 0, z: 0 }
  let located = false
  let motion = 0
  let absolute = true
  let units: 'mm' | 'inch' = 'mm'
  let plane: ViewPlane = style.plane
  const diameter = style.diameter
  let feed: number | undefined
  let pathLength = 0
  let rapidCount = 0
  let feedCount = 0
  let arcCount = 0
  let cycle: CycleState | null = null
  let retractMode: 98 | 99 = 98
  let initialZ = 0

  const pushSeg = (
    type: MotionType,
    from: GCodePoint,
    to: GCodePoint,
    points: GCodePoint[],
    line: number,
  ) => {
    if (!located) {
      pos = { ...to }
      located = true
      expandBounds(bounds, pos)
      return
    }
    if (dist(from, to, diameter) < 1e-9 && points.length <= 2 && type !== 'arc_cw' && type !== 'arc_ccw') {
      pos = { ...to }
      return
    }
    checkLimits(to, line, limits, issues)
    for (const p of points) expandBounds(bounds, p)
    pathLength +=
      type === 'arc_cw' || type === 'arc_ccw'
        ? points.reduce((acc, p, i) => (i === 0 ? acc : acc + dist(points[i - 1], p, diameter)), 0)
        : dist(from, to, diameter)
    if (type === 'rapid') rapidCount++
    else if (type === 'feed') feedCount++
    else arcCount++
    segments.push({ type, from: { ...from }, to: { ...to }, points, line, feed })
    pos = { ...to }
  }

  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const cleaned = stripComments(lines[i])
    if (!cleaned || cleaned === '%') continue
    if (cleaned.startsWith('/')) continue

    if (/^[Oo]\d+/.test(cleaned) && !/[A-Za-z]\s*[+-]?\d/.test(cleaned.slice(1))) {
      continue
    }

    const { masked, hadMacro } = maskFanucMacroB(cleaned)
    const src = hadMacro ? masked : cleaned
    const { words } = parseWords(src)
    const gCodes = collectGCodes(src)

    for (const g of gCodes) {
      if (MOTION_G.has(g)) motion = g
      else if (g === 17) plane = 'XY'
      else if (g === 18) plane = 'XZ'
      else if (g === 19) plane = 'YZ'
      else if (g === 20) units = 'inch'
      else if (g === 21) units = 'mm'
      else if (g === 90) absolute = true
      else if (g === 91) absolute = false
      else if (g === 98) retractMode = 98
      else if (g === 99) retractMode = 99
      else if (g === 80) cycle = null
    }

    if ('F' in words) {
      feed = words.F
      if (feed <= 0) {
        issues.push({ level: 'error', line: lineNo, message: `进给 F=${feed} 无效` })
      }
    }
    if ('S' in words) {
      const spindle = words.S
      if (spindle < 0) {
        issues.push({ level: 'error', line: lineNo, message: `转速 S=${spindle} 无效` })
      }
    }

    if (gCodes.includes(4)) {
      // Fanuc G04 X/P/U 是暂停时间，不是轴运动
      continue
    }

    if ('X' in words || 'U' in words) usedAxes.x = true
    if ('Y' in words || 'V' in words) usedAxes.y = true
    if ('Z' in words || 'W' in words) usedAxes.z = true

    if (gCodes.includes(28) || gCodes.includes(30)) {
      const to: GCodePoint = { ...pos }
      const anyAxis = hasMoveWord(words)
      if ('X' in words || 'U' in words) to.x = resolveTarget(pos, words, absolute).x
      else if (!anyAxis) to.x = 0
      if ('Y' in words || 'V' in words) to.y = resolveTarget(pos, words, absolute).y
      else if (!anyAxis) to.y = 0
      if ('Z' in words || 'W' in words) to.z = resolveTarget(pos, words, absolute).z
      else if (!anyAxis) to.z = 0
      pushSeg('rapid', pos, to, [{ ...pos }, to], lineNo)
      continue
    }

    const drillG = gCodes.find((g) => DRILL_CYCLE_G.has(g))
    if (drillG != null) {
      initialZ = pos.z
      cycle = {
        code: drillG,
        z: 'Z' in words ? (absolute ? words.Z : pos.z + words.Z) : pos.z,
        r: 'R' in words ? words.R : pos.z,
        q: 'Q' in words ? Math.abs(words.Q) : 5,
      }
    }

    const grindG = gCodes.find((g) => GRIND_CYCLE_G.has(g))
    if (grindG != null && style.kind === 'grind') {
      const to = resolveTarget(pos, words, absolute)
      if (!located) {
        pos = { ...to }
        located = true
        expandBounds(bounds, pos)
        continue
      }
      pushSeg('feed', pos, to, [{ ...pos }, { ...to }], lineNo)
      continue
    }

    if (cycle && (hasMoveWord(words) || drillG != null)) {
      const to = resolveTarget(pos, words, absolute)
      if ('Z' in words && drillG != null) {
        cycle = { ...cycle, z: to.z }
        to.z = pos.z
      }
      if ('R' in words) cycle = { ...cycle, r: words.R }
      if ('Q' in words) cycle = { ...cycle, q: Math.abs(words.Q) }

      const rPlane = cycle.r
      const zBottom = cycle.z
      const retractZ = retractMode === 98 ? Math.max(initialZ, rPlane) : rPlane
      const xy: GCodePoint = { x: to.x, y: to.y, z: pos.z }

      if (!located) {
        pos = { x: to.x, y: to.y, z: Math.max(pos.z, rPlane, retractZ) }
        located = true
        expandBounds(bounds, pos)
      }

      if (dist(pos, xy, diameter) > 1e-9) {
        pushSeg('rapid', pos, xy, [{ ...pos }, { ...xy }], lineNo)
      }
      const atR: GCodePoint = { x: to.x, y: to.y, z: rPlane }
      if (dist(pos, atR, diameter) > 1e-9) {
        pushSeg('rapid', pos, atR, [{ ...pos }, { ...atR }], lineNo)
      }

      if ((cycle.code === 83 || cycle.code === 73) && cycle.q > 1e-6 && zBottom < rPlane - 1e-6) {
        let depth = rPlane
        let guard = 0
        while (depth > zBottom + 1e-6 && guard++ < 400) {
          const nextZ = Math.max(zBottom, depth - cycle.q)
          const fromP: GCodePoint = { x: to.x, y: to.y, z: depth }
          const toP: GCodePoint = { x: to.x, y: to.y, z: nextZ }
          pushSeg('feed', fromP, toP, [{ ...fromP }, { ...toP }], lineNo)
          if (nextZ <= zBottom + 1e-9) break
          pushSeg('rapid', toP, atR, [{ ...toP }, { ...atR }], lineNo)
          depth = nextZ
        }
      } else {
        const bot: GCodePoint = { x: to.x, y: to.y, z: zBottom }
        pushSeg('feed', pos, bot, [{ ...pos }, { ...bot }], lineNo)
      }

      const up: GCodePoint = { x: to.x, y: to.y, z: retractZ }
      if (dist(pos, up, diameter) > 1e-9) {
        pushSeg('rapid', pos, up, [{ ...pos }, { ...up }], lineNo)
      }
      continue
    }

    if (!hasMoveWord(words) && motion !== 2 && motion !== 3) continue
    if (
      !hasMoveWord(words) &&
      (motion === 2 || motion === 3) &&
      !('I' in words || 'J' in words || 'K' in words || 'R' in words)
    ) {
      continue
    }

    const to = resolveTarget(pos, words, absolute)

    if (motion === 2 || motion === 3) {
      const type: MotionType = motion === 2 ? 'arc_cw' : 'arc_ccw'
      if (!('R' in words) && !('I' in words || 'J' in words || 'K' in words)) {
        issues.push({
          level: 'error',
          line: lineNo,
          message: `G0${motion} 缺少 R 或 I/J/K 圆心参数`,
        })
      }
      const arc = approxArc(located ? pos : to, to, words, plane, motion === 2, diameter)
      if (arc.error) {
        issues.push({ level: 'error', line: lineNo, message: arc.error })
      }
      pushSeg(type, located ? pos : to, to, located ? arc.points : [to], lineNo)
    } else {
      const type: MotionType = motion === 0 ? 'rapid' : 'feed'
      pushSeg(type, pos, to, [{ ...pos }, { ...to }], lineNo)
    }
  }

  if (segments.length === 0) {
    const profile = extractDressProfile(source)
    if (profile.length) {
      kind = 'grind'
      usedAxes.x = true
      usedAxes.z = true
      plane = 'XZ'
      pos = { ...profile[0] }
      located = true
      expandBounds(bounds, pos)
      for (let i = 1; i < profile.length; i++) {
        pushSeg('feed', profile[i - 1], profile[i], [profile[i - 1], profile[i]], i + 1)
      }
    }
  }

  if (!Number.isFinite(bounds.xMin)) {
    bounds.xMin = bounds.xMax = bounds.yMin = bounds.yMax = bounds.zMin = bounds.zMax = 0
  }

  const seen = new Set<string>()
  const uniqueIssues = issues.filter((it) => {
    const key = `${it.level}|${it.line}|${it.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    segments,
    issues: uniqueIssues.sort((a, b) => {
      const rank = { error: 0, warn: 1, info: 2 }
      return rank[a.level] - rank[b.level] || a.line - b.line
    }),
    bounds,
    usedAxes,
    stats: {
      lineCount: lines.length,
      moveCount: segments.length,
      rapidCount,
      feedCount,
      arcCount,
      pathLength,
    },
    modal: { units, absolute, plane, diameter, kind },
  }
}

export function isGCodeFile(path: string): boolean {
  const base = String(path || '')
    .replace(/^.*[/\\]/, '')
    .trim()
  if (!base) return false
  if (/\.(nc|gcode|cnc|tap|ngc|mpf|spf|iso|prg|min)$/i.test(base)) return true
  if (/^O\d{1,8}$/i.test(base) || /^O\d{1,8}\./i.test(base)) return true
  if (/^_N_[A-Z0-9_]+_MPF$/i.test(base)) return true
  return false
}

/** 根据正文判断是否像 G 代码（兼容 G91G01 无空格粘连） */
export function looksLikeGcode(content: string): boolean {
  const head = String(content || '').slice(0, 2500)
  if (!head.trim()) return false
  return (
    /^[%\s]*O\d+/im.test(head) ||
    /G0*[0-3](?!\d)/i.test(head) ||
    /\bM0*30\b/i.test(head) ||
    /\bM0*2\b/i.test(head) ||
    /\bM0*99\b/i.test(head)
  )
}

export function suggestViewPlane(
  used: { x: boolean; y: boolean; z: boolean },
  kind?: ProgramKind,
): ViewPlane {
  if (kind === 'grind' || kind === 'lathe') return 'XZ'
  if (used.y && used.x) return 'XY'
  if (used.x && used.z) return 'XZ'
  if (used.y && used.z) return 'YZ'
  if (used.x && used.z === false && used.y === false) return 'XZ'
  if (used.x) return 'XZ'
  return 'XY'
}

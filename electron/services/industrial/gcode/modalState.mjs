/**
 * Modal State — FANUC 模态（V1.1 增强）
 */

export function createModalState(seed = {}) {
  return {
    motion: seed.motion || null, // G00–G03
    cycle: seed.cycle || null, // G81–G84 or null / G80 cancelled
    plane: seed.plane || 'G17',
    units: seed.units || null,
    distance: seed.distance || null,
    feed: seed.feed ?? null,
    feedMode: seed.feedMode || null, // G94 G95
    spindle: seed.spindle ?? null,
    spindleDir: seed.spindleDir || null,
    coordinateSystem: seed.coordinateSystem || null,
    tool: seed.tool || null,
    coolant: seed.coolant || null,
    cutterComp: seed.cutterComp || 'G40', // G40 G41 G42
    toolLength: seed.toolLength || 'G49', // G43 G49
    lengthOffset: seed.lengthOffset ?? null, // H
    radiusOffset: seed.radiusOffset ?? null, // D
    retractMode: seed.retractMode || 'G98', // G98 G99
    x: seed.x ?? null,
    y: seed.y ?? null,
    z: seed.z ?? null,
    r: seed.r ?? null, // cycle R plane
    q: seed.q ?? null, // peck Q
    /** 子程序栈（M98/M99 语义跟踪，轻量） */
    subStack: Array.isArray(seed.subStack) ? [...seed.subStack] : [],
  }
}

export function cloneModal(m) {
  const c = createModalState(m || {})
  c.subStack = [...(m?.subStack || [])]
  return c
}

const CYCLE_G = new Set([81, 82, 83, 84, 85, 86])

/**
 * @param {object} modal
 * @param {object} line - { gCodes, mCodes, words }
 */
export function applyLineToModal(modal, line) {
  const next = cloneModal(modal)
  const gs = line.gCodes || []
  const ms = line.mCodes || []
  const w = line.words || {}

  for (const g of gs) {
    if (g === 0 || g === 1 || g === 2 || g === 3) {
      next.motion = `G${String(g).padStart(2, '0')}`
      // motion cancels fixed cycle on many controls when G00-03 issued — keep cycle until G80 for FANUC-like
    }
    if (g === 17 || g === 18 || g === 19) next.plane = `G${g}`
    if (g === 20 || g === 21) next.units = `G${g}`
    if (g === 90 || g === 91) next.distance = `G${g}`
    if (g === 94 || g === 95) next.feedMode = `G${g}`
    if (g >= 54 && g <= 59) next.coordinateSystem = `G${g}`
    if (g === 40 || g === 41 || g === 42) next.cutterComp = `G${g}`
    if (g === 43) next.toolLength = 'G43'
    if (g === 49) {
      next.toolLength = 'G49'
      next.lengthOffset = null
    }
    if (g === 98 || g === 99) next.retractMode = `G${g}`
    if (g === 80) next.cycle = null
    if (CYCLE_G.has(g)) next.cycle = `G${g}`
  }

  for (const m of ms) {
    if (m === 3) next.spindleDir = 'M03'
    if (m === 4) next.spindleDir = 'M04'
    if (m === 5) next.spindleDir = 'M05'
    if (m === 8) next.coolant = 'M08'
    if (m === 9) next.coolant = 'M09'
    if (m === 6 && w.T != null) next.tool = `T${String(Math.trunc(w.T)).padStart(2, '0')}`
    if (m === 98) {
      next.subStack.push({ p: w.P ?? null, l: w.L ?? 1 })
    }
    if (m === 99) {
      next.subStack.pop()
    }
  }

  if (w.F != null) next.feed = Number(w.F)
  if (w.S != null) next.spindle = Number(w.S)
  if (w.T != null) next.tool = `T${String(Math.trunc(w.T)).padStart(2, '0')}`
  if (w.H != null) next.lengthOffset = Number(w.H)
  if (w.D != null) next.radiusOffset = Number(w.D)
  if (w.R != null) next.r = Number(w.R)
  if (w.Q != null) next.q = Number(w.Q)

  const abs = next.distance !== 'G91'
  for (const axis of ['X', 'Y', 'Z']) {
    if (w[axis] == null) continue
    const key = axis.toLowerCase()
    const v = Number(w[axis])
    if (abs) next[key] = v
    else next[key] = (next[key] ?? 0) + v
  }
  return next
}

export function describeModal(modal) {
  const m = modal || createModalState()
  return {
    motion: m.motion,
    cycle: m.cycle,
    plane: m.plane,
    units: m.units,
    distance: m.distance,
    wcs: m.coordinateSystem,
    cutterComp: m.cutterComp,
    toolLength: m.toolLength,
    H: m.lengthOffset,
    D: m.radiusOffset,
    retract: m.retractMode,
    tool: m.tool,
    feed: m.feed,
    spindle: m.spindle,
    spindleDir: m.spindleDir,
    pos: { x: m.x, y: m.y, z: m.z },
    subDepth: m.subStack?.length || 0,
  }
}

/**
 * 将 GCodeIR.operations 展开为 blocks（结构化刀轨，再交给 Post）
 */
import { createEmptyGCodeIr, validateGCodeIr } from './gcodeIr.mjs'

function fmtN(n) {
  return Math.round(Number(n) * 1000) / 1000
}

function toolWord(n) {
  return `T${String(n || 1).padStart(2, '0')}`
}

/**
 * @returns {object} GCodeIR with blocks filled
 */
export function expandGCodeIr(ir) {
  const v = validateGCodeIr(ir)
  if (!v.ok) {
    const err = new Error('GCodeIR 无效')
    err.code = 'GCODE_IR_INVALID'
    err.errors = v.errors
    throw err
  }

  const blocks = []
  const push = (b) => blocks.push(b)

  push({ type: 'comment', text: 'SAMA GCODE V1.1' })
  push({ type: 'units', code: ir.program.units === 'inch' ? 'G20' : 'G21' })
  push({
    type: 'modal',
    codes: ['G90', ir.program.workOffset || 'G54', ir.program.plane || 'G17', 'G40', 'G49', 'G80', 'G98'],
  })

  let lastTool = null
  for (const op of ir.operations || []) {
    const tool = toolWord(op.tool)
    const safeZ = Number(op.safeZ ?? 50)
    const feed = Number(op.feed) || 300
    const spindle = Number(op.spindle) || 2000
    const depth = Number(op.depth)
    const zCut = Number.isFinite(depth) ? (depth <= 0 ? depth : -Math.abs(depth)) : -5

    push({ type: 'comment', text: `${op.type} tool=${tool}` })
    if (tool !== lastTool) {
      push({ type: 'toolchange', tool, m06: true })
      lastTool = tool
    }
    push({ type: 'spindle', rpm: spindle, dir: 'M03' })
    if (op.coolant !== false) push({ type: 'coolant', code: 'M08' })

    // 刀长补偿
    const h = op.lengthOffset ?? op.h
    if (h != null) push({ type: 'toolLength', code: 'G43', h: Number(h), z: safeZ })
    else push({ type: 'rapid', x: null, y: null, z: safeZ })

    // 刀补（轮廓可选）
    if (op.cutterComp === 'G41' || op.cutterComp === 'G42') {
      push({
        type: 'cutterComp',
        code: op.cutterComp,
        d: op.radiusOffset ?? op.d ?? (Number(op.tool) || 1),
      })
    }

    if (Array.isArray(op.moves) && op.moves.length) {
      for (const m of op.moves) {
        if (m.type === 'rapid') push({ type: 'rapid', x: m.x, y: m.y, z: m.z })
        else push({ type: 'feed', x: m.x, y: m.y, z: m.z, feed: m.feed || feed })
      }
    } else if (op.type === 'peck_drill' || op.cycle === 'G83') {
      expandPeckCycle(op, push, { safeZ, feed, zCut })
    } else if (op.type === 'drill_cycle' || op.cycle === 'G81') {
      expandDrillCycle(op, push, { safeZ, feed, zCut, cycle: 'G81' })
    } else if (op.type === 'tap' || op.cycle === 'G84') {
      expandDrillCycle(op, push, { safeZ, feed, zCut, cycle: 'G84' })
    } else if (op.type === 'facing') {
      expandFacing(op, push, { safeZ, feed, zCut })
    } else if (op.type === 'drill') {
      expandDrill(op, push, { safeZ, feed, zCut })
    } else if (op.type === 'circular_profile') {
      expandCircle(op, push, { safeZ, feed, zCut })
    } else {
      expandRectProfile(op, push, { safeZ, feed, zCut })
    }

    if (op.cutterComp === 'G41' || op.cutterComp === 'G42') {
      push({ type: 'cutterComp', code: 'G40' })
    }
    push({ type: 'cycleCancel', code: 'G80' })
    push({ type: 'toolLength', code: 'G49' })
    push({ type: 'coolant', code: 'M09' })
    push({ type: 'rapid', x: null, y: null, z: safeZ })
    push({ type: 'spindle', rpm: 0, dir: 'M05' })
  }

  push({ type: 'rapid', x: null, y: null, z: 50 })
  push({ type: 'end', code: 'M30' })

  return {
    ...createEmptyGCodeIr(ir),
    blocks,
    meta: { ...(ir.meta || {}), expanded: true, version: '1.1' },
  }
}

function expandPeckCycle(op, push, { safeZ, feed, zCut }) {
  const g = op.geometry || {}
  const x = fmtN(g.x ?? 0)
  const y = fmtN(g.y ?? 0)
  const r = Number(op.rPlane ?? 2)
  const q = Number(op.peck ?? 5)
  const retract = op.retractMode || 'G98'
  push({ type: 'rapid', x, y, z: safeZ })
  push({
    type: 'cycle',
    cycle: 'G83',
    retract,
    x,
    y,
    z: zCut,
    r,
    q,
    feed,
  })
  push({ type: 'cycleCancel', code: 'G80' })
}

function expandDrillCycle(op, push, { safeZ, feed, zCut, cycle }) {
  const g = op.geometry || {}
  const x = fmtN(g.x ?? 0)
  const y = fmtN(g.y ?? 0)
  const r = Number(op.rPlane ?? 2)
  const retract = op.retractMode || 'G98'
  push({ type: 'rapid', x, y, z: safeZ })
  push({
    type: 'cycle',
    cycle,
    retract,
    x,
    y,
    z: zCut,
    r,
    feed,
  })
  push({ type: 'cycleCancel', code: 'G80' })
}

function expandRectProfile(op, push, { safeZ, feed, zCut }) {
  const g = op.geometry || {}
  const w = Number(g.width) || 100
  const h = Number(g.height) || 50
  const ox = Number(g.originX) || 0
  const oy = Number(g.originY) || 0
  const x0 = fmtN(ox)
  const y0 = fmtN(oy)
  const x1 = fmtN(ox + w)
  const y1 = fmtN(oy + h)

  push({ type: 'rapid', x: x0, y: y0, z: safeZ })
  push({ type: 'feed', x: x0, y: y0, z: zCut, feed })
  push({ type: 'feed', x: x1, y: y0, z: zCut, feed })
  push({ type: 'feed', x: x1, y: y1, z: zCut, feed })
  push({ type: 'feed', x: x0, y: y1, z: zCut, feed })
  push({ type: 'feed', x: x0, y: y0, z: zCut, feed })
}

function expandFacing(op, push, { safeZ, feed, zCut }) {
  const g = op.geometry || {}
  const w = Number(g.width) || 100
  const h = Number(g.height) || 50
  const step = Number(g.stepover) || 8
  push({ type: 'rapid', x: 0, y: 0, z: safeZ })
  push({ type: 'feed', x: 0, y: 0, z: zCut, feed })
  let y = 0
  let dir = 1
  while (y <= h + 1e-6) {
    const xTarget = dir > 0 ? w : 0
    push({ type: 'feed', x: fmtN(xTarget), y: fmtN(y), z: zCut, feed })
    y += step
    if (y > h) break
    push({ type: 'feed', x: fmtN(xTarget), y: fmtN(Math.min(y, h)), z: zCut, feed })
    dir *= -1
  }
}

function expandDrill(op, push, { safeZ, feed, zCut }) {
  const g = op.geometry || {}
  const x = fmtN(g.x ?? 0)
  const y = fmtN(g.y ?? 0)
  push({ type: 'rapid', x, y, z: safeZ })
  push({ type: 'feed', x, y, z: zCut, feed })
  push({ type: 'rapid', x, y, z: safeZ })
}

function expandCircle(op, push, { safeZ, feed, zCut }) {
  const g = op.geometry || {}
  const cx = Number(g.cx) || 0
  const cy = Number(g.cy) || 0
  const r = Number(g.radius) || 20
  const x0 = fmtN(cx + r)
  const y0 = fmtN(cy)
  push({ type: 'rapid', x: x0, y: y0, z: safeZ })
  push({ type: 'feed', x: x0, y: y0, z: zCut, feed })
  // full circle CW: G02 I-r
  push({ type: 'arc', dir: 'CW', x: x0, y: y0, z: zCut, i: -r, j: 0, feed })
}

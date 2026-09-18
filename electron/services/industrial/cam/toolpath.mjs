/**
 * CamIR → Toolpath IR（参数化 + 稀疏采样点，非百万刀位点）
 */
import { pickStrategy, selectTool, suggestParams, DEFAULT_TOOLS } from './tools.mjs'

function originOf(f) {
  const o = f.origin || f.position || [0, 0, 0]
  return {
    x: Number(o[0] || f.x || 0),
    y: Number(o[1] || f.y || 0),
    z: Number(o[2] || f.z || 0),
  }
}

/**
 * 生成高层刀路（操作列表）
 */
export function planCamOperations(ir, opts = {}) {
  const tools = Array.isArray(ir.tools) && ir.tools.length ? ir.tools : DEFAULT_TOOLS
  const material = opts.material || ir.meta?.material || 'aluminum'
  const stock = ir.stock
  const ops = []

  ;(ir.features || []).forEach((f, i) => {
    const strategy = pickStrategy(f)
    const tool = selectTool(f, tools)
    const params = suggestParams(f, tool, material)
    const o = originOf(f)
    const op = {
      id: `op_${i + 1}`,
      featureIndex: i,
      featureType: f.type,
      strategy,
      params,
      stock,
      geometry: { ...f, origin: o },
      moves: buildMoves(f, o, params, stock),
    }
    ops.push(op)
  })

  return {
    schemaVersion: 1,
    kind: 'toolpath.ir',
    units: ir.units || 'mm',
    stock,
    material,
    operations: ops,
    note: '参数化刀路；NC 由 Post 展开为有限行，非稠密刀位点云',
  }
}

function buildMoves(f, o, params, stock) {
  const safeZ = Math.max(Number(stock?.z || 0) + 5, o.z + 5, 5)
  const topZ = Number(stock?.z || 0)
  const t = String(f.type || '')
  const moves = [{ type: 'rapid', x: o.x, y: o.y, z: safeZ }]

  if (t === 'hole' || t === 'drill') {
    const depth = Number(f.depth) || Number(params.depthOfCut) || 10
    const zBottom = topZ - depth
    moves.push({ type: 'rapid', x: o.x, y: o.y, z: topZ + 2 })
    moves.push({ type: 'feed', x: o.x, y: o.y, z: zBottom, feed: params.feedMmMin })
    moves.push({ type: 'rapid', x: o.x, y: o.y, z: safeZ })
    return moves
  }

  if (t === 'face') {
    const w = Number(f.width || stock?.x || 50)
    const l = Number(f.length || f.height || stock?.y || 50)
    const z = topZ - Number(params.depthOfCut || 1)
    moves.push({ type: 'rapid', x: o.x, y: o.y, z: safeZ })
    moves.push({ type: 'rapid', x: o.x, y: o.y, z: z + 1 })
    // few passes along Y
    const step = Math.max(params.stepover || 10, 5)
    for (let y = o.y; y <= o.y + l + 1e-6; y += step) {
      moves.push({ type: 'feed', x: o.x, y, z, feed: params.feedMmMin })
      moves.push({ type: 'feed', x: o.x + w, y, z, feed: params.feedMmMin })
      moves.push({ type: 'rapid', x: o.x, y, z: z + 1 })
    }
    moves.push({ type: 'rapid', x: o.x, y: o.y, z: safeZ })
    return moves
  }

  if (t === 'pocket' || t === 'slot' || t === 'profile') {
    const w = Number(f.width || f.length || 30)
    const l = Number(f.length || f.width || 20)
    const depth = Number(f.depth) || Number(params.depthOfCut) || 5
    const z = topZ - Math.min(depth, params.depthOfCut || depth)
    const x0 = o.x
    const y0 = o.y
    moves.push({ type: 'rapid', x: x0, y: y0, z: safeZ })
    moves.push({ type: 'rapid', x: x0, y: y0, z: z + 1 })
    // rectangular contour (sparse)
    const pts = [
      [x0, y0],
      [x0 + w, y0],
      [x0 + w, y0 + l],
      [x0, y0 + l],
      [x0, y0],
    ]
    for (const [x, y] of pts) {
      moves.push({ type: 'feed', x, y, z, feed: params.feedMmMin })
    }
    moves.push({ type: 'rapid', x: x0, y: y0, z: safeZ })
    return moves
  }

  moves.push({ type: 'rapid', x: o.x, y: o.y, z: safeZ })
  return moves
}

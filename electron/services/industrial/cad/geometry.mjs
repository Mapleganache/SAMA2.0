/**
 * 从 CADIR 计算几何摘要（用于校验，不依赖 CAD 软件）
 */
export function summarizeCadGeometry(ir) {
  const features = Array.isArray(ir?.features) ? ir.features : []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let height = 0
  const holes = []
  const solids = []

  for (const f of features) {
    const t = String(f.type || '')
    if (t === 'box') {
      const w = Number(f.width)
      const d = Number(f.depth ?? f.length)
      const h = Number(f.height)
      const ox = Number(f.origin?.[0] ?? f.x ?? 0)
      const oy = Number(f.origin?.[1] ?? f.y ?? 0)
      minX = Math.min(minX, ox)
      minY = Math.min(minY, oy)
      maxX = Math.max(maxX, ox + w)
      maxY = Math.max(maxY, oy + d)
      height = Math.max(height, h)
      solids.push({ type: 'box', width: w, depth: d, height: h, origin: [ox, oy, 0] })
    } else if (t === 'rectangle') {
      const w = Number(f.width)
      const h2 = Number(f.height ?? f.depth)
      const ox = Number(f.origin?.[0] ?? f.x ?? 0)
      const oy = Number(f.origin?.[1] ?? f.y ?? 0)
      minX = Math.min(minX, ox)
      minY = Math.min(minY, oy)
      maxX = Math.max(maxX, ox + w)
      maxY = Math.max(maxY, oy + h2)
      solids.push({ type: 'rectangle', width: w, height: h2, origin: [ox, oy] })
    } else if (t === 'hole' || t === 'circle' || t === 'cylinder') {
      const diameter = Number(f.diameter ?? (f.radius != null ? f.radius * 2 : NaN))
      const pos = Array.isArray(f.position) ? f.position : [Number(f.x || 0), Number(f.y || 0)]
      const cx = Number(pos[0] || 0)
      const cy = Number(pos[1] || 0)
      const r = diameter / 2
      minX = Math.min(minX, cx - r)
      minY = Math.min(minY, cy - r)
      maxX = Math.max(maxX, cx + r)
      maxY = Math.max(maxY, cy + r)
      if (t === 'hole' || (t === 'cylinder' && f.through !== false)) {
        holes.push({
          diameter,
          position: [cx, cy, Number(pos[2] || 0)],
          through: f.through !== false,
        })
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return {
      bbox: [0, 0, 0],
      bbox2d: { min: [0, 0], max: [0, 0], size: [0, 0] },
      holes: [],
      holeCount: 0,
      solids: [],
      units: ir?.units || 'mm',
    }
  }

  const sizeX = maxX - minX
  const sizeY = maxY - minY
  return {
    bbox: [round3(sizeX), round3(sizeY), round3(height)],
    bbox2d: {
      min: [round3(minX), round3(minY)],
      max: [round3(maxX), round3(maxY)],
      size: [round3(sizeX), round3(sizeY)],
    },
    holes,
    holeCount: holes.length,
    solids,
    units: ir?.units || 'mm',
  }
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

/**
 * 期望尺寸是否匹配（容差 mm）
 */
export function matchBbox(actual, expected, tol = 0.05) {
  if (!actual || !expected || actual.length < 2 || expected.length < 2) return false
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
    if (Math.abs(Number(actual[i]) - Number(expected[i])) > tol) return false
  }
  return true
}

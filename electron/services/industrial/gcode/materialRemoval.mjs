/**
 * 2.5D 材料去除（栅格高度场）
 * Stock 顶面为 heightmap，切削段将刀具扫过区域高度压低到刀尖 Z
 */
import { normalizeSegment, normalizeToolpathIr } from './toolpathIr.mjs'
import { createBoxStock } from './stock.mjs'

/**
 * @returns {{
 *   grid, nx, ny, cell,
 *   origin:{x,y},
 *   zTop, zBottom,
 *   removedVolumeApprox,
 *   remainingRatio
 * }}
 */
export function simulateMaterialRemoval(toolpath, stock, opts = {}) {
  const tp = normalizeToolpathIr(toolpath)
  const box = stock?.type === 'box' ? stock : createBoxStock(stock || {})
  const cell = Math.max(0.5, Number(opts.cell) || 2)
  const toolR = Math.max(0.5, Number(opts.toolRadius) || 5)

  const w = box.max.x - box.min.x
  const h = box.max.y - box.min.y
  const nx = Math.max(4, Math.ceil(w / cell) + 1)
  const ny = Math.max(4, Math.ceil(h / cell) + 1)
  const zTop = box.max.z
  const zBottom = box.min.z
  const grid = new Float64Array(nx * ny)
  grid.fill(zTop)

  const idx = (ix, iy) => iy * nx + ix
  const worldToIx = (x) => Math.round((x - box.min.x) / cell)
  const worldToIy = (y) => Math.round((y - box.min.y) / cell)

  function stamp(x, y, zCut) {
    const rCells = Math.ceil(toolR / cell)
    const cx = worldToIx(x)
    const cy = worldToIy(y)
    for (let dy = -rCells; dy <= rCells; dy++) {
      for (let dx = -rCells; dx <= rCells; dx++) {
        const ix = cx + dx
        const iy = cy + dy
        if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue
        const wx = box.min.x + ix * cell
        const wy = box.min.y + iy * cell
        if (Math.hypot(wx - x, wy - y) > toolR + 1e-6) continue
        const i = idx(ix, iy)
        if (zCut < grid[i]) grid[i] = Math.max(zBottom, zCut)
      }
    }
  }

  function sampleSeg(seg) {
    const s = normalizeSegment(seg)
    if (s.type === 'rapid') return
    const len = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y, s.end.z - s.start.z)
    const steps = Math.max(1, Math.ceil(len / (cell * 0.5)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = s.start.x + (s.end.x - s.start.x) * t
      const y = s.start.y + (s.end.y - s.start.y) * t
      const z = s.start.z + (s.end.z - s.start.z) * t
      stamp(x, y, z)
    }
  }

  for (const seg of tp.segments) sampleSeg(seg)

  let removed = 0
  const cellArea = cell * cell
  for (let i = 0; i < grid.length; i++) {
    removed += Math.max(0, zTop - grid[i]) * cellArea
  }
  const totalVol = Math.max(1e-9, w * h * (zTop - zBottom))
  return {
    kind: 'material.removal.2_5d',
    stock: box,
    nx,
    ny,
    cell,
    origin: { x: box.min.x, y: box.min.y },
    zTop,
    zBottom,
    toolRadius: toolR,
    /** 序列化用：高度数组 */
    heights: Array.from(grid),
    removedVolumeApprox: removed,
    remainingRatio: Math.max(0, 1 - removed / totalVol),
    note: '2.5D 栅格近似，非精确 BREP 布尔。',
  }
}

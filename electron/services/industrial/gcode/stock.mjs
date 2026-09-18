/**
 * Stock 工件毛坯模型（V1.2 第一版：轴对齐盒子）
 */

export function createBoxStock(partial = {}) {
  const min = {
    x: Number(partial.min?.x ?? partial.x0 ?? 0),
    y: Number(partial.min?.y ?? partial.y0 ?? 0),
    z: Number(partial.min?.z ?? partial.z0 ?? -20),
  }
  const max = {
    x: Number(partial.max?.x ?? partial.x1 ?? (partial.width != null ? min.x + Number(partial.width) : 100)),
    y: Number(partial.max?.y ?? partial.y1 ?? (partial.height != null ? min.y + Number(partial.height) : 60)),
    z: Number(partial.max?.z ?? partial.z1 ?? (partial.thickness != null ? min.z + Number(partial.thickness) : 0)),
  }
  return {
    type: 'box',
    min,
    max,
    material: partial.material || 'aluminum',
  }
}

export function stockFromParams(params = {}) {
  const w = Number(params.width) || 100
  const h = Number(params.height) || 60
  const t = Number(params.stockZ ?? params.thickness ?? params.depth ?? 20)
  return createBoxStock({
    min: { x: 0, y: 0, z: -Math.abs(t) },
    max: { x: w, y: h, z: 0 },
    material: params.material || 'aluminum',
  })
}

export function pointInStockXY(stock, x, y) {
  return x >= stock.min.x && x <= stock.max.x && y >= stock.min.y && y <= stock.max.y
}

export function stockContainsPoint(stock, p, eps = 1e-6) {
  return (
    p.x >= stock.min.x - eps &&
    p.x <= stock.max.x + eps &&
    p.y >= stock.min.y - eps &&
    p.y <= stock.max.y + eps &&
    p.z >= stock.min.z - eps &&
    p.z <= stock.max.z + eps
  )
}

/** 线段是否与毛坯 XY 投影相交（用于快移碰撞粗检） */
export function segmentCrossesStockXY(stock, a, b) {
  // 任一点在内，或包围盒相交
  if (pointInStockXY(stock, a.x, a.y) || pointInStockXY(stock, b.x, b.y)) return true
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return !(maxX < stock.min.x || minX > stock.max.x || maxY < stock.min.y || minY > stock.max.y)
}

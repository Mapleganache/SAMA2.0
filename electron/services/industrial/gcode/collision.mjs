/**
 * 刀路碰撞 / 安全检查（相对 Stock + 快移）
 */
import { normalizeSegment, normalizeToolpathIr } from './toolpathIr.mjs'
import { stockContainsPoint, segmentCrossesStockXY } from './stock.mjs'

/**
 * 快移段是否在 Z 低于安全高度时穿过工件 XY
 */
export function checkToolpathCollisions(toolpath, stock, opts = {}) {
  const tp = normalizeToolpathIr(toolpath)
  const errors = []
  const warnings = []
  const safeZ = Number(opts.safeZ ?? stock?.max?.z ?? 0) + Number(opts.clearance ?? 2)

  for (const raw of tp.segments) {
    const seg = normalizeSegment(raw)
    const line = seg.line ?? '?'

    if (seg.type === 'rapid') {
      const zLow = Math.min(seg.start.z, seg.end.z)
      const crosses = segmentCrossesStockXY(stock, seg.start, seg.end)
      // 快移终点或轨迹在毛坯 XY 内，且高度进入材料
      if (crosses && zLow < stock.max.z - 1e-6) {
        const mid = {
          x: (seg.start.x + seg.end.x) / 2,
          y: (seg.start.y + seg.end.y) / 2,
          z: zLow,
        }
        if (stockContainsPoint(stock, mid) || stockContainsPoint(stock, seg.end) || stockContainsPoint(stock, seg.start)) {
          errors.push({
            code: 'RAPID_COLLISION',
            message: `L${line} 快移可能穿过工件（Z=${zLow}）`,
            line,
          })
        } else if (zLow < safeZ) {
          warnings.push({
            code: 'RAPID_LOW_OVER_STOCK',
            message: `L${line} 在工件投影上方快移高度偏低 Z=${zLow}`,
            line,
          })
        }
      } else if (zLow < safeZ && crosses) {
        warnings.push({
          code: 'RAPID_LOW_Z',
          message: `L${line} 快移高度 Z=${zLow} 低于建议安全高度 ${safeZ}`,
          line,
        })
      }
    }

    if (seg.type === 'cut' || seg.type === 'arc') {
      if (seg.end.z < stock.min.z - 1e-3) {
        errors.push({
          code: 'TOOLPATH_DEPTH_EXCEEDED',
          message: `L${line} 切削深度 Z=${seg.end.z} 超过毛坯底面 ${stock.min.z}`,
          line,
        })
      }
      // 刀尖在毛坯外但 XY 仍在工件上、Z 异常低：刀柄风险（简化）
      if (
        seg.end.z < stock.min.z + Number(opts.holderClearance ?? 2) &&
        segmentCrossesStockXY(stock, seg.start, seg.end)
      ) {
        warnings.push({
          code: 'TOOL_HOLDER_COLLISION',
          message: `L${line} 刀尖接近/低于毛坯底面，刀柄碰撞风险`,
          line,
        })
      }
      // 切削段终点在毛坯外 XY 但深度在材料高度内：记刀具-工件越界提示
      if (
        !segmentCrossesStockXY(stock, seg.end, seg.end) &&
        seg.end.z < stock.max.z &&
        seg.end.z > stock.min.z
      ) {
        warnings.push({
          code: 'TOOL_WORKPIECE_COLLISION',
          message: `L${line} 切削终点超出毛坯 XY 投影（可能过切/空切）`,
          line,
        })
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}

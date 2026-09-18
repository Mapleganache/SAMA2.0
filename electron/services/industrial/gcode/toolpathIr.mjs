/**
 * ToolpathIR V1.2 — 统一刀路中间表示
 * UI / 材料去除 / 碰撞 / 时间 / 仿真 全部消费本结构
 */

export function createEmptyToolpathIr(partial = {}) {
  return {
    schemaVersion: 2,
    kind: 'toolpath.ir',
    source: partial.source || 'unknown',
    units: partial.units || 'mm',
    segments: Array.isArray(partial.segments) ? partial.segments : [],
    bounds: partial.bounds || null,
    tools: Array.isArray(partial.tools) ? partial.tools : [],
    summary: partial.summary || {},
    programNumber: partial.programNumber ?? null,
    meta: partial.meta || {},
  }
}

function pt(p) {
  if (!p) return { x: 0, y: 0, z: 0 }
  return {
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
    z: Number(p.z) || 0,
  }
}

/** 归一化单段：同时提供 start/end 与 from/to（兼容 V1.1 预览） */
export function normalizeSegment(seg) {
  const start = pt(seg.start || seg.from)
  const end = pt(seg.end || seg.to)
  let type = seg.type || 'cut'
  if (type === 'feed') type = 'cut'
  const out = {
    type, // rapid | cut | arc
    start,
    end,
    from: start,
    to: end,
    line: seg.line ?? null,
    feed: seg.feed ?? null,
    tool: seg.tool ?? null,
    motion: seg.motion || null,
    kind: seg.kind || null,
  }
  if (type === 'arc') {
    out.direction = seg.direction || seg.dir || 'CW'
    out.center = seg.center
      ? pt(seg.center)
      : {
          x: start.x + (Number(seg.i) || 0),
          y: start.y + (Number(seg.j) || 0),
          z: start.z,
        }
    out.radius =
      seg.radius ??
      (Math.hypot(start.x - out.center.x, start.y - out.center.y) || 0)
    out.i = seg.i
    out.j = seg.j
  }
  return out
}

export function normalizeToolpathIr(tp) {
  const segs = (tp?.segments || []).map(normalizeSegment)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const touch = (p) => {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  for (const s of segs) {
    touch(s.start)
    touch(s.end)
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    maxX = 0
    minY = 0
    maxY = 0
    minZ = 0
    maxZ = 0
  }
  return createEmptyToolpathIr({
    ...tp,
    segments: segs,
    bounds: {
      x: [minX, maxX],
      y: [minY, maxY],
      z: [minZ, maxZ],
    },
  })
}

export function segmentLength(seg) {
  const s = normalizeSegment(seg)
  if (s.type === 'arc' && s.radius > 0 && s.center) {
    const a0 = Math.atan2(s.start.y - s.center.y, s.start.x - s.center.x)
    const a1 = Math.atan2(s.end.y - s.center.y, s.end.x - s.center.x)
    let d = a1 - a0
    if (s.direction === 'CW' && d > 0) d -= Math.PI * 2
    if (s.direction === 'CCW' && d < 0) d += Math.PI * 2
    if (Math.abs(d) < 1e-9) d = s.direction === 'CW' ? -Math.PI * 2 : Math.PI * 2
    return Math.abs(d) * s.radius
  }
  return Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y, s.end.z - s.start.z)
}

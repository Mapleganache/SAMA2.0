/**
 * 极简 AutoCAD R12 ASCII DXF 写出（板件顶视：矩形 + 圆孔）
 * 不依赖外部库。
 */

function pairs(code, value) {
  return `${code}\n${value}\n`
}

/**
 * @param {object} geometry — summarizeCadGeometry 结果
 * @param {{ layer?: string }} opts
 */
export function buildDxfFromGeometry(geometry, opts = {}) {
  const layer = opts.layer || '0'
  const entities = []

  for (const s of geometry.solids || []) {
    if (s.type === 'box' || s.type === 'rectangle') {
      const x0 = s.origin?.[0] || 0
      const y0 = s.origin?.[1] || 0
      const w = s.width
      const d = s.depth ?? s.height
      // LWPOLYLINE 在 R12 用 POLYLINE
      entities.push(rectPolyline(x0, y0, w, d, layer))
    }
  }

  // 若没有 solid 但有 holes，仍画圆
  for (const h of geometry.holes || []) {
    entities.push(circleEntity(h.position[0], h.position[1], h.diameter / 2, layer))
  }

  // 也画非 hole 的 circle features 已并入 holes；额外 cylinder 同 holes

  const body =
    pairs(0, 'SECTION') +
    pairs(2, 'HEADER') +
    pairs(9, '$ACADVER') +
    pairs(1, 'AC1009') +
    pairs(0, 'ENDSEC') +
    pairs(0, 'SECTION') +
    pairs(2, 'TABLES') +
    pairs(0, 'TABLE') +
    pairs(2, 'LAYER') +
    pairs(70, 1) +
    pairs(0, 'LAYER') +
    pairs(2, layer) +
    pairs(70, 0) +
    pairs(62, 7) +
    pairs(6, 'CONTINUOUS') +
    pairs(0, 'ENDTAB') +
    pairs(0, 'ENDSEC') +
    pairs(0, 'SECTION') +
    pairs(2, 'ENTITIES') +
    entities.join('') +
    pairs(0, 'ENDSEC') +
    pairs(0, 'EOF')

  return body
}

function rectPolyline(x0, y0, w, d, layer) {
  const pts = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + d],
    [x0, y0 + d],
    [x0, y0],
  ]
  let s = pairs(0, 'POLYLINE') + pairs(8, layer) + pairs(66, 1) + pairs(70, 1)
  for (const [x, y] of pts) {
    s += pairs(0, 'VERTEX') + pairs(8, layer) + pairs(10, x) + pairs(20, y) + pairs(30, 0)
  }
  s += pairs(0, 'SEQEND')
  return s
}

function circleEntity(cx, cy, r, layer) {
  return (
    pairs(0, 'CIRCLE') +
    pairs(8, layer) +
    pairs(10, cx) +
    pairs(20, cy) +
    pairs(30, 0) +
    pairs(40, r)
  )
}

/** 粗解析 DXF：统计 CIRCLE 数量与 POLYLINE 是否存在 */
export function parseDxfStats(dxfText) {
  const lines = String(dxfText || '').split(/\r?\n/)
  let circles = 0
  let polylines = 0
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === '0' && lines[i + 1].trim() === 'CIRCLE') circles++
    if (lines[i].trim() === '0' && lines[i + 1].trim() === 'POLYLINE') polylines++
  }
  return { circles, polylines, bytes: Buffer.byteLength(String(dxfText || ''), 'utf8') }
}

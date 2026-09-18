/**
 * 电气原理图导出：DXF（示意）+ SVG + BOM
 */
import fs from 'node:fs'
import path from 'node:path'
import { validateIr } from '../validate.mjs'
import { runElectricalRules } from './rules.mjs'
import { layoutElectrical, buildBom } from './layout.mjs'

function pairs(code, value) {
  return `${code}\n${value}\n`
}

function resolveOutDir(explicit = '') {
  if (explicit) {
    const p = path.resolve(explicit)
    fs.mkdirSync(p, { recursive: true })
    return p
  }
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app?.getPath) {
      const dir = path.join(app.getPath('userData'), 'sama-data', 'workspace', 'electrical')
      fs.mkdirSync(dir, { recursive: true })
      return dir
    }
  } catch {
    /* node */
  }
  const dir = path.join(process.cwd(), 'workspace', 'electrical')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function deviceBoxDxf(n, layer) {
  const w = 70
  const h = 28
  const x0 = n.x
  const y0 = n.y
  let s =
    pairs(0, 'POLYLINE') +
    pairs(8, layer) +
    pairs(66, 1) +
    pairs(70, 1)
  const pts = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
    [x0, y0],
  ]
  for (const [x, y] of pts) {
    s += pairs(0, 'VERTEX') + pairs(8, layer) + pairs(10, x) + pairs(20, y) + pairs(30, 0)
  }
  s += pairs(0, 'SEQEND')
  s +=
    pairs(0, 'TEXT') +
    pairs(8, layer) +
    pairs(10, x0 + 4) +
    pairs(20, y0 + 10) +
    pairs(30, 0) +
    pairs(40, 8) +
    pairs(1, String(n.label || n.id).slice(0, 24))
  return s
}

function lineDxf(x1, y1, x2, y2, layer) {
  return (
    pairs(0, 'LINE') +
    pairs(8, layer) +
    pairs(10, x1) +
    pairs(20, y1) +
    pairs(30, 0) +
    pairs(11, x2) +
    pairs(21, y2) +
    pairs(31, 0)
  )
}

export function buildElectricalDxf(layout, opts = {}) {
  const layer = opts.layer || 'ELEC'
  const entities = []
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  for (const n of layout.nodes) entities.push(deviceBoxDxf(n, layer))
  for (const e of layout.edges) {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) continue
    entities.push(lineDxf(a.x + 70, a.y + 14, b.x, b.y + 14, layer))
  }
  return (
    pairs(0, 'SECTION') +
    pairs(2, 'HEADER') +
    pairs(9, '$ACADVER') +
    pairs(1, 'AC1009') +
    pairs(0, 'ENDSEC') +
    pairs(0, 'SECTION') +
    pairs(2, 'ENTITIES') +
    entities.join('') +
    pairs(0, 'ENDSEC') +
    pairs(0, 'EOF')
  )
}

export function buildElectricalSvg(layout) {
  const w = Math.max(layout.bounds?.width || 400, 400)
  const h = Math.max(layout.bounds?.height || 200, 200)
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  const rects = layout.nodes
    .map(
      (n) =>
        `<g>
  <rect x="${n.x}" y="${n.y}" width="70" height="28" fill="#f7f7f2" stroke="#1a1a1a" stroke-width="1.2"/>
  <text x="${n.x + 6}" y="${n.y + 18}" font-family="Consolas,monospace" font-size="11">${escapeXml(n.label || n.id)}</text>
</g>`,
    )
    .join('\n')
  const lines = layout.edges
    .map((e) => {
      const a = byId.get(e.from)
      const b = byId.get(e.to)
      if (!a || !b) return ''
      return `<line x1="${a.x + 70}" y1="${a.y + 14}" x2="${b.x}" y2="${b.y + 14}" stroke="#333" stroke-width="1.5"/>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#fafaf7"/>
  ${lines}
  ${rects}
</svg>
`
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * ElectricalIR → 规则 + 布局 + 文件
 * allowWarnings: 默认 true（有 warning 仍可出图）；有 error 则拒绝
 */
export function materializeElectricalIr(ir, opts = {}) {
  const v = validateIr('electrical', ir)
  if (!v.ok) {
    const err = new Error('ElectricalIR 校验失败')
    err.code = 'IR_INVALID'
    err.errors = v.errors
    throw err
  }

  const ruleResult = runElectricalRules(ir)
  if (!ruleResult.ok && opts.allowErrors !== true) {
    const err = new Error('电气规则未通过')
    err.code = 'ELEC_RULES_FAILED'
    err.data = ruleResult
    throw err
  }

  const layout = layoutElectrical(ir)
  const bom = buildBom(ir)
  const outDir = resolveOutDir(opts.outDir)
  const stem =
    String(opts.name || ir.meta?.name || 'schematic')
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
      .slice(0, 80) || 'schematic'
  const stamp = Date.now().toString(36)
  const base = `${stem}_${stamp}`
  const dxfPath = path.join(outDir, `${base}.dxf`)
  const svgPath = path.join(outDir, `${base}.svg`)
  const jsonPath = path.join(outDir, `${base}.electrical.json`)
  const bomPath = path.join(outDir, `${base}.bom.json`)

  const dxf = buildElectricalDxf(layout)
  const svg = buildElectricalSvg(layout)
  fs.writeFileSync(dxfPath, dxf, 'utf8')
  fs.writeFileSync(svgPath, svg, 'utf8')
  fs.writeFileSync(bomPath, JSON.stringify({ items: bom }, null, 2), 'utf8')

  const enriched = {
    ...ir,
    rules: ruleResult.rules,
    layout,
  }
  const payload = {
    schemaVersion: 1,
    kind: 'electrical.artifact',
    ir: enriched,
    ruleResult,
    layout,
    bom,
    files: {
      dxf: path.basename(dxfPath),
      svg: path.basename(svgPath),
      bom: path.basename(bomPath),
    },
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')

  const verification = {
    ok: fs.existsSync(dxfPath) && fs.existsSync(svgPath) && ruleResult.ok,
    file_exists: true,
    rules_ok: ruleResult.ok,
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    warningCount: ruleResult.warnings.length,
  }

  if (!verification.file_exists) {
    const err = new Error('电气产物未写出')
    err.code = 'ELEC_VERIFY_FAILED'
    throw err
  }

  return {
    success: true,
    path: dxfPath,
    file: dxfPath,
    artifact: {
      dxf: dxfPath,
      svg: svgPath,
      json: jsonPath,
      bom: bomPath,
      format: 'dxf+svg+bom',
    },
    svg,
    ruleResult,
    layout,
    bom,
    verification,
    note: '示意原理图（分层布局），非 EPLAN 工程。规则 error 默认阻止出图。',
  }
}

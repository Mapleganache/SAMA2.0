/**
 * 按 wirePlan 逐步接线渲染（逻辑驱动，非随意摆符号）
 */
import { drawSymbol, labelPad, symbolSize } from './iecSymbols.mjs'
import { normalizeElecJson } from './elecJson.mjs'

const W = 420
const H = 297
const TB = 68
const MARGIN = 8

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 节点坐标：母线 + 竖串元件 */
function buildMotorLayout(doc) {
  const area = { x: MARGIN + 20, y: MARGIN + 18, w: W - MARGIN * 2 - TB - 40, h: H - MARGIN * 2 - 30 }
  const cx = area.x + area.w * 0.35
  const rails = {
    R: { x: area.x, y: area.y + 8, x2: area.x + area.w, label: 'R' },
    S: { x: area.x, y: area.y + 16, x2: area.x + area.w, label: 'S' },
    T: { x: area.x, y: area.y + 24, x2: area.x + area.w, label: 'T' },
    PE: { x: area.x, y: area.y + area.h - 12, x2: area.x + area.w, label: 'PE', pe: true },
  }
  const pad = labelPad()
  let y = area.y + 42
  const col = doc.columns?.[0]?.devices || []
  const nodes = {}
  const symMap = { Q1: 'breaker3', KM1: 'contactor3', M1: 'motor3' }
  for (const d of col) {
    const sym = symMap[d.tag] || d.sym || 'other'
    const size = symbolSize(sym)
    nodes[d.tag] = { x: cx - size.w / 2, y, w: size.w, h: size.h, sym, device: d, cx }
    y += size.h + pad.below + pad.above + 8
  }
  nodes.BUS_R = { cx, y: rails.R.y, tap: nodes.Q1?.y || rails.R.y + 20 }
  nodes.BUS_S = { cx, y: rails.S.y, tap: nodes.Q1?.y || rails.S.y + 20 }
  nodes.BUS_T = { cx, y: rails.T.y, tap: nodes.Q1?.y || rails.T.y + 20 }
  nodes.BUS_PE = { cx, y: rails.PE.y }
  nodes.GND = { cx, y: rails.PE.y + 6, sym: 'pe' }
  return { area, cx, rails, nodes, pad }
}

function poleXs(cx, offsets) {
  return offsets.map((o) => cx + o)
}

function drawBuses(layout) {
  let s = ''
  const { rails } = layout
  for (const key of ['R', 'S', 'T']) {
    const r = rails[key]
    s += `<text x="${r.x - 2}" y="${r.y + 1}" class="rail">${r.label}</text>`
    const cls = key === 'R' ? 'bus bus-r' : key === 'S' ? 'bus bus-s' : 'bus bus-t'
    s += `<line x1="${r.x + 10}" y1="${r.y}" x2="${r.x2}" y2="${r.y}" class="${cls}" />`
  }
  const pe = rails.PE
  s += `<text x="${pe.x - 2}" y="${pe.y + 1}" class="rail">${pe.label}</text>`
  s += `<line x1="${pe.x + 10}" y1="${pe.y}" x2="${pe.x2}" y2="${pe.y}" class="pe" />`
  return s
}

function drawPeGround(cx, y) {
  return (
    `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + 4}" />` +
    `<line x1="${cx - 4}" y1="${y + 4}" x2="${cx + 4}" y2="${y + 4}" />` +
    `<line x1="${cx - 2.5}" y1="${y + 6}" x2="${cx + 2.5}" y2="${y + 6}" />` +
    `<line x1="${cx - 1.2}" y1="${y + 8}" x2="${cx + 1.2}" y2="${y + 8}" />` +
    `<text x="${cx + 6}" y="${y + 6}" class="desc">接地</text>`
  )
}

function wireSegment(x1, y1, x2, y2, step, wire) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  return (
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="wire-drop" />` +
    `<circle cx="${x1}" cy="${y1}" r="0.7" fill="#111" />` +
    `<circle cx="${x2}" cy="${y2}" r="0.55" fill="#111" />` +
    `<text x="${mx + 2}" y="${my - 1}" class="step-label">${step}</text>` +
    `<text x="${mx + 2}" y="${my + 2.5}" class="wire-label">${esc(wire)}</text>`
  )
}

function drawStepWires(layout, wirePlan) {
  const { nodes, cx } = layout
  const offsets = [-5, 0, 5]
  const px = poleXs(cx, offsets)
  let s = ''
  const q1 = nodes.Q1
  const km1 = nodes.KM1
  const m1 = nodes.M1
  if (!q1 || !km1 || !m1) return s

  const qTop = q1.y
  const qBot = q1.y + q1.h
  const kmTop = km1.y
  const kmBot = km1.y + km1.h
  const mTop = m1.y

  // 步骤 1-3: 母线 → Q1 上端
  s += wireSegment(px[0], layout.rails.R.y, px[0], qTop, 1, 'R')
  s += wireSegment(px[1], layout.rails.S.y, px[1], qTop, 2, 'S')
  s += wireSegment(px[2], layout.rails.T.y, px[2], qTop, 3, 'T')

  // 步骤 4-6: Q1 下端 → KM1 上端
  s += wireSegment(px[0], qBot, px[0], kmTop, 4, 'R1')
  s += wireSegment(px[1], qBot, px[1], kmTop, 5, 'S1')
  s += wireSegment(px[2], qBot, px[2], kmTop, 6, 'T1')

  // 步骤 7-9: KM1 下端 → M1 上端
  s += wireSegment(px[0], kmBot, px[0], mTop, 7, 'U1')
  s += wireSegment(px[1], kmBot, px[1], mTop, 8, 'V1')
  s += wireSegment(px[2], kmBot, px[2], mTop, 9, 'W1')

  // 步骤 10: PE → M1（中部）
  const peY = layout.rails.PE.y
  const mPeY = m1.y + m1.h * 0.6
  s += wireSegment(cx, peY, cx, mPeY, 10, 'PE')

  // 步骤 11: PE → 接地符号
  s += wireSegment(cx, peY + 2, cx, peY + 8, 11, 'PE')
  s += drawPeGround(cx, peY + 8)

  return s
}

function drawDevices(layout) {
  let s = ''
  for (const tag of ['Q1', 'KM1', 'M1']) {
    const n = layout.nodes[tag]
    if (!n) continue
    s += drawSymbol(n.sym, n.x, n.y, n.device)
  }
  return s
}

function drawStepList(wirePlan) {
  let s = `<text x="${W - MARGIN - TB + 2}" y="${MARGIN + 14}" class="tag">接线步骤</text>`
  wirePlan.slice(0, 11).forEach((step, i) => {
    const y = MARGIN + 22 + i * 5.5
    s += `<text x="${W - MARGIN - TB + 2}" y="${y}" class="step-list">${step.step}. ${esc(step.wire)} ${esc(step.from)}→${esc(step.to)}</text>`
  })
  return s
}

const STYLE = `    svg { font-family: "Microsoft YaHei", sans-serif; }
    line, rect, circle { stroke: #141414; stroke-width: 0.45; fill: none; }
    .bus { stroke-width: 1.1; }
    .bus-r { stroke: #8b1a1a; }
    .bus-s { stroke: #1a5c8b; }
    .bus-t { stroke: #3d6b1f; }
    .pe { stroke-width: 0.9; stroke-dasharray: 3 1.2; stroke: #555; }
    .wire-drop { stroke-width: 0.5; stroke: #222; }
    .rail { font-size: 3px; font-weight: 700; fill: #111; stroke: none; }
    .tag { font-size: 3px; font-weight: 600; fill: #111; stroke: none; }
    .rating, .desc { font-size: 2.4px; fill: #333; stroke: none; }
    .step-label { font-size: 2px; fill: #c45a00; font-weight: 700; stroke: none; }
    .wire-label { font-size: 2px; fill: #555; stroke: none; }
    .step-list { font-size: 1.8px; fill: #333; stroke: none; }`

export function renderFromWirePlan(raw) {
  const doc = normalizeElecJson(raw)
  const wirePlan = doc.wirePlan || []
  const layout = buildMotorLayout(doc)
  const body =
    drawBuses(layout) +
    drawStepWires(layout, wirePlan) +
    drawDevices(layout) +
    drawStepList(wirePlan)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(doc.page?.title || '逻辑接线图')}">
  <style>${STYLE}</style>
  <rect x="${MARGIN}" y="${MARGIN}" width="${W - MARGIN * 2}" height="${H - MARGIN * 2}" fill="#fbf8f1" />
  ${body}
</svg>`
  return { svg, doc, wirePlan, mode: 'wire-plan' }
}

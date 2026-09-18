/**
 * EPLAN 导出风格图框：标题栏 + 电位 + IEC 符号。坐标 mm，A3 横图。
 * 布局约定：母线在上；列从母线垂下；位号在符号上方（不压母线）；额定在符号下方。
 */
import { drawSymbol, symbolSize, labelPad } from './iecSymbols.mjs'
import { elecJsonToBom, normalizeElecJson } from './elecJson.mjs'
import { renderFromWirePlan } from './wirePlanRender.mjs'

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

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= n) return t
  return `${t.slice(0, Math.max(0, n - 1))}…`
}

function cell(x, y, w, h, label, value) {
  const lines = String(value || '')
    .split(/\n/)
    .map((l) => clip(l, 18))
    .filter(Boolean)
    .slice(0, 2)
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f7f4ee" />`
  if (label) s += `<text x="${x + 1.4}" y="${y + 3.2}" class="tb-label">${esc(label)}</text>`
  if (lines[0]) {
    const base = label ? y + 7.2 : y + Math.min(h - 2, 6)
    s += `<text x="${x + 1.4}" y="${base}" class="tb-val">${esc(lines[0])}</text>`
    if (lines[1] && h >= 12) {
      s += `<text x="${x + 1.4}" y="${base + 3.6}" class="tb-val">${esc(lines[1])}</text>`
    }
  }
  return s
}

function titleBlock(doc) {
  const x = W - MARGIN - TB
  const y = MARGIN
  const h = H - MARGIN * 2
  const p = doc.project || {}
  const page = doc.page || {}
  const cols = '0123456789'.split('')
  let s = `<rect x="${x}" y="${y}" width="${TB}" height="${h}" fill="#f7f4ee" />`
  let cy = y
  const rows = [
    [10, '页数', String(page.of || '')],
    [10, '页', String(page.no || '')],
    [14, '', clip(p.drawing || '', 22)],
    [10, '校对', ''],
    [10, '原始项目', clip(p.origin || '', 18)],
    [10, '日期', ''],
    [16, '标题', clip(page.title || '', 20)],
    [10, '修改', ''],
  ]
  for (const [hh, lab, val] of rows) {
    s += cell(x, cy, TB, hh, lab, val)
    cy += hh
  }
  const rh = 8
  s += `<rect x="${x}" y="${cy}" width="${TB}" height="${rh}" fill="#f7f4ee" />`
  cols.forEach((c, i) => {
    const cw = TB / 10
    s += `<line x1="${x + i * cw}" y1="${cy}" x2="${x + i * cw}" y2="${cy + rh}" />`
    s += `<text x="${x + i * cw + cw / 2}" y="${cy + 5.4}" text-anchor="middle" class="tb-label">${c}</text>`
  })
  cy += rh
  s += cell(x, cy, TB / 2, 10, '审核', '')
  s += cell(x + TB / 2, cy, TB / 2, 10, '替换', '')
  cy += 10
  s += cell(x, cy, TB, 12, '姓名', '')
  cy += 12
  s += cell(x, cy, TB, 14, '', `${page.no || ''} / ${page.of || ''}`)
  s += `<text x="${x + TB - 2}" y="${cy + 11}" text-anchor="end" class="tb-val">${esc(clip(p.machine || '', 16))}</text>`
  cy += 14
  const rest = h - (cy - y)
  s += `<rect x="${x}" y="${cy}" width="${TB}" height="${rest}" fill="#f7f4ee" />`
  s += `<text x="${x + 2}" y="${cy + rest - 8}" class="tb-val">${esc(clip(p.control || '', 18))}</text>`
  s += `<text x="${x + 2}" y="${cy + rest - 4}" class="tb-val">${esc(clip(p.serial || '', 18))}</text>`
  return s
}

function frame() {
  const x = MARGIN
  const y = MARGIN
  const w = W - MARGIN * 2
  const h = H - MARGIN * 2
  const dw = w - TB
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fbf8f1" />`
  s += `<rect x="${x}" y="${y}" width="${dw}" height="${h}" fill="#fbf8f1" />`
  // 绘图区淡网格（EPLAN 风格参考）
  for (let gx = x + 2; gx < x + dw - 2; gx += 8) {
    s += `<line x1="${gx}" y1="${y + 2}" x2="${gx}" y2="${y + h - 2}" stroke="#ebe6dc" stroke-width="0.12" />`
  }
  for (let gy = y + 2; gy < y + h - 2; gy += 8) {
    s += `<line x1="${x + 2}" y1="${gy}" x2="${x + dw - 2}" y2="${gy}" stroke="#ebe6dc" stroke-width="0.12" />`
  }
  for (let i = 0; i < 10; i++) {
    const cx = x + (dw / 10) * (i + 0.5)
    s += `<text x="${cx}" y="${y + h - 2.2}" text-anchor="middle" class="col-idx">${i}</text>`
    s += `<line x1="${x + (dw / 10) * i}" y1="${y + h - 5}" x2="${x + (dw / 10) * i}" y2="${y + h}" />`
  }
  return s
}

function drawRails(doc, area) {
  const rails = doc.rails || []
  if (!rails.length) return { svg: '', bottom: area.y + 4, railYs: [] }
  const gap = 6
  const railYs = []
  let s = ''
  rails.forEach((r, i) => {
    const y = area.y + 8 + i * gap
    railYs.push({ id: r.id, y, pe: r.type === 'pe' || /PE/i.test(r.id) })
    // 文字在线左侧，基线对齐线条，不压在线上
    s += `<text x="${area.x + 1}" y="${y + 0.9}" class="rail">${esc(r.label || r.id)}</text>`
    const busCls = railYs[i].pe ? 'pe' : i === 0 ? 'bus bus-r' : i === 1 ? 'bus bus-s' : i === 2 ? 'bus bus-t' : 'bus'
    s += `<line x1="${area.x + 12}" y1="${y}" x2="${area.x + area.w - 2}" y2="${y}" class="${busCls}" />`
  })
  // 母线下方再留位号空间
  const pad = labelPad().above + 2
  return { svg: s, bottom: area.y + 8 + rails.length * gap + pad, railYs }
}

function sortedCols(doc) {
  const cols = [...(doc.columns || [])]
  cols.sort((a, b) => Number(a.i ?? 0) - Number(b.i ?? 0))
  return cols
}

function resolveRenderSym(d) {
  const wi = (d.wiresIn || []).filter(Boolean)
  const wo = (d.wiresOut || []).filter(Boolean)
  if (d.sym === 'contactor' && (wi.length >= 3 || wo.length >= 3)) return 'contactor3'
  if (d.sym === 'breaker' && (wi.length >= 3 || wo.length >= 3)) return 'breaker3'
  return d.sym || 'other'
}

function poleOffsetsFor(sym) {
  if (sym === 'breaker3' || sym === 'contactor3') return [-5, 0, 5]
  if (sym === 'motor3') return [-4, 0, 4]
  return [0]
}

/** 按 wiresIn 接到对应母线（R/S/T 或 24P/0V），禁止默认挂 PE */
function resolveTopRails(dev, railById, railYs) {
  const wi = (dev.wiresIn || []).map(String).filter(Boolean)
  if (!wi.length) return []

  const direct = wi.map((w) => railById.get(w)).filter(Boolean)
  if (direct.length === wi.length) return direct

  if (wi.length >= 3) {
    const hasRST = wi.includes('R') && wi.includes('S') && wi.includes('T')
    if (hasRST) {
      return ['R', 'S', 'T'].map((id) => railById.get(id)).filter(Boolean)
    }
    const phaseRails = railYs.filter((r) => !r.pe)
    if (phaseRails.length >= 3) return phaseRails.slice(0, 3)
  }
  if (wi.length === 2) {
    return wi.map((w) => railById.get(w)).filter(Boolean)
  }
  if (wi.length === 1) {
    const r = railById.get(wi[0])
    return r ? [r] : []
  }
  return direct
}

function drawVerticalWires(cx, y1, y2, offsets, cls = 'drop') {
  let s = ''
  for (const off of offsets) {
    s += `<line x1="${cx + off}" y1="${y1}" x2="${cx + off}" y2="${y2}" class="${cls}" />`
  }
  return s
}

function drawRailTaps(cx, yEnd, rails, offsets, cls = 'drop') {
  let s = ''
  const n = Math.min(rails.length, offsets.length)
  for (let i = 0; i < n; i++) {
    const px = cx + offsets[i]
    const ry = rails[i].y
    s += `<line x1="${px}" y1="${ry}" x2="${px}" y2="${yEnd}" class="${cls}" />`
    if (!rails[i].pe) {
      s += `<circle cx="${px}" cy="${ry}" r="0.95" fill="#111" />`
      s += `<circle cx="${px}" cy="${yEnd}" r="0.55" fill="#111" />`
    }
  }
  return s
}

function drawColumns(doc, area, railYs = []) {
  const cols = sortedCols(doc)
  if (!cols.length) return ''
  const pad = labelPad()
  const dw = area.w
  const colW = dw / 10
  const railById = new Map(railYs.map((r) => [r.id, r]))
  let s = ''

  for (const col of cols) {
    const i = Math.min(9, Math.max(0, Number(col.i ?? 0)))
    const cx = area.x + colW * i + colW / 2
    const devices = col.devices || []
    if (!devices.length) continue

    let y = area.y + pad.above
    const firstSym = resolveRenderSym(devices[0])
    const topRails = resolveTopRails(devices[0], railById, railYs)
    if (topRails.length >= 3) {
      s += drawRailTaps(cx, y, topRails, poleOffsetsFor(firstSym))
    } else if (topRails.length === 2) {
      s += drawRailTaps(cx, y, topRails, [-3, 3])
    } else if (topRails.length === 1) {
      s += drawRailTaps(cx, y, topRails, [0])
    }

    for (let di = 0; di < devices.length; di++) {
      const d = devices[di]
      const sym = resolveRenderSym(d)
      const size = symbolSize(sym)
      const x = cx - size.w / 2
      s += drawSymbol(sym, x, y, d)

      if (di < devices.length - 1) {
        const nextSym = resolveRenderSym(devices[di + 1])
        const offA = poleOffsetsFor(sym)
        const offB = poleOffsetsFor(nextSym)
        const offs = offA.length >= 3 ? offA : offB.length >= 3 ? offB : [0]
        s += drawVerticalWires(cx, y + size.h, y + size.h + pad.above, offs)
      }
      y += size.h + pad.below + pad.above
    }
  }
  return s
}

function drawIo(doc, area) {
  const rows = doc.io || []
  if (!rows.length) return ''
  const colW = [22, 52, 36, 28]
  const headers = ['地址', '信号', '端子', '模块']
  let s = `<text x="${area.x + 2}" y="${area.y + 3}" class="tag">I/O 表</text>`
  let x = area.x + 2
  headers.forEach((h, i) => {
    s += `<text x="${x}" y="${area.y + 9}" class="tb-label">${h}</text>`
    x += colW[i]
  })
  s += `<line x1="${area.x}" y1="${area.y + 11}" x2="${area.x + area.w}" y2="${area.y + 11}" class="io-rule" />`
  rows.slice(0, 24).forEach((row, i) => {
    const y = area.y + 17 + i * 7
    if (i % 2 === 0) {
      s += `<rect x="${area.x}" y="${y - 4.5}" width="${area.w}" height="7" fill="#f3efe6" stroke="none" />`
    }
    let cx = area.x + 2
    const cells = [row.addr, row.name, row.term, row.module || row.xref]
    cells.forEach((v, j) => {
      s += `<text x="${cx}" y="${y}" class="io">${esc(clip(v, j === 1 ? 16 : 12))}</text>`
      cx += colW[j]
    })
  })
  return s
}

function isIoSheet(doc) {
  if (doc.page?.kind === 'io') return true
  const cols = doc.columns || []
  const onlyIo =
    cols.length > 0 &&
    cols.every((c) => (c.devices || []).every((d) => d.sym === 'io' || /^X\d|^Y\d/i.test(d.tag || '')))
  return onlyIo && (doc.io || []).length > 0
}

export function renderElecSvg(raw) {
  const doc = normalizeElecJson(raw)
  if (Array.isArray(doc.wirePlan) && doc.wirePlan.length >= 3) {
    const wired = renderFromWirePlan(doc)
    return {
      svg: wired.svg,
      bom: elecJsonToBom(doc),
      doc,
      inner: wired.svg,
      pageW: W,
      pageH: H,
      renderMode: 'wire-plan',
      wirePlan: wired.wirePlan,
    }
  }
  const drawW = W - MARGIN * 2 - TB
  const area = { x: MARGIN + 2, y: MARGIN + 4, w: drawW - 4, h: H - MARGIN * 2 - 10 }
  const rails = drawRails(doc, area)
  const bodyY = rails.bottom
  const bodyArea = { ...area, y: bodyY, h: area.h - (bodyY - area.y) }

  let body = ''
  if (isIoSheet(doc)) {
    // I/O 页：只画地址表，避免每个点画成大方块叠字
    body = drawIo(doc, bodyArea)
  } else if ((doc.io || []).length && !(doc.columns || []).length) {
    body = drawIo(doc, bodyArea)
  } else {
    body = drawColumns(doc, bodyArea, rails.railYs)
    if ((doc.io || []).length) {
      const ioArea = {
        x: area.x,
        y: Math.min(area.y + area.h - 70, bodyY + 120),
        w: area.w,
        h: 65,
      }
      body += drawIo(doc, ioArea)
    }
  }

  const inner =
    `${frame()}\n  ${titleBlock(doc)}\n  ${rails.svg}\n  ${body}`
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(doc.page?.title || '电路图')}">
  <style>
${SVG_STYLE}
  </style>
  ${inner}
</svg>`
  return { svg, bom: elecJsonToBom(doc), doc, inner, pageW: W, pageH: H }
}

const SVG_STYLE = `    svg { font-family: "Source Han Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif; }
    line, rect, circle { stroke: #141414; stroke-width: 0.4; fill: none; }
    .bus { stroke-width: 1.0; }
    .bus-r { stroke: #8b1a1a; }
    .bus-s { stroke: #1a5c8b; }
    .bus-t { stroke: #3d6b1f; }
    .pe { stroke-width: 0.85; stroke-dasharray: 2.5 1; stroke: #5a5a5a; }
    .drop { stroke-width: 0.45; }
    .sym-bg { fill: #fbf8f1; stroke: none; }
    .tag { font-size: 2.8px; fill: #141414; stroke: none; font-weight: 600; }
    .rating, .desc, .wire, .io, .tb-val, .col-idx, .m-sub { font-size: 2.2px; fill: #222; stroke: none; }
    .desc { fill: #444; }
    .tb-label { font-size: 2px; fill: #555; stroke: none; }
    .rail { font-size: 2.6px; fill: #141414; stroke: none; font-weight: 600; }
    .m-mark, .box-mark { font-size: 4px; fill: #141414; stroke: none; font-weight: 700; }
    .io-rule { stroke: #cfc8bb; stroke-width: 0.25; }
    .page-mark { font-size: 3.2px; fill: #333; stroke: none; }
    .book-toc { font-size: 3px; fill: #141414; stroke: none; }
    .book-gap { fill: #e8e4db; stroke: none; }`

/**
 * 多页图册数据（每页独立 A3，供 PDF/HTML 分页；不再竖拼成长图）。
 */
export function renderElecBook(docs = []) {
  const list = (Array.isArray(docs) ? docs : []).map((d) => normalizeElecJson(d)).filter(Boolean)
  if (!list.length) {
    return { pages: [], bom: [], docs: [], pageCount: 0, title: '', html: '', svg: '' }
  }
  const pages = list.map((d, i) => {
    const rendered = renderElecSvg({
      ...d,
      page: { ...(d.page || {}), of: list.length, no: d.page?.no || i + 1 },
    })
    return {
      ...rendered,
      pageNo: i + 1,
      pageOf: list.length,
      title: d.page?.title || `第${i + 1}页`,
    }
  })
  const bom = pages.flatMap((p) => p.bom || [])
  const machine = list[0]?.project?.machine || '电路图册'
  const title = `${machine} 整本电路图（${pages.length} 页）`
  const html = buildBookHtml(title, pages)
  return {
    pages,
    bom,
    docs: list,
    pageCount: pages.length,
    title,
    pageW: W,
    pageH: H,
    html,
    /** 对话预览用首页，不是竖长图 */
    svg: pages[0]?.svg || '',
  }
}

function buildBookHtml(title, pages) {
  const n = pages.length
  const pageDivs = pages
    .map((p, i) => {
      const innerSvg = String(p.svg || '').replace(/^<\?xml[^>]*>\s*/i, '')
      return `<section class="page" data-page="${i + 1}" aria-label="${esc(p.title)}">${innerSvg}<div class="footer">-- ${i + 1} of ${n} -- · ${esc(p.title)}</div></section>`
    })
    .join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  @page { size: A3 landscape; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #2a2a2a; color: #eee;
    font-family: "Microsoft YaHei", "Source Han Sans SC", sans-serif; }
  .toolbar { position: sticky; top: 0; z-index: 5; background: #1a1a1a; padding: 10px 16px;
    display: flex; gap: 12px; align-items: center; border-bottom: 1px solid #444; }
  .toolbar button { cursor: pointer; padding: 6px 12px; }
  .stage { padding: 16px 0 40px; }
  .page {
    position: relative;
    width: 420mm; height: 297mm;
    margin: 0 auto 16px auto;
    background: #fbf8f1;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    box-shadow: 0 4px 18px rgba(0,0,0,.35);
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page > svg { width: 420mm; height: 297mm; display: block; }
  .footer {
    position: absolute; left: 0; right: 0; bottom: 2mm;
    text-align: center; font-size: 11px; color: #333; pointer-events: none;
  }
  @media print {
    html, body { background: #fff; }
    .toolbar { display: none !important; }
    .stage { padding: 0; }
    .page { margin: 0; box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <strong>${esc(title)}</strong>
    <span>共 ${n} 页 · 一页一页翻（不是竖长图）</span>
    <button type="button" onclick="prevPage()">上一页</button>
    <button type="button" onclick="nextPage()">下一页</button>
    <span id="pos">1 / ${n}</span>
  </div>
  <div class="stage" id="stage">${pageDivs}</div>
<script>
  const pages = [...document.querySelectorAll('.page')];
  let i = 0;
  function show(k) {
    i = Math.max(0, Math.min(pages.length - 1, k));
    pages[i].scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('pos').textContent = (i + 1) + ' / ' + pages.length;
  }
  function prevPage() { show(i - 1); }
  function nextPage() { show(i + 1); }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevPage();
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') nextPage();
  });
</script>
</body>
</html>`
}

/**
 * IEC 60617 风格符号（确定性 SVG 片段，不是模型手绘）。
 * 坐标单位：图纸 mm。
 * 标签规则：位号在符号上方留空；额定/说明在符号下方，互不压线。
 */

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return `${t.slice(0, Math.max(0, n - 1))}…`
}

export function symbolSize(sym) {
  if (sym === 'io') return { w: 28, h: 22 }
  if (sym === 'vfd' || sym === 'servo' || sym === 'transformer' || sym === 'psu') return { w: 22, h: 28 }
  if (sym === 'motor3') return { w: 18, h: 22 }
  if (sym === 'breaker3' || sym === 'breaker') return { w: 16, h: 24 }
  if (sym === 'fuse') return { w: 14, h: 22 }
  if (sym === 'contactor' || sym === 'contactor3') return { w: 16, h: 22 }
  return { w: 14, h: 20 }
}

/** 符号上下留给文字的高度（位号上 / 额定+说明下） */
export function labelPad() {
  return { above: 5.5, below: 9 }
}

export function drawSymbol(sym, x, y, d = {}) {
  const tag = esc(d.tag)
  const size = symbolSize(sym)
  const pad = 1.2
  const bg = `<rect class="sym-bg" x="${x - pad}" y="${y - pad}" width="${size.w + pad * 2}" height="${size.h + pad * 2}" />`
  const g = (body) =>
    `<g class="sym" data-tag="${tag}">${bg}${body}${label(x, y, d, size)}</g>`
  switch (sym) {
    case 'breaker3':
    case 'breaker':
      return g(breaker3(x, y))
    case 'fuse':
      return g(fuse(x, y))
    case 'transformer':
      return g(transformer(x, y))
    case 'contactor':
    case 'contactor3':
      return g(contactor3(x, y))
    case 'motor3':
      return g(motor3(x, y))
    case 'vfd':
    case 'servo':
      return g(drive(x, y, sym === 'servo' ? 'SV' : 'VFD'))
    case 'psu':
      return g(psu(x, y))
    case 'io':
      return g(ioModule(x, y, d))
    case 'relay':
      return g(relay(x, y))
    default:
      return g(genericBox(x, y, d))
  }
}

function label(x, y, d, size) {
  const cx = x + size.w / 2
  const tag = clip(d.tag, 12)
  const rating = clip(d.rating, 16)
  const desc = clip(d.desc, 14)
  let s = ''
  // 位号：符号正上方，避开母线（调用方需预留 above pad）
  if (tag) {
    s += `<text x="${cx}" y="${y - 2}" text-anchor="middle" class="tag">${esc(tag)}</text>`
  }
  // 额定：符号正下方
  let by = y + size.h + 3.2
  if (rating) {
    s += `<text x="${cx}" y="${by}" text-anchor="middle" class="rating">${esc(rating)}</text>`
    by += 3.2
  }
  // 说明：再下一行，短截断，避免串列
  if (desc && desc !== tag && desc !== rating) {
    s += `<text x="${cx}" y="${by}" text-anchor="middle" class="desc">${esc(desc)}</text>`
  }
  return s
}

function breaker3(x, y) {
  const w = 16
  const h = 24
  const poles = [3, 8, 13]
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#111" stroke-width="0.35" />`
  for (const px of poles) {
    const cx = x + px
    s += `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + 5}" />`
    s += `<line x1="${cx}" y1="${y + 5}" x2="${cx + 3.2}" y2="${y + 11}" />`
    s += `<line x1="${cx}" y1="${y + 13}" x2="${cx}" y2="${y + h}" />`
    s += `<circle cx="${cx}" cy="${y + 5}" r="0.7" fill="#111" />`
    s += `<circle cx="${cx}" cy="${y + 13}" r="0.7" fill="#111" />`
  }
  s += `<line x1="${x + 3}" y1="${y + 8}" x2="${x + 13}" y2="${y + 8}" />`
  return s
}

function fuse(x, y) {
  const cx = x + 7
  return (
    `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + 5}" />` +
    `<rect x="${cx - 2.2}" y="${y + 5}" width="4.4" height="12" fill="#fff" stroke="#111" />` +
    `<line x1="${cx}" y1="${y + 17}" x2="${cx}" y2="${y + 22}" />`
  )
}

function transformer(x, y) {
  const cx = x + 11
  return (
    `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + 4}" />` +
    `<circle cx="${cx}" cy="${y + 9}" r="5" fill="#fff" />` +
    `<circle cx="${cx}" cy="${y + 16}" r="5" fill="#fff" />` +
    `<line x1="${cx}" y1="${y + 21}" x2="${cx}" y2="${y + 28}" />`
  )
}

function contactor3(x, y) {
  const w = 16
  const h = 22
  const poles = [3, 8, 13]
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#111" stroke-width="0.35" />`
  for (const px of poles) {
    const cx = x + px
    s += `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + 6}" />`
    s += `<line x1="${cx}" y1="${y + 6}" x2="${cx + 4}" y2="${y + 12}" />`
    s += `<line x1="${cx}" y1="${y + 14}" x2="${cx}" y2="${y + h}" />`
    s += `<circle cx="${cx}" cy="${y + 6}" r="0.7" fill="#111" />`
    s += `<circle cx="${cx}" cy="${y + 14}" r="0.7" fill="#111" />`
  }
  return s
}

function contactor(x, y) {
  const cx = x + 7
  return (
    `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + 6}" />` +
    `<line x1="${cx}" y1="${y + 6}" x2="${cx + 4}" y2="${y + 12}" />` +
    `<line x1="${cx}" y1="${y + 14}" x2="${cx}" y2="${y + 22}" />` +
    `<circle cx="${cx}" cy="${y + 6}" r="0.7" fill="#111" />` +
    `<circle cx="${cx}" cy="${y + 14}" r="0.7" fill="#111" />`
  )
}

function motor3(x, y) {
  const cx = x + 9
  const cy = y + 12
  const poles = [cx - 4, cx, cx + 4]
  let s = ''
  for (const px of poles) {
    s += `<line x1="${px}" y1="${y}" x2="${px}" y2="${cy - 8}" />`
  }
  s +=
    `<circle cx="${cx}" cy="${cy}" r="8" fill="#fff" stroke-width="0.5" />` +
    `<text x="${cx}" y="${cy + 1.2}" text-anchor="middle" class="m-mark">M</text>` +
    `<text x="${cx}" y="${cy + 5.2}" text-anchor="middle" class="m-sub">3~</text>`
  for (const px of poles) {
    s += `<circle cx="${px}" cy="${y}" r="0.55" fill="#111" />`
  }
  return s
}

function drive(x, y, mark) {
  return (
    `<line x1="${x + 11}" y1="${y}" x2="${x + 11}" y2="${y + 3}" />` +
    `<rect x="${x}" y="${y + 3}" width="22" height="22" fill="#fff" />` +
    `<text x="${x + 11}" y="${y + 16}" text-anchor="middle" class="box-mark">${esc(mark)}</text>` +
    `<line x1="${x + 11}" y1="${y + 25}" x2="${x + 11}" y2="${y + 28}" />`
  )
}

function psu(x, y) {
  return (
    `<line x1="${x + 11}" y1="${y}" x2="${x + 11}" y2="${y + 3}" />` +
    `<rect x="${x}" y="${y + 3}" width="22" height="20" fill="#fff" />` +
    `<text x="${x + 11}" y="${y + 12}" text-anchor="middle" class="box-mark">PS</text>` +
    `<text x="${x + 11}" y="${y + 17}" text-anchor="middle" class="rating">24V</text>` +
    `<line x1="${x + 11}" y1="${y + 23}" x2="${x + 11}" y2="${y + 26}" />`
  )
}

function ioModule(x, y, d) {
  const title = clip(d.desc || d.tag || 'I/O', 10)
  return (
    `<rect x="${x}" y="${y}" width="28" height="22" fill="#fff" />` +
    `<text x="${x + 14}" y="${y + 13}" text-anchor="middle" class="tag">${esc(title)}</text>`
  )
}

function relay(x, y) {
  const cx = x + 7
  return (
    `<rect x="${cx - 4}" y="${y + 4}" width="8" height="14" fill="#fff" />` +
    `<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + 4}" />` +
    `<line x1="${cx}" y1="${y + 18}" x2="${cx}" y2="${y + 22}" />`
  )
}

function genericBox(x, y, d) {
  const mark = clip(d.tag || '?', 6)
  return (
    `<rect x="${x}" y="${y}" width="14" height="18" fill="#fff" />` +
    `<text x="${x + 7}" y="${y + 11}" text-anchor="middle" class="rating">${esc(mark)}</text>`
  )
}

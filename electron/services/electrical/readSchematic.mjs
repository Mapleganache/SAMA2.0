/**
 * 从 EPLAN 导出的 PDF 文本还原页目录与元件（看不清的标 uncertain）。
 */
import { emptyElecJson } from './elecJson.mjs'

const PAGE_MARK = /--\s*(\d+)\s+of\s+(\d+)\s*--/i

export function splitSchematicPages(text) {
  const src = String(text || '')
  const parts = src.split(PAGE_MARK)
  // split keeps captures: [pre, n, of, body, n, of, body...]
  const pages = []
  for (let i = 1; i + 1 < parts.length; i += 3) {
    const no = Number(parts[i])
    const of = Number(parts[i + 1])
    const body = String(parts[i + 2] || '')
    pages.push({ no, of, body })
  }
  return pages
}

export function parseToc(pages) {
  const tocPage = pages.find((p) => /目录/.test(p.body)) || pages[1]
  const items = []
  if (!tocPage) return items
  for (const line of String(tocPage.body || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    let m = trimmed.match(/^\/(\d+)\s+(.+)$/)
    if (m) {
      const no = Number(m[1])
      const title = m[2].replace(/\s+/g, ' ').trim()
      if (no && title && title.length <= 60) items.push({ no, title })
      continue
    }
    m = trimmed.match(/^=[A-Z0-9]+\/\d+\s+(.+)$/i)
    if (m) {
      const title = m[1].replace(/\s+/g, ' ').trim()
      if (title && title.length <= 80) items.push({ no: items.length + 1, title })
    }
  }
  const seen = new Set()
  return items.filter((it) => {
    if (seen.has(it.no)) return false
    seen.add(it.no)
    return true
  })
}

function pageKind(title) {
  if (/I\/O|IO\s*UNIT/i.test(title)) return 'io'
  if (/电机|主回路/.test(title)) return 'motor'
  if (/控制/.test(title)) return 'control'
  if (/伺服|变频|CNC/.test(title)) return 'drive'
  if (/目录/.test(title)) return 'toc'
  if (/封面|标题/.test(title)) return 'cover'
  return 'power'
}

function extractProject(text) {
  const src = String(text || '')
  const machine =
    (src.match(/FAVRETTO\s+MC\d+/i) || [])[0] ||
    (src.match(/MIKROSA\s+SASL[^\n]{0,24}/i) || [])[0] ||
    (src.match(/STUDER[^\n]{0,24}/i) || [])[0] ||
    ''
  const control = (src.match(/FANUC\s+[0-9A-Z]+/i) || [])[0] || ''
  const serial = (src.match(/SEI?AL\s*NO\.?\s*(\d+)/i) || [])[1] || ''
  const origin = (src.match(/CCFLO\s*\+?/) || [])[0] || ''
  const drawing =
    (src.match(/S40[-\s]?\d+\s+\d+/i) || [])[0] ||
    (src.match(/MIKROSA\s+SASL3\/1\s+AE/i) || [])[0] ||
    String(machine).trim() ||
    ''
  return {
    machine: String(machine).replace(/\s+/g, ' ').trim(),
    control: String(control).trim(),
    serial: String(serial).trim(),
    origin: String(origin).trim(),
    drawing: String(drawing).replace(/\s+/g, ' ').trim(),
  }
}

const TAG_RE = /\b(\d[A-Z]{1,3}\d{1,3}|T\d)\b/g

function keepDeviceTag(tag, body, idx = -1) {
  if (/^\d{0,2}L\d+$/i.test(tag)) return false
  if (/^\d[UVW]\d+$/i.test(tag)) return false
  if (/^T0$/i.test(tag) && idx >= 0) {
    const ctx = String(body || '').slice(Math.max(0, idx - 24), idx + 36)
    if (/R0|S0|T0\s+[RST]\b/i.test(ctx)) return false
  }
  return true
}

function extractDevices(body) {
  const tags = []
  const seen = new Set()
  let m
  while ((m = TAG_RE.exec(body))) {
    const tag = m[1]
    if (seen.has(tag) || !keepDeviceTag(tag, body, m.index)) continue
    seen.add(tag)
    tags.push(tag)
  }
  const ratings = {}
  const rateRe = /(\d[A-Z]{1,3}\d{1,3})\s*\n\s*([\d.]+\s*(?:A|KVA|KW|VDC|VAC)?)/gi
  let r
  while ((r = rateRe.exec(body))) {
    ratings[r[1]] = r[2].replace(/\s+/g, '')
  }
  return tags.slice(0, 24).map((tag) => ({
    tag,
    sym: guessSym(tag, body),
    rating: ratings[tag] || nearbyRating(tag, body),
    desc: '',
    wiresIn: [],
    wiresOut: [],
  }))
}

function nearbyRating(tag, body) {
  const idx = body.indexOf(tag)
  if (idx < 0) return ''
  const win = body.slice(idx, idx + 80)
  const m = win.match(/(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\s*(?:A|KVA|kW|VDC))/i)
  return m ? m[1].replace(/\s+/g, '') : ''
}

function guessSym(tag, body) {
  if (/^[-]?\d?Q/i.test(tag) || /Q\d/.test(tag)) return 'breaker3'
  if (/F\d/.test(tag)) return 'fuse'
  if (/T\d/.test(tag)) return 'transformer'
  if (/U\d|A\d/.test(tag) && /24VDC|电源/.test(body)) return 'psu'
  if (/M\d/.test(tag)) return 'motor3'
  if (/K\d/.test(tag)) return 'contactor'
  return 'other'
}

function extractIo(body) {
  const rows = []
  const re = /\b(X\d{1,3}(?:\.\d)?|Y\d{1,3}(?:\.\d)?)\b/g
  const names = body.split(/\n/)
  let m
  const seen = new Set()
  while ((m = re.exec(body))) {
    const addr = m[1]
    if (seen.has(addr)) continue
    seen.add(addr)
    const line = names.find((l) => l.includes(addr)) || ''
    rows.push({
      addr,
      name: line.replace(addr, '').replace(/\s+/g, ' ').trim().slice(0, 20),
      term: '',
      xref: (body.slice(m.index, m.index + 40).match(/\/\d+\.\d/) || [''])[0],
      module: '',
    })
    if (rows.length >= 24) break
  }
  return rows
}

function extractRails(body) {
  const rails = []
  for (const id of ['L1', 'L2', 'L3', 'PE', 'LM0', 'L02', 'P04', 'ZM0']) {
    if (new RegExp(`\\b${id}\\b`).test(body)) {
      rails.push({ id, label: id, type: id === 'PE' ? 'pe' : 'phase' })
    }
  }
  if (!rails.length) {
    return [
      { id: 'L1', label: 'L1', type: 'phase' },
      { id: 'L2', label: 'L2', type: 'phase' },
      { id: 'L3', label: 'L3', type: 'phase' },
      { id: 'PE', label: 'PE', type: 'pe' },
    ]
  }
  return rails.slice(0, 6)
}

function sheetTitleFromBlock(body) {
  const m = String(body || '').match(/替换人\s*\r?\n\s*([^\r\n]+)/)
  const t = (m?.[1] || '').replace(/\s+/g, ' ').trim()
  return t && t.length < 80 ? t : ''
}

function drawingPageNo(body) {
  const m = String(body || '').match(/\n\s*(\d+)\s*\/\s*\n/)
  return m ? Number(m[1]) : 0
}

function pageMeta(p) {
  const blockTitle = sheetTitleFromBlock(p?.body || '')
  const drawNo = drawingPageNo(p?.body || '') || p?.no || 0
  return { blockTitle, drawNo }
}

export function schematicFromPdfText(text, opts = {}) {
  const pages = splitSchematicPages(text)
  const project = extractProject(text)
  const toc = parseToc(pages)
  const wanted = Number(opts.page || 0)
  const byDrawing = (n) => pages.find((p) => drawingPageNo(p.body) === n)
  const byTitle = (title) =>
    pages.find((p) => {
      const t = sheetTitleFromBlock(p.body)
      return t === title || t.startsWith(title)
    })

  const selected =
    (wanted && (byDrawing(wanted) || pages.find((p) => p.no === wanted))) ||
    byTitle('主回路1') ||
    byDrawing(3) ||
    pages.find((p) => p.no > 1) ||
    pages[0]

  const meta = pageMeta(selected)
  const titleFromToc = toc.find((t) => t.no === meta.drawNo)?.title || meta.blockTitle || guessTitle(selected?.body || '')
  const kind = pageKind(titleFromToc)
  const devices = extractDevices(selected?.body || '')
  const columns = devices.map((d, i) => ({ i: i % 10, devices: [d] }))
  const merged = []
  for (const col of columns) {
    const hit = merged.find((c) => c.i === col.i)
    if (hit) hit.devices.push(...col.devices)
    else merged.push({ ...col, devices: [...col.devices] })
  }

  const doc = emptyElecJson({
    project,
    page: {
      no: meta.drawNo || selected?.no || 1,
      of: selected?.of || pages.length || 1,
      title: titleFromToc,
      kind,
    },
    rails: extractRails(selected?.body || ''),
    columns: merged,
    io: kind === 'io' ? extractIo(selected?.body || '') : [],
    notes: [`从 PDF 文本还原，共 ${pages.length} 页。符号按位号推断，需对照原图。`],
    uncertain: devices.length < 3 ? ['元件识别偏少，PDF 为图形导出时文字可能散乱'] : [],
  })

  const tocOut =
    toc.length > 0
      ? toc
      : pages
          .map((p) => {
            const m = pageMeta(p)
            const title = m.blockTitle || guessTitle(p.body)
            return {
              no: m.drawNo || p.no,
              title,
            }
          })
          .filter((p) => p.title)

  return {
    doc,
    toc: tocOut,
    pages: pages.map((p) => {
      const m = pageMeta(p)
      return {
        no: m.drawNo || p.no,
        of: p.of,
        title: m.blockTitle || toc.find((t) => t.no === m.drawNo)?.title || guessTitle(p.body),
      }
    }),
    project,
  }
}

function guessTitle(body) {
  const block = sheetTitleFromBlock(body)
  if (block) return block
  if (/主回路1/.test(body)) return '主回路1'
  if (/主回路2/.test(body)) return '主回路2'
  if (/冷却站/.test(body)) return '冷却站'
  if (/直流电源/.test(body)) return '直流电源回路'
  if (/控制回路1/.test(body)) return '控制回路1'
  if (/目录/.test(body)) return '目录'
  if (/I\/O UNIT/.test(body)) return 'I/O UNIT'
  return ''
}

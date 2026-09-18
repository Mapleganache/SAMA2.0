/**
 * 从 PDF 文本页级解析电源/控制/I/O 描述（程序化出图用）。
 */
import { splitSchematicPages } from './readSchematic.mjs'

export function normIo(addr) {
  const m = String(addr || '')
    .trim()
    .toUpperCase()
    .match(/^([XY])(\d+)\.(\d+)$/)
  if (!m) return ''
  return `${m[1]}${Number(m[2])}.${Number(m[3])}`
}

function expandRange(prefix, major, minorStart, minorEnd) {
  const out = []
  for (let m = minorStart; m <= minorEnd; m++) out.push(normIo(`${prefix}${major}.${m}`))
  return out
}

export function ioAddrsFromPageTitle(title) {
  const addrs = []
  const src = String(title || '')
  const re = /\b([XY])(\d+)\.(\d+)\s*-\s*\1(\d+)\.(\d+)/gi
  let m
  while ((m = re.exec(src))) {
    const prefix = m[1].toUpperCase()
    const majA = Number(m[2])
    const minA = Number(m[3])
    const majB = Number(m[4])
    const minB = Number(m[5])
    if (majA === majB) {
      addrs.push(...expandRange(prefix, majA, minA, minB))
    } else {
      addrs.push(...expandRange(prefix, majA, minA, 7))
      addrs.push(...expandRange(prefix, majB, 0, minB))
    }
  }
  return [...new Set(addrs.filter(Boolean))]
}

export function pageIoTitle(body) {
  const m = body.match(/I\/O UNIT[^\n]*/i)
  if (!m) return ''
  let t = m[0]
  const after = body.slice(m.index + m[0].length, m.index + m[0].length + 80)
  const extra = after.match(/[XY]\d+\.\d+\s*-\s*[XY]\d+\.\d+\S*/i)
  if (extra) t += ` ${extra[0]}`
  return t.replace(/\s+/g, ' ').trim()
}

export function findContentPage(pages, re) {
  const hits = pages.filter((p) => re.test(p.body))
  return (
    hits.find((p) => /YLT[\s\t]+/.test(p.body) && !/目录\s*:/.test(p.body)) ||
    hits.find((p) => !/目录/.test(p.body)) ||
    hits[0]
  )
}

export function ratingNearTag(body, tag) {
  const idx = body.search(new RegExp(`\\b${tag}\\b`))
  if (idx < 0) return ''
  const afterLine = body
    .slice(idx + tag.length)
    .replace(/^\s*\r?\n/, '')
    .split(/\r?\n/)[0]
    ?.trim()
  const ma = afterLine?.match(/^(\d+(?:\.\d+)?)\s*A$/i)
  if (ma) return `${ma[1]}A`
  const beforeLine = body
    .slice(0, idx)
    .trimEnd()
    .split(/\r?\n/)
    .pop()
    ?.trim()
  const mb = beforeLine?.match(/^(\d+(?:\.\d+)?)\s*A$/i)
  return mb ? `${mb[1]}A` : ''
}

/** 电源页 Q1–Q11、KA34/35 等 */
export function parsePowerPageDevices(body) {
  const src = String(body || '')
  const order = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q7', 'Q8', 'Q9', 'Q10', 'Q11']
  const descMap = {
    Q1: '进线/伺服电源',
    Q2: '主回路进线',
    Q3: '控制变压器一次',
    Q4: 'DC24V 分支',
    Q5: 'DC24V 分支',
    Q7: '24P1 分支',
    Q8: '24P2 分支',
    Q9: '110V 分支',
    Q10: '退磁/磁力控制',
    Q11: '退磁/磁力控制',
  }
  const devices = []
  const seen = new Set()
  for (const tag of order) {
    if (!new RegExp(`\\b${tag}\\b`).test(src) || seen.has(tag)) continue
    seen.add(tag)
    devices.push({
      tag,
      sym: 'breaker3',
      rating: ratingNearTag(src, tag),
      desc: descMap[tag] || '',
    })
  }
  if (/\bT1\b/.test(src)) {
    devices.push({
      tag: 'T1',
      sym: 'transformer',
      rating: /15KVA/i.test(src) ? '15KVA' : '',
      desc: /380\/110V/.test(src) ? '380/110V' : '380/220V',
    })
  }
  for (const m of src.matchAll(/\bKA(3[45])\b/gi)) {
    const tag = `KA${m[1]}`.toUpperCase()
    if (seen.has(tag)) continue
    seen.add(tag)
    const idx = m.index ?? 0
    const block = src.slice(idx, idx + 100)
    const desc = (block.match(/[\u4e00-\u9fff]{2,8}/) || [])[0] || '电源继电器'
    devices.push({ tag, sym: 'relay', rating: '', desc })
  }
  return devices
}

/** MIKROSA SASL32 主回路1：位号带数字前缀（1Q1、1T3、T2…） */
export function parseMikrosaPower1Columns(body) {
  const src = String(body || '')
  if (!/\b1Q1\b/.test(src)) return []
  const order = [
    { tag: '1Q1', sym: 'breaker3', desc: '伺服电源', wiresOut: ['1U1', '1V1', '1W1'] },
    { tag: '1Q13', sym: 'breaker3', wiresOut: ['1L1', '1L2', '1L3'] },
    { tag: '1F123', sym: 'fuse', wiresOut: ['2L1', '2L2', '2L3'] },
    { tag: '1T3', sym: 'transformer', desc: '220V', wiresOut: ['LM0'] },
    { tag: '1F9', sym: 'fuse', wiresOut: ['L02'] },
    { tag: 'T2', sym: 'transformer', desc: '380/220VAC', wiresOut: ['R200', 'S200', 'T200'] },
    { tag: '1F60', sym: 'fuse', wiresIn: ['R200', 'S200', 'T200'] },
    { tag: '1A1', sym: 'psu', desc: '直流电源', wiresOut: ['P22'] },
  ]
  const cols = []
  let i = 0
  for (const spec of order) {
    if (!new RegExp(`\\b${spec.tag}\\b`).test(src)) continue
    const device = {
      tag: spec.tag,
      sym: spec.sym,
      rating: ratingNearTag(src, spec.tag) || spec.rating || '',
      desc: spec.desc || '',
      wiresIn: spec.wiresIn || ['L1', 'L2', 'L3'],
      wiresOut: spec.wiresOut || [],
    }
    if (spec.tag === 'T2') device.wiresIn = ['L1', 'L2', 'L3']
    cols.push({ i: i++, devices: [device] })
  }
  return cols
}

export function wirePowerColumns(devices) {
  const cols = []
  let i = 0
  const pendingDc = []
  const byTag = new Map(devices.map((d) => [d.tag, d]))
  const q1 = byTag.get('Q1')
  if (q1) {
    cols.push({
      i: i++,
      devices: [{ ...q1, wiresIn: ['R', 'S', 'T'], wiresOut: ['R1', 'S1', 'T1'] }],
    })
  }
  const q2 = byTag.get('Q2')
  if (q2) {
    cols.push({
      i: i++,
      devices: [{ ...q2, wiresIn: ['R', 'S', 'T'], wiresOut: ['R1', 'S1', 'T1'] }],
    })
  }
  const q3 = byTag.get('Q3')
  const t1 = byTag.get('T1')
  if (q3 && t1) {
    cols.push({
      i: i++,
      devices: [
        { ...q3, wiresIn: ['R1', 'S1', 'T1'], wiresOut: ['R200', 'S200', 'T200'] },
        { ...t1, wiresIn: ['R200', 'S200', 'T200'], wiresOut: ['R220', 'S220'] },
      ],
    })
  } else if (q3) {
    cols.push({
      i: i++,
      devices: [{ ...q3, wiresIn: ['R1', 'S1', 'T1'], wiresOut: ['R200', 'S200', 'T200'] }],
    })
  }
  for (const tag of ['Q4', 'Q5', 'Q7', 'Q8', 'Q9', 'Q10', 'Q11']) {
    const d = byTag.get(tag)
    if (!d) continue
    const rail = /^Q[789]/.test(tag) ? '24P1' : /^Q1[01]/.test(tag) ? 'R15' : '24P1'
    pendingDc.push({ ...d, wiresIn: [rail, '0V'], wiresOut: ['24P2'] })
  }
  if (pendingDc.length) {
    if (pendingDc.length >= 2 && pendingDc[0].tag === 'Q4' && pendingDc[1].tag === 'Q5') {
      const q4 = { ...pendingDc[0] }
      const q5 = { ...pendingDc[1], wiresIn: ['24P2', '0V'], wiresOut: ['24P2'] }
      cols.push({ i: i++, devices: [q4, q5] })
      for (const d of pendingDc.slice(2)) cols.push({ i: i++, devices: [d] })
    } else {
      for (const d of pendingDc) cols.push({ i: i++, devices: [d] })
    }
  }
  const kas = devices.filter((d) => /^KA3[45]$/.test(d.tag)).sort((a, b) => a.tag.localeCompare(b.tag))
  if (kas.length >= 2) {
    cols.push({
      i: i++,
      devices: [
        { ...kas[0], wiresIn: ['24P1'], wiresOut: ['KA_N'] },
        { ...kas[1], wiresIn: ['KA_N'], wiresOut: ['0V'] },
      ],
    })
  } else if (kas.length === 1) {
    cols.push({
      i: i++,
      devices: [{ ...kas[0], wiresIn: ['24P1'], wiresOut: ['0V'] }],
    })
  }
  return cols.slice(0, 10)
}

/** 控制页 KM 线圈描述（优先电机页同源） */
export function kmCoilDesc(body, km, motorDescMap = new Map()) {
  if (motorDescMap.has(km)) return motorDescMap.get(km)
  const idx = body.search(new RegExp(`\\b${km}\\b`, 'i'))
  if (idx < 0) return ''
  const block = body.slice(idx, idx + 200)
  for (const line of block.split('\n').slice(1, 12)) {
    const t = line.trim()
    if (/^KM|^KA|^NC|^NO|^\//.test(t)) continue
    const m = t.match(/[\u4e00-\u9fff]{2,10}/)
    if (m) return m[0].replace(/\s+/g, '')
  }
  return ''
}

export function kaDescFromBody(body, ka) {
  const idx = body.search(new RegExp(`\\b${ka}\\b`, 'i'))
  if (idx < 0) return ''
  const block = body.slice(idx, idx + 120)
  for (const line of block.split('\n').slice(1, 8)) {
    const t = line.trim()
    if (/^KA|^SOL|^\/|^\d+$/.test(t)) continue
    const m = t.match(/[\u4e00-\u9fff]{2,12}/)
    if (m) return m[0].replace(/\s+/g, '')
  }
  return ''
}

function fallbackIoDesc(addr, pageTitle) {
  const kind = addr.startsWith('Y') ? '输出' : '输入'
  const unit = pageTitle.match(/CB10[56]-\d/i)?.[0] || 'I/O'
  return `${addr} ${unit}${kind}`
}

/** CB105-2：KM20–KM26 辅助触点 + 循环带灯 */
function parseCb1052Inputs(body, addrs) {
  const map = new Map()
  const lamps = []
  const flat = body.replace(/\s+/g, '')
  if (flat.includes('磨削循环')) lamps.push('磨削循环带灯')
  if (flat.includes('修整循环')) lamps.push('修整循环带灯')
  if (flat.includes('循环启动')) lamps.push('循环启动带灯')
  if (flat.includes('循环停止')) lamps.push('循环停止带灯')
  addrs.forEach((addr, i) => {
    const n = 20 + i
    if (i < 7 && n <= 26) map.set(addr, `KM${n}辅助触点`)
    else if (i - 7 < lamps.length) map.set(addr, lamps[i - 7])
  })
  return map
}

function parseCb1051Inputs(body) {
  const map = new Map()
  if (/\bE-STOP\b/i.test(body)) map.set('X3.0', 'E-STOP 急停')
  const flat = body.replace(/\n/g, ' ')
  if (/工作台/.test(flat) && /启动/.test(flat)) map.set('X3.1', '工作台启动')
  if (/工作台/.test(flat) && /向左/.test(flat)) map.set('X3.2', '工作台向左')
  if (/工作台/.test(flat) && /向右/.test(flat)) map.set('X3.3', '工作台向右')
  if (/功能/.test(flat) && /不详/.test(flat)) map.set('X3.4', '功能不详')
  return map
}

function parseYOutputPage(body, majorDigit) {
  const map = new Map()
  const kaRe = new RegExp(`\\bKA${majorDigit}(\\d)\\b\\s*\\n\\s*([^\\n]{1,24})`, 'g')
  let m
  while ((m = kaRe.exec(body))) {
    const addr = normIo(`Y${majorDigit}.${m[1]}`)
    const desc = String(m[2] || '')
      .replace(/\s+/g, '')
      .replace(/[\/\d.].*$/, '')
      .trim()
    if (addr && /[\u4e00-\u9fffA-Za-z]/.test(desc) && desc.length >= 2 && desc.length <= 16) {
      map.set(addr, desc)
    }
  }
  const singleRe = new RegExp(
    `Y${majorDigit}(\\d)\\s*\\n\\s*0V\\s*\\n\\s*([\\u4e00-\\u9fffA-Za-z][^\\n/]{2,20})`,
    'g',
  )
  while ((m = singleRe.exec(body))) {
    const addr = normIo(`Y${majorDigit}.${m[1]}`)
    const desc = m[2].replace(/\s+/g, '').trim()
    if (addr && desc && !map.has(addr)) map.set(addr, desc)
  }
  return map
}

function parseIoPageBody(body, title) {
  const addrs = ioAddrsFromPageTitle(title)
  if (!addrs.length) return new Map()
  const yMajor = title.match(/\bY(\d+)\./i)?.[1]
  if (yMajor) return parseYOutputPage(body, Number(yMajor))
  if (/X8\.5|CB105-2/.test(title + body)) return parseCb1052Inputs(body, addrs)
  if (/CB105-1|X3\.0/.test(title + body)) {
    const map = parseCb1051Inputs(body)
    for (const a of addrs) {
      if (!map.has(a)) map.set(a, fallbackIoDesc(a, title))
    }
    return map
  }
  if (/CB106-1|X4\.0/.test(title + body)) {
    const map = new Map()
    if (/MPG|手轮/.test(body)) map.set('X4.0', '手轮 MPG')
    for (const a of addrs) {
      if (!map.has(a)) map.set(a, fallbackIoDesc(a, title))
    }
    return map
  }
  const map = new Map()
  for (const a of addrs) map.set(a, fallbackIoDesc(a, title))
  return map
}

export function buildIoDescMapFromPdfPages(pdfText) {
  const map = new Map()
  for (const p of splitSchematicPages(String(pdfText || ''))) {
    if (!/I\/O UNIT/i.test(p.body) || !/TERM10[56]/i.test(p.body)) continue
    const title = pageIoTitle(p.body)
    for (const [addr, desc] of parseIoPageBody(p.body, title)) {
      if (!map.has(addr) || (desc && !/输入$|输出$/.test(map.get(addr)?.desc || ''))) {
        map.set(addr, { desc, page: title.slice(0, 60) })
      }
    }
  }
  return map
}

export function extractPowerPageTagSet(pdfText) {
  const pages = splitSchematicPages(String(pdfText || ''))
  const body = findContentPage(pages, /电源/)?.body || ''
  const tags = new Set(parsePowerPageDevices(body).map((d) => d.tag))
  return tags
}

export function extractPowerRatingsFromPdf(pdfText) {
  const pages = splitSchematicPages(String(pdfText || ''))
  const body = findContentPage(pages, /电源/)?.body || ''
  return {
    Q1: ratingNearTag(body, 'Q1') || '80A',
    Q2: ratingNearTag(body, 'Q2') || '63A',
  }
}

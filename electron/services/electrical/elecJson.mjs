/**
 * elec-json：电路图中间表示。视觉模型只填这个，出图由符号库渲染，禁止手绘 SVG。
 * 模型常写成 components/potentials，这里一律收成 rails + columns + io。
 */

export const ELEC_SYMS = new Set([
  'breaker3',
  'breaker',
  'fuse',
  'transformer',
  'contactor',
  'contactor3',
  'motor3',
  'terminal',
  'vfd',
  'servo',
  'psu',
  'io',
  'lamp',
  'pushbutton',
  'relay',
  'pe',
  'other',
])

const TYPE_MAP = {
  breaker: 'breaker3',
  breaker3: 'breaker3',
  mccb: 'breaker3',
  mcb: 'breaker3',
  q: 'breaker3',
  fuse: 'fuse',
  f: 'fuse',
  transformer: 'transformer',
  trafo: 'transformer',
  t: 'transformer',
  contactor: 'contactor',
  contactor3: 'contactor3',
  km: 'contactor',
  motor: 'motor3',
  motor3: 'motor3',
  servo_motor: 'motor3',
  servomotor: 'motor3',
  thermal_relay: 'relay',
  relay: 'relay',
  ka: 'relay',
  solenoid: 'other',
  sensor: 'other',
  servo: 'servo',
  servo_amp: 'servo',
  sv: 'servo',
  aisv: 'servo',
  svm: 'servo',
  vfd: 'vfd',
  inverter: 'vfd',
  psu: 'psu',
  power: 'psu',
  io: 'io',
  di: 'io',
  do: 'io',
  lamp: 'lamp',
  pushbutton: 'pushbutton',
  pe: 'pe',
  terminal: 'terminal',
}

export const ELEC_JSON_MOTOR_EXAMPLE =
  '{"kind":"elec-json","project":{"machine":"FAVRETTO MC160","control":"FANUC 0iTF"},"page":{"no":4,"of":16,"title":"电机","kind":"motor"},"rails":[{"id":"R","label":"R"},{"id":"S","label":"S"},{"id":"T","label":"T"},{"id":"PE","label":"PE","type":"pe"}],"columns":[{"i":0,"devices":[{"tag":"Q20","sym":"breaker3","rating":"60A","desc":"砂轮电机断路器","wiresIn":["R","S","T"],"wiresOut":["R20","S20","T20"]},{"tag":"KM20","sym":"contactor","desc":"砂轮电机接触器","wiresIn":["R20","S20","T20"],"wiresOut":["U1","V1","W1"]},{"tag":"M1","sym":"motor3","rating":"3~","desc":"砂轮电机","wiresIn":["U1","V1","W1"]}]}],"io":[],"uncertain":[]}'

export const ELEC_JSON_IO_EXAMPLE =
  '{"kind":"elec-json","project":{"machine":"FAVRETTO MC160","control":"FANUC 0iTF"},"page":{"no":9,"of":16,"title":"I/O UNIT CB105-1","kind":"io"},"rails":[{"id":"24P1","label":"24P1"},{"id":"0V","label":"0V"}],"columns":[],"io":[{"addr":"X3.0","desc":"E-STOP 急停","term":"TERM105-3"},{"addr":"X3.1","desc":"工作台启动","term":"TERM105-4"}],"uncertain":[]}'

export const ELEC_JSON_EXAMPLE = ELEC_JSON_MOTOR_EXAMPLE

export function emptyElecJson(partial = {}) {
  const project =
    typeof partial.project === 'string'
      ? { machine: partial.project, control: '', serial: '', origin: '', drawing: '' }
      : {
          machine: '',
          control: '',
          serial: '',
          origin: '',
          drawing: '',
          ...(partial.project || {}),
        }
  return {
    kind: 'elec-json',
    schemaVersion: 1,
    project,
    page: {
      no: 1,
      of: 1,
      title: '',
      kind: 'power',
      ...(partial.page || {}),
    },
    rails: Array.isArray(partial.rails) ? partial.rails : [],
    columns: Array.isArray(partial.columns) ? partial.columns : [],
    io: Array.isArray(partial.io) ? partial.io : [],
    xrefs: Array.isArray(partial.xrefs) ? partial.xrefs : [],
    notes: Array.isArray(partial.notes) ? partial.notes : [],
    uncertain: Array.isArray(partial.uncertain) ? partial.uncertain : [],
  }
}

function mapSym(raw) {
  const s = String(raw || '').trim()
  if (ELEC_SYMS.has(s)) return s
  const low = s.toLowerCase().replace(/[\s-]+/g, '_')
  if (TYPE_MAP[low]) return TYPE_MAP[low]
  if (/断路|空开|保护/.test(s)) return 'breaker3'
  if (/熔断|fuse/i.test(s)) return 'fuse'
  if (/变压/.test(s)) return 'transformer'
  if (/接触/.test(s)) return 'contactor'
  if (/伺服放大|svm|aisv|servo.?amp/i.test(s)) return 'servo'
  if (/变频|vfd|inverter/i.test(s)) return 'vfd'
  if (/电机|马达|motor/i.test(s)) return 'motor3'
  if (/电源|psu|24v/i.test(s)) return 'psu'
  if (/\b[xy]\d/i.test(s) || /i\/?o/i.test(s)) return 'io'
  return 'other'
}

function wiresFromComponent(x) {
  const inW = []
  const outW = []
  if (Array.isArray(x.wiresIn)) inW.push(...x.wiresIn.map(String))
  if (Array.isArray(x.wiresOut)) outW.push(...x.wiresOut.map(String))
  if (Array.isArray(x.powerIn)) inW.push(...x.powerIn.map(String))
  if (Array.isArray(x.powerOut)) outW.push(...x.powerOut.map(String))
  for (const c of x.connections || []) {
    if (c?.from) inW.push(String(c.from))
    if (c?.to) outW.push(String(c.to))
  }
  return {
    wiresIn: [...new Set(inW.filter(Boolean))],
    wiresOut: [...new Set(outW.filter(Boolean))],
  }
}

export function coerceLooseElecJson(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = { ...raw }

  if (typeof raw.project === 'string') {
    out.project = { machine: raw.project, control: '', serial: '', origin: '', drawing: '' }
  }
  const sheet = raw.sheet && typeof raw.sheet === 'object' ? raw.sheet : null
  if (sheet) {
    const noMatch = String(sheet.sheetNo || sheet.no || '').match(/(\d+)/)
    out.page = {
      no: Number(sheet.no || noMatch?.[1] || raw.page?.no || 1),
      of: Number(sheet.of || raw.page?.of || 20),
      title: String(sheet.title || raw.page?.title || ''),
      kind: String(raw.page?.kind || (/伺服|drive/i.test(sheet.title || '') ? 'drive' : 'power')),
    }
    out.project = {
      machine: String(sheet.machine || out.project?.machine || ''),
      control: String(sheet.control || out.project?.control || ''),
      serial: String(out.project?.serial || ''),
      origin: String(out.project?.origin || ''),
      drawing: String(sheet.drawing || out.project?.drawing || ''),
      ...(typeof out.project === 'object' ? out.project : {}),
    }
  }

  if ((!Array.isArray(out.rails) || !out.rails.length) && Array.isArray(raw.potentials)) {
    out.rails = raw.potentials.map((p) => ({
      id: String(p.id || p.name || ''),
      label: String(p.name || p.label || p.id || ''),
      type: /pe/i.test(String(p.id || p.name || p.voltage || '')) ? 'pe' : 'phase',
    }))
  }

  const looseList = []
  if (Array.isArray(raw.components)) looseList.push(...raw.components)
  if (Array.isArray(raw.devices)) looseList.push(...raw.devices)
  if ((!Array.isArray(out.columns) || !out.columns.length) && looseList.length) {
    out.columns = looseList.map((comp, i) => {
      const w = wiresFromComponent(comp)
      return {
        i,
        devices: [
          {
            tag: String(comp.tag || comp.id || ''),
            sym: mapSym(comp.sym || comp.type || comp.model || ''),
            rating: String(comp.rating || comp.model || ''),
            desc: String(comp.desc || comp.description || comp.label || ''),
            ...w,
          },
        ],
      }
    })
  }

  if ((!Array.isArray(out.io) || !out.io.length) && Array.isArray(raw.ioMapping)) {
    out.io = raw.ioMapping.map((row) => ({
      addr: String(row.addr || row.address || ''),
      desc: String(row.desc || row.name || row.signal || row.description || ''),
      name: String(row.desc || row.name || row.signal || row.description || ''),
      term: String(row.term || row.terminal || ''),
      xref: String(row.xref || ''),
      module: String(row.module || row.unit || ''),
    }))
  }

  return out
}

export function parseElecJsonBlocks(text) {
  const src = String(text || '')
  const out = []
  const re = /```elec-json\s*\r?\n([\s\S]*?)```/gi
  let m
  while ((m = re.exec(src))) {
    try {
      const obj = JSON.parse(m[1])
      if (obj && typeof obj === 'object') out.push(normalizeElecJson(obj))
    } catch {
      // skip
    }
  }
  return out
}

export function normalizeElecJson(raw) {
  const src = coerceLooseElecJson(raw && typeof raw === 'object' ? raw : {})
  const d = emptyElecJson(src)
  if (Array.isArray(src.devices) && !d.columns.length) {
    d.columns = [
      {
        i: 0,
        devices: src.devices.map((x) => normalizeDevice(x)),
      },
    ]
  }
  d.columns = (d.columns || []).map((col, i) => ({
    i: Number(col.i ?? i),
    devices: Array.isArray(col.devices) ? col.devices.map(normalizeDevice) : [],
  }))
  d.io = (d.io || []).map((row) => {
    const desc = String(row.desc || row.name || row.signal || '').trim()
    return {
      addr: String(row.addr || ''),
      desc,
      name: desc,
      term: String(row.term || ''),
      xref: String(row.xref || ''),
      module: String(row.module || ''),
    }
  })
  d.rails = (d.rails || []).map((r) => ({
    id: String(r.id || r.label || ''),
    label: String(r.label || r.id || ''),
    type: r.type === 'pe' || /pe/i.test(String(r.id || '')) ? 'pe' : String(r.type || 'phase'),
  }))
  if (Array.isArray(raw.wirePlan)) {
    d.wirePlan = raw.wirePlan.map((w, i) => ({
      step: Number(w.step ?? i + 1),
      wire: String(w.wire || ''),
      from: String(w.from || ''),
      to: String(w.to || ''),
      note: String(w.note || ''),
    }))
  }
  return d
}

function normalizeDevice(d) {
  const x = d && typeof d === 'object' ? d : {}
  const tag = String(x.tag || x.id || '').trim()
  const w = wiresFromComponent(x)
  return {
    tag,
    sym: mapSym(x.sym || x.type || 'other'),
    rating: String(x.rating || x.model || ''),
    desc: String(x.desc || x.label || x.description || ''),
    wiresIn: w.wiresIn,
    wiresOut: w.wiresOut,
  }
}

export function countDevices(doc) {
  return (doc?.columns || []).reduce((n, c) => n + (c.devices || []).filter((d) => d.tag).length, 0)
}

export function mergeElecJson(base, patch) {
  const a = normalizeElecJson(base || {})
  const b = normalizeElecJson(patch || {})
  const seen = new Set()
  for (const col of a.columns) {
    for (const d of col.devices || []) if (d.tag) seen.add(d.tag)
  }
  let nextI = a.columns.length
  for (const col of b.columns) {
    const fresh = (col.devices || []).filter((d) => d.tag && !seen.has(d.tag))
    if (!fresh.length) continue
    a.columns.push({ i: nextI, devices: fresh })
    nextI += 1
    fresh.forEach((d) => seen.add(d.tag))
  }
  const railIds = new Set(a.rails.map((r) => r.id))
  for (const r of b.rails) {
    if (r.id && !railIds.has(r.id)) {
      a.rails.push(r)
      railIds.add(r.id)
    }
  }
  const ioKeys = new Set(a.io.map((r) => r.addr))
  for (const row of b.io) {
    if (row.addr && !ioKeys.has(row.addr)) {
      a.io.push(row)
      ioKeys.add(row.addr)
    }
  }
  if (b.page?.title) a.page.title = b.page.title
  if (b.page?.kind && b.page.kind !== 'power') a.page.kind = b.page.kind
  if (b.project?.machine) a.project.machine = b.project.machine
  a.notes = [...new Set([...(a.notes || []), ...(b.notes || [])])]
  a.uncertain = [...new Set([...(a.uncertain || []), ...(b.uncertain || [])])]
  return a
}

export function looksLikeServoPatch(doc) {
  const title = String(doc?.page?.title || '')
  const kind = String(doc?.page?.kind || '')
  if (/主回路|直流电源|控制回路|冷却|I\/O|目录/.test(`${title} ${kind}`)) return false
  if (kind === 'power' || kind === 'control' || kind === 'io' || kind === 'toc') return false
  const t = `${title} ${kind} ${JSON.stringify(doc?.columns || [])}`
  return /伺服|C轴|SVM|工件回转|aiSV/i.test(t)
}

export function elecJsonToBom(doc) {
  const items = []
  for (const col of doc.columns || []) {
    for (const d of col.devices || []) {
      if (!d.tag) continue
      items.push({
        id: d.tag,
        type: d.sym,
        rating: d.rating,
        desc: d.desc,
        qty: 1,
      })
    }
  }
  return items
}

export function looksLikeElecTask(text) {
  return /电路图|原理图|主回路|控制回路|I\/O\s*UNIT|elec-json|EPLAN|配电柜|伺服放大器/i.test(
    String(text || ''),
  )
}

export function looksLikeElecEdit(text) {
  return /改电路|改图|增加.{0,8}(伺服|轴|回路|I\/O)|删除.{0,8}(功能|回路|轴)|加一[根个条]/.test(
    String(text || ''),
  )
}

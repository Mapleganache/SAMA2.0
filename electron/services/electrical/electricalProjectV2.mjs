import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import electron from 'electron'
import { htmlToPagedPdf } from './bookPdf.mjs'

const { app, dialog } = electron

export const ELECTRICAL_V2_SYMBOLS = [
  ['power', '电源'], ['breaker', '断路器'], ['fuse', '熔断器'], ['contactor', '接触器'],
  ['relay', '继电器'], ['pushbutton', '按钮'], ['limit', '限位开关'], ['sensor', '传感器'],
  ['motor', '电机'], ['vfd', '变频器'], ['servo', '伺服驱动'], ['plc', 'PLC I/O'],
  ['terminal', '端子'], ['shield', '屏蔽'], ['pe', '保护接地'],
]

const SYMBOL_NAMES = new Map(ELECTRICAL_V2_SYMBOLS)
const PIN_DEFAULTS = {
  power: [['L', 'out'], ['N', 'out']], breaker: [['1', 'in'], ['2', 'out']], fuse: [['1', 'in'], ['2', 'out']],
  contactor: [['A1', 'in'], ['A2', 'out']], relay: [['A1', 'in'], ['A2', 'out']],
  pushbutton: [['13', 'in'], ['14', 'out']], limit: [['13', 'in'], ['14', 'out']], sensor: [['1', 'in'], ['3', 'out']],
  motor: [['U', 'in'], ['V', 'in'], ['W', 'in'], ['PE', 'pe']], vfd: [['L1', 'in'], ['L2', 'in'], ['L3', 'in'], ['U', 'out'], ['V', 'out'], ['W', 'out']],
  servo: [['L1', 'in'], ['L2', 'in'], ['U', 'out'], ['V', 'out'], ['W', 'out']], plc: [['IN', 'in'], ['OUT', 'out']],
  terminal: [['1', 'passive'], ['2', 'passive']], shield: [['SH', 'passive'], ['PE', 'pe']], pe: [['PE', 'pe']],
}

const cleanText = (value, max = 200) => String(value ?? '').trim().slice(0, max)
const xml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const csv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
const slug = (value) => cleanText(value || 'SAMA电气工程', 80).replace(/[\\/:*?"<>|]/g, '_')
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function defaultPins(type) {
  return (PIN_DEFAULTS[type] || PIN_DEFAULTS.terminal).map(([id, role]) => ({ id, name: id, role }))
}

export function emptyElectricalProjectV2() {
  return normalizeElectricalProjectV2({
    name: '新建专业电路工程', machine: '', standard: 'IEC 60617',
    sheets: [{ id: 'S1', pageNo: 1, title: '控制回路', size: 'A3-L', devices: [], nets: [], wireSegments: [] }],
  })
}

export function sampleElectricalProjectV2() {
  return normalizeElectricalProjectV2({
    id: 'EP-SAMPLE', name: '电机启停控制示例', machine: '待填写', standard: 'IEC 60617',
    sourceRefs: [{ label: '演示工程，不代表现场机床', verificationStatus: '待现场核对' }],
    sheets: [{
      id: 'S1', pageNo: 1, title: '电机启停控制（示例）', size: 'A3-L',
      devices: [
        { id: 'D1', tag: 'Q1', type: 'breaker', description: '控制回路保护', x: 45, y: 55 },
        { id: 'D2', tag: 'S0', type: 'pushbutton', description: '停止', x: 105, y: 55 },
        { id: 'D3', tag: 'S1', type: 'pushbutton', description: '启动', x: 165, y: 55 },
        { id: 'D4', tag: 'KM1', type: 'contactor', description: '接触器线圈', x: 235, y: 55 },
        { id: 'D5', tag: 'M1', type: 'motor', description: '三相电机', x: 320, y: 55 },
      ],
      nets: [
        { id: 'N1', name: '待编号', connections: [{ deviceId: 'D1', pinId: '2' }, { deviceId: 'D2', pinId: '13' }], verificationStatus: '待现场核对' },
        { id: 'N2', name: '待编号', connections: [{ deviceId: 'D2', pinId: '14' }, { deviceId: 'D3', pinId: '13' }], verificationStatus: '待现场核对' },
        { id: 'N3', name: '待编号', connections: [{ deviceId: 'D3', pinId: '14' }, { deviceId: 'D4', pinId: 'A1' }], verificationStatus: '待现场核对' },
      ], wireSegments: [],
    }],
  })
}

export function normalizeElectricalProjectV2(raw = {}) {
  const now = new Date().toISOString()
  const project = {
    kind: 'ElectricalProject', schemaVersion: 2, id: cleanText(raw.id || uid('EP'), 100),
    name: cleanText(raw.name || '未命名电气工程'), machine: cleanText(raw.machine), standard: cleanText(raw.standard || 'IEC 60617'),
    description: cleanText(raw.description, 2000), createdAt: raw.createdAt || now, updatedAt: now,
    verificationStatus: cleanText(raw.verificationStatus || '待现场核对'),
    sourceRefs: Array.isArray(raw.sourceRefs) ? raw.sourceRefs.map((x) => ({ label: cleanText(x?.label), path: cleanText(x?.path, 1000), page: cleanText(x?.page), verificationStatus: cleanText(x?.verificationStatus || '待现场核对') })) : [],
    terminals: Array.isArray(raw.terminals) ? raw.terminals : [], cables: Array.isArray(raw.cables) ? raw.cables : [],
    plcIo: Array.isArray(raw.plcIo) ? raw.plcIo : [], crossReferences: Array.isArray(raw.crossReferences) ? raw.crossReferences : [],
    sheets: [],
  }
  const sheets = Array.isArray(raw.sheets) && raw.sheets.length ? raw.sheets : [{ id: 'S1', pageNo: 1, title: '控制回路' }]
  project.sheets = sheets.map((sheet, si) => ({
    id: cleanText(sheet.id || `S${si + 1}`, 100), pageNo: Number(sheet.pageNo || si + 1), title: cleanText(sheet.title || `第 ${si + 1} 页`), size: 'A3-L',
    devices: (Array.isArray(sheet.devices) ? sheet.devices : []).map((device, di) => {
      const type = SYMBOL_NAMES.has(device?.type) ? device.type : 'terminal'
      return {
        id: cleanText(device?.id || `${sheet.id || `S${si + 1}`}-D${di + 1}`, 100), tag: cleanText(device?.tag || `?${di + 1}`, 50), type,
        description: cleanText(device?.description, 300), manufacturer: cleanText(device?.manufacturer), partNo: cleanText(device?.partNo),
        rating: cleanText(device?.rating), x: Math.max(20, Math.min(385, Number(device?.x) || 40 + di * 50)), y: Math.max(30, Math.min(245, Number(device?.y) || 55)),
        rotation: [0, 90, 180, 270].includes(Number(device?.rotation)) ? Number(device.rotation) : 0,
        pins: Array.isArray(device?.pins) && device.pins.length ? device.pins.map((pin) => ({ id: cleanText(pin.id, 40), name: cleanText(pin.name || pin.id, 40), role: cleanText(pin.role || 'passive', 30) })) : defaultPins(type),
        verificationStatus: cleanText(device?.verificationStatus || '待现场核对'), sourceRef: cleanText(device?.sourceRef, 100),
      }
    }),
    nets: (Array.isArray(sheet.nets) ? sheet.nets : []).map((net, ni) => ({
      id: cleanText(net?.id || `${sheet.id || 'S'}-N${ni + 1}`, 100), name: cleanText(net?.name), wireNo: cleanText(net?.wireNo), potential: cleanText(net?.potential),
      connections: (Array.isArray(net?.connections) ? net.connections : []).map((c) => ({ deviceId: cleanText(c?.deviceId, 100), pinId: cleanText(c?.pinId, 40) })),
      verificationStatus: cleanText(net?.verificationStatus || '待现场核对'),
    })),
    wireSegments: (Array.isArray(sheet.wireSegments) ? sheet.wireSegments : []).map((segment, wi) => ({
      id: cleanText(segment?.id || `${sheet.id || 'S'}-W${wi + 1}`, 100), netId: cleanText(segment?.netId, 100),
      x1: Number(segment?.x1) || 0, y1: Number(segment?.y1) || 0, x2: Number(segment?.x2) || 0, y2: Number(segment?.y2) || 0,
    })),
  }))
  return project
}

function devicePinPoint(device, pinId) {
  const index = Math.max(0, device.pins.findIndex((pin) => pin.id === pinId))
  const count = Math.max(1, device.pins.length)
  const side = index % 2 === 0 ? 'left' : 'right'
  return { x: device.x + (side === 'left' ? -10 : 10), y: device.y + ((index + 1) / (count + 1) - 0.5) * 20 }
}

export function electricalProjectDrc(raw) {
  const project = normalizeElectricalProjectV2(raw)
  const issues = []
  const push = (severity, code, message, sheetId = '', ref = '') => issues.push({ severity, code, message, sheetId, ref })
  const tags = new Map(); const terminalIds = new Set(); const wireNos = new Set()
  for (const sheet of project.sheets) {
    const devices = new Map(sheet.devices.map((d) => [d.id, d]))
    const usedPins = new Set()
    for (const device of sheet.devices) {
      if (tags.has(device.tag)) push('error', 'DUPLICATE_TAG', `位号 ${device.tag} 与 ${tags.get(device.tag)} 重复`, sheet.id, device.id)
      else tags.set(device.tag, `${sheet.pageNo}/${device.id}`)
      if (device.verificationStatus !== '已核对') push('warning', 'UNVERIFIED_DEVICE', `${device.tag} 尚未完成资料或现场核对`, sheet.id, device.id)
      if (device.type === 'terminal') {
        if (terminalIds.has(device.tag)) push('error', 'TERMINAL_CONFLICT', `端子 ${device.tag} 重复`, sheet.id, device.id)
        terminalIds.add(device.tag)
      }
    }
    for (let i = 0; i < sheet.devices.length; i += 1) for (let j = i + 1; j < sheet.devices.length; j += 1) {
      const a = sheet.devices[i]; const b = sheet.devices[j]
      if (Math.abs(a.x - b.x) < 23 && Math.abs(a.y - b.y) < 23) push('error', 'DEVICE_COLLISION', `${a.tag} 与 ${b.tag} 图形范围重叠`, sheet.id, `${a.id}/${b.id}`)
    }
    for (const net of sheet.nets) {
      if (net.connections.length < 2) push('error', 'DANGLING_NET', `网络 ${net.name || net.id} 少于两个连接点`, sheet.id, net.id)
      if (net.wireNo) {
        if (wireNos.has(net.wireNo)) push('warning', 'WIRE_NO_DUPLICATE', `线号 ${net.wireNo} 被多个网络使用`, sheet.id, net.id)
        wireNos.add(net.wireNo)
      } else push('warning', 'WIRE_NO_MISSING', `网络 ${net.name || net.id} 尚无线号`, sheet.id, net.id)
      const potentials = new Set()
      for (const connection of net.connections) {
        const device = devices.get(connection.deviceId)
        if (!device) { push('error', 'DEVICE_MISSING', `网络 ${net.id} 引用了不存在的元件 ${connection.deviceId}`, sheet.id, net.id); continue }
        if (!device.pins.some((pin) => pin.id === connection.pinId)) push('error', 'PIN_MISSING', `${device.tag} 不存在引脚 ${connection.pinId}`, sheet.id, net.id)
        usedPins.add(`${connection.deviceId}:${connection.pinId}`)
        if (['power', 'pe'].includes(device.type)) potentials.add(connection.pinId.toUpperCase())
      }
      if (potentials.has('PE') && [...potentials].some((x) => x !== 'PE')) push('error', 'PE_POWER_SHORT', `网络 ${net.name || net.id} 将 PE 与工作电位相连`, sheet.id, net.id)
      if (net.verificationStatus !== '已核对') push('warning', 'UNVERIFIED_NET', `网络 ${net.name || net.id} 待现场核对`, sheet.id, net.id)
    }
    for (const device of sheet.devices) {
      for (const pin of device.pins) if (!usedPins.has(`${device.id}:${pin.id}`) && pin.role !== 'pe') push('warning', 'UNCONNECTED_PIN', `${device.tag}:${pin.id} 未连接`, sheet.id, device.id)
    }
  }
  for (const xref of project.crossReferences) {
    if (!xref?.fromSheet || !xref?.toSheet) push('error', 'XREF_INCOMPLETE', '跨页引用缺少起始页或目标页', '', cleanText(xref?.id))
  }
  return { ok: !issues.some((x) => x.severity === 'error'), issues, errors: issues.filter((x) => x.severity === 'error').length, warnings: issues.filter((x) => x.severity === 'warning').length }
}

function drawDevice(device) {
  const x = device.x; const y = device.y; const tag = xml(device.tag); const desc = xml(device.description); let body = ''
  if (['breaker', 'fuse', 'pushbutton', 'limit', 'contactor', 'relay'].includes(device.type)) {
    body = `<line x1="${x - 10}" y1="${y}" x2="${x - 3}" y2="${y}"/><circle cx="${x - 2}" cy="${y}" r="1"/><circle cx="${x + 7}" cy="${y}" r="1"/><line x1="${x - 1}" y1="${y - 1}" x2="${x + 6}" y2="${y - 6}"/><line x1="${x + 8}" y1="${y}" x2="${x + 10}" y2="${y}"/>`
    if (device.type === 'fuse') body = `<line x1="${x - 10}" y1="${y}" x2="${x - 6}" y2="${y}"/><rect x="${x - 6}" y="${y - 3}" width="12" height="6"/><line x1="${x + 6}" y1="${y}" x2="${x + 10}" y2="${y}"/>`
    if (['contactor', 'relay'].includes(device.type)) body = `<line x1="${x - 10}" y1="${y}" x2="${x - 6}" y2="${y}"/><rect x="${x - 6}" y="${y - 5}" width="12" height="10"/><line x1="${x + 6}" y1="${y}" x2="${x + 10}" y2="${y}"/>`
  } else if (device.type === 'motor') body = `<circle cx="${x}" cy="${y}" r="10"/><text x="${x}" y="${y + 2}" text-anchor="middle" class="mark">M</text><text x="${x}" y="${y + 6}" text-anchor="middle" class="tiny">3~</text>`
  else if (device.type === 'pe') body = `<line x1="${x}" y1="${y - 10}" x2="${x}" y2="${y}"/><line x1="${x - 7}" y1="${y}" x2="${x + 7}" y2="${y}"/><line x1="${x - 5}" y1="${y + 3}" x2="${x + 5}" y2="${y + 3}"/><line x1="${x - 2}" y1="${y + 6}" x2="${x + 2}" y2="${y + 6}"/>`
  else body = `<rect x="${x - 11}" y="${y - 8}" width="22" height="16"/><text x="${x}" y="${y + 2}" text-anchor="middle" class="mark">${xml(SYMBOL_NAMES.get(device.type) || device.type)}</text>`
  return `<g class="device" data-device-id="${xml(device.id)}">${body}<text x="${x}" y="${y - 13}" text-anchor="middle" class="tag">${tag}</text><text x="${x}" y="${y + 16}" text-anchor="middle" class="desc">${desc || xml(device.verificationStatus)}</text></g>`
}

function routeNet(net, devices, manualSegments = []) {
  const points = net.connections.map((connection) => {
    const device = devices.get(connection.deviceId)
    return device ? devicePinPoint(device, connection.pinId) : null
  }).filter(Boolean)
  if (points.length < 2) return ''
  const first = points[0]; let out = ''
  if (manualSegments.length) {
    out = manualSegments.map((segment) => `<path d="M ${segment.x1} ${segment.y1} L ${segment.x2} ${segment.y2}"/>`).join('')
    out += `<text x="${manualSegments[0].x1 + 3}" y="${manualSegments[0].y1 - 3}" class="wire-label">${xml(net.wireNo || net.name || '待核对')}</text>`
    return `<g class="net" data-net-id="${xml(net.id)}">${out}</g>`
  }
  for (const target of points.slice(1)) {
    const middle = Math.round((first.x + target.x) / 2 / 5) * 5
    out += `<path d="M ${first.x} ${first.y} H ${middle} V ${target.y} H ${target.x}"/>`
    out += `<circle cx="${target.x}" cy="${target.y}" r="1.1"/>`
  }
  out += `<text x="${first.x + 3}" y="${first.y - 3}" class="wire-label">${xml(net.wireNo || net.name || '待核对')}</text>`
  return `<g class="net" data-net-id="${xml(net.id)}">${out}</g>`
}

export function renderElectricalProjectV2(raw) {
  const project = normalizeElectricalProjectV2(raw)
  const drc = electricalProjectDrc(project)
  const svgs = project.sheets.map((sheet) => {
    const devices = new Map(sheet.devices.map((device) => [device.id, device]))
    const grid = Array.from({ length: 39 }, (_, i) => `<line x1="${20 + i * 10}" y1="20" x2="${20 + i * 10}" y2="255"/>`).join('') + Array.from({ length: 24 }, (_, i) => `<line x1="20" y1="${20 + i * 10}" x2="400" y2="${20 + i * 10}"/>`).join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 297" width="420mm" height="297mm"><style>.sheet{fill:#fff;stroke:#111}.grid{stroke:#e8edf3;stroke-width:.18}.device,.net{fill:none;stroke:#111;stroke-width:.65;stroke-linecap:round;stroke-linejoin:round}.device text,.net text,.title text{fill:#111;stroke:none;font-family:Arial,'Microsoft YaHei',sans-serif}.tag{font-size:4px;font-weight:700}.desc{font-size:3px}.mark{font-size:4px}.tiny{font-size:2.5px}.wire-label{font-size:2.8px}.title{fill:none;stroke:#111;stroke-width:.45}.title .main{font-size:5px;font-weight:700}.title .meta{font-size:3px}</style><rect class="sheet" x="8" y="8" width="404" height="281"/><g class="grid">${grid}</g><g class="nets">${sheet.nets.map((net) => routeNet(net, devices, sheet.wireSegments.filter((segment) => segment.netId === net.id))).join('')}</g><g class="devices">${sheet.devices.map(drawDevice).join('')}</g><g class="title"><rect x="250" y="260" width="162" height="29"/><line x1="250" y1="274" x2="412" y2="274"/><text x="255" y="269" class="main">${xml(project.name)}</text><text x="255" y="280" class="meta">${xml(project.machine || '机床待填写')} · ${xml(project.standard)}</text><text x="380" y="280" class="meta">${sheet.pageNo}/${project.sheets.length} ${xml(sheet.title)}</text><text x="15" y="284" class="meta">验证状态：${xml(project.verificationStatus)} · SAMA 1.3.0</text></g></svg>`
    return { sheetId: sheet.id, pageNo: sheet.pageNo, title: sheet.title, svg }
  })
  return { ok: true, project, drc, svgs, bom: buildBom(project), io: project.plcIo, terminals: project.terminals, cables: project.cables }
}

function buildBom(project) {
  const rows = new Map()
  for (const sheet of project.sheets) for (const d of sheet.devices) {
    const key = `${d.type}|${d.manufacturer}|${d.partNo}|${d.description}`
    const row = rows.get(key) || { type: d.type, symbol: SYMBOL_NAMES.get(d.type) || d.type, manufacturer: d.manufacturer, partNo: d.partNo, description: d.description, quantity: 0, tags: [] }
    row.quantity += 1; row.tags.push(d.tag); rows.set(key, row)
  }
  return [...rows.values()]
}

function tableCsv(headers, rows) {
  return `${headers.map(csv).join(',')}\r\n${rows.map((row) => row.map(csv).join(',')).join('\r\n')}\r\n`
}

function dxfFromProject(project) {
  const lines = ['0', 'SECTION', '2', 'ENTITIES']
  const addLine = (x1, y1, x2, y2) => lines.push('0', 'LINE', '8', 'SAMA_WIRE', '10', String(x1), '20', String(-y1), '11', String(x2), '21', String(-y2))
  for (const sheet of project.sheets) {
    const devices = new Map(sheet.devices.map((d) => [d.id, d]))
    for (const net of sheet.nets) {
      const points = net.connections.map((c) => devices.get(c.deviceId) ? devicePinPoint(devices.get(c.deviceId), c.pinId) : null).filter(Boolean)
      for (const target of points.slice(1)) { const first = points[0]; const mid = Math.round((first.x + target.x) / 10) * 10; addLine(first.x, first.y, mid, first.y); addLine(mid, first.y, mid, target.y); addLine(mid, target.y, target.x, target.y) }
    }
    for (const d of sheet.devices) lines.push('0', 'TEXT', '8', 'SAMA_DEVICE', '10', String(d.x), '20', String(-d.y), '40', '3', '1', d.tag)
  }
  lines.push('0', 'ENDSEC', '0', 'EOF')
  return lines.join('\r\n')
}

function projectDir() {
  const dataRoot = app?.getPath ? app.getPath('userData') : path.join(os.tmpdir(), 'sama-1.3-test-user-data')
  const dir = path.join(dataRoot, 'electrical-projects-v2')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function electricalProjectSave(raw) {
  const project = normalizeElectricalProjectV2(raw)
  const file = path.join(projectDir(), `${slug(project.id)}.electrical-v2.json`)
  fs.writeFileSync(file, JSON.stringify(project, null, 2), 'utf8')
  return { ok: true, project, path: file }
}

export function electricalProjectLoad(id) {
  const file = path.join(projectDir(), `${slug(id)}.electrical-v2.json`)
  if (!fs.existsSync(file)) return { ok: false, error: '未找到专业电路工程' }
  return { ok: true, project: normalizeElectricalProjectV2(JSON.parse(fs.readFileSync(file, 'utf8'))), path: file }
}

export function electricalProjectList() {
  const projects = fs.readdirSync(projectDir()).filter((name) => name.endsWith('.electrical-v2.json')).map((name) => {
    try { const p = JSON.parse(fs.readFileSync(path.join(projectDir(), name), 'utf8')); return { id: p.id, name: p.name, machine: p.machine, updatedAt: p.updatedAt } } catch { return null }
  }).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return { ok: true, projects }
}

export async function electricalProjectExport(parentWindow, raw, formats = [], options = {}) {
  const rendered = renderElectricalProjectV2(raw)
  const selected = formats.length ? formats : ['json', 'svg', 'pdf', 'dxf', 'tables', 'drc']
  let root
  const outDir = String(options.outDir || '').trim()
  if (outDir) {
    root = outDir
    fs.mkdirSync(root, { recursive: true })
  } else {
    const pick = await dialog.showOpenDialog(parentWindow, { title: '选择专业电路工程导出目录', properties: ['openDirectory', 'createDirectory'] })
    if (pick.canceled || !pick.filePaths?.[0]) return { ok: false, canceled: true }
    root = path.join(pick.filePaths[0], `${slug(rendered.project.name)}_${new Date().toISOString().slice(0, 10)}`)
    fs.mkdirSync(root, { recursive: true })
  }
  const files = []
  const write = (name, content, encoding = 'utf8') => { const file = path.join(root, name); fs.writeFileSync(file, content, encoding); files.push(file); return file }
  if (selected.includes('json')) write(`${slug(rendered.project.name)}.electrical-v2.json`, JSON.stringify(rendered.project, null, 2))
  if (selected.includes('svg')) rendered.svgs.forEach((s) => write(`${String(s.pageNo).padStart(2, '0')}_${slug(s.title)}.svg`, s.svg))
  if (selected.includes('dxf')) write(`${slug(rendered.project.name)}.dxf`, dxfFromProject(rendered.project))
  if (selected.includes('drc')) write('DRC校验报告.json', JSON.stringify(rendered.drc, null, 2))
  if (selected.includes('tables')) {
    write('BOM.csv', tableCsv(['符号类型', '名称', '厂家', '型号', '描述', '数量', '位号'], rendered.bom.map((x) => [x.type, x.symbol, x.manufacturer, x.partNo, x.description, x.quantity, x.tags.join(' ')])))
    write('PLC_IO.csv', tableCsv(['地址', '名称', '模块', '端子', '验证状态'], rendered.project.plcIo.map((x) => [x.address, x.name, x.module, x.terminal, x.verificationStatus])))
    write('端子表.csv', tableCsv(['端子排', '端子号', '来源', '目标', '验证状态'], rendered.project.terminals.map((x) => [x.strip, x.number, x.from, x.to, x.verificationStatus])))
    write('线缆表.csv', tableCsv(['线缆号', '型号', '芯数', '来源', '目标', '验证状态'], rendered.project.cables.map((x) => [x.tag, x.type, x.cores, x.from, x.to, x.verificationStatus])))
    const connections = rendered.project.sheets.flatMap((s) => s.nets.map((n) => [s.pageNo, n.name, n.wireNo, n.potential, n.connections.map((c) => `${c.deviceId}:${c.pinId}`).join(' → '), n.verificationStatus]))
    write('连接表.csv', tableCsv(['页', '网络', '线号', '电位', '连接', '验证状态'], connections))
  }
  if (selected.includes('pdf')) {
    const html = `<!doctype html><meta charset="utf-8"><style>@page{size:A3 landscape;margin:0}body{margin:0}.page{page-break-after:always;width:420mm;height:297mm}.page:last-child{page-break-after:auto}svg{display:block;width:420mm;height:297mm}</style>${rendered.svgs.map((s) => `<div class="page">${s.svg}</div>`).join('')}`
    await htmlToPagedPdf(html, path.join(root, `${slug(rendered.project.name)}.pdf`)); files.push(path.join(root, `${slug(rendered.project.name)}.pdf`))
  }
  return { ok: true, root, files, drc: rendered.drc }
}

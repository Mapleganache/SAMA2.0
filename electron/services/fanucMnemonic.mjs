/**
 * FANUC LADDER-III 助记符（Mnemonic）文本解析
 * 官方路径：Tool → Source Program Convert / 命令行 SrcToMnemonic
 * 格式参考 B-66234EN 第 6 章：%@0..%@6 分段，梯级为 RD/AND/OR/WRT 等
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodeTextBuffer, repairCommonMojibake } from './textEncoding.mjs'

const ADDR_RE = /^([XYFGRAKTCDL]\d{1,5}(?:\.\d)?)$/i
const BASIC_OPS = new Set([
  'RD',
  'RD.NOT',
  'AND',
  'AND.NOT',
  'OR',
  'OR.NOT',
  'WRT',
  'WRT.NOT',
  'RD.STK',
  'RD.NOT.STK',
  'AND.STK',
  'OR.STK',
  'SET',
  'RST',
])

function normAddr(a) {
  const s = String(a || '').trim().toUpperCase()
  if (!s) return ''
  // X0.0 → X0000.0（尽量对齐符号表四位）
  const m = s.match(/^([XYFGRAKTCDL])(\d{1,5})(?:\.(\d))?$/i)
  if (!m) return s
  const bit = m[3] !== undefined ? `.${m[3]}` : ''
  const num = m[2].padStart(4, '0')
  return `${m[1].toUpperCase()}${num}${bit}`
}

function readMnemonicText(absOrText) {
  if (absOrText && typeof absOrText === 'object' && absOrText.text) {
    return repairCommonMojibake(String(absOrText.text))
  }
  const p = String(absOrText || '')
  if (!p) return ''
  if (fs.existsSync(p) && fs.statSync(p).isFile()) {
    const buf = fs.readFileSync(p)
    const { text } = decodeTextBuffer(buf, { prefer: ['utf-8', 'gb18030', 'gbk', 'shift_jis'] })
    return repairCommonMojibake(text)
  }
  // 当作内联文本
  if (/%@[0-6]|\bRD\b|\bWRT\b/i.test(p) && p.length > 40) return repairCommonMojibake(p)
  return ''
}

/**
 * @returns {{
 *   ok: boolean,
 *   source?: string,
 *   instructionCount: number,
 *   netCount: number,
 *   coils: Map<string, number[]>,
 *   contacts: Map<string, { net: number, op: string, not: boolean }[]>,
 *   nets: { id: number, contacts: { addr: string, op: string, not: boolean }[], coils: { addr: string, op: string }[], raw: string[] }[],
 *   error?: string
 * }}
 */
export function parseMnemonic(absOrText, { sourceLabel = '' } = {}) {
  const text = readMnemonicText(absOrText)
  if (!text.trim()) {
    return {
      ok: false,
      instructionCount: 0,
      netCount: 0,
      coils: new Map(),
      contacts: new Map(),
      nets: [],
      error: '无助记符文本',
    }
  }

  const lines = text.split(/\r?\n/)
  const nets = []
  let cur = null
  let netId = 0
  let instructionCount = 0
  let inLadder = false

  const flush = () => {
    if (cur && (cur.contacts.length || cur.coils.length)) {
      nets.push(cur)
    }
    cur = null
  }

  const ensureNet = () => {
    if (!cur) {
      cur = { id: ++netId, contacts: [], coils: [], raw: [] }
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('*')) continue

    // 段标识
    if (/^%@\s*3/i.test(line) || /^%@3/i.test(line)) {
      inLadder = true
      continue
    }
    if (/^%@\s*[0-26]/i.test(line) || /^%[A-Z]/i.test(line)) {
      // 离开梯子段或子程序标记：结束当前网
      if (/^%@/i.test(line) && !/^%@\s*3/i.test(line)) {
        flush()
        inLadder = /^%@\s*3/i.test(line)
      }
      // %P1 SP 等仍可能是梯子
      if (/^%\s*P\d+/i.test(line) || /^%P\d+/i.test(line)) {
        flush()
        inLadder = true
      }
      continue
    }

    // 无显式 %@3 时：见到基本指令也当梯子
    const parts = line.split(/[\s\t]+/).filter(Boolean)
    if (!parts.length) continue
    let op = parts[0].toUpperCase()
    // RD.NOT / AND.NOT 等
    if (parts.length >= 2 && /^NOT$/i.test(parts[1]) && /^(RD|AND|OR|WRT)$/i.test(op)) {
      op = `${op}.NOT`
      parts.splice(1, 1)
    }
    if (!BASIC_OPS.has(op) && !/^(SUB\d+|TMR|CTR|CALL|JMP|LBL|END|SPE|SP)$/i.test(op)) {
      continue
    }
    if (!BASIC_OPS.has(op)) {
      // 功能指令：结束当前网的粗粒度边界（多数功能指令自成一块）
      flush()
      continue
    }

    inLadder = true
    instructionCount++

    // 常见两种：WRT Y0.6 …  或  WRT 符号名 ;<Y0.6>
    const fromComment = line.match(/<\s*([XYFGRAKTCDL]\d{1,5}(?:\.\d)?)\s*>/i)
    const addrTok = parts[1] || ''
    const addr = fromComment
      ? normAddr(fromComment[1])
      : ADDR_RE.test(addrTok)
        ? normAddr(addrTok)
        : ''
    const isNot = /\.NOT/.test(op)
    const base = op.replace(/\.NOT$/, '').replace(/\.STK$/, '')
    const hasStk = /\.STK/.test(op)

    // 新梯级：普通 RD 开头（非 STK）结束上一网；多 WRT 同条件共享触点
    if (base === 'RD' && !hasStk) {
      flush()
    }

    ensureNet()
    cur.raw.push(line)

    if (base === 'WRT' || base === 'SET' || base === 'RST') {
      if (addr) cur.coils.push({ addr, op })
      continue
    }

    if (base === 'RD' || base === 'AND' || base === 'OR') {
      if (addr) {
        cur.contacts.push({ addr, op, not: isNot })
      }
      if (!addr && hasStk) {
        cur.contacts.push({ addr: '', op, not: false })
      }
    }
  }
  flush()

  const coils = new Map()
  const contacts = new Map()
  for (const n of nets) {
    for (const c of n.coils) {
      if (!coils.has(c.addr)) coils.set(c.addr, [])
      coils.get(c.addr).push(n.id)
    }
    for (const c of n.contacts) {
      if (!c.addr) continue
      if (!contacts.has(c.addr)) contacts.set(c.addr, [])
      contacts.get(c.addr).push({ net: n.id, op: c.op, not: c.not })
    }
  }

  return {
    ok: instructionCount > 0 || nets.length > 0,
    source: sourceLabel || '',
    instructionCount,
    netCount: nets.length,
    coils,
    contacts,
    nets,
  }
}

/**
 * 判断地址对 A/B 在助记符中是否呈现「互锁」迹象：
 * - 写 A 的网里出现 B 的常闭（.NOT）接触，或反过来
 */
export function analyzeAddressPairInterlock(mnemonic, addrA, addrB) {
  const a = normAddr(addrA)
  const b = normAddr(addrB)
  if (!mnemonic?.ok || !a || !b) {
    return { status: 'unavailable', evidence: [] }
  }

  const netsById = new Map((mnemonic.nets || []).map((n) => [n.id, n]))
  const coilNetsA = mnemonic.coils.get(a) || []
  const coilNetsB = mnemonic.coils.get(b) || []
  const evidence = []

  const check = (coilAddr, otherAddr, coilNets) => {
    for (const nid of coilNets) {
      const net = netsById.get(nid)
      if (!net) continue
      const hit = net.contacts.find((c) => c.addr === otherAddr && c.not)
      if (hit) {
        evidence.push({
          kind: 'nc_in_coil_net',
          coil: coilAddr,
          blocks: otherAddr,
          net: nid,
          sample: net.raw.slice(0, 8).join(' | '),
        })
      }
    }
  }

  check(a, b, coilNetsA)
  check(b, a, coilNetsB)

  // 同一网同时写 A 和 B（极少见，标风险）
  for (const n of mnemonic.nets || []) {
    const hasA = n.coils.some((c) => c.addr === a)
    const hasB = n.coils.some((c) => c.addr === b)
    if (hasA && hasB) {
      evidence.push({
        kind: 'same_net_both_coils',
        coil: a,
        blocks: b,
        net: n.id,
        sample: n.raw.slice(0, 8).join(' | '),
      })
    }
  }

  if (!coilNetsA.length && !coilNetsB.length) {
    return { status: 'no_coil', evidence }
  }

  const hasNc = evidence.some((e) => e.kind === 'nc_in_coil_net')
  const sameNet = evidence.some((e) => e.kind === 'same_net_both_coils')
  if (sameNet && !hasNc) return { status: 'risk_same_net', evidence }
  if (hasNc) return { status: 'interlock_seen', evidence }
  return { status: 'no_interlock_seen', evidence }
}

/** 在 LAD 同目录寻找已导出的助记符文件 */
export function findSidecarMnemonic(ladPath) {
  const abs = path.resolve(String(ladPath || ''))
  if (!abs || !fs.existsSync(abs)) return null
  const dir = path.dirname(abs)
  const base = path.basename(abs, path.extname(abs))
  const candidates = [
    `${base}.txt`,
    `${base}_mnemonic.txt`,
    `${base}.mne`,
    `${base}_SRC.txt`,
    'mnemonic.txt',
    'MNEMONIC.TXT',
  ]
  for (const name of candidates) {
    const full = path.join(dir, name)
    if (fs.existsSync(full) && fs.statSync(full).isFile() && fs.statSync(full).size > 80) {
      return full
    }
  }
  return null
}

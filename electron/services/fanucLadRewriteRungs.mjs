/**
 * Studer 风格重写用的网表与符号抽取
 */
import path from 'node:path'
import os from 'node:os'

/**
 * 从助记符中抽取可用位地址（%@2 符号表）
 */
export function extractSymbolBits(mnemonicText) {
  const text = String(mnemonicText || '')
  const i2 = text.search(/%@\s*2/i)
  const i3 = text.search(/%@\s*3/i)
  const block = i2 >= 0 && i3 > i2 ? text.slice(i2, i3) : text
  const map = new Map()
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Z]+)(\d+)\.(\d+)\s+(.+?)\s*$/i)
    if (!m) continue
    const addr = `${m[1].toUpperCase()}${Number(m[2])}.${m[3]}`
    const name = String(m[4] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
    if (!map.has(addr)) map.set(addr, name)
  }
  return map
}

function findAddr(symMap, patterns, fallback, { coil = false } = {}) {
  for (const [addr, name] of symMap) {
    if (coil && /^X/i.test(addr)) continue
    for (const p of patterns) {
      if (p.test(name) || p.test(addr)) return { addr, name }
    }
  }
  return { addr: fallback, name: fallback }
}

const R = (op, addr, name) => ({ op, addr, name })

/**
 * Studer 风格重写网表：优先用原工程符号，线圈禁止 X
 * 内部点用 R100/R101 等（Studer 上 X0.1→R100.0 已验证可写）
 */
export function buildStuderRewriteRungs(symMap = new Map()) {
  const espIn = findAddr(symMap, [/^X8\.4$/i, /EMERGENCY|E-?STOP|\bESP\b/i], 'X8.4')
  const ncEsp = findAddr(symMap, [/^G8\.4$/i, /ALL AXIS INTERLOCK/i], 'G8.4', { coil: true })

  // 只用已在 Studer 工程验证过的地址族：X8.4/G8.4 + R100.* + X0.1
  // 避免 Y/G7/R1260 等在部分 PMC 配置上触发 E-3123
  void symMap
  return [
    {
      contacts: [R('RD', espIn.addr, 'ESP_IN')],
      coil: R('WRT', 'R100.1', 'ESP_OK'),
    },
    {
      contacts: [R('RD', 'R100.1', 'ESP_OK')],
      coil: R('WRT', ncEsp.addr, 'NC_ESP'),
    },
    {
      contacts: [R('RD', 'R100.1', 'ESP_OK'), R('AND.NOT', 'R101.1', 'MODE_JOG')],
      coil: R('WRT', 'R101.0', 'MODE_AUTO'),
    },
    {
      contacts: [R('RD', 'R100.1', 'ESP_OK'), R('AND.NOT', 'R101.0', 'MODE_AUTO')],
      coil: R('WRT', 'R101.1', 'MODE_JOG'),
    },
    {
      contacts: [R('RD', 'R101.0', 'MODE_AUTO'), R('AND', 'X0.1', 'GRIND_KEY')],
      coil: R('WRT', 'R103.0', 'GRIND_EN'),
    },
    {
      contacts: [R('RD', 'R103.0', 'GRIND_EN'), R('AND', 'R100.1', 'ESP_OK')],
      coil: R('WRT', 'R103.1', 'COOL_REQ'),
    },
    {
      contacts: [R('RD', 'R103.1', 'COOL_REQ')],
      coil: R('WRT', 'R104.0', 'COOL_OK'),
    },
    {
      contacts: [
        R('RD', 'R101.0', 'MODE_AUTO'),
        R('AND', 'R103.0', 'GRIND_EN'),
        R('AND', 'R104.0', 'COOL_OK'),
      ],
      coil: R('WRT', 'R105.0', 'CYC_RUN'),
    },
    {
      contacts: [R('RD.NOT', 'R100.1', 'ESP_OK')],
      coil: R('WRT', 'R106.0', 'ALM_LAT'),
    },
    {
      contacts: [R('RD', 'R106.0', 'ALM_LAT')],
      coil: R('WRT', 'R106.1', 'ALM_ANY'),
    },
    {
      contacts: [R('RD', 'X0.3', 'SAMA_PROBE')],
      coil: R('WRT', 'R100.3', 'SAMA_REWRITE'),
    },
  ]
}

export function desktopDirFallback() {
  return path.join(os.homedir(), 'Desktop')
}

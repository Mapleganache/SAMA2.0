/**
 * Post processors：Toolpath IR → NC
 */

function fmt(n, digits = 3) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toFixed(digits).replace(/\.?0+$/, (m) => (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m)) || '0'
}

export function postFanuc(toolpath, opts = {}) {
  const prog = String(opts.programNumber || opts.oNumber || 1001).replace(/\D/g, '') || '1001'
  const lines = []
  lines.push('%')
  lines.push(`O${prog.padStart(4, '0')}`)
  lines.push('(SAMA CAM POST FANUC)')
  lines.push('G90 G54 G17 G40 G49 G80')
  lines.push('G21')

  let lastTool = null
  for (const op of toolpath.operations || []) {
    const tool = op.params?.tool || 'T01'
    const rpm = op.params?.spindleRpm || 2000
    const feed = op.params?.feedMmMin || 200
    lines.push(`(${op.id} ${op.strategy} ${op.featureType})`)
    if (tool !== lastTool) {
      lines.push(`${tool} M06`)
      lastTool = tool
    }
    lines.push(`S${Math.round(rpm)} M03`)
    lines.push('G00 Z50.')
    for (const m of op.moves || []) {
      if (m.type === 'rapid') {
        lines.push(`G00 X${fmt(m.x)} Y${fmt(m.y)} Z${fmt(m.z)}`)
      } else if (m.type === 'feed') {
        const f = Math.round(m.feed || feed)
        lines.push(`G01 X${fmt(m.x)} Y${fmt(m.y)} Z${fmt(m.z)} F${f}`)
      }
    }
    lines.push('G00 Z50.')
    lines.push('M05')
  }

  lines.push('G00 Z100.')
  lines.push('M30')
  lines.push('%')
  return lines.join('\n') + '\n'
}

export function postSiemens(toolpath, opts = {}) {
  // minimal ISO-like for demo
  const fanuc = postFanuc(toolpath, opts)
  return (
    '; SIEMENS-ISH ISO EXPORT FROM SAMA\n' +
    fanuc
      .replace(/^O\d+/m, 'N10 ; PROG')
      .replace(/T(\d+)\s+M06/g, 'T$1 D1 M06')
  )
}

export function postMitsubishi(toolpath, opts = {}) {
  return '; MITSUBISHI-ISH\n' + postFanuc(toolpath, opts)
}

export function postNc(toolpath, vendor = 'fanuc', opts = {}) {
  const v = String(vendor || 'fanuc').toLowerCase()
  if (v.includes('siemens')) return postSiemens(toolpath, opts)
  if (v.includes('mitsu')) return postMitsubishi(toolpath, opts)
  return postFanuc(toolpath, opts)
}

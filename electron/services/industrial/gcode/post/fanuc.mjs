/**
 * FANUC Post：GCodeIR.blocks → NC 文本
 */

function axisWords(block) {
  const parts = []
  if (block.x != null && Number.isFinite(Number(block.x))) parts.push(`X${num(block.x)}`)
  if (block.y != null && Number.isFinite(Number(block.y))) parts.push(`Y${num(block.y)}`)
  if (block.z != null && Number.isFinite(Number(block.z))) parts.push(`Z${num(block.z)}`)
  return parts.join(' ')
}

function num(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  const s = v.toFixed(3).replace(/\.?0+$/, (m) => (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m))
  return s || '0'
}

export function postFanucFromIr(ir, opts = {}) {
  const prog = String(opts.programNumber || ir.program?.number || 1001).replace(/\D/g, '') || '1001'
  const lines = []
  lines.push('%')
  lines.push(`O${prog.padStart(4, '0')}`)
  lines.push('(SAMA GCODEIR FANUC POST)')

  for (const b of ir.blocks || []) {
    switch (b.type) {
      case 'comment':
        lines.push(`(${String(b.text || '').replace(/[()]/g, '')})`)
        break
      case 'units':
        lines.push(b.code || 'G21')
        break
      case 'modal':
        lines.push((b.codes || []).join(' '))
        break
      case 'toolchange':
        lines.push(`${b.tool || 'T01'}${b.m06 ? ' M06' : ''}`)
        break
      case 'spindle':
        if (b.dir === 'M05' || !b.rpm) lines.push('M05')
        else lines.push(`S${Math.round(b.rpm)} ${b.dir || 'M03'}`)
        break
      case 'rapid': {
        const w = axisWords(b)
        lines.push(w ? `G00 ${w}` : 'G00')
        break
      }
      case 'feed': {
        const w = axisWords(b)
        const f = Math.round(b.feed || 300)
        lines.push(w ? `G01 ${w} F${f}` : `G01 F${f}`)
        break
      }
      case 'arc': {
        const w = axisWords(b)
        const g = b.dir === 'CCW' ? 'G03' : 'G02'
        const i = b.i != null ? `I${num(b.i)}` : ''
        const j = b.j != null ? `J${num(b.j)}` : ''
        const f = Math.round(b.feed || 300)
        lines.push([g, w, i, j, `F${f}`].filter(Boolean).join(' '))
        break
      }
      case 'coolant':
        lines.push(b.code || 'M08')
        break
      case 'toolLength':
        if (b.code === 'G49') lines.push('G49')
        else lines.push(`G43 H${Math.trunc(b.h || 1)}${b.z != null ? ` Z${num(b.z)}` : ''}`)
        break
      case 'cutterComp':
        if (b.code === 'G40') lines.push('G40')
        else lines.push(`${b.code} D${Math.trunc(b.d || 1)}`)
        break
      case 'cycle': {
        const parts = [b.retract || 'G98', b.cycle]
        if (b.x != null) parts.push(`X${num(b.x)}`)
        if (b.y != null) parts.push(`Y${num(b.y)}`)
        if (b.z != null) parts.push(`Z${num(b.z)}`)
        if (b.r != null) parts.push(`R${num(b.r)}`)
        if (b.q != null) parts.push(`Q${num(b.q)}`)
        if (b.feed != null) parts.push(`F${Math.round(b.feed)}`)
        lines.push(parts.join(' '))
        break
      }
      case 'cycleCancel':
        lines.push(b.code || 'G80')
        break
      case 'end':
        lines.push(b.code || 'M30')
        break
      default:
        if (b.raw) lines.push(b.raw)
        break
    }
  }

  if (!lines.some((l) => /M30|M02/i.test(l))) lines.push('M30')
  lines.push('%')
  return `${lines.join('\n')}\n`
}

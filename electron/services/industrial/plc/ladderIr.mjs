/**
 * PlcIR → LadderIR（通用梯级中间表示）
 */

function resolveAddr(ir, ref) {
  const r = String(ref || '')
  if (!r) return r
  // already address-like
  if (/^[XYFRMTC]\d/i.test(r)) return r.toUpperCase()
  // key in maps
  if (ir.inputs?.[r] != null || ir.outputs?.[r] != null || ir.internals?.[r] != null) return r
  // value is label, find key
  for (const map of [ir.inputs, ir.outputs, ir.internals]) {
    if (!map) continue
    for (const [k, v] of Object.entries(map)) {
      if (v === r || k === r) return k
    }
  }
  return r
}

/**
 * @returns {{ kind:'ladder.ir', rungs: object[], symbols: object }}
 */
export function compilePlcToLadder(ir) {
  const rungs = []
  const symbols = {
    inputs: { ...(ir.inputs || {}) },
    outputs: { ...(ir.outputs || {}) },
    internals: { ...(ir.internals || {}) },
  }

  ;(ir.logic || []).forEach((step, i) => {
    const t = String(step.type || '')
    if (t === 'seal_in') {
      const start = resolveAddr(ir, step.input)
      const stop = resolveAddr(ir, step.stop)
      const out = resolveAddr(ir, step.output)
      rungs.push({
        id: `rung_${i + 1}`,
        type: 'seal_in',
        comment: step.comment || `seal-in ${out}`,
        // (--[/STOP]--[START]----+----( OUT )
        //                       |
        //                  --[OUT]--
        contacts: [
          { kind: 'nc', addr: stop, role: 'stop' },
          { kind: 'no', addr: start, role: 'start', parallelWith: out },
        ],
        coil: { kind: 'out', addr: out },
        ascii: `| --[/${stop}]--+--[${start}]----( ${out} )\n|              |\n|              +--[${out}]-----|`,
      })
    } else if (t === 'timer_on') {
      const en = resolveAddr(ir, step.input || step.enable)
      const out = resolveAddr(ir, step.output || step.timer)
      const preset = Number(step.presetMs) || 1000
      rungs.push({
        id: `rung_${i + 1}`,
        type: 'timer_on',
        comment: step.comment || `TON ${out}`,
        contacts: [{ kind: 'no', addr: en, role: 'enable' }],
        coil: { kind: 'ton', addr: out, presetMs: preset },
        ascii: `| --[${en}]----[TON ${out} ${preset}ms]----( ${out} )`,
      })
    } else if (t === 'timer_off') {
      const en = resolveAddr(ir, step.input || step.enable)
      const out = resolveAddr(ir, step.output || step.timer)
      const preset = Number(step.presetMs) || 1000
      rungs.push({
        id: `rung_${i + 1}`,
        type: 'timer_off',
        comment: step.comment || `TOF ${out}`,
        contacts: [{ kind: 'no', addr: en, role: 'enable' }],
        coil: { kind: 'tof', addr: out, presetMs: preset },
        ascii: `| --[${en}]----[TOF ${out} ${preset}ms]----( ${out} )`,
      })
    } else if (t === 'and' || t === 'or') {
      const inputs = (step.inputs || []).map((x) => resolveAddr(ir, x))
      const out = resolveAddr(ir, step.output)
      rungs.push({
        id: `rung_${i + 1}`,
        type: t,
        contacts: inputs.map((addr) => ({ kind: 'no', addr })),
        coil: { kind: 'out', addr: out },
        join: t,
        ascii: `| --[${inputs.join(t === 'and' ? ']--[' : ']--+--[')}]----( ${out} )`,
      })
    } else {
      rungs.push({
        id: `rung_${i + 1}`,
        type: t,
        raw: step,
        unsupported: true,
        ascii: `| ; unsupported logic type: ${t}`,
      })
    }
  })

  return {
    schemaVersion: 1,
    kind: 'ladder.ir',
    vendor: ir.vendor || 'generic',
    symbols,
    rungs,
    ascii: rungs.map((r) => r.ascii).filter(Boolean).join('\n\n'),
  }
}

/**
 * 导出接近 FANUC 助记符风格的文本片段（仅文件，不写 .LAD）
 */
export function ladderToFanucMnemonicSnippet(ladder) {
  const lines = []
  lines.push('; 气缸夹紧样例助记符（示意，不是完整 LAD）')
  lines.push('%@2')
  for (const [addr, name] of Object.entries(ladder.symbols?.inputs || {})) {
    lines.push(`; ${addr} ${name}`)
  }
  for (const [addr, name] of Object.entries(ladder.symbols?.outputs || {})) {
    lines.push(`; ${addr} ${name}`)
  }
  for (const [addr, name] of Object.entries(ladder.symbols?.internals || {})) {
    lines.push(`; ${addr} ${name}`)
  }
  lines.push('%@3')
  for (const rung of ladder.rungs || []) {
    if (rung.type === 'seal_in') {
      const stop = rung.contacts?.find((c) => c.role === 'stop')?.addr
      const start = rung.contacts?.find((c) => c.role === 'start')?.addr
      const out = rung.coil?.addr
      lines.push(`; ${rung.comment || out}`)
      if (stop) lines.push(`RD.NOT ${stop}`)
      if (start) lines.push(stop ? `AND ${start}` : `RD ${start}`)
      if (out) {
        lines.push(`OR ${out}`)
        lines.push(`WRT ${out}`)
      }
    } else if (rung.type === 'timer_on') {
      const en = rung.contacts?.[0]?.addr
      const out = rung.coil?.addr
      const ms = rung.coil?.presetMs || 1000
      lines.push(`; ${rung.comment || `定时 ${out} ${ms}ms`}`)
      if (en) lines.push(`RD ${en}`)
      if (out) {
        lines.push(`TMR ${out}`)
        lines.push(`WRT ${out}`)
      }
    } else if (rung.type === 'and' || rung.type === 'or') {
      const addrs = (rung.contacts || []).map((c) => c.addr).filter(Boolean)
      const out = rung.coil?.addr
      const op = rung.type === 'or' ? 'OR' : 'AND'
      lines.push(`; ${rung.comment || out}`)
      if (addrs.length) {
        lines.push(`RD ${addrs[0]}`)
        for (const a of addrs.slice(1)) lines.push(`${op} ${a}`)
      }
      if (out) lines.push(`WRT ${out}`)
    } else if (rung.ascii) {
      lines.push(`; ${rung.comment || rung.type}`)
      lines.push(`; ${rung.ascii}`)
    }
  }
  lines.push('%@5')
  return lines.join('\n') + '\n'
}

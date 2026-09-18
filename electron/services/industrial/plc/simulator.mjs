/**
 * 简易 PLC 扫描仿真（离散量 + TON 累加）
 */

function bit(state, addr) {
  return !!state[addr]
}

function setBit(state, addr, v) {
  state[addr] = !!v
}

/**
 * 单次扫描
 * @param {object} ladder LadderIR
 * @param {Record<string, boolean>} state 当前位状态（含输入）
 * @param {object} timers timer 累加器 { [addr]: { accMs, done } }
 * @param {number} dtMs 扫描周期
 */
export function scanOnce(ladder, state, timers = {}, dtMs = 100) {
  const next = { ...state }
  const tnext = { ...timers }

  for (const rung of ladder.rungs || []) {
    if (rung.unsupported) continue

    if (rung.type === 'seal_in') {
      const stop = rung.contacts?.find((c) => c.role === 'stop')?.addr
      const start = rung.contacts?.find((c) => c.role === 'start')?.addr
      const out = rung.coil?.addr
      const stopOk = stop ? !bit(next, stop) : true // NC
      const startOn = start ? bit(next, start) : false
      const sealed = out ? bit(next, out) : false
      setBit(next, out, stopOk && (startOn || sealed))
    } else if (rung.type === 'timer_on') {
      const en = rung.contacts?.[0]?.addr
      const out = rung.coil?.addr
      const preset = Number(rung.coil?.presetMs) || 1000
      const enabled = en ? bit(next, en) : false
      if (!tnext[out]) tnext[out] = { accMs: 0, done: false }
      if (enabled) {
        tnext[out].accMs += dtMs
        if (tnext[out].accMs >= preset) {
          tnext[out].done = true
          setBit(next, out, true)
        } else {
          setBit(next, out, false)
        }
      } else {
        tnext[out] = { accMs: 0, done: false }
        setBit(next, out, false)
      }
    } else if (rung.type === 'timer_off') {
      const en = rung.contacts?.[0]?.addr
      const out = rung.coil?.addr
      const preset = Number(rung.coil?.presetMs) || 1000
      const enabled = en ? bit(next, en) : false
      if (!tnext[out]) tnext[out] = { accMs: 0, done: bit(next, out) }
      if (enabled) {
        tnext[out] = { accMs: 0, done: true }
        setBit(next, out, true)
      } else if (tnext[out].done || bit(next, out)) {
        tnext[out].accMs += dtMs
        if (tnext[out].accMs >= preset) {
          tnext[out].done = false
          setBit(next, out, false)
        } else {
          setBit(next, out, true)
        }
      } else {
        setBit(next, out, false)
      }
    } else if (rung.type === 'and') {
      const addrs = (rung.contacts || []).map((c) => c.addr)
      const out = rung.coil?.addr
      setBit(next, out, addrs.every((a) => bit(next, a)))
    } else if (rung.type === 'or') {
      const addrs = (rung.contacts || []).map((c) => c.addr)
      const out = rung.coil?.addr
      setBit(next, out, addrs.some((a) => bit(next, a)))
    }
  }

  return { state: next, timers: tnext }
}

/**
 * 运行一段输入轨迹
 * steps: [{ holdMs, inputs: { X0:1, ... }, expect?: { Y0:1 } }]
 */
export function runTrace(ladder, steps, { dtMs = 100 } = {}) {
  let state = {}
  let timers = {}
  const log = []
  for (const step of steps) {
    const inputs = step.inputs || {}
    for (const [k, v] of Object.entries(inputs)) state[k] = !!v
    const hold = Math.max(Number(step.holdMs) || dtMs, dtMs)
    const scans = Math.max(1, Math.ceil(hold / dtMs))
    for (let i = 0; i < scans; i++) {
      const r = scanOnce(ladder, state, timers, dtMs)
      state = r.state
      timers = r.timers
    }
    const snapshot = { ...state }
    let pass = true
    const mismatches = []
    if (step.expect) {
      for (const [k, v] of Object.entries(step.expect)) {
        if (!!snapshot[k] !== !!v) {
          pass = false
          mismatches.push({ addr: k, expected: !!v, actual: !!snapshot[k] })
        }
      }
    }
    log.push({
      inputs: { ...inputs },
      state: snapshot,
      expect: step.expect || null,
      pass,
      mismatches,
    })
  }
  return {
    ok: log.every((x) => x.pass),
    log,
    finalState: state,
  }
}

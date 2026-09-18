/**
 * PlcIR — 控制逻辑中间表示（非直接 Ladder 图形）
 * 后续：PlcIR → LadderIR → FANUC/Mitsubishi/... Adapter
 */

export const PLC_LOGIC_TYPES = new Set([
  'seal_in',
  'timer_on',
  'timer_off',
  'and',
  'or',
  'not',
  'set',
  'reset',
  'compare',
])

export function createEmptyPlcIr(partial = {}) {
  return {
    schemaVersion: 1,
    kind: 'plc.ir',
    vendor: partial.vendor || 'generic',
    inputs: partial.inputs && typeof partial.inputs === 'object' ? partial.inputs : {},
    outputs: partial.outputs && typeof partial.outputs === 'object' ? partial.outputs : {},
    internals: partial.internals && typeof partial.internals === 'object' ? partial.internals : {},
    logic: Array.isArray(partial.logic) ? partial.logic : [],
    meta: partial.meta || {},
  }
}

export function validatePlcIr(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    return [{ code: 'PLC_NOT_OBJECT', message: 'PlcIR 必须是对象' }]
  }
  if (data.kind && data.kind !== 'plc.ir') {
    errors.push({ code: 'PLC_KIND_INVALID', message: 'kind 应为 plc.ir' })
  }
  if (!data.inputs || typeof data.inputs !== 'object' || Array.isArray(data.inputs)) {
    errors.push({ code: 'PLC_INPUTS_REQUIRED', message: 'inputs 必须是对象映射' })
  }
  if (!data.outputs || typeof data.outputs !== 'object' || Array.isArray(data.outputs)) {
    errors.push({ code: 'PLC_OUTPUTS_REQUIRED', message: 'outputs 必须是对象映射' })
  }
  if (!Array.isArray(data.logic)) {
    errors.push({ code: 'PLC_LOGIC_REQUIRED', message: 'logic 必须是数组' })
    return errors
  }
  if (data.logic.length === 0) {
    errors.push({ code: 'PLC_LOGIC_EMPTY', message: 'logic 不能为空' })
  }

  const ioKeys = new Set([
    ...Object.keys(data.inputs || {}),
    ...Object.keys(data.outputs || {}),
    ...Object.keys(data.internals || {}),
  ])

  data.logic.forEach((step, i) => {
    const pref = `logic[${i}]`
    if (!step || typeof step !== 'object') {
      errors.push({ code: 'PLC_LOGIC_NOT_OBJECT', message: `${pref} 必须是对象`, path: pref })
      return
    }
    const t = String(step.type || '')
    if (!PLC_LOGIC_TYPES.has(t)) {
      errors.push({
        code: 'PLC_LOGIC_UNKNOWN',
        message: `${pref}.type 未知: ${t || '(空)'}`,
        path: `${pref}.type`,
      })
      return
    }
    if (t === 'seal_in') {
      if (!step.input) {
        errors.push({ code: 'PLC_SEAL_INPUT', message: `${pref}.input 必填`, path: `${pref}.input` })
      }
      if (!step.output) {
        errors.push({ code: 'PLC_SEAL_OUTPUT', message: `${pref}.output 必填`, path: `${pref}.output` })
      }
      if (!step.stop) {
        errors.push({ code: 'PLC_SEAL_STOP', message: `${pref}.stop 必填`, path: `${pref}.stop` })
      }
      for (const key of ['input', 'output', 'stop']) {
        const ref = step[key]
        if (ref && ioKeys.size && !ioKeys.has(ref) && !/^([XYFRMTC]\d+)/i.test(String(ref))) {
          // allow symbolic names that appear as values in maps
          const asValue = [...Object.values(data.inputs || {}), ...Object.values(data.outputs || {})].includes(ref)
          const asKey = ioKeys.has(ref)
          if (!asKey && !asValue) {
            // also allow if ref is used as address key style matching values inverted
            const keysByLabel = Object.entries({ ...(data.inputs || {}), ...(data.outputs || {}) })
            const hit = keysByLabel.some(([k, v]) => k === ref || v === ref)
            if (!hit) {
              errors.push({
                code: 'PLC_REF_UNKNOWN',
                message: `${pref}.${key} 未在 I/O 中声明: ${ref}`,
                path: `${pref}.${key}`,
              })
            }
          }
        }
      }
    }
    if (t === 'timer_on' || t === 'timer_off') {
      if (!step.output && !step.timer) {
        errors.push({ code: 'PLC_TIMER_TARGET', message: `${pref} 需要 output 或 timer`, path: pref })
      }
      if (step.presetMs != null && !(typeof step.presetMs === 'number' && step.presetMs > 0)) {
        errors.push({ code: 'PLC_TIMER_PRESET', message: `${pref}.presetMs 须为正数`, path: `${pref}.presetMs` })
      }
    }
  })

  return errors
}

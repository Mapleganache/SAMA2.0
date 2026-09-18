/**
 * ElectricalIR — 拓扑 + 元件（非几何坐标）
 */

export const ELEC_DEVICE_TYPES = new Set([
  'breaker',
  'contactor',
  'relay',
  'thermal_relay',
  'motor',
  'pushbutton',
  'lamp',
  'fuse',
  'transformer',
  'solenoid',
  'sensor',
  'terminal',
  'other',
])

export function createEmptyElectricalIr(partial = {}) {
  return {
    schemaVersion: 1,
    kind: 'electrical.ir',
    power: partial.power || { phases: 1, voltage: 220 },
    devices: Array.isArray(partial.devices) ? partial.devices : [],
    connections: Array.isArray(partial.connections) ? partial.connections : [],
    /** 规则引擎结果槽位（Phase 8 填充） */
    rules: Array.isArray(partial.rules) ? partial.rules : [],
    meta: partial.meta || {},
  }
}

export function validateElectricalIr(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    return [{ code: 'ELEC_NOT_OBJECT', message: 'ElectricalIR 必须是对象' }]
  }
  if (data.kind && data.kind !== 'electrical.ir') {
    errors.push({ code: 'ELEC_KIND_INVALID', message: 'kind 应为 electrical.ir' })
  }
  if (!Array.isArray(data.devices)) {
    errors.push({ code: 'ELEC_DEVICES_REQUIRED', message: 'devices 必须是数组' })
    return errors
  }
  if (data.devices.length === 0) {
    errors.push({ code: 'ELEC_DEVICES_EMPTY', message: 'devices 不能为空' })
  }

  const ids = new Set()
  data.devices.forEach((d, i) => {
    const pref = `devices[${i}]`
    if (!d || typeof d !== 'object') {
      errors.push({ code: 'ELEC_DEVICE_NOT_OBJECT', message: `${pref} 必须是对象`, path: pref })
      return
    }
    const id = String(d.id || '').trim()
    if (!id) {
      errors.push({ code: 'ELEC_DEVICE_ID_REQUIRED', message: `${pref}.id 必填`, path: `${pref}.id` })
    } else if (ids.has(id)) {
      errors.push({ code: 'ELEC_DEVICE_ID_DUPLICATE', message: `重复设备 id: ${id}`, path: `${pref}.id` })
    } else {
      ids.add(id)
    }
    const t = String(d.type || '')
    if (!ELEC_DEVICE_TYPES.has(t)) {
      errors.push({
        code: 'ELEC_DEVICE_TYPE_UNKNOWN',
        message: `${pref}.type 未知: ${t || '(空)'}`,
        path: `${pref}.type`,
      })
    }
  })

  if (data.connections != null && !Array.isArray(data.connections)) {
    errors.push({ code: 'ELEC_CONNECTIONS_INVALID', message: 'connections 必须是数组' })
  } else if (Array.isArray(data.connections)) {
    data.connections.forEach((c, i) => {
      const pref = `connections[${i}]`
      let a
      let b
      if (Array.isArray(c) && c.length >= 2) {
        a = String(c[0])
        b = String(c[1])
      } else if (c && typeof c === 'object') {
        a = String(c.from || c.a || '')
        b = String(c.to || c.b || '')
      } else {
        errors.push({ code: 'ELEC_CONNECTION_SHAPE', message: `${pref} 须为 [a,b] 或 {from,to}`, path: pref })
        return
      }
      if (!ids.has(a) || !ids.has(b)) {
        errors.push({
          code: 'ELEC_CONNECTION_DANGLING',
          message: `${pref} 悬空连接: ${a} → ${b}`,
          path: pref,
        })
      }
    })
  }

  return errors
}

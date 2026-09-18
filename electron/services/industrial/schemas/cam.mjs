/**
 * CamIR — 加工特征骨架（无刀位点）
 */

export const CAM_FEATURE_TYPES = new Set([
  'pocket',
  'hole',
  'face',
  'profile',
  'slot',
  'drill',
])

export function createEmptyCamIr(partial = {}) {
  return {
    schemaVersion: 1,
    kind: 'cam.ir',
    units: partial.units || 'mm',
    stock: partial.stock || null,
    features: Array.isArray(partial.features) ? partial.features : [],
    tools: Array.isArray(partial.tools) ? partial.tools : [],
    meta: partial.meta || {},
  }
}

function numOk(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

export function validateCamIr(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    return [{ code: 'CAM_NOT_OBJECT', message: 'CamIR 必须是对象' }]
  }
  if (data.kind && data.kind !== 'cam.ir') {
    errors.push({ code: 'CAM_KIND_INVALID', message: 'kind 应为 cam.ir' })
  }
  if (!data.stock || typeof data.stock !== 'object') {
    errors.push({ code: 'CAM_STOCK_REQUIRED', message: 'stock 必填' })
  } else {
    for (const k of ['x', 'y', 'z']) {
      if (!numOk(data.stock[k])) {
        errors.push({
          code: 'CAM_STOCK_SIZE',
          message: `stock.${k} 须为正数`,
          path: `stock.${k}`,
        })
      }
    }
  }
  if (!Array.isArray(data.features)) {
    errors.push({ code: 'CAM_FEATURES_REQUIRED', message: 'features 必须是数组' })
    return errors
  }
  if (data.features.length === 0) {
    errors.push({ code: 'CAM_FEATURES_EMPTY', message: 'features 不能为空' })
  }
  data.features.forEach((f, i) => {
    const pref = `features[${i}]`
    if (!f || typeof f !== 'object') {
      errors.push({ code: 'CAM_FEATURE_NOT_OBJECT', message: `${pref} 必须是对象`, path: pref })
      return
    }
    const t = String(f.type || '')
    if (!CAM_FEATURE_TYPES.has(t)) {
      errors.push({
        code: 'CAM_FEATURE_UNKNOWN',
        message: `${pref}.type 未知: ${t || '(空)'}`,
        path: `${pref}.type`,
      })
    }
    if ((t === 'hole' || t === 'drill') && !numOk(f.diameter)) {
      errors.push({
        code: 'CAM_HOLE_DIAMETER',
        message: `${pref}.diameter 须为正数`,
        path: `${pref}.diameter`,
      })
    }
    if (t === 'pocket') {
      if (!numOk(f.width) && !numOk(f.length)) {
        errors.push({ code: 'CAM_POCKET_SIZE', message: `${pref} 需要 width/length`, path: pref })
      }
      if (!numOk(f.depth)) {
        errors.push({ code: 'CAM_POCKET_DEPTH', message: `${pref}.depth 须为正数`, path: `${pref}.depth` })
      }
    }
  })
  return errors
}

/**
 * CADIR — CAD Intermediate Representation（第一版子集）
 * LLM → CADIR；禁止 LLM 直接驱动鼠标画图。
 */

export const CAD_FEATURE_TYPES = new Set([
  'box',
  'hole',
  'rectangle',
  'circle',
  'cylinder',
  'extrude',
  'line',
  'arc',
  'fillet',
  'chamfer',
])

export function createEmptyCadIr(partial = {}) {
  return {
    schemaVersion: 1,
    kind: 'cad.ir',
    type: partial.type || 'part',
    units: partial.units || 'mm',
    features: Array.isArray(partial.features) ? partial.features : [],
    meta: partial.meta || {},
  }
}

function numOk(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function validateFeature(f, index) {
  const errors = []
  const pref = `features[${index}]`
  if (!f || typeof f !== 'object') {
    return [{ code: 'CAD_FEATURE_NOT_OBJECT', message: `${pref} 必须是对象`, path: pref }]
  }
  const t = String(f.type || '')
  if (!CAD_FEATURE_TYPES.has(t)) {
    errors.push({
      code: 'CAD_FEATURE_UNKNOWN',
      message: `${pref} 未知类型: ${t || '(空)'}`,
      path: pref,
    })
    return errors
  }
  if (t === 'box') {
    if (!numOk(f.width)) errors.push({ code: 'CAD_BOX_WIDTH', message: `${pref}.width 须为正数`, path: `${pref}.width` })
    if (!numOk(f.depth) && !numOk(f.length)) {
      errors.push({ code: 'CAD_BOX_DEPTH', message: `${pref}.depth/length 须为正数`, path: `${pref}.depth` })
    }
    if (!numOk(f.height)) {
      errors.push({ code: 'CAD_BOX_HEIGHT', message: `${pref}.height 须为正数`, path: `${pref}.height` })
    }
  }
  if (t === 'hole') {
    if (!numOk(f.diameter)) {
      errors.push({ code: 'CAD_HOLE_DIAMETER', message: `${pref}.diameter 须为正数`, path: `${pref}.diameter` })
    }
    if (f.position != null) {
      if (!Array.isArray(f.position) || f.position.length < 2) {
        errors.push({
          code: 'CAD_HOLE_POSITION',
          message: `${pref}.position 须为 [x,y] 或 [x,y,z]`,
          path: `${pref}.position`,
        })
      }
    }
  }
  if (t === 'rectangle') {
    if (!numOk(f.width)) errors.push({ code: 'CAD_RECT_WIDTH', message: `${pref}.width 须为正数`, path: `${pref}.width` })
    if (!numOk(f.height) && !numOk(f.depth)) {
      errors.push({ code: 'CAD_RECT_HEIGHT', message: `${pref}.height 须为正数`, path: `${pref}.height` })
    }
  }
  if (t === 'circle' || t === 'cylinder') {
    if (!numOk(f.diameter) && !numOk(f.radius)) {
      errors.push({
        code: 'CAD_CIRCLE_SIZE',
        message: `${pref} 需要 diameter 或 radius`,
        path: pref,
      })
    }
  }
  return errors
}

export function validateCadIr(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    return [{ code: 'CAD_NOT_OBJECT', message: 'CADIR 必须是对象' }]
  }
  if (data.kind && data.kind !== 'cad.ir') {
    errors.push({ code: 'CAD_KIND_INVALID', message: `kind 应为 cad.ir` })
  }
  if (data.type && data.type !== 'part' && data.type !== 'assembly') {
    errors.push({ code: 'CAD_TYPE_INVALID', message: `type 应为 part|assembly` })
  }
  if (!Array.isArray(data.features)) {
    errors.push({ code: 'CAD_FEATURES_REQUIRED', message: 'features 必须是数组' })
    return errors
  }
  if (data.features.length === 0) {
    errors.push({ code: 'CAD_FEATURES_EMPTY', message: 'features 不能为空' })
  }
  data.features.forEach((f, i) => {
    errors.push(...validateFeature(f, i))
  })
  return errors
}

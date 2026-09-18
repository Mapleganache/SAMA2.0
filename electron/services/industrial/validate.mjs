/**
 * 统一 IR 校验入口
 */
import { validateProjectShape } from './schemas/project.mjs'
import { validateCadIr } from './schemas/cad.mjs'
import { validateElectricalIr } from './schemas/electrical.mjs'
import { validatePlcIr } from './schemas/plc.mjs'
import { validateCamIr } from './schemas/cam.mjs'

const KIND_ALIASES = {
  project: 'project',
  'industrial.project': 'project',
  cad: 'cad',
  'cad.ir': 'cad',
  cadir: 'cad',
  electrical: 'electrical',
  'electrical.ir': 'electrical',
  elec: 'electrical',
  plc: 'plc',
  'plc.ir': 'plc',
  cam: 'cam',
  'cam.ir': 'cam',
}

export function normalizeIrKind(kind) {
  const k = String(kind || '')
    .trim()
    .toLowerCase()
  return KIND_ALIASES[k] || k
}

/**
 * @returns {{ ok: boolean, kind: string, errors: Array<{code:string,message:string,path?:string}> }}
 */
export function validateIr(kind, data) {
  const nk = normalizeIrKind(kind)
  let errors = []
  switch (nk) {
    case 'project':
      errors = validateProjectShape(data)
      break
    case 'cad':
      errors = validateCadIr(data)
      break
    case 'electrical':
      errors = validateElectricalIr(data)
      break
    case 'plc':
      errors = validatePlcIr(data)
      break
    case 'cam':
      errors = validateCamIr(data)
      break
    default:
      errors = [{ code: 'IR_KIND_UNKNOWN', message: `未知 IR kind: ${kind}` }]
  }
  return {
    ok: errors.length === 0,
    kind: nk,
    errors,
  }
}

/**
 * 校验整个 IndustrialProject（外壳 + 已挂载域）
 */
export function validateProject(project) {
  const errors = [...validateProjectShape(project)]
  const domains = project?.domains || {}
  if (domains.cad) {
    const r = validateCadIr(domains.cad)
    errors.push(...r.map((e) => ({ ...e, path: e.path ? `domains.cad.${e.path}` : 'domains.cad' })))
  }
  if (domains.electrical) {
    const r = validateElectricalIr(domains.electrical)
    errors.push(...r.map((e) => ({ ...e, path: e.path ? `domains.electrical.${e.path}` : 'domains.electrical' })))
  }
  if (domains.plc) {
    const r = validatePlcIr(domains.plc)
    errors.push(...r.map((e) => ({ ...e, path: e.path ? `domains.plc.${e.path}` : 'domains.plc' })))
  }
  if (domains.cam) {
    const r = validateCamIr(domains.cam)
    errors.push(...r.map((e) => ({ ...e, path: e.path ? `domains.cam.${e.path}` : 'domains.cam' })))
  }
  return { ok: errors.length === 0, kind: 'project', errors }
}

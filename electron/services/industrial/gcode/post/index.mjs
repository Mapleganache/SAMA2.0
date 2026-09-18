export { postFanucFromIr } from './fanuc.mjs'
export { postSiemensFromIr } from './siemens.mjs'
export { postMitsubishiFromIr } from './mitsubishi.mjs'
export { postGenericFromIr } from './generic.mjs'

import { postFanucFromIr } from './fanuc.mjs'
import { postSiemensFromIr } from './siemens.mjs'
import { postMitsubishiFromIr } from './mitsubishi.mjs'
import { postGenericFromIr } from './generic.mjs'

export function postGCodeIr(ir, vendor = 'fanuc', opts = {}) {
  const v = String(vendor || ir.program?.controller || 'fanuc').toLowerCase()
  if (v.includes('siemens')) return postSiemensFromIr(ir, opts)
  if (v.includes('mitsu')) return postMitsubishiFromIr(ir, opts)
  if (v.includes('generic') || v.includes('iso')) return postGenericFromIr(ir, opts)
  return postFanucFromIr(ir, opts)
}

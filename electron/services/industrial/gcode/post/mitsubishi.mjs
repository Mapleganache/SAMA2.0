import { postFanucFromIr } from './fanuc.mjs'

export function postMitsubishiFromIr(ir, opts = {}) {
  return `; MITSUBISHI-ISH FROM SAMA GCODEIR\n${postFanucFromIr(ir, opts)}`
}

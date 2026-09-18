import { postFanucFromIr } from './fanuc.mjs'

/** 通用 ISO 风格：目前回退 FANUC */
export function postGenericFromIr(ir, opts = {}) {
  return `; GENERIC ISO FROM SAMA GCODEIR\n${postFanucFromIr(ir, opts)}`
}

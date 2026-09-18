import { postFanucFromIr } from './fanuc.mjs'

export function postSiemensFromIr(ir, opts = {}) {
  const fanuc = postFanucFromIr(ir, opts)
  return (
    '; SIEMENS-ISH FROM SAMA GCODEIR\n' +
    fanuc.replace(/^O\d+/m, 'N10 ; PROG').replace(/T(\d+)\s+M06/g, 'T$1 D1 M06')
  )
}

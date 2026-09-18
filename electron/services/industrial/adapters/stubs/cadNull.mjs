import { createStubAdapter } from '../base.mjs'

/** CAD 空适配器 — Phase 7 再接 FreeCAD/DXF/STEP */
export function createCadNullAdapter() {
  return createStubAdapter({
    id: 'cad.null',
    domain: 'cad',
    vendor: 'null',
    levels: ['api'],
    label: 'CAD Null Stub',
    notes: 'Phase 6：仅占位。禁止用鼠标画图冒充 CAD。',
    async detect() {
      const { detectBound } = await import('../../softwareBind.mjs')
      return detectBound('cad.null')
    },
  })
}

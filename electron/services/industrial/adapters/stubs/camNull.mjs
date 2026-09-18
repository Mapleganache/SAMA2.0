import { createStubAdapter } from '../base.mjs'

export function createCamNullAdapter() {
  return createStubAdapter({
    id: 'cam.null',
    domain: 'cam',
    vendor: 'null',
    levels: ['api'],
    label: 'CAM Null Stub',
    notes: 'Phase 10：策略/刀具/Post/NC 安全检查。禁止直接下发机床。',
    async detect() {
      const { detectBound } = await import('../../softwareBind.mjs')
      return detectBound('cam.null')
    },
  })
}

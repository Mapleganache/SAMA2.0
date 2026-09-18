/**
 * CAM Post Adapter — Phase 10
 */
import { createStubAdapter } from './base.mjs'
import { materializeCamIr } from '../cam/materialize.mjs'
import { planCamOperations } from '../cam/toolpath.mjs'
import { postNc } from '../cam/post.mjs'
import { runNcSafetyChecks } from '../cam/safety.mjs'

export function createCamPostAdapter() {
  return createStubAdapter({
    id: 'cam.post',
    domain: 'cam',
    vendor: 'sama',
    levels: ['api'],
    label: 'SAMA CAM Post + Safety',
    notes: 'CamIR→策略/刀具→Toolpath IR→FANUC/Siemens/Mitsubishi NC + 安全检查。不下发机床。',
    async detect() {
      return {
        available: true,
        adapterId: 'cam.post',
        domain: 'cam',
        message: '本地 CAM Post 内核可用（不下发机床）',
      }
    },
    async createFromIr(ir, opts = {}) {
      return materializeCamIr(ir, opts)
    },
    async export(args = {}) {
      if (args.ir) return materializeCamIr(args.ir, args)
      const err = new Error('export 需要 ir')
      err.code = 'IR_REQUIRED'
      throw err
    },
    async verify(args = {}) {
      if (!args.ir) {
        const err = new Error('verify 需要 ir')
        err.code = 'IR_REQUIRED'
        throw err
      }
      const toolpath = planCamOperations(args.ir, args)
      const nc = postNc(toolpath, args.vendor || 'fanuc', args)
      const safety = runNcSafetyChecks(toolpath, nc, args)
      return { ok: safety.ok, success: safety.ok, toolpath, safety, ncPreview: nc.slice(0, 500) }
    },
  })
}

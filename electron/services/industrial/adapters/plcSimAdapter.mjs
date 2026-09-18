/**
 * PLC Sim Adapter — Phase 9
 * TODO: 未来可选桥接 fanucLadderIii（须用户 Allow），本阶段只导出文本+仿真
 */
import { createStubAdapter } from './base.mjs'
import { materializePlcIr } from '../plc/materialize.mjs'
import { compilePlcToLadder } from '../plc/ladderIr.mjs'
import { runPlcTestSuite } from '../plc/tests.mjs'

export function createPlcSimAdapter() {
  return createStubAdapter({
    id: 'plc.sim',
    domain: 'plc',
    vendor: 'sama',
    levels: ['api'],
    label: 'SAMA PLC Ladder Sim',
    notes: 'PlcIR→LadderIR→仿真测试→助记符片段。不自动改 FANUC .LAD。',
    async detect() {
      return {
        available: true,
        adapterId: 'plc.sim',
        domain: 'plc',
        message: '本地 PLC 仿真内核可用（非 Fladder 改梯）',
      }
    },
    async createFromIr(ir, opts = {}) {
      return materializePlcIr(ir, opts)
    },
    async export(args = {}) {
      if (args.ir) return materializePlcIr(args.ir, args)
      const err = new Error('export 需要 ir')
      err.code = 'IR_REQUIRED'
      throw err
    },
    async simulate(args = {}) {
      if (!args.ir) {
        const err = new Error('simulate 需要 ir')
        err.code = 'IR_REQUIRED'
        throw err
      }
      const ladder = compilePlcToLadder(args.ir)
      const suite = runPlcTestSuite(args.ir, { tests: args.tests })
      return { ok: suite.ok, success: suite.ok, ladder, suite }
    },
    async verify(args = {}) {
      return this.simulate(args)
    },
  })
}

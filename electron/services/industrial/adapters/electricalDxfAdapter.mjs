/**
 * Electrical DXF Adapter — Phase 8
 */
import { createStubAdapter } from './base.mjs'
import { materializeElectricalIr } from '../electrical/materialize.mjs'
import { runElectricalRules } from '../electrical/rules.mjs'
import { layoutElectrical } from '../electrical/layout.mjs'

export function createElectricalDxfAdapter() {
  return createStubAdapter({
    id: 'electrical.dxf',
    domain: 'electrical',
    vendor: 'sama',
    levels: ['api'],
    label: 'SAMA Electrical Schematic Kernel',
    notes: 'ElectricalIR→规则引擎→分层布局→DXF/SVG/BOM。非 EPLAN。',
    async detect() {
      return {
        available: true,
        adapterId: 'electrical.dxf',
        domain: 'electrical',
        message: '本地电气示意内核可用',
      }
    },
    async createFromIr(ir, opts = {}) {
      return materializeElectricalIr(ir, opts)
    },
    async export(args = {}) {
      if (args.ir) return materializeElectricalIr(args.ir, args)
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
      const rules = runElectricalRules(args.ir)
      const layout = layoutElectrical(args.ir)
      return {
        ok: rules.ok,
        success: rules.ok,
        ruleResult: rules,
        layout: { nodeCount: layout.nodes.length, edgeCount: layout.edges.length },
        verification: {
          rules_ok: rules.ok,
          interlock_checked: rules.rules.some((r) => r.code === 'CONTACTOR_INTERLOCK_MISSING')
            ? false
            : true,
        },
      }
    },
  })
}

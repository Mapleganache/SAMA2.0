import { createStubAdapter } from '../base.mjs'

/**
 * PLC 空适配器
 * TODO(Phase 9): bridge fanucLadderIii via PlcAdapter — 勿在 Phase 6 调用改梯流水线
 */
export function createPlcNullAdapter() {
  return createStubAdapter({
    id: 'plc.null',
    domain: 'plc',
    vendor: 'null',
    levels: ['api'],
    label: 'PLC Null Stub',
    notes:
      'Phase 6 stub。FANUC LAD 改写仍走 sama-allow-ladder；未来 PlcIR→LadderIR→fanucLadderIii。',
    async detect() {
      const { detectBound } = await import('../../softwareBind.mjs')
      return detectBound('plc.null')
    },
  })
}

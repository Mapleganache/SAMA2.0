import { createStubAdapter } from '../base.mjs'

export function createElectricalNullAdapter() {
  return createStubAdapter({
    id: 'electrical.null',
    domain: 'electrical',
    vendor: 'eplan',
    levels: ['cli'],
    label: 'EPLAN Electric P8',
    notes: '绑定本机 W3u.exe，优先 EPLAN 2.7（匹配现有许可），打开 .elk。不改 .edb，不是破解。',
    async detect() {
      const { getEplanStatus } = await import('../../../eplanOperator.mjs')
      const st = getEplanStatus()
      const p = st.probe || {}
      return {
        available: Boolean(st.capabilities?.launchGui && p.found),
        adapterId: 'electrical.null',
        domain: 'electrical',
        path: p.eplanPath || '',
        bindable: true,
        message: st.note || p.hint || '',
        mode: st.mode,
        capabilities: st.capabilities,
      }
    },
    async launch() {
      const { operateEplan } = await import('../../../eplanOperator.mjs')
      return operateEplan('launch', {}, { approved: true, rememberSession: true })
    },
    async open(projectPath) {
      const { operateEplan } = await import('../../../eplanOperator.mjs')
      return operateEplan('openElk', { elkPath: projectPath }, { approved: true, rememberSession: true })
    },
  })
}

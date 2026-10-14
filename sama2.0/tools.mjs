import { identifyMachine } from './dialect.mjs'
import { searchLibrary } from './library.mjs'
import { lookupBaseline } from './baselines.mjs'

export function createToolRunner() {
  return async function runTool(name, args = {}) {
    try {
      if (name === 'lookup_baseline') {
        const rows = lookupBaseline(args.query || '')
        return rows
          .map((row) => `${row.subsystem}\n工具：${row.tools.join('、')}\n方向：${row.causes.join('；')}\n测点：${row.points.join('；')}`)
          .join('\n\n')
      }
      if (name === 'lookup_grind_dialect') {
        const machine = identifyMachine(args.query || '')
        return `机床家族：${machine.label}（${machine.id}）\n维修约束：${machine.note}\n这项只用于识别机床家族，不能代替现场测量。`
      }
      if (name === 'search_mechanical' || name === 'search_knowledge') {
        return searchLibrary(args.query || '', { subsystem: String(args.subsystem || '').trim() })
      }
      return `未知工具 ${name}。请改用给定工具，或直接输出最终方案。`
    } catch (error) {
      return `工具 ${name} 调用失败：${error?.message || error}。请基于已有信息继续，不要假装查到了资料。`
    }
  }
}

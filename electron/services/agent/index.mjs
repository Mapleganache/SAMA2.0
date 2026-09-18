/**
 * SAMA Agent Core — Phase A 入口
 *
 * Phase A：taskState + capabilityResolver；runAgentTurn 仍在 ../agent.mjs。
 * 不在此文件静态 re-export runAgentTurn，以免纯 Node 脚本加载时拉入 Electron。
 * Phase B：在此挂接 planner → executor → observer → verifier。
 */

export {
  createTask,
  getTask,
  updateTask,
  listTasks,
  clearTasks,
  setTaskStatus,
} from './taskState.mjs'
export {
  resolveCapabilities,
  resolveIndustrialForDomain,
} from './capabilityResolver.mjs'

/** @returns {Promise<typeof import('../agent.mjs').runAgentTurn>} */
export async function loadRunAgentTurn() {
  const m = await import('../agent.mjs')
  return m.runAgentTurn
}

export const AGENT_CORE_PHASE = 'A'
export const AGENT_CORE_NEXT = [
  'planner.mjs',
  'executor.mjs',
  'observer.mjs',
  'verifier.mjs',
  'memory.mjs',
]

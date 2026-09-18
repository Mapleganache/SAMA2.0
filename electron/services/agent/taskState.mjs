/**
 * Agent Core 薄骨架 — 任务状态表（Phase A）
 * Phase B 将接入 Planner / Executor 多轮循环。
 */

/** @typedef {'idle'|'planning'|'acting'|'observing'|'verifying'|'done'|'failed'|'cancelled'} TaskStatus */

/**
 * @typedef {object} AgentTask
 * @property {string} id
 * @property {TaskStatus} status
 * @property {string} [goal]
 * @property {string} [domain] desktop|industrial|lad|chat
 * @property {unknown[]} [steps]
 * @property {string} [error]
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/** @type {Map<string, AgentTask>} */
const tasks = new Map()

export function createTask(partial = {}) {
  const id = partial.id || `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const now = Date.now()
  /** @type {AgentTask} */
  const task = {
    id,
    status: partial.status || 'idle',
    goal: partial.goal || '',
    domain: partial.domain || 'chat',
    steps: Array.isArray(partial.steps) ? partial.steps : [],
    error: '',
    createdAt: now,
    updatedAt: now,
  }
  tasks.set(id, task)
  return { ...task }
}

export function getTask(id) {
  const t = tasks.get(id)
  return t ? { ...t } : null
}

export function updateTask(id, patch = {}) {
  const t = tasks.get(id)
  if (!t) return null
  Object.assign(t, patch, { updatedAt: Date.now() })
  return { ...t }
}

export function listTasks() {
  return [...tasks.values()].map((t) => ({ ...t }))
}

export function clearTasks() {
  tasks.clear()
}

export function setTaskStatus(id, status, extra = {}) {
  return updateTask(id, { status, ...extra })
}

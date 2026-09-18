import fs from 'node:fs'
import path from 'node:path'
import { getDesktopLogDir } from './permissionManager.mjs'

const SENSITIVE_KEY = /api[_-]?key|password|passwd|pin|token|secret|authorization/i

function redact(value) {
  if (value == null) return value
  if (typeof value === 'string') {
    if (value.length > 500) return `${value.slice(0, 500)}…`
    return value
  }
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v)
    }
    return out
  }
  return value
}

export function logDesktopOperation(entry) {
  try {
    const dir = getDesktopLogDir()
    const file = path.join(dir, 'desktop-ops.jsonl')
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      args: redact(entry.args),
      permission: entry.permission,
      approvalId: entry.approvalId || null,
      success: !!entry.success,
      error: entry.error || null,
      durationMs: entry.durationMs ?? null,
      requiresApproval: !!entry.requiresApproval,
    })
    fs.appendFileSync(file, `${line}\n`, 'utf8')
  } catch {
    /* 日志失败不影响业务 */
  }
}

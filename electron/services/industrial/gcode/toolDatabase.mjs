/**
 * ToolDatabase — 刀具库（复用 CAM DEFAULT_TOOLS）
 */
import { DEFAULT_TOOLS } from '../cam/tools.mjs'

export function listTools(extra = []) {
  const base = DEFAULT_TOOLS.map((t) => ({
    number: Number(String(t.tool).replace(/\D/g, '')) || 1,
    id: t.tool,
    type: t.type,
    diameter: t.diameter,
    length: t.length || 50,
    material: t.material,
    flutes: t.flutes,
    maxRpm: t.maxRpm,
    maxFeed: t.maxFeed,
  }))
  return [...base, ...extra]
}

export function getTool(numberOrId, extra = []) {
  const all = listTools(extra)
  const n = Number(String(numberOrId).replace(/\D/g, ''))
  return all.find((t) => t.number === n || t.id === numberOrId) || null
}

export function assertToolExists(numberOrId, extra = []) {
  const t = getTool(numberOrId, extra)
  if (!t) {
    return {
      ok: false,
      error: { code: 'TOOL_NOT_FOUND', message: `刀具库无 ${numberOrId}` },
    }
  }
  return { ok: true, tool: t }
}

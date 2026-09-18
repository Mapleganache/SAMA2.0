/**
 * Capability Registry — 注册 / 探测 / 按级别选择适配器
 */
import { describeAdapter, bestLevelRank, LEVEL_RANK } from './base.mjs'
import { isBindable, resolveBoundExe } from '../softwareBind.mjs'

const adapters = new Map()

export function register(adapter) {
  if (!adapter?.id) {
    const err = new Error('adapter.id 必填')
    err.code = 'ADAPTER_ID_REQUIRED'
    throw err
  }
  adapters.set(adapter.id, adapter)
  return describeAdapter(adapter)
}

export function unregister(id) {
  return adapters.delete(id)
}

export function clearRegistry() {
  adapters.clear()
}

export function list() {
  return [...adapters.values()].map(describeAdapter)
}

export function get(id) {
  return adapters.get(id) || null
}

/** 空适配器只表示「本机装了软件」，不能用来生成样例 */
export function isNullStub(adapter) {
  const id = String(adapter?.id || '')
  return id.endsWith('.null') || adapter?.vendor === 'null'
}

/**
 * 选择某域最优适配器（可用优先，再避开 .null，再比 level）
 */
export async function resolveBest({ domain, preferLevels = [], forCreate = false } = {}) {
  const candidates = [...adapters.values()].filter((a) => a.domain === domain)
  if (!candidates.length) return null

  const probed = []
  for (const a of candidates) {
    if (forCreate && isNullStub(a)) continue
    let det = { available: false }
    try {
      det = (await a.detect()) || det
    } catch {
      det = { available: false }
    }
    probed.push({ adapter: a, detect: det })
  }

  const preferSet = new Set(preferLevels)
  probed.sort((x, y) => {
    const ax = x.detect.available ? 0 : 1
    const ay = y.detect.available ? 0 : 1
    if (ax !== ay) return ax - ay
    const gx = isNullStub(x.adapter) ? 1 : 0
    const gy = isNullStub(y.adapter) ? 1 : 0
    if (gx !== gy) return gx - gy
    const px = x.adapter.levels?.some((l) => preferSet.has(l)) ? 0 : 1
    const py = y.adapter.levels?.some((l) => preferSet.has(l)) ? 0 : 1
    if (px !== py) return px - py
    return bestLevelRank(x.adapter.levels) - bestLevelRank(y.adapter.levels)
  })

  const top = probed[0]
  if (!top) return null
  return {
    adapter: top.adapter,
    detect: top.detect,
    meta: describeAdapter(top.adapter),
    levelRank: bestLevelRank(top.adapter.levels),
    preferredLevelHint: preferLevels[0] || ADAPTER_LEVELS_HINT(top.adapter.levels),
  }
}

function ADAPTER_LEVELS_HINT(levels) {
  if (!levels?.length) return null
  return [...levels].sort((a, b) => (LEVEL_RANK[a] ?? 99) - (LEVEL_RANK[b] ?? 99))[0]
}

export async function probeAll() {
  const out = []
  for (const a of adapters.values()) {
    let detect
    try {
      detect = await a.detect()
    } catch (e) {
      detect = {
        available: false,
        error: { code: e.code || 'DETECT_FAILED', message: e.message || String(e) },
      }
    }
    out.push({
      ...describeAdapter(a),
      detect,
      available: !!detect?.available,
      partial: !!detect?.partial,
      bindable: isBindable(a.id),
      boundPath: resolveBoundExe(a.id) || detect?.path || '',
    })
  }
  return {
    count: out.length,
    availableCount: out.filter((x) => x.available).length,
    adapters: out,
  }
}

/** 测试用：当前注册表大小 */
export function size() {
  return adapters.size
}

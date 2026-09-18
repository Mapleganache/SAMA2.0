/**
 * Capability Resolver — 聚合 Desktop + Industrial 能力清单（Phase A）
 * Phase B：供 Planner 选择工具/适配器。
 */

/**
 * @returns {Promise<{
 *   ok: boolean
 *   desktop?: { tool: string, permission: string }[]
 *   industrial?: unknown[]
 *   error?: string
 * }>}
 */
export async function resolveCapabilities() {
  const out = {
    ok: true,
    desktop: [],
    industrial: [],
    notes: {
      phase: 'A',
      next: 'Phase B Planner 将据此选 tool / adapter',
    },
  }

  try {
    const { listDesktopTools } = await import('../desktop/index.mjs')
    const desk = listDesktopTools()
    // listDesktopTools 可能返回 string[] 或 { tools }
    if (Array.isArray(desk)) {
      out.desktop = desk.map((t) =>
        typeof t === 'string' ? { tool: t, permission: '?' } : t,
      )
    } else {
      out.desktop = desk?.tools || []
    }
  } catch (e) {
    out.desktop = []
    out.desktopError = e.message || String(e)
  }

  try {
    const { bootstrapIndustrial, listCapabilities } = await import('../industrial/index.mjs')
    bootstrapIndustrial()
    const caps = await listCapabilities()
    out.industrial = caps?.adapters || []
    out.industrialMeta = {
      count: caps?.count,
      availableCount: caps?.availableCount,
    }
  } catch (e) {
    out.industrial = []
    out.industrialError = e.message || String(e)
  }

  return out
}

/**
 * 按域过滤工业适配器
 */
export async function resolveIndustrialForDomain(domain) {
  const all = await resolveCapabilities()
  const d = String(domain || '').toLowerCase()
  const adapters = (all.industrial || []).filter(
    (a) => String(a.domain || '').toLowerCase() === d,
  )
  return {
    ok: true,
    domain: d,
    adapters,
    available: adapters.filter((a) => a.available),
  }
}

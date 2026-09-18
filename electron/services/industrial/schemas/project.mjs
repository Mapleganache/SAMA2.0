/**
 * IndustrialProject 外壳 — 跨 CAD / 电气 / PLC / CAM 的工程容器
 */

export function createEmptyProject(partial = {}) {
  const id =
    partial.id ||
    `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return {
    schemaVersion: 1,
    kind: 'industrial.project',
    id,
    name: String(partial.name || 'untitled').slice(0, 200),
    units: partial.units || 'mm',
    domains: {
      cad: null,
      electrical: null,
      plc: null,
      cam: null,
      ...(partial.domains && typeof partial.domains === 'object' ? partial.domains : {}),
    },
    artifacts: Array.isArray(partial.artifacts) ? partial.artifacts : [],
    meta: {
      createdAt: new Date().toISOString(),
      ...(partial.meta && typeof partial.meta === 'object' ? partial.meta : {}),
    },
  }
}

export function validateProjectShape(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    return [{ code: 'PROJECT_NOT_OBJECT', message: '项目必须是对象' }]
  }
  if (data.kind && data.kind !== 'industrial.project') {
    errors.push({ code: 'PROJECT_KIND_INVALID', message: `kind 应为 industrial.project，实际: ${data.kind}` })
  }
  if (!data.id || typeof data.id !== 'string') {
    errors.push({ code: 'PROJECT_ID_REQUIRED', message: '需要 id 字符串' })
  }
  if (data.units && !['mm', 'inch', 'in'].includes(String(data.units))) {
    errors.push({ code: 'PROJECT_UNITS_INVALID', message: `不支持的单位: ${data.units}` })
  }
  if (data.domains != null && typeof data.domains !== 'object') {
    errors.push({ code: 'PROJECT_DOMAINS_INVALID', message: 'domains 必须是对象' })
  }
  if (data.artifacts != null && !Array.isArray(data.artifacts)) {
    errors.push({ code: 'PROJECT_ARTIFACTS_INVALID', message: 'artifacts 必须是数组' })
  }
  return errors
}

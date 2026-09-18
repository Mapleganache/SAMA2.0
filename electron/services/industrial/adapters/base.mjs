/**
 * Adapter 契约与调用级别
 * 优先级：api > cli > com > uia > ocr > mouse（越靠前越可靠）
 */

export const ADAPTER_LEVELS = ['api', 'cli', 'com', 'uia', 'ocr', 'mouse']

export const LEVEL_RANK = Object.fromEntries(ADAPTER_LEVELS.map((l, i) => [l, i]))

export function notImplemented(method, adapterId = '') {
  const err = new Error(`${adapterId || 'adapter'}.${method} 尚未实现（Phase 6 stub）`)
  err.code = 'NOT_IMPLEMENTED'
  err.method = method
  err.adapterId = adapterId
  return err
}

/**
 * 规范化适配器描述（不强制 class）
 */
export function describeAdapter(adapter) {
  return {
    id: adapter.id,
    domain: adapter.domain,
    vendor: adapter.vendor || 'null',
    levels: Array.isArray(adapter.levels) ? adapter.levels : [],
    label: adapter.label || adapter.id,
    notes: adapter.notes || '',
  }
}

/**
 * 创建最小 stub 形状：缺方法时抛 NOT_IMPLEMENTED
 */
export function createStubAdapter(spec) {
  const id = spec.id
  const methods = [
    'detect',
    'launch',
    'open',
    'createFromIr',
    'export',
    'verify',
    'simulate',
    'save',
    'screenshot',
  ]
  const adapter = {
    id,
    domain: spec.domain,
    vendor: spec.vendor || 'null',
    levels: spec.levels || ['api'],
    label: spec.label || id,
    notes: spec.notes || '',
    async detect() {
      return {
        available: false,
        adapterId: id,
        domain: spec.domain,
        message: spec.detectMessage || '未绑定真实工业软件（stub）',
      }
    },
  }
  for (const m of methods) {
    if (typeof spec[m] === 'function') {
      adapter[m] = spec[m].bind(spec)
    } else if (m !== 'detect') {
      adapter[m] = async () => {
        throw notImplemented(m, id)
      }
    }
  }
  return adapter
}

export function bestLevelRank(levels = []) {
  if (!levels.length) return 999
  return Math.min(...levels.map((l) => LEVEL_RANK[l] ?? 999))
}

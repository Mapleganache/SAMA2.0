/**
 * Electrical Rule Engine — 拓扑/安全规则（非坐标）
 */

function normConn(c) {
  if (Array.isArray(c) && c.length >= 2) return [String(c[0]), String(c[1])]
  if (c && typeof c === 'object') return [String(c.from || c.a || ''), String(c.to || c.b || '')]
  return null
}

function buildAdj(connections = []) {
  const adj = new Map()
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set())
    if (!adj.has(b)) adj.set(b, new Set())
    adj.get(a).add(b)
    adj.get(b).add(a)
  }
  for (const c of connections) {
    const p = normConn(c)
    if (p && p[0] && p[1]) add(p[0], p[1])
  }
  return adj
}

function connected(adj, a, b, maxDepth = 6) {
  if (a === b) return true
  const seen = new Set([a])
  const q = [[a, 0]]
  while (q.length) {
    const [cur, d] = q.shift()
    if (d >= maxDepth) continue
    for (const n of adj.get(cur) || []) {
      if (n === b) return true
      if (!seen.has(n)) {
        seen.add(n)
        q.push([n, d + 1])
      }
    }
  }
  return false
}

/**
 * @returns {{ ok: boolean, errors: object[], warnings: object[], rules: object[] }}
 */
export function runElectricalRules(ir) {
  const errors = []
  const warnings = []
  const devices = Array.isArray(ir?.devices) ? ir.devices : []
  const connections = Array.isArray(ir?.connections) ? ir.connections : []
  const adj = buildAdj(connections)
  const byId = new Map(devices.map((d) => [String(d.id), d]))

  const contactors = devices.filter((d) => d.type === 'contactor')
  const forward = contactors.filter((d) => /forward|正转|fwd/i.test(String(d.role || '')))
  const reverse = contactors.filter((d) => /reverse|反转|rev/i.test(String(d.role || '')))

  if (forward.length && reverse.length) {
    const locked =
      ir?.meta?.forwardReverseInterlock === true ||
      forward.every((f) =>
        reverse.some(
          (r) =>
            f.interlockedWith === r.id ||
            r.interlockedWith === f.id ||
            (Array.isArray(f.interlocks) && f.interlocks.includes(r.id)) ||
            (Array.isArray(r.interlocks) && r.interlocks.includes(f.id)),
        ),
      )
    if (!locked) {
      errors.push({
        code: 'CONTACTOR_INTERLOCK_MISSING',
        severity: 'error',
        message: '检测到正/反转接触器，但未声明互锁（meta.forwardReverseInterlock 或 interlockedWith）',
        devices: [...forward.map((d) => d.id), ...reverse.map((d) => d.id)],
      })
    }
  }

  const motors = devices.filter((d) => d.type === 'motor')
  const thermals = devices.filter((d) => d.type === 'thermal_relay')
  for (const m of motors) {
    const protectedBy = thermals.some((fr) => connected(adj, fr.id, m.id))
    const tagged = thermals.some((fr) => fr.protects === m.id || fr.motor === m.id)
    if (!protectedBy && !tagged) {
      warnings.push({
        code: 'MOTOR_OVERLOAD_MISSING',
        severity: 'warning',
        message: `电机 ${m.id} 未见热继电器保护路径`,
        devices: [m.id],
      })
    }
  }

  const buttons = devices.filter((d) => d.type === 'pushbutton')
  const hasStart = buttons.some((b) => /start|启动|run/i.test(String(b.role || b.id || '')))
  const hasStop = buttons.some((b) => /stop|停止|estop|急停/i.test(String(b.role || b.id || '')))
  if ((motors.length || contactors.length) && hasStart && !hasStop) {
    warnings.push({
      code: 'STOP_BUTTON_MISSING',
      severity: 'warning',
      message: '有启动按钮但未见停止/急停按钮（role=stop）',
    })
  }

  if (motors.length && !devices.some((d) => d.type === 'breaker' || d.type === 'fuse')) {
    warnings.push({
      code: 'POWER_PROTECTION_MISSING',
      severity: 'warning',
      message: '有电机但未见断路器/熔断器',
    })
  }

  // 孤立设备（无任何连接）
  if (connections.length && devices.length > 1) {
    for (const d of devices) {
      if (!adj.has(d.id) || adj.get(d.id).size === 0) {
        warnings.push({
          code: 'DEVICE_ISOLATED',
          severity: 'warning',
          message: `设备 ${d.id} 无连接`,
          devices: [d.id],
        })
      }
    }
  }

  // 未知 id 已在 schema 校验；此处补连接指向
  for (const c of connections) {
    const p = normConn(c)
    if (!p) continue
    for (const id of p) {
      if (id && !byId.has(id)) {
        errors.push({
          code: 'ELEC_CONNECTION_DANGLING',
          severity: 'error',
          message: `连接引用未知设备: ${id}`,
        })
      }
    }
  }

  const rules = [...errors, ...warnings]
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    rules,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      deviceCount: devices.length,
      connectionCount: connections.length,
    },
  }
}

export { buildAdj, connected, normConn }

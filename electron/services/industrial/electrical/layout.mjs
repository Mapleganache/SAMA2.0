/**
 * 电气自动布局 — 按「电源 → 保护 → 控制 → 执行器」分层，不由 LLM 定坐标
 */

const TIER = {
  breaker: 0,
  fuse: 0,
  transformer: 0,
  contactor: 1,
  relay: 1,
  pushbutton: 1,
  thermal_relay: 2,
  sensor: 2,
  motor: 3,
  solenoid: 3,
  lamp: 3,
  terminal: 4,
  other: 4,
}

const TIER_LABEL = ['power', 'control', 'protection', 'actuator', 'other']

/**
 * @returns {{ nodes: Array<{id,type,role,x,y,tier}>, edges: Array<{from,to}>, bounds }}
 */
export function layoutElectrical(ir) {
  const devices = Array.isArray(ir?.devices) ? ir.devices : []
  const connections = Array.isArray(ir?.connections) ? ir.connections : []

  const buckets = [[], [], [], [], []]
  for (const d of devices) {
    const tier = TIER[d.type] ?? 4
    buckets[tier].push(d)
  }

  const colGap = 120
  const rowGap = 60
  const nodes = []
  for (let tier = 0; tier < buckets.length; tier++) {
    buckets[tier].forEach((d, i) => {
      nodes.push({
        id: d.id,
        type: d.type,
        role: d.role || null,
        label: d.label || d.id,
        x: tier * colGap,
        y: i * rowGap,
        tier,
        tierName: TIER_LABEL[tier] || 'other',
      })
    })
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = []
  for (const c of connections) {
    let a
    let b
    if (Array.isArray(c)) {
      a = String(c[0])
      b = String(c[1])
    } else if (c && typeof c === 'object') {
      a = String(c.from || c.a || '')
      b = String(c.to || c.b || '')
    }
    if (a && b && byId.has(a) && byId.has(b)) {
      edges.push({ from: a, to: b })
    }
  }

  let maxX = 0
  let maxY = 0
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + 80)
    maxY = Math.max(maxY, n.y + 40)
  }

  return {
    algorithm: 'tiered-power-control-protection-actuator',
    nodes,
    edges,
    bounds: { width: maxX + 40, height: maxY + 40 },
    note: '布局由引擎计算，非 LLM 坐标',
  }
}

export function buildBom(ir) {
  const devices = Array.isArray(ir?.devices) ? ir.devices : []
  const map = new Map()
  for (const d of devices) {
    const key = `${d.type}|${d.role || ''}|${d.rating || ''}`
    const cur = map.get(key) || {
      type: d.type,
      role: d.role || null,
      rating: d.rating || null,
      qty: 0,
      ids: [],
    }
    cur.qty += 1
    cur.ids.push(d.id)
    map.set(key, cur)
  }
  return [...map.values()]
}

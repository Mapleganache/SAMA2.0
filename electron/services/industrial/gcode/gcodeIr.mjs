/**
 * GCodeIR — 结构化加工程序中间表示（非字符串）
 * 自然语言/CamIR/参数表 → GCodeIR → Post → NC
 */

export function createEmptyGCodeIr(partial = {}) {
  return {
    schemaVersion: 1,
    kind: 'gcode.ir',
    program: {
      number: 1001,
      controller: 'FANUC',
      units: 'mm',
      absolute: true,
      workOffset: 'G54',
      plane: 'G17',
      ...(partial.program || {}),
    },
    tools: Array.isArray(partial.tools) ? partial.tools : [],
    operations: Array.isArray(partial.operations) ? partial.operations : [],
    /** 展开后的指令块（由 generator 填充） */
    blocks: Array.isArray(partial.blocks) ? partial.blocks : [],
    meta: partial.meta || {},
  }
}

export function validateGCodeIr(data) {
  const errors = []
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: [{ code: 'GCODE_IR_NOT_OBJECT', message: 'GCodeIR 必须是对象' }] }
  }
  if (data.kind && data.kind !== 'gcode.ir') {
    errors.push({ code: 'GCODE_KIND', message: `kind 应为 gcode.ir，实际 ${data.kind}` })
  }
  const prog = data.program || {}
  if (!prog.number && prog.number !== 0) {
    errors.push({ code: 'GCODE_NO_PROG', message: '缺少 program.number' })
  }
  if (!Array.isArray(data.operations) && !Array.isArray(data.blocks)) {
    errors.push({ code: 'GCODE_NO_OPS', message: '需要 operations 或 blocks' })
  }
  for (let i = 0; i < (data.operations || []).length; i++) {
    const op = data.operations[i]
    if (!op?.type) {
      errors.push({ code: 'GCODE_OP_TYPE', message: `operations[${i}] 缺少 type`, path: `operations[${i}]` })
    }
  }
  return { ok: errors.length === 0, errors }
}

/** 从现有 Toolpath IR 粗转 GCodeIR（保留与 CAM 兼容） */
export function gcodeIrFromToolpath(toolpath, opts = {}) {
  const ops = []
  for (const op of toolpath?.operations || []) {
    ops.push({
      type: mapStrategy(op.strategy || op.featureType),
      id: op.id,
      tool: parseToolNum(op.params?.tool),
      depth: op.geometry?.depth ?? null,
      feed: op.params?.feedMmMin,
      spindle: op.params?.spindleRpm,
      geometry: op.geometry || {},
      moves: op.moves || [],
      strategy: op.strategy,
      featureType: op.featureType,
    })
  }
  return createEmptyGCodeIr({
    program: {
      number: opts.programNumber || 1001,
      controller: String(opts.controller || opts.vendor || 'FANUC').toUpperCase(),
      units: toolpath?.units || 'mm',
    },
    tools: (toolpath?.tools || []).map(normalizeTool),
    operations: ops,
    meta: { source: 'toolpath.ir', ...(opts.meta || {}) },
  })
}

/**
 * 参数化 Level-2 意图 → GCodeIR
 * 例：100×50 矩形轮廓铣
 */
export function gcodeIrFromParams(params = {}) {
  const width = Number(params.width ?? params.geometry?.width) || 100
  const height = Number(params.height ?? params.geometry?.height) || 50
  const depth = Math.abs(Number(params.depth) || 5)
  const toolNum = Number(params.tool?.number ?? params.toolNumber ?? 1) || 1
  const diameter = Number(params.tool?.diameter ?? params.toolDiameter) || 10
  const feed = Number(params.feed) || 300
  const spindle = Number(params.spindle) || 2000
  const safeZ = Number(params.safeZ) || 50
  const opType = String(params.operation || params.type || 'profile').toLowerCase()

  const tools = [
    {
      number: toolNum,
      diameter,
      type: params.tool?.type || 'endmill',
    },
  ]

  const operations = []
  if (opType === 'facing' || opType === 'face') {
    operations.push({
      type: 'facing',
      tool: toolNum,
      depth: -Math.min(depth, 2),
      feed,
      spindle,
      geometry: { width, height },
      safeZ,
    })
  } else if (opType === 'peck' || opType === 'peck_drill' || opType === 'g83') {
    operations.push({
      type: 'peck_drill',
      cycle: 'G83',
      tool: toolNum,
      depth: -depth,
      feed,
      spindle,
      geometry: {
        x: Number(params.geometry?.x) || width / 2,
        y: Number(params.geometry?.y) || height / 2,
        diameter,
      },
      peck: Number(params.peck || params.q) || Math.min(5, depth / 3),
      rPlane: Number(params.rPlane ?? params.r) || 2,
      retractMode: params.retractMode || 'G98',
      lengthOffset: Number(params.lengthOffset ?? params.h ?? 1),
      safeZ,
    })
  } else if (opType === 'drill_cycle' || opType === 'g81') {
    operations.push({
      type: 'drill_cycle',
      cycle: 'G81',
      tool: toolNum,
      depth: -depth,
      feed,
      spindle,
      geometry: {
        x: Number(params.geometry?.x) || width / 2,
        y: Number(params.geometry?.y) || height / 2,
        diameter,
      },
      rPlane: Number(params.rPlane ?? params.r) || 2,
      retractMode: params.retractMode || 'G98',
      lengthOffset: Number(params.lengthOffset ?? params.h ?? 1),
      safeZ,
    })
  } else if (opType === 'drill' || opType === 'hole') {
    operations.push({
      type: 'drill',
      tool: toolNum,
      depth: -depth,
      feed,
      spindle,
      geometry: {
        x: Number(params.geometry?.x) || width / 2,
        y: Number(params.geometry?.y) || height / 2,
        diameter,
      },
      safeZ,
    })
  } else if (opType === 'circle' || opType === 'circular_profile') {
    operations.push({
      type: 'circular_profile',
      tool: toolNum,
      depth: -depth,
      feed,
      spindle,
      geometry: {
        cx: Number(params.geometry?.cx) || 0,
        cy: Number(params.geometry?.cy) || 0,
        radius: Number(params.geometry?.radius) || Math.min(width, height) / 2,
      },
      safeZ,
    })
  } else {
    // profile rectangle
    operations.push({
      type: 'profile',
      tool: toolNum,
      depth: -depth,
      feed,
      spindle,
      geometry: { width, height, originX: 0, originY: 0 },
      safeZ,
    })
  }

  return createEmptyGCodeIr({
    program: {
      number: Number(params.programNumber) || 1001,
      controller: String(params.machine || params.controller || 'FANUC').toUpperCase(),
      units: params.units || 'mm',
      absolute: true,
      workOffset: params.workOffset || 'G54',
    },
    tools,
    operations,
    meta: {
      source: 'parametric',
      intent: params.intent || opType,
      stock: params.stock || { x: width, y: height, z: Math.max(depth + 5, 10) },
    },
  })
}

function mapStrategy(s) {
  const t = String(s || '').toLowerCase()
  if (t.includes('drill')) return 'drill'
  if (t.includes('face')) return 'facing'
  if (t.includes('pocket')) return 'pocket'
  if (t.includes('slot')) return 'slot'
  if (t.includes('profile')) return 'profile'
  return t || 'profile'
}

function parseToolNum(t) {
  const m = String(t || 'T01').match(/(\d+)/)
  return m ? Number(m[1]) : 1
}

function normalizeTool(t) {
  if (!t) return { number: 1, type: 'endmill', diameter: 10 }
  return {
    number: parseToolNum(t.tool || t.number),
    diameter: Number(t.diameter) || 10,
    type: t.type || 'endmill',
    length: t.length,
    material: t.material,
  }
}

/**
 * NC 安全检查 — 通过才允许标记 SAFE（仍不自动下发机床）
 */

const DEFAULT_LIMITS = {
  xMin: -5,
  yMin: -5,
  xMax: 2000,
  yMax: 2000,
  zMin: -500,
  zMax: 300,
  feedMin: 1,
  feedMax: 5000,
  spindleMin: 50,
  spindleMax: 12000,
}

export function runNcSafetyChecks(toolpath, ncText, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) }
  const errors = []
  const warnings = []
  const stock = toolpath?.stock || {}

  // stock vs envelope
  if (stock.x && stock.x > limits.xMax) {
    errors.push({ code: 'STOCK_X_OVERFLOW', message: `毛坯 X=${stock.x} 超出机床范围` })
  }
  if (stock.y && stock.y > limits.yMax) {
    errors.push({ code: 'STOCK_Y_OVERFLOW', message: `毛坯 Y=${stock.y} 超出机床范围` })
  }

  for (const op of toolpath?.operations || []) {
    const p = op.params || {}
    if (p.feedMmMin < limits.feedMin || p.feedMmMin > limits.feedMax) {
      errors.push({
        code: 'FEED_OUT_OF_RANGE',
        message: `${op.id} 进给 ${p.feedMmMin} 超限`,
      })
    }
    if (p.spindleRpm < limits.spindleMin || p.spindleRpm > limits.spindleMax) {
      errors.push({
        code: 'SPINDLE_OUT_OF_RANGE',
        message: `${op.id} 主轴 ${p.spindleRpm} 超限`,
      })
    }
    if (op.strategy === 'unknown') {
      errors.push({ code: 'UNKNOWN_STRATEGY', message: `${op.id} 未知加工策略` })
    }
    for (const m of op.moves || []) {
      if (m.x != null && (m.x < limits.xMin || m.x > limits.xMax + Number(stock.x || 0))) {
        warnings.push({ code: 'AXIS_X_WARN', message: `${op.id} X=${m.x} 接近边界` })
      }
      if (m.z != null && m.z < limits.zMin) {
        errors.push({ code: 'Z_TOO_LOW', message: `${op.id} Z=${m.z} 过低` })
      }
      // feature deeper than stock
      if (op.geometry?.depth != null && stock.z != null && op.geometry.depth > stock.z + 1e-6) {
        errors.push({
          code: 'DEPTH_EXCEEDS_STOCK',
          message: `${op.id} 深度 ${op.geometry.depth} > 毛坯 Z ${stock.z}`,
        })
        break
      }
    }
  }

  const nc = String(ncText || '')
  if (!nc.trim()) {
    errors.push({ code: 'NC_EMPTY', message: 'NC 为空' })
  } else {
    if (!/%/.test(nc) && !/^O\d+/m.test(nc)) {
      warnings.push({ code: 'NC_NO_PROGRAM_ID', message: '未见程序号 Oxxxx 或 %' })
    }
    if (!/M30|M02/i.test(nc)) {
      warnings.push({ code: 'NC_NO_END', message: '未见 M30/M02' })
    }
    if (!/G90/i.test(nc)) {
      warnings.push({ code: 'NC_NO_G90', message: '建议包含 G90' })
    }
    // illegal chars
    if (/[^\x09\x0A\x0D\x20-\x7E]/.test(nc.replace(/\r\n/g, '\n'))) {
      warnings.push({ code: 'NC_NON_ASCII', message: 'NC 含非 ASCII 字符' })
    }
  }

  const ok = errors.length === 0
  return {
    ok,
    safe: ok,
    errors,
    warnings,
    limits,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      operationCount: toolpath?.operations?.length || 0,
    },
  }
}

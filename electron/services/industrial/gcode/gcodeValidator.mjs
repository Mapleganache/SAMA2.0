/**
 * G-code Validator — 语法/模态/工艺/机床限制
 * 绝不自动下发机床。
 */
import { parseGcodeText } from './gcodeParser.mjs'
import { getMachineProfile, profileToLimits, isGSupported, isMSupported } from './machineProfile.mjs'
import { getTool } from './toolDatabase.mjs'

export function validateGcode(ncText, opts = {}) {
  const errors = []
  const warnings = []
  const profile = getMachineProfile(opts.machineProfile || opts.profile)
  const limits = { ...profileToLimits(profile), ...(opts.limits || {}) }
  const stock = opts.stock || {}
  const parsed = parseGcodeText(ncText)
  const modal = parsed.finalModal || {}

  if (!String(ncText || '').trim()) {
    errors.push({ code: 'NC_EMPTY', message: 'NC 为空' })
  }

  // 1 units
  if (!modal.units) {
    warnings.push({ code: 'UNITS_UNSPECIFIED', message: '未明确指定单位 G20/G21' })
  }
  // 2 distance
  if (!modal.distance) {
    warnings.push({ code: 'DISTANCE_UNSPECIFIED', message: '未明确 G90/G91' })
  }
  // 3 work offset
  if (!modal.coordinateSystem) {
    warnings.push({ code: 'WCS_UNSPECIFIED', message: '未设置工件坐标系 G54…' })
  }

  // unsupported G/M vs profile
  for (const line of parsed.lines || []) {
    if (line.skip) continue
    for (const g of line.gCodes || []) {
      if (!isGSupported(profile, g)) {
        errors.push({
          code: 'UNSUPPORTED_G',
          message: `L${line.index} G${g} 不在机床 ${profile.id} 支持列表`,
        })
      }
    }
    for (const m of line.mCodes || []) {
      if (!isMSupported(profile, m)) {
        errors.push({
          code: 'UNSUPPORTED_M',
          message: `L${line.index} M${m} 不在机床 ${profile.id} 支持列表`,
        })
      }
    }
  }

  // G43 without H
  for (const line of parsed.lines || []) {
    if (line.skip) continue
    if ((line.gCodes || []).includes(43) && line.words?.H == null && modal.lengthOffset == null) {
      warnings.push({ code: 'G43_NO_H', message: `L${line.index} G43 建议指定 H 刀长补偿号` })
    }
    if ((line.gCodes || []).includes(41) || (line.gCodes || []).includes(42)) {
      if (line.words?.D == null && modal.radiusOffset == null) {
        warnings.push({ code: 'COMP_NO_D', message: `L${line.index} 刀补 G41/G42 建议指定 D` })
      }
    }
    // G83 without Q
    if ((line.gCodes || []).includes(83) && line.words?.Q == null && modal.q == null) {
      errors.push({ code: 'G83_NO_Q', message: `L${line.index} G83 深孔循环缺少 Q 切深` })
    }
  }

  // tools
  for (const t of parsed.tools || []) {
    const found = getTool(t, opts.extraTools || [])
    if (!found && opts.requireKnownTools) {
      errors.push({ code: 'TOOL_UNKNOWN', message: `刀具 ${t} 不在刀具库` })
    } else if (!found) {
      warnings.push({ code: 'TOOL_UNKNOWN', message: `刀具 ${t} 不在刀具库` })
    }
  }

  // spindle / feed on cutting
  let sawCutWithoutFeed = false
  let sawCutWithoutSpindle = false
  for (const line of parsed.lines || []) {
    if (line.skip) continue
    const m = line.modal || {}
    const cutting = m.motion === 'G01' || m.motion === 'G02' || m.motion === 'G03'
    if (cutting) {
      if (m.feed == null || m.feed <= 0) sawCutWithoutFeed = true
      if (!m.spindleDir || m.spindleDir === 'M05') sawCutWithoutSpindle = true
      if (m.feed != null && (m.feed < limits.feedMin || m.feed > limits.feedMax)) {
        errors.push({
          code: 'FEED_OUT_OF_RANGE',
          message: `L${line.index} 进给 F${m.feed} 超机床范围`,
        })
      }
      if (m.spindle != null && (m.spindle < limits.spindleMin || m.spindle > limits.spindleMax)) {
        errors.push({
          code: 'SPINDLE_OUT_OF_RANGE',
          message: `L${line.index} 主轴 S${m.spindle} 超机床范围`,
        })
      }
    }
    // travel
    for (const axis of ['x', 'y', 'z']) {
      const v = m[axis]
      if (v == null || !Number.isFinite(v)) continue
      const [lo, hi] =
        axis === 'x'
          ? [limits.xMin, limits.xMax]
          : axis === 'y'
            ? [limits.yMin, limits.yMax]
            : [limits.zMin, limits.zMax]
      if (v < lo || v > hi) {
        errors.push({
          code: 'TRAVEL_EXCEEDED',
          message: `L${line.index} ${axis.toUpperCase()}=${v} 超出机床行程 [${lo}, ${hi}]`,
        })
      }
    }
  }

  if (sawCutWithoutFeed) {
    warnings.push({ code: 'CUT_FEED_MISSING', message: '切削运动存在未指定合理进给 F 的情况' })
  }
  if (sawCutWithoutSpindle) {
    warnings.push({ code: 'CUT_SPINDLE_MISSING', message: '切削时主轴可能未开启 (M03/M04)' })
  }

  if (!/M30|M02/i.test(String(ncText || ''))) {
    warnings.push({ code: 'NC_NO_END', message: '未见 M30/M02' })
  }

  // stock depth
  const maxDepth = parsed.summary?.maxDepth
  if (stock.z != null && maxDepth != null && maxDepth < -Math.abs(Number(stock.z)) - 1e-6) {
    warnings.push({
      code: 'DEPTH_EXCEEDS_STOCK',
      message: `最大深度 Z=${maxDepth} 可能超过毛坯厚度 ${stock.z}`,
    })
  }

  // rapid at low Z
  for (const line of parsed.lines || []) {
    if (line.skip) continue
    if (line.modal?.motion === 'G00' && line.modal?.z != null && line.modal.z < 5) {
      if ((line.words?.X != null || line.words?.Y != null) && line.words?.Z == null) {
        warnings.push({
          code: 'RAPID_LOW_Z',
          message: `L${line.index} 低 Z 下可能 XY 快移，请确认安全高度`,
        })
        break
      }
    }
  }

  const ok = errors.length === 0
  return {
    ok,
    safe: ok,
    errors,
    warnings,
    parsed: {
      programNumber: parsed.programNumber,
      summary: parsed.summary,
      bounds: parsed.bounds,
      tools: parsed.tools,
    },
    machineProfile: { id: profile.id, name: profile.name },
    limits,
    note: '仅本地静态检查。禁止自动下发真实机床。',
  }
}

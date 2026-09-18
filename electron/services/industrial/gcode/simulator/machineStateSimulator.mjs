/**
 * 轻量 MachineState 逐行仿真（不依赖外部 CNC 软件）
 */
import { parseGcodeText } from '../gcodeParser.mjs'
import { getMachineProfile, profileToLimits } from '../machineProfile.mjs'
import { toolpathIrFromNc } from '../toolpathFromNc.mjs'

export function createMachineState(seed = {}) {
  return {
    lineIndex: 0, // 0-based into executable lines
    x: seed.x ?? 0,
    y: seed.y ?? 0,
    z: seed.z ?? 0,
    feed: seed.feed ?? null,
    spindle: seed.spindle ?? null,
    spindleDir: seed.spindleDir ?? null,
    tool: seed.tool ?? null,
    modal: seed.modal || null,
    done: false,
    error: null,
    path: [{ x: seed.x ?? 0, y: seed.y ?? 0, z: seed.z ?? 0, line: 0 }],
  }
}

/**
 * 准备仿真会话
 */
export function prepareNcSimulation(ncText, opts = {}) {
  const parsed = parseGcodeText(ncText)
  const toolpath = toolpathIrFromNc(ncText)
  const profile = getMachineProfile(opts.machineProfile || 'FANUC_MILL_LARGE')
  const limits = profileToLimits(profile)
  const execLines = (parsed.lines || []).filter((l) => !l.skip)
  return {
    kind: 'nc.simulation.session',
    ncText: String(ncText || ''),
    parsed,
    toolpath,
    profile: { id: profile.id, name: profile.name },
    limits,
    execLines,
    state: createMachineState(),
    note: '轻量本地逐行仿真，非厂商 CNC 软件。不下发机床。',
  }
}

function checkLimits(state, limits) {
  const errs = []
  if (state.x < limits.xMin || state.x > limits.xMax) {
    errs.push({ code: 'MACHINE_AXIS_LIMIT', message: `X=${state.x} 超程 [${limits.xMin},${limits.xMax}]` })
  }
  if (state.y < limits.yMin || state.y > limits.yMax) {
    errs.push({ code: 'MACHINE_AXIS_LIMIT', message: `Y=${state.y} 超程 [${limits.yMin},${limits.yMax}]` })
  }
  if (state.z < limits.zMin || state.z > limits.zMax) {
    errs.push({ code: 'MACHINE_AXIS_LIMIT', message: `Z=${state.z} 超程 [${limits.zMin},${limits.zMax}]` })
  }
  return errs
}

/**
 * 单步推进
 */
export function stepSimulation(session) {
  if (!session || session.state?.done) {
    return { ...session, state: { ...(session.state || {}), done: true } }
  }
  const state = { ...session.state, path: [...(session.state.path || [])] }
  const lines = session.execLines || []
  if (state.lineIndex >= lines.length) {
    state.done = true
    return { ...session, state }
  }
  const line = lines[state.lineIndex]
  const m = line.modal || {}
  state.x = m.x ?? state.x
  state.y = m.y ?? state.y
  state.z = m.z ?? state.z
  state.feed = m.feed ?? state.feed
  state.spindle = m.spindle ?? state.spindle
  state.spindleDir = m.spindleDir ?? state.spindleDir
  state.tool = m.tool ?? state.tool
  state.modal = m
  state.raw = line.raw
  state.sourceLine = line.index
  state.path.push({ x: state.x, y: state.y, z: state.z, line: line.index })

  const limitErrs = checkLimits(state, session.limits || {})
  if (limitErrs.length) {
    state.error = limitErrs[0]
  }

  state.lineIndex += 1
  if (state.lineIndex >= lines.length) state.done = true
  return { ...session, state }
}

export function runSimulationToEnd(session, maxSteps = 50000) {
  let s = session
  let steps = 0
  while (!s.state.done && steps < maxSteps) {
    s = stepSimulation(s)
    steps += 1
    if (s.state.error) break
  }
  return { session: s, steps, halted: !!s.state.error, done: !!s.state.done }
}

export function resetSimulation(session) {
  return {
    ...session,
    state: createMachineState(),
  }
}

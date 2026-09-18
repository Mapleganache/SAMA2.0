/**
 * CNC 仿真适配器
 * - 外部厂商仿真器：未配置 → CNC_SIMULATOR_NOT_AVAILABLE
 * - 本地轻量 MachineState：始终可用（opts.lite !== false）
 */
import {
  prepareNcSimulation,
  runSimulationToEnd,
  stepSimulation,
  resetSimulation,
} from './machineStateSimulator.mjs'

export async function runCncSimulation(ncText, opts = {}) {
  if (opts.forceFakeSuccess) {
    return {
      success: false,
      error: {
        code: 'SIM_FAKE_FORBIDDEN',
        message: '禁止伪造仿真成功',
      },
    }
  }

  // 外部仿真器（未接）
  const external = {
    success: false,
    error: {
      code: 'CNC_SIMULATOR_NOT_AVAILABLE',
      message: '本机未配置厂商 CNC 仿真器。',
    },
  }

  if (opts.externalOnly) {
    return { ...external, note: '不假装仿真通过；不下发真实机床。' }
  }

  // 本地轻量逐行仿真
  const session0 = prepareNcSimulation(ncText, opts)
  const { session, steps, halted, done } = runSimulationToEnd(session0)
  return {
    success: !halted && done,
    lite: true,
    steps,
    halted,
    done,
    error: session.state?.error || null,
    finalState: {
      x: session.state.x,
      y: session.state.y,
      z: session.state.z,
      feed: session.state.feed,
      spindle: session.state.spindle,
      tool: session.state.tool,
      sourceLine: session.state.sourceLine,
    },
    toolpath: session.toolpath,
    external,
    note: '已运行本地轻量仿真。厂商 CNC 仿真器仍不可用。禁止下发真实机床。',
  }
}

export {
  prepareNcSimulation,
  runSimulationToEnd,
  stepSimulation,
  resetSimulation,
}

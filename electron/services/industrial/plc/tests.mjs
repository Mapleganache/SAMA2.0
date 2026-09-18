/**
 * 从 PlcIR 自动生成基础测试用例并执行
 */
import { compilePlcToLadder } from './ladderIr.mjs'
import { runTrace } from './simulator.mjs'

export function generatePlcTests(ir) {
  const tests = []
  for (const step of ir.logic || []) {
    if (step.type === 'seal_in') {
      const start = step.input
      const stop = step.stop
      const out = step.output
      tests.push({
        id: `seal_idle_${out}`,
        name: `${out} idle`,
        steps: [{ holdMs: 100, inputs: { [start]: 0, [stop]: 0 }, expect: { [out]: 0 } }],
      })
      tests.push({
        id: `seal_start_${out}`,
        name: `${out} start`,
        steps: [
          { holdMs: 100, inputs: { [start]: 0, [stop]: 0 }, expect: { [out]: 0 } },
          { holdMs: 100, inputs: { [start]: 1, [stop]: 0 }, expect: { [out]: 1 } },
          { holdMs: 100, inputs: { [start]: 0, [stop]: 0 }, expect: { [out]: 1 } }, // sealed
        ],
      })
      tests.push({
        id: `seal_stop_${out}`,
        name: `${out} stop`,
        steps: [
          { holdMs: 100, inputs: { [start]: 1, [stop]: 0 }, expect: { [out]: 1 } },
          { holdMs: 100, inputs: { [start]: 1, [stop]: 1 }, expect: { [out]: 0 } },
        ],
      })
    }
    if (step.type === 'timer_on') {
      const en = step.input || step.enable
      const out = step.output || step.timer
      const preset = Number(step.presetMs) || 1000
      tests.push({
        id: `ton_before_${out}`,
        name: `${out} before preset`,
        steps: [
          {
            holdMs: Math.max(50, Math.floor(preset / 2)),
            inputs: { [en]: 1 },
            expect: { [out]: 0 },
          },
        ],
      })
      tests.push({
        id: `ton_after_${out}`,
        name: `${out} after preset`,
        steps: [
          {
            holdMs: preset + 200,
            inputs: { [en]: 1 },
            expect: { [out]: 1 },
          },
        ],
      })
    }
  }
  return tests
}

export function runPlcTestSuite(ir, { tests } = {}) {
  const ladder = compilePlcToLadder(ir)
  const suite = tests || generatePlcTests(ir)
  const results = []
  for (const t of suite) {
    const r = runTrace(ladder, t.steps)
    results.push({
      id: t.id,
      name: t.name,
      ok: r.ok,
      log: r.log,
    })
  }
  return {
    ok: results.every((x) => x.ok),
    total: results.length,
    passed: results.filter((x) => x.ok).length,
    failed: results.filter((x) => !x.ok).length,
    results,
    ladder,
  }
}

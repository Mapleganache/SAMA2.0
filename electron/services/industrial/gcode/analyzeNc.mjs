/**
 * NC 全量分析管线 V1.2：
 * ToolpathIR → Stock → Material Removal → Collision → Time → Explain → Fix → Report
 */
import { validateGcode } from './gcodeValidator.mjs'
import { toolpathIrFromNc } from './toolpathFromNc.mjs'
import { stockFromParams, createBoxStock } from './stock.mjs'
import { simulateMaterialRemoval } from './materialRemoval.mjs'
import { checkToolpathCollisions } from './collision.mjs'
import { estimateMachiningTime } from './timeEstimate.mjs'
import { explainNcProgram, explainNcLine } from './explain.mjs'
import { suggestNcFixes, applyNcFixes } from './ncFix.mjs'
import { buildMachiningReport } from './report.mjs'
import {
  prepareNcSimulation,
  runSimulationToEnd,
} from './simulator/machineStateSimulator.mjs'

function resolveStock(payload = {}, toolpath) {
  if (payload.stock?.type === 'box') return createBoxStock(payload.stock)
  if (payload.stock) return stockFromParams(payload.stock)
  const b = toolpath?.bounds
  if (b?.x && b?.y && b?.z) {
    const pad = 5
    const zMin = Math.min(b.z[0], b.z[1], -5)
    return createBoxStock({
      min: { x: b.x[0] - pad, y: b.y[0] - pad, z: Math.min(zMin, -10) },
      max: {
        x: b.x[1] + pad,
        y: b.y[1] + pad,
        z: Math.max(0, b.z[1], b.z[0]),
      },
    })
  }
  return stockFromParams({ width: 100, height: 60, thickness: 20 })
}

/**
 * @param {string} ncText
 * @param {object} opts
 */
export function analyzeNcPipeline(ncText, opts = {}) {
  const text = String(ncText || '')
  const machineProfile = opts.machineProfile || 'FANUC_MILL_LARGE'
  const validation = validateGcode(text, {
    machineProfile,
    stock: opts.stock,
    requireKnownTools: opts.requireKnownTools === true,
  })

  const toolpath = toolpathIrFromNc(text)
  const stock = resolveStock(opts, toolpath)
  const toolRadius =
    Number(opts.toolRadius) ||
    Number(opts.toolDiameter ? opts.toolDiameter / 2 : 0) ||
    5

  const removal = simulateMaterialRemoval(toolpath, stock, {
    cell: opts.cell || 2,
    toolRadius,
  })
  const collision = checkToolpathCollisions(toolpath, stock, {
    clearance: opts.clearance ?? 2,
  })
  const time = estimateMachiningTime(toolpath, {
    rapidFeedMmMin: opts.rapidFeedMmMin,
    toolChangeSec: opts.toolChangeSec,
    spindleStartSec: opts.spindleStartSec,
  })
  const explain = explainNcProgram(text)
  const fixes = suggestNcFixes(text)

  let liteSimulation = null
  let session = null
  try {
    session = prepareNcSimulation(text, { machineProfile })
    if (opts.runLiteSim !== false) {
      const run = runSimulationToEnd(session)
      liteSimulation = {
        lite: true,
        success: !run.session?.state?.error,
        halted: run.halted,
        steps: run.steps,
        error: run.session?.state?.error || null,
        finalState: run.session?.state
          ? {
              x: run.session.state.x,
              y: run.session.state.y,
              z: run.session.state.z,
              sourceLine: run.session.state.sourceLine,
            }
          : null,
      }
      session = run.session
    }
  } catch (err) {
    liteSimulation = {
      lite: true,
      success: false,
      error: { code: 'LITE_SIM_ERROR', message: err.message || String(err) },
    }
  }

  const reportMd = buildMachiningReport({
    programNumber: toolpath.programNumber,
    controller: opts.controller || machineProfile,
    stock,
    tools: toolpath.tools,
    time,
    validation,
    collision,
    removal,
    liteSimulation,
    risks: [],
  })

  // 轻量 session：去掉重 parsed.lines
  const lightSession = session
    ? {
        ...session,
        parsed: {
          programNumber: session.parsed?.programNumber,
          summary: session.parsed?.summary,
          lineCount: session.parsed?.lineCount,
        },
        execLines: (session.execLines || []).map((l) => ({
          index: l.index,
          raw: l.raw,
          modal: l.modal,
          gCodes: l.gCodes,
          mCodes: l.mCodes,
          words: l.words,
        })),
      }
    : null

  return {
    ok: true,
    schemaVersion: 2,
    toolpath,
    stock,
    removal: {
      ...removal,
      // IPC：高度场可能较大，默认保留；opts.omitHeights 可裁切
      heights: opts.omitHeights ? undefined : removal.heights,
    },
    collision,
    time,
    explain,
    fixes: fixes.fixes,
    validation,
    liteSimulation,
    session: lightSession,
    reportMarkdown: reportMd,
    downloadToMachine: false,
    note: 'G-code V1.2 分析完成。禁止自动下发真实机床。',
  }
}

export { explainNcLine, applyNcFixes, suggestNcFixes }

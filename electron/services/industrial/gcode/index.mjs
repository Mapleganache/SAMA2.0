/**
 * G-code V1 管线：
 * Intent/Params → GCodeIR → expand → Post → Validate → (可选) Simulator
 * 默认禁止下发真实机床。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  createEmptyGCodeIr,
  validateGCodeIr,
  gcodeIrFromParams,
  gcodeIrFromToolpath,
} from './gcodeIr.mjs'
import { expandGCodeIr } from './gcodeGenerator.mjs'
import { parseGcodeText } from './gcodeParser.mjs'
import { validateGcode } from './gcodeValidator.mjs'
import { postGCodeIr } from './post/index.mjs'
import { listMachineProfiles, getMachineProfile } from './machineProfile.mjs'
import { listTools, getTool } from './toolDatabase.mjs'
import { runCncSimulation } from './simulator/cncSimulatorAdapter.mjs'
import {
  prepareNcSimulation,
  stepSimulation,
  resetSimulation,
  runSimulationToEnd,
} from './simulator/machineStateSimulator.mjs'
import { toolpathIrFromNc } from './toolpathFromNc.mjs'
import { createModalState, describeModal } from './modalState.mjs'
import { analyzeNcPipeline, explainNcLine, applyNcFixes, suggestNcFixes } from './analyzeNc.mjs'
import { normalizeToolpathIr, createEmptyToolpathIr } from './toolpathIr.mjs'
import { stockFromParams, createBoxStock } from './stock.mjs'
import { simulateMaterialRemoval } from './materialRemoval.mjs'
import { checkToolpathCollisions } from './collision.mjs'
import { estimateMachiningTime } from './timeEstimate.mjs'
import { explainNcProgram, annotateNcProgramText } from './explain.mjs'
import { buildMachiningReport } from './report.mjs'

function resolveOutDir(explicit = '') {
  if (explicit) {
    const p = path.resolve(explicit)
    fs.mkdirSync(p, { recursive: true })
    return p
  }
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app?.getPath) {
      const dir = path.join(app.getPath('userData'), 'sama-data', 'workspace', 'gcode')
      fs.mkdirSync(dir, { recursive: true })
      return dir
    }
  } catch {
    /* node */
  }
  const dir = path.join(process.cwd(), 'workspace', 'gcode')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 参数化 / IR → NC + 校验
 */
export async function generateGcodePipeline(input = {}, opts = {}) {
  let ir
  if (input.kind === 'gcode.ir' || input.gcodeIr) {
    ir = input.gcodeIr || input
  } else if (input.kind === 'toolpath.ir' || input.toolpath) {
    ir = gcodeIrFromToolpath(input.toolpath || input, opts)
  } else {
    ir = gcodeIrFromParams(input)
  }

  const irCheck = validateGCodeIr(ir)
  if (!irCheck.ok) {
    return {
      success: false,
      error: { code: 'GCODE_IR_INVALID', message: 'GCodeIR 无效', errors: irCheck.errors },
    }
  }

  const expanded = expandGCodeIr(ir)
  const vendor = opts.vendor || expanded.program?.controller || 'fanuc'
  const ncText = postGCodeIr(expanded, vendor, {
    programNumber: expanded.program?.number,
  })

  const validation = validateGcode(ncText, {
    machineProfile: opts.machineProfile || 'FANUC_MILL_LARGE',
    stock: expanded.meta?.stock || input.stock,
    requireKnownTools: opts.requireKnownTools === true,
  })

  if (!validation.ok && opts.requireSafe !== false) {
    return {
      success: false,
      error: { code: 'GCODE_VALIDATION_FAILED', message: 'G-code 静态检查未通过', validation },
      gcodeIr: expanded,
      ncText,
      validation,
    }
  }

  const simulation = opts.runSimulation
    ? await runCncSimulation(ncText, { ...opts, externalOnly: true })
    : {
        success: false,
        skipped: true,
        error: { code: 'SIM_SKIPPED', message: '未请求仿真' },
      }

  const liteSimulation = opts.runSimulation
    ? await runCncSimulation(ncText, { ...opts, externalOnly: false })
    : null

  let artifact = null
  if (opts.write !== false) {
    const outDir = resolveOutDir(opts.outDir)
    const base = `O${String(expanded.program.number).padStart(4, '0')}_${Date.now().toString(36)}`
    const ncPath = path.join(outDir, `${base}.nc`)
    const irPath = path.join(outDir, `${base}.gcode.ir.json`)
    const valPath = path.join(outDir, `${base}.validate.json`)
    fs.writeFileSync(ncPath, ncText, 'utf8')
    fs.writeFileSync(irPath, JSON.stringify(expanded, null, 2), 'utf8')
    fs.writeFileSync(valPath, JSON.stringify(validation, null, 2), 'utf8')
    artifact = { nc: ncPath, gcodeIr: irPath, validate: valPath }
  }

  return {
    success: true,
    gcodeIr: expanded,
    ncText,
    validation,
    simulation,
    liteSimulation,
    artifact,
    downloadToMachine: false,
    note: 'G-code 已生成并完成静态检查。禁止自动下发真实机床；传输须用户确认。',
  }
}

export async function parseAndExplainNc(ncText) {
  const parsed = parseGcodeText(ncText)
  const validation = validateGcode(ncText, { machineProfile: 'FANUC_MILL_LARGE' })
  return {
    ok: true,
    parsed,
    validation,
    explanation: {
      program: parsed.programNumber,
      units: parsed.summary?.units,
      absolute: parsed.summary?.distance,
      wcs: parsed.summary?.workOffset,
      tools: parsed.tools,
      maxDepth: parsed.summary?.maxDepth,
      bounds: parsed.bounds,
    },
  }
}

export {
  createEmptyGCodeIr,
  validateGCodeIr,
  gcodeIrFromParams,
  gcodeIrFromToolpath,
  expandGCodeIr,
  parseGcodeText,
  validateGcode,
  postGCodeIr,
  listMachineProfiles,
  getMachineProfile,
  listTools,
  listTools as listGcodeTools,
  getTool,
  runCncSimulation,
  createModalState,
  describeModal,
  toolpathIrFromNc,
  prepareNcSimulation,
  stepSimulation,
  resetSimulation,
  runSimulationToEnd,
  analyzeNcPipeline,
  explainNcLine,
  explainNcProgram,
  annotateNcProgramText,
  applyNcFixes,
  suggestNcFixes,
  normalizeToolpathIr,
  createEmptyToolpathIr,
  stockFromParams,
  createBoxStock,
  simulateMaterialRemoval,
  checkToolpathCollisions,
  estimateMachiningTime,
  buildMachiningReport,
}

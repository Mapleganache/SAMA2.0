/**
 * Industrial 层对外入口 — Phase 6–12
 */
import { createCadNullAdapter } from './adapters/stubs/cadNull.mjs'
import { createCadDxfAdapter } from './adapters/cadDxfAdapter.mjs'
import { createElectricalNullAdapter } from './adapters/stubs/electricalNull.mjs'
import { createElectricalDxfAdapter } from './adapters/electricalDxfAdapter.mjs'
import { createPlcNullAdapter } from './adapters/stubs/plcNull.mjs'
import { createPlcSimAdapter } from './adapters/plcSimAdapter.mjs'
import { createCamNullAdapter } from './adapters/stubs/camNull.mjs'
import { createCamPostAdapter } from './adapters/camPostAdapter.mjs'
import { createDesktopBridgeAdapter } from './adapters/stubs/desktopBridge.mjs'
import * as registry from './adapters/registry.mjs'
import { validateIr, validateProject, normalizeIrKind } from './validate.mjs'
import { createProject, attachDomain, tryCreateFromIr, listCapabilities } from './pipeline.mjs'
import { createEmptyProject } from './schemas/project.mjs'
import { createEmptyCadIr } from './schemas/cad.mjs'
import { createEmptyElectricalIr } from './schemas/electrical.mjs'
import { createEmptyPlcIr } from './schemas/plc.mjs'
import { createEmptyCamIr } from './schemas/cam.mjs'
import { ADAPTER_LEVELS, describeAdapter } from './adapters/base.mjs'
import { materializeCadIr } from './cad/materialize.mjs'
import { summarizeCadGeometry } from './cad/geometry.mjs'
import { materializeElectricalIr } from './electrical/materialize.mjs'
import { runElectricalRules } from './electrical/rules.mjs'
import { materializePlcIr } from './plc/materialize.mjs'
import { compilePlcToLadder } from './plc/ladderIr.mjs'
import { runPlcTestSuite } from './plc/tests.mjs'
import { materializeCamIr } from './cam/materialize.mjs'
import { planCamOperations } from './cam/toolpath.mjs'
import { runNcSafetyChecks } from './cam/safety.mjs'
import {
  listWorkflows,
  runIndustrialWorkflow,
  getWorkflow,
  listProjects,
} from './workflows/runWorkflow.mjs'
import {
  packIndustrialProject,
  listIndustrialProjects,
  resolveProjectsRoot,
} from './projectPackager.mjs'
import {
  generateGcodePipeline,
  parseAndExplainNc,
  gcodeIrFromParams,
  listMachineProfiles,
  listGcodeTools,
  validateGcode,
  parseGcodeText,
  toolpathIrFromNc,
  prepareNcSimulation,
  stepSimulation,
  resetSimulation,
  runSimulationToEnd,
  analyzeNcPipeline,
  applyNcFixes,
  suggestNcFixes,
  explainNcLine,
  annotateNcProgramText,
} from './gcode/index.mjs'

let bootstrapped = false

export function bootstrapIndustrial() {
  if (bootstrapped && registry.size() > 0) return { already: true, size: registry.size() }
  registry.clearRegistry()
  registry.register(createCadNullAdapter())
  registry.register(createCadDxfAdapter())
  registry.register(createElectricalNullAdapter())
  registry.register(createElectricalDxfAdapter())
  registry.register(createPlcNullAdapter())
  registry.register(createPlcSimAdapter())
  registry.register(createCamNullAdapter())
  registry.register(createCamPostAdapter())
  registry.register(createDesktopBridgeAdapter())
  bootstrapped = true
  return { already: false, size: registry.size() }
}

bootstrapIndustrial()

export {
  registry,
  validateIr,
  validateProject,
  normalizeIrKind,
  createProject,
  attachDomain,
  tryCreateFromIr,
  listCapabilities,
  createEmptyProject,
  createEmptyCadIr,
  createEmptyElectricalIr,
  createEmptyPlcIr,
  createEmptyCamIr,
  ADAPTER_LEVELS,
  describeAdapter,
  bootstrapIndustrial as ensureIndustrialBootstrapped,
  materializeCadIr,
  summarizeCadGeometry,
  materializeElectricalIr,
  runElectricalRules,
  materializePlcIr,
  compilePlcToLadder,
  runPlcTestSuite,
  materializeCamIr,
  planCamOperations,
  runNcSafetyChecks,
  listWorkflows,
  runIndustrialWorkflow,
  getWorkflow,
  listProjects,
  packIndustrialProject,
  listIndustrialProjects,
  resolveProjectsRoot,
  generateGcodePipeline,
  parseAndExplainNc,
  gcodeIrFromParams,
  listMachineProfiles,
  listGcodeTools,
  validateGcode,
  parseGcodeText,
  toolpathIrFromNc,
  prepareNcSimulation,
  stepSimulation,
  resetSimulation,
  runSimulationToEnd,
  analyzeNcPipeline,
  applyNcFixes,
  suggestNcFixes,
  explainNcLine,
  annotateNcProgramText,
}

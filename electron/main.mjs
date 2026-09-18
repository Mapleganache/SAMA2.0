import { app, BrowserWindow, shell, ipcMain, screen, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getPublicSettings,
  saveSettings,
  loadSessions,
  saveSessions,
  loadLibrariesState,
  saveLibrariesState,
  loadKbStatus,
  ensureKnowledgeBase,
  loadSettings,
} from './services/store.mjs'
import {
  getAuthPublic,
  clearAdminPin,
} from './services/auth.mjs'
import { getDataRoot, getKbRoot } from './services/paths.mjs'
import { warmupMtkbSqlite } from './services/mtkb.mjs'
import {
  pickAndImportAsDatabase,
  exportSharePackage,
  listImportedDatabases,
  importPathsAsDatabase,
} from './services/kbPack.mjs'
import { testLlmConnection } from './services/deepseek.mjs'
import { runAgentTurn } from './services/agent.mjs'
import { runDesktopTool, listDesktopTools } from './services/desktop/index.mjs'
import {
  bootstrapIndustrial,
  validateIr,
  createProject,
  listCapabilities,
  attachDomain,
  tryCreateFromIr,
  runIndustrialWorkflow,
  listWorkflows,
  listProjects,
  createEmptyCadIr,
  createEmptyElectricalIr,
  createEmptyPlcIr,
  createEmptyCamIr,
  generateGcodePipeline,
  parseAndExplainNc,
  listMachineProfiles,
  listGcodeTools,
  toolpathIrFromNc,
  prepareNcSimulation,
  stepSimulation,
  resetSimulation,
  analyzeNcPipeline,
  applyNcFixes,
  annotateNcProgramText,
} from './services/industrial/index.mjs'
import { scanAndBind, scanAllBindable } from './services/industrial/softwareBind.mjs'
import {
  ensureWorkspaceSeed,
  listWorkspaceTree,
  readWorkspaceFile,
  writeWorkspaceFile,
  writeExternalFile,
  getWorkspaceRoot,
  deleteWorkspaceFile,
  revertWorkspaceSnapshots,
  mkdirWorkspaceFolder,
} from './services/workspace.mjs'
import {
  ensureLibraryFolders,
  saveGcodeToLibrary,
  saveNamedFileToLibrary,
  mkdirLibraryRel,
  getDesktopLibraryRoot,
  rewriteToLibraryRel,
} from './services/samaLibrary.mjs'
import {
  readSchematicFile,
  drawDiagramFromDocs,
  exportAndSaveConnectivity,
  slimElecRenderPayload,
  generateSheet,
  applyElecJsonFromText,
  extractPdfText,
  listSasl32Templates,
  renderAndSaveSheet,
} from './services/electrical/sheetService.mjs'
import { elecConnectivityStem } from './services/electrical/elecLibraryPath.mjs'
import {
  showOpenFilesDialog,
  showOpenFolderDialog,
  readExternalFiles,
  readExternalFilesAsync,
  listExternalDirTree,
  importExternalToWorkspace,
  ensureImportsDir,
} from './services/externalFiles.mjs'
import {
  openLadInLadderIii,
  probeLadderIii,
  exportMnemonicViaLadderIii,
  analyzeLadAfterAllow,
  setLadderIiiSessionAllow,
  getLadderIiiSessionAllow,
  resolveUsableLadPath,
  applyLadEditViaMnemonic,
} from './services/fanucLadderIii.mjs'
import {
  generateComplexDemoLad,
  resolveLadTemplate,
} from './services/fanucLadGenerate.mjs'
import {
  probeEplan,
  openElkInEplan,
  launchEplan,
  setEplanSessionAllow,
  getEplanSessionAllow,
  resolveUsableElkPath,
} from './services/eplanP8.mjs'
import {
  probeEplanAutomation,
  eplanExportPreview,
  exportElectricalToEplan,
} from './services/eplanBridge.mjs'
import {
  listEplanOperations,
  getEplanStatus,
  operateEplan,
} from './services/eplanOperator.mjs'
import {
  ELECTRICAL_V2_SYMBOLS,
  emptyElectricalProjectV2,
  sampleElectricalProjectV2,
  renderElectricalProjectV2,
  electricalProjectDrc,
  electricalProjectSave,
  electricalProjectLoad,
  electricalProjectList,
  electricalProjectExport,
} from './services/electrical/electricalProjectV2.mjs'
import {
  circuitCatalogList,
  circuitCaseGet,
  mechanicalLibraryStatus,
  mechanicalSearch,
  maintenanceDraftList,
  maintenanceDraftGet,
  maintenanceDraftSave,
  maintenanceDraftDelete,
  maintenanceDraftImport,
  maintenanceDiagnose,
  maintenanceUpdateObservation,
  maintenanceConversationGet,
  maintenanceAsk,
  maintenanceApplyProposal,
  maintenanceExport,
  workbenchOpenPath,
} from './services/workbench.mjs'

const LIB_DEFAULTS = [
  {
    id: 'mtkb-common',
    brand: '通用',
    title: 'MTKB 机床智能体 · 共通库',
    version: 'mtkb-sama-1.0.0',
    docs: 734,
    enabled: true,
  },
  {
    id: 'mtkb-circuit',
    brand: '通用',
    title: 'MTKB 电路 / PMC / 联锁专有库',
    version: 'mtkb-sama-1.0.0',
    docs: 1345,
    enabled: true,
  },
  {
    id: 'mtkb-equipment',
    brand: '通用',
    title: 'MTKB 设备专有库',
    version: 'mtkb-sama-1.0.0',
    docs: 36,
    enabled: true,
  },
  {
    id: 'studer',
    brand: 'STUDER',
    title: 'STUDER 磨床 / 梯形审查资料',
    version: 'CASE-S40',
    docs: 20,
    enabled: true,
  },
  {
    id: 'mikrosa',
    brand: 'MIKROSA',
    title: 'MIKROSA 磨床 / PMC 审查资料',
    version: 'CASE-SASL',
    docs: 10,
    enabled: true,
  },
  {
    id: 'fanuc-31i',
    brand: 'FANUC',
    title: 'Series 31i-B / 0i 相关资料',
    version: 'B-64484CM',
    docs: 42,
    enabled: true,
  },
  {
    id: 'fanuc-picture',
    brand: 'FANUC',
    title: 'PICTURE / HMI 资料',
    version: 'B-66284CM',
    docs: 18,
    enabled: true,
  },
  {
    id: 'siemens-840d',
    brand: 'SIEMENS',
    title: 'SINUMERIK 840D sl 编程',
    version: '6FC5398',
    docs: 36,
    enabled: true,
  },
  {
    id: 'mitsubishi-m80',
    brand: 'MITSUBISHI',
    title: 'M80/M800 报警与参数',
    version: 'IB-1501275',
    docs: 24,
    enabled: false,
  },
  {
    id: 'heidenhain-tnc',
    brand: 'HEIDENHAIN',
    title: 'TNC 640 用户手册',
    version: '893988',
    docs: 15,
    enabled: false,
  },
  {
    id: 'user-import',
    brand: '用户库',
    title: '用户导入 / 分享包资料',
    version: 'local',
    docs: 0,
    enabled: true,
  },
]

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

function resolveIcon() {
  const name = process.platform === 'darwin' ? 'icon.png' : 'icon.ico'
  if (isDev) return path.join(__dirname, '../build', name)
  return path.join(process.resourcesPath, name)
}

/** @type {BrowserWindow | null} */
let mainWindow = null
let isQuitting = false

function registerIpc() {
  ipcMain.handle('workbench:circuitCatalogList', (_e, filters) => {
    try { return circuitCatalogList(filters || {}) } catch (err) { console.error('[SAMA workbench circuit catalog]', err); return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:circuitCaseGet', (_e, caseId) => {
    try { return circuitCaseGet(caseId) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:mechanicalLibraryStatus', () => {
    try { return mechanicalLibraryStatus() } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:mechanicalSearch', (_e, payload) => {
    try { return mechanicalSearch(payload?.query, payload?.filters || {}) } catch (err) { return { ok: false, error: err.message || String(err), results: [] } }
  })
  ipcMain.handle('workbench:maintenanceDraftList', () => {
    try { return maintenanceDraftList() } catch (err) { return { ok: false, error: err.message || String(err), drafts: [] } }
  })
  ipcMain.handle('workbench:maintenanceDraftGet', (_e, id) => {
    try { return maintenanceDraftGet(id) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceDraftSave', (_e, workOrder) => {
    try { return maintenanceDraftSave(workOrder) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceDraftDelete', (_e, id) => {
    try { return maintenanceDraftDelete(id) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceDraftImport', async (e) => {
    try { return await maintenanceDraftImport(BrowserWindow.fromWebContents(e.sender)) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceDiagnose', async (_e, workOrder) => {
    try { return await maintenanceDiagnose(workOrder) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceUpdateObservation', (_e, payload) => {
    try { return maintenanceUpdateObservation(payload?.workOrderId, payload?.stepId, payload?.observation) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceConversationGet', (_e, workOrderId) => {
    try { return maintenanceConversationGet(workOrderId) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceAsk', async (_e, payload) => {
    try { return await maintenanceAsk(payload?.workOrderId, payload?.question, payload?.attachments || []) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceApplyProposal', (_e, payload) => {
    try { return maintenanceApplyProposal(payload?.workOrderId, payload?.proposalId, payload?.selectedChanges || []) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:maintenanceExport', async (e, payload) => {
    try { return await maintenanceExport(BrowserWindow.fromWebContents(e.sender), payload || {}) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('workbench:openPath', async (_e, target) => {
    try { return await workbenchOpenPath(target) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })

  ipcMain.handle('auth:status', () => getAuthPublic())
  ipcMain.handle('auth:setup', () => ({ ok: true, ...getAuthPublic() }))
  ipcMain.handle('auth:unlock', () => ({ ok: true, ...getAuthPublic() }))
  ipcMain.handle('auth:lock', () => ({ ok: true, ...getAuthPublic() }))
  ipcMain.handle('auth:clearPin', () => ({ ok: true, ...clearAdminPin() }))
  ipcMain.handle('auth:changePin', () => ({ ok: true, ...getAuthPublic() }))

  ipcMain.handle('ladder:probe', () => {
    const s = loadSettings()
    return probeLadderIii(s.fladderPath || '')
  })
  ipcMain.handle('ladder:resolveLad', (_e, payload) => {
    return resolveUsableLadPath(payload?.ladPath || '')
  })
  ipcMain.handle('ladder:sessionAllow', (_e, allowed) => {
    return { ok: true, allowed: setLadderIiiSessionAllow(allowed) }
  })
  ipcMain.handle('ladder:sessionAllowStatus', () => ({
    ok: true,
    allowed: getLadderIiiSessionAllow(),
  }))
  /** 打开 LADDER-III：须带 approved:true（前端 Allow 卡点过）或本会话已记住 */
  ipcMain.handle('ladder:open', (_e, payload) => {
    try {
      const { ladPath, approved, rememberSession } = payload || {}
      if (!approved && !getLadderIiiSessionAllow()) {
        return {
          ok: false,
          code: 'NEED_ALLOW',
          error: '需要先在界面点击「允许」再打开 LADDER-III',
        }
      }
      if (approved && rememberSession !== false) setLadderIiiSessionAllow(true)
      const s = loadSettings()
      return openLadInLadderIii(ladPath, { fladderPath: s.fladderPath || '' })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('ladder:exportMnemonic', async (_e, payload) => {
    try {
      const { ladPath, approved, rememberSession } = payload || {}
      if (!approved && !getLadderIiiSessionAllow()) {
        return {
          ok: false,
          code: 'NEED_ALLOW',
          error: '需要先允许启动 LADDER-III 再导出助记符',
        }
      }
      if (approved && rememberSession !== false) setLadderIiiSessionAllow(true)
      const s = loadSettings()
      return await exportMnemonicViaLadderIii(ladPath, { fladderPath: s.fladderPath || '' })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  /** 助记符追加梯级后 MnemonicToSrc 写回 .LAD（需已允许） */
  ipcMain.handle('ladder:applyEdit', async (_e, payload) => {
    try {
      const { ladPath, approved, rememberSession, proposed } = payload || {}
      if (!approved && !getLadderIiiSessionAllow()) {
        return {
          ok: false,
          code: 'NEED_ALLOW',
          error: '需要先允许后再改 LAD',
        }
      }
      if (approved && rememberSession !== false) setLadderIiiSessionAllow(true)
      const s = loadSettings()
      return await applyLadEditViaMnemonic(ladPath, proposed || {}, {
        fladderPath: s.fladderPath || '',
      })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  /** 允许后：导出助记符 + 生成报告 + 打开 GUI */
  ipcMain.handle('ladder:allowAndAnalyze', async (_e, payload) => {
    try {
      const { ladPath, approved, rememberSession, openGui } = payload || {}
      if (!approved && !getLadderIiiSessionAllow()) {
        return {
          ok: false,
          code: 'NEED_ALLOW',
          error: '需要先点击允许',
        }
      }
      if (approved && rememberSession !== false) setLadderIiiSessionAllow(true)
      const s = loadSettings()
      return await analyzeLadAfterAllow(ladPath, {
        fladderPath: s.fladderPath || '',
        openGui: openGui !== false,
      })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  /** 解析可用作演示外壳的模板 LAD */
  ipcMain.handle('ladder:resolveTemplate', (_e, payload) => {
    return resolveLadTemplate(payload?.ladPath || payload?.templateLad || '')
  })
  /** 基于模板生成演示复杂梯形 .LAD（需已允许） */
  ipcMain.handle('ladder:generateDemo', async (_e, payload) => {
    try {
      const { templateLad, outPath, approved, rememberSession, label } = payload || {}
      if (!approved && !getLadderIiiSessionAllow()) {
        return {
          ok: false,
          code: 'NEED_ALLOW',
          error: '需要先允许后再生成演示 LAD',
        }
      }
      if (approved && rememberSession !== false) setLadderIiiSessionAllow(true)
      const s = loadSettings()
      return await generateComplexDemoLad({
        templateLad: templateLad || '',
        outPath: outPath || '',
        fladderPath: s.fladderPath || '',
        label: label || 'PRESS',
        variant: payload?.variant || label || 'simple-press',
      })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('eplan:probe', () => {
    const s = loadSettings()
    return probeEplan(s.eplanPath || '')
  })
  ipcMain.handle('eplan:resolveElk', (_e, payload) => {
    return resolveUsableElkPath(payload?.elkPath || '')
  })
  ipcMain.handle('eplan:sessionAllow', (_e, allowed) => {
    return { ok: true, allowed: setEplanSessionAllow(allowed) }
  })
  ipcMain.handle('eplan:sessionAllowStatus', () => ({
    ok: true,
    allowed: getEplanSessionAllow(),
  }))
  ipcMain.handle('eplan:open', (_e, payload) => {
    try {
      const { elkPath, approved, rememberSession } = payload || {}
      if (!approved && !getEplanSessionAllow()) {
        return {
          ok: false,
          code: 'NEED_ALLOW',
          error: '需要先在界面点击「允许」再打开 EPLAN',
        }
      }
      if (approved && rememberSession !== false) setEplanSessionAllow(true)
      const s = loadSettings()
      return openElkInEplan(elkPath, { eplanPath: s.eplanPath || '' })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('eplan:launch', (_e, payload) => {
    try {
      const { approved, rememberSession } = payload || {}
      if (!approved && !getEplanSessionAllow()) {
        return {
          ok: false,
          code: 'NEED_ALLOW',
          error: '需要先在界面点击「允许」再启动 EPLAN',
        }
      }
      if (approved && rememberSession !== false) setEplanSessionAllow(true)
      const s = loadSettings()
      return launchEplan({ eplanPath: s.eplanPath || '' })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('eplan:automationProbe', (_e, payload) => {
    try { return probeEplanAutomation(payload?.eplanPath || '') } catch (err) { return { found: false, apiAvailable: false, bridgeAvailable: false, mode: 'task-pack', error: err.message || String(err) } }
  })
  ipcMain.handle('eplan:exportPreview', (_e, payload) => {
    try { return eplanExportPreview(payload?.project, payload?.eplanPath || '') } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('eplan:exportProject', async (e, payload) => {
    try { return await exportElectricalToEplan(BrowserWindow.fromWebContents(e.sender), payload?.project, payload || {}) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('eplan:listOperations', () => {
    try { return listEplanOperations() } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('eplan:status', (_e, payload) => {
    try {
      const s = loadSettings()
      return getEplanStatus({ eplanPath: payload?.eplanPath || s.eplanPath || '' })
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })
  ipcMain.handle('eplan:operate', async (e, payload) => {
    try {
      const { action, ...rest } = payload || {}
      return await operateEplan(action, rest, {
        parentWindow: BrowserWindow.fromWebContents(e.sender),
        approved: rest.approved,
        rememberSession: rest.rememberSession,
      })
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  /** Desktop Tool：PermissionManager 校验；CONFIRM 必须带主进程签发的 approvalId */
  ipcMain.handle('desktop:listTools', () => {
    try {
      return { ok: true, tools: listDesktopTools() }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })
  ipcMain.handle('desktop:run', async (_e, payload) => {
    try {
      const p = { ...(payload || {}) }
      // 防伪造：Renderer 不能跳过权限门闩
      delete p.skipPermissionGate
      const result = await runDesktopTool(p)
      return { ok: result.success, ...result }
    } catch (err) {
      return {
        ok: false,
        success: false,
        error: { code: err.code || 'DESKTOP_RUN_FAILED', message: err.message || String(err) },
      }
    }
  })

  // Phase 6：Industrial IR / Capability（地基，无真 CAD 生成）
  bootstrapIndustrial()
  ipcMain.handle('industrial:listCapabilities', async () => {
    try {
      const caps = await listCapabilities()
      return { ok: true, ...caps }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:scanSoftware', async (_e, payload) => {
    try {
      const adapterId = String(payload?.adapterId || '').trim()
      const extraRoot = String(payload?.dir || payload?.path || '').trim()
      if (adapterId) {
        const bound = scanAndBind(adapterId, extraRoot)
        const caps = await listCapabilities()
        return { ...bound, ...caps }
      }
      const scanned = scanAllBindable()
      const caps = await listCapabilities()
      return { ok: true, ...scanned, ...caps }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:pickSoftwareDir', async (_e, payload) => {
    try {
      const adapterId = String(payload?.adapterId || '').trim()
      if (!adapterId) return { ok: false, error: '缺少软件类型' }
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      const picked = await dialog.showOpenDialog(win || undefined, {
        title: '选择软件安装目录',
        properties: ['openDirectory'],
      })
      if (picked.canceled || !picked.filePaths?.[0]) {
        return { ok: false, cancelled: true }
      }
      const bound = scanAndBind(adapterId, picked.filePaths[0])
      const caps = await listCapabilities()
      return { ...bound, dir: picked.filePaths[0], ...caps }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:validate', (_e, payload) => {
    try {
      const { kind, data } = payload || {}
      const result = validateIr(kind, data)
      return { ok: result.ok, ...result }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:createProject', (_e, payload) => {
    try {
      const result = createProject(payload || {})
      return { ok: result.validation.ok, ...result }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:attachDomain', (_e, payload) => {
    try {
      const { project, domain, ir } = payload || {}
      const result = attachDomain(project, domain, ir)
      return { ok: result.ok, ...result }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:tryCreateFromIr', async (_e, payload) => {
    try {
      const { domain, ir, adapterId } = payload || {}
      const result = await tryCreateFromIr(domain, ir, { adapterId })
      return { ok: result.success, ...result }
    } catch (err) {
      return { ok: false, success: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:listWorkflows', () => {
    try {
      return { ok: true, workflows: listWorkflows() }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:runWorkflow', async (_e, payload) => {
    try {
      const { workflowId, ...opts } = payload || {}
      const result = await runIndustrialWorkflow(workflowId || opts.id || 'clamp_cylinder', opts)
      return { ok: result.success, ...result }
    } catch (err) {
      return { ok: false, success: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:listProjects', () => {
    try {
      return { ok: true, projects: listProjects() }
    } catch (err) {
      return { ok: false, projects: [], error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:openProjectDir', async (_e, payload) => {
    try {
      const dir = String(payload?.projectDir || payload?.path || '').trim()
      if (!dir) return { ok: false, error: '缺少 projectDir' }
      const err = await shell.openPath(dir)
      if (err) return { ok: false, error: err }
      return { ok: true, projectDir: dir }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:getEmptyIr', (_e, payload) => {
    try {
      const domain = String(payload?.domain || '').toLowerCase()
      const factories = {
        cad: createEmptyCadIr,
        electrical: createEmptyElectricalIr,
        plc: createEmptyPlcIr,
        cam: createEmptyCamIr,
      }
      const fn = factories[domain]
      if (!fn) return { ok: false, error: `未知域: ${domain}` }
      return { ok: true, domain, ir: fn(payload?.partial || {}) }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:generateGcode', async (_e, payload) => {
    try {
      const result = await generateGcodePipeline(payload?.params || payload || {}, payload?.opts || {})
      return { ok: !!result.success, ...result }
    } catch (err) {
      return { ok: false, success: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:parseGcode', async (_e, payload) => {
    try {
      const result = await parseAndExplainNc(payload?.ncText || payload?.text || '')
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:analyzeNc', (_e, payload) => {
    try {
      const ncText = payload?.ncText || payload?.text || ''
      const result = analyzeNcPipeline(ncText, {
        machineProfile: payload?.machineProfile || 'FANUC_MILL_LARGE',
        stock: payload?.stock,
        toolRadius: payload?.toolRadius,
        toolDiameter: payload?.toolDiameter,
        cell: payload?.cell,
        omitHeights: payload?.omitHeights === true,
        runLiteSim: payload?.runLiteSim !== false,
        controller: payload?.controller,
        clearance: payload?.clearance,
      })
      // 兼容旧 UI：仍返回可单步的 session（重置到起点）
      const session = prepareNcSimulation(ncText, {
        machineProfile: payload?.machineProfile || 'FANUC_MILL_LARGE',
      })
      const lightSession = {
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
      return {
        ...result,
        session: lightSession,
        downloadToMachine: false,
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:applyNcFixes', (_e, payload) => {
    try {
      const ncText = payload?.ncText || payload?.text || ''
      const fixes = payload?.fixes || []
      const next = applyNcFixes(ncText, fixes)
      const re = analyzeNcPipeline(next, {
        machineProfile: payload?.machineProfile || 'FANUC_MILL_LARGE',
        stock: payload?.stock,
        toolDiameter: payload?.toolDiameter,
        omitHeights: true,
      })
      return { ok: true, ncText: next, analysis: re }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:annotateNc', (_e, payload) => {
    try {
      const ncText = payload?.ncText || payload?.text || ''
      if (!String(ncText).trim()) return { ok: false, error: '空程序' }
      return annotateNcProgramText(ncText)
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:listGcodeMeta', () => {
    try {
      return {
        ok: true,
        machines: listMachineProfiles(),
        tools: listGcodeTools(),
        note: 'G-code V1.2：Stock / 材料去除 / 碰撞 / 时间 / 解释 / 修复。不下发机床。',
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:simStep', (_e, payload) => {
    try {
      const session = payload?.session
      if (!session) return { ok: false, error: '缺少 session' }
      const next = stepSimulation(session)
      return { ok: true, session: next }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
  ipcMain.handle('industrial:simReset', (_e, payload) => {
    try {
      const session = payload?.session
      if (!session) return { ok: false, error: '缺少 session' }
      return { ok: true, session: resetSimulation(session) }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('settings:get', () => getPublicSettings())
  ipcMain.handle('settings:set', (_e, partial) => {
    const clean = { ...partial }
    if (typeof clean.apiKey === 'string' && clean.apiKey.includes('****')) {
      delete clean.apiKey
    }
    if (typeof clean.visionApiKey === 'string' && clean.visionApiKey.includes('****')) {
      delete clean.visionApiKey
    }
    return saveSettings(clean)
  })

  ipcMain.handle('deepseek:test', async () => {
    try {
      return await testLlmConnection()
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('agent:chat', async (_e, payload) => {
    try {
      const p = { ...(payload || {}) }
      const result = await runAgentTurn(p)
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('sessions:load', () => loadSessions())
  ipcMain.handle('sessions:save', (_e, payload) => saveSessions(payload))

  ipcMain.handle('libraries:load', () => loadLibrariesState(LIB_DEFAULTS))
  ipcMain.handle('libraries:save', (_e, payload) => saveLibrariesState(payload))

  ipcMain.handle('kb:status', () => loadKbStatus())
  ipcMain.handle('kb:rebuild', () => ensureKnowledgeBase({ force: true }))
  ipcMain.handle('kb:openDocs', async () => {
    const docs = path.join(getKbRoot(), 'docs')
    await shell.openPath(docs)
    return { ok: true, path: docs }
  })
  ipcMain.handle('kb:importAsDatabase', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return pickAndImportAsDatabase(win)
  })
  ipcMain.handle('kb:importPathsAsDatabase', async (_e, payload) => {
    const paths = payload?.paths || []
    return importPathsAsDatabase(paths, { collectionName: payload?.collectionName })
  })
  ipcMain.handle('kb:exportSharePackage', async (e, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return exportSharePackage(win, opts || {})
  })
  ipcMain.handle('kb:listUserDatabases', () => ({
    ok: true,
    databases: listImportedDatabases(),
  }))
  ipcMain.handle('data:open', async () => {
    const root = getDataRoot()
    await shell.openPath(root)
    return { ok: true, path: root }
  })

  ipcMain.handle('workspace:tree', () => {
    ensureWorkspaceSeed()
    return { ok: true, root: getWorkspaceRoot(), tree: listWorkspaceTree() }
  })

  ipcMain.handle('workspace:read', (_e, relPath) => {
    try {
      return { ok: true, ...readWorkspaceFile(relPath) }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('workspace:write', (_e, payload) => {
    try {
      const { path: relPath, content } = payload || {}
      return { ok: true, ...writeWorkspaceFile(relPath, content) }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('workspace:mkdir', (_e, payload) => {
    try {
      const raw = String(payload?.path || '').trim()
      if (!raw) throw new Error('文件夹路径为空')
      const rel = rewriteToLibraryRel(raw)
      return { ok: true, ...mkdirWorkspaceFolder(rel) }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('library:saveGcode', (_e, payload) => {
    try {
      return { ok: true, ...saveGcodeToLibrary(payload || {}) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('library:saveFile', (_e, payload) => {
    try {
      return { ok: true, ...saveNamedFileToLibrary(payload || {}) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('library:mkdir', (_e, payload) => {
    try {
      return { ok: true, ...mkdirLibraryRel(payload?.path, { readme: payload?.readme || '' }) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('library:open', async () => {
    try {
      ensureLibraryFolders()
      const root = getDesktopLibraryRoot()
      const err = await shell.openPath(root)
      if (err) return { ok: false, error: err, path: root }
      return { ok: true, path: root }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('electrical:templates', () => ({
    ok: true,
    templates: listSasl32Templates().map((t) => ({ id: t.id, label: t.label })),
  }))

  ipcMain.handle('electrical:generate', (_e, payload) => {
    try {
      return { ok: true, ...generateSheet(payload || {}) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('electrical:read', async (_e, payload) => {
    try {
      const p = String(payload?.path || '')
      if (!p) return { ok: false, error: '缺少 PDF 路径' }
      const read = await readSchematicFile(p, payload || {})
      if (payload?.mode === 'diagram' && read.docs?.length) {
        const text = read.textPreview ? await extractPdfText(p) : ''
        const stem = elecConnectivityStem(read.docs)
        const drawn = await drawDiagramFromDocs(read.docs, {
          name: stem,
          pdfReferenceText: text,
        })
        if (!drawn.ok) return slimElecRenderPayload([drawn])
        const connSaved = exportAndSaveConnectivity(read.docs, { name: stem })
        return {
          ok: true,
          ...slimElecRenderPayload([
            {
              ...drawn,
              txtPath: connSaved.txtPath,
              txtDesktopPath: connSaved.txtDesktopPath,
              markdown: connSaved.markdown,
            },
          ]),
          fromPdf: read.fromPdf,
          toc: read.toc,
        }
      }
      return { ok: true, ...read }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('electrical:render', async (_e, payload) => {
    try {
      let text = payload?.text
      if (!text && payload?.textPath) {
        text = fs.readFileSync(String(payload.textPath), 'utf8')
      }
      if (text) {
        let pdfReferenceText = String(payload?.pdfReferenceText || '')
        if (!pdfReferenceText && payload?.pdfPath) {
          try {
            pdfReferenceText = await extractPdfText(String(payload.pdfPath))
          } catch {
            /* 对照文本可选 */
          }
        }
        const arts = await applyElecJsonFromText(text, {
          save: payload?.save !== false,
          pdfReferenceText,
          mode: payload?.mode === 'diagram' ? 'diagram' : 'connectivity',
        })
        return slimElecRenderPayload(arts)
      }
      return { ok: true, ...renderAndSaveSheet(payload?.doc || payload || {}) }
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('electrical:v2Symbols', () => ({ ok: true, symbols: ELECTRICAL_V2_SYMBOLS.map(([id, label]) => ({ id, label })) }))
  ipcMain.handle('electrical:v2Create', (_e, payload) => ({ ok: true, project: payload?.sample ? sampleElectricalProjectV2() : emptyElectricalProjectV2() }))
  ipcMain.handle('electrical:v2Render', (_e, project) => {
    try { return renderElectricalProjectV2(project) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('electrical:v2Drc', (_e, project) => {
    try { return { ok: true, drc: electricalProjectDrc(project) } } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('electrical:v2Save', (_e, project) => {
    try { return electricalProjectSave(project) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('electrical:v2Load', (_e, id) => {
    try { return electricalProjectLoad(id) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })
  ipcMain.handle('electrical:v2List', () => {
    try { return electricalProjectList() } catch (err) { return { ok: false, error: err.message || String(err), projects: [] } }
  })
  ipcMain.handle('electrical:v2Export', async (e, payload) => {
    try { return await electricalProjectExport(BrowserWindow.fromWebContents(e.sender), payload?.project, payload?.formats || []) } catch (err) { return { ok: false, error: err.message || String(err) } }
  })

  ipcMain.handle('workspace:open', async () => {
    ensureWorkspaceSeed()
    const root = getWorkspaceRoot()
    await shell.openPath(root)
    return { ok: true, path: root }
  })

  ipcMain.handle('workspace:revert', (_e, snapshots) => {
    try {
      const results = revertWorkspaceSnapshots(snapshots || [])
      return { ok: true, results }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('workspace:delete', () => {
    try {
      deleteWorkspaceFile()
      return { ok: false, error: 'forbidden' }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('files:openDialog', async () => {
    try {
      return await showOpenFilesDialog()
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })
  ipcMain.handle('files:openFolderDialog', async () => {
    try {
      return await showOpenFolderDialog()
    } catch (err) {
      return { ok: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('files:readPaths', async (_e, paths) => {
    try {
      return { ok: true, files: await readExternalFilesAsync(paths || []) }
    } catch (err) {
      return { ok: false, error: err.message || String(err), files: [] }
    }
  })

  ipcMain.handle('files:listDirTree', (_e, dirPath) => {
    try {
      return listExternalDirTree(dirPath || '')
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('files:import', (_e, payload) => {
    try {
      ensureImportsDir()
      const { path: absPath, name } = payload || {}
      return importExternalToWorkspace(absPath, name)
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })

  ipcMain.handle('files:writeExternal', (_e, payload) => {
    try {
      const { path: absPath, content, trustedPaths } = payload || {}
      return {
        ok: true,
        ...writeExternalFile(absPath, content, {
          trustedPaths: trustedPaths || [absPath],
        }),
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code }
    }
  })
}

function createWindow() {
  const { width: aw, height: ah } = screen.getPrimaryDisplay().workAreaSize
  // 按屏幕工作区自适应首开尺寸，小屏不再被 1440×900 撑出可视区
  const width = Math.min(1440, Math.max(880, Math.floor(aw * 0.92)))
  const height = Math.min(900, Math.max(560, Math.floor(ah * 0.9)))

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: 'SAMA 1.3',
    icon: resolveIcon(),
    backgroundColor: '#0f1419',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      v8CacheOptions: 'code',
    },
  })
  win.setMinimumSize(720, 480)
  if (width >= aw - 16 && height >= ah - 16) {
    win.maximize()
  }

  mainWindow = win

  win.webContents.once('dom-ready', () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  })
  win.once('ready-to-show', () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    win.destroy()
  })

  win.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.sama.app')
  }
  ensureKnowledgeBase({ force: false })
  warmupMtkbSqlite()
  ensureWorkspaceSeed()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.destroy()
    mainWindow = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.exit(0)
})

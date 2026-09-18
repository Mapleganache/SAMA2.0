import type { AuthPublic, ChatPayload, KbStatus, SamaSettings } from './vite-env'

const hasBridge = () => typeof window !== 'undefined' && !!window.sama

/** 浏览器预览回退：无 Electron 时用 localStorage（API 需在设置里填 Key，经主进程才安全；预览仅提示） */
export const samaClient = {
  async getSettings(): Promise<SamaSettings> {
    if (hasBridge()) return window.sama!.getSettings()
    return {
      model: 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1',
      provider: 'groq',
      apiKey: '',
      hasApiKey: false,
      dataRoot: '(浏览器预览，无本地存档)',
    }
  },

  async saveSettings(partial: Partial<{
    apiKey: string
    model: string
    baseUrl: string
    provider: string
    fladderPath: string
    eplanPath: string
    visionProvider: string
    visionModel: string
    visionApiKey: string
  }>) {
    if (hasBridge()) return window.sama!.saveSettings(partial)
    throw new Error('请用 Electron 窗口运行（release 下的 SAMA 或 npm run electron:dev）以保存设置')
  },

  async testApi() {
    if (hasBridge()) return window.sama!.testApi()
    return { ok: false, error: '请在桌面版中测试 API' }
  },

  async chat(payload: ChatPayload) {
    if (hasBridge()) return window.sama!.chat(payload)
    return {
      ok: false,
      error: '当前是浏览器预览。请打开桌面版 SAMA 以调用模型。',
      code: 'NO_BRIDGE',
    }
  },

  async loadSessions() {
    if (hasBridge()) return window.sama!.loadSessions()
    return { sessions: [], activeSessionId: '', messagesBySession: {} }
  },

  async saveSessions(payload: unknown) {
    if (hasBridge()) return window.sama!.saveSessions(payload)
    return { ok: false }
  },

  async loadLibraries() {
    if (hasBridge()) return window.sama!.loadLibraries()
    return { libraries: null }
  },

  async saveLibraries(payload: unknown) {
    if (hasBridge()) return window.sama!.saveLibraries(payload)
    return { ok: false }
  },

  async getKbStatus(): Promise<KbStatus> {
    if (hasBridge()) return window.sama!.getKbStatus()
    return {
      ready: false,
      docCount: 0,
      chunkCount: 0,
      updatedAt: null,
      brands: [],
      note: '浏览器预览无知识库',
    }
  },

  async rebuildKb() {
    if (hasBridge()) return window.sama!.rebuildKb()
    throw new Error('请在桌面版中构建知识库')
  },

  async openDataDir() {
    if (hasBridge()) return window.sama!.openDataDir()
    return { ok: false, path: '' }
  },

  async openKbDocs() {
    if (hasBridge()) return window.sama!.openKbDocs()
    return { ok: false, path: '' }
  },

  async importAsDatabase() {
    if (hasBridge()) return window.sama!.importAsDatabase()
    throw new Error('请在桌面版中导入资料')
  },

  async importPathsAsDatabase(payload: { paths: string[]; collectionName?: string }) {
    if (hasBridge()) return window.sama!.importPathsAsDatabase(payload)
    throw new Error('请在桌面版中导入资料')
  },

  async exportSharePackage(opts?: {
    includeBundledMtkb?: boolean
    includeUserDocs?: boolean
    includeUserDb?: boolean
  }) {
    if (hasBridge()) return window.sama!.exportSharePackage(opts)
    throw new Error('请在桌面版中导出分享包')
  },

  async listUserDatabases() {
    if (hasBridge()) return window.sama!.listUserDatabases()
    return { ok: true, databases: [] }
  },

  async workspaceTree() {
    if (hasBridge()) return window.sama!.workspaceTree()
    return { ok: false, tree: [] }
  },

  async workspaceRead(relPath: string) {
    if (hasBridge()) return window.sama!.workspaceRead(relPath)
    return { ok: false, error: '请在桌面版中读写工程文件' }
  },

  async workspaceWrite(payload: { path: string; content: string }) {
    if (hasBridge()) return window.sama!.workspaceWrite(payload)
    return { ok: false, error: '请在桌面版中保存工程文件' }
  },

  async workspaceMkdir(payload: { path: string }) {
    if (hasBridge()) return window.sama!.workspaceMkdir(payload)
    return { ok: false, error: '请在桌面版中新建文件夹' }
  },

  async librarySaveGcode(payload: { content: string; machine?: string; name?: string }) {
    if (hasBridge()) return window.sama!.librarySaveGcode(payload)
    return { ok: false, error: '请在桌面版中生成 G 代码文件' }
  },

  async librarySaveFile(payload: { name: string; content?: string; hint?: string }) {
    if (hasBridge()) return window.sama!.librarySaveFile(payload)
    return { ok: false, error: '请在桌面版中新建文件' }
  },

  async libraryMkdir(payload: { path: string; readme?: string }) {
    if (hasBridge()) return window.sama!.libraryMkdir(payload)
    return { ok: false, error: '请在桌面版中新建文件夹' }
  },

  async libraryOpen() {
    if (hasBridge()) return window.sama!.libraryOpen()
    return { ok: false, error: '请在桌面版中打开 SAMA文件' }
  },

  async electricalGenerate(payload?: { template?: string; machine?: string; text?: string; doc?: unknown }) {
    if (hasBridge()) return window.sama!.electricalGenerate(payload)
    return { ok: false, error: '请在桌面版中生成电路图' }
  },

  async electricalRead(payload: { path: string; page?: number; mode?: 'diagram' | 'connectivity' }) {
    if (hasBridge()) return window.sama!.electricalRead(payload)
    return { ok: false, error: '请在桌面版中识读电路图 PDF' }
  },

  async electricalRender(payload: {
    doc?: unknown
    text?: string
    textPath?: string
    pdfPath?: string
    pdfReferenceText?: string
    mode?: 'diagram' | 'connectivity'
  }) {
    if (hasBridge()) return window.sama!.electricalRender(payload)
    return { ok: false, error: '请在桌面版中渲染电路图' }
  },

  async workspaceRevert(
    snapshots: { path: string; existed: boolean; previousContent: string | null }[],
  ) {
    if (hasBridge()) return window.sama!.workspaceRevert(snapshots)
    return { ok: false, error: '请在桌面版中撤回文件' }
  },

  async openWorkspace() {
    if (hasBridge()) return window.sama!.openWorkspace()
    return { ok: false, path: '' }
  },

  async openLocalFiles() {
    if (hasBridge()) return window.sama!.openLocalFiles()
    return { ok: false, error: '请在桌面版中打开本机文件', files: [] }
  },

  async openLocalFolder() {
    if (hasBridge()) return window.sama!.openLocalFolder()
    return { ok: false, error: '请在桌面版中打开本机文件夹', files: [] }
  },

  async readLocalPaths(paths: string[]) {
    if (hasBridge()) return window.sama!.readLocalPaths(paths)
    return { ok: false, error: '请在桌面版中读取本机文件', files: [] }
  },

  async listLocalDirTree(dirPath: string) {
    if (hasBridge()) return window.sama!.listLocalDirTree(dirPath)
    return { ok: false, error: '请在桌面版中浏览本机文件夹' }
  },

  async importLocalFile(payload: { path: string; name?: string }) {
    if (hasBridge()) return window.sama!.importLocalFile(payload)
    return { ok: false, error: '请在桌面版中导入文件' }
  },

  async writeLocalFile(payload: { path: string; content: string; trustedPaths?: string[] }) {
    if (hasBridge()) return window.sama!.writeLocalFile(payload)
    return { ok: false, error: '请在桌面版中保存本机文件' }
  },

  getPathForFile(file: File) {
    if (!hasBridge()) return ''
    try {
      return window.sama!.getPathForFile(file)
    } catch {
      return ''
    }
  },

  async authStatus() {
    if (hasBridge()) return window.sama!.authStatus()
    return { hasPin: false, authEnabled: false, role: 'admin' as const, needsSetup: false }
  },

  async authChangePin(_pin: string): Promise<AuthPublic> {
    if (hasBridge()) return window.sama!.authChangePin(_pin)
    return { ok: true, hasPin: false, authEnabled: false, role: 'admin', needsSetup: false }
  },

  async authSetup(_pin: string): Promise<AuthPublic> {
    if (hasBridge()) return window.sama!.authSetup(_pin)
    return { ok: true, hasPin: false, authEnabled: false, role: 'admin', needsSetup: false }
  },

  async authUnlock(_pin: string): Promise<AuthPublic> {
    if (hasBridge()) return window.sama!.authUnlock(_pin)
    return { ok: true, hasPin: false, authEnabled: false, role: 'admin', needsSetup: false }
  },

  async authClearPin(): Promise<AuthPublic> {
    if (hasBridge()) return window.sama!.authClearPin()
    return { ok: true, hasPin: false, authEnabled: false, role: 'admin', needsSetup: false }
  },

  async authLock(): Promise<AuthPublic> {
    if (hasBridge()) return window.sama!.authLock()
    return { ok: true, hasPin: false, authEnabled: false, role: 'admin', needsSetup: false }
  },

  async ladderProbe() {
    if (hasBridge()) return window.sama!.ladderProbe()
    return { found: false, fladderPath: '', hint: '浏览器预览不可用' }
  },

  async ladderResolveLad(payload: { ladPath?: string }) {
    if (hasBridge()) return window.sama!.ladderResolveLad(payload)
    return { ok: false, path: '', error: '请在桌面版中解析 LAD' }
  },

  async ladderSessionAllow(allowed: boolean) {
    if (hasBridge()) return window.sama!.ladderSessionAllow(allowed)
    return { ok: true, allowed }
  },

  async ladderSessionAllowStatus() {
    if (hasBridge()) return window.sama!.ladderSessionAllowStatus()
    return { ok: true, allowed: false }
  },

  async ladderOpen(payload: { ladPath: string; approved?: boolean; rememberSession?: boolean }) {
    if (hasBridge()) return window.sama!.ladderOpen(payload)
    return { ok: false, error: '请在桌面版中打开 LADDER-III' }
  },

  async ladderExportMnemonic(payload: {
    ladPath: string
    approved?: boolean
    rememberSession?: boolean
  }) {
    if (hasBridge()) return window.sama!.ladderExportMnemonic(payload)
    return { ok: false, error: '请在桌面版中导出助记符' }
  },

  async ladderApplyEdit(payload: {
    ladPath: string
    approved?: boolean
    rememberSession?: boolean
    proposed?: { name?: string; input?: string; output?: string }
  }) {
    if (hasBridge()) return window.sama!.ladderApplyEdit(payload)
    return { ok: false, error: '请在桌面版中写回 LAD' }
  },

  async ladderAllowAndAnalyze(payload: {
    ladPath: string
    approved?: boolean
    rememberSession?: boolean
    openGui?: boolean
  }) {
    if (hasBridge()) return window.sama!.ladderAllowAndAnalyze(payload)
    return { ok: false, error: '请在桌面版中分析' }
  },

  async ladderResolveTemplate(payload: { ladPath?: string; templateLad?: string }) {
    if (hasBridge()) return window.sama!.ladderResolveTemplate(payload)
    return { ok: false, error: '请在桌面版中解析模板' }
  },

  async ladderGenerateDemo(payload: {
    templateLad?: string
    outPath?: string
    approved?: boolean
    rememberSession?: boolean
    label?: string
    variant?: string
  }) {
    if (hasBridge()) return window.sama!.ladderGenerateDemo(payload)
    return { ok: false, error: '请在桌面版中生成演示 LAD' }
  },

  async eplanProbe() {
    if (hasBridge()) return window.sama!.eplanProbe()
    return { found: false, eplanPath: '', hint: '浏览器预览不可用' }
  },

  async eplanResolveElk(payload: { elkPath?: string }) {
    if (hasBridge()) return window.sama!.eplanResolveElk(payload)
    return { ok: false, path: '', error: '请在桌面版中解析 EPLAN 工程' }
  },

  async eplanSessionAllow(allowed: boolean) {
    if (hasBridge()) return window.sama!.eplanSessionAllow(allowed)
    return { ok: true, allowed }
  },

  async eplanSessionAllowStatus() {
    if (hasBridge()) return window.sama!.eplanSessionAllowStatus()
    return { ok: true, allowed: false }
  },

  async eplanOpen(payload: { elkPath: string; approved?: boolean; rememberSession?: boolean }) {
    if (hasBridge()) return window.sama!.eplanOpen(payload)
    return { ok: false, error: '请在桌面版中打开 EPLAN' }
  },

  async eplanLaunch(payload: { approved?: boolean; rememberSession?: boolean }) {
    if (hasBridge()) return window.sama!.eplanLaunch(payload)
    return { ok: false, error: '请在桌面版中启动 EPLAN' }
  },

  async eplanAutomationProbe(payload?: { eplanPath?: string }) {
    if (hasBridge()) return window.sama!.eplanAutomationProbe(payload)
    return { found: false, apiAvailable: false, bridgeAvailable: false, mode: 'task-pack' }
  },

  async eplanExportPreview(payload: { project?: unknown; eplanPath?: string }) {
    if (hasBridge()) return window.sama!.eplanExportPreview(payload)
    return { ok: false, error: '请在桌面版中预览 EPLAN 导出' }
  },

  async eplanExportProject(payload: {
    project?: unknown
    eplanPath?: string
    confirmed?: boolean
    outDir?: string
    silent?: boolean
  }) {
    if (hasBridge()) return window.sama!.eplanExportProject(payload)
    return { ok: false, error: '请在桌面版中导出 EPLAN 任务包' }
  },

  async eplanListOperations() {
    if (hasBridge()) return window.sama!.eplanListOperations()
    return { ok: false, operations: [] }
  },

  async eplanStatus(payload?: { eplanPath?: string }) {
    if (hasBridge()) return window.sama!.eplanStatus(payload)
    return { ok: false, error: '请在桌面版中查看 EPLAN 状态' }
  },

  async eplanOperate(payload: {
    action: string
    approved?: boolean
    rememberSession?: boolean
    elkPath?: string
    machineModel?: string
    pdfPath?: string
    path?: string
    project?: unknown
    outDir?: string
    confirmed?: boolean
    silent?: boolean
    eplanPath?: string
  }) {
    if (hasBridge()) return window.sama!.eplanOperate(payload)
    return { ok: false, error: '请在桌面版中操作 EPLAN' }
  },

  async desktopListTools() {
    if (hasBridge()) return window.sama!.desktopListTools()
    return { ok: false, tools: [], error: '请在桌面版中使用 Desktop Tool' }
  },

  async desktopRun(payload: {
    tool: string
    args?: Record<string, unknown>
    approved?: boolean
    approvalId?: string
  }) {
    if (hasBridge()) return window.sama!.desktopRun(payload)
    return { ok: false, success: false, error: { code: 'NO_BRIDGE', message: '请在桌面版中执行' } }
  },

  async industrialListCapabilities() {
    if (hasBridge()) return window.sama!.industrialListCapabilities()
    return { ok: false, error: '请在桌面版中查看工业能力' }
  },

  async industrialScanSoftware(payload?: { adapterId?: string; dir?: string }) {
    if (hasBridge()) return window.sama!.industrialScanSoftware(payload)
    return { ok: false, error: '请在桌面版中扫描软件' }
  },

  async industrialPickSoftwareDir(payload: { adapterId: string }) {
    if (hasBridge()) return window.sama!.industrialPickSoftwareDir(payload)
    return { ok: false, error: '请在桌面版中选择软件目录' }
  },

  async industrialValidate(payload: { kind: string; data: unknown }) {
    if (hasBridge()) return window.sama!.industrialValidate(payload)
    return { ok: false, error: '请在桌面版中校验 IR' }
  },

  async industrialCreateProject(payload?: Record<string, unknown>) {
    if (hasBridge()) return window.sama!.industrialCreateProject(payload)
    return { ok: false, error: '请在桌面版中创建工业项目' }
  },

  async industrialAttachDomain(payload: {
    project: unknown
    domain: string
    ir?: unknown
  }) {
    if (hasBridge()) return window.sama!.industrialAttachDomain(payload)
    return { ok: false, error: '请在桌面版中挂载域 IR' }
  },

  async industrialTryCreateFromIr(payload: {
    domain: string
    ir: unknown
    adapterId?: string
  }) {
    if (hasBridge()) return window.sama!.industrialTryCreateFromIr(payload)
    return { ok: false, success: false, error: '请在桌面版中从 IR 生成' }
  },

  async industrialListWorkflows() {
    if (hasBridge()) return window.sama!.industrialListWorkflows()
    return { ok: false, workflows: [], error: '请在桌面版中列出工作流' }
  },

  async industrialRunWorkflow(payload: {
    workflowId?: string
    id?: string
    name?: string
    holdMs?: number
    domains?: string[]
  }) {
    if (hasBridge()) return window.sama!.industrialRunWorkflow(payload)
    return { ok: false, success: false, error: '请在桌面版中运行工业工作流' }
  },

  async industrialListProjects() {
    if (hasBridge()) return window.sama!.industrialListProjects()
    return { ok: false, projects: [], error: '请在桌面版中查看工程列表' }
  },

  async industrialOpenProjectDir(payload: { projectDir?: string; path?: string }) {
    if (hasBridge()) return window.sama!.industrialOpenProjectDir(payload)
    return { ok: false, error: '请在桌面版中打开工程目录' }
  },

  async industrialGetEmptyIr(payload: { domain: string; partial?: Record<string, unknown> }) {
    if (hasBridge()) return window.sama!.industrialGetEmptyIr(payload)
    return { ok: false, error: '请在桌面版中获取空 IR' }
  },

  async industrialGenerateGcode(payload: Record<string, unknown>) {
    if (hasBridge()) return window.sama!.industrialGenerateGcode(payload)
    return { ok: false, success: false, error: '请在桌面版中生成 G-code' }
  },

  async industrialParseGcode(payload: { ncText?: string; text?: string }) {
    if (hasBridge()) return window.sama!.industrialParseGcode(payload)
    return { ok: false, error: '请在桌面版中解析 G-code' }
  },

  async industrialListGcodeMeta() {
    if (hasBridge()) return window.sama!.industrialListGcodeMeta()
    return { ok: false, error: '请在桌面版中查看机床/刀具元数据' }
  },

  async industrialAnalyzeNc(payload: {
    ncText?: string
    text?: string
    machineProfile?: string
    stock?: unknown
    toolDiameter?: number
    omitHeights?: boolean
  }) {
    if (hasBridge()) return window.sama!.industrialAnalyzeNc(payload)
    return { ok: false, error: '请在桌面版中分析 NC' }
  },

  async industrialAnnotateNc(payload: { ncText?: string; text?: string }) {
    if (hasBridge()) return window.sama!.industrialAnnotateNc(payload)
    return { ok: false, error: '请在桌面版中生成注释副本' }
  },

  async industrialApplyNcFixes(payload: {
    ncText?: string
    fixes?: unknown[]
    machineProfile?: string
    stock?: unknown
    toolDiameter?: number
  }) {
    if (hasBridge()) return window.sama!.industrialApplyNcFixes(payload)
    return { ok: false, error: '请在桌面版中应用 NC 修复' }
  },

  async industrialSimStep(payload: { session: unknown }) {
    if (hasBridge()) return window.sama!.industrialSimStep(payload)
    return { ok: false, error: '请在桌面版中单步仿真' }
  },

  async industrialSimReset(payload: { session: unknown }) {
    if (hasBridge()) return window.sama!.industrialSimReset(payload)
    return { ok: false, error: '请在桌面版中重置仿真' }
  },
}

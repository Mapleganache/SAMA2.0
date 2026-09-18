/// <reference types="vite/client" />

export type AuthPublic = {
  hasPin: boolean
  authEnabled: boolean
  role: 'guest' | 'admin'
  needsSetup: boolean
  ok?: boolean
  error?: string
  code?: string
}

export type SamaSettings = {
  provider?: string
  model: string
  baseUrl: string
  apiKey: string
  hasApiKey: boolean
  visionProvider?: string
  visionModel?: string
  visionApiKey?: string
  hasVisionApiKey?: boolean
  hasProviderKey?: Record<string, boolean>
  dataRoot?: string
  /** FANUC LADDER-III fladder.exe 路径或安装目录 */
  fladderPath?: string
  /** EPLAN Electric P8 W3u.exe 路径或安装目录 */
  eplanPath?: string
  authEnabled?: boolean
}

export type KbStatus = {
  ready: boolean
  docCount: number
  chunkCount: number
  updatedAt: string | null
  brands: string[]
  note: string
  dataRoot?: string
  mtkb?: {
    available: boolean
    bundleVersion: string | null
    installedVersion: string | null
    installed: boolean
    documents: number
    chunks: number
    sqliteReady: boolean
    sqlitePath: string | null
    userDatabaseCount?: number
    note: string
  }
}

export type ChatPayload = {
  mode: 'ask' | 'agent'
  userText: string
  history: { role: string; content: string }[]
  enabledLibraries: { brand: string; title: string; version: string }[]
  /** 工业页频道：fp / lad / cam 等，禁止功能串页 */
  channel?: string
  activeFile?: string
  fileContent?: string
  attachments?: {
    name: string
    path?: string
    kind?: string
    content: string
    dataUrl?: string
  }[]
}

export type LocalFileResult = {
  ok: boolean
  name?: string
  path?: string
  kind?: string
  size?: number
  content?: string
  dataUrl?: string
  error?: string
  lad?: boolean
  memberCount?: number
  symbolCount?: number
  fileCount?: number
  dirCount?: number
  truncated?: boolean
}

export type SamaApi = {
  getSettings: () => Promise<SamaSettings>
  saveSettings: (partial: Partial<{ apiKey: string; model: string; baseUrl: string; provider: string; fladderPath: string; eplanPath: string }>) => Promise<SamaSettings>
  testApi: () => Promise<{ ok: boolean; reply?: string; model?: string; error?: string }>
  chat: (payload: ChatPayload) => Promise<{
    ok: boolean
    content?: string
    model?: string
    citations?: string[]
    sources?: {
      n: number
      id?: string
      brand: string
      source: string
      title?: string
      snippet?: string
      score?: number
    }[]
    kbHits?: number
    fileOps?: {
      ok: boolean
      path: string
      created?: boolean
      bytes?: number
      external?: boolean
      error?: string
      undo?: { existed: boolean; previousContent: string | null }
    }[]
    error?: string
    code?: string
    needAllowLadder?: boolean
    allowLadderPath?: string
    plcSample?: {
      title?: string
      electrical?: {
        svg?: string
        bom?: { id?: string; type?: string; qty?: number }[]
        connectivityText?: string
        markdown?: string
        path?: string
        txtPath?: string
        deviceCount?: number
        edgeCount?: number
      }
    }
  }>
  loadSessions: () => Promise<{
    sessions: unknown[]
    activeSessionId: string
    messagesBySession?: Record<string, unknown[]>
  }>
  saveSessions: (payload: unknown) => Promise<{ ok: boolean }>
  loadLibraries: () => Promise<{ libraries: unknown[] }>
  saveLibraries: (payload: unknown) => Promise<{ ok: boolean }>
  getKbStatus: () => Promise<KbStatus>
  rebuildKb: () => Promise<KbStatus>
  openDataDir: () => Promise<{ ok: boolean; path: string }>
  openKbDocs: () => Promise<{ ok: boolean; path: string }>
  importAsDatabase: () => Promise<{
    ok: boolean
    canceled?: boolean
    error?: string
    note?: string
    docs?: number
    databases?: { id: string; path: string; label: string }[]
    kb?: KbStatus
  }>
  importPathsAsDatabase: (payload: {
    paths: string[]
    collectionName?: string
  }) => Promise<{
    ok: boolean
    error?: string
    note?: string
    docs?: number
    databases?: { id: string; path: string; label: string }[]
    kb?: KbStatus
  }>
  exportSharePackage: (opts?: {
    includeBundledMtkb?: boolean
    includeUserDocs?: boolean
    includeUserDb?: boolean
  }) => Promise<{
    ok: boolean
    canceled?: boolean
    error?: string
    path?: string
    note?: string
  }>
  listUserDatabases: () => Promise<{
    ok: boolean
    databases: { id: string; label: string; path: string; exists: boolean; importedAt?: string }[]
  }>
  workspaceTree: () => Promise<{ ok: boolean; root?: string; tree?: FileTreeNode[] }>
  workspaceRead: (relPath: string) => Promise<{ ok: boolean; path?: string; content?: string; error?: string }>
  workspaceWrite: (payload: {
    path: string
    content: string
  }) => Promise<{
    ok: boolean
    path?: string
    created?: boolean
    bytes?: number
    desktopPath?: string
    error?: string
  }>
  workspaceMkdir: (payload: { path: string }) => Promise<{
    ok: boolean
    path?: string
    created?: boolean
    error?: string
  }>
  librarySaveGcode: (payload: {
    content: string
    machine?: string
    name?: string
  }) => Promise<{
    ok: boolean
    path?: string
    desktopPath?: string
    created?: boolean
    bytes?: number
    error?: string
  }>
  librarySaveFile: (payload: {
    name: string
    content?: string
    hint?: string
  }) => Promise<{
    ok: boolean
    path?: string
    desktopPath?: string
    created?: boolean
    bytes?: number
    error?: string
  }>
  libraryMkdir: (payload: { path: string; readme?: string }) => Promise<{
    ok: boolean
    path?: string
    desktopPath?: string
    error?: string
  }>
  libraryOpen: () => Promise<{ ok: boolean; path?: string; error?: string }>
  electricalGenerate: (payload?: {
    template?: string
    machine?: string
    text?: string
    doc?: unknown
  }) => Promise<{
    ok: boolean
    path?: string
    desktopPath?: string
    txtPath?: string
    connectivityText?: string
    markdown?: string
    deviceCount?: number
    edgeCount?: number
    netCount?: number
    isConnectivity?: boolean
    error?: string
    doc?: unknown
  }>
  electricalRead: (payload: { path: string; page?: number }) => Promise<{
    ok: boolean
    weak?: boolean
    hint?: string
    deviceCount?: number
    edgeCount?: number
    netCount?: number
    connectivityText?: string
    markdown?: string
    txtPath?: string
    path?: string
    desktopPath?: string
    toc?: { no: number; title: string }[]
    pages?: { no: number; title?: string }[]
    error?: string
    doc?: unknown
  }>
  electricalRender: (payload: {
    doc?: unknown
    text?: string
    textPath?: string
    pdfPath?: string
    pdfReferenceText?: string
  }) => Promise<{
    ok: boolean
    path?: string
    desktopPath?: string
    txtPath?: string
    connectivityText?: string
    markdown?: string
    deviceCount?: number
    edgeCount?: number
    netCount?: number
    isConnectivity?: boolean
    doc?: unknown
    error?: string
    pageCount?: number
    isBook?: boolean
    rejected?: boolean
    errors?: string[]
  }>
  electricalTemplates: () => Promise<{
    ok: boolean
    templates?: { id: string; label: string }[]
  }>
  workspaceRevert: (snapshots: {
    path: string
    existed: boolean
    previousContent: string | null
  }[]) => Promise<{
    ok: boolean
    results?: { ok: boolean; path: string; action?: string; error?: string }[]
    error?: string
  }>
  openWorkspace: () => Promise<{ ok: boolean; path: string }>
  openLocalFiles: () => Promise<{ ok: boolean; canceled?: boolean; files?: LocalFileResult[]; error?: string }>
  openLocalFolder: () => Promise<{ ok: boolean; canceled?: boolean; files?: LocalFileResult[]; error?: string }>
  readLocalPaths: (paths: string[]) => Promise<{ ok: boolean; files?: LocalFileResult[]; error?: string }>
  listLocalDirTree: (dirPath: string) => Promise<{
    ok: boolean
    root?: string
    name?: string
    tree?: import('./data').FileNode[]
    error?: string
    code?: string
  }>
  importLocalFile: (payload: {
    path: string
    name?: string
  }) => Promise<{ ok: boolean; importedPath?: string; bytes?: number; error?: string }>
  writeLocalFile: (payload: {
    path: string
    content: string
    trustedPaths?: string[]
  }) => Promise<{ ok: boolean; path?: string; bytes?: number; error?: string }>
  getPathForFile: (file: File) => string
  authStatus: () => Promise<AuthPublic>
  authSetup: (pin: string) => Promise<AuthPublic>
  authUnlock: (pin: string) => Promise<AuthPublic>
  authLock: () => Promise<AuthPublic>
  authClearPin: () => Promise<AuthPublic>
  authChangePin: (pin: string) => Promise<AuthPublic>
  ladderProbe: () => Promise<{ found: boolean; fladderPath: string; hint: string }>
  ladderResolveLad: (payload: {
    ladPath?: string
  }) => Promise<{ ok: boolean; path?: string; corrected?: boolean; error?: string; tried?: string[] }>
  ladderSessionAllow: (allowed: boolean) => Promise<{ ok: boolean; allowed: boolean }>
  ladderSessionAllowStatus: () => Promise<{ ok: boolean; allowed: boolean }>
  ladderOpen: (payload: {
    ladPath: string
    approved?: boolean
    rememberSession?: boolean
  }) => Promise<{ ok: boolean; error?: string; code?: string; fladderPath?: string; method?: string }>
  ladderExportMnemonic: (payload: {
    ladPath: string
    approved?: boolean
    rememberSession?: boolean
  }) => Promise<{ ok: boolean; error?: string; code?: string; mnemonicPath?: string }>
  ladderApplyEdit: (payload: {
    ladPath: string
    approved?: boolean
    rememberSession?: boolean
    proposed?: { name?: string; input?: string; output?: string }
  }) => Promise<{
    ok: boolean
    error?: string
    code?: string
    ladPath?: string
    sourceLadPath?: string
    mnemonicPath?: string
    backupPath?: string
    skipped?: boolean
    compiled?: boolean
    alternate?: boolean
    note?: string
    name?: string
    flag?: string
    input?: string
    output?: string
    message?: string
    bytes?: number
    stashPath?: string
  }>
  ladderAllowAndAnalyze: (payload: {
    ladPath: string
    approved?: boolean
    rememberSession?: boolean
    openGui?: boolean
  }) => Promise<{
    ok: boolean
    error?: string
    code?: string
    exportOk?: boolean
    exportError?: string
    mnemonicPath?: string
    reportPath?: string
    issueCount?: number
    mnemonicLoaded?: boolean
    interlockSample?: string[]
    gui?: { ok?: boolean; error?: string }
    bytes?: number
  }>
  ladderResolveTemplate: (payload: {
    ladPath?: string
    templateLad?: string
  }) => Promise<{ ok: boolean; path?: string; error?: string; tried?: string[] }>
  ladderGenerateDemo: (payload: {
    templateLad?: string
    outPath?: string
    approved?: boolean
    rememberSession?: boolean
    label?: string
    variant?: string
  }) => Promise<{
    ok: boolean
    error?: string
    code?: string
    ladPath?: string
    mnemonicPath?: string
    docPath?: string
    templateLad?: string
    bytes?: number
    rungCount?: number
    note?: string
  }>
  eplanProbe: () => Promise<{
    found: boolean
    eplanPath: string
    eplanVersion?: string
    preferredVersion?: string
    defaultW3u?: string
    hint: string
    license?: { lservrc?: boolean; lit?: boolean; lir?: boolean; hint?: string }
  }>
  eplanResolveElk: (payload: {
    elkPath?: string
  }) => Promise<{ ok: boolean; path?: string; corrected?: boolean; error?: string }>
  eplanSessionAllow: (allowed: boolean) => Promise<{ ok: boolean; allowed: boolean }>
  eplanSessionAllowStatus: () => Promise<{ ok: boolean; allowed: boolean }>
  eplanOpen: (payload: {
    elkPath: string
    approved?: boolean
    rememberSession?: boolean
  }) => Promise<{ ok: boolean; error?: string; code?: string; eplanPath?: string; method?: string }>
  eplanLaunch: (payload: {
    approved?: boolean
    rememberSession?: boolean
  }) => Promise<{ ok: boolean; error?: string; code?: string; eplanPath?: string; method?: string }>
  eplanAutomationProbe: (payload?: { eplanPath?: string }) => Promise<{
    found?: boolean
    apiAvailable?: boolean
    bridgeAvailable?: boolean
    mode?: string
    eplanPath?: string
    eplanVersion?: string
    hint?: string
    error?: string
  }>
  eplanExportPreview: (payload?: { project?: unknown; eplanPath?: string }) => Promise<{
    ok: boolean
    mode?: string
    probe?: unknown
    drc?: unknown
    changes?: unknown
    warning?: string
    error?: string
  }>
  eplanExportProject: (payload?: {
    project?: unknown
    eplanPath?: string
    confirmed?: boolean
    outDir?: string
    silent?: boolean
  }) => Promise<{
    ok: boolean
    root?: string
    mode?: string
    note?: string
    error?: string
    canceled?: boolean
  }>
  eplanListOperations: () => Promise<{
    ok: boolean
    operations?: { id: string; label: string; needsAllow: boolean; description?: string }[]
    preferredVersion?: string
    defaultW3u?: string
    error?: string
  }>
  eplanStatus: (payload?: { eplanPath?: string }) => Promise<{
    ok: boolean
    probe?: unknown
    automation?: unknown
    license?: unknown
    running?: boolean
    mode?: string
    capabilities?: Record<string, boolean>
    note?: string
    error?: string
  }>
  eplanOperate: (payload: {
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
  }) => Promise<Record<string, unknown>>
  desktopListTools: () => Promise<{
    ok: boolean
    tools?: { tool: string; permission: string }[]
    error?: string
  }>
  desktopRun: (payload: {
    tool: string
    args?: Record<string, unknown>
    approved?: boolean
    approvalId?: string
  }) => Promise<{
    ok?: boolean
    success?: boolean
    tool?: string
    data?: unknown
    error?: { code?: string; message?: string } | string
    code?: string
    requiresApproval?: boolean
    approvalId?: string
    permission?: string
    preview?: unknown
  }>
  industrialListCapabilities: () => Promise<{
    ok: boolean
    count?: number
    availableCount?: number
    adapters?: unknown[]
    error?: string
  }>
  industrialScanSoftware: (payload?: { adapterId?: string; dir?: string }) => Promise<{
    ok: boolean
    path?: string
    error?: string
    cancelled?: boolean
    foundCount?: number
    adapters?: unknown[]
    results?: { adapterId: string; ok: boolean; path?: string; error?: string }[]
  }>
  industrialPickSoftwareDir: (payload: { adapterId: string }) => Promise<{
    ok: boolean
    path?: string
    dir?: string
    error?: string
    cancelled?: boolean
    adapters?: unknown[]
  }>
  industrialValidate: (payload: {
    kind: string
    data: unknown
  }) => Promise<{ ok: boolean; kind?: string; errors?: unknown[]; error?: string }>
  industrialCreateProject: (payload?: Record<string, unknown>) => Promise<{
    ok: boolean
    project?: unknown
    validation?: unknown
    error?: string
  }>
  industrialAttachDomain: (payload: {
    project: unknown
    domain: string
    ir?: unknown
  }) => Promise<{ ok: boolean; project?: unknown; error?: string }>
  industrialTryCreateFromIr: (payload: {
    domain: string
    ir: unknown
    adapterId?: string
  }) => Promise<{ ok?: boolean; success?: boolean; error?: unknown }>
  industrialListWorkflows: () => Promise<{
    ok: boolean
    workflows?: { id: string; label: string }[]
    error?: string
  }>
  industrialRunWorkflow: (payload: {
    workflowId?: string
    id?: string
    name?: string
    holdMs?: number
    domains?: string[]
  }) => Promise<{
    ok?: boolean
    success?: boolean
    projectDir?: string
    reportPath?: string
    projectJsonPath?: string
    tree?: Record<string, string[]>
    artifacts?: unknown[]
    domainResults?: Record<string, unknown>
    sequence?: { ok?: boolean }
    pack?: { id?: string; name?: string; holdMs?: number; description?: string }
    preview?: {
      title?: string
      description?: string
      ioTable?: { addr?: string; name?: string; device?: string }[]
      sequenceOk?: boolean
      plc?: {
        ascii?: string
        mnemonic?: string
        rungs?: { id?: string; type?: string; comment?: string; ascii?: string }[]
        simulation?: {
          ok?: boolean
          total?: number
          passed?: number
          failed?: number
          results?: { id?: string; name?: string; ok?: boolean }[]
        }
      }
      electrical?: {
        svg?: string
        bom?: unknown[]
        connectivityText?: string
        markdown?: string
        path?: string
        txtPath?: string
        deviceCount?: number
        edgeCount?: number
      }
      cam?: { nc?: string }
      cad?: { geometry?: Record<string, unknown> }
    }
    note?: string
    error?: unknown
  }>
  industrialListProjects: () => Promise<{
    ok: boolean
    projects?: {
      id: string
      name: string
      workflow?: string
      createdAt?: string
      projectDir: string
      reportPath?: string
      domains?: string[]
      folders?: string[]
    }[]
    error?: string
  }>
  industrialOpenProjectDir: (payload: {
    projectDir?: string
    path?: string
  }) => Promise<{ ok: boolean; projectDir?: string; error?: string }>
  industrialGetEmptyIr: (payload: {
    domain: string
    partial?: Record<string, unknown>
  }) => Promise<{ ok: boolean; domain?: string; ir?: unknown; error?: string }>
  industrialGenerateGcode: (payload: {
    params?: Record<string, unknown>
    opts?: Record<string, unknown>
    [key: string]: unknown
  }) => Promise<{
    ok?: boolean
    success?: boolean
    ncText?: string
    gcodeIr?: unknown
    validation?: unknown
    artifact?: { nc?: string; gcodeIr?: string; validate?: string }
    note?: string
    error?: unknown
  }>
  industrialParseGcode: (payload: {
    ncText?: string
    text?: string
  }) => Promise<{
    ok: boolean
    explanation?: unknown
    validation?: unknown
    parsed?: unknown
    error?: string
  }>
  industrialListGcodeMeta: () => Promise<{
    ok: boolean
    machines?: unknown[]
    tools?: unknown[]
    note?: string
    error?: string
  }>
  industrialAnalyzeNc: (payload: {
    ncText?: string
    text?: string
    machineProfile?: string
    stock?: unknown
    toolDiameter?: number
    omitHeights?: boolean
  }) => Promise<{
    ok: boolean
    toolpath?: {
      segments?: {
        type?: string
        from?: { x: number; y: number; z: number }
        to?: { x: number; y: number; z: number }
        start?: { x: number; y: number; z: number }
        end?: { x: number; y: number; z: number }
        line?: number
      }[]
      bounds?: { x: number[]; y: number[]; z: number[] }
      tools?: string[]
    }
    stock?: unknown
    removal?: unknown
    collision?: { ok?: boolean; errors?: { message?: string; code?: string }[]; warnings?: { message?: string }[] }
    time?: { display?: string; breakdown?: Record<string, string>; totalSec?: number }
    explain?: { lines?: { line?: number; title?: string; summary?: string }[] }
    fixes?: { line?: number; code?: string; message?: string; original?: string; suggested?: string; apply?: boolean }[]
    validation?: unknown
    reportMarkdown?: string
    session?: unknown
    note?: string
    error?: string
  }>
  industrialAnnotateNc: (payload: {
    ncText?: string
    text?: string
  }) => Promise<{
    ok: boolean
    text?: string
    lineCount?: number
    annotatedLines?: number
    error?: string
  }>
  industrialApplyNcFixes: (payload: {
    ncText?: string
    fixes?: unknown[]
    machineProfile?: string
    stock?: unknown
    toolDiameter?: number
  }) => Promise<{
    ok: boolean
    ncText?: string
    analysis?: unknown
    error?: string
  }>
  industrialSimStep: (payload: { session: unknown }) => Promise<{
    ok: boolean
    session?: unknown
    error?: string
  }>
  industrialSimReset: (payload: { session: unknown }) => Promise<{
    ok: boolean
    session?: unknown
    error?: string
  }>
}

export type FileTreeNode = {
  name: string
  type: 'folder' | 'file'
  children?: FileTreeNode[]
}

declare global {
  interface Window {
    sama?: SamaApi
  }
}

export {}

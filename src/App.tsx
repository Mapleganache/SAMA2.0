import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import {
  ChatSession,
  FileNode,
  Library,
  Message,
  defaultLibraries,
  type KbSource,
} from './data'
import { FileTree } from './components/FileTree'
import { LibraryPicker } from './components/LibraryPicker'
import { SettingsModal } from './components/SettingsModal'
import { AllowActionCard, type AllowChoice, type AllowRequest } from './components/AllowActionCard'
import { LadderOpsBar } from './components/LadderOpsBar'
import { MessageBody } from './components/MessageBody'
import { ToolpathPanel } from './components/ToolpathPanel'
import { ImportDbModal } from './components/ImportDbModal'
import { PlcHelpModal } from './components/PlcHelpModal'
import { PlcExplainModal } from './components/PlcExplainModal'
import { isGCodeFile, looksLikeGcode } from './gcode/parseGcode'
import { samaClient } from './samaClient'
import {
  detectAllowRequest,
  hasExplicitLadEditMarker,
  kindDetail,
  kindTitle,
  preferUserExplicitEdit,
  type ProposedLadEdit,
} from './ladAllow'
import {
  detectDesktopAllowRequest,
  desktopKindTitle,
} from './desktopAllow'
import type { KbStatus, LocalFileResult, SamaSettings } from './vite-env'

type Mode = 'ask' | 'agent'
type MainView = 'chat' | 'mech' | 'elec' | 'fp' | 'lad' | 'cam'

type Attachment = {
  id: string
  name: string
  path?: string
  kind?: string
  lad?: boolean
  content: string
  dataUrl?: string
}

type RecentFile = {
  path: string
  name: string
  at: number
}

/** 目录里隐藏历史 *_annotated 副本（注释改在编辑器内切换） */
function hideAnnotatedNcCopies(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((n) => !/_annotated\.(nc|cnc|ngc|tap|txt)$/i.test(n.name))
    .map((n) =>
      n.type === 'folder' && n.children
        ? { ...n, children: hideAnnotatedNcCopies(n.children) }
        : n,
    )
}

const RECENT_KEY = 'sama-recent-files'

type PersistShape = {
  sessions: ChatSession[]
  activeSessionId: string
  messagesBySession: Record<string, Message[]>
}

function formatTime(d = new Date()) {
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type SessionKind = MainView

const SESSION_KINDS: SessionKind[] = ['chat', 'mech', 'elec', 'fp', 'lad', 'cam']

const CHANNEL: Record<
  SessionKind,
  {
    title: string
    history: string
    newTitle: string
    welcome: string
    askPrefix: string
    placeholder: string
    attachLabel: string
    domain?: 'cad' | 'electrical' | 'plc' | 'cam'
  }
> = {
  chat: {
    title: '对话',
    history: '回答列表 · 自动存档',
    newTitle: '新对话',
    welcome: '',
    askPrefix: '',
    placeholder: '提问，或把桌面 .nc/.xml/.lad 拖进来一起问',
    attachLabel: '',
  },
  mech: {
    title: '机械设计',
    history: '机械对话',
    newTitle: '机械',
    welcome: '机械设计对话。问图纸、尺寸、装夹，或把 DXF/图片拖进来。点「生成样例」看顶视示意。',
    askPrefix:
      '【当前在机械设计对话】优先按机械/CAD/图纸/装夹回答。禁止声称已在 SolidWorks 里画好三维或已改用户原图。\n\n',
    placeholder: '问图纸、尺寸或装夹，或把图纸拖进来',
    attachLabel: '打开图纸',
    domain: 'cad',
  },
  elec: {
    title: '电气设计',
    history: '电气对话',
    newTitle: '电气',
    welcome:
      '电气设计对话。PDF 拖进来可「看图读图」识出元件与连接；对话里出 elec-json 后点「导出连通性」得到 md/txt（谁与谁相连），不生成原理图 SVG/PDF。',
    askPrefix:
      '【当前在电气设计对话】看图抽出页目录/电位/位号/I/O。用户要电路图时输出 elec-json，系统导出连通性 md/txt（元件相连关系），不渲染施工图。整本需求要多段 elec-json。改图时：接触器线圈与主回路同号对齐；一条电机回路同一列竖串 Q→KM→M；列内 wires 首尾相接。禁止手绘 SVG。\n\n',
    placeholder: '问原理图、I/O 或互锁，或把图纸拖进来',
    attachLabel: '打开图纸',
    domain: 'electrical',
  },
  fp: {
    title: 'PLC · PICTURE',
    history: 'PICTURE 对话',
    newTitle: 'PICTURE',
    welcome:
      'PLC 里的 FANUC PICTURE。只写 .fp2 / FPicture*.xml 画面，不改梯形 .LAD。把工程拖进来，或点「打开工程」。要改梯子请选 PLC 下的 Ladder。',
    askPrefix:
      '【当前在 PLC · PICTURE】只处理 .fp2 / FPicture*.xml。禁止改 .LAD、禁止 PMC 梯形、禁止 G 代码。写入只用 sama-file 写 .fp2 或画面 XML。用户若要改梯子，请他选 PLC 下的 Ladder。\n\n',
    placeholder: '说明要改的画面，或把 .fp2 / 画面 XML 拖进来',
    attachLabel: '打开工程',
  },
  lad: {
    title: 'PLC · Ladder',
    history: 'Ladder 对话',
    newTitle: 'Ladder',
    welcome:
      'PLC 里的 FANUC Ladder。打开 GUI 用 Shell（Start-Process fladder），改梯形走官方 /cmdfile CLI（助记符导出→改文本→写回），不是在窗口里点触点。把桌面 .LAD 拖进来再点允许。',
    askPrefix:
      '【当前在 PLC · Ladder】只处理 .LAD / 助记符 / PMC。打开软件 = Shell 启动 GUI（弹窗用户点）；写梯形必须 sama-allow-lad-edit（Fladder CLI）。禁止写 .fp2、禁止改画面 XML。禁止声称已改机床梯形或已下发。用户若要改画面，请他选 PLC 下的 PICTURE。\n\n',
    placeholder: '问梯形图，或把桌面 .LAD 拖进来',
    attachLabel: '打开 .LAD',
    domain: 'plc',
  },
  cam: {
    title: '加工',
    history: '加工对话',
    newTitle: '加工',
    welcome:
      '加工对话只有两件事：1）打开加工图并填写机床型号，点「看图出码」给出完整程序；2）打开或粘贴加工程序，点「看码识件」说明零件与参数。程序出现后，可点回答框「生成 G 代码文件」，保存到桌面「SAMA文件」。',
    askPrefix:
      '【当前在加工对话】只做看图出完整加工程序，或根据程序说明零件与参数。禁止写 .LAD / .fp2。禁止空口声称已校验、已仿真或已下机床。\n\n',
    placeholder: '写机床型号，或把加工图 / 程序拖进来',
    attachLabel: '打开图纸/NC',
    domain: 'cam',
  },
}

function sessionKind(s: Pick<ChatSession, 'id' | 'kind'>): SessionKind {
  const k = s.kind
  if (k === 'mech' || k === 'elec' || k === 'fp' || k === 'lad' || k === 'cam' || k === 'chat') return k
  if (k === 'plc') return 'lad'
  const id = String(s.id || '')
  if (id.startsWith('s-mech-')) return 'mech'
  if (id.startsWith('s-elec-')) return 'elec'
  if (id.startsWith('s-fp-')) return 'fp'
  if (id.startsWith('s-lad-') || id.startsWith('s-plc-')) return 'lad'
  if (id.startsWith('s-cam-')) return 'cam'
  return 'chat'
}

function tagSession(s: ChatSession): ChatSession {
  return { ...s, kind: sessionKind(s) }
}

function newSessionId(kind: SessionKind) {
  if (kind === 'chat') return `s-${Date.now()}`
  return `s-${kind}-${Date.now()}`
}

function isDefaultTitle(title: string, kind: SessionKind) {
  return (
    title === '新对话' ||
    title === 'PLC' ||
    title === CHANNEL[kind].newTitle ||
    title === CHANNEL[kind].title
  )
}

function shortModelName(model = '') {
  if (/llama-4-scout/i.test(model)) return 'Llama 4 Scout'
  if (/llama-3\.3-70b/i.test(model)) return 'Llama 3.3 70B'
  const last = String(model).split('/').pop() || model
  return last
}

function providerDisplayName(provider = 'groq') {
  if (provider === 'deepseek') return 'DeepSeek'
  if (provider === 'qwen') return '通义千问'
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'grok') return 'Grok'
  if (provider === 'gemini') return 'Gemini'
  return 'Groq'
}

function makeWelcome(kb: KbStatus | null, hasKey: boolean, provider = 'groq'): Message[] {
  const name = providerDisplayName(provider)
  const kbLine = kb?.ready
    ? `知识库已加载：${kb.chunkCount} 个切片（${kb.brands?.join('、') || '通用'}）。${
        kb.mtkb?.sqliteReady ? `MTKB SQLite 已接入（${kb.mtkb.bundleVersion || '本地包'}）。` : ''
      }资料未改则启动只加载，不会每次重学。`
    : '知识库尚未构建：请在设置中打开资料目录放入说明书，再点「构建/更新知识库」。'
  const keyLine = hasKey
    ? `${name} API 已配置。`
    : `尚未配置 ${name} API Key，请点击右上角「设置」。`
  return [
    {
      id: `sys-welcome-${Date.now()}`,
      role: 'system',
      content: `${keyLine}\n${kbLine}\n本对话是独立会话，**不携带**其它对话的历史记忆，可避免旧分析污染。\n**Ask**＝问答（不写盘）。**Agent**＝可写「工程沙箱」和桌面/文档/下载等允许目录。改二进制 \`.LAD\` 需点允许卡（MnemonicToSrc），不是靠聊天记忆。`,
    },
  ]
}

function channelWelcome(
  kind: SessionKind,
  kb: KbStatus | null,
  hasKey: boolean,
  provider = 'groq',
): Message[] {
  if (kind === 'chat') return makeWelcome(kb, hasKey, provider)
  return [
    {
      id: `sys-${kind}-welcome-${Date.now()}`,
      role: 'system',
      content: CHANNEL[kind].welcome,
    },
  ]
}

function collectFolderPaths(nodes: FileNode[], prefix = '', out: Record<string, boolean> = {}) {
  for (const n of nodes) {
    const rel = prefix ? `${prefix}/${n.name}` : n.name
    if (n.type === 'folder') {
      out[rel] = true
      if (n.children) collectFolderPaths(n.children, rel, out)
    }
  }
  return out
}

function firstFilePath(nodes: FileNode[], prefix = ''): string {
  for (const n of nodes) {
    const rel = prefix ? `${prefix}/${n.name}` : n.name
    if (n.type === 'file') return rel
    if (n.type === 'folder' && n.children?.length) {
      const hit = firstFilePath(n.children, rel)
      if (hit) return hit
    }
  }
  return ''
}

export default function App() {
  const [libraries, setLibraries] = useState<Library[]>(defaultLibraries)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importDbOpen, setImportDbOpen] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [paneBlocks, setPaneBlocks] = useState({
    libs: true,
    mode: true,
    industrial: true,
    read: true,
    history: true,
    fileOpen: true,
    fileDir: true,
  })

  function togglePaneBlock(key: keyof typeof paneBlocks) {
    setPaneBlocks((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const [mode, setMode] = useState<Mode>('ask')
  const [mainView, setMainView] = useState<MainView>('chat')
  const [camMachine, setCamMachine] = useState('')
  const [eplanChip, setEplanChip] = useState('')
  const [plcHelpOpen, setPlcHelpOpen] = useState(false)
  const [plcExplainOpen, setPlcExplainOpen] = useState(false)
  const lastByKindRef = useRef<Partial<Record<SessionKind, string>>>({})
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Message[]>>({})
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [tree, setTree] = useState<FileNode[]>([])
  const [browseRoot, setBrowseRoot] = useState<string | null>(null)
  const [browseName, setBrowseName] = useState('')
  const [activeFile, setActiveFile] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [fileDirty, setFileDirty] = useState(false)
  const [fileSaving, setFileSaving] = useState(false)
  const [fileStatus, setFileStatus] = useState('')
  const [editorView, setEditorView] = useState<'code' | 'toolpath'>('code')
  /** G 代码注释视图：不写磁盘副本，只在编辑器内切换 */
  const [ncBase, setNcBase] = useState('')
  const [ncAnnotated, setNcAnnotated] = useState<string | null>(null)
  const [showAnnotated, setShowAnnotated] = useState(false)
  const [citeFollowUps, setCiteFollowUps] = useState<KbSource[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragging, setDragging] = useState(false)
  const [fileExternal, setFileExternal] = useState(false)
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    projects: true,
    'projects/studer-step': true,
    'projects/gcode-samples': true,
    'projects/imports': true,
    SAMA文件: true,
    'SAMA文件/01_加工程序': true,
    'SAMA文件/02_图纸': true,
    'SAMA文件/03_电路图': true,
    'SAMA文件/04_梯形图': true,
    'SAMA文件/05_画面': true,
    'SAMA文件/06_说明文档': true,
    'SAMA文件/07_其它': true,
  })
  const gcodeSource = showAnnotated && ncBase ? ncBase : fileContent
  const gcodeActive =
    isGCodeFile(activeFile.replace(/^external:/, '')) || looksLikeGcode(gcodeSource)
  const lineCount = useMemo(
    () => (fileContent ? fileContent.replace(/\r\n/g, '\n').split('\n').length : 0),
    [fileContent],
  )
  const visibleTree = useMemo(() => hideAnnotatedNcCopies(tree), [tree])
  const displayPath = activeFile.replace(/^external:/, '') || ''
  const browseActiveRel = useMemo(() => {
    if (!browseRoot || !fileExternal || !displayPath) return ''
    const nRoot = browseRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const nAbs = displayPath.replace(/\\/g, '/')
    const low = nAbs.toLowerCase()
    if (low === nRoot) return ''
    if (low.startsWith(`${nRoot}/`)) return nAbs.slice(nRoot.length + 1)
    return ''
  }, [browseRoot, fileExternal, displayPath])

  function joinBrowsePath(root: string, rel: string) {
    const sep = root.includes('\\') ? '\\' : '/'
    const base = root.replace(/[/\\]+$/, '')
    const tail = rel.replace(/^[/\\]+/, '').replace(/[/\\]+/g, sep)
    return tail ? `${base}${sep}${tail}` : base
  }
  const [settings, setSettings] = useState<SamaSettings | null>(null)
  const [kb, setKb] = useState<KbStatus | null>(null)
  const [bootReady, setBootReady] = useState(false)
  const [allowQueue, setAllowQueue] = useState<AllowRequest[]>([])
  const [allowBusy, setAllowBusy] = useState(false)
  const [allowCollapsed, setAllowCollapsed] = useState(false)
  const [ladderAllowed, setLadderAllowed] = useState(false)
  /** 用户点 × 清掉的 LAD 路径；同一路径不再显示操作条，换新文件会自动出现 */
  const [dismissedOpsLad, setDismissedOpsLad] = useState('')
  const [ladderAlwaysAllow, setLadderAlwaysAllow] = useState(() => {
    try {
      return localStorage.getItem('sama.ladder.alwaysAllow') === '1'
    } catch {
      return false
    }
  })
  const allowReq = allowQueue[0] || null
  const allowQueueRef = useRef<AllowRequest[]>([])
  const enqueuedAllowMsgIds = useRef(new Set<string>())
  /** 最近一次成功写回的 LAD，供连续改梯优先使用 */
  const lastWrittenLadRef = useRef('')
  /** 刚写过的梯级参数，避免助手晚到回包再弹同一张写入卡 */
  const lastWrittenProposedRef = useRef<{
    name?: string
    input?: string
    output?: string
    at: number
  } | null>(null)
  /** 某条消息已完成的权限步骤，避免打开后卡住不再问「写方案」 */
  const completedAllowKindsRef = useRef(new Map<string, Set<AllowRequest['kind']>>())
  /** 整项申请已结束：不再自动入队、消息里也不再挂「请允许」 */
  const settledAllowMsgIdsRef = useRef(new Set<string>())
  const [settledAllowTick, setSettledAllowTick] = useState(0)
  const ladderAlwaysAllowRef = useRef(ladderAlwaysAllow)
  allowQueueRef.current = allowQueue
  ladderAlwaysAllowRef.current = ladderAlwaysAllow

  function markKindsDone(msgKey: string, kinds: AllowRequest['kind'][]) {
    if (!msgKey) return
    const done = completedAllowKindsRef.current.get(msgKey) || new Set()
    for (const k of kinds) done.add(k)
    completedAllowKindsRef.current.set(msgKey, done)
  }

  /** 一项任务做完：销账 + 清掉同任务剩余卡，避免还在输入区上方申请权限 */
  function settleAllowTask(
    msgKey: string,
    kinds: AllowRequest['kind'][] = [
      'generate-lad',
      'edit-lad',
      'open-ladder',
      'export-analyze',
    ],
  ) {
    if (!msgKey) return
    markKindsDone(msgKey, kinds)
    settledAllowMsgIdsRef.current.add(msgKey)
    enqueuedAllowMsgIds.current.add(msgKey)
    setAllowQueue((prev) => {
      const next = prev.filter((item) => (item.sourceMsgId || item.id) !== msgKey)
      allowQueueRef.current = next
      return next
    })
    setSettledAllowTick((n) => n + 1)
  }

  function persistAlwaysAllow(on: boolean) {
    setLadderAlwaysAllow(on)
    ladderAlwaysAllowRef.current = on
    try {
      localStorage.setItem('sama.ladder.alwaysAllow', on ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (on) {
      setLadderAllowed(true)
      void samaClient.ladderSessionAllow(true)
    }
  }
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  const persistTimer = useRef<number | null>(null)
  const skipFirstPersist = useRef(true)

  const enabledLibs = useMemo(
    () => libraries.filter((lib) => lib.enabled),
    [libraries],
  )

  const messages = messagesBySession[activeSessionId] || []
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const visibleSessions = useMemo(
    () => sessions.filter((s) => sessionKind(s) === mainView),
    [sessions, mainView],
  )

  async function refreshTreeOnly() {
    if (browseRoot) {
      const res = await samaClient.listLocalDirTree(browseRoot)
      if (!res.ok || !res.tree) {
        setFileStatus(res.error || '无法刷新本机目录')
        return
      }
      const nextTree = res.tree as FileNode[]
      setTree(nextTree)
      setExpanded((prev) => ({ ...collectFolderPaths(nextTree), ...prev }))
      return
    }
    const res = await samaClient.workspaceTree()
    const nextTree = (res.tree || []) as FileNode[]
    setTree(nextTree)
    setExpanded((prev) => ({ ...collectFolderPaths(nextTree), ...prev }))
  }

  async function refreshTreeAndMaybeOpen(preferredPath?: string) {
    if (browseRoot) {
      await refreshTreeOnly()
      return
    }
    const res = await samaClient.workspaceTree()
    const nextTree = (res.tree || []) as FileNode[]
    setTree(nextTree)
    setExpanded((prev) => ({ ...collectFolderPaths(nextTree), ...prev }))
    const target = preferredPath || activeFile || firstFilePath(nextTree)
    if (target && (/^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('\\\\'))) {
      await openGeneratedPath(target)
      return
    }
    if (target) await openFile(target)
  }

  async function showBrowsedFolder(absPath: string) {
    const res = await samaClient.listLocalDirTree(absPath)
    if (!res.ok || !res.root || !res.tree) {
      setFileStatus(res.error || '无法打开文件夹')
      return
    }
    const nextTree = res.tree as FileNode[]
    setBrowseRoot(res.root)
    setBrowseName(res.name || res.root.split(/[/\\]/).pop() || '本机目录')
    setTree(nextTree)
    setExpanded(collectFolderPaths(nextTree))
    setFileStatus(`正在浏览本机目录：${res.root}`)
  }

  async function backToSandboxTree() {
    setBrowseRoot(null)
    setBrowseName('')
    const res = await samaClient.workspaceTree()
    const nextTree = (res.tree || []) as FileNode[]
    setTree(nextTree)
    setExpanded((prev) => ({ ...collectFolderPaths(nextTree), ...prev }))
    setFileStatus('已返回工程沙箱目录')
  }

  async function openGeneratedPath(target: string) {
    const p = String(target || '').trim()
    if (!p) return
    // 超大助记符不要塞进编辑器，否则 SAMA 会卡死
    if (/_mnemonic/i.test(p) || /\.txt$/i.test(p)) {
      setFileStatus(`已生成（过大未载入编辑器）：${p}`)
      return
    }
    setFileStatus(`正在打开 ${p.split(/[/\\]/).pop()}…`)
    try {
      if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) {
        const res = await samaClient.readLocalPaths([p])
        const f = res.files?.[0]
        if (!f?.ok) {
          setFileStatus(
            `文件不存在或无法打开：${p}${f?.error ? `（${f.error}）` : ''}。请勿依据旧聊天路径。`,
          )
          return
        }
        // .LAD 是二进制工程，不要当文本塞进编辑器
        if (/\.lad$/i.test(p)) {
          const n = Number((f as { bytes?: number }).bytes ?? String(f.content || '').length)
          if (n < 100) {
            setFileStatus(`LAD 无效（${n} 字节）：${p}`)
            return
          }
          setFileStatus(`LAD 在磁盘上（${n} 字节）。请用「允许打开」在 LADDER-III 中查看，勿当文本编辑。`)
          return
        }
        const content = String(f.content || '')
        if (content.length > 120_000) {
          setFileStatus(`文件过大（${content.length} 字符），未载入编辑器：${p}`)
          return
        }
        openExternalInEditor({ ...f, content })
        return
      }
      await openFile(p)
    } catch (e) {
      setFileStatus(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, k, libState, saved] = await Promise.all([
        samaClient.getSettings(),
        samaClient.getKbStatus(),
        samaClient.loadLibraries(),
        samaClient.loadSessions(),
      ])
      if (!alive) return

      setSettings(s)
      setKb(k)
      try {
        const la = await samaClient.ladderSessionAllowStatus()
        if (alive) setLadderAllowed(!!la.allowed)
      } catch {
        /* ignore */
      }

      if (Array.isArray(libState?.libraries) && libState.libraries.length) {
        const savedLibs = libState.libraries as Library[]
        const byId = new Map(savedLibs.map((l) => [l.id, l]))
        // 用新默认表补齐 MTKB/STUDER 等条目，保留用户勾选状态
        const merged = defaultLibraries.map((d) => {
          const old = byId.get(d.id)
          return old ? { ...d, enabled: old.enabled, docs: old.docs || d.docs } : d
        })
        for (const old of savedLibs) {
          if (!merged.some((m) => m.id === old.id)) merged.push(old)
        }
        setLibraries(merged)
      }

      const persist = saved as PersistShape
      if (persist?.sessions?.length) {
        const tagged = persist.sessions.map(tagSession)
        setSessions(tagged)
        const chats = tagged.filter((s) => sessionKind(s) === 'chat')
        const others = tagged.filter((s) => sessionKind(s) !== 'chat')
        let aid = persist.activeSessionId || chats[0]?.id || ''
        if (aid && sessionKind(tagged.find((x) => x.id === aid) || { id: aid }) !== 'chat') {
          aid = chats[0]?.id || ''
        }
        const last: Partial<Record<SessionKind, string>> = {}
        for (const kind of SESSION_KINDS) {
          try {
            const savedId = localStorage.getItem(`sama.session.${kind}`) || ''
            const hit =
              tagged.find((s) => s.id === savedId && sessionKind(s) === kind) ||
              tagged.find((s) => sessionKind(s) === kind)
            if (hit) last[kind] = hit.id
          } catch {
            const hit = tagged.find((s) => sessionKind(s) === kind)
            if (hit) last[kind] = hit.id
          }
        }
        if (!aid) {
          const id = newSessionId('chat')
          const chat: ChatSession = {
            id,
            title: '新对话',
            mode: 'ask',
            updatedAt: formatTime(),
            kind: 'chat',
          }
          setSessions([chat, ...others])
          aid = id
          last.chat = id
          setMessagesBySession({
            [id]: makeWelcome(k, s.hasApiKey, s.provider),
            ...(persist.messagesBySession || {}),
          })
        } else {
          last.chat = aid
        setMessagesBySession(persist.messagesBySession || {})
        }
        lastByKindRef.current = last
        setActiveSessionId(aid)
        const sess = tagged.find((x) => x.id === aid)
        if (sess) setMode(sess.mode === 'agent' ? 'agent' : 'ask')
      } else {
        const id = newSessionId('chat')
        setSessions([
          { id, title: '新对话', mode: 'ask', updatedAt: formatTime(), kind: 'chat' },
        ])
        setActiveSessionId(id)
        lastByKindRef.current = { chat: id }
        setMessagesBySession({ [id]: makeWelcome(k, s.hasApiKey, s.provider) })
      }

      await refreshTreeAndMaybeOpen('projects/gcode-samples/01_mill_profile.nc')
      if (!alive) return
      setBootReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!bootReady) return
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false
      return
    }
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      void samaClient.saveSessions({
        sessions: sessions.map(tagSession),
        activeSessionId:
          sessionKind(sessions.find((s) => s.id === activeSessionId) || { id: activeSessionId }) === 'chat'
            ? activeSessionId
            : lastByKindRef.current.chat ||
              sessions.find((s) => sessionKind(s) === 'chat')?.id ||
        activeSessionId,
        messagesBySession,
      })
    }, 400)
  }, [bootReady, sessions, activeSessionId, messagesBySession])

  useEffect(() => {
    if (!bootReady) return
    void samaClient.saveLibraries({ libraries })
  }, [bootReady, libraries])

  useEffect(() => {
    if (!bootReady || mainView !== 'elec') return
    void (async () => {
      try {
        const s = await samaClient.eplanStatus()
        const probe = s.probe as { found?: boolean; eplanVersion?: string } | undefined
        const automation = s.automation as { mode?: string } | undefined
        if (probe?.found) {
          const mode = automation?.mode || (s.mode as string) || 'task-pack'
          setEplanChip(`EPLAN ${probe.eplanVersion || ''} · ${mode}`)
        } else {
          setEplanChip('EPLAN 未绑定')
        }
      } catch {
        setEplanChip('')
      }
    })()
  }, [bootReady, mainView, fileStatus])

  useEffect(() => {
    answerRef.current?.scrollTo({ top: answerRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  function toggleLibrary(id: string) {
    setLibraries((prev) =>
      prev.map((lib) => (lib.id === id ? { ...lib, enabled: !lib.enabled } : lib)),
    )
  }

  async function resolveLadOrFail(ladPath: string) {
    const r = await samaClient.ladderResolveLad({ ladPath: ladPath || resolveCurrentLadPath() })
    if (!r.ok || !r.path) {
      const err = r.error || '找不到可用的 .LAD（请拖入桌面上的 studer.LAD）'
      setFileStatus(err)
      if (activeSessionId) {
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          { id: `lad-miss-${Date.now()}`, role: 'system', content: err },
        ])
      }
      return ''
    }
    if (r.corrected) {
      setFileStatus(`已纠正 LAD 路径：${r.path}`)
    }
    return r.path
  }

  async function requestOpenLadder(ladPath: string) {
    const fixed = await resolveLadOrFail(ladPath)
    if (!fixed) return
    if (ladderAllowed) {
      setAllowBusy(true)
      setFileStatus('正在打开 LADDER-III…')
      try {
        const r = await samaClient.ladderOpen({ ladPath: fixed, approved: true, rememberSession: true })
        const msg = r.ok ? `已打开 LADDER-III：\`${fixed}\`` : `打开失败：${r.error || '未知'}`
        setFileStatus(r.ok ? `已打开 LADDER-III：${fixed}` : r.error || '打开失败')
        if (activeSessionId) {
          setSessionMessages(activeSessionId, (prev) => [
            ...prev,
            { id: `ladder-open-${Date.now()}`, role: 'system', content: msg },
          ])
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        setFileStatus(`打开异常：${err}`)
        if (activeSessionId) {
          setSessionMessages(activeSessionId, (prev) => [
            ...prev,
            { id: `ladder-open-err-${Date.now()}`, role: 'system', content: `打开异常：${err}` },
          ])
        }
      } finally {
        setAllowBusy(false)
      }
      return
    }
    // Cursor 风格：只入队「打开」这一项
    enqueueAllowSteps({
      kinds: ['open-ladder'],
      ladPath: fixed,
      proposed: undefined,
      sourceMsgId: `manual-open-${Date.now()}`,
      replace: false,
    })
    try {
      const probe = await samaClient.ladderProbe()
      setAllowQueue((prev) =>
        prev.map((item, i) =>
          i === 0 && item.kind === 'open-ladder' && item.ladPath === fixed
            ? {
                ...item,
                detail: probe.found
                  ? kindDetail('open-ladder')
                  : '未探测到 fladder.exe，仍会尝试用系统关联打开 .LAD。可在设置中填写 LADDER-III 路径。',
                fladderPath: probe.fladderPath || undefined,
              }
            : item,
        ),
      )
    } catch {
      // 探测失败不影响允许卡
    }
  }

  function supersedePendingAllows(reason = '') {
    const pending = [...allowQueueRef.current]
    for (const item of pending) {
      const key = item.sourceMsgId || item.id
      settleAllowTask(key, [
        item.kind,
        'generate-lad',
        'edit-lad',
        'open-ladder',
        'export-analyze',
      ])
    }
    // 会话里更早的助手申请也销账，防止 effect 再弹旧卡
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      if (settledAllowMsgIdsRef.current.has(m.id)) continue
      if (!looksLikeAllowContent(m.content)) continue
      settledAllowMsgIdsRef.current.add(m.id)
      enqueuedAllowMsgIds.current.add(m.id)
      markKindsDone(m.id, ['generate-lad', 'edit-lad', 'open-ladder', 'export-analyze'])
    }
    allowQueueRef.current = []
    setAllowQueue([])
    setAllowCollapsed(false)
    allowEnqueueSig.current = ''
    if (reason && pending.length > 0) setFileStatus(reason)
    return pending.length > 0
  }

  function looksLikeAllowContent(text: string) {
    return /sama-allow-|允许打开|允许脚本写入|生成演示|权限申请|需要您确认/i.test(text || '')
  }

  function enqueueAllowSteps(opts: {
    kinds: AllowRequest['kind'][]
    ladPath: string
    proposed?: ProposedLadEdit
    sourceMsgId: string
    /** true=整队替换；默认也优先替换同会话旧卡，避免合并出过期 TEST_BTN */
    replace?: boolean
  }) {
    if (!opts.kinds.length) return
    enqueuedAllowMsgIds.current.add(opts.sourceMsgId)
    const mk = (kind: AllowRequest['kind'], step: number, total: number): AllowRequest => ({
      id: `allow-${opts.sourceMsgId}-${kind}-${step}`,
      kind,
      title:
        kind === 'desktop' ? '允许 Desktop 操作？' : kindTitle(kind, opts.proposed),
      detail:
        kind === 'desktop' ? '需要确认后才能继续' : kindDetail(kind, opts.proposed),
      ladPath: opts.ladPath,
      proposed: opts.proposed,
      sourceMsgId: opts.sourceMsgId,
      step,
      total,
    })

    setAllowQueue((prev) => {
      // 新申请默认替换队列：旧卡（别的 sourceMsgId）一律丢掉
      const shouldReplace =
        opts.replace !== false ||
        prev.length === 0 ||
        prev.some((p) => (p.sourceMsgId || p.id) !== opts.sourceMsgId)

      let next: AllowRequest[]
      if (shouldReplace) {
        // 销账被替换掉的旧消息，防止稍后又被 effect 捡回来
        for (const old of prev) {
          const key = old.sourceMsgId || old.id
          if (key && key !== opts.sourceMsgId) {
            settledAllowMsgIdsRef.current.add(key)
            enqueuedAllowMsgIds.current.add(key)
            markKindsDone(key, [
              'generate-lad',
              'edit-lad',
              'open-ladder',
              'export-analyze',
            ])
          }
        }
        next = opts.kinds.map((kind, i) => mk(kind, i + 1, opts.kinds.length))
      } else {
        const existing = new Set(prev.map((p) => p.kind))
        const added = opts.kinds.filter((k) => !existing.has(k)).map((k) => mk(k, 0, 0))
        if (added.length === 0) return prev
        next = [...prev, ...added].map((item, i, arr) => ({
          ...item,
          id: `allow-${opts.sourceMsgId}-${item.kind}-${i}`,
          step: i + 1,
          total: arr.length,
          ladPath: opts.ladPath || item.ladPath,
          proposed: opts.proposed || item.proposed,
          sourceMsgId: opts.sourceMsgId,
          title:
            item.kind === 'desktop'
              ? item.title
              : kindTitle(item.kind, opts.proposed || item.proposed),
          detail:
            item.kind === 'desktop'
              ? item.detail
              : kindDetail(item.kind, opts.proposed || item.proposed),
        }))
      }
      const same =
        prev.length === next.length &&
        prev.every(
          (p, i) =>
            p.kind === next[i]?.kind &&
            p.ladPath === next[i]?.ladPath &&
            p.proposed?.name === next[i]?.proposed?.name &&
            p.proposed?.input === next[i]?.proposed?.input &&
            p.proposed?.output === next[i]?.proposed?.output,
        )
      if (same) return prev
      allowQueueRef.current = next
      return next
    })
    setSettledAllowTick((n) => n + 1)
    setAllowCollapsed(false)
  }

  async function handleAllowCurrent(choice: AllowChoice = 'once') {
    const queue = allowQueueRef.current
    const cur = queue[0]
    if (!cur) return
    if (choice === 'always' && cur.kind !== 'desktop') persistAlwaysAllow(true)
    setAllowBusy(true)
    setAllowCollapsed(false)
    const msgKey = cur.sourceMsgId || cur.id
    try {
      if (cur.kind === 'open-ladder') {
        await approveAndOpenLadder(cur.ladPath)
        setLadderAllowed(true)
      } else if (cur.kind === 'export-analyze') {
        await runAllowAnalyzePipeline(cur.ladPath, true)
      } else if (cur.kind === 'edit-lad') {
        await approveEditProposal(cur.ladPath, cur.proposed)
      } else if (cur.kind === 'generate-lad') {
        await approveGenerateDemoLad(cur.ladPath)
      } else if (cur.kind === 'desktop' && cur.desktop) {
        const r = await samaClient.desktopRun({
          tool: cur.desktop.tool,
          args: cur.desktop.args || {},
          approved: true,
          approvalId: cur.desktop.approvalId,
        })
        const ok = r.ok || r.success
        const errMsg =
          typeof r.error === 'string'
            ? r.error
            : r.error?.message || '失败'
        const errCode =
          typeof r.error === 'string' ? r.code || '' : r.error?.code || r.code || ''
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          {
            id: `desk-${Date.now()}`,
            role: 'system',
            content: ok
              ? `已按你的允许执行 Desktop：\`${cur.desktop!.tool}\`\n\`\`\`json\n${JSON.stringify(r.data ?? r, null, 2).slice(0, 3000)}\n\`\`\``
              : `Desktop 操作未执行：${errMsg}（${errCode}）`,
          },
        ])
        settleAllowTask(msgKey, ['desktop' as AllowRequest['kind']])
        setFileStatus(ok ? 'Desktop 操作已完成' : 'Desktop 操作失败')
        return
      }
      markKindsDone(msgKey, [cur.kind])

      // 先从队列去掉本步
      let rest = allowQueueRef.current.filter((x) => x.id !== cur.id)

      if (cur.kind === 'edit-lad' || cur.kind === 'generate-lad') {
        // 写入/生成完成：整项申请销账，输入区上方不再挂该任务权限卡
        settleAllowTask(msgKey)
        setFileStatus(
          cur.kind === 'generate-lad' ? '演示 LAD 已生成，权限申请已关闭' : '写入已完成，权限申请已关闭',
        )
        return
      }

      // 打开完成后，若对话里还有未做的写入，补一张写入卡
      if (cur.kind === 'open-ladder') {
        const pendingEdit = findPendingEditStep(cur.ladPath, msgKey)
        if (pendingEdit && !rest.some((x) => x.kind === 'edit-lad')) {
          rest = [...rest, pendingEdit]
        }
      }

      const stillForMsg = rest.some((x) => (x.sourceMsgId || x.id) === msgKey)
      if (!stillForMsg) {
        settleAllowTask(msgKey, [cur.kind])
        setFileStatus('本步已完成，权限申请已关闭')
        return
      }

      allowQueueRef.current = rest
      setAllowQueue(rest)
      setFileStatus(
        ladderAlwaysAllowRef.current
          ? `以后都允许：继续 ${rest[0].title}`
          : `下一项权限：${rest[0].title}`,
      )
    } finally {
      setAllowBusy(false)
      setAllowCollapsed(false)
    }
  }

  /** 从最近申请类消息里找回「写方案」步骤（用户显式标记优先；禁止脑补 TEST_BTN） */
  function findPendingEditStep(ladPath: string, sourceMsgId?: string): AllowRequest | null {
    const tryFrom = (m: (typeof messages)[number], index: number): AllowRequest | null => {
      if (settledAllowMsgIdsRef.current.has(m.id)) return null
      if (m.role !== 'user' && m.role !== 'assistant') return null
      if (m.role === 'user' && !hasExplicitLadEditMarker(m.content)) return null
      if (m.role === 'assistant' && !/sama-allow-lad-edit\b/i.test(m.content) && !hasExplicitLadEditMarker(precedingUserText(index)))
        return null
      const detected =
        m.role === 'assistant'
          ? preferUserExplicitEdit(m.content, precedingUserText(index), ladPath || resolveCurrentLadPath())
          : detectAllowRequest(m.content, ladPath || resolveCurrentLadPath())
      if (!detected.kinds.includes('edit-lad')) return null
      const done = completedAllowKindsRef.current.get(m.id)
      if (done?.has('edit-lad')) return null
      return {
        id: `allow-${m.id}-edit-lad-auto`,
        kind: 'edit-lad',
        title: kindTitle('edit-lad', detected.proposed),
        detail: kindDetail('edit-lad', detected.proposed),
        ladPath: detected.ladPath || ladPath,
        proposed: detected.proposed,
        sourceMsgId: m.id,
        step: 2,
        total: 2,
      }
    }

    if (sourceMsgId) {
      const idx = messages.findIndex((m) => m.id === sourceMsgId)
      if (idx >= 0) {
        const hit = tryFrom(messages[idx], idx)
        if (hit) return hit
      }
      return null
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const hit = tryFrom(messages[i], i)
      if (hit) return hit
    }
    return null
  }

  function handleDenyAllowQueue() {
    const pending = [...allowQueueRef.current]
    for (const item of pending) {
      const key = item.sourceMsgId || item.id
      settleAllowTask(key, [
        item.kind,
        'generate-lad',
        'edit-lad',
        'open-ladder',
        'export-analyze',
        'desktop',
      ])
    }
    allowQueueRef.current = []
    setAllowQueue([])
    setAllowCollapsed(false)
    setFileStatus('已拒绝，权限申请已关闭')
    setSessionMessages(activeSessionId, (prev) => [
      ...prev,
      {
        id: `allow-deny-${Date.now()}`,
        role: 'system',
        content: '已拒绝剩余权限申请。',
      },
    ])
  }

  const allowEnqueueSig = useRef('')

  function precedingUserText(fromIndex: number): string {
    for (let j = fromIndex - 1; j >= 0; j--) {
      if (messages[j]?.role === 'user') return messages[j].content
    }
    return ''
  }

  /** 用户正文已带显式写入标记时立即排队，不依赖模型是否回对标记 */
  async function enqueueExplicitUserEdit(userMsgId: string, userText: string) {
    if (mainView === 'fp' || mainView === 'cam') return
    if (!hasExplicitLadEditMarker(userText)) return
    if (settledAllowMsgIdsRef.current.has(userMsgId)) return
    const detected = detectAllowRequest(userText, resolveCurrentLadPath())
    if (!detected.kinds.includes('edit-lad') && !detected.proposed) return
    // 显式写入标记：只申请写入，不夹带「打开 LADDER」（避免错拒整队）
    const kinds: AllowRequest['kind'][] = ['edit-lad']
    const candidate = detected.ladPath || resolveCurrentLadPath()
    const fixed =
      (await samaClient.ladderResolveLad({ ladPath: candidate })).path || candidate
    if (!fixed) return
    enqueueAllowSteps({
      kinds,
      ladPath: fixed,
      proposed: detected.proposed,
      sourceMsgId: userMsgId,
      replace: true,
    })
  }

  /** 从助手消息自动排队；打开后可继续补「写方案」 */
  useEffect(() => {
    if (mainView === 'fp' || mainView === 'cam') return
    if (!messages.length || allowBusy) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      // 最新一条助手消息已销账：绝不再回溯更早的 TEST_BTN 等旧申请（否则会拒绝后连环弹旧卡）
      if (settledAllowMsgIdsRef.current.has(m.id)) {
        enqueuedAllowMsgIds.current.add(m.id)
        return
      }
      const already = enqueuedAllowMsgIds.current.has(m.id)
      const userText = precedingUserText(i)
      const detected = preferUserExplicitEdit(m.content, userText, resolveCurrentLadPath())
      // 用户已显式给出写入标记且队列里已是同一组参数：勿被助手错标记整队替换
      if (hasExplicitLadEditMarker(userText)) {
        const userProposed = detectAllowRequest(userText, resolveCurrentLadPath()).proposed
        const hasUserCard = allowQueueRef.current.some(
          (x) =>
            x.kind === 'edit-lad' &&
            x.proposed?.name === userProposed?.name &&
            x.proposed?.input === userProposed?.input &&
            x.proposed?.output === userProposed?.output,
        )
        if (hasUserCard) {
          enqueuedAllowMsgIds.current.add(m.id)
          settledAllowMsgIdsRef.current.add(m.id)
          return
        }
      }
      if (!detected.isAllowAsk || !detected.kinds.length) {
        // 可能是 Desktop 确认卡，勿销账；交给 desktop 专用 effect
        if (!already && !detectDesktopAllowRequest(m.content).isAllowAsk) {
          enqueuedAllowMsgIds.current.add(m.id)
        }
        return
      }
      // 同一组地址刚写完：助手晚到的重复标记不再弹卡
      const justWrote = lastWrittenProposedRef.current
      if (
        justWrote &&
        Date.now() - justWrote.at < 180_000 &&
        detected.kinds.includes('edit-lad') &&
        detected.proposed?.name &&
        detected.proposed.name === justWrote.name &&
        detected.proposed.input === justWrote.input &&
        detected.proposed.output === justWrote.output
      ) {
        settledAllowMsgIdsRef.current.add(m.id)
        enqueuedAllowMsgIds.current.add(m.id)
        return
      }
      const done = completedAllowKindsRef.current.get(m.id) || new Set()
      let kinds = detected.kinds.filter((k) => !done.has(k))
      if (ladderAllowed || ladderAlwaysAllow) kinds = kinds.filter((k) => k !== 'open-ladder')
      // 以后都允许：打开可跳过；导出可自动；写入必须留在队列里弹卡
      if (!kinds.length) {
        settledAllowMsgIdsRef.current.add(m.id)
        enqueuedAllowMsgIds.current.add(m.id)
        setSettledAllowTick((n) => n + 1)
        return
      }
      const propSig = `${detected.proposed?.name || ''}|${detected.proposed?.input || ''}|${detected.proposed?.output || ''}`
      const sig = `${m.id}|${kinds.join(',')}|${propSig}|${allowQueueRef.current.map((x) => x.kind).join(',')}`
      if (sig === allowEnqueueSig.current && allowQueueRef.current.length > 0) return
      allowEnqueueSig.current = sig
      void (async () => {
        if (settledAllowMsgIdsRef.current.has(m.id)) return
        const candidate = detected.ladPath || resolveCurrentLadPath()
        let fixed = candidate
        if (kinds.includes('generate-lad')) {
          const tpl = await samaClient.ladderResolveTemplate({ ladPath: candidate })
          fixed = tpl.path || candidate || '（自动选择模板）'
          if (!tpl.ok && !candidate) {
            setSessionMessages(activeSessionId, (prev) => [
              ...prev,
              {
                id: `gen-tpl-miss-${Date.now()}`,
                role: 'system',
                content:
                  tpl.error ||
                  '生成演示 LAD 需要一个现有工程作外壳。请拖入 mikrosa/studer 等 .LAD，或放到桌面后再试。',
              },
            ])
            enqueuedAllowMsgIds.current.add(m.id)
            return
          }
        } else {
          fixed =
            (await samaClient.ladderResolveLad({ ladPath: candidate })).path || detected.ladPath
          if (!fixed) {
            enqueuedAllowMsgIds.current.add(m.id)
            return
          }
        }
        enqueueAllowSteps({
          kinds,
          ladPath: fixed,
          proposed: detected.proposed,
          sourceMsgId: m.id,
          replace: true,
        })
      })()
      return
    }
  }, [
    messages,
    allowQueue.length,
    allowBusy,
    activeSessionId,
    ladderAllowed,
    ladderAlwaysAllow,
    settledAllowTick,
    mainView,
  ])

  /** Desktop 确认卡：sama-allow-desktop + 主进程 approvalId */
  useEffect(() => {
    if (!messages.length || allowBusy) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'assistant') continue
      if (settledAllowMsgIdsRef.current.has(m.id)) return
      const desk = detectDesktopAllowRequest(m.content)
      if (!desk.isAllowAsk || !desk.calls.length) continue
      const calls = desk.calls.filter((c) => c.approvalId && c.tool)
      if (!calls.length) continue
      if (allowQueueRef.current.some((x) => x.kind === 'desktop' && x.sourceMsgId === m.id)) {
        enqueuedAllowMsgIds.current.add(m.id)
        return
      }
      if (completedAllowKindsRef.current.get(m.id)?.has('desktop')) return
      enqueuedAllowMsgIds.current.add(m.id)
      const next: AllowRequest[] = calls.map((c, idx) => ({
        id: `allow-${m.id}-desktop-${idx}`,
        kind: 'desktop' as const,
        title: desktopKindTitle(c.tool),
        detail: `工具 \`${c.tool}\`\n${JSON.stringify(c.args || {}).slice(0, 400)}`,
        ladPath: '',
        desktop: c,
        sourceMsgId: m.id,
        step: idx + 1,
        total: calls.length,
      }))
      allowQueueRef.current = next
      setAllowQueue(next)
      setAllowCollapsed(false)
      setFileStatus(`需要确认 Desktop：${calls[0].tool}`)
      return
    }
  }, [messages, allowBusy, activeSessionId, settledAllowTick])

  /** 「以后都允许」只自动跑打开/导出；写入与生成演示、Desktop 仍弹允许卡 */
  useEffect(() => {
    if (!ladderAlwaysAllow || allowBusy || allowQueue.length === 0) return
    const head = allowQueue[0]
    if (!head || head.kind === 'edit-lad' || head.kind === 'generate-lad' || head.kind === 'desktop')
      return
    const t = window.setTimeout(() => {
      void handleAllowCurrent('always')
    }, 120)
    return () => window.clearTimeout(t)
  }, [ladderAlwaysAllow, allowBusy, allowQueue.length, allowQueue[0]?.id, allowQueue[0]?.kind])

  /** 消息内「允许打开」：记住会话并打开 GUI（不做完整分析） */
  async function approveAndOpenLadder(ladPath: string) {
    const fixed = await resolveLadOrFail(ladPath)
    if (!fixed) return
    try {
      const r = await samaClient.ladderOpen({
        ladPath: fixed,
        approved: true,
        rememberSession: true,
      })
      setLadderAllowed(true)
      setFileStatus(r.ok ? `已打开 LADDER-III：${fixed}` : r.error || '打开失败')
      if (activeSessionId) {
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          {
            id: `ladder-open-${Date.now()}`,
            role: 'system',
            content: r.ok
              ? `已允许并打开 LADDER-III：\`${fixed}\``
              : `打开失败：${r.error || '未知'}`,
          },
        ])
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setFileStatus(`打开异常：${err}`)
    }
  }

  /** 允许脚本改 LAD：导出助记符 → 追加梯级 → MnemonicToSrc 写回 */
  async function approveEditProposal(ladPath: string, proposed?: ProposedLadEdit) {
    const fixed = await resolveLadOrFail(ladPath)
    if (!fixed) return
    setFileStatus('正在写入 LAD（Fladder 后台运行，约数十秒，界面应可拖动；请先关掉 GUI 占用）…')
    // 先把状态刷到屏幕，再进长任务
    await new Promise((r) => setTimeout(r, 80))
    try {
      const r = await samaClient.ladderApplyEdit({
        ladPath: fixed,
        approved: true,
        rememberSession: true,
        proposed: proposed || { name: 'TEST_BTN', input: 'X0.1', output: 'R100.0' },
      })

      const outLad = r.ladPath || fixed
      const outBytes =
        typeof (r as { bytes?: number }).bytes === 'number'
          ? (r as { bytes: number }).bytes
          : 0
      const stashPath = String((r as { stashPath?: string }).stashPath || '')
      const reallyOk = Boolean(r.ok && outBytes >= 100 && !stashPath)
      const isNamedOut = reallyOk && outLad.replace(/\\/g, '/').toLowerCase() !== fixed.replace(/\\/g, '/').toLowerCase()

      const failDetail =
        r.error ||
        (r.ok ? `结果文件仅 ${outBytes} 字节，不可用` : '未知')
      const title = r.skipped
        ? '**未追加新梯级（已另存副本）**'
        : '**已写入梯形工程**'
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `lad-edit-ok-${Date.now()}`,
          role: 'system',
          content: reallyOk
            ? `${title}

- 结果：\`${outLad}\`（${outBytes} 字节）
${isNamedOut ? `- 源工程：\`${fixed}\`（未覆盖）` : '- 警告：结果仍是源文件名，请重启 SAMA'}
- 梯级：\`${r.input || 'X0.1'}\` → \`${r.output || 'R100.0'}\`（\`${r.name || proposed?.name || 'EDIT'}\`）
- 说明：符号名往返后可能不保留，**RD/WRT 触点会保留**；用 LADDER-III 打开上面的 \`.LAD\`，看末尾 SPE 前
- 备份：\`${r.backupPath || '（无）'}\`
${(r as { note?: string }).note ? `\n${(r as { note?: string }).note}` : ''}
${r.skipped ? `\n（${r.message || '已跳过重复追加'}）` : ''}

请用 LADDER-III 打开 **\`${outLad}\`** 核对（不要找「修改方案」md，那不是工程文件）。`
            : `**脚本写回未成功**（不视为已改好原工程）

${failDetail}
${stashPath ? `\n暂存：\`${stashPath}\`${outBytes ? `（${outBytes} 字节）` : ''}` : ''}

请先完全退出 LADDER-III，再点「允许写入」。若 LAD 在微信目录，请先拷到桌面。`,
          fileOps: [
            ...(reallyOk && outLad
              ? [{ path: outLad, bytes: outBytes, created: isNamedOut, external: true, ok: true }]
              : []),
            ...(stashPath && outBytes >= 100
              ? [
                  {
                    path: stashPath,
                    bytes: outBytes,
                    created: true,
                    external: true,
                    ok: false,
                  },
                ]
              : []),
          ],
        },
      ])
      setFileStatus(
        reallyOk
          ? `${r.skipped ? '已另存副本' : 'LAD 已写入'}：${outLad}（${outBytes} 字节）`
          : r.error || '写回失败（原文件可能被占用）',
      )
      if (reallyOk) {
        lastWrittenLadRef.current = outLad
        lastWrittenProposedRef.current = {
          name: proposed?.name || r.name || undefined,
          input: proposed?.input || r.input || undefined,
          output: proposed?.output || r.output || undefined,
          at: Date.now(),
        }
        setDismissedOpsLad('')
        setActiveFile(`external:${outLad}`)
        setFileExternal(true)
        setFileDirty(false)
        setFileContent(
          `（二进制 .LAD，已写入）\n路径：${outLad}\n请用 LADDER-III 打开末尾 SPE 前核对；下一轮改梯将优先用此文件。`,
        )
        setFileStatus(`正在阅读 · ${outLad.split(/[/\\]/).pop()} · 写回结果`)
        // 不论从允许卡还是 LAD 条点的写入：完成后关掉该任务权限申请
        for (const item of [...allowQueueRef.current]) {
          if (item.kind === 'edit-lad' || item.ladPath === fixed) {
            settleAllowTask(item.sourceMsgId || item.id)
          }
        }
        const msgs = messagesBySession[activeSessionId] || []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.role === 'assistant' && detectAllowRequest(m.content, fixed).kinds.includes('edit-lad')) {
            settleAllowTask(m.id)
          }
          if (m.role === 'user' && hasExplicitLadEditMarker(m.content)) {
            const up = detectAllowRequest(m.content, fixed).proposed
            if (
              up?.name &&
              (up.name === proposed?.name || up.name === r.name) &&
              (!up.input || up.input === (proposed?.input || r.input))
            ) {
              settleAllowTask(m.id)
            }
          }
        }
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `lad-edit-err-${Date.now()}`,
          role: 'system',
          content: `脚本写入异常：${err}`,
        },
      ])
    }
  }

  /** 基于模板生成演示复杂梯形 LAD（另存桌面，不覆盖模板） */
  async function approveGenerateDemoLad(templateLad = '') {
    setFileStatus('正在生成演示 LAD（Fladder 导出/写回，约 1–2 分钟；请先关掉 GUI）…')
    await new Promise((r) => setTimeout(r, 80))
    try {
      const r = await samaClient.ladderGenerateDemo({
        templateLad: templateLad || resolveCurrentLadPath() || '',
        approved: true,
        rememberSession: true,
        label: 'PRESS',
        variant: 'simple-press',
      })
      const outLad = r.ladPath || ''
      const outBytes = typeof r.bytes === 'number' ? r.bytes : 0
      const reallyOk = Boolean(r.ok && outLad && outBytes >= 1000)
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `lad-gen-ok-${Date.now()}`,
          role: 'assistant',
          content: reallyOk
            ? `**演示工程已生成**（基于模板外壳扩展，非从零空工程）

- 结果：\`${outLad}\`（${outBytes} 字节）
- 模板：\`${r.templateLad || templateLad}\`（未覆盖）
- 新增网数：约 ${r.rungCount ?? '—'}
- 助记符：\`${r.mnemonicPath || '—'}\`
- 说明：\`${r.docPath || '—'}\`
${r.note ? `\n${r.note}` : ''}

**禁止下载到真实机床。** 用 LADDER-III 打开结果文件，查看末尾新增梯级。`
            : `**生成演示 LAD 未成功**

${r.error || '未知错误'}

请确认：已安装 fladder、模板为完整 0i 工程、且 LADDER-III GUI 已关闭。`,
          fileOps: [
            ...(reallyOk
              ? [
                  {
                    path: outLad,
                    bytes: outBytes,
                    created: true,
                    external: true,
                    ok: true,
                  },
                ]
              : []),
            ...(reallyOk && r.docPath
              ? [{ path: r.docPath, bytes: 0, created: true, external: true, ok: true }]
              : []),
          ],
        },
      ])
      setFileStatus(reallyOk ? `演示 LAD：${outLad}` : r.error || '生成失败')
      if (reallyOk && outLad) {
        setDismissedOpsLad('')
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `lad-gen-err-${Date.now()}`,
          role: 'system',
          content: `生成演示 LAD 异常：${err}`,
        },
      ])
      setFileStatus(`生成异常：${err}`)
    }
  }

  async function exportMnemonicOnly(ladPath: string) {
    if (!ladPath) return
    if (!ladderAllowed) {
      void requestOpenLadder(ladPath)
      return
    }
    setAllowBusy(true)
    setFileStatus('正在导出助记符…')
    try {
      const r = await samaClient.ladderExportMnemonic({
        ladPath,
        approved: true,
        rememberSession: true,
      })
      setFileStatus(r.ok ? `助记符已导出：${r.mnemonicPath}` : r.error || '导出失败')
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `mne-${Date.now()}`,
          role: 'assistant',
          content: r.ok
            ? `助记符导出成功：\`${r.mnemonicPath}\``
            : `助记符导出失败：${r.error || '未知'}`,
        },
      ])
    } finally {
      setAllowBusy(false)
    }
  }

  function resolveCurrentLadPath() {
    const fromAttach = attachments.find(
      (a) => a.path && (a.lad || /\.lad$/i.test(a.path || a.name || '')),
    )?.path
    if (fromAttach) return fromAttach
    if (/\.lad$/i.test(displayPath)) return displayPath
    if (lastWrittenLadRef.current) return lastWrittenLadRef.current
    const isBad = (p: string) =>
      /sama-fl3|\\temp\\.*project(_edited)?\.lad$/i.test(p.replace(/\//g, '\\')) ||
      /^[a-z]:\\temp\\/i.test(p)
    // 聊天里刚打开/申请过的 LAD（跳过 Temp 工作副本，避免写回写到 C:\Temp\...）
    for (let i = messages.length - 1; i >= 0; i--) {
      const c = String(messages[i]?.content || '')
      const m =
        c.match(/sama-allow-(?:ladder|lad-edit|export|lad-generate)\s+path=["']([^"']+\.LAD)["']/i) ||
        c.match(/已允许并打开 LADDER-III[：:]\s*`([^`]+\.LAD)`/i) ||
        c.match(/已打开 LADDER-III[：:]\s*`([^`]+\.LAD)`/i) ||
        c.match(/结果[：:]\s*`([^`]+\.LAD)`/i) ||
        c.match(/目标[：:]\s*`([^`]+\.LAD)`/i) ||
        c.match(/`([A-Za-z]:\\[^`]+\.LAD)`/i)
      if (m?.[1]) {
        const p = m[1].replace(/\\\\/g, '\\')
        if (!isBad(p)) return p
      }
    }
    return ''
  }

  function normLadKey(p: string) {
    return String(p || '')
      .replace(/\//g, '\\')
      .trim()
      .toLowerCase()
  }

  function dismissCurrentLadOps() {
    const p = resolveCurrentLadPath()
    if (!p) return
    setDismissedOpsLad(normLadKey(p))
    setFileStatus(`已清除 LAD 操作条：${p.split(/[/\\]/).pop()}`)
  }

  /** 操作条用：用户清除后隐藏；附件/阅读区换成别的 LAD 时再显示 */
  function resolveOpsLadPath() {
    const fromAttach = attachments.find(
      (a) => a.path && (a.lad || /\.lad$/i.test(a.path || a.name || '')),
    )?.path
    const fromEditor = /\.lad$/i.test(displayPath) ? displayPath : ''
    const fresh = fromAttach || fromEditor
    if (fresh) {
      if (dismissedOpsLad && normLadKey(fresh) === dismissedOpsLad) return ''
      return fresh
    }
    const p = resolveCurrentLadPath()
    if (!p) return ''
    if (dismissedOpsLad && normLadKey(p) === dismissedOpsLad) return ''
    return p
  }

  /** 允许后：导出助记符 + 生成报告 + 打开 GUI */
  async function runAllowAnalyzePipeline(ladPath: string, rememberSession: boolean) {
    const fixed = await resolveLadOrFail(ladPath)
    if (!fixed) return
    setAllowBusy(true)
    const thinkingId = `ladder-run-${Date.now()}`
    setSessionMessages(activeSessionId, (prev) => [
      ...prev,
      {
        id: thinkingId,
        role: 'system',
        content:
          '已允许。正在调用 LADDER-III 导出助记符并重新生成问题报告（可能需要几十秒）…',
      },
    ])
    try {
      const r = await samaClient.ladderAllowAndAnalyze({
        ladPath: fixed,
        approved: true,
        rememberSession,
        openGui: true,
      })
      if (rememberSession || r.ok) {
        setLadderAllowed(true)
      }
      setSessionMessages(activeSessionId, (prev) => {
        const without = prev.filter((m) => m.id !== thinkingId)
        if (!r.ok) {
          return [
            ...without,
            {
              id: `ladder-err-${Date.now()}`,
              role: 'system',
              content: `LADDER-III 后续分析失败：${r.error || '未知错误'}`,
            },
          ]
        }
        const interlock =
          r.exportOk && r.interlockSample && r.interlockSample.length
            ? `\n\n助记符互锁核验：\n${r.interlockSample.map((x) => `- ${x}`).join('\n')}`
            : r.exportOk
              ? '\n\n助记符已载入，但未匹配到可自动判定的互锁对。'
              : '\n\n**未做互锁核验**（助记符导出失败）。上方「待证」只是符号表线索，不是梯形图结论。'
        const exportLine = r.exportOk
          ? `- 助记符导出：**成功** \`${r.mnemonicPath}\``
          : `- 助记符导出：**失败** — ${r.exportError || '未知'}\n  （已改为：复制到英文临时目录再转换；请再点一次允许重试。若 GUI 正打开同一 LAD，请先关掉再试。）`
        const level = r.exportOk ? '完成' : '部分完成（仅符号表报告）'
        const guiLine = r.gui?.ok
          ? '- GUI：已打开 LADDER-III'
          : `- GUI：${r.gui?.error || '未打开'}`
        return [
          ...without,
          {
            id: `ladder-ok-${Date.now()}`,
            role: 'assistant',
            content: `允许后处理结果：**${level}**

${exportLine}
${guiLine}
- 符号表问题数：${r.issueCount ?? 0}
- 助记符已载入报告：${r.mnemonicLoaded ? '是' : '否'}
- 报告路径：\`${r.reportPath}\`
${interlock}

${r.exportOk ? '请双击报告路径查看（含互锁核验）。' : '请双击报告路径查看符号表体检；互锁须助记符成功后才能自动核验。'}`,
            fileOps: r.reportPath
              ? [{ path: r.reportPath, bytes: r.bytes, created: true, external: true, ok: true }]
              : [],
          },
        ]
      })
      setFileStatus(
        r.ok
          ? `已导出助记符并生成报告${r.exportOk ? '' : '（助记符导出失败，见对话）'}`
          : r.error || '分析失败',
      )
    } catch (e) {
      setSessionMessages(activeSessionId, (prev) => [
        ...prev.filter((m) => m.id !== thinkingId),
        {
          id: `ladder-err-${Date.now()}`,
          role: 'system',
          content: `LADDER-III 后续分析异常：${e instanceof Error ? e.message : String(e)}`,
        },
      ])
    } finally {
      setAllowBusy(false)
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as RecentFile[]
        if (Array.isArray(parsed)) setRecentFiles(parsed.slice(0, 12))
      }
    } catch {
      // ignore
    }
  }, [])

  function rememberRecent(filePath: string, name?: string) {
    if (!filePath) return
    const item: RecentFile = {
      path: filePath,
      name: name || filePath.split(/[/\\]/).pop() || filePath,
      at: Date.now(),
    }
    setRecentFiles((prev) => {
      const next = [item, ...prev.filter((x) => x.path !== filePath)].slice(0, 12)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  async function openFile(relPath: string) {
    const res = await samaClient.workspaceRead(relPath)
    if (!res.ok || res.content == null) {
      setFileStatus(res.error || '打开失败')
      return
    }
    const nextPath = res.path || relPath
    setActiveFile(nextPath)
    setFileContent(res.content)
    setNcBase(res.content)
    setNcAnnotated(null)
    setShowAnnotated(false)
    setFileDirty(false)
    setFileExternal(false)
    setFileStatus(`工程文件 · ${res.content.length} 字 · ${res.content.replace(/\r\n/g, '\n').split('\n').length} 行`)
    rememberRecent(nextPath, nextPath.split('/').pop())
    if (isGCodeFile(nextPath)) setEditorView('code')
  }

  function openExternalInEditor(file: LocalFileResult, opts?: { preferToolpath?: boolean }) {
    if (!file.ok || file.content == null) {
      setFileStatus(file.error || '打开失败')
      return
    }
    if (file.kind === 'folder') {
      setFileStatus('文件夹请拖到下方「目录」区域浏览')
      return
    }
    const abs = file.path || file.name || ''
    setActiveFile(`external:${abs}`)
    setFileContent(file.content)
    setNcBase(file.content)
    setNcAnnotated(null)
    setShowAnnotated(false)
    setFileDirty(false)
    setFileExternal(true)
    const looksG =
      isGCodeFile(abs) ||
      isGCodeFile(file.name || '') ||
      looksLikeGcode(String(file.content || ''))
    setEditorView(opts?.preferToolpath && looksG ? 'toolpath' : 'code')
    const lines = file.content.replace(/\r\n/g, '\n').split('\n').length
    const ladHint = file.lad
      ? ` · LAD 摘要（${file.symbolCount ?? 0} 符号）只读，勿直接覆盖原文件`
      : ''
    const tpHint = opts?.preferToolpath && looksG ? ' · 已切换刀路' : ''
    setFileStatus(`正在阅读 · ${file.name || abs} · ${file.content.length} 字 · ${lines} 行${ladHint}${tpHint}`)
    if (abs) rememberRecent(abs, file.name)
  }

  function attachActiveToChat() {
    if (!fileContent || !activeFile) {
      setFileStatus('没有已打开的文件')
      return
    }
    const name = displayPath.split(/[/\\]/).pop() || '当前文件'
    pushAttachments([
      {
        ok: true,
        name,
        path: fileExternal ? displayPath : undefined,
        kind: 'text',
        content: fileContent,
      },
    ])
    setFileStatus(`已将「${name}」加入对话附件，发送时模型可读`)
  }

  async function reopenRecent(item: RecentFile) {
    // 工程相对路径不含盘符
    if (!/^[a-zA-Z]:[\\/]/.test(item.path) && !item.path.startsWith('\\\\')) {
      await openFile(item.path)
      return
    }
    const res = await samaClient.readLocalPaths([item.path])
    const f = res.files?.[0]
    if (!f?.ok) {
      setFileStatus(f?.error || '无法重新打开，文件可能已移动')
      setRecentFiles((prev) => {
        const next = prev.filter((x) => x.path !== item.path)
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        } catch {
          // ignore
        }
        return next
      })
      return
    }
    openExternalInEditor(f)
  }

  function pushAttachments(files: LocalFileResult[]) {
    const next: Attachment[] = []
    for (const f of files) {
      if (!f.ok || f.content == null) {
        setFileStatus(f.error || `无法读取 ${f.name || '文件'}`)
        continue
      }
      next.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name || '未命名',
        path: f.path,
        kind: f.kind,
        content: f.content,
        dataUrl: f.dataUrl,
      })
    }
    if (!next.length) return
    const ladAtt = next.find((n) => /\.lad$/i.test(n.path || n.name || ''))
    if (ladAtt?.path) setDismissedOpsLad('')
    setAttachments((prev) => {
      const merged = [...prev]
      for (const n of next) {
        if (merged.some((p) => p.path && n.path && p.path === n.path)) continue
        if (merged.length >= 8) break
        merged.push(n)
      }
      return merged
    })
    const folderN = next.filter((n) => n.kind === 'folder').length
    if (folderN) {
      setFileStatus(`已附加 ${next.length} 项（含 ${folderN} 个文件夹，发送时模型可读）`)
    } else {
      setFileStatus(`已附加 ${next.length} 个文件（发送时会给模型读）`)
    }
  }

  async function pickLocalFiles(mode: 'attach' | 'editor' = 'attach') {
    const res = await samaClient.openLocalFiles()
    if (!res.ok) {
      setFileStatus(res.error || '打开失败')
      return
    }
    if (res.canceled) return
    const files = (res.files || []).filter(Boolean)
    if (mode === 'editor' && files[0]) {
      openExternalInEditor(files[0])
      if (files.length > 1) pushAttachments(files.slice(1))
      return
    }
    pushAttachments(files)
    const paths = files.map((f) => f.path).filter(Boolean) as string[]
    if (
      paths.length &&
      window.confirm('是否同时把这些资料入库为 SAMA 知识库？（将参与之后检索，可在设置里导出分享包）')
    ) {
      try {
        const imp = await samaClient.importPathsAsDatabase({ paths })
        if (imp.ok) {
          setFileStatus(imp.note || '已附加并入库')
          const k = await samaClient.getKbStatus()
          setKb(k)
        } else if (imp.error) {
          setFileStatus(`已附加；入库失败：${imp.error}`)
        }
      } catch (e) {
        setFileStatus(`已附加；入库失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  async function pickLocalFolder() {
    const res = await samaClient.openLocalFolder()
    if (!res.ok) {
      setFileStatus(res.error || '打开文件夹失败')
      return
    }
    if (res.canceled) return
    const files = (res.files || []).filter(Boolean)
    pushAttachments(files)
    const folder = files.find((f) => f.ok && f.kind === 'folder')
    if (folder?.ok) {
      setFileStatus(
        `已附加文件夹「${folder.name}」（${folder.fileCount ?? '?'} 个文件摘要，发送时模型可读）`,
      )
    }
  }

  function closeActiveFile() {
    if (fileDirty) {
      const ok = window.confirm('当前文件有未保存修改，确定关闭？')
      if (!ok) return
    }
    setActiveFile('')
    setFileContent('')
    setNcBase('')
    setNcAnnotated(null)
    setShowAnnotated(false)
    setFileDirty(false)
    setFileExternal(false)
    setFileStatus('已关闭文件')
    setEditorView('code')
  }

  async function importActiveExternal() {
    if (!fileExternal || !activeFile.startsWith('external:')) {
      setFileStatus('当前不是本机文件')
      return
    }
    const abs = activeFile.replace(/^external:/, '')
    const res = await samaClient.importLocalFile({ path: abs })
    if (!res.ok || !res.importedPath) {
      setFileStatus(res.error || '导入失败')
      return
    }
    setFileStatus(`已导入工程：${res.importedPath}`)
    await refreshTreeAndMaybeOpen(res.importedPath)
  }

  async function handleDroppedFiles(
    fileList: FileList | File[],
    asEditor = false,
    preferToolpath = false,
  ) {
    const files = Array.from(fileList)
    if (!files.length) return

    const paths: string[] = []
    for (const f of files) {
      const p = samaClient.getPathForFile(f)
      if (p) paths.push(p)
    }

    if (paths.length) {
      const res = await samaClient.readLocalPaths(paths)
      const okFiles = (res.files || []).filter((x) => x.ok)
      const bad = (res.files || []).filter((x) => !x.ok)
      if (bad.length) {
        const err = bad[0].error || '部分文件读取失败'
        setFileStatus(err)
        if (activeSessionId) {
          setSessionMessages(activeSessionId, (prev) => [
            ...prev,
            {
              id: `sys-drop-${Date.now()}`,
              role: 'system',
              content: `打开失败：${bad.map((b) => `${b.name || ''} ${b.error || ''}`.trim()).join('；')}`,
            },
          ])
        }
      }
      if (!okFiles.length) return
      if (asEditor) {
        const folder = okFiles.find((f) => f.kind === 'folder')
        if (folder && preferToolpath) {
          setFileStatus('刀路区请拖入 G 代码文件；文件夹请拖到下方目录区')
          return
        }
        const firstFile = okFiles.find((f) => f.kind !== 'folder') || okFiles[0]
        openExternalInEditor(firstFile, { preferToolpath })
        const rest = okFiles.filter((f) => f !== firstFile)
        if (rest.length) pushAttachments(rest)
      } else {
        pushAttachments(okFiles)
        setFileStatus(`已附加 ${okFiles.length} 个文件到对话`)
      }
      return
    }

    // 无绝对路径时（浏览器预览）：用 FileReader 读文本 / 图片
    for (const f of files.slice(0, 8)) {
      if (f.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result || ''))
          r.onerror = () => reject(r.error)
          r.readAsDataURL(f)
        })
        pushAttachments([
          {
            ok: true,
            name: f.name,
            kind: 'image',
            content: `[图片附件: ${f.name}]`,
            dataUrl,
          },
        ])
        continue
      }
      const text = await f.text()
      const item: LocalFileResult = {
        ok: true,
        name: f.name,
        kind: 'text',
        content: text.slice(0, 1024 * 1024),
      }
      if (asEditor) openExternalInEditor(item, { preferToolpath })
      else pushAttachments([item])
    }
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    if (e.currentTarget === e.target) setDragging(false)
  }

  async function onDropChat(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    await handleDroppedFiles(e.dataTransfer.files, false)
  }

  async function onDropEditor(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    await handleDroppedFiles(e.dataTransfer.files, true, true)
  }

  async function onDropDirBrowse(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files || [])
    if (!files.length) return
    const paths = files.map((f) => samaClient.getPathForFile(f)).filter(Boolean) as string[]
    if (!paths.length) {
      setFileStatus('无法识别拖入路径，请在桌面版中拖入本机文件夹')
      return
    }
    for (const p of paths) {
      const res = await samaClient.listLocalDirTree(p)
      if (res.ok && res.root) {
        await showBrowsedFolder(res.root)
        return
      }
    }
    setFileStatus('请拖入文件夹以显示目录（单个文件请拖到上方打开区）')
  }

  async function openTreeFile(relOrPath: string) {
    if (browseRoot) {
      const abs = joinBrowsePath(browseRoot, relOrPath)
      const res = await samaClient.readLocalPaths([abs])
      const f = res.files?.[0]
      if (!f?.ok) {
        setFileStatus(f?.error || '无法打开文件')
        return
      }
      openExternalInEditor(f)
      return
    }
    await openFile(relOrPath)
  }

  function toggleFolder(folderPath: string) {
    setExpanded((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }))
  }

  async function saveGcodeFromAnswer(nc: string, msgId: string) {
    const res = await samaClient.librarySaveGcode({
      content: nc,
      machine: camMachine.trim() || '未填机床',
    })
    if (!res.ok || !res.path) {
      setFileStatus(res.error || '生成 G 代码文件失败')
      return false
    }
    const desk = res.desktopPath || ''
    setFileStatus(
      desk
        ? `已生成 ${res.path} · 桌面：${desk}`
        : `已生成 ${res.path}`,
    )
    setMessagesBySession((prev) => {
      const list = prev[activeSessionId] || []
      return {
        ...prev,
        [activeSessionId]: list.map((m) => {
          if (m.id !== msgId) return m
          const already = (m.fileOps || []).some((op) => op.path === res.path)
          if (already) return m
          return {
            ...m,
            fileOps: [
              ...(m.fileOps || []),
              { path: res.path!, bytes: res.bytes, created: res.created, ok: true },
            ],
          }
        }),
      }
    })
    await refreshTreeAndMaybeOpen(res.path)
    return true
  }

  async function createSamaFolder() {
    const name = window.prompt(
      '新建文件夹（可写 01_加工程序/机床名，或完整 SAMA文件/...）',
      'SAMA文件/07_其它/新文件夹',
    )
    if (!name?.trim()) return
    const res = await samaClient.workspaceMkdir({ path: name.trim() })
    if (!res.ok) {
      setFileStatus(res.error || '新建文件夹失败')
      return
    }
    setFileStatus(`已创建文件夹 ${res.path}`)
    setExpanded((prev) => ({ ...prev, [res.path as string]: true }))
    await refreshTreeOnly()
  }

  async function createSamaFile() {
    const name = window.prompt(
      '新建文件名（FANUC 程序写 O1234，不要加 .nc；图纸写 零件.svg）',
      '未命名.md',
    )
    if (!name?.trim()) return
    const res = await samaClient.librarySaveFile({ name: name.trim(), content: '' })
    if (!res.ok || !res.path) {
      setFileStatus(res.error || '新建文件失败')
      return
    }
    setFileStatus(res.desktopPath ? `已新建 ${res.path} · 桌面已同步` : `已新建 ${res.path}`)
    await refreshTreeAndMaybeOpen(res.path)
  }

  async function openSamaLibrary() {
    const res = await samaClient.libraryOpen()
    if (!res.ok) {
      setFileStatus(res.error || '无法打开桌面 SAMA文件')
      return
    }
    setFileStatus(`已打开 ${res.path}`)
  }

  async function saveActiveFile() {
    if (!activeFile) return
    const toSave = showAnnotated ? ncBase : fileContent
    setFileSaving(true)
    try {
      if (fileExternal && activeFile.startsWith('external:')) {
        const abs = activeFile.replace(/^external:/, '')
        const res = await samaClient.writeLocalFile({
          path: abs,
          content: toSave,
          trustedPaths: [abs],
        })
        if (!res.ok) {
          setFileStatus(res.error || '保存失败')
          return
        }
        setFileDirty(false)
        setNcBase(toSave)
        setFileStatus(`已保存到本机 ${res.bytes ?? 0} 字节（原文）`)
        return
      }
    const res = await samaClient.workspaceWrite({
      path: activeFile,
        content: toSave,
    })
    if (!res.ok) {
      setFileStatus(res.error || '保存失败')
      return
    }
    setFileDirty(false)
      setNcBase(toSave)
      setFileStatus(
        res.desktopPath
          ? `已保存 ${res.bytes ?? 0} 字节（原文）；桌面已同步`
          : `已保存 ${res.bytes ?? 0} 字节（原文）`,
      )
    await refreshTreeAndMaybeOpen(activeFile)
    } finally {
      setFileSaving(false)
    }
  }

  /** 生成注释视图（不写新文件），可在「原文 / 注释」间切换 */
  async function createAnnotatedGcodeCopy() {
    if (!activeFile || !(ncBase || fileContent).trim()) {
      setFileStatus('请先打开 G 代码文件')
      return
    }
    if (!gcodeActive) {
      setFileStatus('当前文件不像 G 代码')
      return
    }
    setFileSaving(true)
    try {
      const source = (showAnnotated ? ncBase : fileContent) || ncBase || fileContent
      const ann = await samaClient.industrialAnnotateNc({ ncText: source })
      if (!ann.ok || !ann.text) {
        setFileStatus(ann.error || '生成注释失败')
        return
      }
      setNcBase(source)
      setNcAnnotated(ann.text)
      setShowAnnotated(true)
      setFileContent(ann.text)
      setEditorView('code')
      setFileStatus(`已生成注释视图（${ann.annotatedLines || 0} 行带注）· 可用下方切换回原文`)
    } finally {
      setFileSaving(false)
    }
  }

  function toggleNcAnnotateView(next: 'original' | 'annotated') {
    if (next === 'annotated') {
      if (!ncAnnotated) {
        void createAnnotatedGcodeCopy()
        return
      }
      if (!showAnnotated) {
        setNcBase(fileContent)
        setShowAnnotated(true)
        setFileContent(ncAnnotated)
      }
      setFileStatus('注释视图 · 不改目录文件名 · 保存仍写原文')
      return
    }
    if (showAnnotated) {
      const base = ncBase || fileContent
      setShowAnnotated(false)
      setFileContent(base)
      setFileStatus('已切回原文')
    }
  }

  function setSessionMessages(sessionId: string, next: Message[] | ((prev: Message[]) => Message[])) {
    setMessagesBySession((prev) => {
      const cur = prev[sessionId] || []
      const value = typeof next === 'function' ? next(cur) : next
      return { ...prev, [sessionId]: value }
    })
  }

  function rememberSession(kind: SessionKind, id: string) {
    lastByKindRef.current[kind] = id
    try {
      localStorage.setItem(`sama.session.${kind}`, id)
    } catch {
      /* ignore */
    }
  }

  function welcomeNow(kind: SessionKind) {
    return channelWelcome(kind, kb, !!settings?.hasApiKey, settings?.provider)
  }

  function startNewChat() {
    if (sending) {
      setFileStatus('请等待当前回复结束后再新建对话')
      return
    }
    const kind = mainView
    const ch = CHANNEL[kind]
    const id = newSessionId(kind)
    const session: ChatSession = {
      id,
      title: ch.newTitle,
      mode,
      updatedAt: formatTime(),
      kind,
    }
    setAttachments([])
    setInput('')
    allowQueueRef.current = []
    setAllowQueue([])
    setAllowCollapsed(false)
    setSessions((prev) => [session, ...prev])
    setActiveSessionId(id)
    rememberSession(kind, id)
    setMessagesBySession((prev) => ({ ...prev, [id]: welcomeNow(kind) }))
    setFileStatus(`已开新的${ch.history}（与其它页隔离）`)
  }

  function enterChannel(kind: SessionKind) {
    if (sending) {
      setFileStatus(`请等待当前回复结束后再切换到${CHANNEL[kind].history}`)
      return
    }
    const curKind = sessionKind(
      sessions.find((s) => s.id === activeSessionId) || { id: activeSessionId },
    )
    if (mainView === kind && activeSessionId && curKind === kind) {
      return
    }
    if (activeSessionId) rememberSession(curKind, activeSessionId)
    let sid = lastByKindRef.current[kind]
    const exists = Boolean(sid && sessions.some((s) => s.id === sid && sessionKind(s) === kind))
    if (!exists) {
      const existing = sessions.find((s) => sessionKind(s) === kind)
      if (existing) {
        sid = existing.id
        rememberSession(kind, sid)
      } else {
        sid = newSessionId(kind)
        rememberSession(kind, sid)
        const session: ChatSession = {
          id: sid,
          title: CHANNEL[kind].newTitle,
          mode,
          updatedAt: formatTime(),
          kind,
        }
        setSessions((prev) => [session, ...prev])
        setMessagesBySession((prev) => ({ ...prev, [sid as string]: welcomeNow(kind) }))
      }
    }
    const sess = sessions.find((s) => s.id === sid)
    setActiveSessionId(sid || '')
    if (sess) setMode(sess.mode)
    setAttachments([])
    setInput('')
    allowQueueRef.current = []
    setAllowQueue([])
    setAllowCollapsed(false)
    setMainView(kind)
  }

  async function generateSampleInChat() {
    if (!activeSessionId) return
    const kind = mainView
    const ch = CHANNEL[kind]
    if (kind !== 'mech' && kind !== 'elec') return
    if (!ch.domain) return
    setFileStatus(`正在生成${ch.history}样例…`)
    try {
      if (kind === 'elec') {
        const r = await samaClient.electricalGenerate({ template: 'power1' })
        if (!r.ok || !r.path) {
          setFileStatus(r.error || '导出连通性失败')
          return
        }
        const ext = r as {
          connectivityText?: string
          markdown?: string
          txtPath?: string
          deviceCount?: number
          edgeCount?: number
        }
        const connText = ext.connectivityText || ext.markdown || ''
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          {
            id: `sample-${Date.now()}`,
            role: 'assistant',
            content: `已按 MIKROSA SASL32 模板导出主回路连通性。md：${r.path || ''}${ext.txtPath ? ` · txt：${ext.txtPath}` : ''}。`,
            plcSample: {
              title: '主回路连通性',
              electrical: {
                connectivityText: connText,
                markdown: ext.markdown,
                path: r.path,
                txtPath: ext.txtPath,
                deviceCount: ext.deviceCount,
                edgeCount: ext.edgeCount,
              },
            },
            fileOps: [
              ...(r.path ? [{ path: r.path, bytes: undefined, created: true, ok: true }] : []),
              ...(ext.txtPath ? [{ path: ext.txtPath, created: true, ok: true }] : []),
            ],
          },
        ])
        setFileStatus(r.desktopPath ? `已导出连通性 · 桌面：${r.desktopPath}` : '连通性表已显示')
        await refreshTreeOnly()
        return
      }
      const r = await samaClient.industrialRunWorkflow({
        workflowId: 'clamp_cylinder',
        name: `${ch.newTitle}样例`,
        holdMs: 3000,
        domains: [ch.domain],
      })
      if (!r.ok && !r.success) {
        const err =
          typeof r.error === 'string'
            ? r.error
            : r.error && typeof r.error === 'object' && 'message' in r.error
              ? String((r.error as { message?: string }).message)
              : '生成失败'
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          { id: `sample-err-${Date.now()}`, role: 'system', content: `样例生成失败：${err}` },
        ])
        setFileStatus(`失败：${err}`)
        return
      }
      const content = '机械样例已生成（顶视示意，不是 SolidWorks 三维）。'
      const preview = r.preview
        ? {
            ...r.preview,
            ioTable: undefined,
            sequenceOk: undefined,
          }
        : undefined
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `sample-${Date.now()}`,
          role: 'assistant',
          content,
          plcSample: preview as Message['plcSample'],
        },
      ])
      setFileStatus('样例已显示在对话里')
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        { id: `sample-err-${Date.now()}`, role: 'system', content: `样例生成异常：${err}` },
      ])
      setFileStatus(`失败：${err}`)
    }
  }

  function deleteSession(sessionId: string, e?: { stopPropagation: () => void }) {
    e?.stopPropagation()
    if (sending && sessionId === activeSessionId) {
      setFileStatus('生成中不可删除当前对话')
      return
    }
    const target = sessions.find((s) => s.id === sessionId)
    const title = target?.title || '该对话'
    if (!window.confirm(`确定删除对话「${title}」？删除后无法恢复。`)) return

    const kind = sessionKind(target || { id: sessionId })
    const remaining = sessions.filter((s) => s.id !== sessionId)
    const remainingKind = remaining.filter((s) => sessionKind(s) === kind)

    if (!remainingKind.length) {
      const id = newSessionId(kind)
      const session: ChatSession = {
        id,
        title: CHANNEL[kind].newTitle,
        mode,
        updatedAt: formatTime(),
        kind,
      }
      setSessions([session, ...remaining.filter((s) => sessionKind(s) !== kind)])
      setActiveSessionId(id)
      rememberSession(kind, id)
      setMainView(kind)
      setAttachments([])
      setInput('')
      setMessagesBySession((prev) => {
        const next = { ...prev }
        delete next[sessionId]
        next[id] = welcomeNow(kind)
        return next
      })
      setFileStatus('已删除，并自动开了无记忆的新对话')
      return
    }

    setSessions(remaining)
    setMessagesBySession((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    if (sessionId === activeSessionId) {
      const next = remainingKind[0]
      setActiveSessionId(next.id)
      setMode(next.mode)
      rememberSession(kind, next.id)
      setAttachments([])
      setInput('')
      setFileStatus(`已删除「${title}」，已切换到其它对话`)
    } else {
      setFileStatus(`已删除「${title}」`)
    }
  }

  function clearCurrentChat() {
    if (!activeSessionId || sending) return
    if (!window.confirm('清空当前对话内容？不会删除会话条目，但本对话记忆会重置。')) return
    const kind = sessionKind(sessions.find((s) => s.id === activeSessionId) || { id: activeSessionId })
    setAttachments([])
    setInput('')
    allowQueueRef.current = []
    setAllowQueue([])
    setAllowCollapsed(false)
    setSessionMessages(activeSessionId, welcomeNow(kind))
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId ? { ...s, title: CHANNEL[kind].newTitle, updatedAt: formatTime() } : s,
      ),
    )
    setFileStatus('已清空本对话记忆')
  }

  function runCamFromDrawing() {
    const machine = camMachine.trim()
    if (!machine) {
      setFileStatus('请先填写机床型号')
      return
    }
    const hasDrawing =
      attachments.length > 0 ||
      /\.(dxf|dwg|png|jpe?g|webp|bmp|pdf|svg)$/i.test(activeFile || '')
    if (!hasDrawing && !input.trim()) {
      setFileStatus('请先打开加工图，或在输入框写清零件尺寸')
      return
    }
    const extra = input.trim()
    void sendMessage(
      [
        `【看图出码】机床型号：${machine}。`,
        extra || '请根据附图/附件加工图，为该机床写出完整加工程序（安全开头、工艺分段、M30）。',
        '尺寸以识图为准，看不清标存疑。禁止声称已校验、已仿真或已下机床。',
      ].join('\n'),
    )
  }

  function runCamReadCode() {
    const hasCode =
      attachments.some((a) => isGCodeFile(a.name) || looksLikeGcode(a.content || '')) ||
      looksLikeGcode(input) ||
      isGCodeFile(activeFile) ||
      looksLikeGcode(fileContent)
    if (!hasCode && !input.trim() && attachments.length === 0) {
      setFileStatus('请先打开或粘贴加工程序')
      return
    }
    void sendMessage(
      [
        '【看码识件】请根据附件或正文中的加工程序，说明它加工的是什么零件（名称与类型），',
        '并列出关键参数：外形尺寸、直径/长度/深度、余量、砂轮或刀具、进给、转速、行程、坐标系。',
        '不确定就标存疑。不要改程序，除非用户明确要求。',
        input.trim() ? `\n用户补充：${input.trim()}` : '',
      ].join(''),
    )
  }

  function elecElkPath() {
    const att = attachments.find((a) => /\.elk$/i.test(a.path || a.name || ''))
    if (att?.path) return att.path
    const p = (activeFile || displayPath || '').replace(/^external:/, '')
    if (/\.elk$/i.test(p)) return p
    return ''
  }

  async function runEplanBind() {
    setFileStatus('正在探测并绑定 EPLAN…')
    try {
      const r = await samaClient.eplanOperate({ action: 'bind' })
      if (!r.ok) {
        setFileStatus(String(r.error || 'EPLAN 绑定失败'))
        return
      }
      setEplanChip(`EPLAN ${String((r as { eplanVersion?: string }).eplanVersion || '')} · 已绑定`)
      setFileStatus(`已绑定 ${String((r as { eplanPath?: string }).eplanPath || 'W3u.exe')}`)
    } catch (e) {
      setFileStatus(`EPLAN 绑定失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function runEplanOpenReference() {
    setFileStatus('正在用 EPLAN 打开原厂工程对照…')
    try {
      await samaClient.eplanSessionAllow(true)
      const r = await samaClient.eplanOperate({
        action: 'openReference',
        elkPath: elecElkPath(),
        machineModel: camMachine.trim(),
        pdfPath: elecPdfPath(),
        approved: true,
        rememberSession: true,
      })
      if (!r.ok) {
        setFileStatus(String(r.error || '未能打开 .elk'))
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          {
            id: `eplan-open-fail-${Date.now()}`,
            role: 'assistant',
            content: `【EPLAN 对照原图失败】${String(r.error || '未知错误')}\n\n请拖入 .elk 或填写机床型号（如 MIKROSA SASL32），再点「EPLAN 对照原图」。`,
          },
        ])
        return
      }
      const note = (r as { note?: string }).note || `已打开：${(r as { elkPath?: string }).elkPath || ''}`
      setFileStatus(note)
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `eplan-open-${Date.now()}`,
          role: 'assistant',
          content: `【EPLAN 原厂图已打开】${note}\n\nSAMA「连通性出图」是 IEC 逻辑示意；精准原图请在 EPLAN 中对照翻页。`,
        },
      ])
    } catch (e) {
      setFileStatus(`打开 EPLAN 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function elecPdfPath() {
    const att = attachments.find((a) => a.kind === 'pdf' || /\.pdf$/i.test(a.path || a.name || ''))
    if (att?.path) return att.path
    const p = (activeFile || displayPath || '').replace(/^external:/, '')
    if (/\.pdf$/i.test(p)) return p
    return ''
  }

  async function runElecReadDrawing() {
    const pdf = elecPdfPath()
    if (pdf) {
      setFileStatus('正在识读电路图 PDF…')
      const r = await samaClient.electricalRead({ path: pdf })
      if (!r.ok) {
        setFileStatus(r.error || '识读失败')
        void sendMessage('【看图读图】请根据附图说明这套电路图的页目录、主回路位号和 I/O。看不清标存疑。')
        return
      }
      const ext = r as {
        weak?: boolean
        hint?: string
        deviceCount?: number
        edgeCount?: number
        connectivityText?: string
        markdown?: string
        txtPath?: string
        toc?: { no: number; title: string }[]
      }
      const toc = (ext.toc || []).map((t) => `/${t.no} ${t.title}`).join('\n')
      const machine = (r.doc as { project?: { machine?: string } })?.project?.machine || ''
      const connText = ext.connectivityText || ext.markdown || ''
      const weakNote = ext.weak
        ? `\n\n⚠ **PDF 文本信息不足**（约识出 ${ext.deviceCount ?? 0} 个元件）。${ext.hint || '请让 Agent 读 PDF 输出 elec-json，再点「导出连通性」。'}`
        : ''
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `elec-read-${Date.now()}`,
          role: 'assistant',
          content: `已识读电路图 PDF${machine ? `（${machine}）` : ''}。\n\n${toc || '（目录未完整抽出，请对照 PDF 或让模型读附件）'}${weakNote}${
            ext.weak
              ? ''
              : `\n\n器件 ${ext.deviceCount ?? '—'} · 连接 ${ext.edgeCount ?? '—'}\nmd：${r.path || ''}${ext.txtPath ? ` · txt：${ext.txtPath}` : ''}`
          }\n由 PDF 文本还原元件与相连关系，不是描原图。`,
          ...(ext.weak || !connText
            ? {}
            : {
                plcSample: {
                  title: (r.doc as { page?: { title?: string } })?.page?.title || '电路连通性',
                  electrical: {
                    connectivityText: connText,
                    markdown: ext.markdown,
                    path: r.path,
                    txtPath: ext.txtPath,
                    deviceCount: ext.deviceCount,
                    edgeCount: ext.edgeCount,
                  },
                },
              }),
          fileOps: [
            ...(r.path ? [{ path: r.path, created: true, ok: true }] : []),
            ...(ext.txtPath ? [{ path: ext.txtPath, created: true, ok: true }] : []),
          ],
        },
      ])
      if (ext.weak) {
        setFileStatus('已抽出 PDF 目录 · 请在对话出 elec-json 后点「导出连通性」')
      } else {
        setFileStatus(r.desktopPath ? `已导出连通性 · ${r.desktopPath}` : '连通性表已显示')
      }
      await refreshTreeOnly()
      return
    }
    void sendMessage(
      '【看图读图】请根据附图/照片抽出页目录、电位、位号和 I/O，并输出 elec-json 以便导出连通性表。看不清标存疑。',
    )
  }

  function lastElecJsonFence() {
    const list = [...(messages || [])].reverse()
    for (const m of list) {
      const c = String(m?.content || '')
      if (/```elec-json/i.test(c)) return c
    }
    return ''
  }

  async function runElecGenerate() {
    setFileStatus('正在导出连通性…')
    const typed = input.trim()
    const fence = lastElecJsonFence() || (/```elec-json/i.test(typed) ? typed : '')
    const wantsEdit = /改|增加|删除|加一|去掉|伺服|连通|出图|电路/.test(typed)
    try {
      if (fence) {
        const pdf = elecPdfPath()
        const r = await samaClient.electricalRender({
          text: fence,
          pdfPath: pdf || undefined,
        })
        if (!r.ok || !r.path) {
          const rej = r as { error?: string; errors?: string[] }
          const detail = (rej.errors || []).slice(0, 8).join('；') || rej.error || '导出失败'
          setFileStatus(`连通性校验未通过：${detail}`)
          setSessionMessages(activeSessionId, (prev) => [
            ...prev,
            {
              id: `elec-reject-${Date.now()}`,
              role: 'assistant',
              content: `【连通性不合格，未导出】\n\n${detail}\n\n请让 Agent 按 9c 规则重出 elec-json。系统不会自动改 JSON。`,
            },
          ])
          return
        }
        const ext = r as {
          pageCount?: number
          isBook?: boolean
          txtPath?: string
          connectivityText?: string
          markdown?: string
          deviceCount?: number
          edgeCount?: number
          previewPage?: { title?: string }
        }
        const connText = ext.connectivityText || ext.markdown || ''
        const title =
          ext.previewPage?.title ||
          (r.doc as { page?: { title?: string } } | undefined)?.page?.title ||
          '电路连通性'
        const bookNote =
          ext.isBook && ext.pageCount
            ? `整本 ${ext.pageCount} 页连通性已合并导出。`
            : '已按对话里的 elec-json 导出元件相连关系。'
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          {
            id: `elec-gen-${Date.now()}`,
            role: 'assistant',
            content: `${bookNote}md：${r.path || ''}${ext.txtPath ? ` · txt：${ext.txtPath}` : ''}。器件 ${ext.deviceCount ?? '—'} · 连接 ${ext.edgeCount ?? '—'}。`,
            plcSample: connText
              ? {
                  title,
                  electrical: {
                    connectivityText: connText,
                    markdown: ext.markdown,
                    path: r.path,
                    txtPath: ext.txtPath,
                    deviceCount: ext.deviceCount,
                    edgeCount: ext.edgeCount,
                  },
                }
              : undefined,
            fileOps: [
              ...(r.path ? [{ path: r.path, created: true, ok: true }] : []),
              ...(ext.txtPath ? [{ path: ext.txtPath, created: true, ok: true }] : []),
            ],
          },
        ])
        setFileStatus(r.desktopPath ? `已导出连通性 · ${r.desktopPath}` : '连通性表已显示')
        await refreshTreeOnly()
        return
      }
      if (wantsEdit && typed) {
        void sendMessage(
          `【改连接】${typed}\n请按改图要求输出 elec-json（kind/project/page/rails/columns/io，改后 columns 含原位号和新位号）。系统导出连通性 md/txt。禁止手绘 SVG。`,
        )
        return
      }
      const pdf = elecPdfPath()
      if (pdf) {
        setFileStatus('正在请 Agent 读 PDF 出 elec-json…')
        void sendMessage(
          [
            '【连通性】附件是电路图 PDF。',
            '请按 PDF 页目录连续输出多段 ```elec-json```（封面/目录→电源→电机→控制→伺服→I/O），',
            '电机页每条回路同一列竖串 Q→KM→M，列 i 只用 0–9，列内 wires 首尾相接。',
            '出完后我会点「导出连通性」生成 md/txt。',
            typed ? `\n补充：${typed}` : '',
          ].join(''),
        )
        return
      }
      const r = await samaClient.electricalGenerate({ template: 'power1' })
      if (!r.ok || !r.path) {
        setFileStatus(r.error || '导出失败')
        return
      }
      const ext = r as {
        connectivityText?: string
        markdown?: string
        txtPath?: string
        deviceCount?: number
        edgeCount?: number
      }
      const connText = ext.connectivityText || ext.markdown || ''
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `elec-gen-${Date.now()}`,
          role: 'assistant',
          content: `已导出 MIKROSA SASL32 主回路连通性模板。md：${r.path || ''}${ext.txtPath ? ` · txt：${ext.txtPath}` : ''}。若要按 PDF/改图导出，请先看图读图或在对话里说明改哪一处。`,
          plcSample: connText
            ? {
                title: '主回路连通性',
                electrical: {
                  connectivityText: connText,
                  markdown: ext.markdown,
                  path: r.path,
                  txtPath: ext.txtPath,
                  deviceCount: ext.deviceCount,
                  edgeCount: ext.edgeCount,
                },
              }
            : undefined,
          fileOps: [
            ...(r.path ? [{ path: r.path, created: true, ok: true }] : []),
            ...(ext.txtPath ? [{ path: ext.txtPath, created: true, ok: true }] : []),
          ],
        },
      ])
      setFileStatus(r.desktopPath ? `已导出模板 · ${r.desktopPath}` : '连通性表已显示')
      await refreshTreeOnly()
    } catch (e) {
      setFileStatus(`导出连通性失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function runElecDrawDiagram() {
    setFileStatus('正在由连通性文本渲染原理图…')
    const typed = input.trim()
    const fence = lastElecJsonFence() || (/```elec-json/i.test(typed) ? typed : '')
    const pdf = elecPdfPath()
    try {
      const r = fence
        ? await samaClient.electricalRender({
            text: fence,
            pdfPath: pdf || undefined,
            mode: 'diagram',
          })
        : pdf
          ? await samaClient.electricalRead({ path: pdf, mode: 'diagram' })
          : null
      if (!r) {
        setFileStatus('请先拖入电路 PDF，或在对话里出 elec-json')
        return
      }
      if (!r.ok || !r.path) {
        const rej = r as { error?: string; errors?: string[]; compareReport?: string; phase?: string }
        const detail =
          rej.compareReport ||
          (rej.errors || []).slice(0, 8).join('；') ||
          rej.error ||
          '出图失败'
        setFileStatus(`出图未通过：${rej.phase === 'post-draw' ? 'SVG接线' : '对照校验'}`)
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          {
            id: `elec-draw-reject-${Date.now()}`,
            role: 'assistant',
            content: `【对照 PDF 正确答案未通过，未出图】\n\n${detail}`,
          },
        ])
        return
      }
      const ext = r as {
        pageCount?: number
        isBook?: boolean
        txtPath?: string
        connectivityText?: string
        markdown?: string
        deviceCount?: number
        edgeCount?: number
        svg?: string
        logicVerifyText?: string
        compareReport?: string
        tagAudit?: { coveragePct?: number; foundInSvg?: number; totalTags?: number; missingTags?: string[] }
        htmlPath?: string
        pdfPath?: string
      }
      const connText = ext.connectivityText || ext.markdown || ''
      const audit = ext.tagAudit
      const auditLine = audit
        ? `SVG 位号覆盖 **${audit.foundInSvg ?? '—'}/${audit.totalTags ?? '—'}**（${audit.coveragePct ?? '—'}%）`
        : ''
      const compareBlock = ext.compareReport ? `\n\n${ext.compareReport}` : ''
      const logicBlock = ext.logicVerifyText && !ext.compareReport ? `\n\n${ext.logicVerifyText}` : ''
      const missLine =
        audit?.missingTags?.length
          ? `\n未画出的位号（前10）：${audit.missingTags.slice(0, 10).join('、')}`
          : ''
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `elec-draw-${Date.now()}`,
          role: 'assistant',
          content: [
            `已按连通性关系渲染 IEC 原理图（${ext.pageCount || 1} 页）。`,
            auditLine,
            ext.htmlPath ? `HTML：\`${ext.htmlPath}\`` : '',
            ext.pdfPath ? `PDF：\`${ext.pdfPath}\`` : `主文件：\`${r.path}\``,
            compareBlock || logicBlock,
            missLine,
            '说明：布局为 IEC 示意，不是原 PDF 像素复刻；精准度看位号覆盖与逻辑对照。',
            '点「EPLAN 对照原图」可在 EPLAN 中打开原厂 .elk 工程对照翻页。',
          ]
            .filter(Boolean)
            .join('\n'),
          plcSample: {
            title: ext.isBook ? `整本原理图（${ext.pageCount} 页）` : '原理图预览',
            description: auditLine || undefined,
            electrical: {
              svg: ext.svg,
              connectivityText: connText,
              markdown: ext.markdown,
              path: r.path,
              txtPath: ext.txtPath,
              deviceCount: ext.deviceCount,
              edgeCount: ext.edgeCount,
            },
          },
          fileOps: [
            ...(r.path ? [{ path: r.path, created: true, ok: true }] : []),
            ...(ext.txtPath ? [{ path: ext.txtPath, created: true, ok: true }] : []),
            ...(ext.htmlPath ? [{ path: ext.htmlPath, created: true, ok: true }] : []),
            ...(ext.pdfPath ? [{ path: ext.pdfPath, created: true, ok: true }] : []),
          ],
        },
      ])
      setFileStatus(r.desktopPath ? `已出图 · ${r.desktopPath}` : '原理图已显示在右侧预览')
      await refreshTreeOnly()
    } catch (e) {
      setFileStatus(`出图失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function selectSession(session: ChatSession) {
    if (sending) {
      setFileStatus('请等待当前回复结束后再切换对话')
      return
    }
    const kind = sessionKind(session)
    allowQueueRef.current = []
    setAllowQueue([])
    setAllowCollapsed(false)
    setActiveSessionId(session.id)
    setMode(session.mode)
    setAttachments([])
    setInput('')
    rememberSession(kind, session.id)
    setMainView(kind)
    if (!messagesBySession[session.id]?.length) {
      setSessionMessages(session.id, [
        {
          id: `sys-${session.id}`,
          role: 'system',
          content: `已打开存档「${session.title}」。各对话记忆相互隔离。`,
        },
      ])
    }
  }

  async function sendMessage(preset?: string) {
    const text =
      (preset ?? input).trim() ||
      (attachments.length || citeFollowUps.length ? '请结合引用继续说明。' : '')
    if (!text || sending || !activeSessionId) return

    // 写入进行中禁止连发，避免 L2/L3 抢点旧允许卡
    if (allowBusy) {
      setFileStatus('正在写入 LAD，请等本步完成后再发下一条')
      return
    }

    // 用户发新话：作废未点的旧允许卡（常见：上一轮残留 TEST_BTN）
    {
      const superseded = supersedePendingAllows(
        allowQueueRef.current.length > 0 ? '已发新消息，上一轮未点的权限卡已作废' : '',
      )
      if (superseded) {
        setSessionMessages(activeSessionId, (prev) => [
          ...prev,
          {
            id: `allow-supersede-${Date.now()}`,
            role: 'system',
            content: '已作废上一轮未处理的权限申请（避免误点旧的写入卡）。',
          },
        ])
      }
    }

    if (!settings?.hasApiKey) {
      setSessionMessages(activeSessionId, (prev) => [
        ...prev,
        {
          id: `u-${Date.now()}`,
          role: 'user',
          content: text,
        },
        {
          id: `e-${Date.now() + 1}`,
          role: 'system',
          content:
            '还没有配置 API Key，所以无法回答。请点击右上角「设置」，填写通义千问 Key 后点「测试连通」和「保存」。',
        },
      ])
      setInput('')
      setSettingsOpen(true)
      return
    }

    const followUps = [...citeFollowUps]
    const followBlock =
      followUps.length > 0
        ? followUps
            .map(
              (s) =>
                `[${s.n}] ${s.brand} / ${s.source}${s.title ? `（${s.title}）` : ''}\n${s.snippet || ''}`,
            )
            .join('\n\n')
        : ''
    const agentText = followBlock
      ? `【用户追问 · 请优先依据下列引用作答，并标明出处】\n${followBlock}\n\n用户问题：${text}`
      : text
    const sendText = `${CHANNEL[mainView].askPrefix}${agentText}`

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: [
        text,
        followUps.length
          ? `（追问引用：${followUps.map((s) => `[${s.n}] ${s.title || s.source}`).join('、')}）`
          : '',
        attachments.length > 0
          ? `（已附 ${attachments.length} 个文件：${attachments.map((a) => a.name).join('、')}）`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    }

    const history = [...(messagesBySession[activeSessionId] || []), userMsg]
    setSessionMessages(activeSessionId, history)
    setInput('')
    setCiteFollowUps([])
    // 用户已写明 sama-allow-lad-edit：立刻弹正确允许卡（不等模型，也防模型回成 TEST_BTN）
    void enqueueExplicitUserEdit(userMsg.id, userMsg.content)
    const turnAttachments = attachments.map((a) => ({
      name: a.name,
      path: a.path,
      kind: a.kind,
      lad: a.lad || /\.lad$/i.test(a.name || a.path || ''),
      content: a.kind === 'image' ? `[图片附件: ${a.name}]` : a.content,
      dataUrl: a.dataUrl,
    }))
    setAttachments([])
    setSending(true)

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              title: isDefaultTitle(s.title, sessionKind(s)) ? text.slice(0, 18) : s.title,
              mode,
              updatedAt: formatTime(),
            }
          : s,
      ),
    )

    const thinkingId = `t-${Date.now()}`
    const hasLadAttach = turnAttachments.some((a) => a.lad || /\.lad$/i.test(a.name || a.path || ''))
    setSessionMessages(activeSessionId, (prev) => [
      ...prev,
      {
        id: thinkingId,
        role: 'system',
        content: hasLadAttach
          ? '正在分析 LAD（精简符号上下文，通常约几十秒）…'
          : kb?.ready
          ? '正在检索本地知识库并请求模型…'
          : '知识库未就绪，仍将请求模型（仅通用经验）…',
      },
    ])

    try {
      const hasLadContext =
        hasLadAttach ||
        /\.lad$/i.test(activeFile || '') ||
        /\.lad$/i.test(displayPath || '')
      // LAD 回合不回传超大正文，主进程会按路径重读精简上下文
      const payloadFileContent = hasLadContext
        ? ''
        : fileContent.length > 24_000
          ? `${fileContent.slice(0, 24_000)}\n\n…（已截断，完整内容见右侧编辑器）`
          : fileContent

      const result = await samaClient.chat({
        mode,
        userText: sendText,
        channel: mainView,
        history: history
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role,
            content:
              m.content.length > 6000 ? `${m.content.slice(0, 6000)}\n…` : m.content,
          })),
        enabledLibraries: enabledLibs.map((l) => ({
          brand: l.brand,
          title: l.title,
          version: l.version,
        })),
        activeFile,
        fileContent: payloadFileContent,
        attachments: turnAttachments.map((a) => ({
          name: a.name,
          path: a.path,
          kind: a.kind,
          content: a.lad
            ? String(a.content || '').slice(0, 14_000)
            : a.kind === 'image'
              ? String(a.content || '').slice(0, 200)
              : String(a.content || '').slice(0, 12_000),
          dataUrl: a.kind === 'image' ? a.dataUrl : undefined,
        })),
      })

      setSessionMessages(activeSessionId, (prev) => {
        const withoutThinking = prev.filter((m) => m.id !== thinkingId)
        if (!result.ok) {
          return [
            ...withoutThinking,
            {
              id: `e-${Date.now()}`,
              role: 'system',
              content: `调用失败：${result.error || '未知错误'}${
                result.code === 'NO_API_KEY'
                  ? ' → 请打开右上角设置填写 API Key。'
                  : ''
              }`,
            },
          ]
        }
        const lightOps = (result.fileOps || [])
          .filter((op) => op.ok)
          .map((op) => ({
            path: op.path,
            bytes: op.bytes,
            created: op.created,
            external: op.external,
            ok: true,
          }))
return [
        ...withoutThinking,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: result.content || '',
          citations: result.citations,
            sources: result.sources,
            fileOps: lightOps,
            plcSample: result.plcSample as Message['plcSample'],
          undoSnapshots: (result.fileOps || [])
            .filter((op) => op.ok && op.undo)
            .map((op) => ({
              path: op.path,
              existed: op.undo!.existed,
                // 超大快照不进 React 状态，避免卡顿；小文件仍可撤回
                previousContent:
                  op.undo!.previousContent != null &&
                  op.undo!.previousContent.length > 80_000
                    ? null
                    : op.undo!.previousContent,
            })),
        },
      ]
      })

      if (result.ok && result.fileOps?.some((op) => op.ok)) {
        await refreshTreeOnly()
        const n = result.fileOps.filter((op) => op.ok).length
        setFileStatus(`已写入 ${n} 个文件 — 可在对话里双击路径，在 SAMA 内打开`)
      }
    } catch (e) {
      setSessionMessages(activeSessionId, (prev) => [
        ...prev.filter((m) => m.id !== thinkingId),
        {
          id: `e-${Date.now()}`,
          role: 'system',
          content: `调用异常：${e instanceof Error ? e.message : String(e)}`,
        },
      ])
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  function canUndoTurn() {
    const list = messagesBySession[activeSessionId] || []
    return list.some((m) => m.role === 'user') && !sending
  }

  async function undoLastTurn() {
    if (!activeSessionId || sending) return
    const list = messagesBySession[activeSessionId] || []
    let lastUserIdx = -1
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx < 0) {
      setFileStatus('没有可撤回的对话')
      return
    }

    // 收集本回合 assistant 的文件快照（可能有多条 assistant，合并）
    const snapshots: {
      path: string
      existed: boolean
      previousContent: string | null
    }[] = []
    for (let i = lastUserIdx + 1; i < list.length; i++) {
      const snaps = list[i].undoSnapshots
      if (snaps?.length) snapshots.push(...snaps)
    }

    // 同一文件多次写入时，保留最早快照（最接近回合开始）
    const earliest = new Map<string, (typeof snapshots)[0]>()
    for (const s of snapshots) {
      if (!earliest.has(s.path)) earliest.set(s.path, s)
    }
    const uniqueSnaps = [...earliest.values()]

    if (uniqueSnaps.length) {
      const rev = await samaClient.workspaceRevert(uniqueSnaps)
      if (!rev.ok) {
        setFileStatus(rev.error || '文件恢复失败')
        return
      }
      const failed = (rev.results || []).filter((r) => !r.ok)
      if (failed.length) {
        setFileStatus(`部分文件恢复失败：${failed.map((f) => f.path).join(', ')}`)
      } else {
        setFileStatus(`已恢复 ${uniqueSnaps.length} 个文件`)
      }
      await refreshTreeAndMaybeOpen(activeFile || uniqueSnaps[0]?.path)
    }

    const trimmed = list.slice(0, lastUserIdx)
    setSessionMessages(activeSessionId, [
      ...trimmed,
      {
        id: `undo-${Date.now()}`,
        role: 'system',
        content: uniqueSnaps.length
          ? `已撤回上一轮对话，并恢复了 ${uniqueSnaps.length} 个相关文件。`
          : '已撤回上一轮对话（本回合无文件改动）。',
      },
    ])
  }

  return (
    <div
      className={`app-shell${dragging ? ' dragging' : ''}`}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void handleDroppedFiles(e.dataTransfer.files, false)
      }}
    >
      {dragging && (
        <div className="drop-banner">
          上方打开区拖文件可看刀路 · 下方目录区拖文件夹可浏览 · 其它区域附加到对话
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">SAMA</span>
          <span className="brand-ver">1.3</span>
        </div>
        <div className="topbar-meta">
          <span className={`pill ${kb?.ready ? '' : 'muted'}`}>
            知识库 {kb?.ready ? `已加载 ${kb.chunkCount}` : '未构建'}
          </span>
          <span className={`pill ${settings?.hasApiKey ? '' : 'warn'}`}>
            {settings?.hasApiKey
              ? settings.visionProvider && settings.visionProvider !== settings.provider
                ? `${providerDisplayName(settings.visionProvider)}识图 · ${providerDisplayName(settings.provider)}回答`
                : `${providerDisplayName(settings.provider)} · ${shortModelName(settings.model)}`
              : '未配置 API Key'}
          </span>
          {ladderAlwaysAllow ? (
            <span className="pill" title="点击取消「以后都允许」">
              <button
                type="button"
                className="text-btn"
                style={{ padding: 0, border: 'none', background: 'transparent', color: 'inherit' }}
                onClick={() => persistAlwaysAllow(false)}
              >
                LADDER 打开/导出已记住 · 取消
              </button>
            </span>
          ) : ladderAllowed ? (
            <span className="pill">LADDER-III 已允许</span>
          ) : null}
          <button type="button" className="ghost-btn" onClick={() => setImportDbOpen(true)}>
            知识入库
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setSettingsOpen(true)}
          >
            设置
          </button>
        </div>
      </header>

      <div
        className={[
          'workspace',
          leftCollapsed ? 'left-collapsed' : '',
          rightCollapsed ? 'right-collapsed' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <aside className={`pane left-pane${leftCollapsed ? ' is-collapsed' : ''}`}>
          <div className="pane-rail">
            <button
              type="button"
              className="pane-toggle"
              title={leftCollapsed ? '展开左侧' : '收起左侧'}
              onClick={() => setLeftCollapsed((v) => !v)}
            >
              {leftCollapsed ? '»' : '«'}
            </button>
          </div>
          {!leftCollapsed && (
          <>
          <div className="pane-block">
            <button type="button" className="block-toggle" onClick={() => togglePaneBlock('libs')}>
              <span>资料库</span>
              <span>{paneBlocks.libs ? '收起' : '展开'}</span>
            </button>
            {paneBlocks.libs && (
            <button
              type="button"
              className="lib-trigger"
              onClick={() => setLibraryOpen(true)}
              title="选择接入的资料库"
            >
              <span className="icon-gear" aria-hidden />
              <span className="lib-trigger-text">
                <strong>接入资料库</strong>
                <small title={enabledLibs.map((l) => `${l.brand} · ${l.title}`).join('\n')}>
                  {enabledLibs.length
                    ? `${enabledLibs.length} 项已启用 · ${[...new Set(enabledLibs.map((l) => l.brand))].join(' · ')}`
                    : '未选择'}
                </small>
              </span>
            </button>
            )}
          </div>

          <div className="pane-block mode-block">
            <button type="button" className="block-toggle" onClick={() => togglePaneBlock('mode')}>
              <span>功能选择</span>
              <span>{paneBlocks.mode ? '收起' : '展开'}</span>
            </button>
            {paneBlocks.mode && (
            <>
            <div className="mode-switch" role="tablist" aria-label="Ask 或 Agent">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'ask'}
                className={mode === 'ask' ? 'active' : ''}
                onClick={() => {
                  setMode('ask')
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === activeSessionId ? { ...s, mode: 'ask' } : s,
                    ),
                  )
                }}
              >
                Ask
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'agent'}
                className={mode === 'agent' ? 'active' : ''}
                onClick={() => {
                  setMode('agent')
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === activeSessionId ? { ...s, mode: 'agent' } : s,
                    ),
                  )
                }}
              >
                Agent
              </button>
            </div>
            </>
            )}
          </div>

          <div className="pane-block industrial-nav-block">
            <button
              type="button"
              className="block-toggle"
              onClick={() => togglePaneBlock('industrial')}
            >
              <span>工业工作台</span>
              <span>{paneBlocks.industrial ? '收起' : '展开'}</span>
            </button>
            {paneBlocks.industrial && (
            <>
            <div className="industrial-nav" role="tablist" aria-label="工业工作台导航">
              {(
                [
                  ['chat', '对话'],
                  ['mech', '机械设计'],
                  ['elec', '电气设计'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mainView === id}
                  className={mainView === id ? 'active' : ''}
                  onClick={() => enterChannel(id)}
                >
                  {label}
                </button>
              ))}
              <div className="industrial-nav-group">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mainView === 'lad' || mainView === 'fp'}
                  className={mainView === 'lad' || mainView === 'fp' ? 'active' : ''}
                  onClick={() => enterChannel('lad')}
                >
                  PLC
                </button>
                <div className="industrial-nav-sub" role="group" aria-label="PLC 选项">
                  {(
                    [
                      ['lad', 'Ladder'],
                      ['fp', 'PICTURE'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={mainView === id}
                      className={mainView === id ? 'active' : ''}
                      onClick={() => enterChannel(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                role="tab"
                aria-selected={mainView === 'cam'}
                className={mainView === 'cam' ? 'active' : ''}
                onClick={() => enterChannel('cam')}
              >
                加工
              </button>
            </div>
            </>
            )}
          </div>

          <div className="pane-block read-block">
            <button type="button" className="block-toggle" onClick={() => togglePaneBlock('read')}>
              <span>阅读文件</span>
              <span>{paneBlocks.read ? '收起' : '展开'}</span>
            </button>
            {paneBlocks.read && (
            <>
            <button
              type="button"
              className="lib-trigger"
              onClick={() => void pickLocalFiles('editor')}
              title="打开桌面或其他本机文件到右侧阅读"
            >
              <span className="lib-trigger-text">
                <strong>打开并阅读</strong>
              </span>
            </button>
            <button
              type="button"
              className="ghost-btn read-attach-btn"
              disabled={!activeFile || !fileContent}
              onClick={attachActiveToChat}
            >
              当前文件加入对话
            </button>
            {recentFiles.length > 0 && (
              <ul className="recent-files">
                {recentFiles.slice(0, 8).map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      className="recent-file-btn"
                      title={r.path}
                      onClick={() => void reopenRecent(r)}
                    >
                      <span className="recent-name">{r.name}</span>
                      <span className="recent-path">{r.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </>
            )}
          </div>

          <div className="pane-block history-block">
            <div className="block-label-row">
              <button
                type="button"
                className="block-toggle inline"
                onClick={() => togglePaneBlock('history')}
              >
                <span>{CHANNEL[mainView].history}</span>
                <span>{paneBlocks.history ? '收起' : '展开'}</span>
              </button>
              {paneBlocks.history && (
              <div className="header-actions">
                <button
                  type="button"
                  className="text-btn"
                  disabled={!canUndoTurn()}
                  onClick={() => void undoLastTurn()}
                  title="撤回上一轮对话，并恢复本回合改过的文件"
                >
                  撤回
                </button>
                <button
                  type="button"
                  className="text-btn"
                  disabled={sending || !activeSessionId}
                  onClick={clearCurrentChat}
                  title="清空当前对话记忆，不删会话条目"
                >
                  清空
                </button>
                <button
                  type="button"
                  className="text-btn"
                  disabled={sending}
                  onClick={startNewChat}
                  title="开新对话，不带入上一对话历史"
                >
                  + 新建
                </button>
              </div>
              )}
            </div>
            {paneBlocks.history && (
            <ul className="session-list">
              {visibleSessions.map((session) => (
                <li key={session.id} className="session-row">
                  <button
                    type="button"
                    className={
                      session.id === activeSessionId ? 'session active' : 'session'
                    }
                    onClick={() => selectSession(session)}
                  >
                    <span className="session-title">{session.title}</span>
                    <span className="session-meta">
                      <em>{session.mode === 'ask' ? 'Ask' : 'Agent'}</em>
                      {session.updatedAt}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="session-del"
                    title="删除此对话"
                    disabled={sending && session.id === activeSessionId}
                    onClick={(ev) => deleteSession(session.id, ev)}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
            )}
          </div>
          </>
          )}
        </aside>

        <main className="pane center-pane">
          <>
          <div className="chat-header">
            <h1>{mainView === 'chat' ? (activeSession?.title ?? '回答显示区') : CHANNEL[mainView].title}</h1>
            <div className="chat-header-actions">
              {mainView === 'lad' || mainView === 'fp' ? (
                <>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => setPlcExplainOpen(true)}
                  >
                    说明
                  </button>
                  {mainView === 'lad' ? (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setPlcHelpOpen(true)}
                    >
                      Ladder 助手
                    </button>
                  ) : null}
                </>
              ) : null}
            <button
              type="button"
              className="ghost-btn"
              disabled={!canUndoTurn()}
              onClick={() => void undoLastTurn()}
            >
              撤回上一轮
            </button>
            </div>
          </div>

          <div className="answer-area" aria-label="回答显示区" ref={answerRef}>
            {messages.map((msg) => (
              <article key={msg.id} className={`msg msg-${msg.role}`}>
                <div className="msg-role">
                  {msg.role === 'user'
                    ? '你'
                    : msg.role === 'system'
                      ? '系统'
                      : 'SAMA'}
                </div>
                <MessageBody
                  msg={msg}
                  onOpenPath={(p) => void openGeneratedPath(p)}
                  fallbackLadPath={resolveCurrentLadPath()}
                  allowCardActive={Boolean(allowReq)}
                  allowQueueLen={allowQueue.length}
                  allowSettled={
                    settledAllowTick >= 0 && settledAllowMsgIdsRef.current.has(msg.id)
                  }
                  completedAllowKinds={[
                    ...(completedAllowKindsRef.current.get(msg.id) || []),
                  ]}
                  showGcodeFileButton={mainView === 'cam'}
                  onSaveGcodeFile={
                    mainView === 'cam' ? (nc) => saveGcodeFromAnswer(nc, msg.id) : undefined
                  }
                  onAskAboutSource={(src) => {
                    setCiteFollowUps((prev) => {
                      if (prev.some((p) => p.n === src.n && p.source === src.source)) return prev
                      return [...prev, src].slice(-4)
                    })
                    setFileStatus(`已加入追问引用 [${src.n}] ${src.title || src.source}`)
                    window.requestAnimationFrame(() => {
                      document.querySelector<HTMLTextAreaElement>('.input-area textarea')?.focus()
                    })
                  }}
                />
              </article>
            ))}
            {sending && (
              <article className="msg msg-system">
                <div className="msg-role">系统</div>
                <div className="msg-body">
                  <p>模型生成中…</p>
                </div>
              </article>
            )}
          </div>

          <div
            className="input-area"
            aria-label="输入区"
            onDragOver={onDragOver}
            onDrop={(e) => void onDropChat(e)}
          >
            <div className="input-toolbar">
              {mainView === 'cam' ? (
                <>
                  <input
                    className="cam-machine-input"
                    value={camMachine}
                    onChange={(e) => setCamMachine(e.target.value)}
                    placeholder="机床型号，如 STUDER S40 / 高桥 FANUC / MIKROSA SASL32"
                    disabled={sending}
                  />
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void pickLocalFiles('attach')}
                  >
                    打开图纸/NC
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={sending || allowBusy}
                    onClick={() => runCamFromDrawing()}
                  >
                    看图出码
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={sending || allowBusy}
                    onClick={() => runCamReadCode()}
                  >
                    看码识件
                  </button>
                  <span className="input-tip">先填机床型号 · 拖入图纸或程序</span>
                </>
              ) : mainView === 'elec' ? (
                <>
                  <input
                    className="cam-machine-input"
                    value={camMachine}
                    onChange={(e) => setCamMachine(e.target.value)}
                    placeholder="机床型号，如 MIKROSA SASL32 / FAVRETTO MC160"
                    disabled={sending}
                  />
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void pickLocalFiles('attach')}
                  >
                    打开图纸
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={sending || allowBusy}
                    onClick={() => void runElecReadDrawing()}
                  >
                    看图读图
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={sending || allowBusy}
                    onClick={() => void runElecGenerate()}
                  >
                    导出连通性
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={sending || allowBusy}
                    onClick={() => void runElecDrawDiagram()}
                  >
                    连通性出图
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={sending || allowBusy}
                    onClick={() => void runEplanOpenReference()}
                  >
                    EPLAN 对照原图
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={sending}
                    onClick={() => void runEplanBind()}
                  >
                    绑定 EPLAN
                  </button>
                  {eplanChip ? <span className="eplan-chip">{eplanChip}</span> : null}
                  <span className="input-tip">示意 SVG ≠ EPLAN 原图 · 对照请开 EPLAN</span>
                </>
              ) : mainView === 'fp' || mainView === 'lad' ? (
                <>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void pickLocalFiles('attach')}
                  >
                    {CHANNEL[mainView].attachLabel}
                  </button>
                  <span className="input-tip">
                    {mainView === 'fp' ? '只写 .fp2 / 画面 XML' : '只改 .LAD · 要点允许'}
                  </span>
                </>
              ) : mainView !== 'chat' ? (
                <>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void pickLocalFiles('attach')}
                  >
                    {CHANNEL[mainView].attachLabel}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void generateSampleInChat()}
                  >
                    生成样例
                  </button>
                  <span className="input-tip">拖入文件 · Enter 发送</span>
                </>
              ) : (
                <>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => imageInputRef.current?.click()}
              >
                图片
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setImportDbOpen(true)}
              >
                知识入库
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void pickLocalFiles('attach')}
              >
                本机文件
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void pickLocalFolder()}
              >
                本机文件夹
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                浏览器选文件
              </button>
              <span className="input-tip">拖入文件或文件夹 · Enter 发送 · Shift+Enter 换行</span>
                </>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const list = e.target.files
                  if (list?.length) void handleDroppedFiles(list, false)
                  e.target.value = ''
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const list = e.target.files
                  if (list?.length) void handleDroppedFiles(list, false)
                  e.target.value = ''
                }}
              />
            </div>
            {citeFollowUps.length > 0 && (
              <div className="cite-follow-bar" aria-label="追问引用">
                <span className="cite-follow-label">追问引用</span>
                <ul className="cite-follow-list">
                  {citeFollowUps.map((s) => (
                    <li key={`fu-${s.n}-${s.source}`}>
                      <span>
                        [{s.n}] {s.title || s.source}
                      </span>
                      <button
                        type="button"
                        className="text-btn"
                        title="移除"
                        onClick={() =>
                          setCiteFollowUps((prev) =>
                            prev.filter((x) => !(x.n === s.n && x.source === s.source)),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setCiteFollowUps([])}
                >
                  清空
                </button>
              </div>
            )}
            {attachments.length > 0 && (
              <ul className="attach-list">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <span title={a.path || a.name}>
                      {a.kind === 'image' ? '图 · ' : ''}
                      {a.name}
                    </span>
                    {mainView === 'lad' &&
                    (a.lad || /\.lad$/i.test(a.name || a.path || '')) &&
                    a.path ? (
                      <button
                        type="button"
                        className="text-btn"
                        disabled={allowBusy}
                        onClick={() => void requestOpenLadder(a.path!)}
                      >
                        {ladderAllowed ? '打开 LADDER-III' : '请求打开 LADDER-III'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                      }
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {allowReq &&
            ladderAlwaysAllow &&
            allowReq.kind !== 'edit-lad' &&
            allowReq.kind !== 'generate-lad' ? (
              <div className="allow-auto-strip" role="status">
                打开/导出已记住 · 正在执行：{allowReq.title}
                {allowBusy ? '…' : ''}
              </div>
            ) : null}
            {allowReq &&
            (!ladderAlwaysAllow ||
              allowReq.kind === 'edit-lad' ||
              allowReq.kind === 'generate-lad') ? (
              <AllowActionCard
                request={allowReq}
                busy={allowBusy}
                collapsed={allowCollapsed}
                onCollapse={() => setAllowCollapsed(true)}
                onExpand={() => setAllowCollapsed(false)}
                onDeny={handleDenyAllowQueue}
                onDismiss={handleDenyAllowQueue}
                onAllow={(choice) => void handleAllowCurrent(choice)}
              />
            ) : null}
            {(() => {
              const ladPath = resolveOpsLadPath()
              // 有待允许项时不叠操作条；Ladder 以外的页不出现梯子操作条
              if (mainView !== 'lad' || !ladPath || allowReq) return null
              return (
                <LadderOpsBar
                  ladPath={ladPath}
                  allowed={ladderAllowed || ladderAlwaysAllow}
                  busy={allowBusy}
                  onRequestAllow={() => void requestOpenLadder(ladPath)}
                  onOpenGui={() => void requestOpenLadder(ladPath)}
                  onExportOnly={() => void exportMnemonicOnly(ladPath)}
                  onExportAnalyze={() => void runAllowAnalyzePipeline(ladPath, true)}
                  onEditProposal={() => void approveEditProposal(ladPath)}
                  onDismiss={dismissCurrentLadOps}
                />
              )
            })()}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                allowBusy
                  ? '正在写入 LAD，请稍候…'
                  : mainView !== 'chat'
                    ? CHANNEL[mainView].placeholder
                    : mode === 'ask'
                    ? CHANNEL.chat.placeholder
                    : '描述任务，或拖入本机文件（含 .lad 梯子）后让我改到工程沙箱'
              }
              rows={3}
              disabled={sending || allowBusy}
            />
            <button
              type="button"
              className="send-btn composer-send-btn"
              onClick={() => void sendMessage()}
              disabled={(!input.trim() && attachments.length === 0) || sending || allowBusy}
              title={allowBusy ? '正在写入 LAD，请等完成后再发' : undefined}
            >
              {sending || allowBusy ? '…' : '发送'}
            </button>
          </div>
          </>
        </main>

        <aside
          className={`pane right-pane${rightCollapsed ? ' is-collapsed' : ''}`}
        >
          <div className="pane-rail right">
            <button
              type="button"
              className="pane-toggle"
              title={rightCollapsed ? '展开右侧' : '收起右侧'}
              onClick={() => setRightCollapsed((v) => !v)}
            >
              {rightCollapsed ? '«' : '»'}
            </button>
          </div>
          {!rightCollapsed && (
          <div className="pane-body">
          <section
            className="file-open"
            aria-label="文件打开区"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={(e) => void onDropEditor(e)}
          >
            <div className="block-label-row">
              <button
                type="button"
                className="block-toggle inline"
                onClick={() => togglePaneBlock('fileOpen')}
              >
                <span>{fileExternal ? '阅读本机文件' : '文件打开区'}</span>
                <span>{paneBlocks.fileOpen ? '收起' : '展开'}</span>
              </button>
            </div>
            {paneBlocks.fileOpen && (
            <>
            <div className="file-open-header">
              <div className="file-name" title={displayPath}>
                {displayPath || '未打开'}
              </div>
              {activeFile && (
                <div className="file-meta">
                  {fileExternal ? '本机' : '工程'}
                  {showAnnotated ? ' · 注释视图' : ''} · {lineCount} 行 · {fileContent.length} 字符
                  {fileDirty ? ' · 未保存' : ''}
                </div>
              )}
            <div className="editor-toolbar">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={!activeFile}
                  onClick={closeActiveFile}
                  title="关闭当前阅读的文件"
                >
                  关闭
                </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={!activeFile || fileSaving || !fileDirty}
                onClick={() => void saveActiveFile()}
              >
                {fileSaving ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                className="ghost-btn"
                  onClick={() => void pickLocalFiles('editor')}
                >
                  阅读文件
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={!activeFile || !fileContent}
                  onClick={attachActiveToChat}
                >
                  加入对话
                </button>
                {fileExternal && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => void importActiveExternal()}
                  >
                    导入到工程
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => void refreshTreeAndMaybeOpen(fileExternal ? undefined : activeFile)}
              >
                刷新
              </button>
              </div>
              <div className="editor-toolbar secondary">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void samaClient.openWorkspace()}
              >
                打开工程目录
              </button>
                {gcodeActive && (
                  <>
                    <div className="view-switch" role="tablist" aria-label="代码或刀路">
                      <button
                        type="button"
                        role="tab"
                        className={editorView === 'code' ? 'active' : ''}
                        aria-selected={editorView === 'code'}
                        onClick={() => setEditorView('code')}
                      >
                        代码
                      </button>
                      <button
                        type="button"
                        role="tab"
                        className={editorView === 'toolpath' ? 'active' : ''}
                        aria-selected={editorView === 'toolpath'}
                        onClick={() => setEditorView('toolpath')}
                      >
                        刀路
                      </button>
            </div>
                    <div className="view-switch" role="tablist" aria-label="原文或注释">
                      <button
                        type="button"
                        role="tab"
                        className={!showAnnotated ? 'active' : ''}
                        aria-selected={!showAnnotated}
                        onClick={() => toggleNcAnnotateView('original')}
                      >
                        原文
                      </button>
                      <button
                        type="button"
                        role="tab"
                        className={showAnnotated ? 'active' : ''}
                        aria-selected={showAnnotated}
                        disabled={fileSaving}
                        title={ncAnnotated ? '切换到注释视图' : '生成中文行注释（不新建文件）'}
                        onClick={() => toggleNcAnnotateView('annotated')}
                      >
                        注释
                      </button>
                    </div>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={fileSaving || !(ncBase || fileContent).trim()}
                      title="按原文重新生成注释视图（不改目录文件名）"
                      onClick={() => void createAnnotatedGcodeCopy()}
                    >
                      {ncAnnotated ? '刷新注释' : '生成注释'}
                    </button>
                  </>
                )}
              </div>
              {fileStatus && !/^\s*(工程文件|正在阅读|本机)/.test(fileStatus) && (
                <div className="file-status-line">{fileStatus}</div>
              )}
            </div>
            {editorView === 'toolpath' && gcodeActive ? (
              <ToolpathPanel
                path={activeFile.replace(/^external:/, '')}
                content={gcodeSource}
              />
            ) : (
            <textarea
              className="editor editable"
              spellCheck={false}
              value={fileContent}
              onChange={(e) => {
                  const v = e.target.value
                  setFileContent(v)
                  if (showAnnotated) {
                    setNcAnnotated(v)
                    setFileStatus('注释视图已改 · 保存仍写原文')
                  } else {
                    setNcBase(v)
                    setNcAnnotated(null)
                setFileDirty(true)
                setFileStatus('')
                  }
              }}
                placeholder="拖入 G 代码可直接看刀路；也可点左侧「打开并阅读」"
            />
            )}
            </>
            )}
          </section>
          <section
            className="file-dir"
            aria-label="文件目录区"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={(e) => void onDropDirBrowse(e)}
          >
            <button
              type="button"
              className="block-toggle"
              onClick={() => togglePaneBlock('fileDir')}
            >
              <span>{browseRoot ? `本机目录 · ${browseName}` : '工程沙箱目录'}</span>
              <span>{paneBlocks.fileDir ? '收起' : '展开'}</span>
            </button>
            {paneBlocks.fileDir && (
            <>
            {!browseRoot && (
              <div className="editor-toolbar secondary">
                <button type="button" className="ghost-btn" onClick={() => void createSamaFolder()}>
                  新建文件夹
                </button>
                <button type="button" className="ghost-btn" onClick={() => void createSamaFile()}>
                  新建文件
                </button>
                <button type="button" className="ghost-btn" onClick={() => void openSamaLibrary()}>
                  打开SAMA文件
                </button>
              </div>
            )}
            {browseRoot && (
              <div className="editor-toolbar secondary">
                <button type="button" className="ghost-btn" onClick={() => void backToSandboxTree()}>
                  返回工程沙箱
                </button>
                <button type="button" className="ghost-btn" onClick={() => void refreshTreeOnly()}>
                  刷新目录
                </button>
              </div>
            )}
            <FileTree
              nodes={visibleTree}
              expanded={expanded}
              activeFile={browseRoot ? browseActiveRel : fileExternal ? '' : activeFile}
              onToggle={toggleFolder}
              onOpen={(p) => void openTreeFile(p)}
            />
            </>
            )}
          </section>
          </div>
          )}
        </aside>
      </div>

      {libraryOpen && (
        <LibraryPicker
          libraries={libraries}
          onToggle={toggleLibrary}
          onClose={() => setLibraryOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={(s, k) => {
            setSettings(s)
            setKb(k)
          }}
        />
      )}

      {importDbOpen && (
        <ImportDbModal
          onClose={() => setImportDbOpen(false)}
          onImported={(k, note) => {
            if (k) setKb(k)
            setFileStatus(note)
          }}
        />
      )}

      {plcHelpOpen ? (
        <PlcHelpModal
          onClose={() => setPlcHelpOpen(false)}
          onBound={() => setFileStatus('已绑定 LADDER-III')}
        />
      ) : null}
      {plcExplainOpen ? (
        <PlcExplainModal
          page={mainView === 'fp' ? 'fp' : 'lad'}
          onClose={() => setPlcExplainOpen(false)}
          onOpenHelper={() => setPlcHelpOpen(true)}
        />
      ) : null}
    </div>
  )
}

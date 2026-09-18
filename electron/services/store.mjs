import {
  getKbIndexPath,
  getKbManifestPath,
  getKbRoot,
  getLibrariesPath,
  getSessionsPath,
  getSessionMessagesPath,
  getSessionsDir,
  getSettingsPath,
  readJson,
  writeJson,
  ensureDir,
} from './paths.mjs'
import { installBundledMtkb, loadMtkbStatus, searchMtkbSqlite } from './mtkb.mjs'
import fs from 'node:fs'
import path from 'node:path'

const PROVIDER_DEFAULTS = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
  },
  grok: {
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4-1-fast-non-reasoning',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
}

const DEFAULT_SETTINGS = {
  provider: 'groq',
  apiKey: '',
  apiKeys: {},
  model: 'llama-3.3-70b-versatile',
  baseUrl: 'https://api.groq.com/openai/v1',
  /** 空 = 与回答同一家。可设 qwen，实现「千问识图 + DeepSeek 回答」 */
  visionProvider: '',
  visionModel: '',
  /** FANUC LADDER-III：fladder.exe 完整路径或安装目录 */
  fladderPath: '',
  /** EPLAN Electric P8：W3u.exe 完整路径或安装目录 */
  eplanPath: '',
  /** 外部工业软件 exe：{ 'cad.null': 'C:\\...\\SLDWORKS.exe', ... } */
  softwarePaths: {},
  pinHash: '',
  pinSalt: '',
  authEnabled: false,
}

function migrateApiKeys(s) {
  const apiKeys = { ...(s.apiKeys && typeof s.apiKeys === 'object' ? s.apiKeys : {}) }
  const provider = s.provider || 'groq'
  if (s.apiKey && !apiKeys[provider]) apiKeys[provider] = s.apiKey
  return { ...s, apiKeys }
}

export function loadSettings() {
  return migrateApiKeys({ ...DEFAULT_SETTINGS, ...readJson(getSettingsPath(), {}) })
}

export function getApiKeyFor(providerId, settings = loadSettings()) {
  const id = String(providerId || settings.provider || 'groq').toLowerCase()
  const keys = settings.apiKeys && typeof settings.apiKeys === 'object' ? settings.apiKeys : {}
  const mapped = String(keys[id] || '').trim()
  if (mapped) return mapped
  if (id === String(settings.provider || 'groq').toLowerCase()) {
    return String(settings.apiKey || '').trim()
  }
  return ''
}

/** 内部写 settings（含 PIN 字段），不经公开掩码 */
export function saveSettingsRaw(partial) {
  const next = { ...loadSettings(), ...partial }
  writeJson(getSettingsPath(), next)
  return next
}

export function saveSettings(partial) {
  const prev = loadSettings()
  const incoming = { ...partial }
  const visionApiKey =
    typeof incoming.visionApiKey === 'string' ? incoming.visionApiKey.trim() : ''
  delete incoming.visionApiKey
  delete incoming.apiKeys

  const next = { ...prev, ...incoming }
  next.apiKeys = { ...(prev.apiKeys && typeof prev.apiKeys === 'object' ? prev.apiKeys : {}) }

  if (incoming.provider && !incoming.baseUrl) {
    const defaults = PROVIDER_DEFAULTS[incoming.provider]
    if (defaults) {
      next.baseUrl = defaults.baseUrl
      if (!incoming.model) next.model = defaults.model
    }
  }

  if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) {
    const p = incoming.provider || next.provider || 'groq'
    next.apiKey = incoming.apiKey.trim()
    next.apiKeys[p] = next.apiKey
  } else if (incoming.provider && incoming.provider !== prev.provider) {
    next.apiKey = String(next.apiKeys[incoming.provider] || '')
  }

  if (visionApiKey) {
    const vp = String(incoming.visionProvider || next.visionProvider || '').trim()
    if (vp) next.apiKeys[vp] = visionApiKey
  }

  if (incoming.visionProvider === '') {
    next.visionProvider = ''
    next.visionModel = ''
  } else if (incoming.visionProvider && !incoming.visionModel) {
    const defaults = PROVIDER_DEFAULTS[incoming.visionProvider]
    if (defaults) next.visionModel = defaults.model
    if (incoming.visionProvider === 'qwen') next.visionModel = 'qwen-vl-max'
  }

  delete next.pinHash
  delete next.pinSalt
  next.pinHash = prev.pinHash
  next.pinSalt = prev.pinSalt
  next.authEnabled = Boolean(prev.pinHash && prev.pinSalt)

  writeJson(getSettingsPath(), next)
  return publicSettingsFrom(next)
}

function publicSettingsFrom(s) {
  const provider = s.provider || 'groq'
  const visionProvider = s.visionProvider || ''
  const chatKey = getApiKeyFor(provider, s)
  const visionKey = getApiKeyFor(visionProvider || provider, s)
  const hasProviderKey = {}
  for (const id of Object.keys(PROVIDER_DEFAULTS)) {
    hasProviderKey[id] = Boolean(getApiKeyFor(id, s))
  }
  return {
    provider,
    model: s.model,
    baseUrl: s.baseUrl,
    apiKey: chatKey ? maskKey(chatKey) : '',
    hasApiKey: Boolean(chatKey),
    visionProvider,
    visionModel: s.visionModel || '',
    visionApiKey: visionKey ? maskKey(visionKey) : '',
    hasVisionApiKey: Boolean(visionKey),
    hasProviderKey,
    dataRoot: path.dirname(getSettingsPath()),
    fladderPath: s.fladderPath || '',
    eplanPath: s.eplanPath || '',
    authEnabled: Boolean(s.pinHash && s.pinSalt),
  }
}

export function getPublicSettings() {
  return publicSettingsFrom(loadSettings())
}

function maskKey(key) {
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

export function loadSessions() {
  const raw = readJson(getSessionsPath(), { sessions: [], activeSessionId: '' })
  const sessions = Array.isArray(raw.sessions) ? raw.sessions : []
  const activeSessionId = raw.activeSessionId || ''
  let messagesBySession = {}

  // 旧格式：全量嵌在 sessions.json
  if (raw.messagesBySession && typeof raw.messagesBySession === 'object') {
    messagesBySession = raw.messagesBySession
    migrateSessionsSplit(sessions, activeSessionId, messagesBySession)
  } else {
    for (const s of sessions) {
      const id = s?.id
      if (!id) continue
      const file = readJson(getSessionMessagesPath(id), null)
      messagesBySession[id] = Array.isArray(file?.messages) ? file.messages : []
    }
  }

  return { sessions, activeSessionId, messagesBySession }
}

function migrateSessionsSplit(sessions, activeSessionId, messagesBySession) {
  ensureDir(getSessionsDir())
  for (const s of sessions) {
    const id = s?.id
    if (!id) continue
    writeJson(getSessionMessagesPath(id), {
      messages: messagesBySession[id] || [],
    })
  }
  writeJson(getSessionsPath(), { sessions, activeSessionId })
}

export function saveSessions(payload) {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : []
  const activeSessionId = payload?.activeSessionId || ''
  const messagesBySession =
    payload?.messagesBySession && typeof payload.messagesBySession === 'object'
      ? payload.messagesBySession
      : {}

  ensureDir(getSessionsDir())
  writeJson(getSessionsPath(), { sessions, activeSessionId })

  const keep = new Set(sessions.map((s) => s?.id).filter(Boolean))
  for (const id of keep) {
    writeJson(getSessionMessagesPath(id), {
      messages: messagesBySession[id] || [],
    })
  }

  // 删除已不存在的会话文件
  try {
    for (const name of fs.readdirSync(getSessionsDir())) {
      if (!name.endsWith('.json')) continue
      const id = name.replace(/\.json$/i, '')
      if (!keep.has(id)) {
        try {
          fs.unlinkSync(path.join(getSessionsDir(), name))
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  return { ok: true }
}

export function loadLibrariesState(defaults) {
  const saved = readJson(getLibrariesPath(), null)
  if (!saved?.libraries) return { libraries: defaults }
  return saved
}

export function saveLibrariesState(payload) {
  writeJson(getLibrariesPath(), payload)
  return { ok: true }
}

export function loadKbStatus() {
  const manifest = readJson(getKbManifestPath(), {
    ready: false,
    docCount: 0,
    chunkCount: 0,
    updatedAt: null,
    brands: [],
    note: '尚未构建知识库',
    docsFingerprint: '',
  })
  const index = readJson(getKbIndexPath(), { chunks: [] })
  const mtkb = loadMtkbStatus()
  const ready = Boolean(manifest.ready && index.chunks?.length) || mtkb.sqliteReady
  const notes = [manifest.note, mtkb.available ? mtkb.note : ''].filter(Boolean)
  return {
    ...manifest,
    ready,
    chunkCount: index.chunks?.length || 0,
    dataRoot: getKbRoot(),
    mtkb,
    note: notes.join(' · '),
  }
}

function docsFingerprint(files) {
  const parts = files.map((f) => {
    const st = fs.statSync(f)
    const rel = path.relative(getKbRoot(), f).split(path.sep).join('/')
    return `${rel}:${st.size}:${Math.round(st.mtimeMs)}`
  })
  parts.sort()
  return parts.join('|')
}

/**
 * 启动用：资料未变化则直接加载持久化索引（不重学、不丢记忆）。
 * force=true 时强制重建（设置页「构建/更新」）。
 */
export function ensureKnowledgeBase({ force = false } = {}) {
  const docsDir = path.join(getKbRoot(), 'docs')
  ensureDir(docsDir)
  const bundled = installBundledMtkb(docsDir)
  ensureKbSeedDocs(docsDir)

  const files = listTextFiles(docsDir)
  const fingerprint = docsFingerprint(files)
  const manifest = readJson(getKbManifestPath(), {})
  const index = readJson(getKbIndexPath(), { chunks: [] })

  if (
    !force &&
    manifest.ready &&
    manifest.docsFingerprint === fingerprint &&
    Array.isArray(index.chunks) &&
    index.chunks.length > 0
  ) {
    const status = loadKbStatus()
    return {
      ...status,
      skipped: true,
      note: '资料未变化，已直接加载持久化知识库（未重新学习）',
    }
  }

  const result = rebuildKnowledgeBase({ fingerprint, files })
  return bundled.installed
    ? {
        ...result,
        note: `MTKB 已自动接入：${bundled.documents} 份文档；${result.note}`,
      }
    : result
}

function ensureKbSeedDocs(docsDir) {
  const readme = path.join(docsDir, 'README.md')
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      `# SAMA 知识库

放入 .md/.txt/.pdf 抽取文本后构建索引。资料未改时启动只加载，不重学。
`,
      'utf8',
    )
  }
}

/** 简易关键词索引：切块后持久化到 index.json */
export function rebuildKnowledgeBase(opts = {}) {
  const docsDir = path.join(getKbRoot(), 'docs')
  ensureDir(docsDir)
  ensureKbSeedDocs(docsDir)

  const files = opts.files || listTextFiles(docsDir)
  const fingerprint = opts.fingerprint || docsFingerprint(files)
  const chunks = []

  for (const file of files) {
    const rel = path.relative(docsDir, file).split(path.sep).join('/')
    const brand = rel.includes('/') ? rel.split('/')[0] : '通用'
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const parts = chunkText(text, 800, 120)
    parts.forEach((content, i) => {
      chunks.push({
        id: `${rel}#${i}`,
        brand,
        source: rel,
        content,
      })
    })
  }

  writeJson(getKbIndexPath(), { version: 1, chunks, docsFingerprint: fingerprint })
  clearKbChunksCache()
  const brands = [...new Set(chunks.map((c) => c.brand))]
  const manifest = {
    ready: chunks.length > 0,
    docCount: files.length,
    chunkCount: chunks.length,
    updatedAt: new Date().toISOString(),
    brands,
    docsFingerprint: fingerprint,
    note: chunks.length
      ? '知识库已就绪：资料未改时启动直接加载，不会每次重学'
      : 'docs 目录暂无有效文本，请放入说明书后再构建',
  }
  writeJson(getKbManifestPath(), manifest)
  return loadKbStatus()
}

export function searchKnowledge(query, enabledBrands = [], limit = 4) {
  if (!String(query || '').trim()) return []

  const terms = tokenize(query)
  const brandSet = new Set(enabledBrands.filter(Boolean))
  const chunks = getKbChunksCached()

  const textHits = chunks.length
    ? chunks
        .filter((c) => !brandSet.size || brandSet.has(c.brand) || c.brand === '通用')
        .map((c) => {
          const hay = c.content.toLowerCase()
          let score = 0
          for (const t of terms) {
            if (!t) continue
            if (hay.includes(t)) score += t.length > 1 ? 2 : 1
          }
          const src = String(c.source).toLowerCase()
          for (const t of terms) {
            if (src.includes(t)) score += 1.5
          }
          return { ...c, score }
        })
        .filter((c) => c.score > 0)
    : []

  // SQLite 命中通常更完整；给库检索略高权重后与 Markdown 索引合并
  const dbHits = searchMtkbSqlite(query, { limit: Math.max(limit, 6) }).map((h) => ({
    ...h,
    score: (h.score || 0) + 2,
  }))

  const merged = [...dbHits, ...textHits]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return merged.map(({ id, brand, source, content, score }) => ({
    id,
    brand,
    source,
    content,
    score,
  }))
}

let kbChunksCache = null
let kbChunksCacheMtime = 0

function getKbChunksCached() {
  try {
    const indexPath = getKbIndexPath()
    if (!fs.existsSync(indexPath)) {
      kbChunksCache = []
      return kbChunksCache
    }
    const mtime = fs.statSync(indexPath).mtimeMs
    if (kbChunksCache && kbChunksCacheMtime === mtime) return kbChunksCache
    const index = readJson(indexPath, { chunks: [] })
    kbChunksCache = index.chunks || []
    kbChunksCacheMtime = mtime
    return kbChunksCache
  } catch {
    return []
  }
}

export function clearKbChunksCache() {
  kbChunksCache = null
  kbChunksCacheMtime = 0
}

function listTextFiles(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    if (name === '_raw' || name === '_export-stage' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...listTextFiles(full))
    else if (/\.(md|txt|nc|xml)$/i.test(name)) out.push(full)
  }
  return out
}

function chunkText(text, size, overlap) {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const parts = []
  let i = 0
  while (i < clean.length) {
    parts.push(clean.slice(i, i + size))
    i += Math.max(1, size - overlap)
  }
  return parts
}

function tokenize(q) {
  return q
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff#+.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1)
}

import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, getDataRoot } from './paths.mjs'
import {
  ALLOWED_EXT,
  MAX_BYTES,
  assertAllowedExt,
  assertAllowedUserAbs,
  deny,
  detectTextEncoding,
  looksAbsolute,
  looksLikeFakeFanucPicture,
  normalizeAbs,
  readTextFile,
  writeTextFile,
} from './safeFs.mjs'
import { GCODE_SAMPLE_FILES } from './gcodeSamples.mjs'
import {
  ensureLibraryFolders,
  rewriteToLibraryRel,
  syncLibraryDirToDesktop,
  syncLibraryFileToDesktop,
} from './samaLibrary.mjs'

/** Windows / 系统敏感路径前缀（绝对路径一旦命中一律拒绝） */
const BLOCKED_ABS_PREFIXES = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
  'C:\\Recovery',
  'C:\\Boot',
  'C:\\Users\\Default',
]

export function getWorkspaceRoot() {
  const root = path.join(getDataRoot(), 'workspace')
  ensureDir(root)
  return root
}

/** 同步内置 G-code 案例到用户 workspace（覆盖同名演示文件） */
function ensureDemoGcode() {
  for (const [rel, content] of Object.entries(GCODE_SAMPLE_FILES)) {
    try {
      const abs = safeResolve(rel)
      ensureDir(path.dirname(abs))
      fs.writeFileSync(abs, content, 'utf8')
    } catch {
      // 忽略补种失败，不影响主流程
    }
  }
}

export function ensureWorkspaceSeed() {
  const root = getWorkspaceRoot()
  // 每次启动同步刀路演示样例，保证左侧可打开查看
  ensureDemoGcode()
  const marker = path.join(root, '.sama-workspace.json')
  if (fs.existsSync(marker)) {
    try {
      ensureLibraryFolders()
    } catch {
      // 分类库失败不影响沙箱
    }
    return { root, seeded: false }
  }

  const files = {
    'projects/studer-step/step_param.xml': `<!-- FANUC PICTURE · 台阶参数示例 -->
<FPInput>
  <FocusIndex>1</FocusIndex>
  <Read>rdmacro(501, 99, 0)</Read>
  <Write>wrmacro(501, 0, 0, 99, 0)</Write>
  <WatchPMC>D2950</WatchPMC>
</FPInput>
`,
    'projects/studer-step/macro_common.nc': `O9001 (COMMON MACRO)
#501 = 0
#502 = 0
M99
`,
    'projects/studer-step/notes.md': `# Studer 台阶参数

- 焦点索引同屏不可重复
- 公共变量注意选项范围
`,
    'libraries/FANUC_31i/README.md': `# FANUC 31i 占位

可将相关摘录放在本目录。
`,
    'libraries/FANUC_PICTURE/README.md': `# FANUC PICTURE 占位

可将相关摘录放在本目录。
`,
  }

  for (const [rel, content] of Object.entries(files)) {
    const abs = safeResolve(rel)
    ensureDir(path.dirname(abs))
    fs.writeFileSync(abs, content, 'utf8')
  }

  fs.writeFileSync(
    marker,
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        note: 'Agent 只能读写本 workspace 目录，禁止删除与越权访问系统文件',
      },
      null,
      2,
    ),
    'utf8',
  )

  try {
    ensureLibraryFolders()
  } catch {
    // 分类库失败不影响沙箱
  }

  return { root, seeded: true }
}

/**
 * 将相对路径解析到 workspace 内；越权则抛错。
 * @returns {string} absolute path
 */
export function safeResolve(relPath) {
  const root = path.resolve(getWorkspaceRoot())
  if (relPath == null || String(relPath).trim() === '') {
    throw deny('路径为空')
  }

  let raw = String(relPath).trim().replace(/\//g, path.sep)
  // 禁止绝对路径直接传入
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    throw deny(`禁止使用绝对路径: ${relPath}`)
  }
  if (raw.includes('\0')) throw deny('非法路径')
  if (/(^|[\\/])\.\.([\\/]|$)/.test(raw)) throw deny('禁止路径穿越 (..)')

  // 规范化后必须仍在 root 下
  const abs = path.resolve(root, raw)
  const relToRoot = path.relative(root, abs)
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw deny(`路径越出工程沙箱: ${relPath}`)
  }

  // 双保险：绝对路径不得落在系统目录
  const absNorm = abs.toUpperCase()
  for (const prefix of BLOCKED_ABS_PREFIXES) {
    if (absNorm.startsWith(prefix.toUpperCase())) {
      throw deny(`禁止访问系统目录: ${prefix}`)
    }
  }

  // 禁止操作沙箱标记与备份目录外的隐藏系统级文件名
  const base = path.basename(abs).toLowerCase()
  if (['desktop.ini', 'thumbs.db', 'autorun.inf'].includes(base)) {
    throw deny(`禁止操作系统保留文件: ${base}`)
  }

  return abs
}

export function toRelPath(absPath) {
  const root = path.resolve(getWorkspaceRoot())
  return path.relative(root, absPath).replaceAll('\\', '/')
}

export function listWorkspaceTree() {
  ensureWorkspaceSeed()
  const root = getWorkspaceRoot()
  return walkDir(root)
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const nodes = []
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name === '.sama-backup' || ent.name === '.sama-workspace.json') continue
    if (ent.name.startsWith('.')) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      nodes.push({
        name: ent.name,
        type: 'folder',
        children: walkDir(full),
      })
    } else if (ent.isFile()) {
      nodes.push({ name: ent.name, type: 'file' })
    }
  }
  return nodes
}

export function readWorkspaceFile(relPath) {
  ensureWorkspaceSeed()
  const abs = safeResolve(relPath)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw deny(`文件不存在: ${relPath}`)
  }
  const { content } = readTextFile(abs)
  return {
    path: toRelPath(abs),
    content,
  }
}

/**
 * 仅允许在 workspace 内创建/覆盖文本文件。禁止删除。
 */
export function writeWorkspaceFile(relPath, content, { backup = true } = {}) {
  ensureWorkspaceSeed()
  if (typeof content !== 'string') throw deny('内容必须是文本')
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    throw deny(`写入内容超过 ${MAX_BYTES} 字节限制`)
  }
  if (looksLikeFakeFanucPicture(content)) {
    throw deny(
      '拒绝写入：内容像是编造的假 FANUC PICTURE（含 FPScreen/FPLabel 等）。请先打开真实 FPicture*.xml 再改。',
    )
  }

  const abs = safeResolve(relPath)
  assertAllowedExt(abs)

  // 禁止写入目录
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    throw deny('目标是文件夹，不能写入')
  }

  ensureDir(path.dirname(abs))

  const existed = fs.existsSync(abs)
  if (existed && backup) {
    makeBackup(abs)
  }

  const encoding = existed ? detectTextEncoding(abs) : 'utf8'
  writeTextFile(abs, content, encoding === 'utf16be' ? 'utf16le' : encoding)
  const rel = toRelPath(abs)
  let desktopPath = ''
  try {
    desktopPath = syncLibraryFileToDesktop(rel, content) || ''
  } catch {
    // 桌面镜像失败不阻断沙箱写入
  }
  return {
    ok: true,
    path: rel,
    absPath: abs,
    desktopPath,
    created: !existed,
    bytes: Buffer.byteLength(content, 'utf8'),
    undo: {
      existed,
      previousContent: null,
    },
  }
}

/**
 * 写入用户允许范围内的绝对路径（桌面/文档/下载/可信路径）。
 */
export function writeExternalFile(absPath, content, { backup = true, trustedPaths = [] } = {}) {
  if (typeof content !== 'string') throw deny('内容必须是文本')
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    throw deny(`写入内容超过 ${MAX_BYTES} 字节限制`)
  }
  if (/\.lad$/i.test(String(absPath || ''))) {
    throw deny(
      '拒绝直接覆盖 .LAD：它是 FANUC LADDER-III 二进制工程（ZIP）。请把摘要另存为 .md，或在 LADDER-III 中编辑。',
    )
  }
  if (looksLikeFakeFanucPicture(content)) {
    throw deny(
      '拒绝写入：内容像是编造的假 FANUC PICTURE（含 FPScreen/FPLabel 等）。请基于已加载的真实 FPicture*.xml（含 <FANUCPicture>）做修改后再写回绝对路径。',
    )
  }
  const abs = normalizeAbs(absPath)
  assertAllowedUserAbs(abs, trustedPaths)
  assertAllowedExt(abs)
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    throw deny('目标是文件夹，不能写入')
  }

  const existed = fs.existsSync(abs)
  let previousContent = null
  let encoding = 'utf8'
  if (existed) {
    const prev = readTextFile(abs)
    previousContent = prev.content
    encoding = prev.encoding === 'utf16be' ? 'utf16le' : prev.encoding
    if (backup) makeExternalBackup(abs)
  }

  writeTextFile(abs, content, encoding)
  return {
    ok: true,
    path: abs,
    absPath: abs,
    created: !existed,
    bytes: Buffer.byteLength(content, 'utf8'),
    external: true,
    undo: { existed, previousContent },
  }
}

/** 相对沙箱 或 绝对允许路径 */
export function writeAnyAllowedFile(pathSpec, content, opts = {}) {
  if (looksAbsolute(pathSpec)) {
    return writeExternalFile(pathSpec, content, opts)
  }
  return writeWorkspaceFile(pathSpec, content, opts)
}

function makeBackup(abs) {
  const root = getWorkspaceRoot()
  const rel = path.relative(root, abs)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupAbs = path.join(root, '.sama-backup', `${rel}.${stamp}.bak`)
  ensureDir(path.dirname(backupAbs))
  fs.copyFileSync(abs, backupAbs)
}

function makeExternalBackup(abs) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupAbs = path.join(
    getWorkspaceRoot(),
    '.sama-backup',
    'external',
    `${path.basename(abs)}.${stamp}.bak`,
  )
  ensureDir(path.dirname(backupAbs))
  fs.copyFileSync(abs, backupAbs)
}

/** 显式拒绝通用删除 —— 仅撤回创建可用 revert */
export function deleteWorkspaceFile() {
  throw deny('安全策略：禁止删除任何文件（含工程内文件）。如需移除请人工处理。')
}

/**
 * 仅用于「撤回」：恢复写入前快照。
 * - 若本回合新建：只删除该允许范围内文件（不碰系统目录）
 * - 若本回合覆盖：写回 previousContent
 */
export function revertWorkspaceSnapshots(snapshots = []) {
  const results = []
  for (const snap of snapshots) {
    if (!snap?.path) continue
    try {
      let abs
      if (looksAbsolute(snap.path)) {
        abs = normalizeAbs(snap.path)
        assertAllowedUserAbs(abs, [abs])
      } else {
        abs = safeResolve(snap.path)
      }
      if (!snap.existed) {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          fs.unlinkSync(abs)
        }
        results.push({
          ok: true,
          path: looksAbsolute(snap.path) ? abs : toRelPath(abs),
          action: 'removed-created',
        })
        continue
      }
      if (typeof snap.previousContent !== 'string') {
        throw deny('缺少可恢复内容')
      }
      const encoding = fs.existsSync(abs) ? detectTextEncoding(abs) : 'utf8'
      writeTextFile(abs, snap.previousContent, encoding === 'utf16be' ? 'utf16le' : encoding)
      results.push({
        ok: true,
        path: looksAbsolute(snap.path) ? abs : toRelPath(abs),
        action: 'restored',
        bytes: Buffer.byteLength(snap.previousContent, 'utf8'),
      })
    } catch (e) {
      results.push({
        ok: false,
        path: snap.path,
        error: e.message || String(e),
      })
    }
  }
  return results
}

/** 同一目标路径只保留一份：优先完整（未截断），再取正文更长的，避免反复覆盖成短稿 */
export function dedupeFileWriteBlocks(writes) {
  const byKey = new Map()
  for (const w of writes || []) {
    const key = looksAbsolute(w.path)
      ? normalizeAbs(w.path).toLowerCase()
      : String(w.path || '')
          .replace(/\\/g, '/')
          .toLowerCase()
    if (!key) continue
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, w)
      continue
    }
    const score = (x) =>
      (x.truncated ? 0 : 1_000_000_000) + Buffer.byteLength(String(x.content || ''), 'utf8')
    if (score(w) > score(prev)) byKey.set(key, w)
  }
  return [...byKey.values()]
}

export function mkdirWorkspaceFolder(relPath) {
  ensureWorkspaceSeed()
  const abs = safeResolve(relPath)
  if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) {
    throw deny('同名文件已存在，不能建文件夹')
  }
  ensureDir(abs)
  const rel = toRelPath(abs)
  try {
    syncLibraryDirToDesktop(rel)
  } catch {
    // 桌面镜像失败不阻断
  }
  return { ok: true, path: rel, created: true, bytes: 0, mkdir: true }
}

export function parseMkdirBlocks(text) {
  if (!text) return []
  const out = []
  const re = /```sama-mkdir(?:\s+path\s*=\s*["']([^"']+)["'])?\s*\r?\n?([\s\S]*?)```/gi
  let m
  while ((m = re.exec(text)) !== null) {
    const fromAttr = String(m[1] || '').trim()
    const fromBody = String(m[2] || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean)
    const p = fromAttr || fromBody || ''
    if (p) out.push({ path: p.replaceAll('\\', '/') })
  }
  return out
}

export function parseAndApplyFileWrites(assistantText, { trustedPaths = [] } = {}) {
  const writes = dedupeFileWriteBlocks(parseFileWriteBlocks(assistantText))
  const results = []
  for (const w of writes) {
    try {
      let undo = { existed: false, previousContent: null }
      const target = looksAbsolute(w.path) ? w.path : rewriteToLibraryRel(w.path)
      if (looksAbsolute(target)) {
        const abs = normalizeAbs(target)
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const prev = readTextFile(abs)
          undo = { existed: true, previousContent: prev.content }
        }
        const r = writeExternalFile(abs, w.content, { trustedPaths })
        results.push({
          ok: true,
          path: r.path,
          created: r.created,
          bytes: r.bytes,
          external: true,
          undo: r.undo?.previousContent != null ? r.undo : undo,
        })
      } else {
        try {
          const abs = safeResolve(target)
          if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            const prev = readTextFile(abs)
            undo = { existed: true, previousContent: prev.content }
          }
        } catch {
          // 路径非法会在 write 时再报
        }
        const r = writeWorkspaceFile(target, w.content)
        results.push({
          ok: true,
          path: r.path,
          created: r.created,
          bytes: r.bytes,
          desktopPath: r.desktopPath,
          undo,
        })
      }
    } catch (e) {
      results.push({
        ok: false,
        path: w.path,
        error: e.message || String(e),
      })
    }
  }
  return results
}

/**
 * 解析模型输出中的文件写入块：
 * ```sama-file path="a/b.nc"
 * ...content...
 * ```
 * 若围栏未闭合（模型截断），仍解析并标记 truncated=true。
 */
export function parseFileWriteBlocks(text) {
  if (!text) return []
  const out = []
  const openRe = /```sama-file\s+path\s*=\s*["']([^"']+)["']\s*\r?\n/gi
  let m
  while ((m = openRe.exec(text)) !== null) {
    const raw = m[1].trim()
    const bodyStart = m.index + m[0].length
    const after = text.slice(bodyStart)
    const closeMatch = after.match(/\r?\n```/)
    let body
    let truncated = false
    if (closeMatch && closeMatch.index != null) {
      body = after.slice(0, closeMatch.index)
    } else {
      // 未闭合：吃到文末（可能仍不完整）
      body = after
      truncated = true
    }
    out.push({
      path: looksAbsolute(raw) ? raw.replaceAll('/', '\\') : raw.replaceAll('\\', '/'),
      content: body.replace(/^\uFEFF/, ''),
      truncated,
    })
  }
  return out
}

export function hasTruncatedFileWrites(text) {
  return parseFileWriteBlocks(text).some((w) => w.truncated)
}

/** 把续写片段接到被截断的 sama-file 后，并尽量补上闭合围栏 */
export function mergeAssistantContinuation(previous, continuation) {
  const prev = String(previous || '')
  let cont = String(continuation || '').replace(/^\uFEFF/, '')
  if (!cont.trim()) return prev

  if (!hasTruncatedFileWrites(prev)) {
    return `${prev}\n${cont}`
  }

  // 续写若重复开同一个 sama-file，只取正文
  const again = cont.match(/^```sama-file\s+path\s*=\s*["']([^"']+)["']\s*\r?\n([\s\S]*)$/i)
  if (again) {
    cont = again[2]
  }

  let merged = prev + cont
  if (hasTruncatedFileWrites(merged) && !/\n```\s*$/.test(merged)) {
    // 仍未闭合且续写像已结束：补闭合，避免永远无法落盘
    if (/报告结束|完\s*$|EOF|^\s*$/m.test(cont.slice(-200)) || cont.length < 40) {
      merged += '\n```'
    }
  }
  return merged
}

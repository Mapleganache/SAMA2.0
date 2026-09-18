import fs from 'node:fs'
import path from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import { ensureDir } from './paths.mjs'
import { getWorkspaceRoot, writeWorkspaceFile } from './workspace.mjs'
import { isLadPath, readLadProject } from './fanucLad.mjs'
import { readTextAuto } from './textEncoding.mjs'

const MAX_BYTES = 1024 * 1024 // 1MB 文本
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const TEXT_EXT = new Set([
  '.nc',
  '.cnc',
  '.txt',
  '.md',
  '.xml',
  '.json',
  '.csv',
  '.ini',
  '.ls',
  '.mpf',
  '.spf',
  '.src',
  '.sub',
  '.prg',
  '.gcode',
  '.tap',
  '.iso',
  '.h',
  '.def',
  '.log',
  '.cfg',
  '.conf',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.py',
  '.bat',
  '.ps1',
  '.sh',
  '.fp',
  '.fp2',
  '.fpp',
  '.lad',
])

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const LAD_EXT = new Set(['.lad'])

const BLOCKED_READ_PREFIXES = [
  'C:\\Windows\\System32',
  'C:\\Windows\\SysWOW64',
  'C:\\$Recycle.Bin',
  'C:\\System Volume Information',
]

function deny(message, code = 'DENIED') {
  const err = new Error(message)
  err.code = code
  return err
}

function assertReadableAbs(absPath) {
  const abs = path.resolve(absPath)
  if (!path.isAbsolute(abs)) throw deny('需要绝对路径')
  const lower = abs.toLowerCase()
  for (const p of BLOCKED_READ_PREFIXES) {
    if (lower.startsWith(p.toLowerCase())) {
      throw deny(`拒绝读取系统敏感路径：${abs}`)
    }
  }
  if (!fs.existsSync(abs)) throw deny(`路径不存在：${abs}`, 'NOT_FOUND')
  const st = fs.statSync(abs)
  return { abs, size: st.size, isDirectory: st.isDirectory(), isFile: st.isFile() }
}

function assertReadableFile(absPath) {
  const meta = assertReadableAbs(absPath)
  if (!meta.isFile) throw deny('只能读取普通文件（目录请用读文件夹）')
  return meta
}

function extOf(filePath) {
  return path.extname(filePath).toLowerCase()
}

function kindOf(filePath) {
  const ext = extOf(filePath)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (LAD_EXT.has(ext) || isLadPath(filePath)) return 'lad'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.elk') return 'eplan'
  if (TEXT_EXT.has(ext) || !ext) return 'text'
  return 'binary'
}

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.vs',
  '.idea',
  'dist',
  'build',
  'out',
  '.cursor',
  'Release',
  'Debug',
])

const FOLDER_MAX_DEPTH = 5
const FOLDER_MAX_FILES = 40
const FOLDER_MAX_FILE_BYTES = 200 * 1024
const FOLDER_MAX_TOTAL_BYTES = 800 * 1024

/**
 * 递归列出并读取文件夹（文本摘要，供对话附件 / Agent）
 */
export function readExternalFolder(dirPath, opts = {}) {
  const { abs } = assertReadableAbs(dirPath)
  if (!fs.statSync(abs).isDirectory()) {
    throw deny('不是文件夹', 'NOT_A_DIRECTORY')
  }

  const maxDepth = Math.min(Number(opts.maxDepth) || FOLDER_MAX_DEPTH, 8)
  const maxFiles = Math.min(Number(opts.maxFiles) || FOLDER_MAX_FILES, 80)
  const name = path.basename(abs)
  const treeLines = []
  const fileParts = []
  const listed = []
  let filesRead = 0
  let totalBytes = 0
  let truncated = false

  function walk(dir, depth, prefix) {
    if (depth > maxDepth) {
      truncated = true
      return
    }
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      treeLines.push(`${prefix}[无法读取: ${e.message}]`)
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name, 'zh')
    })
    for (const ent of entries) {
      if (ent.name === '.' || ent.name === '..') continue
      if (SKIP_DIR_NAMES.has(ent.name)) {
        treeLines.push(`${prefix}${ent.name}/ (跳过)`)
        continue
      }
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        treeLines.push(`${prefix}${ent.name}/`)
        listed.push({ name: ent.name, path: full, type: 'directory' })
        walk(full, depth + 1, `${prefix}  `)
        continue
      }
      if (!ent.isFile()) continue
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        continue
      }
      treeLines.push(`${prefix}${ent.name} (${size} B)`)
      listed.push({ name: ent.name, path: full, type: 'file', size })

      if (filesRead >= maxFiles || totalBytes >= FOLDER_MAX_TOTAL_BYTES) {
        truncated = true
        continue
      }
      const kind = kindOf(full)
      if (kind === 'binary' || kind === 'image') continue
      if (kind === 'lad') {
        try {
          const lad = readLadProject(full)
          const snippet = String(lad.content || '').slice(0, 6000)
          fileParts.push(`### ${path.relative(abs, full)}\n\`\`\`\n${snippet}\n\`\`\`\n`)
          filesRead += 1
          totalBytes += Buffer.byteLength(snippet, 'utf8')
        } catch {
          /* skip broken lad */
        }
        continue
      }
      if (size > FOLDER_MAX_FILE_BYTES) {
        fileParts.push(`### ${path.relative(abs, full)}\n（文件过大 ${size} B，已跳过正文）\n`)
        continue
      }
      try {
        const decoded = readTextAuto(full, FOLDER_MAX_FILE_BYTES)
        const slice = String(decoded.content ?? decoded.text ?? '').slice(0, 12000)
        if (!slice) throw new Error('empty decode')
        fileParts.push(`### ${path.relative(abs, full)}\n\`\`\`\n${slice}\n\`\`\`\n`)
        filesRead += 1
        totalBytes += Buffer.byteLength(slice, 'utf8')
      } catch (e1) {
        try {
          const raw = fs.readFileSync(full, 'utf8').slice(0, 12000)
          fileParts.push(`### ${path.relative(abs, full)}\n\`\`\`\n${raw}\n\`\`\`\n`)
          filesRead += 1
          totalBytes += Buffer.byteLength(raw, 'utf8')
        } catch (e2) {
          fileParts.push(
            `### ${path.relative(abs, full)}\n（无法读取正文: ${e1.message || e2.message}）\n`,
          )
        }
      }
    }
  }

  walk(abs, 0, '')

  const content = [
    `# 文件夹：${name}`,
    `路径：${abs}`,
    `条目：${listed.length}（已读文本约 ${filesRead} 个文件）`,
    truncated ? '（已截断：达到深度/数量/体积上限）' : '',
    '',
    '## 目录树',
    '```',
    treeLines.slice(0, 400).join('\n') || '（空）',
    '```',
    '',
    '## 文件内容摘录',
    fileParts.length ? fileParts.join('\n') : '（无文本文件可读）',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    ok: true,
    name,
    path: abs,
    kind: 'folder',
    size: totalBytes,
    fileCount: listed.filter((x) => x.type === 'file').length,
    dirCount: listed.filter((x) => x.type === 'directory').length,
    truncated,
    entries: listed.slice(0, 200),
    content,
  }
}

/**
 * 读取用户主动选择的本机文件（只读）。
 */
export function readExternalFile(absPath) {
  const { abs, size, isDirectory } = assertReadableAbs(absPath)
  if (isDirectory) {
    return readExternalFolder(abs)
  }
  // re-check as file
  assertReadableFile(abs)
  const kind = kindOf(abs)
  const name = path.basename(abs)

  if (kind === 'lad') {
    return readLadProject(abs)
  }

  if (kind === 'image') {
    if (size > MAX_IMAGE_BYTES) {
      throw deny(`图片过大（>${MAX_IMAGE_BYTES} 字节）：${name}`)
    }
    const buf = fs.readFileSync(abs)
    const ext = extOf(abs).replace('.', '') || 'png'
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext === 'jpeg' ? 'jpeg' : ext}`
    return {
      ok: true,
      name,
      path: abs,
      kind: 'image',
      size,
      mime,
      content: `[图片附件: ${name}，${size} 字节。当前对话按文本处理，请用文字描述图片内容。]`,
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    }
  }

  if (kind === 'pdf') {
    throw deny('PDF 需异步抽取，请用 readExternalFileAsync')
  }

  if (kind === 'eplan') {
    return {
      ok: true,
      name,
      path: abs,
      kind: 'eplan',
      size,
      content: `[EPLAN 工程] ${name}\n路径：${abs}\n用 EPLAN Electric P8 打开 .elk，不要手改旁边的 .edb。`,
    }
  }

  if (kind === 'binary') {
    throw deny(`暂不支持此类型文件：${extOf(abs) || name}。请导入文本 / G代码 / XML / LAD / 图片。`)
  }

  if (size > MAX_BYTES) {
    throw deny(`文件过大（>${MAX_BYTES} 字节）：${name}`)
  }

  const decoded = readTextAuto(abs, MAX_BYTES)
  const content = String(decoded.content ?? decoded.text ?? '')
  return {
    ok: true,
    name,
    path: abs,
    kind: 'text',
    size,
    encoding: decoded.encoding,
    content,
  }
}

export function readExternalFiles(paths) {
  const results = []
  for (const p of paths || []) {
    try {
      results.push(readExternalFile(p))
    } catch (err) {
      results.push({
        ok: false,
        name: path.basename(String(p)),
        path: String(p),
        error: err.message || String(err),
      })
    }
  }
  return results
}

export async function readExternalFileAsync(absPath) {
  const { abs, size } = assertReadableAbs(absPath)
  if (kindOf(abs) !== 'pdf') return readExternalFile(absPath)
  const name = path.basename(abs)
  const { extractPdfText } = await import('./electrical/sheetService.mjs')
  const text = await extractPdfText(abs)
  if (!String(text || '').trim()) {
    throw deny(`PDF 未能抽出文字：${name}。若是扫描件请导出为图片再识图。`)
  }
  return {
    ok: true,
    name,
    path: abs,
    kind: 'pdf',
    size,
    content: String(text).slice(0, 80_000),
  }
}

export async function readExternalFilesAsync(paths) {
  const results = []
  for (const p of paths || []) {
    try {
      results.push(await readExternalFileAsync(p))
    } catch (err) {
      results.push({
        ok: false,
        name: path.basename(String(p)),
        path: String(p),
        error: err.message || String(err),
      })
    }
  }
  return results
}

/**
 * 把本机文件复制进工程沙箱 projects/imports/
 */
export function importExternalToWorkspace(absPath, preferredName) {
  const file = readExternalFile(absPath)
  if (!file.ok) throw deny(file.error || '读取失败')
  if (file.kind === 'image') {
    // 图片不进可写白名单时：仅作为附件，不导入工程
    throw deny('图片请作为对话附件使用；工程沙箱仅导入文本类文件。')
  }
  if (file.kind === 'folder') {
    throw deny('文件夹请作为对话附件使用；工程沙箱请导入单个文本文件。')
  }

  const safeName = sanitizeFileName(preferredName || file.name)
  const rel = `projects/imports/${safeName}`
  const written = writeWorkspaceFile(rel, file.content)
  return {
    ok: true,
    importedPath: written.path || rel,
    bytes: written.bytes,
    name: safeName,
    source: file.path,
  }
}

function sanitizeFileName(name) {
  const base = path.basename(String(name || 'untitled.txt')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  return base || 'untitled.txt'
}

export async function showOpenFilesDialog() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '阅读本机文件（可读桌面等）',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '电路图 / 图纸', extensions: ['pdf', 'svg', 'dxf', 'png', 'jpg', 'jpeg', 'elk'] },
      { name: 'FANUC PICTURE / 梯子 / 机床', extensions: ['xml', 'fp2', 'fp', 'lad', 'nc', 'gcode', 'cnc', 'mpf', 'txt', 'md', 'json', 'csv', 'ini'] },
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths?.length) {
    return { ok: true, canceled: true, files: [] }
  }
  return { ok: true, canceled: false, files: await readExternalFilesAsync(result.filePaths) }
}

/** 选择并读取本机文件夹（目录树 + 文本摘录） */
export async function showOpenFolderDialog() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '阅读本机文件夹（工程目录 / PICTURE 等）',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths?.length) {
    return { ok: true, canceled: true, files: [] }
  }
  return { ok: true, canceled: false, files: readExternalFiles(result.filePaths) }
}

/**
 * 列出本机文件夹为 FileTree 节点（只列结构，不读正文）。
 * 供「工程沙箱目录」拖入文件夹后浏览。
 */
export function listExternalDirTree(dirPath, opts = {}) {
  const { abs } = assertReadableAbs(dirPath)
  if (!fs.statSync(abs).isDirectory()) {
    throw deny('不是文件夹', 'NOT_A_DIRECTORY')
  }
  const maxDepth = Math.min(Number(opts.maxDepth) || 10, 14)

  function walk(dir, depth) {
    if (depth > maxDepth) return []
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name, 'zh')
    })
    const nodes = []
    for (const ent of entries) {
      if (ent.name === '.' || ent.name === '..') continue
      if (ent.name.startsWith('.')) continue
      if (SKIP_DIR_NAMES.has(ent.name)) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        nodes.push({
          name: ent.name,
          type: 'folder',
          children: walk(full, depth + 1),
        })
      } else if (ent.isFile()) {
        nodes.push({ name: ent.name, type: 'file' })
      }
    }
    return nodes
  }

  return {
    ok: true,
    root: abs,
    name: path.basename(abs),
    tree: walk(abs, 0),
  }
}

export function ensureImportsDir() {
  ensureDir(path.join(getWorkspaceRoot(), 'projects', 'imports'))
}

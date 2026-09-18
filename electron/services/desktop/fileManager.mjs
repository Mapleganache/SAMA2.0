import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  assertAllowedUserAbs,
  assertAllowedExt,
  assertNotBlockedAbs,
  getAllowedRoots,
  normalizeAbs,
  readTextFile,
  writeTextFile,
  MAX_BYTES,
  looksAbsolute,
} from '../safeFs.mjs'
import { getDataRoot } from '../paths.mjs'

function pathRoots() {
  const allowed = getAllowedRoots()
  const home = os.homedir()
  const pick = (re, fallback) => allowed.find((r) => re.test(r)) || fallback
  return {
    desktop: pick(/[\\/]Desktop$/i, path.join(home, 'Desktop')),
    documents: pick(/[\\/]Documents$/i, path.join(home, 'Documents')),
    downloads: pick(/[\\/]Downloads$/i, path.join(home, 'Downloads')),
    workspace: path.join(getDataRoot(), 'workspace'),
  }
}

/**
 * 把「桌面/test.nc」「Desktop/foo」等用户说法解析到允许根下的绝对路径。
 */
export function resolveUserPath(input) {
  const raw = String(input || '').trim()
  if (!raw) {
    const err = new Error('路径为空')
    err.code = 'PATH_EMPTY'
    throw err
  }

  let s = raw.replace(/\//g, path.sep)
  s = s.replace(/^["']|["']$/g, '')

  const roots = pathRoots()
  const alias = [
    [/^桌面[\\/]?/i, roots.desktop],
    [/^Desktop[\\/]?/i, roots.desktop],
    [/^文档[\\/]?/i, roots.documents],
    [/^Documents[\\/]?/i, roots.documents],
    [/^下载[\\/]?/i, roots.downloads],
    [/^Downloads[\\/]?/i, roots.downloads],
    [/^workspace[\\/]?/i, roots.workspace],
    [/^工程沙箱[\\/]?/i, roots.workspace],
    [/^沙箱[\\/]?/i, roots.workspace],
  ]

  for (const [re, base] of alias) {
    if (re.test(s)) {
      const rest = s.replace(re, '')
      s = rest ? path.join(base, rest) : base
      break
    }
  }

  if (!looksAbsolute(s) && !path.isAbsolute(s)) {
    s = path.join(roots.desktop, s)
  }

  const abs = normalizeAbs(s)
  try {
    assertAllowedUserAbs(abs)
  } catch (e) {
    const err = new Error(e.message || '路径超出允许根')
    err.code = 'PATH_OUTSIDE_ALLOWED_ROOT'
    throw err
  }
  return abs
}

function ensureParent(abs) {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
}

export function fileExists(args = {}) {
  const abs = resolveUserPath(args.path)
  return {
    path: abs,
    exists: fs.existsSync(abs),
    isFile: fs.existsSync(abs) && fs.statSync(abs).isFile(),
    isDirectory: fs.existsSync(abs) && fs.statSync(abs).isDirectory(),
  }
}

export function fileInfo(args = {}) {
  const abs = resolveUserPath(args.path)
  if (!fs.existsSync(abs)) {
    const err = new Error(`文件不存在: ${abs}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  const st = fs.statSync(abs)
  return {
    path: abs,
    size: st.size,
    isFile: st.isFile(),
    isDirectory: st.isDirectory(),
    mtime: st.mtime.toISOString(),
    ctime: st.ctime.toISOString(),
    ext: path.extname(abs),
  }
}

export function fileList(args = {}) {
  const abs = resolveUserPath(args.path || '桌面')
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    const err = new Error(`不是目录: ${abs}`)
    err.code = 'NOT_A_DIRECTORY'
    throw err
  }
  const names = fs.readdirSync(abs)
  const entries = names.slice(0, 500).map((name) => {
    const p = path.join(abs, name)
    let type = 'unknown'
    let size = 0
    try {
      const st = fs.statSync(p)
      type = st.isDirectory() ? 'directory' : 'file'
      size = st.size
    } catch {
      /* ignore */
    }
    return { name, path: p, type, size }
  })
  return { path: abs, count: entries.length, truncated: names.length > 500, entries }
}

/**
 * 读取文件夹树 + 文本摘录（允许根内；Agent Desktop 用）
 */
export function fileReadFolder(args = {}) {
  const abs = resolveUserPath(args.path || args.dir || '')
  assertAllowedUserAbs(abs)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    const err = new Error(`不是目录: ${abs}`)
    err.code = 'NOT_A_DIRECTORY'
    throw err
  }
  // 复用 external 逻辑会依赖 electron dialog；此处自实现轻量版
  const maxDepth = Math.min(Number(args.maxDepth) || 4, 6)
  const maxFiles = Math.min(Number(args.maxFiles) || 30, 60)
  const skip = new Set(['node_modules', '.git', '.svn', '__pycache__', '.vs', 'dist', 'build'])
  const tree = []
  const texts = []
  let readCount = 0
  let truncated = false

  function walk(dir, depth, prefix) {
    if (depth > maxDepth) {
      truncated = true
      return
    }
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      if (skip.has(ent.name)) continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        tree.push({ name: ent.name, path: full, type: 'directory', depth })
        walk(full, depth + 1, prefix + '  ')
        continue
      }
      if (!ent.isFile()) continue
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        continue
      }
      tree.push({ name: ent.name, path: full, type: 'file', size, depth })
      if (readCount >= maxFiles) {
        truncated = true
        continue
      }
      const ext = path.extname(ent.name).toLowerCase()
      const textOk =
        [
          '.txt',
          '.md',
          '.xml',
          '.json',
          '.nc',
          '.cnc',
          '.fp2',
          '.fp',
          '.ini',
          '.csv',
          '.log',
          '.mpf',
        ].includes(ext) || /^O\d{1,8}$/i.test(ent.name)
      if (!textOk || size > 200_000) continue
      try {
        const { content } = readTextFile(full, 80_000)
        texts.push({ path: full, name: ent.name, content: content.slice(0, 8000) })
        readCount += 1
      } catch {
        /* skip */
      }
    }
  }

  walk(abs, 0, '')
  const summary = [
    `# 文件夹 ${path.basename(abs)}`,
    abs,
    `条目 ${tree.length}，已读文本 ${readCount}${truncated ? '（已截断）' : ''}`,
    '',
    ...tree.slice(0, 200).map((e) => {
      const pad = '  '.repeat(e.depth || 0)
      return e.type === 'directory' ? `${pad}${e.name}/` : `${pad}${e.name}`
    }),
  ].join('\n')

  return {
    path: abs,
    truncated,
    entryCount: tree.length,
    entries: tree.slice(0, 200),
    files: texts,
    content: summary + (texts.length ? '\n\n' + texts.map((t) => `## ${t.name}\n${t.content}`).join('\n\n') : ''),
  }
}

export function fileRead(args = {}) {
  const abs = resolveUserPath(args.path)
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return fileReadFolder({ ...args, path: abs })
  }
  assertAllowedExt(abs)
  if (!fs.existsSync(abs)) {
    const err = new Error(`文件不存在: ${abs}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  const { content, encoding } = readTextFile(abs, args.maxBytes || MAX_BYTES)
  return { path: abs, encoding, bytes: Buffer.byteLength(content, 'utf8'), content }
}

export function fileWritePermission(args = {}) {
  const abs = resolveUserPath(args.path)
  assertAllowedExt(abs)
  if (fs.existsSync(abs) && args.overwrite !== true && args.force !== true) {
    // 已存在且未显式 overwrite：CONFIRM
    return { level: 'CONFIRM', reason: 'overwrite', path: abs }
  }
  return { level: 'SAFE', path: abs }
}

export function fileWrite(args = {}) {
  const abs = resolveUserPath(args.path)
  assertAllowedExt(abs)
  if (fs.existsSync(abs) && args.overwrite !== true && args.force !== true) {
    const err = new Error(`目标已存在，覆盖需确认: ${abs}`)
    err.code = 'NEEDS_OVERWRITE_CONFIRM'
    throw err
  }
  writeTextFile(abs, String(args.content ?? ''), 'utf8')
  return { path: abs, bytes: Buffer.byteLength(String(args.content ?? ''), 'utf8') }
}

export function fileMkdir(args = {}) {
  const abs = resolveUserPath(args.path)
  fs.mkdirSync(abs, { recursive: true })
  return { path: abs, created: true }
}

export function fileCopy(args = {}) {
  const src = resolveUserPath(args.source || args.from || args.src)
  const dest = resolveUserPath(args.target || args.to || args.dest)
  if (!fs.existsSync(src)) {
    const err = new Error(`源不存在: ${src}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  assertNotBlockedAbs(dest)
  ensureParent(dest)
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
    const finalDest = path.join(dest, path.basename(src))
    fs.copyFileSync(src, finalDest)
    return { source: src, target: finalDest }
  }
  if (fs.existsSync(dest) && args.overwrite !== true) {
    const err = new Error(`目标已存在，覆盖需确认: ${dest}`)
    err.code = 'NEEDS_OVERWRITE_CONFIRM'
    throw err
  }
  fs.copyFileSync(src, dest)
  return { source: src, target: dest }
}

export function fileCopyPermission(args = {}) {
  try {
    const dest = resolveUserPath(args.target || args.to || args.dest)
    if (fs.existsSync(dest) && fs.statSync(dest).isFile() && args.overwrite !== true) {
      return { level: 'CONFIRM', reason: 'overwrite', path: dest }
    }
  } catch {
    /* resolve 失败时交给执行阶段报错 */
  }
  return { level: 'SAFE' }
}

export function fileMove(args = {}) {
  const src = resolveUserPath(args.source || args.from || args.src)
  const dest = resolveUserPath(args.target || args.to || args.dest)
  if (!fs.existsSync(src)) {
    const err = new Error(`源不存在: ${src}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  ensureParent(dest)
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) {
    const finalDest = path.join(dest, path.basename(src))
    fs.renameSync(src, finalDest)
    return { source: src, target: finalDest }
  }
  fs.renameSync(src, dest)
  return { source: src, target: dest }
}

export function fileDelete(args = {}) {
  const abs = resolveUserPath(args.path)
  if (!fs.existsSync(abs)) {
    const err = new Error(`文件不存在: ${abs}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  const st = fs.statSync(abs)
  if (st.isDirectory()) {
    if (args.recursive === true) {
      fs.rmSync(abs, { recursive: true, force: false })
    } else {
      fs.rmdirSync(abs)
    }
  } else {
    fs.unlinkSync(abs)
  }
  return { path: abs, deleted: true }
}

export function fileSearch(args = {}) {
  const root = resolveUserPath(args.path || args.root || '桌面')
  const needle = String(args.query || args.name || '').toLowerCase()
  if (!needle) {
    const err = new Error('搜索关键词为空')
    err.code = 'QUERY_EMPTY'
    throw err
  }
  if (!fs.existsSync(root)) {
    const err = new Error(`路径不存在: ${root}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  const hits = []
  const max = Math.min(Number(args.limit) || 50, 200)

  function walk(dir, depth) {
    if (hits.length >= max || depth > 6) return
    let names
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (hits.length >= max) break
      const p = path.join(dir, name)
      if (name.toLowerCase().includes(needle)) {
        hits.push(p)
      }
      try {
        if (fs.statSync(p).isDirectory()) walk(p, depth + 1)
      } catch {
        /* ignore */
      }
    }
  }

  if (fs.statSync(root).isDirectory()) walk(root, 0)
  else if (path.basename(root).toLowerCase().includes(needle)) hits.push(root)

  return { root, query: needle, count: hits.length, hits }
}

export function listAllowedRoots() {
  return getAllowedRoots()
}

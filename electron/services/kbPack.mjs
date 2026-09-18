/**
 * 知识资料入库 + 一键分享包（给另一台电脑/另一用户）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { dialog, shell } from 'electron'
import {
  ensureDir,
  getDesktopPath,
  getKbRoot,
  getUserDbRoot,
  getUserDbRegistryPath,
  readJson,
  writeJson,
} from './paths.mjs'
import { ensureKnowledgeBase } from './store.mjs'
import { getMtkbRoot, invalidateMtkbDbCache } from './mtkb.mjs'

const require = createRequire(import.meta.url)

const TEXT_EXT = new Set(['.md', '.txt', '.nc', '.xml', '.csv', '.json', '.log'])
const PDF_EXT = new Set(['.pdf'])
const SQLITE_EXT = new Set(['.sqlite', '.sqlite3', '.db'])

function safeName(name, fallback = '资料') {
  const s = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return s.slice(0, 80) || fallback
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
}

function copyTree(src, dest) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isFile()) copyFile(from, to)
  }
}

function uniquePath(dest) {
  if (!fs.existsSync(dest)) return dest
  const ext = path.extname(dest)
  const base = dest.slice(0, dest.length - ext.length)
  let i = 2
  while (fs.existsSync(`${base}-${i}${ext}`)) i += 1
  return `${base}-${i}${ext}`
}

export function loadUserDbRegistry() {
  return readJson(getUserDbRegistryPath(), { version: 1, databases: [] })
}

export function saveUserDbRegistry(reg) {
  writeJson(getUserDbRegistryPath(), reg)
  invalidateMtkbDbCache()
}

async function extractPdfText(filePath) {
  try {
    const mod = await import('pdf-parse')
    const PDFParse = mod.PDFParse || mod.default?.PDFParse || mod.default
    if (!PDFParse) return ''
    const buf = fs.readFileSync(filePath)
    // pdf-parse v2
    if (typeof PDFParse === 'function') {
      try {
        const parser = new PDFParse({ data: buf })
        if (typeof parser.getText === 'function') {
          const result = await parser.getText()
          return String(result?.text || result || '')
        }
      } catch {
        /* fall through */
      }
      // older style
      const result = await PDFParse(buf)
      return String(result?.text || '')
    }
    return ''
  } catch (err) {
    console.warn('[KB] PDF 抽取失败：', err?.message || err)
    return ''
  }
}

/**
 * 将单个文件写入知识库 docs（文本可检索）
 */
async function importOneDocFile(filePath, destDir) {
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath, ext)
  const imported = []

  if (TEXT_EXT.has(ext)) {
    const dest = uniquePath(path.join(destDir, path.basename(filePath)))
    copyFile(filePath, dest)
    imported.push(dest)
    return imported
  }

  if (PDF_EXT.has(ext)) {
    const text = await extractPdfText(filePath)
    const mdName = `${safeName(base)}.md`
    const mdPath = uniquePath(path.join(destDir, mdName))
    const body =
      text.trim().length > 20
        ? `# ${base}\n\n> 由 PDF 自动抽取：${path.basename(filePath)}\n\n${text}`
        : `# ${base}\n\n> PDF 未能抽取到足够文本，请人工整理后替换本文件。\n> 源文件：${path.basename(filePath)}\n`
    fs.writeFileSync(mdPath, body, 'utf8')
    imported.push(mdPath)
    // 原始 PDF 另存，便于对照（不进切片索引）
    const pdfDest = uniquePath(path.join(destDir, '_raw', path.basename(filePath)))
    copyFile(filePath, pdfDest)
    return imported
  }

  return imported
}

function looksLikeMtkbPackage(dir) {
  return (
    fs.existsSync(path.join(dir, 'manifest.json')) ||
    fs.existsSync(path.join(dir, '共通数据库.sqlite3')) ||
    fs.existsSync(path.join(dir, '专有数据库'))
  )
}

function looksLikeSharePack(dir) {
  const pkg = path.join(dir, 'package.json')
  if (!fs.existsSync(pkg)) return false
  try {
    const j = JSON.parse(fs.readFileSync(pkg, 'utf8'))
    return j.format === 'sama-share-pack'
  } catch {
    return false
  }
}

function registerSqlite(filePath, label) {
  const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const destName = `${safeName(label || path.basename(filePath, path.extname(filePath)))}.sqlite3`
  const dest = uniquePath(path.join(getUserDbRoot(), destName))
  copyFile(filePath, dest)
  const reg = loadUserDbRegistry()
  reg.databases = Array.isArray(reg.databases) ? reg.databases : []
  reg.databases.push({
    id,
    label: label || path.basename(filePath),
    path: dest,
    importedAt: new Date().toISOString(),
    source: filePath,
  })
  saveUserDbRegistry(reg)
  return { id, path: dest, label: label || path.basename(filePath) }
}

async function importDirectory(dirPath, collectionName) {
  const docsDir = path.join(getKbRoot(), 'docs')
  const collection = safeName(collectionName || path.basename(dirPath), '用户库')
  const destRoot = path.join(docsDir, '用户库', collection)
  ensureDir(destRoot)

  const result = {
    docs: 0,
    databases: [],
    collection,
  }

  if (looksLikeSharePack(dirPath)) {
    const docsSrc = path.join(dirPath, 'docs')
    if (fs.existsSync(docsSrc)) {
      copyTree(docsSrc, path.join(docsDir, '用户库', `${collection}-分享`))
      result.docs += 1
    }
    const dbDir = path.join(dirPath, 'databases')
    if (fs.existsSync(dbDir)) {
      for (const name of fs.readdirSync(dbDir)) {
        const full = path.join(dbDir, name)
        if (!fs.statSync(full).isFile()) continue
        if (!SQLITE_EXT.has(path.extname(name).toLowerCase())) continue
        result.databases.push(registerSqlite(full, name))
      }
    }
    return result
  }

  if (looksLikeMtkbPackage(dirPath)) {
    // 把包内 sqlite 登记为用户库；文本若有 sama-docs 则并入
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const full = path.join(d, name)
        const st = fs.statSync(full)
        if (st.isDirectory()) walk(full)
        else if (SQLITE_EXT.has(path.extname(name).toLowerCase())) {
          result.databases.push(registerSqlite(full, name))
        }
      }
    }
    walk(dirPath)
    const samaDocs = path.join(path.dirname(dirPath), 'sama-docs')
    // if selecting 数据库包 itself, sibling sama-docs
    const altDocs = [
      path.join(dirPath, 'sama-docs'),
      path.join(path.dirname(dirPath), 'sama-docs'),
    ]
    for (const d of altDocs) {
      if (fs.existsSync(d)) {
        copyTree(d, path.join(docsDir, '用户库', `${collection}-docs`))
        result.docs += 1
        break
      }
    }
    return result
  }

  // 普通文件夹：递归导入可索引文本/PDF
  const stack = [dirPath]
  while (stack.length) {
    const cur = stack.pop()
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) {
        if (name === '_raw' || name === '.memory' || name === 'node_modules') continue
        stack.push(full)
        continue
      }
      const ext = path.extname(name).toLowerCase()
      if (SQLITE_EXT.has(ext)) {
        result.databases.push(registerSqlite(full, name))
        continue
      }
      if (TEXT_EXT.has(ext) || PDF_EXT.has(ext)) {
        const rel = path.relative(dirPath, path.dirname(full))
        const targetDir = path.join(destRoot, rel === '.' ? '' : rel)
        ensureDir(targetDir)
        const files = await importOneDocFile(full, targetDir)
        result.docs += files.length
      }
    }
  }
  return result
}

/**
 * 弹窗选择资料并入库为 SAMA 知识库
 */
export async function pickAndImportAsDatabase(win) {
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '选择要入库的资料（文件或文件夹）',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: '知识资料', extensions: ['md', 'txt', 'pdf', 'nc', 'xml', 'csv', 'sqlite', 'sqlite3', 'db'] },
      { name: '全部', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths?.length) {
    return { ok: false, canceled: true }
  }
  return importPathsAsDatabase(result.filePaths)
}

export async function importPathsAsDatabase(filePaths, { collectionName } = {}) {
  const paths = (filePaths || []).filter((p) => p && fs.existsSync(p))
  if (!paths.length) return { ok: false, error: '未找到可导入的路径' }

  const summary = {
    ok: true,
    docs: 0,
    databases: [],
    collections: [],
    note: '',
  }

  const docsDir = path.join(getKbRoot(), 'docs')
  ensureDir(docsDir)

  for (const p of paths) {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      const r = await importDirectory(p, collectionName || path.basename(p))
      summary.docs += r.docs
      summary.databases.push(...r.databases)
      summary.collections.push(r.collection)
      continue
    }

    const ext = path.extname(p).toLowerCase()
    if (SQLITE_EXT.has(ext)) {
      summary.databases.push(registerSqlite(p, path.basename(p)))
      continue
    }

    const collection = safeName(collectionName || '用户导入', '用户导入')
    const destDir = path.join(docsDir, '用户库', collection)
    ensureDir(destDir)
    const files = await importOneDocFile(p, destDir)
    summary.docs += files.length
    if (!summary.collections.includes(collection)) summary.collections.push(collection)
  }

  const kb = ensureKnowledgeBase({ force: true })
  summary.kb = kb
  summary.note = [
    summary.docs ? `已入库文档切片源 ${summary.docs} 个` : '',
    summary.databases.length ? `已接入 SQLite ${summary.databases.length} 个` : '',
    '已重建知识索引',
  ]
    .filter(Boolean)
    .join('；')

  if (!summary.docs && !summary.databases.length) {
    return {
      ok: false,
      error: '未识别到可入库内容（支持 md/txt/pdf/文件夹，或 .sqlite3 / MTKB 数据库包 / SAMA 分享包）',
    }
  }
  return summary
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function zipDirectoryWithDotNet(sourceDir, zipPath) {
  const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = ${JSON.stringify(sourceDir)}
$zip = ${JSON.stringify(zipPath)}
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($src, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
Write-Output "ok"
`
  const { spawnSync } = require('node:child_process')
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || '压缩失败')
  }
}

/**
 * 一键生成给另一用户的数据包（zip）
 * @param {{ includeBundledMtkb?: boolean, includeUserDocs?: boolean, includeUserDb?: boolean, outputPath?: string }} opts
 * outputPath 有值时跳过另存对话框（供自动化测试）
 */
export async function exportSharePackage(win, opts = {}) {
  const includeUserDocs = opts.includeUserDocs !== false
  const includeUserDb = opts.includeUserDb !== false
  const includeBundledMtkb = Boolean(opts.includeBundledMtkb)

  let zipPath = opts.outputPath ? String(opts.outputPath) : ''
  if (!zipPath) {
    const defaultName = `SAMA-分享包-${stamp()}.zip`
    const save = await dialog.showSaveDialog(win || undefined, {
      title: '导出 SAMA 知识分享包',
      defaultPath: path.join(getDesktopPath(), defaultName),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (save.canceled || !save.filePath) {
      return { ok: false, canceled: true }
    }
    zipPath = save.filePath
  }
  if (!zipPath.endsWith('.zip')) zipPath = `${zipPath}.zip`
  const stageRoot = path.join(
    getKbRoot(),
    '_export-stage',
    `pack-${Date.now().toString(36)}`,
  )
  const packName = path.basename(zipPath, '.zip')
  const stage = path.join(stageRoot, packName)
  ensureDir(stage)

  try {
    const manifest = {
      format: 'sama-share-pack',
      format_version: 1,
      created_at: new Date().toISOString(),
      app_version: '1.1.0',
      includes: {
        docs: includeUserDocs,
        user_databases: includeUserDb,
        bundled_mtkb: includeBundledMtkb,
      },
    }

    if (includeUserDocs) {
      const docsSrc = path.join(getKbRoot(), 'docs')
      const docsDest = path.join(stage, 'docs')
      ensureDir(docsDest)
      // 导出用户可见资料；跳过导出暂存
      for (const name of fs.readdirSync(docsSrc)) {
        if (name === '_export-stage') continue
        const from = path.join(docsSrc, name)
        const to = path.join(docsDest, name)
        const st = fs.statSync(from)
        if (st.isDirectory()) copyTree(from, to)
        else copyFile(from, to)
      }
    }

    if (includeUserDb) {
      const reg = loadUserDbRegistry()
      const dbDest = path.join(stage, 'databases')
      ensureDir(dbDest)
      const exported = []
      for (const db of reg.databases || []) {
        if (!db?.path || !fs.existsSync(db.path)) continue
        const name = path.basename(db.path)
        copyFile(db.path, path.join(dbDest, name))
        exported.push({ id: db.id, label: db.label, file: name })
      }
      // 若用户没有单独导入库，但希望带上内置库的轻量说明，则不在此复制 368MB
      writeJson(path.join(stage, 'databases', 'registry.json'), { databases: exported })
      manifest.exported_databases = exported
    }

    if (includeBundledMtkb) {
      const mtkbRoot = getMtkbRoot()
      if (fs.existsSync(mtkbRoot)) {
        copyTree(mtkbRoot, path.join(stage, 'mtkb'))
        manifest.includes.bundled_mtkb = true
      } else {
        manifest.includes.bundled_mtkb = false
        manifest.mtkb_warning = '本机未找到内置 MTKB 资源'
      }
    }

    writeJson(path.join(stage, 'package.json'), manifest)
    fs.writeFileSync(
      path.join(stage, '请读我.txt'),
      `SAMA 知识分享包
================
1. 把本 zip 完整发给对方。
2. 对方在 SAMA「设置 → 导入资料入库」中选择解压后的文件夹（或本 zip 解压目录）。
3. 也可只把 docs / databases 拷进对方资料目录后点「构建/更新知识库」。

包含：
- docs：文本知识（参与切片索引）
- databases：用户接入的 SQLite（若有）
- mtkb：完整内置机床库（仅当导出时勾选，体积很大）

创建时间：${manifest.created_at}
`,
      'utf8',
    )

    ensureDir(path.dirname(zipPath))
    // 压缩 stage 本身，使 zip 根目录即为分享包（含 package.json）
    zipDirectoryWithDotNet(stage, zipPath)

    // 自动化测试传入 outputPath 时不抢焦点弹资源管理器
    if (!opts.outputPath) {
      await shell.showItemInFolder(zipPath)
    }
    return {
      ok: true,
      path: zipPath,
      note: `已生成分享包：${path.basename(zipPath)}`,
      manifest,
    }
  } finally {
    try {
      fs.rmSync(stageRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

export function listImportedDatabases() {
  const reg = loadUserDbRegistry()
  return (reg.databases || []).map((d) => ({
    id: d.id,
    label: d.label,
    path: d.path,
    exists: Boolean(d.path && fs.existsSync(d.path)),
    importedAt: d.importedAt,
  }))
}

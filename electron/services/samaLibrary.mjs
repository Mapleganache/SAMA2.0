/**
 * 用户可找到的分类文件库：桌面「SAMA文件」+ 工程沙箱同名目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import { ensureDir } from './paths.mjs'
import { writeWorkspaceFile, getWorkspaceRoot } from './workspace.mjs'

export const LIBRARY_NAME = 'SAMA文件'

export const CATEGORIES = [
  { id: 'gcode', dir: '01_加工程序', label: '加工程序', exts: ['.nc', '.cnc', '.gcode', '.mpf', '.spf', '.tap', '.iso', '.prg', '.ngc'] },
  { id: 'drawings', dir: '02_图纸', label: '图纸', exts: ['.svg', '.dxf'] },
  { id: 'electrical', dir: '03_电路图', label: '电路图', exts: ['.svg', '.dxf'] },
  { id: 'ladder', dir: '04_梯形图', label: '梯形图', exts: ['.txt', '.md'] },
  { id: 'hmi', dir: '05_画面', label: '画面', exts: ['.xml', '.fp2', '.fp', '.fpp'] },
  { id: 'docs', dir: '06_说明文档', label: '说明文档', exts: ['.md', '.txt', '.csv'] },
  { id: 'other', dir: '07_其它', label: '其它', exts: [] },
]

function desktopRoot() {
  try {
    return app.getPath('desktop')
  } catch {
    return path.join(os.homedir(), 'Desktop')
  }
}

export function getDesktopLibraryRoot() {
  return path.join(desktopRoot(), LIBRARY_NAME)
}

export function getWorkspaceLibraryRoot() {
  return path.join(getWorkspaceRoot(), LIBRARY_NAME)
}

export function isLibraryRel(rel) {
  const n = String(rel || '').replace(/\\/g, '/')
  return n === LIBRARY_NAME || n.startsWith(`${LIBRARY_NAME}/`)
}

function categoryReadme(cat) {
  if (cat.id === 'gcode') {
    return `# ${cat.label}

FANUC / 高桥 / 米克罗莎：文件名就是程序号，例如 \`O0001\`、\`O8205\`，**不要加 .nc**（跟机床存储卡一样）。
西门子：\`_N_程序名_MPF\`。
`
  }
  return `# ${cat.label}

本目录由 SAMA 自动分类。把${cat.label}放到这里，便于查找。
`
}

export function classifyByName(fileName, hint = '') {
  const base = path.basename(String(fileName || ''))
  const ext = path.extname(base).toLowerCase()
  const h = `${hint} ${fileName}`
  const gcode = CATEGORIES.find((c) => c.id === 'gcode')
  if (/^O\d{1,8}$/i.test(base) || /^_N_[A-Z0-9_]+_MPF$/i.test(base)) return gcode
  if (/电路|原理图|schematic|elec/i.test(h)) return CATEGORIES.find((c) => c.id === 'electrical')
  if (/梯形|ladder|pmc|助记符/i.test(h)) return CATEGORIES.find((c) => c.id === 'ladder')
  if (/画面|picture|fpicture|\.fp2|\.fp\b/i.test(h)) return CATEGORIES.find((c) => c.id === 'hmi')
  if (/图纸|零件图|dxf|svg/i.test(h) && !/\.(nc|mpf|gcode|cnc|tap|iso|prg|ngc)$/i.test(fileName || '')) {
    return CATEGORIES.find((c) => c.id === 'drawings')
  }
  if (gcode.exts.includes(ext)) return gcode
  const hmi = CATEGORIES.find((c) => c.id === 'hmi')
  if (hmi.exts.includes(ext)) return hmi
  const drawings = CATEGORIES.find((c) => c.id === 'drawings')
  if (drawings.exts.includes(ext)) return drawings
  const docs = CATEGORIES.find((c) => c.id === 'docs')
  if (docs.exts.includes(ext)) return docs
  return CATEGORIES.find((c) => c.id === 'other')
}

export function sanitizeFolder(name, fallback = '未命名') {
  const s = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 48)
  return s || fallback
}

export function sanitizeFileName(name, fallback = '未命名.txt') {
  const raw = String(name || '').trim() || fallback
  if (/^O\d{1,8}$/i.test(raw)) return `O${raw.slice(1)}`
  if (/^_N_[A-Z0-9_]+_MPF$/i.test(raw)) return raw
  const ext = path.extname(raw)
  const stem = path.basename(raw, ext)
  return `${sanitizeFolder(stem, '未命名')}${ext || '.txt'}`
}

export function programNameFromNc(nc, fallback = 'O1000') {
  const src = String(nc || '')
  const o = src.match(/^\s*O(\d{1,8})\b/im)
  if (o) return `O${o[1]}`
  const mpf = src.match(/%_N_([A-Z0-9_]+)_MPF/i)
  if (mpf) return `_N_${mpf[1]}_MPF`
  return fallback
}

/** 跟机床存储一致：FANUC 用 O 程序号无后缀；西门子用 _N_名字_MPF */
export function shopGcodeFileName(nc, { machine = '', name = '' } = {}) {
  const forced = String(name || '').trim()
  if (/^O\d{1,8}$/i.test(forced)) return `O${forced.slice(1)}`
  if (/^_N_[A-Z0-9_]+_MPF$/i.test(forced)) return forced
  const fromProg = programNameFromNc(nc, '')
  if (/^O\d{1,8}$/i.test(fromProg) || /^_N_[A-Z0-9_]+_MPF$/i.test(fromProg)) return fromProg
  if (/siemens|840\s*d|cycle407|studer/i.test(machine)) {
    return `_N_${sanitizeFolder(forced || 'PROG', 'PROG')}_MPF`
  }
  return `O${String(Date.now()).slice(-4)}`
}

export function saveGcodeToLibrary({ content, machine = '', name = '' }) {
  const nc = String(content || '').trim()
  if (!nc) throw new Error('没有可保存的 G 代码')
  const machineDir = sanitizeFolder(machine, '未填机床')
  const file = shopGcodeFileName(nc, { machine, name })
  const relativePath = `${CATEGORIES[0].dir}/${machineDir}/${file}`
  return saveLibraryText({ relativePath, content: nc.endsWith('\n') ? nc : `${nc}\n` })
}

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, content, 'utf8')
}

export function ensureLibraryFolders() {
  const roots = [getWorkspaceLibraryRoot(), getDesktopLibraryRoot()]
  const index = `# SAMA 文件库

按类型存放。加工页点「生成 G 代码文件」会同时写入工程沙箱和桌面。

| 文件夹 | 内容 |
|--------|------|
${CATEGORIES.map((c) => `| ${c.dir} | ${c.label} |`).join('\n')}

加工程序可再按机床分子目录，例如 \`01_加工程序/STUDER_S40/\`。
`
  for (const root of roots) {
    try {
      ensureDir(root)
      writeIfMissing(path.join(root, 'README.md'), index)
      for (const cat of CATEGORIES) {
        const dir = path.join(root, cat.dir)
        ensureDir(dir)
        writeIfMissing(path.join(dir, '说明.md'), categoryReadme(cat))
      }
    } catch {
      // 桌面不可写时仍保留工程沙箱一份
    }
  }
  return {
    workspace: getWorkspaceLibraryRoot(),
    desktop: getDesktopLibraryRoot(),
  }
}

export function rewriteToLibraryRel(rawPath) {
  const p = String(rawPath || '')
    .replace(/\\/g, '/')
    .trim()
  if (!p || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return p
  if (/^(projects|libraries|evals)\//i.test(p)) return p
  if (p === LIBRARY_NAME || new RegExp(`^${LIBRARY_NAME}/`, 'i').test(p)) {
    return p.replace(/^SAMA文件/i, LIBRARY_NAME)
  }
  for (const cat of CATEGORIES) {
    if (p === cat.dir || p.startsWith(`${cat.dir}/`)) {
      return `${LIBRARY_NAME}/${p}`
    }
  }
  const base = path.posix.basename(p)
  const cat = classifyByName(base, p)
  return `${LIBRARY_NAME}/${cat.dir}/${p.replace(/^\/+/, '')}`
}

export function desktopPathForLibraryRel(rel) {
  const n = String(rel || '').replace(/\\/g, '/')
  if (!isLibraryRel(n)) return ''
  const rest = n === LIBRARY_NAME ? '' : n.slice(LIBRARY_NAME.length).replace(/^[\\/]/, '')
  return rest
    ? path.join(getDesktopLibraryRoot(), rest.replaceAll('/', path.sep))
    : getDesktopLibraryRoot()
}

export function syncLibraryFileToDesktop(rel, content) {
  const desk = desktopPathForLibraryRel(rel)
  if (!desk) return null
  ensureDir(path.dirname(desk))
  fs.writeFileSync(desk, content, 'utf8')
  return desk
}

export function syncLibraryDirToDesktop(rel) {
  const desk = desktopPathForLibraryRel(rel)
  if (!desk) return null
  ensureDir(desk)
  return desk
}

export function mkdirLibraryRel(relInside, { readme = '' } = {}) {
  ensureLibraryFolders()
  const rewritten = rewriteToLibraryRel(relInside)
  const rest = String(rewritten)
    .replace(/\\/g, '/')
    .replace(new RegExp(`^${LIBRARY_NAME}/?`), '')
  if (!rest || rest.includes('..')) throw new Error('文件夹路径不合法')
  const ws = path.join(getWorkspaceLibraryRoot(), rest.replaceAll('/', path.sep))
  const desk = path.join(getDesktopLibraryRoot(), rest.replaceAll('/', path.sep))
  ensureDir(ws)
  try {
    ensureDir(desk)
  } catch {
    // 桌面镜像失败不阻断
  }
  if (readme) {
    writeIfMissing(path.join(ws, '说明.md'), readme)
    try {
      writeIfMissing(path.join(desk, '说明.md'), readme)
    } catch {
      /* ignore */
    }
  }
  return {
    ok: true,
    path: `${LIBRARY_NAME}/${rest}`.replace(/\\/g, '/'),
    desktopPath: desk,
  }
}

export function saveLibraryText({ relativePath, content }) {
  ensureLibraryFolders()
  const rel = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  const under = rel.startsWith(`${LIBRARY_NAME}/`) ? rel : `${LIBRARY_NAME}/${rel}`
  const r = writeWorkspaceFile(under, content)
  return {
    ok: true,
    path: r.path,
    absPath: r.absPath,
    desktopPath: desktopPathForLibraryRel(r.path),
    created: r.created,
    bytes: r.bytes,
  }
}

export function saveNamedFileToLibrary({ name, content = '', hint = '' }) {
  const raw = String(name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
  if (!raw) throw new Error('文件名为空')
  let relativePath
  if (raw.includes('/')) {
    relativePath = rewriteToLibraryRel(raw).replace(new RegExp(`^${LIBRARY_NAME}/`), '')
    const dir = path.posix.dirname(relativePath)
    const file = sanitizeFileName(path.posix.basename(relativePath))
    relativePath = dir && dir !== '.' ? `${dir}/${file}` : file
  } else {
    const fileName = sanitizeFileName(raw)
    const cat = classifyByName(fileName, hint)
    relativePath = `${cat.dir}/${fileName}`
  }
  return saveLibraryText({ relativePath, content: String(content ?? '') })
}

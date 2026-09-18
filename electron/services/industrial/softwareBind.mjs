/**
 * 把本机工业软件（SolidWorks / LADDER-III / Mastercam 等）绑到「外部软件」适配器。
 * 只认白名单 exe，不扫全盘乱执行。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSettings, saveSettingsRaw } from '../store.mjs'
import { resolveFladderPath } from '../fanucLadderIii.mjs'

export const BINDABLE = {
  'cad.null': {
    title: 'CAD 软件',
    exes: ['SLDWORKS.exe', 'FreeCAD.exe', 'FreeCADCmd.exe', 'acad.exe', 'Inventor.exe'],
    folderHints: ['solidworks', 'freecad', 'autodesk', 'inventor', 'autocad', 'cad'],
    exact: [
      'C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.exe',
      'C:\\Program Files\\Dassault Systemes\\SOLIDWORKS\\SLDWORKS.exe',
      'D:\\CAD\\bin\\FreeCAD.exe',
      'D:\\CAD\\bin\\freecad.exe',
      'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCAD.exe',
      'C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCAD.exe',
      'C:\\Program Files\\FreeCAD 0.21\\bin\\FreeCAD.exe',
      'C:\\Program Files\\Autodesk\\AutoCAD 2025\\acad.exe',
      'C:\\Program Files\\Autodesk\\AutoCAD 2024\\acad.exe',
      'C:\\Program Files\\Autodesk\\Inventor 2025\\Bin\\Inventor.exe',
      '/Applications/FreeCAD.app/Contents/MacOS/FreeCAD',
      '/Applications/SolidWorks.app/Contents/MacOS/SOLIDWORKS',
    ],
    offHint: '没找到 SolidWorks / FreeCAD / AutoCAD。可扫描本机，或选安装目录。',
  },
  'electrical.null': {
    title: '电气软件',
    exes: ['W3u.exe', 'EPLAN.exe', 'acade.exe'],
    folderHints: ['eplan', 'electrical', 'autodesk'],
    exact: [
      'D:\\EPLAN\\Electric P8\\2.9\\Bin\\W3u.exe',
      'D:\\EPLAN\\Platform\\2.9\\Bin\\W3u.exe',
      'C:\\Program Files\\EPLAN\\Electric P8\\2.9\\Bin\\W3u.exe',
      'C:\\Program Files\\EPLAN\\Platform\\2.9\\Bin\\W3u.exe',
      'C:\\Program Files\\EPLAN\\Platform\\2024\\Bin\\W3u.exe',
      'C:\\Program Files\\EPLAN\\Electric P8\\Bin\\W3u.exe',
      'C:\\Program Files (x86)\\EPLAN\\Electric P8\\Bin\\W3u.exe',
    ],
    offHint: '没找到 EPLAN。可扫描本机，或选安装目录。',
  },
  'plc.null': {
    title: 'PLC 软件',
    exes: ['fladder.exe', 'Fladder.exe', 'FLADDER.EXE'],
    folderHints: ['fanuc', 'ladder'],
    exact: [
      'C:\\Program Files\\FANUC\\FANUC LADDER-III\\fladder.exe',
      'C:\\Program Files (x86)\\FANUC\\FANUC LADDER-III\\fladder.exe',
      'C:\\FANUC\\FANUC LADDER-III\\fladder.exe',
      'D:\\FANUC\\FANUC LADDER-III\\fladder.exe',
      'D:\\FANUC SOFTWARE\\FANUC LADDER-III\\fladder.exe',
      'D:\\机床软件\\FANUC LADDER-III\\fladder.exe',
    ],
    offHint: '没找到 FANUC LADDER-III（fladder.exe）。可扫描本机，或选安装目录。',
  },
  'cam.null': {
    title: 'CAM 软件',
    exes: ['Mastercam.exe', 'mastercam.exe', 'PowerMill.exe', 'ugraf.exe', 'Fusion360.exe'],
    folderHints: ['mastercam', 'cnc software', 'powermill', 'autodesk', 'ugs', 'siemens', 'nx'],
    exact: [
      'C:\\Program Files\\Mastercam 2025\\Mastercam.exe',
      'C:\\Program Files\\Mastercam 2024\\Mastercam.exe',
      'C:\\Program Files\\Autodesk\\Fusion 360\\Fusion360.exe',
      'C:\\Program Files\\Autodesk\\PowerMill 2025\\sys\\exec64\\PowerMill.exe',
    ],
    offHint: '没找到 Mastercam / PowerMill 等 CAM。可扫描本机，或选安装目录。',
  },
}

const SKIP_DIR = new Set([
  'windows',
  'winsxs',
  '$recycle.bin',
  'node_modules',
  'system volume information',
  'appdata',
  'windowsapps',
])

export function isBindable(adapterId) {
  return Boolean(BINDABLE[adapterId])
}

export function getSoftwarePaths() {
  const s = loadSettings()
  const raw = s.softwarePaths
  return raw && typeof raw === 'object' ? { ...raw } : {}
}

export function resolveBoundExe(adapterId) {
  const saved = String(getSoftwarePaths()[adapterId] || '').trim()
  if (saved && fs.existsSync(saved)) return path.resolve(saved)
  if (adapterId === 'plc.null') {
    const s = loadSettings()
    const fl = resolveFladderPath(s.fladderPath || '')
    if (fl) return fl
  }
  if (adapterId === 'electrical.null') {
    const s = loadSettings()
    const ep = String(s.eplanPath || '').trim()
    if (ep && fs.existsSync(ep)) {
      const st = fs.statSync(ep)
      if (st.isFile()) return path.resolve(ep)
    }
  }
  return ''
}

export function bindSoftwarePath(adapterId, exePath) {
  const exe = path.resolve(String(exePath || ''))
  if (!exe || !fs.existsSync(exe)) {
    return { ok: false, error: '路径不存在' }
  }
  const prev = loadSettings()
  const softwarePaths = { ...getSoftwarePaths(), [adapterId]: exe }
  const extra =
    adapterId === 'plc.null'
      ? { fladderPath: exe }
      : adapterId === 'electrical.null'
        ? { eplanPath: exe }
        : {}
  saveSettingsRaw({ softwarePaths, ...extra })
  return { ok: true, adapterId, path: exe, name: path.basename(exe) }
}

export function detectBound(adapterId) {
  const spec = BINDABLE[adapterId]
  const exe = resolveBoundExe(adapterId)
  if (exe) {
    return {
      available: true,
      adapterId,
      path: exe,
      bindable: true,
      message: `已找到 ${path.basename(exe)}`,
    }
  }
  return {
    available: false,
    adapterId,
    bindable: Boolean(spec),
    message: spec?.offHint || '未找到软件，可扫描本机或指定安装目录',
  }
}

function defaultScanRoots() {
  const roots = []
  const pf = process.env['ProgramFiles']
  const pf86 = process.env['ProgramFiles(x86)']
  const home = os.homedir()
  if (pf) roots.push(pf)
  if (pf86) roots.push(pf86)
  roots.push(
    'D:\\EPLAN',
    'D:\\Program Files',
    'D:\\机床软件',
    'D:\\CAD',
    'D:\\FANUC SOFTWARE',
    'D:\\FANUC',
    'E:\\机床软件',
  )
  if (process.platform === 'darwin') {
    roots.push('/Applications', path.join(home, 'Applications'))
  }
  roots.push(path.join(home, 'Desktop'), 'D:\\')
  return [...new Set(roots.filter((p) => p && fs.existsSync(p)))]
}

function walkFind(root, exeNames, { maxDepth = 5, folderHints = [], maxVisit = 6000 } = {}) {
  const want = new Set(exeNames.map((n) => n.toLowerCase()))
  const queue = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length && visited < maxVisit) {
    const { dir, depth } = queue.shift()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      visited += 1
      const full = path.join(dir, ent.name)
      if (ent.isFile() || ent.isSymbolicLink()) {
        if (want.has(ent.name.toLowerCase()) && fs.existsSync(full)) return full
        continue
      }
      if (!ent.isDirectory() || depth >= maxDepth) continue
      const low = ent.name.toLowerCase()
      if (SKIP_DIR.has(low) || low.startsWith('.')) continue
      if (folderHints.length && depth === 0) {
        if (!folderHints.some((h) => low.includes(h))) continue
      }
      queue.push({ dir: full, depth: depth + 1 })
    }
  }
  return ''
}

function lookNearRoot(root, exes) {
  const names = Array.isArray(exes) ? exes : []
  for (const n of names) {
    const candidates = [path.join(root, n), path.join(root, 'bin', n)]
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return path.resolve(p)
    }
  }
  return ''
}

function lookExact(spec) {
  for (const p of spec.exact || []) {
    if (p && fs.existsSync(p)) return path.resolve(p)
  }
  return ''
}

/**
 * @param {string} adapterId
 * @param {string} [extraRoot] 用户指定的安装目录
 */
export function scanForAdapter(adapterId, extraRoot = '') {
  const spec = BINDABLE[adapterId]
  if (!spec) return ''
  const already = resolveBoundExe(adapterId)
  if (already && !extraRoot) return already

  if (adapterId === 'plc.null' && !extraRoot) {
    const fl = resolveFladderPath('')
    if (fl) return fl
  }

  const hitExact = lookExact(spec)
  if (hitExact && !extraRoot) return hitExact

  if (extraRoot) {
    const root = path.resolve(extraRoot)
    if (!fs.existsSync(root)) return ''
    const st = fs.statSync(root)
    if (st.isFile()) {
      const base = path.basename(root).toLowerCase()
      if (spec.exes.some((e) => e.toLowerCase() === base)) return root
      return ''
    }
    const inRoot = lookNearRoot(root, spec.exes)
    if (inRoot) return inRoot
    return walkFind(root, spec.exes, { maxDepth: 7, folderHints: [], maxVisit: 12000 })
  }

  for (const root of defaultScanRoots()) {
    const near = lookNearRoot(root, spec.exes)
    if (near) return near
    const found = walkFind(root, spec.exes, {
      maxDepth: 4,
      folderHints: spec.folderHints,
      maxVisit: 4000,
    })
    if (found) return found
  }
  return ''
}

export function scanAndBind(adapterId, extraRoot = '') {
  const found = scanForAdapter(adapterId, extraRoot)
  if (!found) {
    const spec = BINDABLE[adapterId]
    return {
      ok: false,
      adapterId,
      error: extraRoot
        ? `这个目录里没找到 ${spec?.title || adapterId}（需要 ${spec?.exes?.slice(0, 3).join(' / ') || '安装程序'}）`
        : spec?.offHint || '没扫到',
    }
  }
  const bound = bindSoftwarePath(adapterId, found)
  return { ...bound, scanned: true }
}

export function scanAllBindable() {
  const results = []
  for (const id of Object.keys(BINDABLE)) {
    const r = scanAndBind(id)
    results.push({
      adapterId: id,
      title: BINDABLE[id].title,
      ok: r.ok,
      path: r.path || '',
      error: r.error || '',
    })
  }
  return {
    ok: true,
    foundCount: results.filter((x) => x.ok).length,
    results,
  }
}

/**
 * 机床 / CNC 软件桌面桥接（Phase 5）
 *
 * 只做：探测、打开 GUI、聚焦窗口、观察、NC 备份。
 * 不做：把 Fladder CLI / 助记符改写 / LAD Allow 流水线塞进 DesktopToolManager。
 * LAD 深度编辑仍走现有 sama-allow-ladder / fanucLadderIii。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { assertAllowedUserAbs, normalizeAbs, getAllowedRoots } from '../safeFs.mjs'
import { applicationFind, applicationLaunch, applicationIsRunning } from './applicationManager.mjs'
import { windowList, windowFocus } from './windowManager.mjs'
import { fileCopy, fileExists, resolveUserPath } from './fileManager.mjs'
import {
  resolveFladderPath,
  probeLadderIii,
  openLadInLadderIii,
  resolveUsableLadPath,
} from '../fanucLadderIii.mjs'
import { launchGuiApp } from '../guiLaunch.mjs'

/** 机床相关已知应用（有限白名单，不扫全盘乱执行） */
export const CNC_KNOWN_APPS = [
  {
    id: 'ladder3',
    names: [
      'ladder-iii',
      'ladder3',
      'ladder iii',
      'fanuc ladder',
      'fanuc ladder-iii',
      'fladder',
      '梯子',
      '梯形图',
      '梯子软件',
      'ladder',
    ],
    windowHints: ['ladder', 'fladder', 'fanuc ladder'],
    paths: [], // 运行时由 resolveFladderPath 填充
    kind: 'ladder',
  },
  {
    id: 'picture',
    names: [
      'fanuc picture',
      'picture',
      'fpicture',
      '画面',
      '画面软件',
      'picture软件',
    ],
    windowHints: ['picture', 'fpicture', 'fanuc picture'],
    paths: [
      'C:\\Program Files\\FANUC\\FANUC PICTURE\\FPicture.exe',
      'C:\\Program Files (x86)\\FANUC\\FANUC PICTURE\\FPicture.exe',
      'C:\\FANUC\\FANUC PICTURE\\FPicture.exe',
      'D:\\FANUC\\FANUC PICTURE\\FPicture.exe',
      'D:\\FANUC SOFTWARE\\FANUC PICTURE\\FPicture.exe',
      'D:\\机床软件\\FANUC PICTURE\\FPicture.exe',
    ],
    kind: 'picture',
  },
  {
    id: 'ncguide',
    names: ['ncguide', 'nc guide', 'fanuc ncguide', '导程', '仿真'],
    windowHints: ['ncguide', 'nc guide'],
    paths: [
      'C:\\Program Files\\FANUC\\NCGuide\\NCGuide.exe',
      'C:\\Program Files (x86)\\FANUC\\NCGuide\\NCGuide.exe',
      'D:\\FANUC\\NCGuide\\NCGuide.exe',
      'D:\\机床软件\\NCGuide\\NCGuide.exe',
    ],
    kind: 'sim',
  },
]

function normalizeName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function matchAppByName(name) {
  const n = normalizeName(name)
  if (!n) return null
  for (const app of CNC_KNOWN_APPS) {
    if (app.id === n || app.kind === n) return app
    if (app.names.some((x) => normalizeName(x) === n || normalizeName(x).includes(n) || n.includes(normalizeName(x)))) {
      return app
    }
  }
  return null
}

function resolvePicturePath(explicit = '') {
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit)
  for (const app of CNC_KNOWN_APPS) {
    if (app.id !== 'picture') continue
    for (const p of app.paths) {
      if (fs.existsSync(p)) return p
    }
  }
  return ''
}

function resolveNcGuidePath(explicit = '') {
  if (explicit && fs.existsSync(explicit)) return path.resolve(explicit)
  for (const app of CNC_KNOWN_APPS) {
    if (app.id !== 'ncguide') continue
    for (const p of app.paths) {
      if (fs.existsSync(p)) return p
    }
  }
  return ''
}

/** 列出机床相关软件及探测结果（诚实：未安装则 found=false） */
export function cncListApps(args = {}) {
  const fladderPath = resolveFladderPath(args.fladderPath || '')
  const picturePath = resolvePicturePath(args.picturePath || '')
  const ncguidePath = resolveNcGuidePath(args.ncguidePath || '')

  const apps = CNC_KNOWN_APPS.map((app) => {
    let resolved = null
    if (app.id === 'ladder3') resolved = fladderPath || null
    else if (app.id === 'picture') resolved = picturePath || null
    else if (app.id === 'ncguide') resolved = ncguidePath || null
    else resolved = (app.paths || []).find((p) => fs.existsSync(p)) || null

    let running = false
    if (resolved) {
      try {
        running = !!applicationIsRunning({ path: resolved, name: app.names[0] }).running
      } catch {
        running = false
      }
    }

    return {
      id: app.id,
      kind: app.kind,
      names: app.names,
      found: Boolean(resolved),
      path: resolved,
      running,
      candidates: app.paths || [],
    }
  })

  return {
    apps,
    foundCount: apps.filter((a) => a.found).length,
    note: 'LAD 助记符导出/改写仍走 sama-allow-ladder，不在本工具内执行。',
  }
}

/** 探测 LADDER-III / PICTURE 等 */
export function cncProbe(args = {}) {
  const ladder = probeLadderIii(args.fladderPath || '')
  const picture = resolvePicturePath(args.picturePath || '')
  const ncguide = resolveNcGuidePath(args.ncguidePath || '')
  return {
    ladder3: {
      found: ladder.found,
      path: ladder.fladderPath || '',
      hint: ladder.hint,
    },
    picture: {
      found: Boolean(picture),
      path: picture || '',
      hint: picture ? '已找到 FANUC PICTURE' : '未找到 FPicture.exe（常见 Program Files\\FANUC\\FANUC PICTURE）',
    },
    ncguide: {
      found: Boolean(ncguide),
      path: ncguide || '',
      hint: ncguide ? '已找到 NCGuide' : '未找到 NCGuide.exe',
    },
  }
}

/**
 * 打开机床软件（仅启动 GUI，不含 LAD CLI 编辑）
 */
export function cncOpenApp(args = {}) {
  const name = args.name || args.app || args.id || ''
  const matched = matchAppByName(name)
  if (!matched && !args.path) {
    const err = new Error(
      `未知机床软件: ${name || '(空)'}。可用: ladder3 / picture / ncguide，或提供 path`,
    )
    err.code = 'CNC_APP_UNKNOWN'
    err.data = { known: CNC_KNOWN_APPS.map((a) => a.id) }
    throw err
  }

  if (args.path) {
    const find = applicationFind({ path: args.path })
    if (!find.ok) {
      const err = new Error(find.message)
      err.code = find.code || 'APPLICATION_NOT_FOUND'
      throw err
    }
    const launch = applicationLaunch({ path: find.path, reuse: true, args: args.args })
    return { app: matched?.id || path.basename(find.path), path: find.path, launch }
  }

  if (matched.id === 'ladder3') {
    const exe = resolveFladderPath(args.fladderPath || '')
    if (!exe) {
      const err = new Error(
        '未找到 fladder.exe。请安装 FANUC LADDER-III，或在设置中填写路径。',
      )
      err.code = 'LADDER3_NOT_FOUND'
      throw err
    }
    const launch = applicationLaunch({ path: exe, reuse: true, args: args.args })
    return { app: 'ladder3', path: exe, launch }
  }

  if (matched.id === 'picture') {
    const exe = resolvePicturePath(args.picturePath || '')
    if (!exe) {
      const err = new Error('未找到 FANUC PICTURE（FPicture.exe）')
      err.code = 'PICTURE_NOT_FOUND'
      throw err
    }
    const launch = applicationLaunch({ path: exe, reuse: true, args: args.args })
    return { app: 'picture', path: exe, launch }
  }

  if (matched.id === 'ncguide') {
    const exe = resolveNcGuidePath(args.ncguidePath || '')
    if (!exe) {
      const err = new Error('未找到 NCGuide.exe')
      err.code = 'NCGUIDE_NOT_FOUND'
      throw err
    }
    const launch = applicationLaunch({ path: exe, reuse: true, args: args.args })
    return { app: 'ncguide', path: exe, launch }
  }

  const err = new Error(`无法打开: ${matched.id}`)
  err.code = 'CNC_OPEN_FAILED'
  throw err
}

/** 观察机床相关窗口 */
export function cncObserve(args = {}) {
  const list = windowList().windows || []
  const hints = (args.hints || CNC_KNOWN_APPS.flatMap((a) => a.windowHints)).map((h) =>
    String(h).toLowerCase(),
  )
  const re = new RegExp(hints.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
  const hits = list.filter((w) => re.test(String(w.title || '')))
  const probe = cncProbe(args)
  return {
    windowCount: hits.length,
    windows: hits.slice(0, 20),
    probe,
    allWindowCount: list.length,
  }
}

/** 聚焦机床软件窗口 */
export function cncFocus(args = {}) {
  const title =
    args.title ||
    (matchAppByName(args.name || args.app || '')?.windowHints?.[0] || args.name || 'ladder')
  const r = windowFocus({ title: String(title) })
  return { title, ...r }
}

/**
 * 用 LADDER-III GUI 打开 .LAD（桥接现有 openLadInLadderIii）
 * 不做助记符导出/改写；那仍需 sama-allow-ladder。
 */
export function cncOpenLad(args = {}) {
  const raw = args.lad || args.path || args.file || ''
  if (!raw) {
    const err = new Error('需要 .LAD 路径（lad / path）')
    err.code = 'LAD_PATH_REQUIRED'
    throw err
  }

  let abs
  try {
    abs = resolveUserPath(raw)
  } catch {
    abs = normalizeAbs(String(raw))
  }
  assertAllowedUserAbs(abs)

  if (!/\.lad$/i.test(abs)) {
    const err = new Error(`不是 .LAD 文件: ${abs}`)
    err.code = 'NOT_A_LAD'
    throw err
  }
  if (!fs.existsSync(abs)) {
    const err = new Error(`LAD 不存在: ${abs}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }

  const usable = resolveUsableLadPath(abs)
  if (!usable.ok) {
    const err = new Error(usable.error || 'LAD 路径不可用')
    err.code = 'LAD_UNUSABLE'
    throw err
  }

  const gui = openLadInLadderIii(usable.path, { fladderPath: args.fladderPath || '' })
  if (!gui.ok) {
    const err = new Error(gui.error || '打开 LADDER-III GUI 失败')
    err.code = gui.code || 'LADDER_GUI_OPEN_FAILED'
    err.data = gui
    throw err
  }

  return {
    success: true,
    lad: usable.path,
    gui,
    note: '仅打开 GUI。修改/导出助记符请用现有 LAD 允许流程，勿用本工具假装已改梯子。',
  }
}

/**
 * 打开 PICTURE 工程（.fp2 或目录）—— Shell 启动，不阻塞弹窗
 */
export function cncOpenPicture(args = {}) {
  const raw = args.path || args.fp2 || args.project || ''
  if (!raw) {
    return cncOpenApp({ name: 'picture', picturePath: args.picturePath })
  }

  let abs
  try {
    abs = resolveUserPath(raw)
  } catch {
    abs = normalizeAbs(String(raw))
  }
  assertAllowedUserAbs(abs)
  if (!fs.existsSync(abs)) {
    const err = new Error(`路径不存在: ${abs}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }

  const exe = resolvePicturePath(args.picturePath || '')
  if (exe) {
    const r = launchGuiApp({
      exe,
      args: [abs],
      cwd: path.dirname(exe),
      documentPath: abs,
      processNames: ['FPicture', 'fpicture', 'FANUC PICTURE'],
    })
    return {
      success: Boolean(r.ok),
      path: abs,
      exe,
      method: r.method || 'fpicture-shell',
      note: r.note,
      error: r.error,
    }
  }

  const r = launchGuiApp({ documentPath: abs, processNames: ['FPicture', 'fpicture'] })
  return {
    success: Boolean(r.ok),
    path: abs,
    exe: null,
    method: r.method || 'shell-assoc',
    note: r.note || '未找到 FPicture.exe，已用系统关联打开；若无关联请安装 FANUC PICTURE。',
    error: r.error,
  }
}

const NC_EXT = /\.(nc|cnc|mpf|spf|gcode|tap|iso|prg)$/i

/**
 * 备份 NC 程序到允许根目录（默认 workspace/cnc-backup 或 桌面/CNC_backup）
 * 不碰真实机床传输。
 */
export function cncBackupNc(args = {}) {
  const raw = args.source || args.path || args.file || args.nc || ''
  if (!raw) {
    const err = new Error('需要 NC 源路径（source / path）')
    err.code = 'NC_PATH_REQUIRED'
    throw err
  }

  let src
  try {
    src = resolveUserPath(raw)
  } catch {
    src = normalizeAbs(String(raw))
  }
  assertAllowedUserAbs(src)

  if (!NC_EXT.test(src)) {
    const err = new Error(`不是支持的 NC 扩展名: ${src}`)
    err.code = 'NOT_AN_NC'
    throw err
  }
  if (!fs.existsSync(src)) {
    const err = new Error(`文件不存在: ${src}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }

  const roots = getAllowedRoots()
  const workspace = roots.find((r) => /[\\/]workspace$/i.test(r))
  const desktop = roots.find((r) => /[\\/]Desktop$/i.test(r)) || path.join(os.homedir(), 'Desktop')

  let destDir
  if (args.targetDir || args.destDir || args.target) {
    const t = String(args.targetDir || args.destDir || args.target)
    try {
      destDir = resolveUserPath(t)
    } catch {
      destDir = normalizeAbs(t)
    }
  } else {
    destDir = workspace
      ? path.join(workspace, 'cnc-backup')
      : path.join(desktop, 'CNC_backup')
  }
  assertAllowedUserAbs(destDir)
  fs.mkdirSync(destDir, { recursive: true })

  const base = path.basename(src)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = path.join(destDir, args.keepName ? base : `${path.parse(base).name}_${stamp}${path.extname(base)}`)

  const copied = fileCopy({ source: src, target: dest, overwrite: true })
  const verify = fileExists({ path: dest })
  if (!verify.exists) {
    const err = new Error('备份后目标不存在')
    err.code = 'BACKUP_VERIFY_FAILED'
    err.data = { src, dest, copied }
    throw err
  }

  return {
    success: true,
    source: src,
    target: dest,
    bytes: fs.statSync(dest).size,
    note: '仅本地文件备份，未向机床发送程序。',
  }
}

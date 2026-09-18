/**
 * 本机 EPLAN Electric P8（W3u.exe）探测与打开 .elk。
 * 只启动 GUI，不改 .edb，不改许可文件，不走破解。
 *
 * 许可说明：
 * - 优先绑 **2.7.3**（本机已装于 D:\Program Files\EPLAN\...）。
 * - 2.9.4 常报「许可并非最新」；2.7 若报「lservrc 对本机无效」= 主机号不匹配，需合法重签发/加密狗。
 * - SAMA 只探测路径与许可文件是否存在，不能绕过 EPLAN 许可校验。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { bindSoftwarePath, getSoftwarePaths, resolveBoundExe } from './industrial/softwareBind.mjs'
import { launchGuiApp } from './guiLaunch.mjs'

const EXE_NAMES = new Set(['w3u.exe', 'eplan.exe'])

/** 本机默认安装点（设置占位 / 一键填入） */
export const EPLAN_DEFAULT_W3U =
  'D:\\Program Files\\EPLAN\\Electric P8\\2.9.4\\Bin\\W3u.exe'

/** 许可优先序：本机现装 2.9.4；旧机可改绑 2.7 */
export const EPLAN_PREFERRED_VERSION = '2.9'

export const EPLAN_CANDIDATE_PATHS = [
  // 优先：本机已装 2.9.4
  EPLAN_DEFAULT_W3U,
  'D:\\Program Files\\EPLAN\\Platform\\2.9.4\\Bin\\EPLAN.exe',
  'D:\\Program Files\\EPLAN\\Platform\\2.9.4\\Bin\\W3u.exe',
  // 其次：2.7.3
  'D:\\Program Files\\EPLAN\\Electric P8\\2.7.3\\Bin\\W3u.exe',
  'D:\\Program Files\\EPLAN\\Platform\\2.7.3\\Bin\\W3u.exe',
  'D:\\EPLAN\\Electric P8\\2.7.3\\Bin\\W3u.exe',
  'D:\\EPLAN\\Electric P8\\2.7.3.11418\\Bin\\W3u.exe',
  'D:\\EPLAN\\Electric P8\\2.7\\Bin\\W3u.exe',
  'D:\\EPLAN\\Platform\\2.7\\Bin\\W3u.exe',
  'C:\\Program Files\\EPLAN\\Electric P8\\2.7\\Bin\\W3u.exe',
  'C:\\Program Files\\EPLAN\\Electric P8\\2.7.3\\Bin\\W3u.exe',
  // 其次：2.8（若日后装上）
  'D:\\EPLAN\\Electric P8\\2.8\\Bin\\W3u.exe',
  'D:\\EPLAN\\Platform\\2.8\\Bin\\W3u.exe',
  'D:\\EPLAN\\Electric P8\\2.8.6\\Bin\\W3u.exe',
  'C:\\Program Files\\EPLAN\\Electric P8\\2.8\\Bin\\W3u.exe',
  'C:\\Program Files\\EPLAN\\Platform\\2.8\\Bin\\W3u.exe',
  // 再次：2.9 系列（许可更新后才稳）
  'D:\\EPLAN\\Electric P8\\2.9\\Bin\\W3u.exe',
  'D:\\EPLAN\\Platform\\2.9\\Bin\\W3u.exe',
  'D:\\EPLAN\\Electric P8\\2.9.3\\Bin\\W3u.exe',
  'D:\\EPLAN\\Electric P8\\2.9.4\\Bin\\W3u.exe',
  'D:\\EPLAN\\Platform\\2.9.4\\Bin\\W3u.exe',
  'C:\\Program Files\\EPLAN\\Electric P8\\2.9\\Bin\\W3u.exe',
  'C:\\Program Files\\EPLAN\\Platform\\2.9\\Bin\\W3u.exe',
  'C:\\Program Files\\EPLAN\\Electric P8\\Bin\\W3u.exe',
  'C:\\Program Files (x86)\\EPLAN\\Electric P8\\Bin\\W3u.exe',
]

const SCAN_ROOTS = [
  'D:\\Program Files\\EPLAN',
  'D:\\EPLAN',
  'C:\\Program Files\\EPLAN',
  'C:\\Program Files (x86)\\EPLAN',
]

const LICENSE_PATHS = {
  lservrc: 'C:\\Users\\Public\\EPLAN\\Common\\lservrc',
  lit: 'C:\\ProgramData\\EPLAN\\Common\\EplanCommon.lit',
  lir: 'C:\\ProgramData\\EPLAN\\Common\\EplanCommon.lir',
}

/** 只检查许可文件是否存在；不读取/不修改许可内容。 */
export function inspectEplanLicenseFiles() {
  const lservrc = fs.existsSync(LICENSE_PATHS.lservrc)
  const lit = fs.existsSync(LICENSE_PATHS.lit)
  const lir = fs.existsSync(LICENSE_PATHS.lir)
  let litLirMismatch = false
  let litLirHint = ''
  if (lit && lir) {
    try {
      const litStat = fs.statSync(LICENSE_PATHS.lit)
      const lirStat = fs.statSync(LICENSE_PATHS.lir)
      const gapDays = Math.abs(litStat.mtimeMs - lirStat.mtimeMs) / (86400 * 1000)
      if (gapDays > 30 || lirStat.mtimeMs < litStat.mtimeMs - 86400000) {
        litLirMismatch = true
        litLirHint =
          'EplanCommon.lit 与 EplanCommon.lir 版本不同步（弹窗「并非最新」）。请以管理员运行 scripts/reinstall-eplan-license-admin.ps1 重装许可客户端，然后重启电脑。'
      }
    } catch {
      /* ignore */
    }
  }
  let clientService = 'unknown'
  if (process.platform === 'win32') {
    try {
      const out = execSync('sc query "EPLAN Client Service"', { encoding: 'utf8', windowsHide: true, timeout: 8000 })
      clientService = /RUNNING/i.test(out) ? 'running' : /STOPPED/i.test(out) ? 'stopped' : 'installed'
    } catch {
      clientService = 'missing'
    }
  }
  const baseHint = lservrc
    ? '已检测到 lservrc。若 EPLAN 弹「对本机无效」，说明该许可未绑定本机主机号，需合法重签发或使用匹配的加密狗；SAMA 无法绕过。'
    : lit || lir
      ? '未找到 lservrc，仅有旧 Softlock（.lit/.lir）。2.7/2.9 可能仍无法启动，请配置合法许可。'
      : '未找到 EPLAN 许可文件（lservrc / .lit）。请先安装许可客户端并导入合法许可。'
  return {
    lservrc,
    lit,
    lir,
    litLirMismatch,
    clientService,
    lservrcPath: LICENSE_PATHS.lservrc,
    litPath: LICENSE_PATHS.lit,
    lirPath: LICENSE_PATHS.lir,
    hint: litLirMismatch ? litLirHint : baseHint,
  }
}


let sessionAllowEplan = false

export function setEplanSessionAllow(allowed) {
  sessionAllowEplan = Boolean(allowed)
  return sessionAllowEplan
}

export function getEplanSessionAllow() {
  return sessionAllowEplan
}

const EPLAN_CONFLICT_IMAGES = ['W3u', 'EPLAN', 'Eplan', 'Sama.Eplan29Bridge']

/** 列出可能占用 EPLAN API 的进程（仅 Windows）。 */
export function findEplanConflicts() {
  if (process.platform !== 'win32') return []
  const found = []
  for (const name of EPLAN_CONFLICT_IMAGES) {
    try {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${name}.exe" /NH`, { encoding: 'utf8', windowsHide: true, timeout: 8000 })
      if (out && out.toLowerCase().includes(`${name.toLowerCase()}.exe`)) found.push(name)
    } catch {
      /* ignore */
    }
  }
  return found
}

/** 结束冲突进程，便于 API 离线初始化（调用前请先保存 EPLAN 工程）。 */
export function killEplanConflicts() {
  if (process.platform !== 'win32') return { ok: false, killed: [] }
  const killed = []
  for (const name of EPLAN_CONFLICT_IMAGES) {
    try {
      execSync(`taskkill /F /IM ${name}.exe /T`, { encoding: 'utf8', windowsHide: true, timeout: 15000 })
      killed.push(name)
    } catch {
      /* not running or access denied */
    }
  }
  return { ok: true, killed }
}

function desktopDir() {
  try {
    const { app } = require('electron')
    if (app?.getPath) return app.getPath('desktop')
  } catch {
    /* ignore */
  }
  return path.join(os.homedir(), 'Desktop')
}

export function defaultMikrosaElkPath() {
  return path.join(desktopDir(), '米克罗莎SASL32', 'MIKROSA SASL3 2 .elk')
}

export function detectEplanVersion(exePath = '') {
  const p = String(exePath || '').replace(/\\/g, '/')
  const m = p.match(/\/(?:Electric P8|Platform)\/(\d+\.\d+(?:\.\d+)?)\//i)
  if (m) return m[1]
  if (/\/2\.8(?:\.|\/)/i.test(p)) return '2.8'
  if (/\/2\.7(?:\.|\/)/i.test(p)) return '2.7'
  if (/\/2\.9(?:\.|\/)/i.test(p)) return '2.9'
  return ''
}

function versionRank(ver) {
  const v = String(ver || '')
  if (v.startsWith('2.9.4')) return 50
  if (v === '2.9' || v.startsWith('2.9')) return 40
  if (v.startsWith('2.8')) return 30
  if (v.startsWith('2.7')) return 20
  return 90
}

function pickPreferredExe(candidates) {
  const list = [...new Set((candidates || []).filter((p) => p && fs.existsSync(p)))]
  if (!list.length) return ''
  list.sort((a, b) => versionRank(detectEplanVersion(a)) - versionRank(detectEplanVersion(b)))
  return path.resolve(list[0])
}

function walkFindAllW3u(root, { maxDepth = 6, maxVisit = 8000 } = {}) {
  const found = []
  const queue = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length && visited < maxVisit) {
    const { dir, depth } = queue.shift()
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of ents) {
      visited += 1
      const full = path.join(dir, ent.name)
      if (ent.isFile()) {
        const base = ent.name.toLowerCase()
        if (base === 'w3u.exe') found.push(path.resolve(full))
      }
      if (!ent.isDirectory() || depth >= maxDepth) continue
      const low = ent.name.toLowerCase()
      if (low === 'windows' || low.startsWith('.') || low === 'crack') continue
      queue.push({ dir: full, depth: depth + 1 })
    }
  }
  return found
}

function walkFindExe(root, opts) {
  return pickPreferredExe(walkFindAllW3u(root, opts))
}

export function resolveEplanExe(explicit = '') {
  const given = String(explicit || '').trim()
  if (given && fs.existsSync(given)) {
    const st = fs.statSync(given)
    if (st.isFile() && EXE_NAMES.has(path.basename(given).toLowerCase())) return path.resolve(given)
    if (st.isDirectory()) {
      const hit = walkFindExe(given)
      if (hit) return hit
    }
  }

  const bound = resolveBoundExe('electrical.null')
  if (bound && fs.existsSync(bound)) return bound

  const saved = String(getSoftwarePaths()['electrical.null'] || '').trim()
  if (saved && fs.existsSync(saved)) return path.resolve(saved)

  const fromCandidates = pickPreferredExe(EPLAN_CANDIDATE_PATHS)
  if (fromCandidates) return fromCandidates

  const scanned = []
  for (const root of SCAN_ROOTS) {
    if (!fs.existsSync(root)) continue
    scanned.push(...walkFindAllW3u(root))
  }
  return pickPreferredExe(scanned)
}

export function probeEplan(explicit = '') {
  const license = inspectEplanLicenseFiles()
  const exe = resolveEplanExe(explicit)
  if (exe) {
    try {
      bindSoftwarePath('electrical.null', exe)
    } catch {
      /* ignore */
    }
    const version = detectEplanVersion(exe) || '未知'
    let versionHint = `已找到 EPLAN ${version}`
    if (version.startsWith('2.9')) {
      versionHint = `当前找到 ${version}。若弹「许可并非最新」，请改绑 ${EPLAN_PREFERRED_VERSION}（本机默认 ${EPLAN_DEFAULT_W3U}）。`
    } else if (version.startsWith('2.7') && license.lservrc) {
      versionHint = `已找到 EPLAN ${version}。若弹「lservrc 对本机无效」，需按本机 Host ID 合法重签发许可（SAMA 只绑路径，不改许可）。`
    }
    return {
      found: true,
      eplanPath: exe,
      eplanVersion: version,
      preferredVersion: EPLAN_PREFERRED_VERSION,
      defaultW3u: EPLAN_DEFAULT_W3U,
      license,
      hint: `${versionHint} · ${path.basename(exe)} · ${license.hint}`,
    }
  }
  return {
    found: false,
    eplanPath: '',
    eplanVersion: '',
    preferredVersion: EPLAN_PREFERRED_VERSION,
    defaultW3u: EPLAN_DEFAULT_W3U,
    license,
    hint: `未找到 W3u.exe。建议使用 ${EPLAN_DEFAULT_W3U}，或在设置里填写安装目录。${license.hint}`,
  }
}

/** 按机床型号 / 附件 / 桌面目录推断 .elk 工程路径 */
export function resolveElkFromContext({ elkPath = '', machineModel = '', pdfPath = '' } = {}) {
  const candidates = []
  const push = (p) => {
    const t = String(p || '').trim().replace(/^["']|["']$/g, '')
    if (t) candidates.push(t)
  }
  push(elkPath)
  const mm = String(machineModel || '').toUpperCase()
  if (mm.includes('MIKROSA') || mm.includes('SASL32') || mm.includes('米克罗莎')) {
    push(defaultMikrosaElkPath())
    push(path.join(desktopDir(), '米克罗莎SASL32'))
  }
  if (mm.includes('FAVRETTO') || mm.includes('MC160')) {
    push(path.join(desktopDir(), 'FAVRETTO_MC160'))
  }
  if (pdfPath) {
    const pdfDir = path.dirname(path.resolve(String(pdfPath)))
    push(pdfDir)
    push(path.join(pdfDir, '..'))
  }
  push(defaultMikrosaElkPath())
  try {
    const desk = desktopDir()
    if (fs.existsSync(desk)) {
      for (const ent of fs.readdirSync(desk, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        if (/mikrosa|sasl|favretto|eplan/i.test(ent.name)) {
          push(path.join(desk, ent.name))
        }
      }
    }
  } catch {
    /* ignore */
  }
  for (const c of candidates) {
    const r = resolveUsableElkPath(c)
    if (r.ok) return { ...r, source: c }
  }
  return {
    ok: false,
    path: '',
    error: '找不到 .elk 工程。请拖入 .elk、填写机床型号（如 MIKROSA SASL32），或把工程放在桌面对应文件夹。',
  }
}

export function resolveUsableElkPath(elkPath = '') {
  const raw = String(elkPath || '').trim().replace(/^["']|["']$/g, '')
  const candidates = []
  if (raw) candidates.push(raw)
  const def = defaultMikrosaElkPath()
  if (def) candidates.push(def)

  for (const c of candidates) {
    const abs = path.resolve(c)
    if (fs.existsSync(abs) && /\.elk$/i.test(abs)) {
      return { ok: true, path: abs, corrected: abs !== path.resolve(raw || abs) }
    }
  }
  if (raw && fs.existsSync(raw) && fs.statSync(raw).isDirectory()) {
    const elk = fs.readdirSync(raw).find((n) => /\.elk$/i.test(n))
    if (elk) {
      return { ok: true, path: path.join(raw, elk), corrected: true }
    }
  }
  return {
    ok: false,
    path: '',
    error: '找不到 .elk 工程。请拖入 MIKROSA SASL3 2 .elk，或给出完整路径。',
  }
}

export function launchEplan({ eplanPath = '' } = {}) {
  const exe = resolveEplanExe(eplanPath)
  if (!exe) {
    return { ok: false, error: probeEplan().hint }
  }
  const r = launchGuiApp({
    exe,
    args: [],
    cwd: path.dirname(exe),
    processNames: ['W3u', 'Eplan', 'EPLAN', 'MAX', 'EplanLicense'],
  })
  return {
    ok: r.ok,
    eplanPath: exe,
    method: r.method || 'w3u',
    note: r.note,
    error: r.error,
  }
}

/**
 * 用 EPLAN 打开 .elk（仅 GUI）。弹窗由用户点；SAMA 不阻塞等待。
 */
export function openElkInEplan(elkPath, { eplanPath = '' } = {}) {
  const resolved = resolveUsableElkPath(elkPath)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const elk = resolved.path
  const exe = resolveEplanExe(eplanPath)
  if (exe) {
    const r = launchGuiApp({
      exe,
      args: [elk],
      cwd: path.dirname(exe),
      documentPath: elk,
      processNames: ['W3u', 'Eplan', 'EPLAN', 'MAX', 'EplanLicense'],
    })
    return {
      ok: r.ok,
      eplanPath: exe,
      elkPath: elk,
      method: r.method || 'w3u',
      note: r.note,
      error: r.error,
    }
  }
  if (process.platform === 'win32') {
    const r = launchGuiApp({ documentPath: elk, processNames: ['W3u', 'Eplan', 'MAX'] })
    return {
      ok: r.ok,
      eplanPath: '',
      elkPath: elk,
      method: 'shell',
      note: r.note,
      error: r.error,
    }
  }
  return { ok: false, error: '未找到 W3u.exe，请在设置中填写 EPLAN 路径' }
}

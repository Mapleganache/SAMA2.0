/**
 * Android / ADB 工具层（不伪造设备在线）
 * 高层：emulator.open / android.installApk / android.launchApp
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { assertAllowedUserAbs, normalizeAbs, getAllowedRoots } from '../safeFs.mjs'
import { applicationFind, applicationLaunch, applicationIsRunning } from './applicationManager.mjs'
import { windowList } from './windowManager.mjs'

const ADB_CANDIDATES = [
  process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe') : '',
  process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe') : '',
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  'C:\\Program Files\\Netease\\MuMu\\nx_main\\tools\\adb.exe',
  'C:\\Program Files\\Netease\\MuMu Player 12\\shell\\adb.exe',
  'C:\\Program Files\\Netease\\MuMu\\emulator\\nemu\\EmulatorShell\\adb.exe',
  'D:\\Program Files\\Netease\\MuMu\\nx_main\\tools\\adb.exe',
  'adb.exe',
  'adb',
].filter(Boolean)

export function resolveAdbPath(explicit = '') {
  if (explicit) {
    const p = path.resolve(String(explicit))
    if (fs.existsSync(p)) return p
  }
  for (const c of ADB_CANDIDATES) {
    if (c === 'adb' || c === 'adb.exe') {
      const w = spawnSync('where', ['adb'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      if (w.status === 0) {
        const line = String(w.stdout || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => /\.exe$/i.test(l) && fs.existsSync(l))
        if (line) return line
      }
      continue
    }
    if (fs.existsSync(c)) return c
  }
  return null
}

function runAdb(args, { adbPath = '', timeoutMs = 60000, serial = '' } = {}) {
  const adb = resolveAdbPath(adbPath)
  if (!adb) {
    const err = new Error(
      '未找到 adb。请安装 Android platform-tools，或设置 ANDROID_HOME，或安装木木自带 adb。',
    )
    err.code = 'ADB_NOT_FOUND'
    throw err
  }
  const finalArgs = []
  if (serial) finalArgs.push('-s', String(serial))
  finalArgs.push(...args.map(String))
  const r = spawnSync(adb, finalArgs, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: Math.min(Math.max(timeoutMs, 3000), 300000),
    shell: false,
  })
  if (r.error) {
    const err = new Error(r.error.message || String(r.error))
    err.code = r.error.code || 'ADB_SPAWN_FAILED'
    throw err
  }
  return {
    adb,
    args: finalArgs,
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    timedOut: r.signal === 'SIGTERM',
  }
}

export function adbAvailable(args = {}) {
  const adb = resolveAdbPath(args.adbPath)
  if (!adb) {
    return { available: false, adb: null, message: 'ADB_NOT_FOUND' }
  }
  try {
    const r = runAdb(['version'], { adbPath: adb, timeoutMs: 8000 })
    return {
      available: r.status === 0,
      adb,
      version: (r.stdout || r.stderr).split(/\r?\n/)[0] || '',
      raw: (r.stdout || '').slice(0, 500),
    }
  } catch (e) {
    return { available: false, adb, message: e.message, code: e.code }
  }
}

export function adbDevices(args = {}) {
  const r = runAdb(['devices', '-l'], { adbPath: args.adbPath, timeoutMs: 15000 })
  const lines = String(r.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const devices = []
  for (const line of lines) {
    if (/^List of devices/i.test(line)) continue
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|bootloader)\b(.*)$/i)
    if (!m) continue
    devices.push({
      serial: m[1],
      state: m[2].toLowerCase(),
      info: (m[3] || '').trim(),
    })
  }
  const online = devices.filter((d) => d.state === 'device')
  return {
    adb: r.adb,
    devices,
    onlineCount: online.length,
    preferred: online[0]?.serial || null,
    raw: r.stdout.slice(0, 2000),
  }
}

function pickSerial(args = {}, devicesResult = null) {
  if (args.serial || args.device) return String(args.serial || args.device)
  const d = devicesResult || adbDevices(args)
  if (d.preferred) return d.preferred
  if (d.onlineCount === 0) {
    const err = new Error(
      d.devices?.some((x) => x.state === 'unauthorized')
        ? '设备未授权（unauthorized），请在模拟器/手机上点允许 USB 调试'
        : '没有在线 ADB 设备。请先启动模拟器并确认 adb devices 可见。',
    )
    err.code = d.devices?.some((x) => x.state === 'unauthorized')
      ? 'ADB_UNAUTHORIZED'
      : 'ADB_NO_DEVICE'
    err.data = d
    throw err
  }
  return d.preferred
}

export function adbShell(args = {}) {
  const cmd = args.command || args.cmd
  if (!cmd) {
    const err = new Error('adb.shell 需要 command')
    err.code = 'COMMAND_REQUIRED'
    throw err
  }
  // 禁止危险 shell
  if (/rm\s+-rf\s+\/|mkfs|dd\s+if=/i.test(String(cmd))) {
    const err = new Error('危险 adb shell 命令已阻止')
    err.code = 'COMMAND_BLOCKED'
    throw err
  }
  const serial = pickSerial(args)
  const parts = Array.isArray(args.args) ? args.args.map(String) : String(cmd).split(/\s+/).filter(Boolean)
  const r = runAdb(['shell', ...parts], {
    adbPath: args.adbPath,
    serial,
    timeoutMs: args.timeoutMs || 30000,
  })
  return {
    serial,
    status: r.status,
    stdout: r.stdout.slice(0, 20000),
    stderr: r.stderr.slice(0, 5000),
  }
}

function resolveApkPath(input) {
  const raw = String(input || '').trim()
  if (!raw) {
    const err = new Error('需要 apk 路径')
    err.code = 'APK_PATH_REQUIRED'
    throw err
  }
  let abs
  // 允许「桌面/xxx.apk」
  const roots = getAllowedRoots()
  const desktop = roots.find((r) => /[\\/]Desktop$/i.test(r)) || path.join(os.homedir(), 'Desktop')
  if (/^(桌面|Desktop)[\\/]/i.test(raw)) {
    abs = path.join(desktop, raw.replace(/^(桌面|Desktop)[\\/]/i, ''))
  } else if (!path.isAbsolute(raw) && !/^[a-zA-Z]:[\\/]/.test(raw)) {
    abs = path.join(desktop, raw)
  } else {
    abs = normalizeAbs(raw)
  }
  abs = normalizeAbs(abs)
  assertAllowedUserAbs(abs)
  if (!fs.existsSync(abs)) {
    const err = new Error(`APK 不存在: ${abs}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  if (!/\.apk$/i.test(abs)) {
    const err = new Error('文件不是 .apk')
    err.code = 'NOT_AN_APK'
    throw err
  }
  return abs
}

export function adbInstall(args = {}) {
  const apk = resolveApkPath(args.apk || args.apkPath || args.path || args.file)
  const serial = pickSerial(args)
  const replace = args.replace !== false
  const cmd = replace ? ['install', '-r', apk] : ['install', apk]
  const r = runAdb(cmd, {
    adbPath: args.adbPath,
    serial,
    timeoutMs: args.timeoutMs || 180000,
  })
  const out = `${r.stdout}\n${r.stderr}`
  const ok = /Success/i.test(out) || (r.status === 0 && !/Failure|Error/i.test(out))
  if (!ok) {
    const err = new Error(`adb install 失败: ${out.slice(0, 800)}`)
    err.code = 'ADB_INSTALL_FAILED'
    err.data = { serial, apk, stdout: r.stdout, stderr: r.stderr, status: r.status }
    throw err
  }
  return {
    success: true,
    serial,
    apk,
    replaced: replace,
    stdout: r.stdout.slice(0, 2000),
  }
}

export function adbUninstall(args = {}) {
  const pkg = String(args.package || args.packageName || args.pkg || '').trim()
  if (!pkg) {
    const err = new Error('需要 package 名')
    err.code = 'PACKAGE_REQUIRED'
    throw err
  }
  const serial = pickSerial(args)
  const r = runAdb(['uninstall', pkg], {
    adbPath: args.adbPath,
    serial,
    timeoutMs: args.timeoutMs || 60000,
  })
  const out = `${r.stdout}\n${r.stderr}`
  const ok = /Success/i.test(out) || r.status === 0
  if (!ok) {
    const err = new Error(`adb uninstall 失败: ${out.slice(0, 500)}`)
    err.code = 'ADB_UNINSTALL_FAILED'
    throw err
  }
  return { success: true, serial, package: pkg, stdout: r.stdout.slice(0, 1000) }
}

export function adbLaunch(args = {}) {
  const pkg = String(args.package || args.packageName || args.pkg || '').trim()
  const activity = String(args.activity || '').trim()
  if (!pkg) {
    const err = new Error('需要 package 名')
    err.code = 'PACKAGE_REQUIRED'
    throw err
  }
  const serial = pickSerial(args)
  let r
  if (activity) {
    const component = activity.includes('/') ? activity : `${pkg}/${activity}`
    r = runAdb(['shell', 'am', 'start', '-n', component], {
      adbPath: args.adbPath,
      serial,
      timeoutMs: 30000,
    })
  } else {
    // monkey 启动默认 Activity
    r = runAdb(
      ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
      { adbPath: args.adbPath, serial, timeoutMs: 30000 },
    )
  }
  const out = `${r.stdout}\n${r.stderr}`
  if (/Error|Exception|not found/i.test(out) && r.status !== 0) {
    const err = new Error(`启动失败: ${out.slice(0, 600)}`)
    err.code = 'ADB_LAUNCH_FAILED'
    throw err
  }
  return { success: true, serial, package: pkg, activity: activity || null, stdout: r.stdout.slice(0, 1500) }
}

export function adbPush(args = {}) {
  const local = normalizeAbs(String(args.local || args.src || ''))
  assertAllowedUserAbs(local)
  const remote = String(args.remote || args.dest || '')
  if (!remote.startsWith('/')) {
    const err = new Error('remote 必须是设备绝对路径，如 /sdcard/Download/a.apk')
    err.code = 'INVALID_REMOTE'
    throw err
  }
  const serial = pickSerial(args)
  const r = runAdb(['push', local, remote], {
    adbPath: args.adbPath,
    serial,
    timeoutMs: args.timeoutMs || 120000,
  })
  if (r.status !== 0 && !/pushed/i.test(r.stdout + r.stderr)) {
    const err = new Error(`adb push 失败: ${(r.stderr || r.stdout).slice(0, 500)}`)
    err.code = 'ADB_PUSH_FAILED'
    throw err
  }
  return { serial, local, remote, stdout: r.stdout.slice(0, 1000) }
}

export function adbPull(args = {}) {
  const remote = String(args.remote || args.src || '')
  const local = normalizeAbs(String(args.local || args.dest || ''))
  assertAllowedUserAbs(local)
  if (!remote.startsWith('/')) {
    const err = new Error('remote 必须是设备绝对路径')
    err.code = 'INVALID_REMOTE'
    throw err
  }
  fs.mkdirSync(path.dirname(local), { recursive: true })
  const serial = pickSerial(args)
  const r = runAdb(['pull', remote, local], {
    adbPath: args.adbPath,
    serial,
    timeoutMs: args.timeoutMs || 120000,
  })
  if (r.status !== 0 && !fs.existsSync(local)) {
    const err = new Error(`adb pull 失败: ${(r.stderr || r.stdout).slice(0, 500)}`)
    err.code = 'ADB_PULL_FAILED'
    throw err
  }
  return { serial, remote, local, bytes: fs.existsSync(local) ? fs.statSync(local).size : 0 }
}

export function adbScreenshot(args = {}) {
  const roots = getAllowedRoots()
  const desktop = roots.find((r) => /[\\/]Desktop$/i.test(r)) || path.join(os.homedir(), 'Desktop')
  const out =
    args.path || args.outPath
      ? normalizeAbs(String(args.path || args.outPath))
      : path.join(desktop, 'sama-screenshots', `adb_${Date.now()}.png`)
  assertAllowedUserAbs(out)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const serial = pickSerial(args)
  const remote = `/sdcard/sama_shot_${Date.now()}.png`
  runAdb(['shell', 'screencap', '-p', remote], { adbPath: args.adbPath, serial, timeoutMs: 20000 })
  const pull = adbPull({ ...args, serial, remote, local: out })
  runAdb(['shell', 'rm', remote], { adbPath: args.adbPath, serial, timeoutMs: 10000 })
  return { serial, path: out, bytes: pull.bytes }
}

/** 等待设备上线 */
export async function adbWaitForDevice(args = {}) {
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs) || 60000, 5000), 300000)
  const start = Date.now()
  const interval = 2000
  while (Date.now() - start < timeoutMs) {
    try {
      const d = adbDevices(args)
      if (d.onlineCount > 0) {
        return { ready: true, waitedMs: Date.now() - start, ...d }
      }
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  const last = adbDevices(args)
  const err = new Error('等待 ADB 设备超时')
  err.code = 'ADB_WAIT_TIMEOUT'
  err.data = last
  throw err
}

/** 打开木木等模拟器 */
export function emulatorOpen(args = {}) {
  const name = args.name || args.emulator || '木木模拟器'
  const find = applicationFind({ name, path: args.path })
  if (!find.ok) {
    const err = new Error(find.message)
    err.code = find.code || 'EMULATOR_NOT_FOUND'
    err.matches = find.matches
    throw err
  }
  const running = applicationIsRunning({ path: find.path, name })
  const launch = applicationLaunch({ path: find.path, name, reuse: true, args: args.args })
  return {
    emulator: name,
    path: find.path,
    alreadyRunning: !!running.running,
    launch,
  }
}

export function emulatorWindowHint(args = {}) {
  const list = windowList().windows || []
  const needle = String(args.name || 'mumu|木木|emulator|android').toLowerCase()
  const re = new RegExp(needle, 'i')
  const hits = list.filter((w) => re.test(String(w.title || '')))
  return { count: hits.length, windows: hits.slice(0, 10) }
}

/**
 * 高层：打开模拟器 → 等 ADB → 装 APK → 可选启动
 */
export async function androidInstallApkFlow(args = {}) {
  const trace = []
  const openEmu = args.openEmulator !== false
  if (openEmu) {
    try {
      const emu = emulatorOpen({ name: args.emulator || '木木模拟器', path: args.emulatorPath })
      trace.push({ step: 'emulator.open', ok: true, data: emu })
    } catch (e) {
      trace.push({ step: 'emulator.open', ok: false, error: e.message, code: e.code })
      if (args.requireEmulator !== false) {
        const err = new Error(`无法打开模拟器: ${e.message}`)
        err.code = e.code || 'EMULATOR_OPEN_FAILED'
        err.data = { trace }
        throw err
      }
    }
  }

  let devices
  try {
    devices = await adbWaitForDevice({
      adbPath: args.adbPath,
      timeoutMs: args.waitTimeoutMs || 90000,
    })
    trace.push({ step: 'adb.wait', ok: true, onlineCount: devices.onlineCount, preferred: devices.preferred })
  } catch (e) {
    trace.push({ step: 'adb.wait', ok: false, error: e.message, code: e.code, data: e.data })
    const err = new Error(e.message)
    err.code = e.code || 'ADB_WAIT_TIMEOUT'
    err.data = { trace, ...(e.data || {}) }
    throw err
  }

  const serial = args.serial || devices.preferred
  const install = adbInstall({ ...args, serial, apk: args.apk || args.apkPath || args.path })
  trace.push({ step: 'adb.install', ok: true, data: install })

  let launch = null
  if (args.launch && (args.package || args.packageName)) {
    launch = adbLaunch({
      ...args,
      serial,
      package: args.package || args.packageName,
      activity: args.activity,
    })
    trace.push({ step: 'adb.launch', ok: true, data: launch })
  }

  return {
    success: true,
    serial,
    apk: install.apk,
    package: args.package || args.packageName || null,
    launch,
    trace,
  }
}

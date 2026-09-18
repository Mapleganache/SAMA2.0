import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { launchGuiApp } from '../guiLaunch.mjs'

/** 有限已知应用（不扫全盘乱执行） */
const KNOWN_APPS = [
  {
    names: ['notepad', '记事本'],
    paths: [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe'),
      path.join(process.env.SystemRoot || 'C:\\Windows', 'notepad.exe'),
    ],
  },
  {
    names: ['calc', 'calculator', '计算器'],
    paths: [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'calc.exe')],
  },
  {
    names: ['explorer', '资源管理器', '文件资源管理器'],
    paths: [path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe')],
  },
  {
    names: ['cmd', '命令提示符'],
    paths: [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')],
  },
  {
    names: ['powershell', 'pwsh'],
    paths: [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ],
  },
  {
    names: ['木木模拟器', 'mumu', 'mumu player', 'mumu模拟器', '网易mumu'],
    paths: [
      'C:\\Program Files\\Netease\\MuMu\\nx_main\\MuMuNxMain.exe',
      'C:\\Program Files\\Netease\\MuMu Player 12\\shell\\MuMuPlayer.exe',
      'C:\\Program Files\\Netease\\MuMu\\MuMuPlayer.exe',
      'D:\\Program Files\\Netease\\MuMu\\nx_main\\MuMuNxMain.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'MuMu', 'nx_main', 'MuMuNxMain.exe'),
    ],
  },
]

function normalizeName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

export function applicationList() {
  return KNOWN_APPS.map((a) => ({
    names: a.names,
    resolvedPath: a.paths.find((p) => fs.existsSync(p)) || null,
    candidates: a.paths,
  }))
}

/**
 * @returns {{ ok: true, path: string, name: string } | { ok: false, code: string, message: string, matches?: string[] }}
 */
export function applicationFind(args = {}) {
  if (args.path) {
    const p = path.resolve(String(args.path))
    if (!fs.existsSync(p)) {
      return { ok: false, code: 'APPLICATION_NOT_FOUND', message: `路径不存在: ${p}` }
    }
    return { ok: true, path: p, name: path.basename(p) }
  }

  const name = normalizeName(args.name || args.app || args.query)
  if (!name) {
    return { ok: false, code: 'NAME_REQUIRED', message: '请提供应用名称或路径' }
  }

  const hits = []
  for (const app of KNOWN_APPS) {
    if (app.names.some((n) => normalizeName(n) === name || normalizeName(n).includes(name) || name.includes(normalizeName(n)))) {
      const existing = app.paths.filter((p) => fs.existsSync(p))
      if (existing.length) {
        // 已知应用：只取一个最优先路径，避免 System32+Windows 双命中变 AMBIGUOUS
        hits.push({ path: existing[0], name: app.names[0] })
      }
    }
  }

  // PATH which
  if (!hits.length) {
    const which = spawnSync('where', [String(args.name || args.app)], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      shell: false,
    })
    if (which.status === 0) {
      const lines = String(which.stdout || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /\.exe$/i.test(l) && fs.existsSync(l))
      for (const p of lines) hits.push({ path: p, name: path.basename(p) })
    }
  }

  // Start Menu shortcuts (.lnk) — 有限搜索
  if (!hits.length) {
    const startDirs = [
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ]
    const needle = name
    for (const dir of startDirs) {
      walkLnk(dir, needle, hits, 0)
      if (hits.length >= 5) break
    }
  }

  const uniq = []
  const seen = new Set()
  for (const h of hits) {
    const k = h.path.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(h)
  }

  if (!uniq.length) {
    return {
      ok: false,
      code: 'APPLICATION_NOT_FOUND',
      message: `没有找到应用「${args.name || args.app}」。请提供完整 exe 路径。`,
    }
  }
  if (uniq.length > 1) {
    return {
      ok: false,
      code: 'APPLICATION_AMBIGUOUS',
      message: `找到多个匹配，请指定 path`,
      matches: uniq.map((u) => u.path),
    }
  }
  return { ok: true, path: uniq[0].path, name: uniq[0].name }
}

function walkLnk(dir, needle, hits, depth) {
  if (depth > 4 || hits.length >= 5 || !fs.existsSync(dir)) return
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const p = path.join(dir, name)
    let st
    try {
      st = fs.statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walkLnk(p, needle, hits, depth + 1)
      continue
    }
    if (!/\.lnk$/i.test(name)) continue
    const base = name.replace(/\.lnk$/i, '')
    if (!normalizeName(base).includes(needle) && !needle.includes(normalizeName(base))) continue
    // 不解析 .lnk 目标（避免复杂依赖）；仅当同名 exe 在常见目录时跳过
    // 用 powershell 解析一次
    try {
      const ps = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${p.replace(/'/g, "''")}'); if($s.TargetPath){$s.TargetPath}`,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 8000 },
      )
      const target = String(ps.stdout || '').trim().split(/\r?\n/).filter(Boolean)[0]
      if (target && /\.exe$/i.test(target) && fs.existsSync(target)) {
        hits.push({ path: target, name: base })
      }
    } catch {
      /* ignore */
    }
  }
}

export function applicationIsRunning(args = {}) {
  const find = applicationFind(args)
  if (!find.ok && !args.name && !args.path) {
    return find
  }
  const exeName = find.ok
    ? path.basename(find.path)
    : String(args.name || args.path || '')
        .split(/[/\\]/)
        .pop()
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq '${exeName.replace(/\.exe$/i, '').replace(/'/g, '')}' -or $_.MainWindowTitle -like '*${String(args.name || '').replace(/'/g, '')}*' } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  )
  let processes = []
  try {
    const raw = String(r.stdout || '').trim()
    if (raw) {
      const parsed = JSON.parse(raw)
      processes = Array.isArray(parsed) ? parsed : [parsed]
    }
  } catch {
    processes = []
  }
  return {
    running: processes.length > 0,
    exeName,
    path: find.ok ? find.path : null,
    processes,
  }
}

export function applicationLaunch(args = {}) {
  const find = applicationFind(args)
  if (!find.ok) {
    const err = new Error(find.message)
    err.code = find.code
    err.matches = find.matches
    throw err
  }

  const already = applicationIsRunning({ path: find.path, name: args.name })
  if (already.running && args.reuse !== false) {
    return {
      launched: false,
      reused: true,
      path: find.path,
      processes: already.processes,
      message: '程序已在运行',
    }
  }

  const childArgs = Array.isArray(args.args) ? args.args.map(String) : []
  const r = launchGuiApp({
    exe: find.path,
    args: childArgs,
    cwd: args.cwd || path.dirname(find.path),
    documentPath: childArgs.find((a) => /\.\w{2,5}$/i.test(a)) || '',
    processNames: [path.basename(find.path, path.extname(find.path))],
  })
  if (!r.ok) {
    const err = new Error(r.error || '启动失败')
    err.code = 'LAUNCH_FAILED'
    throw err
  }

  return {
    launched: true,
    reused: false,
    path: find.path,
    pid: null,
    args: childArgs,
    method: r.method,
    note: r.note,
  }
}

export function applicationTerminate(args = {}) {
  const running = applicationIsRunning(args)
  if (!running.running) {
    const err = new Error('目标程序未在运行')
    err.code = 'NOT_RUNNING'
    throw err
  }
  const results = []
  for (const p of running.processes) {
    const r = spawnSync('taskkill', ['/PID', String(p.Id), '/T'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    })
    results.push({
      pid: p.Id,
      ok: r.status === 0,
      stdout: String(r.stdout || '').slice(0, 500),
      stderr: String(r.stderr || '').slice(0, 500),
    })
  }
  return { terminated: results.filter((x) => x.ok).length, results }
}

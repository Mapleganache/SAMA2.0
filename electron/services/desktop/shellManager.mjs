import { spawnSync } from 'node:child_process'
import path from 'node:path'

/** 可自动执行的命令名（小写，无路径） */
const SAFE_COMMANDS = new Set([
  'dir',
  'where',
  'tasklist',
  'whoami',
  'ipconfig',
  'echo',
  'hostname',
  'ver',
  'date',
  'time',
  'systeminfo',
  'getmac',
])

/** 机床相关：默认 CONFIRM（可执行但需用户确认） */
const CONFIRM_COMMANDS = new Set([
  'python',
  'python3',
  'py',
  'git',
  'adb',
  'npm',
  'node',
  'pip',
  'powershell',
  'pwsh',
  'cmd',
])

const BLOCK_PATTERNS = [
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bRemove-Item\s+-Recurse\s+C:\\/i,
  /\bdel\s+\/[sf].*C:\\Windows/i,
  /\brm\s+-rf\s+\/\b/i,
  /\breg\s+delete\b/i,
  /\bcipher\s+\/w/i,
  /\bdiskpart\b/i,
  /\bbcdedit\b/i,
]

export function classifyShellCommand(command, args = []) {
  const cmd = String(command || '').trim()
  const base = path.basename(cmd).replace(/\.exe$/i, '').toLowerCase()
  const joined = `${cmd} ${(args || []).join(' ')}`

  for (const re of BLOCK_PATTERNS) {
    if (re.test(joined)) {
      return { level: 'BLOCK', reason: '匹配危险命令模式', base }
    }
  }

  // 禁止任意脚本内联（-Command/-c 长串）走 SAFE
  if (/powershell|pwsh|cmd/i.test(base)) {
    return { level: 'CONFIRM', reason: 'shell 解释器需确认', base }
  }

  if (SAFE_COMMANDS.has(base)) return { level: 'SAFE', reason: 'whitelist', base }
  if (CONFIRM_COMMANDS.has(base)) return { level: 'CONFIRM', reason: 'confirm-list', base }

  // 未知命令默认 CONFIRM，不默认执行
  return { level: 'CONFIRM', reason: 'unknown-command', base }
}

export function shellRun(args = {}) {
  const command = String(args.command || args.cmd || '').trim()
  if (!command) {
    const err = new Error('缺少 command')
    err.code = 'COMMAND_REQUIRED'
    throw err
  }
  const argv = Array.isArray(args.args) ? args.args.map(String) : []
  const policy = classifyShellCommand(command, argv)
  if (policy.level === 'BLOCK') {
    const err = new Error(`命令已阻止: ${policy.reason}`)
    err.code = 'COMMAND_BLOCKED'
    throw err
  }

  const timeout = Math.min(Math.max(Number(args.timeoutMs) || 15000, 1000), 120000)
  const cwd = args.cwd ? String(args.cwd) : undefined

  // 特殊：dir 在无 shell 时用 cmd /c dir（仍受限）
  let exe = command
  let finalArgs = argv
  if (policy.base === 'dir' && !path.isAbsolute(command)) {
    exe = process.env.ComSpec || 'cmd.exe'
    finalArgs = ['/d', '/s', '/c', 'dir', ...argv]
  } else if (policy.base === 'echo' && !path.isAbsolute(command)) {
    exe = process.env.ComSpec || 'cmd.exe'
    finalArgs = ['/d', '/s', '/c', 'echo', ...argv]
  }

  const r = spawnSync(exe, finalArgs, {
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    cwd,
    shell: false,
    env: { ...process.env, ...(args.env || {}) },
  })

  if (r.error) {
    const err = new Error(r.error.message || String(r.error))
    err.code = r.error.code || 'SPAWN_FAILED'
    throw err
  }

  return {
    command: exe,
    args: finalArgs,
    status: r.status,
    stdout: String(r.stdout || '').slice(0, 20000),
    stderr: String(r.stderr || '').slice(0, 5000),
    timedOut: r.signal === 'SIGTERM',
    policy: policy.level,
  }
}

export function shellPermission(args = {}) {
  const command = String(args.command || args.cmd || '').trim()
  const argv = Array.isArray(args.args) ? args.args.map(String) : []
  return classifyShellCommand(command, argv)
}

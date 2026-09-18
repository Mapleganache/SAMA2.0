/**
 * Windows 外部软件启动（与 Cursor Shell 同款思路）：
 * - PowerShell Start-Process：拉起即返回，不 Wait-Process（SAMA 永不因弹窗卡死）
 * - 后台 UI 自动点常见更新/许可 MessageBox（不碰 UAC）
 * - 首启失败时 cmd start / shell.openPath 兜底重试
 *
 * 用途：EPLAN / LADDER-III GUI / 其它本机 GUI。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { startDialogAutoClick } from './dialogAutoClick.mjs'

function psQuote(s) {
  return `'${String(s || '').replace(/'/g, "''")}'`
}

function processRunning(exeBase) {
  const name = path.basename(String(exeBase || ''), path.extname(exeBase || ''))
  if (!name) return false
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `@(Get-Process -Name ${psQuote(name)} -ErrorAction SilentlyContinue).Count`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    )
    return Number(String(out).trim()) > 0
  } catch {
    return false
  }
}

/** 与人工在终端里敲 Start-Process 等价：detached，不等退出 */
function startProcess(exe, args = [], cwd = '') {
  const work = cwd || path.dirname(exe)
  const argList =
    args.length > 0 ? `-ArgumentList @(${args.map((a) => psQuote(a)).join(',')})` : ''
  const cmd = [
    `$ErrorActionPreference='Continue'`,
    `Start-Process -FilePath ${psQuote(exe)} ${argList} -WorkingDirectory ${psQuote(work)}`,
  ].join('; ')
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', cmd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref()
}

function startViaCmd(exe, args = []) {
  const parts = ['/c', 'start', '', exe, ...args.map(String)]
  spawn('cmd', parts, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: path.dirname(exe),
  }).unref()
}

function startDocument(docPath) {
  const abs = path.resolve(docPath)
  spawn('cmd', ['/c', 'start', '', abs], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref()
}

async function shellOpenPath(docPath) {
  try {
    const { shell } = await import('electron')
    if (shell?.openPath) {
      const err = await shell.openPath(path.resolve(docPath))
      return !err
    }
  } catch {
    /* not in electron */
  }
  startDocument(docPath)
  return true
}

function scheduleFallback({ exe, doc, names, cwd }, delayMs) {
  setTimeout(() => {
    const alive = (names || []).some((n) => processRunning(n))
    if (alive) return
    try {
      if (exe && doc) {
        startViaCmd(exe, [doc])
        startProcess(exe, [doc], cwd || path.dirname(exe))
      } else if (exe) {
        startViaCmd(exe, [])
        startProcess(exe, [], cwd || path.dirname(exe))
      }
      if (doc) void shellOpenPath(doc)
    } catch {
      /* ignore */
    }
  }, delayMs)
}

/**
 * @param {{
 *   exe?: string,
 *   args?: string[],
 *   cwd?: string,
 *   documentPath?: string,
 *   processNames?: string[],
 *   autoClickDialogs?: boolean,
 * }} opts
 */
export function launchGuiApp(opts = {}) {
  const exe = String(opts.exe || '').trim()
  const args = Array.isArray(opts.args) ? opts.args.map(String) : []
  const doc = String(opts.documentPath || '').trim()
  const cwd = opts.cwd || (exe ? path.dirname(exe) : '')
  const names = opts.processNames || (exe ? [path.basename(exe, path.extname(exe))] : [])
  const autoClick = opts.autoClickDialogs !== false

  if (exe && !fs.existsSync(exe)) {
    return { ok: false, error: `程序不存在：${exe}` }
  }
  if (doc && !fs.existsSync(doc)) {
    return { ok: false, error: `文件不存在：${doc}` }
  }

  const launchArgs = args.length ? args : doc ? [doc] : []
  const methods = []

  try {
    if (exe) {
      startProcess(exe, launchArgs, cwd)
      methods.push('Start-Process')
      startViaCmd(exe, launchArgs)
      methods.push('cmd-start')
    } else if (doc) {
      startDocument(doc)
      methods.push('start-document')
    } else {
      return { ok: false, error: '缺少 exe 或 documentPath' }
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }

  scheduleFallback({ exe, doc, names, cwd }, 4000)
  scheduleFallback({ exe, doc, names, cwd }, 12000)

  let dialogWatch = null
  if (autoClick) {
    dialogWatch = startDialogAutoClick({
      processNames: names,
      durationSec: 90,
    })
    if (dialogWatch.ok) methods.push('auto-click-dialogs')
  }

  return {
    ok: true,
    method: methods.join('+'),
    eplanPath: exe,
    fladderPath: exe,
    path: exe,
    documentPath: doc || '',
    shellStyle: true,
    dialogWatch,
    note:
      '已后台启动且不等待退出（不会因弹窗卡死）。普通更新/许可提示会尝试自动点「稍后/确定/关闭」；Windows UAC 权限窗系统禁止代点，需你点一次「是」。',
  }
}

export function isGuiProcessAlive(nameOrExe) {
  return processRunning(nameOrExe)
}

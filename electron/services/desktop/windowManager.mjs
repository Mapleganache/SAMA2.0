import { spawnSync } from 'node:child_process'

function runPs(script, timeoutMs = 12000) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
  })
  return {
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    error: r.error,
  }
}

export function windowList(_args = {}) {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$list = New-Object System.Collections.Generic.List[object]
[WinEnum]::EnumWindows({
  param($h,$l)
  if (-not [WinEnum]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][WinEnum]::GetWindowText($h, $sb, $sb.Capacity)
  $title = $sb.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $pid = 0
  [void][WinEnum]::GetWindowThreadProcessId($h, [ref]$pid)
  $list.Add([pscustomobject]@{ handle=[int64]$h; title=$title; pid=$pid })
  return $true
}, [IntPtr]::Zero) | Out-Null
$list | ConvertTo-Json -Compress
`
  const r = runPs(script)
  if (r.error) {
    const err = new Error(`窗口枚举失败: ${r.error.message || r.error}`)
    err.code = 'WINDOW_ENUM_FAILED'
    throw err
  }
  let windows = []
  try {
    const raw = r.stdout.trim()
    if (raw) {
      const parsed = JSON.parse(raw)
      windows = Array.isArray(parsed) ? parsed : [parsed]
    }
  } catch {
    windows = []
  }
  return { count: windows.length, windows }
}

export function windowActive() {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinAct {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [WinAct]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][WinAct]::GetWindowText($h, $sb, $sb.Capacity)
$pid = 0
[void][WinAct]::GetWindowThreadProcessId($h, [ref]$pid)
@{ handle=[int64]$h; title=$sb.ToString(); pid=$pid } | ConvertTo-Json -Compress
`
  const r = runPs(script)
  try {
    return JSON.parse(r.stdout.trim() || '{}')
  } catch {
    return { handle: 0, title: '', pid: 0 }
  }
}

function findWindow(args = {}) {
  const list = windowList().windows || []
  if (args.handle) {
    const h = Number(args.handle)
    const hit = list.find((w) => Number(w.handle) === h)
    if (!hit) {
      const err = new Error(`未找到句柄窗口: ${h}`)
      err.code = 'WINDOW_NOT_FOUND'
      throw err
    }
    return hit
  }
  const title = String(args.title || args.name || args.query || '').trim()
  if (!title) {
    const err = new Error('请提供 title 或 handle')
    err.code = 'TITLE_REQUIRED'
    throw err
  }
  const lower = title.toLowerCase()
  const hits = list.filter((w) => String(w.title || '').toLowerCase().includes(lower))
  if (!hits.length) {
    const err = new Error(`未找到标题包含「${title}」的窗口`)
    err.code = 'WINDOW_NOT_FOUND'
    throw err
  }
  if (hits.length > 1 && args.exact) {
    const exact = hits.filter((w) => String(w.title).toLowerCase() === lower)
    if (exact.length === 1) return exact[0]
  }
  // 取最短标题匹配（更像主窗口）
  hits.sort((a, b) => String(a.title).length - String(b.title).length)
  return hits[0]
}

function showWindow(handle, cmd) {
  // 1=SW_SHOWNORMAL 3=MAXIMIZE 6=MINIMIZE 9=RESTORE
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinShow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
$h = [IntPtr]${Number(handle)}
[void][WinShow]::ShowWindow($h, ${Number(cmd)})
[void][WinShow]::BringWindowToTop($h)
[void][WinShow]::SetForegroundWindow($h)
'OK'
`
  const r = runPs(script)
  if (!/OK/.test(r.stdout) && r.status !== 0) {
    const err = new Error(`窗口操作失败: ${r.stderr || r.stdout}`)
    err.code = 'WINDOW_OP_FAILED'
    throw err
  }
  return true
}

export function windowFocus(args = {}) {
  const w = findWindow(args)
  showWindow(w.handle, 9)
  return { focused: true, window: w }
}

export function windowMinimize(args = {}) {
  const w = findWindow(args)
  showWindow(w.handle, 6)
  return { minimized: true, window: w }
}

export function windowMaximize(args = {}) {
  const w = findWindow(args)
  showWindow(w.handle, 3)
  return { maximized: true, window: w }
}

export function windowRestore(args = {}) {
  const w = findWindow(args)
  showWindow(w.handle, 9)
  return { restored: true, window: w }
}

export function windowClose(args = {}) {
  const w = findWindow(args)
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinClose {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
[WinClose]::PostMessage([IntPtr]${Number(w.handle)}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
'OK'
`
  const r = runPs(script)
  if (!/OK/.test(r.stdout)) {
    const err = new Error(`关闭窗口失败: ${r.stderr || r.stdout}`)
    err.code = 'WINDOW_CLOSE_FAILED'
    throw err
  }
  return { closed: true, window: w }
}

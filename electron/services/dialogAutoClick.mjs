/**
 * 启动后后台尝试点掉常见非 UAC 弹窗（更新提示、许可说明、普通 MessageBox）。
 * - 不阻塞 SAMA 主进程
 * - 不碰 UAC（ConsentUI 安全桌面，系统禁止代点）
 * - 更新类优先点「稍后/跳过/关闭」；许可/提示类点「确定/同意/继续」
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

function psQuote(s) {
  return `'${String(s || '').replace(/'/g, "''")}'`
}

function buildWatcherScript({ processNames = [], durationSec = 55, intervalSec = 1.2 }) {
  const names = (processNames || [])
    .map((n) => String(n || '').replace(/\.exe$/i, '').trim())
    .filter(Boolean)
  const nameList = names.map((n) => psQuote(n)).join(',')

  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class SamaDlg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lp, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lp, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lp, IntPtr lParam);
}
"@

$watchNames = @(${nameList})
$deadline = (Get-Date).AddSeconds(${Number(durationSec) || 55})
$interval = [Math]::Max(0.6, ${Number(intervalSec) || 1.2})
$clicked = New-Object 'System.Collections.Generic.HashSet[string]'

$updateTitle = '(更新|升级|Update|Upgrade|新版本|版本可用|Available|Download|下载更新)'
$dlgTitle = '(许可|License|Agreement|EULA|权限|Permission|警告|Warning|提示|Notice|Information|确认|Confirm|EPLAN|LADDER|FANUC|Fladder|W3u|检查许可|Check License|MAX)'
$titleOwned = '(检查许可|Check License|许可文件|EplanCommon|\.lit|\.lir|License)'
$preferDismiss = '(稍后|稍後|跳过|跳過|暂不|暫不|下次|以后再说|以後再說|关闭|關閉|取消|Later|Skip|Remind|Not now|No thanks|Close|Cancel|Dismiss)'
$preferAccept = '(确定|確定|同意|接受|继续|繼續|是|OK|Ok|Accept|Agree|Continue|Yes|I Agree|允许|允許)'
$avoidDanger = '(立即更新|现在更新|立即升级|安装更新|Update Now|Install Now|Download Now|卸载|删除|Delete|Format)'

function Get-TopWindows {
  $list = New-Object System.Collections.Generic.List[object]
  $cb = [SamaDlg+EnumProc]{
    param([IntPtr]$h, [IntPtr]$lp)
    if (-not [SamaDlg]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][SamaDlg]::GetWindowText($h, $sb, $sb.Capacity)
    $title = $sb.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) { return $true }
    $cbCls = New-Object System.Text.StringBuilder 256
    [void][SamaDlg]::GetClassName($h, $cbCls, $cbCls.Capacity)
    $cls = $cbCls.ToString()
    $rect = New-Object SamaDlg+RECT
    [void][SamaDlg]::GetWindowRect($h, [ref]$rect)
    $ww = [Math]::Abs($rect.Right - $rect.Left)
    $hh = [Math]::Abs($rect.Bottom - $rect.Top)
    $looksDlg = ($cls -eq '#32770') -or ($title -match $updateTitle) -or ($title -match $dlgTitle) -or ($ww -gt 160 -and $hh -gt 100 -and $ww -lt 860 -and $hh -lt 640)
    if (-not $looksDlg) { return $true }
    # 排除接近全屏的主窗口
    if ($ww -ge 1000 -and $hh -ge 700) { return $true }
    $pid = [uint32]0
    [void][SamaDlg]::GetWindowThreadProcessId($h, [ref]$pid)
    $proc = $null
    try { $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue } catch {}
    $pname = if ($proc) { $proc.ProcessName } else { '' }
    if ($pname -match '^(Consent|CredentialUIBroker|UserAccountControlSettings|consent)$') { return $true }
    if ($title -match '用户账户控制|User Account Control') { return $true }
    $own = $false
    foreach ($n in $watchNames) {
      if ($pname -and ($pname -ieq $n -or $pname -like "$n*")) { $own = $true; break }
    }
    # EPLAN 许可检查常在 MAX 等独立进程，不属 W3u；按标题认领
    if (-not $own -and $title -match $titleOwned) { $own = $true }
    if (-not $own) { return $true }
    $list.Add([pscustomobject]@{ Hwnd=$h; Title=$title; Pid=$pid; ProcessName=$pname })
    return $true
  }
  [void][SamaDlg]::EnumWindows($cb, [IntPtr]::Zero)
  return $list
}

function Try-InvokeButton([System.Windows.Automation.AutomationElement]$btn) {
  if ($null -eq $btn) { return $false }
  try {
    $pat = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($pat) { $pat.Invoke(); return $true }
  } catch {}
  try {
    $rect = $btn.Current.BoundingRectangle
    if ($rect.Width -lt 2 -or $rect.Height -lt 2) { return $false }
    $x = [int]($rect.X + $rect.Width/2)
    $y = [int]($rect.Y + $rect.Height/2)
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x,$y)
    Start-Sleep -Milliseconds 40
    [System.Windows.Forms.SendKeys]::SendWait(' ')
    return $true
  } catch { return $false }
}

function Find-And-Click($hwnd, $title) {
  $key = "$hwnd|$title"
  if ($clicked.Contains($key)) { return $false }
  try {
    [void][SamaDlg]::ShowWindow($hwnd, 9)
    [void][SamaDlg]::SetForegroundWindow($hwnd)
  } catch {}
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  if (-not $root) { return $false }
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond))
  if (-not $buttons -or $buttons.Count -eq 0) { return $false }

  $isUpdate = $title -match $updateTitle
  $isLicense = $title -match $titleOwned
  $cands = @()
  foreach ($b in $buttons) {
    try {
      $name = [string]$b.Current.Name
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      if ($name -match $avoidDanger) { continue }
      $score = 0
      if ($isLicense -and $name -match $preferDismiss) { $score = 120 }
      elseif ($isUpdate -and $name -match $preferDismiss) { $score = 100 }
      elseif (-not $isUpdate -and -not $isLicense -and $name -match $preferAccept) { $score = 90 }
      elseif ($name -match $preferDismiss) { $score = 70 }
      elseif ($name -match $preferAccept) { $score = 60 }
      else { continue }
      $cands += [pscustomobject]@{ El=$b; Name=$name; Score=$score }
    } catch {}
  }
  if (-not $cands.Count) { return $false }
  $best = $cands | Sort-Object Score -Descending | Select-Object -First 1
  if (Try-InvokeButton $best.El) {
    [void]$clicked.Add($key)
    return $true
  }
  return $false
}

while ((Get-Date) -lt $deadline) {
  foreach ($w in (Get-TopWindows)) {
    [void](Find-And-Click $w.Hwnd ([string]$w.Title))
  }
  Start-Sleep -Seconds $interval
}
`
}

/**
 * 后台启动弹窗清理（立即返回，不 await）。
 * @param {{ processNames?: string[], durationSec?: number }} opts
 */
export function startDialogAutoClick(opts = {}) {
  const processNames = Array.isArray(opts.processNames) ? opts.processNames : []
  const durationSec = Math.min(90, Math.max(15, Number(opts.durationSec) || 55))
  const script = buildWatcherScript({
    processNames,
    durationSec,
    intervalSec: 1.2,
  })

  const tmp = path.join(os.tmpdir(), `sama-dlg-click-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.ps1`)
  try {
    fs.writeFileSync(tmp, script, 'utf8')
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    child.unref()
    // 延迟删脚本，给 powershell 读盘时间
    setTimeout(() => {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }, (durationSec + 5) * 1000)
    return {
      ok: true,
      durationSec,
      processNames,
      note: '已后台尝试自动点掉更新/许可等普通弹窗；UAC 系统权限窗无法代点。',
    }
  } catch (e) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    return { ok: false, error: String(e.message || e) }
  }
}

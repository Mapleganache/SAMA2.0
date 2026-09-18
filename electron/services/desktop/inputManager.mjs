/**
 * 鼠标 / 键盘：user32 SendInput（PowerShell）。不引入 pyautogui。
 * 全部操作默认 CONFIRM（由 permissionManager 控制）。
 */
import { spawnSync } from 'node:child_process'

function runPs(script, timeoutMs = 10000) {
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

const INPUT_HELPER = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SamaInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type; public InputUnion U;
  }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo;
  }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public const uint INPUT_MOUSE=0, INPUT_KEYBOARD=1;
  public const uint MOUSEEVENTF_MOVE=0x0001, MOUSEEVENTF_LEFTDOWN=0x0002, MOUSEEVENTF_LEFTUP=0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN=0x0008, MOUSEEVENTF_RIGHTUP=0x0010, MOUSEEVENTF_MIDDLEDOWN=0x0020, MOUSEEVENTF_MIDDLEUP=0x0040;
  public const uint MOUSEEVENTF_WHEEL=0x0800, MOUSEEVENTF_ABSOLUTE=0x8000;
  public const uint KEYEVENTF_KEYUP=0x0002;
}
"@
`

export function mousePosition() {
  const r = runPs(`${INPUT_HELPER}
$p = New-Object SamaInput+POINT
[void][SamaInput]::GetCursorPos([ref]$p)
@{x=$p.X;y=$p.Y} | ConvertTo-Json -Compress
`)
  try {
    return JSON.parse(r.stdout.trim())
  } catch {
    const err = new Error('无法读取鼠标位置')
    err.code = 'MOUSE_POS_FAILED'
    throw err
  }
}

export function mouseMove(args = {}) {
  const x = Number(args.x)
  const y = Number(args.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const err = new Error('mouse.move 需要数值 x,y')
    err.code = 'INVALID_COORDS'
    throw err
  }
  const r = runPs(`${INPUT_HELPER}
[void][SamaInput]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
'OK'
`)
  if (!/OK/.test(r.stdout)) {
    const err = new Error(`鼠标移动失败: ${r.stderr}`)
    err.code = 'MOUSE_MOVE_FAILED'
    throw err
  }
  return { x: Math.round(x), y: Math.round(y) }
}

function clickFlags(button = 'left') {
  const b = String(button).toLowerCase()
  if (b === 'right') return { down: 0x0008, up: 0x0010 }
  if (b === 'middle') return { down: 0x0020, up: 0x0040 }
  return { down: 0x0002, up: 0x0004 }
}

export function mouseClick(args = {}) {
  if (args.x != null && args.y != null) mouseMove(args)
  const { down, up } = clickFlags(args.button)
  const times = Math.max(1, Math.min(Number(args.clicks) || 1, 3))
  const r = runPs(`${INPUT_HELPER}
function Send-Click($down,$up) {
  $inputs = New-Object SamaInput+INPUT[] 2
  $inputs[0].type = [SamaInput]::INPUT_MOUSE
  $inputs[0].U.mi.dwFlags = $down
  $inputs[1].type = [SamaInput]::INPUT_MOUSE
  $inputs[1].U.mi.dwFlags = $up
  [void][SamaInput]::SendInput(2, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf([type][SamaInput+INPUT]))
}
1..${times} | ForEach-Object { Send-Click ${down} ${up}; Start-Sleep -Milliseconds 40 }
'OK'
`)
  if (!/OK/.test(r.stdout)) {
    const err = new Error(`鼠标点击失败: ${r.stderr}`)
    err.code = 'MOUSE_CLICK_FAILED'
    throw err
  }
  const pos = mousePosition()
  return { ...pos, button: args.button || 'left', clicks: times }
}

export function mouseDoubleClick(args = {}) {
  return mouseClick({ ...args, clicks: 2, button: args.button || 'left' })
}

export function mouseRightClick(args = {}) {
  return mouseClick({ ...args, button: 'right', clicks: 1 })
}

export function mouseDrag(args = {}) {
  const x1 = Number(args.x1 ?? args.fromX)
  const y1 = Number(args.y1 ?? args.fromY)
  const x2 = Number(args.x2 ?? args.toX ?? args.x)
  const y2 = Number(args.y2 ?? args.toY ?? args.y)
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    const err = new Error('mouse.drag 需要 x1,y1,x2,y2')
    err.code = 'INVALID_COORDS'
    throw err
  }
  mouseMove({ x: x1, y: y1 })
  const r = runPs(`${INPUT_HELPER}
$down = New-Object SamaInput+INPUT[] 1
$down[0].type = [SamaInput]::INPUT_MOUSE
$down[0].U.mi.dwFlags = [SamaInput]::MOUSEEVENTF_LEFTDOWN
[void][SamaInput]::SendInput(1, $down, [System.Runtime.InteropServices.Marshal]::SizeOf([type][SamaInput+INPUT]))
[void][SamaInput]::SetCursorPos(${Math.round(x2)}, ${Math.round(y2)})
Start-Sleep -Milliseconds 30
$up = New-Object SamaInput+INPUT[] 1
$up[0].type = [SamaInput]::INPUT_MOUSE
$up[0].U.mi.dwFlags = [SamaInput]::MOUSEEVENTF_LEFTUP
[void][SamaInput]::SendInput(1, $up, [System.Runtime.InteropServices.Marshal]::SizeOf([type][SamaInput+INPUT]))
'OK'
`)
  if (!/OK/.test(r.stdout)) {
    const err = new Error(`拖拽失败: ${r.stderr}`)
    err.code = 'MOUSE_DRAG_FAILED'
    throw err
  }
  return { from: { x: x1, y: y1 }, to: { x: x2, y: y2 } }
}

export function mouseScroll(args = {}) {
  const delta = Number(args.delta ?? args.amount ?? -120)
  const r = runPs(`${INPUT_HELPER}
$inputs = New-Object SamaInput+INPUT[] 1
$inputs[0].type = [SamaInput]::INPUT_MOUSE
$inputs[0].U.mi.dwFlags = [SamaInput]::MOUSEEVENTF_WHEEL
$inputs[0].U.mi.mouseData = [uint32](${Math.round(delta)} -band 0xFFFFFFFF)
[void][SamaInput]::SendInput(1, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf([type][SamaInput+INPUT]))
'OK'
`)
  if (!/OK/.test(r.stdout)) {
    const err = new Error(`滚轮失败: ${r.stderr}`)
    err.code = 'MOUSE_SCROLL_FAILED'
    throw err
  }
  return { delta }
}

/** 常用虚拟键 */
const VK = {
  ENTER: 0x0d,
  RETURN: 0x0d,
  TAB: 0x09,
  ESC: 0x1b,
  ESCAPE: 0x1b,
  BACKSPACE: 0x08,
  DELETE: 0x2e,
  SPACE: 0x20,
  UP: 0x26,
  DOWN: 0x28,
  LEFT: 0x25,
  RIGHT: 0x27,
  HOME: 0x24,
  END: 0x23,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  CTRL: 0x11,
  CONTROL: 0x11,
  ALT: 0x12,
  SHIFT: 0x10,
  WIN: 0x5b,
  LWIN: 0x5b,
}

function resolveVk(key) {
  const k = String(key || '').trim().toUpperCase()
  if (VK[k] != null) return VK[k]
  if (/^[A-Z0-9]$/.test(k)) return k.charCodeAt(0)
  const err = new Error(`不支持的按键: ${key}`)
  err.code = 'UNSUPPORTED_KEY'
  throw err
}

function sendVk(vk, keyUp = false) {
  const flags = keyUp ? 0x0002 : 0
  const r = runPs(`${INPUT_HELPER}
$inputs = New-Object SamaInput+INPUT[] 1
$inputs[0].type = [SamaInput]::INPUT_KEYBOARD
$inputs[0].U.ki.wVk = ${vk}
$inputs[0].U.ki.dwFlags = ${flags}
[void][SamaInput]::SendInput(1, $inputs, [System.Runtime.InteropServices.Marshal]::SizeOf([type][SamaInput+INPUT]))
'OK'
`)
  if (!/OK/.test(r.stdout)) {
    const err = new Error('按键发送失败')
    err.code = 'KEY_SEND_FAILED'
    throw err
  }
}

export function keyboardPress(args = {}) {
  const key = args.key || args.name
  const vk = resolveVk(key)
  sendVk(vk, false)
  sendVk(vk, true)
  return { key: String(key), vk }
}

export function keyboardHotkey(args = {}) {
  const keys = Array.isArray(args.keys) ? args.keys : String(args.hotkey || args.combo || '').split(/[+\s]+/).filter(Boolean)
  if (!keys.length) {
    const err = new Error('hotkey 需要 keys 数组，如 ["CTRL","C"]')
    err.code = 'HOTKEY_REQUIRED'
    throw err
  }
  const vks = keys.map(resolveVk)
  for (const vk of vks) sendVk(vk, false)
  for (const vk of [...vks].reverse()) sendVk(vk, true)
  return { keys }
}

export function keyboardType(args = {}) {
  const text = String(args.text ?? args.content ?? '')
  if (!text) {
    const err = new Error('keyboard.type 需要 text')
    err.code = 'TEXT_REQUIRED'
    throw err
  }
  // 使用 SendKeys 支持 Unicode；限长防滥用
  if (text.length > 2000) {
    const err = new Error('单次输入过长（>2000）')
    err.code = 'TEXT_TOO_LONG'
    throw err
  }
  const escaped = text
    .replace(/\{/g, '{{}')
    .replace(/\}/g, '{}}')
    .replace(/\+/g, '{+}')
    .replace(/\^/g, '{^}')
    .replace(/%/g, '{%}')
    .replace(/~/g, '{~}')
    .replace(/\(/g, '{(}')
    .replace(/\)/g, '{)}')
  const r = runPs(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
'OK'
`)
  if (!/OK/.test(r.stdout)) {
    const err = new Error(`键盘输入失败: ${r.stderr}`)
    err.code = 'TYPE_FAILED'
    throw err
  }
  return { length: text.length }
}

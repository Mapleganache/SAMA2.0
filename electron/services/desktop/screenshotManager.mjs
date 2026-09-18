/**
 * 截图：全屏 / 窗口 / 区域 → PNG（写入允许根，默认桌面 sama-screenshots）
 * 优先 Electron desktopCapturer；失败则 PowerShell + System.Drawing
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { assertAllowedUserAbs, normalizeAbs, getAllowedRoots } from '../safeFs.mjs'
import { ensureDir } from '../paths.mjs'
import { windowList, windowFocus } from './windowManager.mjs'

function defaultShotDir() {
  const roots = getAllowedRoots()
  const desktop = roots.find((r) => /[\\/]Desktop$/i.test(r)) || path.join(os.homedir(), 'Desktop')
  const dir = path.join(desktop, 'sama-screenshots')
  ensureDir(dir)
  return dir
}

function resolveOutPath(args = {}) {
  if (args.path || args.outPath) {
    const abs = normalizeAbs(String(args.path || args.outPath))
    assertAllowedUserAbs(abs)
    ensureDir(path.dirname(abs))
    return abs
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = String(args.filename || `shot_${stamp}.png`)
  const abs = path.join(defaultShotDir(), name.replace(/[<>:"|?*]/g, '_'))
  assertAllowedUserAbs(abs)
  return abs
}

function captureViaPowerShell({ x, y, width, height, outPath }) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$x = ${Number(x) || 0}; $y = ${Number(y) || 0}
$w = ${Number(width)}; $h = ${Number(height)}
if ($w -le 0 -or $h -le 0) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $x = $bounds.X; $y = $bounds.Y; $w = $bounds.Width; $h = $bounds.Height
}
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h))
$g.Dispose()
$out = '${String(outPath).replace(/'/g, "''")}'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
if (Test-Path $out) { 'OK:' + (Get-Item $out).Length } else { 'FAIL' }
`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  })
  const out = String(r.stdout || '')
  if (!/OK:(\d+)/.test(out)) {
    const err = new Error(`截图失败: ${r.stderr || out || r.error}`)
    err.code = 'SCREENSHOT_FAILED'
    throw err
  }
  return { bytes: Number(RegExp.$1) }
}

async function captureViaElectronFull(outPath) {
  try {
    const { desktopCapturer, screen } = await import('electron')
    const disp = screen.getPrimaryDisplay()
    const { width, height } = disp.size
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    })
    const src = sources[0]
    if (!src?.thumbnail || src.thumbnail.isEmpty()) {
      return null
    }
    const png = src.thumbnail.toPNG()
    fs.writeFileSync(outPath, png)
    return { bytes: png.length, method: 'electron-desktopCapturer' }
  } catch {
    return null
  }
}

function getWindowRect(handle) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@
$r = New-Object WinRect+RECT
[void][WinRect]::GetWindowRect([IntPtr]${Number(handle)}, [ref]$r)
@{x=$r.Left;y=$r.Top;width=($r.Right-$r.Left);height=($r.Bottom-$r.Top)} | ConvertTo-Json -Compress
`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000,
  })
  try {
    return JSON.parse(String(r.stdout || '').trim())
  } catch {
    return null
  }
}

export async function screenshotScreen(args = {}) {
  const outPath = resolveOutPath(args)
  const ele = await captureViaElectronFull(outPath)
  if (ele) {
    return { path: outPath, scope: 'screen', ...ele }
  }
  const r = captureViaPowerShell({ x: 0, y: 0, width: 0, height: 0, outPath })
  return { path: outPath, scope: 'screen', method: 'gdi', ...r }
}

export async function screenshotRegion(args = {}) {
  const x = Number(args.x)
  const y = Number(args.y)
  const width = Number(args.width)
  const height = Number(args.height)
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width <= 0 || height <= 0) {
    const err = new Error('region 需要 x,y,width,height 正数')
    err.code = 'INVALID_REGION'
    throw err
  }
  const outPath = resolveOutPath(args)
  const r = captureViaPowerShell({ x, y, width, height, outPath })
  return { path: outPath, scope: 'region', method: 'gdi', x, y, width, height, ...r }
}

export async function screenshotWindow(args = {}) {
  const title = String(args.title || args.name || args.window || '').trim()
  const list = windowList().windows || []
  let hit = null
  if (args.handle) {
    hit = list.find((w) => Number(w.handle) === Number(args.handle))
  } else if (title) {
    const lower = title.toLowerCase()
    const hits = list.filter((w) => String(w.title || '').toLowerCase().includes(lower))
    hits.sort((a, b) => String(a.title).length - String(b.title).length)
    hit = hits[0]
  }
  if (!hit) {
    const err = new Error(title ? `未找到窗口「${title}」` : '请提供 title 或 handle')
    err.code = 'WINDOW_NOT_FOUND'
    throw err
  }
  try {
    windowFocus({ handle: hit.handle })
  } catch {
    /* 仍尝试截矩形 */
  }
  const rect = getWindowRect(hit.handle)
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    const err = new Error('无法读取窗口矩形')
    err.code = 'WINDOW_RECT_FAILED'
    throw err
  }
  const outPath = resolveOutPath({
    ...args,
    filename: args.filename || `win_${String(hit.title).slice(0, 40).replace(/[<>:"|?*\\/]/g, '_')}.png`,
  })
  const r = captureViaPowerShell({ ...rect, outPath })
  return {
    path: outPath,
    scope: 'window',
    method: 'gdi',
    window: hit,
    rect,
    ...r,
  }
}

/** 统一入口：screen | window | region */
export async function screenshotCapture(args = {}) {
  const scope = String(args.scope || args.type || 'screen').toLowerCase()
  if (scope === 'window') return screenshotWindow(args)
  if (scope === 'region') return screenshotRegion(args)
  return screenshotScreen(args)
}

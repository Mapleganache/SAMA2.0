/**
 * OCR 可插拔：优先 Windows.Media.Ocr（WinRT PowerShell）；不可用则明确返回 unavailable。
 * 不假装识别成功。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { assertAllowedUserAbs, normalizeAbs } from '../safeFs.mjs'

export function ocrAvailable() {
  const script = `
try {
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
  $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($eng) { 'YES' } else { 'NO' }
} catch { 'NO:' + $_.Exception.Message }
`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  })
  const out = String(r.stdout || '').trim()
  return { available: out.startsWith('YES'), detail: out }
}

function runWindowsOcrPng(imagePath) {
  const avail = ocrAvailable()
  if (!avail.available) {
    return {
      available: false,
      provider: 'windows-ocr',
      lines: [],
      text: '',
      error: {
        code: 'OCR_UNAVAILABLE',
        message:
          '当前环境无法使用 Windows.Media.Ocr（需 Win10+ 且 PowerShell 可加载 WinRT）。未伪造识别结果。',
        detail: avail.detail,
      },
    }
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType=WindowsRuntime]

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]

function AwaitOp($op) {
  $task = $asTaskGeneric.MakeGenericMethod($op.GetType().GenericTypeArguments).Invoke($null, @($op))
  $task.Wait()
  return $task.Result
}

$path = '${String(imagePath).replace(/'/g, "''")}'
$fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($path)
$file = AwaitOp $fileOp
$streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$stream = AwaitOp $streamOp
$decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
$decoder = AwaitOp $decoderOp
$bmpOp = $decoder.GetSoftwareBitmapAsync()
$bmp = AwaitOp $bmpOp
$eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$resultOp = $eng.RecognizeAsync($bmp)
$result = AwaitOp $resultOp
$lines = @()
foreach ($line in $result.Lines) {
  $words = @($line.Words)
  if ($words.Count -lt 1) { continue }
  $xs = $words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width/2 }
  $ys = $words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height/2 }
  $lines += [pscustomobject]@{
    text = $line.Text
    x = [int](($xs | Measure-Object -Average).Average)
    y = [int](($ys | Measure-Object -Average).Average)
  }
}
@{ available=$true; provider='windows-ocr'; text=$result.Text; lines=$lines } | ConvertTo-Json -Compress -Depth 5
`
  const r = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
  })
  try {
    const data = JSON.parse(String(r.stdout || '').trim())
    if (!data.available && data.error) return data
    return {
      available: true,
      provider: 'windows-ocr',
      text: data.text || '',
      lines: Array.isArray(data.lines) ? data.lines : data.lines ? [data.lines] : [],
    }
  } catch {
    return {
      available: false,
      provider: 'windows-ocr',
      lines: [],
      text: '',
      error: {
        code: 'OCR_FAILED',
        message: 'Windows OCR 调用失败（未伪造结果）',
        detail: (r.stderr || r.stdout || '').slice(0, 800),
      },
    }
  }
}

/**
 * 对 PNG 做 OCR，返回行文本与近似中心点（若引擎可用）
 */
export function ocrImage(args = {}) {
  const imagePath = normalizeAbs(String(args.path || args.image || ''))
  assertAllowedUserAbs(imagePath)
  if (!fs.existsSync(imagePath)) {
    const err = new Error(`图片不存在: ${imagePath}`)
    err.code = 'FILE_NOT_FOUND'
    throw err
  }
  if (!/\.png$/i.test(imagePath)) {
    const err = new Error('OCR 目前仅支持 PNG（请先 screenshot）')
    err.code = 'UNSUPPORTED_IMAGE'
    throw err
  }
  return runWindowsOcrPng(imagePath)
}

/** 内部识图：任意已落盘 PNG，不走用户目录白名单（仅临时文件） */
export function ocrLocalPng(imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return { available: false, text: '', lines: [], error: { code: 'NOT_FOUND' } }
  }
  return runWindowsOcrPng(imagePath)
}

export function ocrTempDir() {
  const dir = path.join(os.tmpdir(), 'sama-ocr')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 在 OCR 行中查找描述
 */
export function ocrFindText(args = {}) {
  const needle = String(args.description || args.name || args.query || '').trim()
  if (!needle) {
    const err = new Error('需要 description')
    err.code = 'QUERY_REQUIRED'
    throw err
  }
  const ocr = ocrImage(args)
  if (!ocr.available) {
    return { found: false, source: 'ocr', ocr }
  }
  const lower = needle.toLowerCase()
  const hits = (ocr.lines || []).filter((l) => String(l.text || '').toLowerCase().includes(lower))
  if (!hits.length) {
    return { found: false, source: 'ocr', query: needle, text: ocr.text }
  }
  const best = hits[0]
  return {
    found: true,
    source: 'ocr',
    query: needle,
    x: best.x,
    y: best.y,
    text: best.text,
    confidence: 0.6,
    matches: hits.slice(0, 8),
  }
}

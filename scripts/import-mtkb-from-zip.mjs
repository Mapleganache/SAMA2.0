/**
 * 从「SAMA-*-MTKB-可交付版.zip」导入 resources/mtkb
 * 用法：
 *   node scripts/import-mtkb-from-zip.mjs
 *   node scripts/import-mtkb-from-zip.mjs "D:\path\to\SAMA-1.1.0-MTKB-可交付版.zip"
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dest = path.join(root, 'resources', 'mtkb')

function findDefaultZip() {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop')
  if (!fs.existsSync(desktop)) return null
  const hit = fs
    .readdirSync(desktop)
    .filter((n) => /SAMA.*MTKB.*\.zip$/i.test(n) || /MTKB.*可交付.*\.zip$/i.test(n))
    .map((n) => ({ n, t: fs.statSync(path.join(desktop, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]
  return hit ? path.join(desktop, hit.n) : null
}

const zipPath = process.argv[2] || findDefaultZip()
if (!zipPath || !fs.existsSync(zipPath)) {
  console.error('未找到 MTKB 可交付版 zip。请传入路径或放到桌面。')
  process.exit(1)
}

console.log('ZIP:', zipPath)
console.log('DEST:', dest)

// 用 PowerShell/.NET 解压 mtkb 前缀，避免依赖额外包
const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = ${JSON.stringify(zipPath)}
$dest = ${JSON.stringify(dest)}
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$z = [IO.Compression.ZipFile]::OpenRead($zip)
$prefix = $null
foreach ($e in $z.Entries) {
  if ($e.FullName -match 'resources/mtkb/') {
    $prefix = ($e.FullName -split 'resources/mtkb/')[0] + 'resources/mtkb/'
    break
  }
}
if (-not $prefix) { throw 'zip 内未找到 resources/mtkb/' }
$count = 0
foreach ($e in $z.Entries) {
  if (-not $e.FullName.StartsWith($prefix)) { continue }
  $rel = $e.FullName.Substring($prefix.Length)
  if ([string]::IsNullOrEmpty($rel)) { continue }
  $out = Join-Path $dest ($rel -replace '/','\\\\')
  if ($e.FullName.EndsWith('/')) {
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    continue
  }
  $dir = [IO.Path]::GetDirectoryName($out)
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $stream = $e.Open(); $fs = [IO.File]::Create($out); $stream.CopyTo($fs); $fs.Close(); $stream.Close()
  $count++
}
$z.Dispose()
Write-Output "extracted $count files"
`

const { execFileSync } = require('node:child_process')
const out = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { encoding: 'utf8' },
)
console.log(out.trim())

const bundle = path.join(dest, 'sama-docs', 'bundle.json')
const manifest = path.join(dest, '数据库包', 'manifest.json')
if (!fs.existsSync(bundle)) {
  console.error('导入后缺少 sama-docs/bundle.json')
  process.exit(1)
}
console.log('bundle:', JSON.parse(fs.readFileSync(bundle, 'utf8')).bundle_version)
console.log('sqlite manifest:', fs.existsSync(manifest) ? 'ok' : 'missing')
console.log('完成。打包时会经 package.json extraResources 打入 resources/mtkb。')

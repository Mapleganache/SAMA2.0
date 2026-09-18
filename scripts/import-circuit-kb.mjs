/**
 * 整理并接入微信收到的「电路数据库.sqlite3」+「circuit.zip」到 SAMA MTKB。
 *
 * 用法：
 *   node scripts/import-circuit-kb.mjs
 *   node scripts/import-circuit-kb.mjs "<sqlite路径>" "<circuit.zip路径>"
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const pkgRoot = path.join(root, 'resources', 'mtkb', '数据库包')
const circDbDest = path.join(pkgRoot, '专有数据库', '电路数据库.sqlite3')
const manifestPath = path.join(pkgRoot, 'manifest.json')
const bundlePath = path.join(root, 'resources', 'mtkb', 'sama-docs', 'bundle.json')
const casesDest = path.join(root, 'resources', 'mtkb', 'sama-docs', '通用', 'MTKB', 'circuit-cases')

const defaultSqlite = path.join(
  'd:\\WeChat Files\\xwechat_files\\wxid_ii0n6459zu9322_fca9\\msg\\file\\2026-08',
  '电路数据库.sqlite3',
)
const defaultZip = path.join(
  'd:\\WeChat Files\\xwechat_files\\wxid_ii0n6459zu9322_fca9\\msg\\file\\2026-08',
  'circuit.zip',
)

const srcSqlite = process.argv[2] || defaultSqlite
const srcZip = process.argv[3] || defaultZip

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function copyTreeFiltered(src, dest) {
  ensureDir(dest)
  let files = 0
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '__MACOSX' || ent.name.startsWith('._')) continue
    const from = path.join(src, ent.name)
    const to = path.join(dest, ent.name)
    if (ent.isDirectory()) files += copyTreeFiltered(from, to)
    else if (ent.isFile()) {
      fs.copyFileSync(from, to)
      files += 1
    }
  }
  return files
}

function countMd(dir) {
  let n = 0
  if (!fs.existsSync(dir)) return 0
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__MACOSX' || ent.name.startsWith('._')) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) n += countMd(full)
    else if (/\.md$/i.test(ent.name)) n += 1
  }
  return n
}

assert(fs.existsSync(srcSqlite), `找不到 sqlite：${srcSqlite}`)
assert(fs.existsSync(srcZip), `找不到 zip：${srcZip}`)
assert(fs.existsSync(manifestPath), '缺少 MTKB manifest，请先 npm run import:mtkb')

console.log('SRC sqlite:', srcSqlite)
console.log('SRC zip:', srcZip)

// 1) 备份旧库并替换
ensureDir(path.dirname(circDbDest))
const bak = path.join(path.dirname(circDbDest), `电路数据库.prev.sqlite3`)
if (fs.existsSync(circDbDest)) {
  fs.copyFileSync(circDbDest, bak)
  console.log('backed up old circuit db →', bak)
}
fs.copyFileSync(srcSqlite, circDbDest)
const size = fs.statSync(circDbDest).size
const sha = sha256File(circDbDest)
console.log('installed circuit sqlite', (size / 1e6).toFixed(2) + 'MB', sha.slice(0, 12) + '…')

const db = new DatabaseSync(circDbDest, { readOnly: true })
const stats = {
  documents: db.prepare('SELECT COUNT(*) AS c FROM documents').get().c,
  chunks: db.prepare('SELECT COUNT(*) AS c FROM chunks').get().c,
  assets: db.prepare('SELECT COUNT(*) AS c FROM assets').get().c,
  asset_bytes: db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS c FROM assets').get().c,
}
db.close()
console.log('sqlite stats', stats)

// 2) 更新 manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.databases = manifest.databases || {}
manifest.databases.circuit = {
  path: '专有数据库/电路数据库.sqlite3',
  sha256: sha,
  size_bytes: size,
  stats,
  updated_at: new Date().toISOString(),
  source: 'circuit.zip + 电路数据库.sqlite3 (WeChat 2026-08)',
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log('manifest circuit updated')

// 3) 解压 circuit.zip → sama-docs/通用/MTKB/circuit-cases
// 用 .NET ZipFile 解到纯 ASCII 临时目录，避开 Expand-Archive + 中文用户名问题
const tmp = 'C:\\Temp\\sama-circuit-import'
rmrf(tmp)
ensureDir(tmp)
const extractPs = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = ${JSON.stringify(srcZip)}
$dest = ${JSON.stringify(tmp)}
$z = [IO.Compression.ZipFile]::OpenRead($zip)
foreach ($e in $z.Entries) {
  $name = $e.FullName -replace '/', [IO.Path]::DirectorySeparatorChar
  if ($name -match '(^|[\\\\/])__MACOSX([\\\\/]|$)' -or $name -match '[\\\\/]\\._') { continue }
  $out = Join-Path $dest $name
  if ($e.FullName.EndsWith('/')) {
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    continue
  }
  $dir = [IO.Path]::GetDirectoryName($out)
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $stream = $e.Open(); $fs = [IO.File]::Create($out); $stream.CopyTo($fs); $fs.Close(); $stream.Close()
}
$z.Dispose()
Write-Output 'ok'
`
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', extractPs],
  { encoding: 'utf8' },
)

const circuitRoot = fs.existsSync(path.join(tmp, 'circuit'))
  ? path.join(tmp, 'circuit')
  : tmp
rmrf(casesDest)
const copied = copyTreeFiltered(circuitRoot, casesDest)
const mdCount = countMd(casesDest)
console.log(`circuit-cases: ${copied} files, ${mdCount} markdown →`, casesDest)

// 也在桌面 SAMA文件 留一份只读副本，方便人翻
try {
  const desk = path.join(
    process.env.USERPROFILE || '',
    'Desktop',
    'SAMA文件',
    '03_电路图',
    '_知识库_circuit-cases',
  )
  rmrf(desk)
  copyTreeFiltered(casesDest, desk)
  console.log('desktop mirror:', desk)
} catch (e) {
  console.warn('desktop mirror skip:', e.message)
}

// 4) bump bundle，启动时重装 通用/MTKB
const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
const oldVer = bundle.bundle_version
bundle.bundle_version = 'mtkb-sama-1.1.0-circuit-v2'
bundle.databases = bundle.databases || {}
bundle.databases.circuit = {
  documents: stats.documents,
  chunks: stats.chunks,
  cases_markdown: mdCount,
}
bundle.documents = Number(bundle.databases.common?.documents || 0)
  + Number(bundle.databases.equipment?.documents || 0)
  + Number(stats.documents)
bundle.chunks = Number(bundle.databases.common?.chunks || 0)
  + Number(bundle.databases.equipment?.chunks || 0)
  + Number(stats.chunks)
bundle.circuit_cases_path = '通用/MTKB/circuit-cases'
bundle.updated_at = new Date().toISOString()
fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8')
console.log(`bundle ${oldVer} → ${bundle.bundle_version}`)

rmrf(tmp)
console.log('OK: circuit KB imported. 重启 SAMA 后电气对话可检索新库。')

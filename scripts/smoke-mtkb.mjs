/**
 * MTKB 冒烟：校验资源路径 + SQLite 检索（不启动 Electron GUI）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mtkb = path.join(root, 'resources', 'mtkb')
const bundlePath = path.join(mtkb, 'sama-docs', 'bundle.json')
const pkgRoot = path.join(mtkb, '数据库包')
const manifestPath = path.join(pkgRoot, 'manifest.json')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(fs.existsSync(bundlePath), '缺少 sama-docs/bundle.json，请 npm run import:mtkb')
const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
assert(bundle.bundle_version, 'bundle_version 缺失')
console.log('bundle', bundle.bundle_version, 'docs', bundle.documents)

assert(fs.existsSync(manifestPath), '缺少 数据库包/manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const { DatabaseSync } = require('node:sqlite')

const queries = ['伺服报警 400', '急停 超程', 'STO 安全']
let totalHits = 0

for (const [kind, meta] of Object.entries(manifest.databases || {})) {
  const dbFile = path.join(pkgRoot, meta.path)
  assert(fs.existsSync(dbFile), `缺少数据库 ${kind}: ${meta.path}`)
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const count = db.prepare('select count(*) as c from chunks').get().c
  console.log(`db ${kind}: chunks=${count} size=${(fs.statSync(dbFile).size / 1e6).toFixed(1)}MB`)
  for (const q of queries) {
    const term = q.split(/\s+/)[0]
    const n = db
      .prepare('select count(*) as c from chunks where content like ? or heading like ?')
      .get(`%${term}%`, `%${term}%`).c
    if (n > 0) totalHits += 1
  }
}

assert(totalHits > 0, '样例查询在三个库中均无命中')
console.log('OK MTKB smoke passed, sampleHits=', totalHits)

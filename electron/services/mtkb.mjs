/**
 * MTKB（机床智能体本地知识库）官方接入：
 * - resources/mtkb/sama-docs → 用户 kb/docs/通用/MTKB（版本化安装）
 * - resources/mtkb/数据库包  → 只读 SQLite 检索（共通/设备/电路）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { ensureDir, getKbRoot, getUserDbRegistryPath, readJson, writeJson } from './paths.mjs'

const require = createRequire(import.meta.url)

const DB_KINDS = [
  { key: 'common', scoreBoost: 1 },
  { key: 'equipment', scoreBoost: 2 },
  { key: 'circuit', scoreBoost: 2 },
]

const dbCache = new Map()

function getDatabaseSync() {
  if (globalThis.__samaSqliteDatabaseSync) return globalThis.__samaSqliteDatabaseSync
  try {
    const builtin = process.getBuiltinModule?.('sqlite')
    if (builtin?.DatabaseSync) {
      globalThis.__samaSqliteDatabaseSync = builtin.DatabaseSync
      return builtin.DatabaseSync
    }
  } catch {
    /* ignore */
  }
  try {
    const { DatabaseSync } = require('node:sqlite')
    globalThis.__samaSqliteDatabaseSync = DatabaseSync
    return DatabaseSync
  } catch {
    return null
  }
}

export function getMtkbRoot() {
  try {
    if (app?.isPackaged) {
      return path.join(process.resourcesPath, 'mtkb')
    }
  } catch {
    /* app 未就绪时按开发目录处理 */
  }
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.join(here, '..', '..', 'resources', 'mtkb')
}

export function getMtkbDocsSourceRoot() {
  return path.join(getMtkbRoot(), 'sama-docs')
}

export function getMtkbPackageRoot() {
  return path.join(getMtkbRoot(), '数据库包')
}

export function loadMtkbBundleMeta() {
  return readJson(path.join(getMtkbDocsSourceRoot(), 'bundle.json'), null)
}

export function loadMtkbDbManifest() {
  return readJson(path.join(getMtkbPackageRoot(), 'manifest.json'), null)
}

function resolveDbPaths() {
  const out = {}
  const root = getMtkbPackageRoot()
  const manifest = loadMtkbDbManifest()
  if (manifest?.databases) {
    for (const kind of DB_KINDS) {
      const rel = manifest.databases[kind.key]?.path
      if (!rel) continue
      const full = path.join(root, rel)
      if (fs.existsSync(full)) out[kind.key] = full
    }
  }

  // 用户导入的 SQLite（结构需含 documents/chunks，与 MTKB 同构）
  try {
    const reg = readJson(getUserDbRegistryPath(), { databases: [] })
    for (const entry of reg.databases || []) {
      if (!entry?.path || !fs.existsSync(entry.path)) continue
      const key = `user:${entry.id || path.basename(entry.path)}`
      out[key] = entry.path
    }
  } catch {
    /* ignore */
  }

  return Object.keys(out).length ? out : null
}

export function invalidateMtkbDbCache() {
  for (const db of dbCache.values()) {
    try {
      db.close?.()
    } catch {
      /* ignore */
    }
  }
  dbCache.clear()
}

/**
 * 版本变化时更新托管的 通用/MTKB；用户其它资料不动。
 */
export function installBundledMtkb(docsDir) {
  const sourceRoot = getMtkbDocsSourceRoot()
  const bundle = loadMtkbBundleMeta()
  if (!bundle?.bundle_version || !fs.existsSync(sourceRoot)) {
    return { installed: false, documents: 0, bundleVersion: null }
  }

  const statePath = path.join(getKbRoot(), 'mtkb-bundle.json')
  const state = readJson(statePath, {})
  const targetRoot = path.join(docsDir, '通用', 'MTKB')
  if (state.bundle_version === bundle.bundle_version && fs.existsSync(targetRoot)) {
    return {
      installed: false,
      documents: bundle.documents || 0,
      bundleVersion: bundle.bundle_version,
    }
  }

  try {
    if (fs.existsSync(targetRoot)) fs.rmSync(targetRoot, { recursive: true, force: true })
    copyTree(path.join(sourceRoot, '通用', 'MTKB'), targetRoot)
    writeJson(statePath, {
      bundle_version: bundle.bundle_version,
      installedAt: new Date().toISOString(),
      documents: bundle.documents || 0,
      chunks: bundle.chunks || 0,
      databases: bundle.databases || null,
    })
    return {
      installed: true,
      documents: bundle.documents || 0,
      bundleVersion: bundle.bundle_version,
    }
  } catch (err) {
    console.error('[MTKB] 自动接入失败：', err)
    return { installed: false, documents: 0, bundleVersion: bundle.bundle_version }
  }
}

function copyTree(source, target) {
  if (!fs.existsSync(source)) throw new Error(`内置 MTKB 不存在：${source}`)
  ensureDir(target)
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

export function loadMtkbStatus() {
  const bundle = loadMtkbBundleMeta()
  const state = readJson(path.join(getKbRoot(), 'mtkb-bundle.json'), {})
  const dbPaths = resolveDbPaths()
  const dbManifest = loadMtkbDbManifest()
  const userDbCount = Object.keys(dbPaths || {}).filter((k) => k.startsWith('user:')).length
  const installed =
    Boolean(state.bundle_version) &&
    fs.existsSync(path.join(getKbRoot(), 'docs', '通用', 'MTKB'))

  const bundledReady = Boolean(dbPaths && (dbPaths.common || dbPaths.equipment || dbPaths.circuit))
  const sqliteReady = Boolean(bundledReady || userDbCount)

  return {
    available: Boolean(bundle?.bundle_version) || userDbCount > 0,
    bundleVersion: bundle?.bundle_version || null,
    installedVersion: state.bundle_version || null,
    installed,
    documents: bundle?.documents || state.documents || 0,
    chunks: bundle?.chunks || state.chunks || 0,
    sqliteReady,
    sqlitePath: bundledReady ? getMtkbPackageRoot() : null,
    userDatabaseCount: userDbCount,
    sqliteStats: dbManifest?.databases
      ? {
          common: dbManifest.databases.common?.stats || null,
          equipment: dbManifest.databases.equipment?.stats || null,
          circuit: dbManifest.databases.circuit?.stats || null,
        }
      : null,
    note: [
      bundle?.bundle_version
        ? sqliteReady
          ? `MTKB ${bundle.bundle_version} · 文档 ${bundle.documents || 0} · SQLite 已就绪`
          : `MTKB 文档包 ${bundle.bundle_version} 可用；SQLite 数据库包缺失`
        : userDbCount
          ? '已接入用户 SQLite 知识库'
          : '未找到内置 MTKB（resources/mtkb）',
      userDbCount ? `用户库 ${userDbCount} 个` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

function openDb(DatabaseSync, filePath) {
  let db = dbCache.get(filePath)
  if (db) return db
  db = new DatabaseSync(filePath, { readOnly: true })
  dbCache.set(filePath, db)
  return db
}

function tokenize(q) {
  const raw = String(q || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff#+.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1)

  const out = []
  for (const t of raw) {
    out.push(t)
    // 中文长词补二字窗口，便于「伺服报警」命中「伺服」「报警」
    if (/^[\u4e00-\u9fff]+$/.test(t) && t.length >= 4) {
      for (let i = 0; i + 2 <= t.length; i += 1) out.push(t.slice(i, i + 2))
    }
  }
  return [...new Set(out)].slice(0, 14)
}

function stripMarkup(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 直接检索三个 SQLite（LIKE 打分，与 mtkb.py search_package 同思路）。
 * 同步封装：首次动态 import 失败则返回 []。
 */
export function searchMtkbSqlite(query, { limit = 4 } = {}) {
  const terms = tokenize(query)
  if (!terms.length) return []
  const dbPaths = resolveDbPaths()
  if (!dbPaths) return []

  const DatabaseSync = getDatabaseSync()
  if (!DatabaseSync) return []

  const results = []
  const kinds = [
    ...DB_KINDS,
    ...Object.keys(dbPaths)
      .filter((k) => k.startsWith('user:'))
      .map((key) => ({ key, scoreBoost: 3 })),
  ]
  for (const kind of kinds) {
    const file = dbPaths[kind.key]
    if (!file) continue
    try {
      const db = openDb(DatabaseSync, file)
      const termClause = terms
        .map(() => '(c.content LIKE ? OR c.heading LIKE ? OR d.title LIKE ? OR d.source_path LIKE ?)')
        .join(' OR ')
      const params = []
      for (const term of terms) {
        const like = `%${term}%`
        params.push(like, like, like, like)
      }
      const fetchLimit = Math.max(limit * 5, 24)
      const rows = db
        .prepare(
          `SELECT c.id, c.heading, c.content, d.id AS document_id, d.title, d.source_path,
                  c.domain, c.machine_type, c.brand, c.model
           FROM chunks c JOIN documents d ON d.id = c.document_id
           WHERE (${termClause})
           LIMIT ?`,
        )
        .all(...params, fetchLimit)

      for (const row of rows) {
        const heading = String(row.heading || '')
        const plain = stripMarkup(row.content)
        const hay = `${heading} ${plain} ${row.title || ''}`.toLowerCase()
        let score = kind.scoreBoost
        let matchedTerms = 0
        for (const term of terms) {
          if (!hay.includes(term)) continue
          matchedTerms += 1
          if (heading.toLowerCase().includes(term)) score += 4
          else if (String(row.title || '')
            .toLowerCase()
            .includes(term))
            score += 3
          else score += Math.min(3, hay.split(term).length - 1)
        }
        // 至少命中一个实质词；多关键词时尽量命中 2 个以上
        const substantive = terms.filter((t) => t.length >= 2)
        if (matchedTerms === 0) continue
        if (substantive.length >= 2 && matchedTerms < 2) continue
        score += matchedTerms * 2
        results.push({
          id: `mtkb:${kind.key}:${row.id}`,
          brand: row.brand || '通用',
          source: `MTKB/${kind.key}/${row.document_id || row.id}`,
          content: [
            row.title ? `【${row.title}】` : '',
            heading ? `## ${heading}` : '',
            plain.slice(0, 900),
          ]
            .filter(Boolean)
            .join('\n'),
          score,
          database: kind.key,
          documentId: row.document_id,
        })
      }
    } catch (err) {
      console.warn(`[MTKB] 检索 ${kind.key} 失败：`, err?.message || err)
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** 启动时预热 SQLite 连接 */
export function warmupMtkbSqlite() {
  const DatabaseSync = getDatabaseSync()
  if (!DatabaseSync) {
    console.warn('[MTKB] node:sqlite 不可用，聊天将仅用 Markdown 索引')
    return
  }
  const paths = resolveDbPaths()
  if (!paths) return
  for (const file of Object.values(paths)) {
    try {
      openDb(DatabaseSync, file)
    } catch (err) {
      console.warn('[MTKB] 预热数据库失败：', err?.message || err)
    }
  }
}

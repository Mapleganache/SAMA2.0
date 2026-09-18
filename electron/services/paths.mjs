import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export function getDataRoot() {
  const root = path.join(app.getPath('userData'), 'sama-data')
  ensureDir(root)
  return root
}

export function getSettingsPath() {
  return path.join(getDataRoot(), 'settings.json')
}

export function getSessionsPath() {
  return path.join(getDataRoot(), 'sessions.json')
}

export function getSessionsDir() {
  const dir = path.join(getDataRoot(), 'sessions')
  ensureDir(dir)
  return dir
}

export function getSessionMessagesPath(sessionId) {
  const safe = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(getSessionsDir(), `${safe || 'unknown'}.json`)
}

export function getLibrariesPath() {
  return path.join(getDataRoot(), 'libraries.json')
}

export function getKbRoot() {
  const root = path.join(getDataRoot(), 'kb')
  ensureDir(root)
  ensureDir(path.join(root, 'docs'))
  return root
}

/** 用户导入的 SQLite 知识库目录 */
export function getUserDbRoot() {
  const root = path.join(getKbRoot(), 'user-db')
  ensureDir(root)
  return root
}

export function getUserDbRegistryPath() {
  return path.join(getKbRoot(), 'user-db-registry.json')
}

/** 分享包默认导出目录（桌面） */
export function getDesktopPath() {
  try {
    return app.getPath('desktop')
  } catch {
    return path.join(process.env.USERPROFILE || '', 'Desktop')
  }
}

export function getKbManifestPath() {
  return path.join(getKbRoot(), 'manifest.json')
}

export function getKbIndexPath() {
  return path.join(getKbRoot(), 'index.json')
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

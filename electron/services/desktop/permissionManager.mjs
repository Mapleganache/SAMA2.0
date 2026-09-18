import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { getDataRoot, ensureDir } from '../paths.mjs'

/** @typedef {'SAFE'|'CONFIRM'|'ADMIN'|'BLOCK'} PermissionLevel */

/** 工具默认权限（可被各 Manager 覆盖） */
export const TOOL_PERMISSION = {
  'file.list': 'SAFE',
  'file.read': 'SAFE',
  'file.readFolder': 'SAFE',
  'file.exists': 'SAFE',
  'file.info': 'SAFE',
  'file.search': 'SAFE',
  'file.mkdir': 'SAFE',
  'file.copy': 'SAFE',
  'file.move': 'SAFE',
  'file.write': 'SAFE', // 覆盖已有文件时提升为 CONFIRM
  'file.delete': 'CONFIRM',

  'application.list': 'SAFE',
  'application.find': 'SAFE',
  'application.isRunning': 'SAFE',
  'application.launch': 'SAFE',
  'application.terminate': 'CONFIRM',

  'window.list': 'SAFE',
  'window.active': 'SAFE',
  'window.focus': 'SAFE',
  'window.minimize': 'SAFE',
  'window.maximize': 'SAFE',
  'window.restore': 'SAFE',
  'window.close': 'CONFIRM',

  'shell.run': 'SAFE', // 非白名单提升 CONFIRM；黑名单 BLOCK

  // Phase 2
  'screenshot.screen': 'SAFE',
  'screenshot.window': 'SAFE',
  'screenshot.region': 'SAFE',
  'screenshot.capture': 'SAFE',

  'ui.tree': 'SAFE',
  'ui.find': 'SAFE',
  'ui.click': 'CONFIRM',
  'ui.findElement': 'SAFE',
  'ui.clickElement': 'CONFIRM',

  'ocr.available': 'SAFE',
  'ocr.image': 'SAFE',

  'mouse.position': 'SAFE',
  'mouse.move': 'CONFIRM',
  'mouse.click': 'CONFIRM',
  'mouse.doubleClick': 'CONFIRM',
  'mouse.rightClick': 'CONFIRM',
  'mouse.drag': 'CONFIRM',
  'mouse.scroll': 'CONFIRM',

  'keyboard.type': 'CONFIRM',
  'keyboard.press': 'CONFIRM',
  'keyboard.hotkey': 'CONFIRM',

  // Phase 3
  'desktop.observe': 'SAFE',
  'desktop.runPlan': 'SAFE', // 含 CONFIRM 子步骤时在 resolvePermission 提升
  'desktop.verify': 'SAFE',

  // Phase 4 Android / ADB
  'adb.available': 'SAFE',
  'adb.devices': 'SAFE',
  'adb.waitForDevice': 'SAFE',
  'adb.shell': 'CONFIRM',
  'adb.install': 'CONFIRM',
  'adb.uninstall': 'CONFIRM',
  'adb.launch': 'CONFIRM',
  'adb.push': 'CONFIRM',
  'adb.pull': 'SAFE',
  'adb.screenshot': 'SAFE',
  'emulator.open': 'SAFE',
  'emulator.windows': 'SAFE',
  'android.installApk': 'CONFIRM',

  // Phase 5 CNC 软件桌面桥接（不含 LAD CLI 改写）
  'cnc.listApps': 'SAFE',
  'cnc.probe': 'SAFE',
  'cnc.openApp': 'SAFE',
  'cnc.observe': 'SAFE',
  'cnc.focus': 'SAFE',
  'cnc.openLad': 'SAFE', // 仅 GUI；深度改梯仍走 sama-allow-ladder
  'cnc.openPicture': 'SAFE',
  'cnc.backupNc': 'SAFE',
}

/** @type {Map<string, { tool: string, args: object, permission: string, createdAt: number, preview: object }>} */
const pendingApprovals = new Map()

const APPROVAL_TTL_MS = 15 * 60 * 1000

export function getToolPermission(tool) {
  return TOOL_PERMISSION[tool] || 'CONFIRM'
}

export function createApprovalId() {
  return `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createPendingApproval({ tool, args, permission, preview }) {
  sweepExpired()
  const approvalId = createApprovalId()
  pendingApprovals.set(approvalId, {
    tool,
    args: structuredCloneSafe(args),
    permission,
    preview: preview || { tool, args },
    createdAt: Date.now(),
  })
  return approvalId
}

export function consumePendingApproval(approvalId, tool, args) {
  sweepExpired()
  const id = String(approvalId || '')
  if (!id || !pendingApprovals.has(id)) {
    return {
      ok: false,
      code: 'INVALID_APPROVAL',
      message: '无效或已过期的批准令牌，请重新发起需要确认的操作',
    }
  }
  const pending = pendingApprovals.get(id)
  if (pending.tool !== tool) {
    return {
      ok: false,
      code: 'APPROVAL_TOOL_MISMATCH',
      message: `批准令牌与工具不匹配（期望 ${pending.tool}，收到 ${tool}）`,
    }
  }
  if (!argsEqual(pending.args, args || {})) {
    return {
      ok: false,
      code: 'APPROVAL_ARGS_MISMATCH',
      message: '批准令牌与参数不匹配，拒绝执行（防伪造批准）',
    }
  }
  pendingApprovals.delete(id)
  return { ok: true, permission: pending.permission, preview: pending.preview }
}

export function peekPendingApproval(approvalId) {
  sweepExpired()
  return pendingApprovals.get(String(approvalId || '')) || null
}

function sweepExpired() {
  const now = Date.now()
  for (const [id, p] of pendingApprovals) {
    if (now - p.createdAt > APPROVAL_TTL_MS) pendingApprovals.delete(id)
  }
}

function structuredCloneSafe(v) {
  try {
    return JSON.parse(JSON.stringify(v ?? {}))
  } catch {
    return {}
  }
}

function argsEqual(a, b) {
  try {
    return JSON.stringify(normalizeArgs(a)) === JSON.stringify(normalizeArgs(b))
  } catch {
    return false
  }
}

function normalizeArgs(obj) {
  if (!obj || typeof obj !== 'object') return {}
  const keys = Object.keys(obj).sort()
  const out = {}
  for (const k of keys) {
    const v = obj[k]
    if (v === undefined) continue
    out[k] = v
  }
  return out
}

export function isAdminProcess() {
  try {
    const out = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
    return /S-1-5-32-544[\s\S]*Enabled/i.test(out)
  } catch {
    return false
  }
}

export function getDesktopLogDir() {
  const dir = path.join(getDataRoot(), 'logs')
  ensureDir(dir)
  return dir
}

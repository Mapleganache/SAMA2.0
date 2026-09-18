/**
 * 权限模块（已取消管理员 PIN / 访客门禁）
 * 保留 API 形状以兼容旧 preload / 脚本；一律视为已授权。
 */
import { loadSettings, saveSettingsRaw } from './store.mjs'

/** 清除历史遗留的 PIN 字段（若有） */
function clearLegacyPinIfAny() {
  try {
    const s = loadSettings()
    if (s.pinHash || s.pinSalt || s.authEnabled) {
      saveSettingsRaw({ pinHash: '', pinSalt: '', authEnabled: false })
    }
  } catch {
    /* ignore */
  }
}

export function getAuthRole() {
  return 'admin'
}

export function isAdmin() {
  return true
}

export function getAuthPublic() {
  clearLegacyPinIfAny()
  return {
    hasPin: false,
    authEnabled: false,
    role: 'admin',
    needsSetup: false,
  }
}

/** @deprecated 已取消 PIN */
export function setupAdminPin(_pin, _opts = {}) {
  return getAuthPublic()
}

/** @deprecated 已取消 PIN */
export function unlockAdmin(_pin) {
  return getAuthPublic()
}

/** @deprecated 锁定无效，始终管理员 */
export function lockAdmin() {
  return getAuthPublic()
}

/** @deprecated */
export function clearAdminPin() {
  clearLegacyPinIfAny()
  return getAuthPublic()
}

/** 写路径一律允许（访客限制已取消） */
export function guestMayWritePath(_absPath) {
  return true
}

/** 不再要求 PIN */
export function requireAdmin() {
  /* no-op */
}

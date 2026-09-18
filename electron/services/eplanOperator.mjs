/**
 * SAMA ↔ EPLAN 统一操作层（本机 2.7.3 配置）。
 *
 * 能力边界（诚实）：
 * - 可：探测/绑定 W3u、启动 GUI、打开 .elk、导出 EPLAN 导入任务包、打开导出目录
 * - 许可有效时：可走官方 API 桥接（需 Sama.EplanBridge.exe）
 * - 不可：修改 .edb、绕过许可、破解 lservrc
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSettings } from './store.mjs'
import {
  probeEplan,
  launchEplan,
  openElkInEplan,
  resolveUsableElkPath,
  getEplanSessionAllow,
  setEplanSessionAllow,
  inspectEplanLicenseFiles,
  resolveElkFromContext,
  EPLAN_DEFAULT_W3U,
  EPLAN_PREFERRED_VERSION,
} from './eplanP8.mjs'
import {
  probeEplanAutomation,
  eplanExportPreview,
  exportElectricalToEplan,
} from './eplanBridge.mjs'
import { isGuiProcessAlive } from './guiLaunch.mjs'
import { patchEplanProject, repairElkLink, resolveEplanProject } from './eplanProjectPatch.mjs'

/** 注册的操作清单（供前端 / Agent 发现） */
export const EPLAN_OPERATIONS = [
  { id: 'status', label: '运行状态与能力', needsAllow: false, description: '探测路径、许可文件、自动化模式、进程是否在跑' },
  { id: 'bind', label: '探测并绑定 W3u', needsAllow: false, description: '写入 settings.eplanPath 与 electrical.null' },
  { id: 'launch', label: '启动 EPLAN', needsAllow: true, description: '后台启动 W3u.exe，不等待许可弹窗' },
  { id: 'openElk', label: '打开 .elk 工程', needsAllow: true, description: '用已绑定的 W3u 打开指定 .elk' },
  { id: 'openReference', label: '对照原图（打开 .elk）', needsAllow: true, description: '按机床型号/附件自动找 .elk 并在 EPLAN 打开原厂图' },
  { id: 'openFolder', label: '打开文件夹', needsAllow: false, description: '在资源管理器中打开目录（任务包等）' },
  { id: 'exportPreview', label: 'EPLAN 导出预览', needsAllow: false, description: '预览 DRC / 变更量 / task-pack 或 API 模式' },
  { id: 'exportProject', label: '导出工程与任务包', needsAllow: false, description: '导出 SVG/PDF/表 + EPLAN 任务包；可选 outDir 免弹窗' },
  { id: 'workflowExportAndOpen', label: '导出任务包并协助打开', needsAllow: true, description: '静默导出 → 打开文件夹 → 尝试启动 EPLAN 供人工导入' },
  { id: 'repairElk', label: '修复 .elk 链接', needsAllow: false, description: '当 .elk 指向错误 .edb 名时自动纠正' },
  { id: 'patchProject', label: '改图（元数据+任务包）', needsAllow: false, description: '修链、备份并更新 ProjectInfo 描述、生成 SAMA_patches 任务包' },
  { id: 'openPatchedProject', label: '改图并打开 EPLAN', needsAllow: true, description: 'patchProject 后用 W3u 打开工程' },
]

function operationalNote(probe, automation, license) {
  const parts = []
  if (!probe.found) {
    parts.push(`未找到 W3u.exe。建议填写 ${EPLAN_DEFAULT_W3U}`)
    return parts.join(' ')
  }
  parts.push(`已绑定 EPLAN ${probe.eplanVersion || '未知'} · ${probe.eplanPath}`)
  if (license.lservrc) {
    parts.push('检测到 lservrc：若弹「对本机无效」需合法重签发许可；SAMA 仍可导出任务包并在 EPLAN 许可通过后打开工程。')
  }
  if (automation.mode === 'official-api') {
    parts.push('官方 API 桥接可用。')
  } else {
    parts.push('当前为 task-pack 模式：生成导入任务包，不生成原生 .edb。')
  }
  return parts.join(' ')
}

export function listEplanOperations() {
  return {
    ok: true,
    operations: EPLAN_OPERATIONS,
    preferredVersion: EPLAN_PREFERRED_VERSION,
    defaultW3u: EPLAN_DEFAULT_W3U,
  }
}

export function getEplanStatus({ eplanPath = '' } = {}) {
  const settings = loadSettings()
  const explicit = String(eplanPath || settings.eplanPath || '').trim()
  const probe = probeEplan(explicit)
  const automation = probeEplanAutomation(explicit)
  const license = inspectEplanLicenseFiles()
  const running = isGuiProcessAlive('W3u') || isGuiProcessAlive('EPLAN')

  const capabilities = {
    bindPath: probe.found,
    launchGui: probe.found,
    openElk: probe.found,
    exportTaskPack: true,
    apiExport: automation.mode === 'official-api',
    modifyEdb: false,
  }

  return {
    ok: true,
    action: 'status',
    settingsEplanPath: settings.eplanPath || '',
    probe,
    automation,
    license,
    running,
    sessionAllowed: getEplanSessionAllow(),
    mode: automation.mode,
    capabilities,
    note: operationalNote(probe, automation, license),
  }
}

function gateAllow(action, approved, rememberSession) {
  const op = EPLAN_OPERATIONS.find((o) => o.id === action)
  if (op?.needsAllow && !approved && !getEplanSessionAllow()) {
    return {
      ok: false,
      code: 'NEED_ALLOW',
      error: '需要先在界面点击「允许」再操作 EPLAN',
      action,
    }
  }
  if (approved && rememberSession !== false) setEplanSessionAllow(true)
  return null
}

async function openPathInShell(target) {
  const abs = path.resolve(String(target || '').trim())
  if (!abs || !fs.existsSync(abs)) {
    return { ok: false, error: `路径不存在：${abs || '(空)'}` }
  }
  try {
    const { shell } = await import('electron')
    const err = await shell.openPath(abs)
    if (err) return { ok: false, error: err }
    return { ok: true, path: abs }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

function defaultExportRoot(projectName = 'project') {
  const base = path.join(os.homedir(), 'AppData', 'Roaming', 'sama', 'sama-data', 'workspace', 'electrical', 'eplan-exports')
  const slug = String(projectName || 'project').replace(/[\\/:*?"<>|]/g, '_').slice(0, 48)
  return path.join(base, `${slug}_${new Date().toISOString().slice(0, 10)}_${Date.now()}`)
}

/**
 * @param {string} action
 * @param {Record<string, unknown>} payload
 * @param {{ parentWindow?: unknown; approved?: boolean; rememberSession?: boolean }} context
 */
export async function operateEplan(action, payload = {}, context = {}) {
  const act = String(action || '').trim()
  const denied = gateAllow(act, context.approved, context.rememberSession)
  if (denied) return denied

  const settings = loadSettings()
  const eplanPath = String(payload.eplanPath || settings.eplanPath || '').trim()

  switch (act) {
    case 'status':
      return getEplanStatus({ eplanPath })

    case 'bind':
      const probe = probeEplan(eplanPath)
      return {
        ok: probe.found,
        action: act,
        ...probe,
      }

    case 'launch':
      return { ...launchEplan({ eplanPath }), action: act }

    case 'openElk': {
      const elkPath = String(payload.elkPath || '').trim()
      if (!elkPath) {
        return { ok: false, action: act, error: '缺少 elkPath' }
      }
      return { ...openElkInEplan(elkPath, { eplanPath }), action: act }
    }

    case 'openReference': {
      const resolved = resolveElkFromContext({
        elkPath: String(payload.elkPath || '').trim(),
        machineModel: String(payload.machineModel || payload.machine || '').trim(),
        pdfPath: String(payload.pdfPath || '').trim(),
      })
      if (!resolved.ok) {
        return { ok: false, action: act, error: resolved.error, hint: '可拖入 .elk 或填写机床型号后重试' }
      }
      const opened = openElkInEplan(resolved.path, { eplanPath })
      return {
        ...opened,
        action: act,
        elkResolved: resolved,
        note: opened.ok
          ? `已在 EPLAN 打开原厂工程：${resolved.path}（SAMA 示意 SVG 仅供逻辑对照，精准原图请看 EPLAN）`
          : opened.error,
      }
    }

    case 'openFolder': {
      const folder = String(payload.path || payload.folder || '').trim()
      const opened = await openPathInShell(folder)
      return { ...opened, action: act }
    }

    case 'exportPreview':
      return { ...eplanExportPreview(payload.project, eplanPath), action: act }

    case 'exportProject': {
      const outDir = String(payload.outDir || '').trim()
      const exportOpts = {
        eplanPath,
        confirmed: Boolean(payload.confirmed),
        outDir: outDir || undefined,
        silent: Boolean(payload.silent || outDir),
      }
      return {
        ...(await exportElectricalToEplan(context.parentWindow, payload.project, exportOpts)),
        action: act,
      }
    }

    case 'workflowExportAndOpen': {
      const project = payload.project
      if (!project) {
        return { ok: false, action: act, error: '缺少 project（ElectricalProject v2）' }
      }
      const outDir = String(payload.outDir || '').trim() || defaultExportRoot(project?.name)
      const exported = await exportElectricalToEplan(context.parentWindow, project, {
        eplanPath,
        confirmed: true,
        outDir,
        silent: true,
      })
      if (!exported.ok) {
        return { ...exported, action: act }
      }
      const folderOpen = await openPathInShell(exported.root)
      const launch = launchEplan({ eplanPath })
      return {
        ...exported,
        action: act,
        folderOpen,
        launch,
        note: [
          exported.note || '已导出 EPLAN 任务包',
          folderOpen.ok ? `已打开文件夹：${exported.root}` : folderOpen.error,
          launch.ok ? '已尝试启动 EPLAN（许可未通过时仍会弹窗）' : launch.error,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    }

    case 'repairElk': {
      const elkPath = String(payload.elkPath || '').trim()
      if (!elkPath) return { ok: false, action: act, error: '缺少 elkPath' }
      return { ...repairElkLink(elkPath), action: act }
    }

    case 'patchProject': {
      const elkPath = String(payload.elkPath || '').trim()
      if (!elkPath) return { ok: false, action: act, error: '缺少 elkPath' }
      const patch = payload.patch || {
        descriptionSuffix: payload.descriptionSuffix || payload.note || '改图测试',
      }
      return { ...patchEplanProject(elkPath, patch), action: act }
    }

    case 'openPatchedProject': {
      const elkPath = String(payload.elkPath || '').trim()
      if (!elkPath) return { ok: false, action: act, error: '缺少 elkPath' }
      const patched = patchEplanProject(elkPath, payload.patch || {
        descriptionSuffix: payload.descriptionSuffix || '改图并打开',
      })
      if (!patched.ok) return { ...patched, action: act }
      const opened = openElkInEplan(patched.elkPath, { eplanPath })
      return { ...patched, open: opened, action: act, ok: patched.ok && opened.ok, error: opened.ok ? undefined : opened.error }
    }

    default:
      return {
        ok: false,
        action: act,
        code: 'UNKNOWN_ACTION',
        error: `未知 EPLAN 操作：${act}`,
        knownActions: EPLAN_OPERATIONS.map((o) => o.id),
      }
  }
}

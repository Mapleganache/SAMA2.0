import {
  getToolPermission,
  createPendingApproval,
  consumePendingApproval,
} from './permissionManager.mjs'
import { logDesktopOperation } from './operationLogger.mjs'
import * as file from './fileManager.mjs'
import * as application from './applicationManager.mjs'
import * as window from './windowManager.mjs'
import * as shell from './shellManager.mjs'
import * as shot from './screenshotManager.mjs'
import * as input from './inputManager.mjs'
import * as uia from './uiAutomationManager.mjs'
import * as ocr from './ocrManager.mjs'
import * as vision from './visionManager.mjs'
import { observeDesktop } from './observer.mjs'
import { verifyCondition } from './verifier.mjs'
import * as android from './androidManager.mjs'
import * as cnc from './cncSoftwareManager.mjs'

function stepsNeedConfirm(steps = []) {
  return steps.some((s) => {
    const level = getToolPermission(s.tool || s.action)
    return level === 'CONFIRM' || level === 'ADMIN' || level === 'BLOCK'
  })
}

function okResult(tool, action, data, permission, started, extra = {}) {
  return {
    success: true,
    tool,
    action,
    data,
    error: null,
    permission,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    ...extra,
  }
}

function failResult(tool, action, code, message, permission, started, extra = {}) {
  return {
    success: false,
    tool,
    action,
    data: extra.data ?? null,
    error: { code, message },
    permission,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    ...extra,
  }
}

function resolvePermission(tool, args) {
  let level = getToolPermission(tool)
  if (tool === 'file.write') {
    const p = file.fileWritePermission(args)
    if (p.level === 'CONFIRM') level = 'CONFIRM'
  }
  if (tool === 'file.copy') {
    const p = file.fileCopyPermission(args)
    if (p.level === 'CONFIRM') level = 'CONFIRM'
  }
  if (tool === 'shell.run') {
    const p = shell.shellPermission(args)
    if (p.level === 'BLOCK') level = 'BLOCK'
    else if (p.level === 'CONFIRM') level = 'CONFIRM'
    else level = 'SAFE'
  }
  if (tool === 'desktop.runPlan') {
    if (args.dryRun === true) level = 'SAFE'
    else if (stepsNeedConfirm(args.steps || [])) level = 'CONFIRM'
    else level = 'SAFE'
  }
  return level
}

async function executeTool(tool, args, ctx = {}) {
  switch (tool) {
    case 'file.list':
      return file.fileList(args)
    case 'file.read':
      return file.fileRead(args)
    case 'file.readFolder':
      return file.fileReadFolder(args)
    case 'file.write':
      return file.fileWrite({ ...args, overwrite: true })
    case 'file.copy':
      return file.fileCopy({ ...args, overwrite: true })
    case 'file.move':
      return file.fileMove(args)
    case 'file.mkdir':
      return file.fileMkdir(args)
    case 'file.delete':
      return file.fileDelete(args)
    case 'file.exists':
      return file.fileExists(args)
    case 'file.info':
      return file.fileInfo(args)
    case 'file.search':
      return file.fileSearch(args)

    case 'application.list':
      return application.applicationList()
    case 'application.find': {
      const r = application.applicationFind(args)
      if (!r.ok) {
        const err = new Error(r.message)
        err.code = r.code
        err.matches = r.matches
        throw err
      }
      return r
    }
    case 'application.launch':
      return application.applicationLaunch(args)
    case 'application.isRunning':
      return application.applicationIsRunning(args)
    case 'application.terminate':
      return application.applicationTerminate(args)

    case 'window.list':
      return window.windowList(args)
    case 'window.active':
      return window.windowActive()
    case 'window.focus':
      return window.windowFocus(args)
    case 'window.minimize':
      return window.windowMinimize(args)
    case 'window.maximize':
      return window.windowMaximize(args)
    case 'window.restore':
      return window.windowRestore(args)
    case 'window.close':
      return window.windowClose(args)

    case 'shell.run':
      return shell.shellRun(args)

    case 'screenshot.screen':
      return shot.screenshotScreen(args)
    case 'screenshot.window':
      return shot.screenshotWindow(args)
    case 'screenshot.region':
      return shot.screenshotRegion(args)
    case 'screenshot.capture':
      return shot.screenshotCapture(args)

    case 'ui.tree':
      return uia.uiTree(args)
    case 'ui.find':
      return uia.uiFind(args)
    case 'ui.click':
      return uia.uiClick(args)
    case 'ui.findElement':
      return vision.findUiElement(args)
    case 'ui.clickElement':
      return vision.clickElement(args)

    case 'ocr.available':
      return ocr.ocrAvailable()
    case 'ocr.image':
      return ocr.ocrImage(args)

    case 'mouse.position':
      return input.mousePosition()
    case 'mouse.move':
      return input.mouseMove(args)
    case 'mouse.click':
      return input.mouseClick(args)
    case 'mouse.doubleClick':
      return input.mouseDoubleClick(args)
    case 'mouse.rightClick':
      return input.mouseRightClick(args)
    case 'mouse.drag':
      return input.mouseDrag(args)
    case 'mouse.scroll':
      return input.mouseScroll(args)

    case 'keyboard.type':
      return input.keyboardType(args)
    case 'keyboard.press':
      return input.keyboardPress(args)
    case 'keyboard.hotkey':
      return input.keyboardHotkey(args)

    case 'desktop.observe':
      return observeDesktop(args)
    case 'desktop.verify':
      return verifyCondition(args.condition || args, { lastResult: args.lastResult })
    case 'desktop.runPlan': {
      const { runDesktopPlan } = await import('./taskRunner.mjs')
      const r = await runDesktopPlan({
        ...args,
        approved: ctx.approved === true || args.approved === true,
        approvalId: ctx.approvalId || args.approvalId,
      })
      if (r.requiresApproval) {
        const err = new Error(r.error?.message || '计划需要确认')
        err.code = 'NEED_ALLOW'
        err.requiresApproval = true
        err.approvalId = r.approvalId
        err.preview = r.preview || { tool: 'desktop.runPlan', args }
        err.data = r.data
        throw err
      }
      if (!r.success) {
        const err = new Error(r.error?.message || '计划执行失败')
        err.code = r.error?.code || 'PLAN_FAILED'
        err.data = r.data
        throw err
      }
      return r.data
    }

    case 'adb.available':
      return android.adbAvailable(args)
    case 'adb.devices':
      return android.adbDevices(args)
    case 'adb.waitForDevice':
      return android.adbWaitForDevice(args)
    case 'adb.shell':
      return android.adbShell(args)
    case 'adb.install':
      return android.adbInstall(args)
    case 'adb.uninstall':
      return android.adbUninstall(args)
    case 'adb.launch':
      return android.adbLaunch(args)
    case 'adb.push':
      return android.adbPush(args)
    case 'adb.pull':
      return android.adbPull(args)
    case 'adb.screenshot':
      return android.adbScreenshot(args)
    case 'emulator.open':
      return android.emulatorOpen(args)
    case 'emulator.windows':
      return android.emulatorWindowHint(args)
    case 'android.installApk':
      return android.androidInstallApkFlow(args)

    case 'cnc.listApps':
      return cnc.cncListApps(args)
    case 'cnc.probe':
      return cnc.cncProbe(args)
    case 'cnc.openApp':
      return cnc.cncOpenApp(args)
    case 'cnc.observe':
      return cnc.cncObserve(args)
    case 'cnc.focus':
      return cnc.cncFocus(args)
    case 'cnc.openLad':
      return cnc.cncOpenLad(args)
    case 'cnc.openPicture':
      return cnc.cncOpenPicture(args)
    case 'cnc.backupNc':
      return cnc.cncBackupNc(args)

    default: {
      const err = new Error(`未知工具: ${tool}`)
      err.code = 'UNKNOWN_TOOL'
      throw err
    }
  }
}

/**
 * 统一入口（async：截图/视觉为异步）
 */
export async function runDesktopTool(payload = {}) {
  const started = Date.now()
  const tool = String(payload.tool || '').trim()
  const args = payload.args && typeof payload.args === 'object' ? payload.args : {}
  const action = tool.split('.').pop() || tool

  if (!tool) {
    return failResult('', '', 'TOOL_REQUIRED', '缺少 tool', 'BLOCK', started)
  }

  let permission
  try {
    permission = resolvePermission(tool, args)
  } catch (e) {
    return failResult(
      tool,
      action,
      e.code || 'PERMISSION_RESOLVE_FAILED',
      e.message || String(e),
      'CONFIRM',
      started,
    )
  }

  if (permission === 'BLOCK') {
    const res = failResult(tool, action, 'COMMAND_BLOCKED', '该操作被策略禁止', 'BLOCK', started)
    logDesktopOperation({
      tool,
      args,
      permission,
      success: false,
      error: res.error,
      durationMs: res.durationMs,
    })
    return res
  }

  // 计划内部子步骤：父计划已批准时可跳过二次确认（IPC 会剥离此标志）
  const skipGate = payload.skipPermissionGate === true && payload.approved === true

  if (!skipGate && (permission === 'CONFIRM' || permission === 'ADMIN')) {
    if (!payload.approved || !payload.approvalId) {
      const approvalId = createPendingApproval({
        tool,
        args,
        permission,
        preview: { tool, args },
      })
      const res = {
        success: false,
        tool,
        action,
        data: null,
        error: {
          code: 'NEED_ALLOW',
          message: '该操作需要用户确认',
        },
        permission,
        requiresApproval: true,
        approvalId,
        preview: { tool, args },
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
      }
      logDesktopOperation({
        tool,
        args,
        permission,
        approvalId,
        success: false,
        requiresApproval: true,
        error: res.error,
        durationMs: res.durationMs,
      })
      return res
    }

    const consumed = consumePendingApproval(payload.approvalId, tool, args)
    if (!consumed.ok) {
      const res = failResult(tool, action, consumed.code, consumed.message, permission, started)
      logDesktopOperation({
        tool,
        args,
        permission,
        approvalId: payload.approvalId,
        success: false,
        error: res.error,
        durationMs: res.durationMs,
      })
      return res
    }
  }

  try {
    const data = await executeTool(tool, args, {
      approved: !!payload.approved || !!payload.skipPermissionGate,
      approvalId: payload.approvalId,
    })
    const res = okResult(tool, action, data, permission, started, {
      approvalId: payload.approvalId || null,
    })
    logDesktopOperation({
      tool,
      args,
      permission,
      approvalId: payload.approvalId,
      success: true,
      durationMs: res.durationMs,
    })
    return res
  } catch (e) {
    // 计划/工具返回 NEED_ALLOW（极少：直接调用路径）
    if (e.requiresApproval || e.code === 'NEED_ALLOW') {
      let approvalId = e.approvalId
      if (!approvalId) {
        approvalId = createPendingApproval({
          tool,
          args,
          permission: permission || 'CONFIRM',
          preview: e.preview || { tool, args },
        })
      }
      const res = {
        success: false,
        tool,
        action,
        data: e.data ?? null,
        error: { code: 'NEED_ALLOW', message: e.message || '需要用户确认' },
        permission: permission || 'CONFIRM',
        requiresApproval: true,
        approvalId,
        preview: e.preview || { tool, args },
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
      }
      logDesktopOperation({
        tool,
        args,
        permission: res.permission,
        approvalId,
        success: false,
        requiresApproval: true,
        error: res.error,
        durationMs: res.durationMs,
      })
      return res
    }
    const res = failResult(
      tool,
      action,
      e.code || 'TOOL_FAILED',
      e.message || String(e),
      permission,
      started,
      { data: e.matches ? { matches: e.matches } : e.data || null },
    )
    logDesktopOperation({
      tool,
      args,
      permission,
      approvalId: payload.approvalId,
      success: false,
      error: res.error,
      durationMs: res.durationMs,
    })
    return res
  }
}

export function listDesktopTools() {
  const tools = [
    'file.list',
    'file.read',
    'file.readFolder',
    'file.write',
    'file.copy',
    'file.move',
    'file.mkdir',
    'file.delete',
    'file.exists',
    'file.info',
    'file.search',
    'application.list',
    'application.find',
    'application.launch',
    'application.isRunning',
    'application.terminate',
    'window.list',
    'window.active',
    'window.focus',
    'window.minimize',
    'window.maximize',
    'window.restore',
    'window.close',
    'shell.run',
    'screenshot.screen',
    'screenshot.window',
    'screenshot.region',
    'screenshot.capture',
    'ui.tree',
    'ui.find',
    'ui.click',
    'ui.findElement',
    'ui.clickElement',
    'ocr.available',
    'ocr.image',
    'mouse.position',
    'mouse.move',
    'mouse.click',
    'mouse.doubleClick',
    'mouse.rightClick',
    'mouse.drag',
    'mouse.scroll',
    'keyboard.type',
    'keyboard.press',
    'keyboard.hotkey',
    'desktop.observe',
    'desktop.verify',
    'desktop.runPlan',
    'adb.available',
    'adb.devices',
    'adb.waitForDevice',
    'adb.shell',
    'adb.install',
    'adb.uninstall',
    'adb.launch',
    'adb.push',
    'adb.pull',
    'adb.screenshot',
    'emulator.open',
    'emulator.windows',
    'android.installApk',
    'cnc.listApps',
    'cnc.probe',
    'cnc.openApp',
    'cnc.observe',
    'cnc.focus',
    'cnc.openLad',
    'cnc.openPicture',
    'cnc.backupNc',
  ]
  return tools.map((tool) => ({ tool, permission: getToolPermission(tool) }))
}

export { resolveUserPath } from './fileManager.mjs'

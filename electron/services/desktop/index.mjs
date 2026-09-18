export { runDesktopTool, listDesktopTools, resolveUserPath } from './desktopToolManager.mjs'
export { getToolPermission, createPendingApproval, peekPendingApproval } from './permissionManager.mjs'
export { logDesktopOperation } from './operationLogger.mjs'
export { observeDesktop, summarizeObservation } from './observer.mjs'
export { verifyCondition } from './verifier.mjs'
export { runDesktopPlan, inferPlanFromUser, planNeedsConfirm } from './taskRunner.mjs'
export {
  adbAvailable,
  adbDevices,
  resolveAdbPath,
  androidInstallApkFlow,
  emulatorOpen,
} from './androidManager.mjs'
export {
  cncListApps,
  cncProbe,
  cncOpenApp,
  cncBackupNc,
} from './cncSoftwareManager.mjs'

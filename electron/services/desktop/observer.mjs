/**
 * Observe：采集桌面当前状态（窗口 / 前台 / 可选截图）
 */
import { windowList, windowActive } from './windowManager.mjs'
import { applicationIsRunning } from './applicationManager.mjs'
import { screenshotScreen, screenshotWindow } from './screenshotManager.mjs'

/**
 * @param {{ screenshot?: boolean, window?: string, includeRunning?: string[] }} args
 */
export async function observeDesktop(args = {}) {
  const started = Date.now()
  const windows = windowList().windows || []
  const active = windowActive()
  const top = windows.slice(0, 30).map((w) => ({
    handle: w.handle,
    title: w.title,
    pid: w.pid,
  }))

  let shot = null
  if (args.screenshot) {
    try {
      shot = args.window
        ? await screenshotWindow({ title: args.window })
        : await screenshotScreen({})
    } catch (e) {
      shot = { error: e.message || String(e), code: e.code }
    }
  }

  const running = []
  for (const name of args.includeRunning || []) {
    try {
      running.push({ name, ...(applicationIsRunning({ name }) || {}) })
    } catch (e) {
      running.push({ name, running: false, error: e.message })
    }
  }

  return {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    activeWindow: active,
    windowCount: windows.length,
    windows: top,
    screenshot: shot,
    running,
  }
}

/** 生成给模型看的短摘要 */
export function summarizeObservation(obs) {
  if (!obs) return '（无观察）'
  const titles = (obs.windows || [])
    .slice(0, 12)
    .map((w) => `- ${w.title}`)
    .join('\n')
  return [
    `前台: ${obs.activeWindow?.title || '（无）'}`,
    `窗口数: ${obs.windowCount}`,
    titles ? `窗口:\n${titles}` : '',
    obs.screenshot?.path ? `截图: ${obs.screenshot.path}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

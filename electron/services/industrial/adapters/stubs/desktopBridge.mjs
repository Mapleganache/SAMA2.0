/**
 * Desktop 薄桥：仅 detect / launch / screenshot，禁止鼠标画 CAD
 */
import { createStubAdapter, notImplemented } from '../base.mjs'

export function createDesktopBridgeAdapter() {
  return createStubAdapter({
    id: 'desktop.bridge',
    domain: 'desktop',
    vendor: 'sama',
    levels: ['uia', 'ocr', 'mouse'],
    label: 'SAMA Desktop Bridge',
    notes: '复用 Desktop Agent；不可用于几何建模。',
    async detect() {
      try {
        const { listDesktopTools } = await import('../../desktop/index.mjs')
        const tools = listDesktopTools()
        return {
          available: true,
          partial: true,
          adapterId: 'desktop.bridge',
          domain: 'desktop',
          toolCount: Array.isArray(tools) ? tools.length : 0,
          message: 'Desktop 工具可用（观察/窗口/截图）；非 CAD/电气内核',
        }
      } catch (e) {
        return {
          available: false,
          partial: false,
          adapterId: 'desktop.bridge',
          domain: 'desktop',
          message: e.message || String(e),
        }
      }
    },
    async launch(args = {}) {
      const { runDesktopTool } = await import('../../desktop/index.mjs')
      const name = args.name || args.app
      if (!name && !args.path) {
        throw notImplemented('launch(need name|path)', 'desktop.bridge')
      }
      return runDesktopTool({
        tool: 'application.launch',
        args: { name, path: args.path },
        approved: false,
      })
    },
    async screenshot(args = {}) {
      const { runDesktopTool } = await import('../../desktop/index.mjs')
      return runDesktopTool({
        tool: args.window ? 'screenshot.window' : 'screenshot.screen',
        args: args.window ? { title: args.window } : {},
        approved: false,
      })
    },
    async createFromIr() {
      throw notImplemented('createFromIr', 'desktop.bridge')
    },
  })
}

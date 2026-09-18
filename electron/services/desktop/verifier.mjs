/**
 * Verify：检查某步是否达成预期
 */
import fs from 'node:fs'
import { windowList, windowActive } from './windowManager.mjs'
import { applicationIsRunning } from './applicationManager.mjs'
import { resolveUserPath, fileExists } from './fileManager.mjs'
import { uiFind } from './uiAutomationManager.mjs'

/**
 * @param {{ type: string, value?: any, path?: string, name?: string, window?: string, title?: string }} cond
 * @param {{ lastResult?: object }} ctx
 */
export async function verifyCondition(cond = {}, ctx = {}) {
  const type = String(cond.type || cond.kind || '').toLowerCase()
  if (!type || type === 'none' || type === 'always') {
    return { ok: true, type: type || 'none', detail: '无校验条件' }
  }

  try {
    if (type === 'tool.success' || type === 'last.success') {
      const ok = !!ctx.lastResult?.success
      return { ok, type, detail: ok ? '上一步工具成功' : ctx.lastResult?.error?.message || '上一步失败' }
    }

    if (type === 'window.titlecontains' || type === 'window.title') {
      const needle = String(cond.value || cond.title || cond.name || '').toLowerCase()
      const list = windowList().windows || []
      const hit = list.find((w) => String(w.title || '').toLowerCase().includes(needle))
      return {
        ok: !!hit,
        type,
        detail: hit ? `找到窗口: ${hit.title}` : `未找到标题含「${needle}」的窗口`,
        window: hit || null,
      }
    }

    if (type === 'window.activecontains' || type === 'window.active') {
      const needle = String(cond.value || cond.title || '').toLowerCase()
      const active = windowActive()
      const ok = String(active.title || '').toLowerCase().includes(needle)
      return {
        ok,
        type,
        detail: ok ? `前台匹配: ${active.title}` : `前台为「${active.title}」，不含「${needle}」`,
        window: active,
      }
    }

    if (type === 'process.running' || type === 'app.running') {
      const name = cond.value || cond.name
      const r = applicationIsRunning({ name, path: cond.path })
      return {
        ok: !!r.running,
        type,
        detail: r.running ? `进程在运行: ${name}` : `进程未运行: ${name}`,
        data: r,
      }
    }

    if (type === 'file.exists') {
      const p = cond.path || cond.value
      const info = fileExists({ path: p })
      return {
        ok: !!info.exists,
        type,
        detail: info.exists ? `文件存在: ${info.path}` : `文件不存在: ${info.path}`,
        path: info.path,
      }
    }

    if (type === 'file.notexists' || type === 'file.absent') {
      const p = cond.path || cond.value
      let abs
      try {
        abs = resolveUserPath(p)
      } catch (e) {
        return { ok: false, type, detail: e.message }
      }
      const exists = fs.existsSync(abs)
      return {
        ok: !exists,
        type,
        detail: exists ? `文件仍存在: ${abs}` : `已不存在: ${abs}`,
        path: abs,
      }
    }

    if (type === 'ui.element' || type === 'ui.found') {
      const found = uiFind({
        name: cond.name || cond.value || cond.description,
        window: cond.window || cond.title,
        automationId: cond.automationId,
      })
      return {
        ok: !!found.found,
        type,
        detail: found.found ? `找到控件: ${found.element?.name}` : `未找到控件`,
        data: found,
      }
    }

    if (type === 'sleep' || type === 'wait') {
      const ms = Math.min(Math.max(Number(cond.value || cond.ms) || 300, 0), 10000)
      await new Promise((r) => setTimeout(r, ms))
      return { ok: true, type, detail: `已等待 ${ms}ms` }
    }

    return {
      ok: false,
      type,
      detail: `未知校验类型: ${type}`,
      error: { code: 'UNKNOWN_VERIFY' },
    }
  } catch (e) {
    return {
      ok: false,
      type,
      detail: e.message || String(e),
      error: { code: e.code || 'VERIFY_FAILED', message: e.message },
    }
  }
}

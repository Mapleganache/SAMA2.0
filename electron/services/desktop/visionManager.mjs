/**
 * find_ui_element：UIA → OCR → 明确失败（不伪造坐标）
 */
import { uiFind } from './uiAutomationManager.mjs'
import { ocrFindText, ocrImage } from './ocrManager.mjs'
import { screenshotWindow, screenshotScreen } from './screenshotManager.mjs'

/**
 * @param {{ description?: string, name?: string, window?: string, automationId?: string, useOcr?: boolean }} args
 */
export async function findUiElement(args = {}) {
  const description = String(args.description || args.name || args.query || '').trim()
  const steps = []

  // 1) UI Automation
  try {
    const uia = uiFind({
      name: description,
      automationId: args.automationId,
      window: args.window || args.title,
      handle: args.handle,
      limit: args.limit || 120,
    })
    steps.push({ step: 'uia', found: !!uia.found })
    if (uia.found) {
      return {
        found: true,
        x: uia.x,
        y: uia.y,
        confidence: uia.confidence,
        source: 'uia',
        element: uia.element,
        steps,
      }
    }
  } catch (e) {
    steps.push({ step: 'uia', found: false, error: e.message || String(e), code: e.code })
  }

  if (args.useOcr === false) {
    return {
      found: false,
      x: null,
      y: null,
      confidence: 0,
      source: null,
      steps,
      error: { code: 'UI_ELEMENT_NOT_FOUND', message: `未找到「${description}」` },
    }
  }

  // 2) 截图 + OCR
  try {
    const shot = args.window || args.title
      ? await screenshotWindow({ title: args.window || args.title })
      : await screenshotScreen({})
    steps.push({ step: 'screenshot', path: shot.path })
    const ocrHit = ocrFindText({ path: shot.path, description })
    steps.push({
      step: 'ocr',
      found: !!ocrHit.found,
      available: ocrHit.ocr ? ocrHit.ocr.available !== false : ocrHit.found || ocrHit.source === 'ocr',
    })
    if (ocrHit.found) {
      return {
        found: true,
        x: ocrHit.x,
        y: ocrHit.y,
        confidence: ocrHit.confidence || 0.55,
        source: 'ocr',
        text: ocrHit.text,
        screenshot: shot.path,
        steps,
      }
    }
    if (ocrHit.ocr && ocrHit.ocr.available === false) {
      steps.push({ step: 'ocr', unavailable: true, detail: ocrHit.ocr.error })
    }
  } catch (e) {
    steps.push({ step: 'ocr', found: false, error: e.message || String(e), code: e.code })
  }

  return {
    found: false,
    x: null,
    y: null,
    confidence: 0,
    source: null,
    steps,
    error: {
      code: 'UI_ELEMENT_NOT_FOUND',
      message: `未找到「${description}」。已尝试 UI Automation 与 OCR，不会伪造坐标。`,
    },
  }
}

export async function clickElement(args = {}) {
  const { mouseClick } = await import('./inputManager.mjs')
  const { uiClick } = await import('./uiAutomationManager.mjs')

  // 优先直接 UIA click
  try {
    return {
      ...(uiClick(args)),
      via: 'ui.click',
    }
  } catch (e) {
    if (e.code !== 'UI_ELEMENT_NOT_FOUND') throw e
  }

  const found = await findUiElement(args)
  if (!found.found) {
    const err = new Error(found.error?.message || '未找到可点击元素')
    err.code = 'UI_ELEMENT_NOT_FOUND'
    err.data = found
    throw err
  }
  mouseClick({ x: found.x, y: found.y, button: 'left', clicks: 1 })
  return { clicked: true, method: `fallback-${found.source}`, x: found.x, y: found.y, via: 'find+click', find: found }
}

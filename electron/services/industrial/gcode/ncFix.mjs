/**
 * NC 自动修复建议（需用户确认后应用）
 */
import { parseGcodeText } from './gcodeParser.mjs'

/**
 * @returns {{ fixes: Array<{line, code, message, original, suggested, apply}> }}
 */
export function suggestNcFixes(ncText, opts = {}) {
  const parsed = parseGcodeText(ncText)
  const fixes = []
  let lastFeed = null
  const defaultFeed = Number(opts.defaultFeed) || 300
  const rawLines = String(ncText || '').replace(/\r\n/g, '\n').split('\n')

  for (const l of parsed.lines || []) {
    if (l.skip) continue
    const m = l.modal || {}
    const original = rawLines[l.index - 1] || l.raw
    const hasFOnLine = /(?:^|[^A-Z])F\s*[-+]?\d/i.test(original)
    if (l.words?.F != null) lastFeed = Number(l.words.F)

    const cutting = m.motion === 'G01' || m.motion === 'G02' || m.motion === 'G03'
    const hasAxis = l.words?.X != null || l.words?.Y != null || l.words?.Z != null
    if (cutting && hasAxis && (m.feed == null || m.feed <= 0)) {
      const f = lastFeed || defaultFeed
      const suggested = hasFOnLine ? original : `${original.trim()} F${Math.round(f)}`
      fixes.push({
        line: l.index,
        code: 'MISSING_FEED',
        message: `第 ${l.index} 行切削缺少进给，建议 F${Math.round(f)}`,
        original,
        suggested,
        apply: true,
      })
    }
    if ((l.gCodes || []).includes(43) && l.words?.H == null) {
      const original = rawLines[l.index - 1] || l.raw
      fixes.push({
        line: l.index,
        code: 'G43_NO_H',
        message: `第 ${l.index} 行 G43 缺少 H，建议 H01`,
        original,
        suggested: /H\s*\d/i.test(original) ? original : `${original.trim()} H01`,
        apply: true,
      })
    }
  }

  return { ok: true, fixes }
}

/** 按建议应用修复，返回新 NC 文本 */
export function applyNcFixes(ncText, fixes = []) {
  const lines = String(ncText || '').replace(/\r\n/g, '\n').split('\n')
  for (const f of fixes) {
    if (!f?.apply || f.line == null) continue
    const i = Number(f.line) - 1
    if (i >= 0 && i < lines.length && f.suggested != null) lines[i] = f.suggested
  }
  return lines.join('\n')
}

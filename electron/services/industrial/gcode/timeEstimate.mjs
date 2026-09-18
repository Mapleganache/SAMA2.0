/**
 * 程序时间估算
 */
import { normalizeSegment, normalizeToolpathIr, segmentLength } from './toolpathIr.mjs'

export function estimateMachiningTime(toolpath, opts = {}) {
  const tp = normalizeToolpathIr(toolpath)
  const rapidFeed = Number(opts.rapidFeedMmMin) || 5000
  const toolChangeSec = Number(opts.toolChangeSec) || 8
  const spindleStartSec = Number(opts.spindleStartSec) || 2

  let rapidSec = 0
  let cutSec = 0
  let lastTool = null
  let toolChanges = 0

  for (const raw of tp.segments) {
    const seg = normalizeSegment(raw)
    const len = segmentLength(seg)
    if (seg.tool && seg.tool !== lastTool) {
      if (lastTool) toolChanges += 1
      lastTool = seg.tool
    }
    if (seg.type === 'rapid') {
      rapidSec += (len / Math.max(1, rapidFeed)) * 60
    } else {
      const f = Math.max(1, Number(seg.feed) || 300)
      cutSec += (len / f) * 60
    }
  }

  const overhead = toolChanges * toolChangeSec + spindleStartSec
  const total = rapidSec + cutSec + overhead
  const fmt = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.round(s % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  return {
    kind: 'time.estimate',
    rapidSec,
    cuttingSec: cutSec,
    overheadSec: overhead,
    toolChanges,
    totalSec: total,
    display: fmt(total),
    breakdown: {
      rapid: `${rapidSec.toFixed(2)}s`,
      cutting: `${cutSec.toFixed(2)}s`,
      nonCutting: `${(rapidSec + overhead).toFixed(2)}s`,
    },
  }
}

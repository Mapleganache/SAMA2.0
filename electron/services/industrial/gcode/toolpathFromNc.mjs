/**
 * NC → ToolpathIR V1.2（统一 start/end，rapid/cut/arc）
 */
import { parseGcodeText } from './gcodeParser.mjs'
import { normalizeToolpathIr } from './toolpathIr.mjs'

function expandCycleSegments(prev, modal, line, segments) {
  const cycle = modal.cycle
  if (!cycle) return
  const x = modal.x ?? prev.x ?? 0
  const y = modal.y ?? prev.y ?? 0
  const z = modal.z ?? -10
  const r = modal.r ?? 2
  const q = Math.abs(modal.q || 5)
  const tool = modal.tool != null ? `T${String(modal.tool).padStart(2, '0')}` : null
  const fromZ = Math.max(r, prev.z ?? r)

  segments.push({
    type: 'rapid',
    start: { ...prev },
    end: { x, y, z: fromZ },
    line: line.index,
    kind: 'cycle_approach',
    tool,
    motion: 'G00',
  })

  if (cycle === 'G83') {
    let depth = fromZ
    const bottom = z
    while (depth > bottom + 1e-6) {
      const nextZ = Math.max(bottom, depth - q)
      segments.push({
        type: 'cut',
        motion: cycle,
        start: { x, y, z: depth },
        end: { x, y, z: nextZ },
        line: line.index,
        kind: 'peck',
        feed: modal.feed,
        tool,
      })
      segments.push({
        type: 'rapid',
        start: { x, y, z: nextZ },
        end: { x, y, z: fromZ },
        line: line.index,
        kind: 'peck_retract',
        tool,
        motion: 'G00',
      })
      depth = nextZ
      if (nextZ <= bottom + 1e-9) break
    }
  } else {
    segments.push({
      type: 'cut',
      motion: cycle,
      start: { x, y, z: fromZ },
      end: { x, y, z },
      line: line.index,
      kind: cycle,
      feed: modal.feed,
      tool,
    })
    segments.push({
      type: 'rapid',
      start: { x, y, z },
      end: { x, y, z: modal.retractMode === 'G99' ? r : fromZ },
      line: line.index,
      kind: 'cycle_retract',
      tool,
      motion: 'G00',
    })
  }
}

/**
 * @returns {import('./toolpathIr.mjs').createEmptyToolpathIr extends Function ? object : object}
 */
export function toolpathIrFromNc(ncText) {
  const parsed = parseGcodeText(ncText)
  const segments = []
  let prev = { x: 0, y: 0, z: 0 }
  const tools = new Set()

  for (const line of parsed.lines || []) {
    if (line.skip) continue
    const m = line.modal || {}
    const cur = {
      x: m.x ?? prev.x,
      y: m.y ?? prev.y,
      z: m.z ?? prev.z,
    }
    const tool = m.tool != null ? `T${String(m.tool).padStart(2, '0')}` : null
    if (tool) tools.add(tool)

    const gs = line.gCodes || []
    const isCycleLine =
      gs.some((g) => g >= 81 && g <= 86) ||
      (m.cycle && (line.words?.X != null || line.words?.Y != null || line.words?.Z != null))
    if (isCycleLine && m.cycle) {
      expandCycleSegments(prev, m, line, segments)
      prev = { x: m.x ?? prev.x, y: m.y ?? prev.y, z: m.z ?? prev.z }
      continue
    }

    const moved =
      (line.words?.X != null || line.words?.Y != null || line.words?.Z != null) &&
      (m.motion === 'G00' || m.motion === 'G01' || m.motion === 'G02' || m.motion === 'G03')

    if (moved) {
      let type = 'cut'
      if (m.motion === 'G00') type = 'rapid'
      else if (m.motion === 'G02' || m.motion === 'G03') type = 'arc'

      const seg = {
        type,
        start: { ...prev },
        end: { ...cur },
        line: line.index,
        feed: m.feed,
        tool,
        motion: m.motion,
      }
      if (type === 'arc') {
        seg.i = line.words?.I
        seg.j = line.words?.J
        seg.direction = m.motion === 'G03' ? 'CCW' : 'CW'
      }
      segments.push(seg)
      prev = { ...cur }
    } else {
      prev = { ...cur }
    }
  }

  return normalizeToolpathIr({
    kind: 'toolpath.ir',
    source: 'nc',
    schemaVersion: 2,
    segments,
    tools: [...tools],
    summary: parsed.summary,
    programNumber: parsed.programNumber,
  })
}

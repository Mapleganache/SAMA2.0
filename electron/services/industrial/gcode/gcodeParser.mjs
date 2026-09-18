/**
 * G-code Parser：NC 文本 → 行 + ModalState 轨迹摘要
 */
import { createModalState, applyLineToModal } from './modalState.mjs'

function parseWordLine(raw) {
  const text = String(raw || '').replace(/\(.*?\)/g, ' ').trim()
  if (!text || text === '%' || text.startsWith(';') || text.startsWith('/')) {
    return { empty: true, raw }
  }
  const gCodes = []
  const mCodes = []
  const words = {}
  const re = /([A-Za-z])\s*([-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?)/g
  let m
  while ((m = re.exec(text))) {
    const letter = m[1].toUpperCase()
    const val = Number(m[2])
    if (letter === 'G') {
      // G54.1 etc — take integer part for modal groups we care about
      gCodes.push(Math.trunc(val))
    } else if (letter === 'M') {
      mCodes.push(Math.trunc(val))
    } else {
      words[letter] = val
    }
  }
  const o = text.match(/^O(\d+)/i)
  return {
    empty: false,
    raw,
    oNumber: o ? Number(o[1]) : null,
    gCodes,
    mCodes,
    words,
  }
}

export function parseGcodeText(ncText) {
  const lines = String(ncText || '').replace(/\r\n/g, '\n').split('\n')
  let modal = createModalState()
  const parsed = []
  let programNumber = null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let hasCut = false
  const tools = new Set()

  lines.forEach((raw, index) => {
    const line = parseWordLine(raw)
    if (line.oNumber != null) programNumber = line.oNumber
    if (line.empty) {
      parsed.push({ index: index + 1, raw, skip: true, modal: { ...modal } })
      return
    }
    modal = applyLineToModal(modal, line)
    if (modal.tool) tools.add(modal.tool)
    if (modal.motion === 'G01' || modal.motion === 'G02' || modal.motion === 'G03') hasCut = true
    if (modal.x != null && Number.isFinite(modal.x)) {
      minX = Math.min(minX, modal.x)
      maxX = Math.max(maxX, modal.x)
    }
    if (modal.y != null && Number.isFinite(modal.y)) {
      minY = Math.min(minY, modal.y)
      maxY = Math.max(maxY, modal.y)
    }
    if (modal.z != null && Number.isFinite(modal.z)) {
      minZ = Math.min(minZ, modal.z)
      maxZ = Math.max(maxZ, modal.z)
    }
    parsed.push({
      index: index + 1,
      raw,
      gCodes: line.gCodes,
      mCodes: line.mCodes,
      words: line.words,
      modal: { ...modal },
    })
  })

  const finite = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? { min: a, max: b } : null)

  return {
    ok: true,
    kind: 'gcode.parse',
    programNumber,
    lineCount: lines.length,
    lines: parsed,
    finalModal: modal,
    tools: [...tools],
    bounds: {
      x: finite(minX, maxX),
      y: finite(minY, maxY),
      z: finite(minZ, maxZ),
    },
    summary: {
      units: modal.units,
      distance: modal.distance,
      workOffset: modal.coordinateSystem,
      plane: modal.plane,
      hasCuttingMove: hasCut,
      maxDepth: Number.isFinite(minZ) ? minZ : null,
      tool: modal.tool,
      spindle: modal.spindle,
      feed: modal.feed,
    },
  }
}

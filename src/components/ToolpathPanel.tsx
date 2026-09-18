import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  isGCodeFile,
  looksLikeGcode,
  parseGcode,
  suggestViewPlane,
} from '../gcode/parseGcode'
import type { GCodeParseResult, MachineLimits, ProgramKind } from '../gcode/types'
import { DEFAULT_LIMITS } from '../gcode/types'

type ViewPlane = 'XY' | 'XZ' | 'YZ'

type Props = {
  path: string
  content: string
}

function pickAxes(
  plane: ViewPlane,
  kind: ProgramKind,
): [keyof { x: number; y: number; z: number }, keyof { x: number; y: number; z: number }] {
  if (plane === 'XY') return ['x', 'y']
  if (plane === 'XZ') {
    // 车/磨习惯：Z 沿工件轴向朝右，X 为直径朝上
    if (kind === 'grind' || kind === 'lathe') return ['z', 'x']
    return ['x', 'z']
  }
  return ['y', 'z']
}

function fmtLen(n: number, kind?: ProgramKind): string {
  if (!Number.isFinite(n)) return '—'
  if (kind === 'grind') return (n * 1000).toFixed(1)
  const a = Math.abs(n)
  if (a >= 100) return n.toFixed(1)
  if (a >= 10) return n.toFixed(2)
  if (a >= 1) return n.toFixed(3).replace(/\.?0+$/, '') || '0'
  return n.toFixed(3)
}

function displayUnit(kind: ProgramKind, units: 'mm' | 'inch' | string): string {
  if (kind === 'grind') return 'μm'
  return units === 'mm' ? 'mm' : 'in'
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 10
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / exp
  if (n <= 1) return exp
  if (n <= 2) return 2 * exp
  if (n <= 5) return 5 * exp
  return 10 * exp
}

function paintToolpath(
  canvas: HTMLCanvasElement,
  result: GCodeParseResult,
  plane: ViewPlane,
  limits: MachineLimits,
  hoverLine: number | null,
  opts?: { roomy?: boolean },
) {
  const parent = canvas.parentElement
  const w = Math.max(220, parent?.clientWidth ?? 280)
  const h = Math.max(opts?.roomy ? 360 : 180, parent?.clientHeight ?? 200)
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(w * dpr)
  canvas.height = Math.floor(h * dpr)
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const kind = result.modal.kind
  const [ax, ay] = pickAxes(plane, kind)
  const latheView = plane === 'XZ' && (kind === 'grind' || kind === 'lathe')
  const room = opts?.roomy ? 1.15 : 1
  const padL = 28 * room
  const padR = 28 * room
  const padT = 28 * room
  const padB = 28 * room

  let minA = Infinity
  let maxA = -Infinity
  let minB = Infinity
  let maxB = -Infinity
  for (const seg of result.segments) {
    for (const p of seg.points) {
      minA = Math.min(minA, p[ax])
      maxA = Math.max(maxA, p[ax])
      minB = Math.min(minB, p[ay])
      maxB = Math.max(maxB, p[ay])
    }
  }
  if (!Number.isFinite(minA)) {
    minA = -10
    maxA = 10
    minB = -10
    maxB = 10
  }
  if (Math.abs(maxA - minA) < 1e-6) {
    minA -= 1
    maxA += 1
  }
  if (Math.abs(maxB - minB) < 1e-6) {
    minB -= 1
    maxB += 1
  }
  if (latheView) {
    const peak = Math.max(Math.abs(minB), Math.abs(maxB), 1)
    minB = -peak
    maxB = peak
  }

  const spanA = Math.max(maxA - minA, 1e-3)
  const spanB = Math.max(maxB - minB, 1e-3)
  const innerW = Math.max(40, w - padL - padR)
  const innerH = Math.max(40, h - padT - padB)
  const scale = Math.min(innerW / spanA, innerH / spanB) * 0.82

  const midA = (minA + maxA) / 2
  const midB = (minB + maxB) / 2
  const ox = padL + innerW / 2
  const oy = padT + innerH / 2
  const toScreen = (a: number, b: number) => ({
    x: ox + (a - midA) * scale,
    y: oy - (b - midB) * scale,
  })

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#0a0f14'
  ctx.fillRect(0, 0, w, h)

  const unit = displayUnit(kind, result.modal.units)
  const gridStep = niceStep(Math.max(spanA, spanB) / 6)

  ctx.strokeStyle = 'rgba(46, 61, 77, 0.55)'
  ctx.lineWidth = 1
  const startA = Math.floor(minA / gridStep) * gridStep
  const startB = Math.floor(minB / gridStep) * gridStep
  for (let a = startA; a <= maxA + gridStep; a += gridStep) {
    const p0 = toScreen(a, minB)
    const p1 = toScreen(a, maxB)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
  }
  for (let b = startB; b <= maxB + gridStep; b += gridStep) {
    const p0 = toScreen(minA, b)
    const p1 = toScreen(maxA, b)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
  }

  if (latheView) {
    const axis0 = toScreen(minA, 0)
    const axis1 = toScreen(maxA, 0)
    ctx.strokeStyle = 'rgba(139, 154, 171, 0.65)'
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(axis0.x, axis0.y)
    ctx.lineTo(axis1.x, axis1.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#8b9aab'
    ctx.font = '10px Cascadia Mono, Consolas, monospace'
    ctx.textAlign = 'left'
    ctx.fillText('轴线 X0', Math.max(10, axis1.x - 52), axis1.y - 6)
  } else {
    const o = toScreen(0, 0)
    ctx.strokeStyle = 'rgba(139, 154, 171, 0.55)'
    ctx.beginPath()
    ctx.moveTo(o.x - 8, o.y)
    ctx.lineTo(o.x + 8, o.y)
    ctx.moveTo(o.x, o.y - 8)
    ctx.lineTo(o.x, o.y + 8)
    ctx.stroke()

    const limMap = {
      x: [limits.xMin, limits.xMax],
      y: [limits.yMin, limits.yMax],
      z: [limits.zMin, limits.zMax],
    } as const
    const [la0, la1] = limMap[ax]
    const [lb0, lb1] = limMap[ay]
    const c0 = toScreen(la0, lb0)
    const c1 = toScreen(la1, lb1)
    ctx.strokeStyle = 'rgba(217, 107, 92, 0.35)'
    ctx.setLineDash([4, 4])
    ctx.strokeRect(
      Math.min(c0.x, c1.x),
      Math.min(c0.y, c1.y),
      Math.abs(c1.x - c0.x),
      Math.abs(c1.y - c0.y),
    )
    ctx.setLineDash([])
  }

  const strokeSeg = (seg: (typeof result.segments)[number], mirrorX: boolean) => {
    const active = hoverLine != null && seg.line === hoverLine
    if (seg.type === 'rapid') {
      ctx.strokeStyle = active ? '#f0d878' : '#d4a017'
      ctx.setLineDash([5, 4])
      ctx.lineWidth = active ? 2.2 : 1.2
    } else if (seg.type === 'arc_cw' || seg.type === 'arc_ccw') {
      ctx.strokeStyle = active ? '#7ee0d4' : '#3db8a8'
      ctx.setLineDash([])
      ctx.lineWidth = active ? 2.4 : 1.6
    } else {
      ctx.strokeStyle = active ? '#9ecbff' : '#5b8def'
      ctx.setLineDash([])
      ctx.lineWidth = active ? 2.4 : 1.6
    }
    if (mirrorX) ctx.globalAlpha = 0.28
    ctx.beginPath()
    seg.points.forEach((p, idx) => {
      const b = mirrorX && ay === 'x' ? -p[ay] : p[ay]
      const s = toScreen(p[ax], b)
      if (idx === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  if (latheView) {
    for (const seg of result.segments) {
      if (seg.type !== 'rapid') strokeSeg(seg, true)
    }
  }
  for (const seg of result.segments) {
    strokeSeg(seg, false)
  }

  if (result.segments.length) {
    const start = result.segments[0].from
    const end = result.segments[result.segments.length - 1].to
    const s = toScreen(start[ax], start[ay])
    const e = toScreen(end[ax], end[ay])
    ctx.fillStyle = '#3db8a8'
    ctx.beginPath()
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#d96b5c'
    ctx.beginPath()
    ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // 画布内只留轻量角标；尺寸数字放在画布外的 HTML，避免裁切
  const barLen = niceStep(Math.max(spanA, spanB) / 4)
  const barPx = barLen * scale
  if (barPx >= 28 && barPx < w * 0.4) {
    const bx = w - 18 - barPx
    const by = 20
    ctx.strokeStyle = '#e8eef4'
    ctx.fillStyle = '#e8eef4'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + barPx, by)
    ctx.moveTo(bx, by - 4)
    ctx.lineTo(bx, by + 4)
    ctx.moveTo(bx + barPx, by - 4)
    ctx.lineTo(bx + barPx, by + 4)
    ctx.stroke()
    ctx.font = '11px Cascadia Mono, Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`${fmtLen(barLen, kind)}${unit}`, bx + barPx / 2, by - 6)
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = '#8b9aab'
  ctx.font = '11px Cascadia Mono, Consolas, monospace'
  ctx.fillText(`${ax.toUpperCase()} →`, w - 44, h - 12)
  ctx.fillText(`↑ ${ay.toUpperCase()}`, 10, 16)
  ctx.fillText(`网格 ${fmtLen(gridStep, kind)}${unit}`, 10, h - 12)
}

function usePaintCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  wrapRef: RefObject<HTMLDivElement | null>,
  result: GCodeParseResult,
  plane: ViewPlane,
  limits: MachineLimits,
  hoverLine: number | null,
  roomy: boolean,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const redraw = () => paintToolpath(canvas, result, plane, limits, hoverLine, { roomy })
    redraw()

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => redraw()) : null
    ro?.observe(wrap)
    window.addEventListener('resize', redraw)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', redraw)
    }
  }, [canvasRef, wrapRef, result, plane, limits, hoverLine, roomy, active])
}

export function ToolpathPanel({ path, content }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const bigCanvasRef = useRef<HTMLCanvasElement>(null)
  const bigWrapRef = useRef<HTMLDivElement>(null)

  const [limits, setLimits] = useState<MachineLimits>(DEFAULT_LIMITS)
  const [showLimits, setShowLimits] = useState(false)
  const [hoverLine, setHoverLine] = useState<number | null>(null)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

  const result = useMemo(() => parseGcode(content, limits), [content, limits])
  const autoPlane = useMemo(
    () => suggestViewPlane(result.usedAxes, result.modal.kind),
    [result.usedAxes, result.modal.kind],
  )
  const [plane, setPlane] = useState<ViewPlane>(autoPlane)

  useEffect(() => {
    setPlane(suggestViewPlane(result.usedAxes, result.modal.kind))
  }, [path, result.usedAxes.x, result.usedAxes.y, result.usedAxes.z, result.modal.kind])

  useEffect(() => {
    const n = result.issues.filter((i) => i.level === 'error' || i.level === 'warn').length
    setIssuesOpen(n > 0)
  }, [path])

  useEffect(() => {
    if (!viewerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewerOpen])

  usePaintCanvas(canvasRef, wrapRef, result, plane, limits, hoverLine, false, true)
  usePaintCanvas(bigCanvasRef, bigWrapRef, result, plane, limits, hoverLine, true, viewerOpen)

  if (!isGCodeFile(path) && !looksLikeGcode(content)) {
    return (
      <div className="tp-empty">
        当前文件不是 G 代码（.nc / .gcode / O 程序号等）。打开程序后可在此预览刀路并校验。
      </div>
    )
  }

  const errN = result.issues.filter((i) => i.level === 'error').length
  const warnN = result.issues.filter((i) => i.level === 'warn').length
  const unit = displayUnit(result.modal.kind, result.modal.units)
  const grind = result.modal.kind === 'grind'
  const pathShow = grind ? result.stats.pathLength * 1000 : result.stats.pathLength
  const b = result.bounds
  const axisRows: { axis: string; used: boolean; min: number; max: number }[] = [
    { axis: result.modal.diameter ? 'Xφ' : 'X', used: result.usedAxes.x, min: b.xMin, max: b.xMax },
    { axis: 'Y', used: result.usedAxes.y, min: b.yMin, max: b.yMax },
    { axis: 'Z', used: result.usedAxes.z, min: b.zMin, max: b.zMax },
  ]

  const planeSwitch = (
    <div className="tp-plane">
      {(['XY', 'XZ', 'YZ'] as ViewPlane[]).map((p) => (
        <button
          key={p}
          type="button"
          className={plane === p ? 'active' : ''}
          onClick={() => setPlane(p)}
        >
          {p}
        </button>
      ))}
    </div>
  )

  const extentBlock = (
    <div className="tp-extent" aria-label="轴向尺寸图例">
      {axisRows.map((row) => {
        const span = row.max - row.min
        const idle = !row.used || !Number.isFinite(span)
        return (
          <span key={row.axis} className={idle ? 'idle' : ''}>
            <strong>{row.axis}</strong>
            {idle
              ? ' 未运动'
              : ` ${fmtLen(row.min, result.modal.kind)} → ${fmtLen(row.max, result.modal.kind)} · Δ${fmtLen(span, result.modal.kind)}${unit}`}
          </span>
        )
      })}
    </div>
  )

  return (
    <div className="tp-panel">
      <div className="tp-toolbar">
        {planeSwitch}
        {result.modal.kind !== 'mill' && (
          <span className="tp-kind" title={result.modal.diameter ? 'X 为工件直径' : ''}>
            {result.modal.kind === 'grind' ? '磨床' : '车削'}
            {result.modal.diameter ? ' · 直径编程' : ''}
            {plane === 'XZ' ? ' · Z→ X↑' : ''}
          </span>
        )}
        <div className="tp-toolbar-actions">
          <button type="button" className="ghost-btn" onClick={() => setViewerOpen(true)}>
            放大刀路
          </button>
          <button type="button" className="ghost-btn" onClick={() => setShowLimits((v) => !v)}>
            {showLimits ? '收起行程' : '行程设置'}
          </button>
        </div>
      </div>

      {showLimits && (
        <div className="tp-limits">
          {(
            [
              ['xMin', 'Xmin'],
              ['xMax', 'Xmax'],
              ['yMin', 'Ymin'],
              ['yMax', 'Ymax'],
              ['zMin', 'Zmin'],
              ['zMax', 'Zmax'],
              ['maxFeed', 'Fmax'],
              ['maxSpindle', 'Smax'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                value={limits[key]}
                onChange={(e) =>
                  setLimits((prev) => ({
                    ...prev,
                    [key]: Number(e.target.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
      )}

      <div className="tp-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} />
      </div>

      <div className="tp-meta">
        {extentBlock}

        <div className="tp-legend">
          <span className="lg-rapid">G00 快速</span>
          <span className="lg-feed">G01 切削</span>
          <span className="lg-arc">G02/03 圆弧</span>
          <span className="lg-start">起点</span>
          <span className="lg-end">终点</span>
        </div>

        <div className="tp-stats">
          <span>段数 {result.stats.moveCount}</span>
          <span>快速 {result.stats.rapidCount}</span>
          <span>切削 {result.stats.feedCount}</span>
          <span>圆弧 {result.stats.arcCount}</span>
          <span>
            路径 {pathShow.toFixed(1)}
            {unit}
          </span>
          <button
            type="button"
            className={`tp-check-btn ${errN ? 'bad' : warnN ? 'warn' : 'ok'}${issuesOpen ? ' open' : ''}`}
            title="仅显示致命错误；宏/专机指令不再预警"
            aria-expanded={issuesOpen}
            onClick={() => setIssuesOpen((v) => !v)}
          >
            校验 {errN} 错 / {warnN} 警
            <span className="tp-check-chev" aria-hidden>
              {issuesOpen ? '▴' : '▾'}
            </span>
          </button>
        </div>

        {issuesOpen && (
          <div className="tp-issues-wrap">
            <div className="tp-issues-hint">
              刀路预览只报<strong>致命错误</strong>（如圆弧缺圆心）。超行程按当前「行程设置」给警告；Fanuc
              宏 / 专机 M/G / 参数写入等一律忽略。磨床坐标按 μm（一位小数）显示；车削仍按 mm。
            </div>
            <ul className="tp-issues">
              {result.issues.length === 0 && (
                <li className="ok">未发现明显问题（基础校验）</li>
              )}
              {result.issues.map((it, idx) => (
                <li
                  key={`${it.line}-${idx}`}
                  className={it.level}
                  onMouseEnter={() => setHoverLine(it.line)}
                  onMouseLeave={() => setHoverLine(null)}
                >
                  <strong>
                    L{it.line} ·{' '}
                    {it.level === 'error' ? '错误' : it.level === 'warn' ? '警告' : '提示'}
                  </strong>
                  {it.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {viewerOpen && (
        <div
          className="modal-backdrop tp-viewer-backdrop"
          onClick={() => setViewerOpen(false)}
          role="presentation"
        >
          <div
            className="modal tp-viewer-modal"
            role="dialog"
            aria-modal="true"
            aria-label="刀路放大查看"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <div>
                <h2>刀路放大查看</h2>
                <p>
                  {path.split(/[/\\]/).pop() || path} · {plane} 平面 · Esc 关闭
                </p>
              </div>
              <button type="button" className="ghost-btn" onClick={() => setViewerOpen(false)}>
                关闭
              </button>
            </header>
            <div className="tp-viewer-toolbar">
              {planeSwitch}
              {extentBlock}
            </div>
            <div className="tp-viewer-canvas-wrap" ref={bigWrapRef}>
              <canvas ref={bigCanvasRef} />
            </div>
            <div className="tp-legend tp-viewer-legend">
              <span className="lg-rapid">G00 快速</span>
              <span className="lg-feed">G01 切削</span>
              <span className="lg-arc">G02/03 圆弧</span>
              <span className="lg-start">起点</span>
              <span className="lg-end">终点</span>
              <span>
                路径 {pathShow.toFixed(1)}
                {unit}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef } from 'react'

type Pt = { x: number; y: number; z?: number }
type Seg = {
  type?: string
  from?: Pt
  to?: Pt
  start?: Pt
  end?: Pt
  line?: number
}

type StockBox = {
  min?: Pt
  max?: Pt
}

type Props = {
  segments?: Seg[]
  bounds?: { x?: number[]; y?: number[]; z?: number[] }
  currentLine?: number | null
  toolPos?: Pt | null
  stock?: StockBox | null
  /** 2.5D 高度场可视化 */
  removal?: {
    nx?: number
    ny?: number
    cell?: number
    origin?: { x: number; y: number }
    zTop?: number
    zBottom?: number
    heights?: number[]
  } | null
  width?: number
  height?: number
}

export function NcToolpathPreview({
  segments = [],
  bounds,
  currentLine = null,
  toolPos = null,
  stock = null,
  removal = null,
  width = 420,
  height = 280,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const pad = 24
    let x0 = bounds?.x?.[0] ?? stock?.min?.x ?? 0
    let x1 = bounds?.x?.[1] ?? stock?.max?.x ?? 100
    let y0 = bounds?.y?.[0] ?? stock?.min?.y ?? 0
    let y1 = bounds?.y?.[1] ?? stock?.max?.y ?? 100
    if (stock?.min && stock?.max) {
      x0 = Math.min(x0, stock.min.x)
      x1 = Math.max(x1, stock.max.x)
      y0 = Math.min(y0, stock.min.y)
      y1 = Math.max(y1, stock.max.y)
    }
    if (x1 - x0 < 1e-6) {
      x0 -= 10
      x1 += 10
    }
    if (y1 - y0 < 1e-6) {
      y0 -= 10
      y1 += 10
    }
    const sx = (width - pad * 2) / (x1 - x0)
    const sy = (height - pad * 2) / (y1 - y0)
    const s = Math.min(sx, sy)
    const mapX = (x: number) => pad + (x - x0) * s
    const mapY = (y: number) => height - pad - (y - y0) * s

    ctx.fillStyle = '#121820'
    ctx.fillRect(0, 0, width, height)

    // stock outline
    if (stock?.min && stock?.max) {
      ctx.fillStyle = 'rgba(90, 110, 90, 0.25)'
      ctx.strokeStyle = 'rgba(140, 180, 120, 0.7)'
      ctx.lineWidth = 1
      const rx = mapX(stock.min.x)
      const ry = mapY(stock.max.y)
      const rw = mapX(stock.max.x) - mapX(stock.min.x)
      const rh = mapY(stock.min.y) - mapY(stock.max.y)
      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeRect(rx, ry, rw, rh)
    }

    // heightmap (remaining stock)
    if (removal?.heights && removal.nx && removal.ny && removal.cell != null) {
      const ox = removal.origin?.x ?? 0
      const oy = removal.origin?.y ?? 0
      const zTop = removal.zTop ?? 0
      const zBot = removal.zBottom ?? -20
      const span = Math.max(1e-6, zTop - zBot)
      for (let iy = 0; iy < removal.ny; iy++) {
        for (let ix = 0; ix < removal.nx; ix++) {
          const z = removal.heights[iy * removal.nx + ix]
          const cut = (zTop - z) / span
          if (cut < 0.02) continue
          const wx = ox + ix * removal.cell
          const wy = oy + iy * removal.cell
          const g = Math.floor(40 + cut * 140)
          ctx.fillStyle = `rgba(${60 + g}, ${90 + g * 0.4}, ${70}, 0.55)`
          const cs = Math.max(1, removal.cell * s)
          ctx.fillRect(mapX(wx) - cs / 2, mapY(wy) - cs / 2, cs, cs)
        }
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let i = 0; i < 8; i++) {
      const gx = pad + ((width - pad * 2) * i) / 7
      const gy = pad + ((height - pad * 2) * i) / 7
      ctx.beginPath()
      ctx.moveTo(gx, pad)
      ctx.lineTo(gx, height - pad)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(pad, gy)
      ctx.lineTo(width - pad, gy)
      ctx.stroke()
    }

    for (const seg of segments) {
      const a = seg.start || seg.from
      const b = seg.end || seg.to
      if (!a || !b) continue
      const active = currentLine != null && seg.line === currentLine
      if (seg.type === 'rapid') {
        ctx.strokeStyle = active ? '#f0c14b' : 'rgba(120,160,200,0.55)'
        ctx.setLineDash([4, 3])
      } else {
        ctx.strokeStyle = active ? '#5dffc0' : 'rgba(61,184,168,0.85)'
        ctx.setLineDash([])
      }
      ctx.lineWidth = active ? 2.4 : 1.4
      ctx.beginPath()
      ctx.moveTo(mapX(a.x), mapY(a.y))
      ctx.lineTo(mapX(b.x), mapY(b.y))
      ctx.stroke()
    }
    ctx.setLineDash([])

    if (toolPos) {
      ctx.fillStyle = '#ff6b6b'
      ctx.beginPath()
      ctx.arc(mapX(toolPos.x), mapY(toolPos.y), 5, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = 'rgba(200,210,220,0.7)'
    ctx.font = '11px ui-monospace, Consolas, monospace'
    ctx.fillText(removal?.heights ? 'Stock / 去除 / 刀路' : 'XY 刀路预览', 10, 14)
  }, [segments, bounds, currentLine, toolPos, stock, removal, width, height])

  return <canvas ref={ref} className="nc-toolpath-canvas" aria-label="NC 刀路预览" />
}

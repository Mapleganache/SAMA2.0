type IoRow = { addr?: string; name?: string; device?: string }

type Preview = {
  title?: string
  description?: string
  ioTable?: IoRow[]
  sequenceOk?: boolean
  plc?: {
    ascii?: string
    mnemonic?: string
    rungs?: { id?: string; type?: string; comment?: string; ascii?: string }[]
    simulation?: {
      ok?: boolean
      total?: number
      passed?: number
      failed?: number
      results?: { id?: string; name?: string; ok?: boolean }[]
    }
  }
  electrical?: {
    svg?: string
    bom?: { id?: string; type?: string; qty?: number }[]
    connectivityText?: string
    markdown?: string
    path?: string
    txtPath?: string
    deviceCount?: number
    edgeCount?: number
  }
  cam?: { nc?: string }
  cad?: {
    geometry?: {
      bbox?: number[]
      holeCount?: number
      units?: string
      solids?: { type?: string; width?: number; depth?: number; height?: number; origin?: number[] }[]
      holes?: { diameter?: number; position?: number[] }[]
      bbox2d?: { min?: number[]; max?: number[]; size?: number[] }
    }
  }
}

export type IndustrialPreview = Preview

type Props = {
  preview: Preview
  projectDir?: string
  onOpenDir?: (dir?: string) => void
  onExplain?: () => void
}

function CadSketch({ geometry }: { geometry: NonNullable<Preview['cad']>['geometry'] }) {
  if (!geometry) return null
  const solids = geometry.solids || []
  const holes = geometry.holes || []
  const size = geometry.bbox2d?.size || geometry.bbox || [200, 120]
  const w = Math.max(Number(size[0]) || 200, 1)
  const h = Math.max(Number(size[1]) || 120, 1)
  const pad = 16
  const scale = Math.min(360 / w, 220 / h)
  const vbW = w * scale + pad * 2
  const vbH = h * scale + pad * 2
  const ox = Number(geometry.bbox2d?.min?.[0] || 0)
  const oy = Number(geometry.bbox2d?.min?.[1] || 0)
  const tx = (x: number) => pad + (x - ox) * scale
  const ty = (y: number) => pad + (y - oy) * scale
  return (
    <svg className="iw-sample-svg" viewBox={`0 0 ${vbW} ${vbH}`} role="img" aria-label="顶视示意">
      <rect width={vbW} height={vbH} fill="var(--bg-1)" />
      {solids.map((s, i) => (
        <rect
          key={`s${i}`}
          x={tx(Number(s.origin?.[0] || 0))}
          y={ty(Number(s.origin?.[1] || 0))}
          width={Math.max(1, Number(s.width || 0) * scale)}
          height={Math.max(1, Number((s.depth ?? s.height) || 0) * scale)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      ))}
      {holes.map((hole, i) => (
        <circle
          key={`h${i}`}
          cx={tx(Number(hole.position?.[0] || 0))}
          cy={ty(Number(hole.position?.[1] || 0))}
          r={Math.max(1.5, (Number(hole.diameter || 0) / 2) * scale)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      ))}
    </svg>
  )
}

export function IndustrialSampleView({ preview, projectDir, onOpenDir, onExplain }: Props) {
  const plc = preview.plc
  const sim = plc?.simulation
  return (
    <section className="iw-card iw-sample">
      <div className="iw-cap-row">
        <h2>{preview.title || '样例'}</h2>
        {onExplain ? (
          <button type="button" className="ghost-btn" onClick={onExplain}>
            这是什么
          </button>
        ) : null}
      </div>
      {preview.description ? <p className="iw-muted">{preview.description}</p> : null}
      {preview.sequenceOk != null ? (
        <p className={preview.sequenceOk ? 'iw-cap-ok' : 'iw-cap-off'}>
          序贯仿真：{preview.sequenceOk ? '通过（启动 → 夹紧 → 保持 → 松开）' : '未通过'}
        </p>
      ) : null}

      {preview.cad?.geometry ? (
        <>
          <h3>机械顶视</h3>
          <p className="iw-muted">
            外形 {preview.cad.geometry.bbox?.join(' × ') || '—'} {preview.cad.geometry.units || 'mm'}
            {preview.cad.geometry.holeCount != null ? ` · 孔 ${preview.cad.geometry.holeCount}` : ''}
          </p>
          <CadSketch geometry={preview.cad.geometry} />
        </>
      ) : null}

      {preview.electrical?.svg ? (
        <>
          <h3>原理图（由连通性渲染）</h3>
          {preview.electrical.deviceCount != null ? (
            <p className="iw-muted">
              器件 {preview.electrical.deviceCount}
              {preview.electrical.path ? ` · ${preview.electrical.path}` : ''}
            </p>
          ) : null}
          <div
            className="iw-sample-svg-wrap"
            dangerouslySetInnerHTML={{
              __html: preview.electrical.svg.replace(/^<\?xml[^>]*>\s*/i, ''),
            }}
          />
        </>
      ) : null}

      {preview.electrical?.connectivityText || preview.electrical?.markdown ? (
        <>
          <h3>元件连通性</h3>
          {preview.electrical.deviceCount != null && !preview.electrical?.svg ? (
            <p className="iw-muted">
              器件 {preview.electrical.deviceCount}
              {preview.electrical.edgeCount != null ? ` · 连接 ${preview.electrical.edgeCount}` : ''}
              {preview.electrical.path ? ` · ${preview.electrical.path}` : ''}
            </p>
          ) : null}
          <pre className="iw-pre iw-nc">
            {(preview.electrical.connectivityText || preview.electrical.markdown || '').slice(0, 12000)}
          </pre>
        </>
      ) : null}

      {preview.ioTable && preview.ioTable.length > 0 ? (
        <>
          <h3>I/O</h3>
          <table className="iw-table">
            <thead>
              <tr>
                <th>地址</th>
                <th>名称</th>
                <th>设备</th>
              </tr>
            </thead>
            <tbody>
              {preview.ioTable.map((row) => (
                <tr key={`${row.addr}-${row.name}`}>
                  <td>{row.addr}</td>
                  <td>{row.name}</td>
                  <td>{row.device}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {plc?.ascii ? (
        <>
          <h3>梯形图</h3>
          <pre className="iw-pre iw-ladder">{plc.ascii}</pre>
        </>
      ) : null}

      {plc?.mnemonic ? (
        <>
          <h3>助记符</h3>
          <pre className="iw-pre iw-nc">{plc.mnemonic}</pre>
        </>
      ) : null}

      {sim ? (
        <>
          <h3>仿真</h3>
          <p className={sim.ok ? 'iw-cap-ok' : 'iw-cap-off'}>
            {sim.ok ? '通过' : '未通过'}
            {sim.total != null ? ` · ${sim.passed ?? 0}/${sim.total}` : ''}
          </p>
          {sim.results && sim.results.length > 0 ? (
            <ul className="iw-cap-list">
              {sim.results.map((t) => (
                <li key={t.id || t.name}>
                  {t.ok ? '✓' : '✕'} {t.name || t.id}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {preview.cam?.nc ? (
        <>
          <h3>NC</h3>
          <pre className="iw-pre iw-nc">{preview.cam.nc}</pre>
        </>
      ) : null}

      {projectDir ? (
        <div className="iw-row">
          <button type="button" className="ghost-btn" onClick={() => onOpenDir?.(projectDir)}>
            打开工程文件夹
          </button>
        </div>
      ) : null}
    </section>
  )
}

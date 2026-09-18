import { useCallback, useEffect, useRef, useState } from 'react'
import { samaClient } from '../samaClient'
import { NcToolpathPreview } from './NcToolpathPreview'
import { PlcHelpModal } from './PlcHelpModal'
import { PlcExplainModal } from './PlcExplainModal'
import { IndustrialSampleView, type IndustrialPreview } from './IndustrialSampleView'

export type IndustrialNav = 'mech' | 'elec' | 'plc' | 'cam'

type Props = {
  nav: IndustrialNav
  onBack?: () => void
}

type CapAdapter = {
  id?: string
  domain?: string
  available?: boolean
  level?: string
  notes?: string
  label?: string
  detectMessage?: string
  bindable?: boolean
  boundPath?: string
}

const NAV_META: Record<
  IndustrialNav,
  { title: string; domain: string | null }
> = {
  mech: { title: '机械设计', domain: 'cad' },
  elec: { title: '电气设计', domain: 'electrical' },
  plc: { title: 'PLC', domain: 'plc' },
  cam: { title: '加工', domain: 'cam' },
}

const CAP_LABELS: Record<string, string> = {
  'cad.dxf': 'DXF 图纸',
  'cad.null': 'CAD 软件',
  'electrical.dxf': '电气原理图',
  'electrical.null': '电气软件',
  'plc.sim': 'PLC 仿真',
  'plc.null': 'PLC 软件',
  'cam.post': 'NC 后处理',
  'cam.null': 'CAM 软件',
  'desktop.bridge': '桌面工具',
}

const CAP_DETAIL: Record<string, { on: string; off: string }> = {
  'cad.dxf': {
    on: '本机可出顶视 DXF 和尺寸校验，不用装 SolidWorks。',
    off: 'DXF 内核未就绪。',
  },
  'cad.null': {
    on: '已接到外部 CAD 软件。',
    off: '没找到 SolidWorks / FreeCAD。可扫描本机，或添加安装目录。',
  },
  'electrical.dxf': {
    on: '本机可导出电路连通性表、BOM 和 I/O 对照。',
    off: '电气连通性导出内核未就绪。',
  },
  'electrical.null': {
    on: '已接到外部电气软件。',
    off: '未绑定外部电气软件（可选）。',
  },
  'plc.sim': {
    on: '本机可做时序仿真、出梯形/助记符。不会改机床上的 .LAD。',
    off: 'PLC 仿真内核未就绪。',
  },
  'plc.null': {
    on: '已接到 FANUC LADDER-III。',
    off: '没找到 LADDER-III（fladder.exe）。可扫描本机，或添加安装目录。',
  },
  'cam.post': {
    on: '本机可生成 FANUC 等 NC，并做行程/碰撞检查。不会下发机床。',
    off: 'NC 后处理内核未就绪。',
  },
  'cam.null': {
    on: '已接到外部 CAM 软件。',
    off: '没找到 Mastercam 等 CAM。可扫描本机，或添加安装目录。',
  },
  'desktop.bridge': {
    on: '可打开本机窗口、截图。不能当 CAD 用。',
    off: '桌面工具没加载起来。',
  },
}

function capName(a: CapAdapter): string {
  if (a.id && CAP_LABELS[a.id]) return CAP_LABELS[a.id]
  return a.label || a.id || a.domain || '能力'
}

function capDetail(a: CapAdapter): string {
  if (a.available && a.boundPath) {
    const name = a.boundPath.replace(/\\/g, '/').split('/').pop() || a.boundPath
    return `已找到 ${name}`
  }
  const pack = a.id ? CAP_DETAIL[a.id] : undefined
  if (pack) return a.available ? pack.on : pack.off
  if (a.detectMessage) return a.detectMessage
  return a.available ? '已就绪。' : '未就绪。'
}

function ingestCaps(raw: unknown[]): CapAdapter[] {
  return raw.map((item) => {
    const a = item as CapAdapter & { detect?: { message?: string; path?: string } }
    return {
      ...a,
      detectMessage: a.detectMessage || a.detect?.message,
      boundPath: a.boundPath || a.detect?.path,
    }
  })
}

function errText(err: unknown): string {
  if (!err) return '未知错误'
  if (typeof err === 'string') return err
  if (typeof err === 'object' && err && 'message' in err) {
    const msg = String((err as { message?: string }).message || '')
    if (msg) return msg
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function IndustrialWorkbench({ nav, onBack }: Props) {
  const meta = NAV_META[nav]
  const [caps, setCaps] = useState<CapAdapter[]>([])
  const [busy, setBusy] = useState(false)
  const [scanBusy, setScanBusy] = useState('')
  const [plcHelpOpen, setPlcHelpOpen] = useState(false)
  const [plcExplainOpen, setPlcExplainOpen] = useState(false)
  const [plcExplainTopic, setPlcExplainTopic] = useState('')
  const [status, setStatus] = useState('')
  const [gcWidth, setGcWidth] = useState(100)
  const [gcHeight, setGcHeight] = useState(50)
  const [gcDepth, setGcDepth] = useState(5)
  const [gcFeed, setGcFeed] = useState(300)
  const [gcSpindle, setGcSpindle] = useState(2000)
  const [gcToolDia, setGcToolDia] = useState(10)
  const [gcOp, setGcOp] = useState<
    'profile' | 'facing' | 'drill' | 'circular_profile' | 'peck_drill' | 'drill_cycle'
  >('profile')
  const [gcResult, setGcResult] = useState<{
    ncText?: string
    validation?: { ok?: boolean; errors?: { message?: string }[]; warnings?: { message?: string }[] }
    artifact?: { nc?: string }
    note?: string
  } | null>(null)
  const [toolpath, setToolpath] = useState<{
    segments?: {
      type?: string
      from?: { x: number; y: number; z: number }
      to?: { x: number; y: number; z: number }
      start?: { x: number; y: number; z: number }
      end?: { x: number; y: number; z: number }
      line?: number
    }[]
    bounds?: { x: number[]; y: number[]; z: number[] }
    tools?: string[]
  } | null>(null)
  const [analysis, setAnalysis] = useState<{
    stock?: { min?: { x: number; y: number; z: number }; max?: { x: number; y: number; z: number } }
    removal?: {
      nx?: number
      ny?: number
      cell?: number
      origin?: { x: number; y: number }
      zTop?: number
      zBottom?: number
      heights?: number[]
      removedVolumeApprox?: number
      remainingRatio?: number
    }
    collision?: { ok?: boolean; errors?: { message?: string; code?: string }[]; warnings?: { message?: string }[] }
    time?: { display?: string; breakdown?: Record<string, string> }
    explain?: { lines?: { line?: number; title?: string; summary?: string; raw?: string; detail?: string[] }[] }
    fixes?: { line?: number; code?: string; message?: string; original?: string; suggested?: string; apply?: boolean }[]
    reportMarkdown?: string
  } | null>(null)
  const [camTab, setCamTab] = useState<'process' | 'nc' | 'path' | 'sim' | 'check'>('process')
  const [simSession, setSimSession] = useState<Record<string, unknown> | null>(null)
  const [simPlaying, setSimPlaying] = useState(false)
  const playRef = useRef<number | null>(null)
  const [lastRun, setLastRun] = useState<{
    projectDir?: string
    reportPath?: string
    tree?: Record<string, string[]>
    note?: string
    packName?: string
    preview?: IndustrialPreview
  } | null>(null)
  const plcHelpAutoShown = useRef(false)
  const sampleRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const c = await samaClient.industrialListCapabilities()
    if (c.ok && Array.isArray(c.adapters)) {
      setCaps(ingestCaps(c.adapters))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, nav])

  useEffect(() => {
    if (nav !== 'plc' || plcHelpAutoShown.current || caps.length === 0) return
    const plcSoft = caps.find((a) => a.id === 'plc.null')
    if (plcSoft && !plcSoft.available) {
      plcHelpAutoShown.current = true
      setPlcHelpOpen(true)
    }
  }, [nav, caps])

  const domainCaps = meta.domain
    ? caps.filter((a) => String(a.domain || '').toLowerCase() === meta.domain)
    : caps.filter((a) => a.available)

  function applyCapResult(r: { adapters?: unknown[]; ok?: boolean; path?: string; error?: string; cancelled?: boolean; foundCount?: number }) {
    if (Array.isArray(r.adapters)) setCaps(ingestCaps(r.adapters))
    if (r.cancelled) return
    if (r.ok && r.path) {
      setStatus(`已找到：${r.path}`)
      return
    }
    if (typeof r.foundCount === 'number') {
      setStatus(r.foundCount > 0 ? `扫描完成，找到 ${r.foundCount} 个软件` : r.error || '常见位置没扫到，请手动添加安装目录')
      return
    }
    setStatus(r.error || '没找到对应软件，请换一个安装目录再试')
  }

  async function scanSoftware(adapterId?: string) {
    const ids = adapterId
      ? [adapterId]
      : domainCaps.filter((a) => a.bindable && !a.available && a.id).map((a) => String(a.id))
    if (!ids.length) {
      setStatus('这一页没有需要扫描的软件')
      return
    }
    const key = adapterId || '*'
    setScanBusy(key)
    setStatus('正在扫描本机常见安装位置…')
    try {
      let found = 0
      let lastPath = ''
      let lastError = ''
      let lastAdapters: unknown[] | undefined
      for (const id of ids) {
        const r = await samaClient.industrialScanSoftware({ adapterId: id })
        if (Array.isArray(r.adapters)) lastAdapters = r.adapters
        if (r.ok && r.path) {
          found += 1
          lastPath = r.path
        } else if (r.error) {
          lastError = r.error
        }
      }
      if (lastAdapters) setCaps(ingestCaps(lastAdapters))
      if (found) {
        setStatus(ids.length === 1 ? `已找到：${lastPath}` : `扫描完成，找到 ${found} 个软件`)
      } else {
        setStatus(lastError || '常见位置没扫到，请点「添加软件目录」手动指定')
      }
    } catch (e) {
      setStatus(`扫描失败：${errText(e)}`)
    } finally {
      setScanBusy('')
    }
  }

  async function pickSoftwareDir(adapterId: string) {
    setScanBusy(adapterId)
    setStatus('请选择软件安装目录…')
    try {
      const r = await samaClient.industrialPickSoftwareDir({ adapterId })
      if (r.cancelled) {
        setStatus('')
        return
      }
      applyCapResult(r)
    } catch (e) {
      setStatus(`添加目录失败：${errText(e)}`)
    } finally {
      setScanBusy('')
    }
  }

  async function runDomainSample() {
    if (!meta.domain) return
    setBusy(true)
    setStatus(`正在生成「${meta.title}」样例…`)
    try {
      const r = await samaClient.industrialRunWorkflow({
        workflowId: 'clamp_cylinder',
        name: `${meta.title}样例`,
        holdMs: 500,
        domains: [meta.domain],
      })
      if (!r.ok && !r.success) {
        setStatus(`失败：${errText(r.error)}`)
        setLastRun(null)
        return
      }
      setLastRun({
        projectDir: r.projectDir,
        reportPath: r.reportPath,
        tree: r.tree,
        note: r.note,
        packName: r.pack?.name,
        preview: r.preview as IndustrialPreview | undefined,
      })
      setStatus(r.note || '样例已生成，见下方展示')
      await refresh()
      requestAnimationFrame(() => {
        sampleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (e) {
      setStatus(`失败：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function openDir(dir?: string) {
    if (!dir) return
    const r = await samaClient.industrialOpenProjectDir({ projectDir: dir })
    if (!r.ok) setStatus(`无法打开目录：${r.error || ''}`)
  }

  async function runParametricGcode() {
    setBusy(true)
    setStatus('正在生成 G-code（GCodeIR → Post → 校验）…')
    setGcResult(null)
    setToolpath(null)
    setAnalysis(null)
    setSimSession(null)
    setSimPlaying(false)
    try {
      const stock = {
        type: 'box',
        min: { x: 0, y: 0, z: -Math.max(gcDepth + 5, 10) },
        max: { x: gcWidth, y: gcHeight, z: 0 },
      }
      const r = await samaClient.industrialGenerateGcode({
        params: {
          operation: gcOp,
          machine: 'FANUC',
          units: 'mm',
          width: gcWidth,
          height: gcHeight,
          depth: gcDepth,
          feed: gcFeed,
          spindle: gcSpindle,
          tool: { number: 1, diameter: gcToolDia, type: 'endmill' },
          programNumber: 1001,
          peck: Math.max(1, gcDepth / 4),
          lengthOffset: 1,
          stock: { x: gcWidth, y: gcHeight, z: Math.max(gcDepth + 5, 10) },
        },
        opts: { machineProfile: 'FANUC_0I_MF', write: true, runSimulation: true },
      })
      if (!r.ok && !r.success) {
        setStatus(`失败：${errText(r.error)}`)
        setGcResult({
          ncText: r.ncText,
          validation: r.validation as {
            ok?: boolean
            errors?: { message?: string }[]
            warnings?: { message?: string }[]
          },
        })
        setCamTab('check')
        return
      }
      setGcResult({
        ncText: r.ncText,
        validation: r.validation as {
          ok?: boolean
          errors?: { message?: string }[]
          warnings?: { message?: string }[]
        },
        artifact: r.artifact,
        note: r.note,
      })
      if (r.ncText) {
        const a = await samaClient.industrialAnalyzeNc({
          ncText: r.ncText,
          machineProfile: 'FANUC_0I_MF',
          stock,
          toolDiameter: gcToolDia,
        })
        if (a.ok) {
          setToolpath(a.toolpath || null)
          setSimSession((a.session as Record<string, unknown>) || null)
          setAnalysis({
            stock: a.stock as typeof analysis extends null ? never : NonNullable<typeof analysis>['stock'],
            removal: a.removal as NonNullable<typeof analysis>['removal'],
            collision: a.collision,
            time: a.time,
            explain: a.explain,
            fixes: a.fixes,
            reportMarkdown: a.reportMarkdown,
          })
          setCamTab('sim')
        }
      }
      setStatus(r.note || '已生成并分析')
    } catch (e) {
      setStatus(`失败：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function applyAllFixes() {
    if (!gcResult?.ncText || !analysis?.fixes?.length) return
    setBusy(true)
    try {
      const r = await samaClient.industrialApplyNcFixes({
        ncText: gcResult.ncText,
        fixes: analysis.fixes,
        machineProfile: 'FANUC_0I_MF',
        toolDiameter: gcToolDia,
        stock: analysis.stock,
      })
      if (!r.ok || !r.ncText) {
        setStatus(`修复失败：${errText(r.error)}`)
        return
      }
      setGcResult((prev) => ({ ...prev, ncText: r.ncText }))
      const a = r.analysis as {
        ok?: boolean
        toolpath?: typeof toolpath
        session?: unknown
        stock?: unknown
        removal?: unknown
        collision?: typeof analysis extends null ? never : NonNullable<typeof analysis>['collision']
        time?: typeof analysis extends null ? never : NonNullable<typeof analysis>['time']
        explain?: typeof analysis extends null ? never : NonNullable<typeof analysis>['explain']
        fixes?: typeof analysis extends null ? never : NonNullable<typeof analysis>['fixes']
        reportMarkdown?: string
        validation?: typeof gcResult extends null ? never : NonNullable<typeof gcResult>['validation']
      }
      if (a?.toolpath) setToolpath(a.toolpath)
      if (a?.session) setSimSession(a.session as Record<string, unknown>)
      setAnalysis({
        stock: a.stock as NonNullable<typeof analysis>['stock'],
        removal: a.removal as NonNullable<typeof analysis>['removal'],
        collision: a.collision,
        time: a.time,
        explain: a.explain,
        fixes: a.fixes,
        reportMarkdown: a.reportMarkdown,
      })
      if (a.validation) {
        setGcResult((prev) => ({ ...prev, ncText: r.ncText, validation: a.validation }))
      }
      setStatus('已应用修复并重新分析')
    } catch (e) {
      setStatus(`修复失败：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const stopPlay = useCallback(() => {
    setSimPlaying(false)
    if (playRef.current) {
      window.clearInterval(playRef.current)
      playRef.current = null
    }
  }, [])

  useEffect(() => () => stopPlay(), [stopPlay])

  async function simStepOnce() {
    if (!simSession) return
    const r = await samaClient.industrialSimStep({ session: simSession })
    if (r.ok && r.session) {
      setSimSession(r.session as Record<string, unknown>)
      const st = (r.session as { state?: { done?: boolean; error?: unknown } }).state
      if (st?.done || st?.error) stopPlay()
    }
  }

  async function simReset() {
    stopPlay()
    if (!simSession) return
    const r = await samaClient.industrialSimReset({ session: simSession })
    if (r.ok && r.session) setSimSession(r.session as Record<string, unknown>)
  }

  function simPlay() {
    if (!simSession || simPlaying) return
    setSimPlaying(true)
    playRef.current = window.setInterval(() => {
      void simStepOnce()
    }, 120)
  }

  const simState = (simSession?.state || null) as {
    x?: number
    y?: number
    z?: number
    feed?: number
    spindle?: number
    sourceLine?: number
    raw?: string
    done?: boolean
    error?: { message?: string }
  } | null

  const treeEntries = lastRun?.tree
    ? Object.entries(lastRun.tree).filter(([, files]) => files.length > 0)
    : []

  return (
    <div className="industrial-workbench">
      <div className="iw-header">
        <h1>{meta.title}</h1>
        <div className="iw-row">
          {onBack ? (
            <button type="button" className="ghost-btn" onClick={onBack}>
              返回对话
            </button>
          ) : null}
          {nav === 'plc' ? (
            <>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setPlcExplainTopic('')
                  setPlcExplainOpen(true)
                }}
              >
                说明
              </button>
              <button type="button" className="primary-btn" onClick={() => setPlcHelpOpen(true)}>
                PLC 助手
              </button>
            </>
          ) : null}
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </div>

      {nav === 'cam' ? (
        <>
          <section className="iw-card">
            <h2>加工</h2>
            <div className="iw-row iw-tabs">
              {(
                [
                  ['process', '工艺'],
                  ['nc', 'NC'],
                  ['path', '刀路'],
                  ['sim', '仿真'],
                  ['check', '检查'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`ghost-btn${camTab === id ? ' iw-tab-active' : ''}`}
                  onClick={() => setCamTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {camTab === 'process' && (
            <section className="iw-card">
              <h2>工艺参数</h2>
              <div className="iw-row">
                <label className="iw-field">
                  类型
                  <select
                    value={gcOp}
                    disabled={busy}
                    onChange={(e) => setGcOp(e.target.value as typeof gcOp)}
                  >
                    <option value="profile">矩形轮廓</option>
                    <option value="facing">端面铣</option>
                    <option value="drill">钻孔(直线)</option>
                    <option value="drill_cycle">G81 钻孔循环</option>
                    <option value="peck_drill">G83 深孔循环</option>
                    <option value="circular_profile">圆形轮廓</option>
                  </select>
                </label>
                <label className="iw-field">
                  宽 (mm)
                  <input type="number" value={gcWidth} disabled={busy} onChange={(e) => setGcWidth(Number(e.target.value) || 0)} />
                </label>
                <label className="iw-field">
                  高 (mm)
                  <input type="number" value={gcHeight} disabled={busy} onChange={(e) => setGcHeight(Number(e.target.value) || 0)} />
                </label>
                <label className="iw-field">
                  深 (mm)
                  <input type="number" value={gcDepth} disabled={busy} onChange={(e) => setGcDepth(Number(e.target.value) || 0)} />
                </label>
                <label className="iw-field">
                  刀径
                  <input type="number" value={gcToolDia} disabled={busy} onChange={(e) => setGcToolDia(Number(e.target.value) || 1)} />
                </label>
                <label className="iw-field">
                  F
                  <input type="number" value={gcFeed} disabled={busy} onChange={(e) => setGcFeed(Number(e.target.value) || 1)} />
                </label>
                <label className="iw-field">
                  S
                  <input type="number" value={gcSpindle} disabled={busy} onChange={(e) => setGcSpindle(Number(e.target.value) || 1)} />
                </label>
              </div>
              <div className="iw-row">
                <button
                  type="button"
                  className="primary-btn iw-run"
                  disabled={busy}
                  onClick={() => void runParametricGcode()}
                >
                  {busy ? '生成中…' : '生成并分析'}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => void runDomainSample()}
                >
                  CAM 工作流样例
                </button>
              </div>
            </section>
          )}

          {camTab === 'nc' && (
            <section className="iw-card">
              <h2>NC 程序</h2>
              {!gcResult?.ncText ? (
                <p className="iw-muted">请先在「工艺」生成程序。</p>
              ) : (
                <>
                  <p className="iw-muted">
                    校验：{gcResult.validation?.ok ? '通过' : '未通过'}
                    {gcResult.artifact?.nc ? ` · ${gcResult.artifact.nc}` : ''}
                    {analysis?.time?.display ? ` · 预计 ${analysis.time.display}` : ''}
                  </p>
                  <pre className="iw-pre iw-nc">{gcResult.ncText}</pre>
                  {analysis?.explain?.lines && analysis.explain.lines.length > 0 && (
                    <div className="iw-explain">
                      <h3>逐行解释</h3>
                      <ul className="iw-explain-list">
                        {analysis.explain.lines.slice(0, 80).map((l, i) => (
                          <li key={`${l.line}-${i}`}>
                            <span className="iw-explain-n">N{l.line}</span>
                            <span className="iw-explain-body">
                              <span className="iw-explain-title">{l.title || l.summary}</span>
                              {l.raw ? <span className="iw-explain-raw">{l.raw}</span> : null}
                              {l.detail && l.detail.length > 0 ? (
                                <span className="iw-explain-raw">{l.detail.join(' · ')}</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {(camTab === 'path' || camTab === 'sim') && gcResult?.ncText && (
            <section className="iw-card">
              <h2>{camTab === 'sim' ? '仿真' : '刀路 / 材料去除'}</h2>
              <div className="iw-row">
                <NcToolpathPreview
                  segments={toolpath?.segments || []}
                  bounds={toolpath?.bounds}
                  stock={analysis?.stock}
                  removal={camTab === 'path' || camTab === 'sim' ? analysis?.removal : null}
                  currentLine={simState?.sourceLine ?? null}
                  toolPos={
                    simState
                      ? { x: simState.x || 0, y: simState.y || 0, z: simState.z || 0 }
                      : null
                  }
                />
                {camTab === 'sim' && (
                  <div className="iw-sim-panel">
                    <div className="iw-row">
                      <button type="button" className="ghost-btn" disabled={!simSession || busy} onClick={() => simPlay()}>
                        ▶
                      </button>
                      <button type="button" className="ghost-btn" disabled={!simPlaying} onClick={() => stopPlay()}>
                        ⏸
                      </button>
                      <button type="button" className="ghost-btn" disabled={!simSession || busy} onClick={() => void simStepOnce()}>
                        ⏭
                      </button>
                      <button type="button" className="ghost-btn" disabled={!simSession || busy} onClick={() => void simReset()}>
                        ↻
                      </button>
                    </div>
                    <p className="iw-muted">
                      当前行：N{simState?.sourceLine ?? '—'}
                      <br />
                      X：{(simState?.x ?? 0).toFixed?.(3) ?? '—'}
                      <br />
                      Y：{(simState?.y ?? 0).toFixed?.(3) ?? '—'}
                      <br />
                      Z：{(simState?.z ?? 0).toFixed?.(3) ?? '—'}
                      <br />
                      F：{simState?.feed ?? '—'} · S：{simState?.spindle ?? '—'}
                    </p>
                    {analysis?.time && (
                      <p className="iw-muted">
                        预计 {analysis.time.display}
                        {analysis.time.breakdown?.cutting
                          ? `（切削 ${analysis.time.breakdown.cutting}）`
                          : ''}
                      </p>
                    )}
                    {analysis?.removal && (
                      <p className="iw-muted">
                        去除约 {analysis.removal.removedVolumeApprox?.toFixed?.(0)} mm³ · 剩余{' '}
                        {((analysis.removal.remainingRatio || 0) * 100).toFixed(0)}%
                      </p>
                    )}
                    {simState?.error && <p className="iw-status bad">{simState.error.message}</p>}
                    {simState?.done && !simState?.error && <p className="iw-muted">仿真结束</p>}
                  </div>
                )}
              </div>
              {camTab === 'path' && (
                <p className="iw-muted">
                  段数 {toolpath?.segments?.length ?? 0}
                  {toolpath?.tools?.length ? ` · 刀具 ${toolpath.tools.join(',')}` : ''}
                </p>
              )}
            </section>
          )}

          {(camTab === 'path' || camTab === 'sim') && !gcResult?.ncText && (
            <section className="iw-card">
              <p className="iw-muted">请先在「工艺」生成程序。</p>
            </section>
          )}

          {camTab === 'check' && (
            <section className="iw-card">
              <h2>检查 / 修复 / 报告</h2>
              {!gcResult && !analysis ? (
                <p className="iw-muted">请先在「工艺」生成程序。</p>
              ) : (
                <>
                  <p className="iw-muted">
                    语法：{gcResult?.validation?.ok ? '✓' : '✕'} · 碰撞：
                    {analysis?.collision?.ok ? '✓' : '✕'} · 时间：{analysis?.time?.display || '—'}
                  </p>
                  {(gcResult?.validation?.warnings?.length || 0) > 0 && (
                    <ul className="iw-cap-list">
                      {gcResult!.validation!.warnings!.slice(0, 8).map((w, i) => (
                        <li key={`vw${i}`}>⚠ {w.message}</li>
                      ))}
                    </ul>
                  )}
                  {(gcResult?.validation?.errors?.length || 0) > 0 && (
                    <ul className="iw-cap-list">
                      {gcResult!.validation!.errors!.slice(0, 8).map((w, i) => (
                        <li key={`ve${i}`}>✕ {w.message}</li>
                      ))}
                    </ul>
                  )}
                  {(analysis?.collision?.errors?.length || 0) > 0 && (
                    <ul className="iw-cap-list">
                      {analysis!.collision!.errors!.slice(0, 8).map((w, i) => (
                        <li key={`ce${i}`}>✕ [{w.code}] {w.message}</li>
                      ))}
                    </ul>
                  )}
                  {(analysis?.collision?.warnings?.length || 0) > 0 && (
                    <ul className="iw-cap-list">
                      {analysis!.collision!.warnings!.slice(0, 8).map((w, i) => (
                        <li key={`cw${i}`}>⚠ {w.message}</li>
                      ))}
                    </ul>
                  )}
                  {(analysis?.fixes?.length || 0) > 0 && (
                    <>
                      <h3>AI 修复建议</h3>
                      <ul className="iw-cap-list">
                        {analysis!.fixes!.slice(0, 10).map((f, i) => (
                          <li key={`fx${i}`}>
                            {f.message}
                            <br />
                            <span className="iw-muted">{f.suggested}</span>
                          </li>
                        ))}
                      </ul>
                      <button type="button" className="primary-btn" disabled={busy} onClick={() => void applyAllFixes()}>
                        应用修复并重新分析
                      </button>
                    </>
                  )}
                  {analysis?.reportMarkdown && (
                    <>
                      <h3>加工报告</h3>
                      <pre className="iw-pre iw-nc">{analysis.reportMarkdown.slice(0, 4000)}</pre>
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="iw-card">
          <h2>{meta.title}能力</h2>
          <ul className="iw-cap-list">
            {domainCaps.length === 0 && <li className="iw-muted">暂无可用适配器（请确认桌面版已启动）</li>}
            {domainCaps.map((a) => (
              <li key={a.id || `${a.domain}-${a.level}`} className="iw-cap-item">
                <div className="iw-cap-row">
                  <strong>{capName(a)}</strong>
                  <span className={a.available ? 'iw-cap-ok' : 'iw-cap-off'}>
                    {a.available ? '可用' : '不可用'}
                  </span>
                </div>
                <p className="iw-muted">{capDetail(a)}</p>
                {a.bindable && !a.available ? (
                  <div className="iw-row iw-cap-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy || Boolean(scanBusy)}
                      onClick={() => void scanSoftware(a.id)}
                    >
                      {scanBusy === a.id ? '扫描中…' : '扫描软件'}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy || Boolean(scanBusy)}
                      onClick={() => a.id && void pickSoftwareDir(a.id)}
                    >
                      添加软件目录
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {domainCaps.some((a) => a.bindable && !a.available) ? (
            <div className="iw-row" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy || Boolean(scanBusy)}
                onClick={() => void scanSoftware()}
              >
                {scanBusy === '*' ? '扫描中…' : '扫描本页未找到的软件'}
              </button>
            </div>
          ) : null}
          <div className="iw-row">
            {nav === 'plc' ? (
              <>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setPlcExplainTopic('')
                    setPlcExplainOpen(true)
                  }}
                >
                  说明
                </button>
                <button type="button" className="ghost-btn" onClick={() => setPlcHelpOpen(true)}>
                  PLC 助手
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="primary-btn iw-run"
              disabled={busy}
              onClick={() => void runDomainSample()}
            >
              {busy ? '生成中…' : `生成「${meta.title}」样例`}
            </button>
          </div>
        </section>
      )}

      {status && (
        <div className={`iw-status${/失败/.test(status) ? ' bad' : ''}`} role="status">
          {status}
        </div>
      )}

      {lastRun?.preview ? (
        <div ref={sampleRef}>
          <IndustrialSampleView
            preview={lastRun.preview}
            projectDir={lastRun.projectDir}
            onOpenDir={(dir) => void openDir(dir)}
            onExplain={
              nav === 'plc'
                ? () => {
                    setPlcExplainTopic('sample')
                    setPlcExplainOpen(true)
                  }
                : undefined
            }
          />
        </div>
      ) : lastRun?.projectDir ? (
        <section className="iw-card">
          <h2>最近工程包</h2>
          <p>
            <strong>{lastRun.packName || '工程'}</strong>
          </p>
          <p className="iw-path" title={lastRun.projectDir}>
            {lastRun.projectDir}
          </p>
          <div className="iw-row">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void openDir(lastRun.projectDir)}
            >
              打开工程文件夹
            </button>
          </div>
          {treeEntries.length > 0 && (
            <div className="iw-tree">
              {treeEntries.map(([folder, files]) => (
                <div key={folder} className="iw-tree-folder">
                  <div className="iw-tree-name">{folder}/</div>
                  <ul>
                    {files.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {plcHelpOpen ? (
        <PlcHelpModal
          onClose={() => setPlcHelpOpen(false)}
          onBound={() => void refresh()}
        />
      ) : null}
      {plcExplainOpen ? (
        <PlcExplainModal
          topic={plcExplainTopic}
          onClose={() => setPlcExplainOpen(false)}
          onOpenHelper={() => setPlcHelpOpen(true)}
        />
      ) : null}
    </div>
  )
}

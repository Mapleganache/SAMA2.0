/**
 * 出图前/出图后与 PDF 正确答案对照；明显接线错误则拒画。
 */
import { lintElecDocs } from './elecLint.mjs'
import {
  verifyLogicAgainstPdf,
  extractPdfMotorChains,
  extractPdfPowerTags,
  formatLogicVerifyReport,
} from './elecLogicVerify.mjs'

const PHASE_RAIL_Y = { R: 20, S: 26, T: 32, PE: 38 }

function isMotorPage(doc) {
  if (doc.page?.kind === 'motor') return true
  const title = String(doc.page?.title || '')
  return /电机/.test(title) || /主回路2/.test(title)
}

function isPowerPage(doc) {
  if (doc.page?.kind === 'power') return true
  return /主回路1|电源/.test(String(doc.page?.title || ''))
}

/** 出图前：逻辑 + 接线数据是否具备正确画法条件 */
export function validateDrawReady(docs, pdfReferenceText = '') {
  const linted = lintElecDocs(docs, { pdfReferenceText, mode: 'connectivity' })
  const errors = [...(linted.errors || [])]
  const warnings = []

  for (const doc of docs || []) {
    if (!isMotorPage(doc)) continue
    const railIds = new Set((doc.rails || []).map((r) => String(r.id || '').toUpperCase()))
    const hasRST = railIds.has('R') && railIds.has('S') && railIds.has('T')

    for (const col of doc.columns || []) {
      const devs = col.devices || []
      if (!devs.length) continue
      const first = devs[0]
      const wi = (first.wiresIn || []).map(String)
      const is3PhaseHead =
        first.sym === 'breaker3' ||
        (wi.length >= 3 && (wi.includes('R') || /^[RST]\d*$/i.test(wi[0] || '')))

      if (is3PhaseHead && hasRST) {
        if (!wi.includes('R') || !wi.includes('S') || !wi.includes('T')) {
          errors.push(
            `电机页列 ${col.i}「${first.tag}」：三相断路器 wiresIn 必须含 R,S,T（不能只有中间线号或 PE）`,
          )
        }
      }

      for (let i = 0; i < devs.length - 1; i++) {
        const a = devs[i]
        const b = devs[i + 1]
        const out = (a.wiresOut || []).filter(Boolean)
        const inw = (b.wiresIn || []).filter(Boolean)
        if (out.length >= 3 && inw.length >= 3 && out.length === inw.length) {
          const mismatch = out.filter((w, j) => inw[j] && w !== inw[j])
          if (mismatch.length === out.length) {
            warnings.push(
              `列 ${col.i}：${a.tag}→${b.tag} 线号名不完全一致（${out.join('/')} → ${inw.join('/')}），请核对`,
            )
          }
        } else if (out.length && inw.length && out.length !== inw.length) {
          errors.push(
            `列 ${col.i}：${a.tag}→${b.tag} 连线数不一致（出 ${out.length} / 入 ${inw.length}）`,
          )
        }
      }

      const chain = devs.map((d) => d.tag).join('→')
      if (/Q\d|KM\d|\dQ\d/i.test(chain) && devs.length < 3) {
        warnings.push(`列 ${col.i}：电机链仅 ${devs.length} 个元件（${chain}），可能缺 KM 或 M`)
      }
    }
  }

  let logicVerify = null
  if (pdfReferenceText) {
    logicVerify = verifyLogicAgainstPdf(docs, pdfReferenceText)
    if (!logicVerify.ok) {
      errors.push(`与 PDF 正确答案不一致：${logicVerify.summary?.motorCoveragePct != null ? `电机链覆盖 ${logicVerify.summary.motorCoveragePct}%` : '逻辑对照失败'}`)
      for (const e of logicVerify.logicErrors || []) errors.push(e)
      for (const e of logicVerify.motorChainIssues || []) errors.push(e)
    }
  } else {
    warnings.push('无 PDF 对照文本，仅做结构校验')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    linted,
    logicVerify,
    logicVerifyText: logicVerify ? formatLogicVerifyReport(logicVerify) : '',
  }
}

/** 出图后：SVG 是否把三相接到 R/S/T（而非只接 PE） */
export function auditSvgPhaseWiring(svgPages, docs) {
  const errors = []
  const pages = []

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    if (!isMotorPage(doc)) continue
    const svg = String((Array.isArray(svgPages) ? svgPages[i] : svgPages) || '')
    if (!svg) {
      errors.push(`电机页「${doc.page?.title || i + 1}」：无 SVG`)
      continue
    }

    const countY = (y) => (svg.match(new RegExp(`y1="${y}"`, 'g')) || []).length
    const fromR = countY(PHASE_RAIL_Y.R)
    const fromS = countY(PHASE_RAIL_Y.S)
    const fromT = countY(PHASE_RAIL_Y.T)
    const peDrops = (svg.match(/y1="38"[^>]*class="drop"/g) || []).length

    const motorCols = (doc.columns || []).filter((col) =>
      (col.devices || []).some((d) => d.sym === 'breaker3' || /^(\d)?Q\d+/i.test(d.tag || '')),
    )
    const needPhaseDrops = motorCols.length * 3

    const phaseDrops = fromR + fromS + fromT
    const stat = {
      pageTitle: doc.page?.title || '',
      motorColumns: motorCols.length,
      needPhaseDrops,
      fromR,
      fromS,
      fromT,
      phaseDrops,
      peDrops,
    }
    pages.push(stat)

    if (needPhaseDrops > 0 && phaseDrops < needPhaseDrops) {
      errors.push(
        `电机页「${stat.pageTitle}」：R/S/T 引线 ${phaseDrops} 条，期望 ≥${needPhaseDrops}（${fromR}/${fromS}/${fromT}）`,
      )
    }
    if (needPhaseDrops > 0 && phaseDrops === 0 && peDrops > 0) {
      errors.push(`电机页「${stat.pageTitle}」：只接了 PE 地线，未接 R/S/T（旧版渲染 bug）`)
    }
    if (needPhaseDrops > 0 && peDrops >= motorCols.length && phaseDrops < needPhaseDrops) {
      errors.push(`电机页「${stat.pageTitle}」：误用 PE 作进线（${peDrops} 条 PE 引线）`)
    }
  }

  return { ok: errors.length === 0, errors, pages }
}

/** SAMA 全流程对照 PDF 正确答案 */
export function compareSamaToReference(docs, pdfReferenceText, svgPages) {
  const pre = validateDrawReady(docs, pdfReferenceText)
  const wire = auditSvgPhaseWiring(svgPages, docs)

  const pdfChains = pdfReferenceText ? extractPdfMotorChains(pdfReferenceText) : []
  const pdfPower = pdfReferenceText ? extractPdfPowerTags(pdfReferenceText) : new Set()

  const exportedChains = pre.logicVerify?.exportedChains || []
  const missingChains = (pre.logicVerify?.motorChainIssues || []).slice(0, 20)

  return {
    ok: pre.ok && wire.ok,
    preDraw: {
      ok: pre.ok,
      errors: pre.errors,
      warnings: pre.warnings,
      logicSummary: pre.logicVerify?.summary,
    },
    postDraw: wire,
    reference: {
      pdfMotorChains: pdfChains.map((c) => `${c.q}→${c.km}→${c.motor}`),
      pdfPowerTagCount: pdfPower.size,
      samaExportedChains: exportedChains.map((c) => c.chain),
      chainMatch: pre.logicVerify?.ok ?? false,
      missingChains,
    },
    logicVerifyText: pre.logicVerifyText,
  }
}

export function formatCompareReport(cmp) {
  const lines = []
  lines.push(cmp.ok ? '✓ SAMA 与 PDF 正确答案一致，可出图' : '✗ 对照未通过，不应出图')
  if (cmp.reference?.pdfMotorChains?.length) {
    lines.push(`PDF 电机链：${cmp.reference.pdfMotorChains.join(' | ')}`)
  }
  if (cmp.reference?.samaExportedChains?.length) {
    lines.push(`SAMA 导出链：${cmp.reference.samaExportedChains.join(' | ')}`)
  }
  if (cmp.preDraw.errors?.length) {
    lines.push('出图前错误：')
    cmp.preDraw.errors.slice(0, 12).forEach((e) => lines.push(`  - ${e}`))
  }
  if (cmp.postDraw.errors?.length) {
    lines.push('出图后 SVG 接线错误：')
    cmp.postDraw.errors.forEach((e) => lines.push(`  - ${e}`))
  }
  if (cmp.postDraw.pages?.length) {
    for (const p of cmp.postDraw.pages) {
      lines.push(
        `  [${p.pageTitle}] 列${p.motorColumns} R/S/T引线 ${p.fromR}/${p.fromS}/${p.fromT}（需≥${p.needPhaseDrops}） PE引线${p.peDrops}`,
      )
    }
  }
  return lines.join('\n')
}

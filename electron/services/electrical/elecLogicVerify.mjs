/**
 * 检测导出的连通性/elec-json 是否与 PDF 原图逻辑一致。
 * 对照来源：PDF 抽出文本（EPLAN 导出），不是像素识图。
 */
import { splitSchematicPages } from './readSchematic.mjs'
import { findContentPage, parsePowerPageDevices, parseMikrosaPower1Columns, ratingNearTag } from './elecPdfParse.mjs'
import { motorCircuitsFromPdf } from './elecPdfBrief.mjs'
import { extractJsonReference } from './elecPdfRef.mjs'
import { buildWireNets } from './elecConnectivity.mjs'
import { lintElecDocs } from './elecLint.mjs'

function normTag(t) {
  return String(t || '').trim().toUpperCase()
}

/** 从 PDF 文本提取位号（含 MIKROSA 1Q1、3K1 等） */
export function extractPdfDeviceTags(pdfText) {
  const src = String(pdfText || '')
  const tags = new Set()
  const patterns = [
    /\b(\d[QKM]\d+)\b/gi,
    /\b(\dF\d+)\b/gi,
    /\b(1A\d)\b/gi,
    /\b(T\d)\b/g,
    /\b(Q\d{1,3})\b/g,
    /\b(KM\d{1,3})\b/gi,
    /\b(KA\d{1,3})\b/gi,
    /\b(M\d+)\b/gi,
    /\b(BISV[\w/-]*)/gi,
    /\b(COP\d+[A-Z]?)\b/gi,
  ]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const t = normTag(m[1] || m[0])
      if (t.length >= 2 && t.length <= 14) tags.add(t)
    }
  }
  return tags
}

/** PDF 中同页邻近出现的电机链路 Q→K→M */
export function extractPdfMotorChains(pdfText) {
  const pages = splitSchematicPages(String(pdfText || ''))
  const chains = []
  const motorPages = pages.filter((p) => /主回路2|电机|冷却|润滑|YLT[\s\t]+电机/i.test(p.body))
  for (const page of motorPages) {
    const body = page.body
    for (const m of body.matchAll(/\b(\d)Q(\d+)\b/g)) {
      const prefix = m[1]
      const n = m[2]
      const q = `${prefix}Q${n}`.toUpperCase()
      const idx = m.index ?? 0
      const block = body.slice(idx, idx + 420)
      let km = new RegExp(`\\b${prefix}K${n}\\b`, 'i').test(body) ? `${prefix}K${n}`.toUpperCase() : ''
      let motor = new RegExp(`\\b${prefix}M${n}\\b`, 'i').test(body) ? `${prefix}M${n}`.toUpperCase() : ''
      if (!km) {
        const kMatch = block.match(new RegExp(`\\b${prefix}K(\\d+)\\b`, 'i'))
        if (kMatch) km = `${prefix}K${kMatch[1]}`.toUpperCase()
      }
      if (!motor) {
        const mMatch = block.match(new RegExp(`\\b${prefix}M(\\d+)\\b`, 'i'))
        if (mMatch) motor = `${prefix}M${mMatch[1]}`.toUpperCase()
      }
      if (q) chains.push({ page: page.title || '', q, km, motor, style: 'mikrosa' })
    }
    for (const m of body.matchAll(/\bQ(2\d)\b/g)) {
      const n = m[1]
      const q = `Q${n}`
      const idx = m.index ?? 0
      const nextQ = body.indexOf(`Q${Number(n) + 1}`, idx + 1)
      const end = nextQ > idx ? nextQ : idx + 380
      const block = body.slice(idx, end)
      const km = block.match(/\bKM(\d+)\b/i)?.[0]?.toUpperCase() || `KM${n}`
      let motor = ''
      const motorM = block.match(/-M(\d+)/)
      if (motorM) motor = `M${motorM[1]}`
      else {
        const u = block.match(/\bU(\d+)\b/)
        if (u) motor = `M${u[1]}`
      }
      chains.push({ page: page.title || '', q, km, motor, style: 'favretto' })
    }
  }
  const seen = new Set()
  return chains.filter((c) => {
    const key = c.q
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** PDF 主回路/电源页应出现的位号 */
export function extractPdfPowerTags(pdfText) {
  const pages = splitSchematicPages(String(pdfText || ''))
  const powerPage = findContentPage(pages, /主回路1|电源/)
  const body = powerPage?.body || ''
  const tags = new Set()
  const fav = parsePowerPageDevices(body)
  for (const d of fav) tags.add(normTag(d.tag))
  const mik = parseMikrosaPower1Columns(body)
  for (const col of mik) {
    for (const d of col.devices || []) tags.add(normTag(d.tag))
  }
  if (!tags.size) {
    for (const m of body.matchAll(/\b(\d[QKM]\d+|\dF\d+|1A\d|T\d)\b/gi)) {
      tags.add(normTag(m[1]))
    }
  }
  return tags
}

function chainsFromDocs(docs) {
  const out = []
  for (const doc of docs || []) {
    const title = doc.page?.title || ''
    for (const col of doc.columns || []) {
      const devs = (col.devices || []).filter((d) => d?.tag)
      if (devs.length < 2) continue
      const tags = devs.map((d) => normTag(d.tag))
      const q = tags.find((t) => /Q\d+$/i.test(t) || /^\dQ\d+$/i.test(t))
      const km = tags.find((t) => /^KM\d+$/i.test(t) || /^\dK\d+$/i.test(t))
      const motor = tags.find((t) => /^M\d+$/i.test(t) || /^\dM\d+$/i.test(t))
      if (q) out.push({ page: title, q, km: km || '', motor: motor || '', chain: tags.join('→') })
    }
  }
  return out
}

function ratingMismatches(docs, pdfText) {
  const pages = splitSchematicPages(String(pdfText || ''))
  const powerBody = findContentPage(pages, /主回路1|电源/)?.body || ''
  const mism = []
  for (const doc of docs || []) {
    if (!/主回路1|电源/.test(String(doc.page?.title || ''))) continue
    for (const col of doc.columns || []) {
      for (const d of col.devices || []) {
        const tag = d.tag
        if (!tag) continue
        const pdfRating = ratingNearTag(powerBody, tag)
        const jsonRating = String(d.rating || '').replace(/\s+/g, '')
        if (pdfRating && jsonRating && !jsonRating.includes(pdfRating.replace(/\s+/g, ''))) {
          mism.push({
            tag,
            pdf: pdfRating,
            json: jsonRating,
            msg: `${tag} 额定：PDF=${pdfRating}，导出=${jsonRating}`,
          })
        }
      }
    }
  }
  return mism
}

/**
 * 完整对照报告：位号覆盖、电机链路、列内逻辑、lint
 */
export function verifyLogicAgainstPdf(docs, pdfText) {
  const list = Array.isArray(docs) ? docs : []
  const text = String(pdfText || '')
  const jsonRef = extractJsonReference(list)
  const pdfPowerTags = extractPdfPowerTags(text)
  const pdfMotorChains = extractPdfMotorChains(text)
  const pdfMotorCircuits = motorCircuitsFromPdf(text)
  const docChains = chainsFromDocs(list)
  const lint = lintElecDocs(list, { pdfReferenceText: text, mode: 'connectivity' })

  const missingPower = [...pdfPowerTags].filter((t) => !jsonRef.tags.has(t))
  const extraTags = [...jsonRef.tags].filter(
    (t) =>
      /^(Q|KM|M|\d[QKM])\d*/i.test(t) &&
      !extractPdfDeviceTags(text).has(t) &&
      !/^MSP/i.test(t),
  )

  const motorChainIssues = []
  for (const exp of pdfMotorChains) {
    const docChain = docChains.find((c) => c.q === exp.q)
    if (!docChain) {
      motorChainIssues.push(`PDF 有电机链路 ${exp.q}，导出中未找到对应列`)
      continue
    }
    if (exp.motor && docChain.motor && exp.motor !== docChain.motor) {
      motorChainIssues.push(`PDF ${exp.q} 电机 ${exp.motor}，导出为 ${docChain.motor}`)
    }
    if (exp.km && !docChain.km) {
      motorChainIssues.push(`PDF ${exp.q} 有接触器 ${exp.km}，导出列缺 KM`)
    }
  }

  const pdfQFromMotor = new Set(pdfMotorCircuits.map((c) => normTag(c.q)))
  for (const q of pdfQFromMotor) {
    if (!jsonRef.tags.has(q)) {
      motorChainIssues.push(`PDF 电机回路缺位号 ${q}`)
    }
  }

  const ratingIssues = ratingMismatches(list, text)
  const nets = buildWireNets(list)
  const brokenCols = (lint.errors || []).filter((e) =>
    /断路|未衔接|不一致|不足 3 段/.test(e),
  )

  const tagCoverage =
    pdfPowerTags.size
      ? [...pdfPowerTags].filter((t) => jsonRef.tags.has(t)).length / pdfPowerTags.size
      : 1
  const motorCoverage =
    pdfMotorChains.length
      ? pdfMotorChains.filter((c) => docChains.some((d) => d.q === c.q)).length / pdfMotorChains.length
      : 1

  const ok =
    missingPower.length === 0 &&
    motorChainIssues.length === 0 &&
    brokenCols.length === 0 &&
    ratingIssues.length === 0 &&
    (lint.errors || []).length === 0

  return {
    ok,
    summary: {
      pdfPowerTagCount: pdfPowerTags.size,
      pdfMotorChainCount: pdfMotorChains.length,
      exportedTagCount: jsonRef.tags.size,
      exportedChainCount: docChains.length,
      wireNetCount: nets.size,
      tagCoveragePct: Math.round(tagCoverage * 100),
      motorCoveragePct: Math.round(motorCoverage * 100),
    },
    missingPowerTags: missingPower.sort(),
    extraTags: extraTags.slice(0, 30),
    motorChainIssues,
    ratingIssues,
    logicErrors: brokenCols,
    lintErrors: lint.errors || [],
    pdfMotorChains,
    exportedChains: docChains,
    notes: [
      '对照基于 PDF 文本层（EPLAN 导出），纯扫描图无文字时无法自动对照。',
      '连通性模式已跳过「缺 I/O 地址」类 PDF 差异。',
    ],
  }
}

export function formatLogicVerifyReport(report) {
  if (!report) return ''
  const lines = []
  lines.push(report.ok ? '✓ 逻辑电路与 PDF 文本对照通过' : '✗ 逻辑电路与 PDF 文本存在差异')
  lines.push(
    `电源位号覆盖 ${report.summary?.tagCoveragePct ?? 0}% · 电机链路覆盖 ${report.summary?.motorCoveragePct ?? 0}%`,
  )
  if (report.missingPowerTags?.length) {
    lines.push(`缺少电源/主回路位号：${report.missingPowerTags.join(', ')}`)
  }
  if (report.motorChainIssues?.length) {
    lines.push('电机链路：')
    report.motorChainIssues.slice(0, 12).forEach((e) => lines.push(`  - ${e}`))
  }
  if (report.ratingIssues?.length) {
    lines.push('额定值：')
    report.ratingIssues.forEach((r) => lines.push(`  - ${r.msg}`))
  }
  if (report.logicErrors?.length) {
    lines.push('列内逻辑：')
    report.logicErrors.slice(0, 8).forEach((e) => lines.push(`  - ${e}`))
  }
  if (report.lintErrors?.length && !report.ok) {
    lines.push('校验：')
    report.lintErrors.slice(0, 6).forEach((e) => lines.push(`  - ${e}`))
  }
  return lines.join('\n')
}

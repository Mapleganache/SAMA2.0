/**
 * 出图前校验：只检查，不改 JSON。不合格须 Agent 重出 elec-json；系统不出图、不落盘。
 *
 * 验收三原则（用户定义）：
 * 1. 元器件/地址与 PDF 一致
 * 2. 无电气故障（断路、错号、母线误用等）
 * 3. 版式美观（列规整、竖串、母线简洁）— 通过布局规则约束，不后端改图
 */
import { diffPdfReference } from './elecPdfRef.mjs'
import { extractPowerRatingsFromPdf } from './elecPdfParse.mjs'

const PLACEHOLDER_IO =
  /PDF未标注|PDF文本未给出|未识别|从 PDF 读|^Q\d+辅助$|^Q\d+辅助触点$/

function allDevices(docs) {
  const list = []
  for (const doc of docs || []) {
    for (const col of doc.columns || []) {
      for (const d of col.devices || []) {
        if (d?.tag) list.push({ doc, col, d })
      }
    }
  }
  return list
}

function isMotorPage(doc) {
  if (doc.page?.kind === 'motor') return true
  const title = String(doc.page?.title || '')
  return /电机/.test(title) || /主回路2/.test(title)
}

function isControlPage(doc) {
  return doc.page?.kind === 'control' || /控制回路/.test(String(doc.page?.title || ''))
}

/** 润滑一致性：无 PDF 对照时才检查；有 PDF 时以 PDF 文本为准（原则1） */
function checkLubeConsistency(docs, pdfReferenceText = '') {
  if (String(pdfReferenceText || '').length > 2000) return []
  const errors = []
  const devs = allDevices(docs)
  for (const { d: coil, doc } of devs) {
    if (!/^km\d+$/i.test(coil.tag)) continue
    if (!/润滑/.test(coil.desc || '')) continue
    if (!isControlPage(doc)) continue
    const kmTag = coil.tag.toUpperCase()
    const motorNo = kmTag.replace(/^KM/, 'M')
    const qTag = `Q${kmTag.slice(2)}`
    for (const { d, doc: pdoc } of devs) {
      if (!isMotorPage(pdoc)) continue
      if (d.tag.toUpperCase() === kmTag && /备用/.test(d.desc || '')) {
        errors.push(`${kmTag}：控制页标润滑，电机页仍写「备用」`)
      }
      if (d.tag.toUpperCase() === motorNo && /备用/.test(d.desc || '')) {
        errors.push(`${motorNo}：与 ${kmTag} 润滑回路不一致（仍写备用电机）`)
      }
      if (d.tag.toUpperCase() === qTag && /备用/.test(d.desc || '')) {
        errors.push(`${qTag}：润滑回路断路器不得标备用`)
      }
    }
  }
  return errors
}

function checkDownsizeQ2(docs, sourceText = '') {
  const errors = []
  const intent = /改小|新柜|不要.*大|容量别沿用/.test(String(sourceText || ''))
  if (!intent) return errors
  for (const { d } of allDevices(docs)) {
    if (!/^q2$/i.test(d.tag)) continue
    if (/63\s*a/i.test(d.rating || '') || /63\s*A/i.test(d.desc || '')) {
      errors.push('Q2：用户要求进线改小，仍写 63A，请改为新柜适用额定（如 30A）')
    }
  }
  return errors
}

function checkEmptyIo(docs) {
  const errors = []
  for (const doc of docs || []) {
    if (doc.page?.kind !== 'io' && !/I\/O|IO\s*UNIT/i.test(doc.page?.title || '')) continue
    const empty = (doc.io || []).filter((r) => r.addr && !String(r.desc || r.name || '').trim())
    for (const row of empty) {
      errors.push(`${doc.page?.title || 'I/O 页'}：${row.addr} 缺功能描述`)
    }
  }
  return errors
}

function normKmDesc(desc) {
  return String(desc || '')
    .replace(/断路器|接触器|线圈/g, '')
    .replace(/电机$/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function checkIoDescQuality(docs) {
  const errors = []
  for (const doc of docs || []) {
    if (doc.page?.kind !== 'io' && !/I\/O|IO\s*UNIT/i.test(doc.page?.title || '')) continue
    for (const row of doc.io || []) {
      const desc = String(row.desc || row.name || '').trim()
      if (!desc) continue
      if (PLACEHOLDER_IO.test(desc)) {
        errors.push(`${doc.page?.title || 'I/O 页'}：${row.addr} 功能描述为占位符「${desc}」`)
      }
    }
  }
  return errors
}

function checkKmCrossPage(docs) {
  const errors = []
  const byKm = new Map()
  for (const doc of docs || []) {
    if (!isMotorPage(doc) && !isControlPage(doc)) continue
    for (const col of doc.columns || []) {
      for (const d of col.devices || []) {
        if (!/^KM\d+$/i.test(d.tag || '')) continue
        const tag = d.tag.toUpperCase()
        const nd = normKmDesc(d.desc)
        if (!nd) continue
        const hit = byKm.get(tag)
        if (hit && hit !== nd) {
          errors.push(`${tag}：跨页描述不一致（${hit} ↔ ${nd}）`)
        } else if (!hit) {
          byKm.set(tag, nd)
        }
      }
    }
  }
  return errors
}

function checkPowerRatings(docs, pdfReferenceText = '') {
  if (String(pdfReferenceText || '').length < 2000) return []
  const errors = []
  const expect = extractPowerRatingsFromPdf(pdfReferenceText)
  const power = (docs || []).find((d) => d.page?.kind === 'power' || /电源/.test(d.page?.title || ''))
  if (!power) return errors
  for (const col of power.columns || []) {
    for (const d of col.devices || []) {
      if (d.tag === 'Q1' && expect.Q1 && d.rating && d.rating !== expect.Q1) {
        errors.push(`Q1：额定 ${d.rating} 与 PDF ${expect.Q1} 不一致`)
      }
      if (d.tag === 'Q2' && expect.Q2 && d.rating && d.rating !== expect.Q2) {
        errors.push(`Q2：额定 ${d.rating} 与 PDF ${expect.Q2} 不一致`)
      }
    }
  }
  return errors
}

function checkFakeMotorTags(docs) {
  const errors = []
  for (const { d, doc } of allDevices(docs)) {
    if (/^MSP\d+$/i.test(d.tag || '')) {
      errors.push(`${doc.page?.title || '本页'}：${d.tag} 为占位位号，PDF 中不存在`)
    }
  }
  return errors
}

/** 原则2：列内竖串连通、Q/KM 同号、跨页 KM 成对 */
function checkElectricalIntegrity(docs) {
  const errors = []
  const motorKm = new Set()
  const controlKm = new Set()
  const railIdsByDoc = new Map()

  for (const doc of docs || []) {
    const railIds = new Set((doc.rails || []).map((r) => String(r.id || '').toUpperCase()))
    railIdsByDoc.set(doc, railIds)

    for (const col of doc.columns || []) {
      const devs = col.devices || []
      if (!devs.length) continue

      if (isMotorPage(doc)) {
        if (devs.length < 3) {
          errors.push(`${doc.page?.title || '电机页'} 列 ${col.i}：不足 3 段（须 Q→KM→M 竖串）`)
        }
        const syms = devs.map((d) => d.sym)
        if (devs.length >= 3 && (syms[0] !== 'breaker3' || syms[1] !== 'contactor' || syms[2] !== 'motor3')) {
          errors.push(`${doc.page?.title || '电机页'} 列 ${col.i}：符号序须 breaker3→contactor→motor3`)
        }
        const q = devs.find((d) => /^Q\d+/i.test(d.tag || ''))
        const km = devs.find((d) => /^KM\d+/i.test(d.tag || ''))
        if (q && km) {
          const qn = q.tag.match(/\d+/)?.[0]
          const kmn = km.tag.match(/\d+/)?.[0]
          if (qn && kmn && qn !== kmn) {
            errors.push(`${doc.page?.title || '电机页'} 列 ${col.i}：${q.tag} 与 ${km.tag} 编号不一致`)
          }
          motorKm.add(km.tag.toUpperCase())
        }
        const allWireless = devs.every(
          (d) => !(d.wiresIn || []).length && !(d.wiresOut || []).length,
        )
        if (allWireless) {
          errors.push(`${doc.page?.title || '电机页'} 列 ${col.i}：列内无 wiresIn/wiresOut，疑似断路`)
        }
      }

      if (isControlPage(doc)) {
        for (const d of devs) {
          if (/^KM\d+$/i.test(d.tag || '')) controlKm.add(d.tag.toUpperCase())
        }
      }

      // 中间线号误写入 rails
      for (const d of devs) {
        for (const w of [...(d.wiresIn || []), ...(d.wiresOut || [])]) {
          const wu = String(w).toUpperCase()
          if (/^(R|S|T|U|V|W)\d+$/.test(wu) && railIds.has(wu)) {
            errors.push(`${doc.page?.title || '本页'}：${w} 不能既是 rails 母线又是器件连线`)
          }
        }
      }

      // 列内连线应首尾相接（有 wire 时）
      for (let i = 1; i < devs.length; i++) {
        const prev = devs[i - 1]
        const cur = devs[i]
        const prevOut = (prev.wiresOut || []).filter(Boolean)
        const curIn = (cur.wiresIn || []).filter(Boolean)
        if (prevOut.length && curIn.length) {
          const linked = prevOut.some((o) => curIn.includes(o))
          if (!linked) {
            errors.push(
              `${doc.page?.title || '本页'} 列 ${col.i}：${prev.tag}→${cur.tag} 连线未衔接（${prevOut.join('/')} → ${curIn.join('/')}）`,
            )
          }
        }
      }
    }
  }

  for (const km of motorKm) {
    if (controlKm.size && !controlKm.has(km)) {
      errors.push(`${km}：电机页有主触点，控制页缺同号线圈`)
    }
  }

  return errors
}

/** 原则3：版式规整 — 列不重复、电机页列数合理、禁止单列堆过多器件 */
function checkAesthetics(docs) {
  const errors = []
  for (const doc of docs || []) {
    const cols = doc.columns || []
    if (!cols.length || doc.page?.kind === 'io' || doc.page?.kind === 'toc') continue

    const idx = cols.map((c) => Number(c.i ?? 0))
    const seen = new Set()
    for (const i of idx) {
      if (seen.has(i)) errors.push(`${doc.page?.title || '本页'}：列 i=${i} 重复，须 0–9 各列唯一`)
      seen.add(i)
    }

    if (isMotorPage(doc)) {
      const withChain = cols.filter((c) => (c.devices || []).length >= 3)
      if (withChain.length < 3) {
        errors.push(`${doc.page?.title || '电机页'}：完整竖串回路少于 3 列，版式不完整`)
      }
      if (cols.length > 8) {
        errors.push(`${doc.page?.title || '电机页'}：超过 8 列，须拆页（参考 PDF 一页一主题）`)
      }
    }

    for (const col of cols) {
      const n = (col.devices || []).length
      if (n > 6 && !isControlPage(doc)) {
        errors.push(`${doc.page?.title || '本页'} 列 ${col.i}：一列 ${n} 个器件，须拆列使线路规整`)
      }
    }
  }
  return errors
}

function checkLayout(docs) {
  const errors = []
  for (const doc of docs || []) {
    const title = String(doc.page?.title || '')
    const kind = String(doc.page?.kind || '')
    const cols = doc.columns || []
    if (!cols.length || kind === 'io' || kind === 'toc' || kind === 'cover') continue

    const overflow = cols.filter((c) => Number(c.i ?? 0) > 9)
    if (overflow.length) {
      errors.push(`${title || '本页'}：有 ${overflow.length} 列 i>9，请改 i 为 0–9 或拆页`)
    }

    const singles = cols.filter((c) => (c.devices || []).length === 1)
    const motors = singles.filter((c) => (c.devices || [])[0]?.sym === 'motor3')
    if (isMotorPage(doc) && motors.length >= 3 && singles.length >= motors.length) {
      errors.push(`${title || '电机页'}：每条回路应一列竖串 Q→KM→M，禁止每器件单独一列`)
    }

    if ((doc.rails || []).length > 6 && (kind === 'motor' || kind === 'power')) {
      errors.push(
        `${title || '本页'}：rails 有 ${doc.rails.length} 条；母线只写 R/S/T/PE（最多 6 条），参考 PDF 勿把中间线号写入 rails`,
      )
    }

    const railIds = new Set((doc.rails || []).map((r) => String(r.id || '').toUpperCase()))
    for (const id of railIds) {
      if (/^(R|S|T|U|V|W)\d+$/.test(id) && !/^(R|S|T)$|^PE$/.test(id)) {
        errors.push(`${title || '本页'}：rails 含中间线号 ${id}，须改为 R/S/T/PE 母线`)
      }
    }
  }
  return errors
}

export function lintElecDocs(docs, { sourceText = '', pdfReferenceText = '', mode = 'connectivity' } = {}) {
  const list = Array.isArray(docs) ? docs : []
  const pdfErrorsRaw = diffPdfReference(list, pdfReferenceText)
  const pdfErrors =
    mode === 'connectivity'
      ? pdfErrorsRaw.filter((e) => !/I\/O 地址/.test(e))
      : pdfErrorsRaw
  const layoutErrors = checkLayout(list)
  const ioErrors = [...checkEmptyIo(list), ...checkIoDescQuality(list)]
  const integrityErrors = checkElectricalIntegrity(list)
  const aestheticErrors = checkAesthetics(list)
  const contentErrors = [
    ...checkLubeConsistency(list, pdfReferenceText),
    ...checkDownsizeQ2(list, sourceText),
    ...checkKmCrossPage(list),
    ...checkPowerRatings(list, pdfReferenceText),
    ...checkFakeMotorTags(list),
  ]
  const diagramMode = mode === 'diagram'
  const errors = [
    ...pdfErrors,
    ...integrityErrors,
    ...(diagramMode ? layoutErrors : []),
    ...(diagramMode ? aestheticErrors : []),
    ...ioErrors,
    ...contentErrors,
  ]
  return {
    docs: list,
    errors,
    pdfErrors,
    integrityErrors,
    layoutErrors: diagramMode ? layoutErrors : [],
    ioErrors,
    aestheticErrors: diagramMode ? aestheticErrors : [],
    contentErrors,
    warnings: diagramMode ? [] : [...layoutErrors, ...aestheticErrors],
    mode,
  }
}

export function lintAndFixElecDocs(docs, opts = {}) {
  return lintElecDocs(docs, opts)
}

export function formatLintSummary(linted, { max = 18 } = {}) {
  const errs = linted.errors || []
  if (!errs.length) return ''
  const head = errs.slice(0, max)
  const tail = errs.length > max ? `…另有 ${errs.length - max} 条` : ''
  return [...head, tail].filter(Boolean).join('；')
}

/**
 * 从 EPLAN 导出 PDF 文本提取对照位号/I/O（用于校验，不改 JSON）。
 */
import { extractPowerPageTagSet } from './elecPdfParse.mjs'

function normIo(addr) {
  const m = String(addr || '')
    .trim()
    .toUpperCase()
    .match(/^([XY])(\d+)\.(\d+)$/)
  if (!m) return ''
  return `${m[1]}${Number(m[2])}.${Number(m[3])}`
}

export function extractPdfReferenceTags(text) {
  const src = String(text || '')
  const tags = new Set()
  const ios = new Set()

  for (const m of src.matchAll(/\b-M(\d+)\b/gi)) tags.add(`M${m[1]}`)
  for (const m of src.matchAll(/\bM(\d+)\b/gi)) {
    const full = m[0]
    if (!/^-/.test(full)) tags.add(`M${m[1]}`)
  }
  for (const m of src.matchAll(/\bQ(\d{1,3})\b/g)) tags.add(`Q${m[1]}`)
  for (const m of src.matchAll(/\bKM(\d{1,3})\b/gi)) tags.add(`KM${m[1]}`.toUpperCase())
  for (const m of src.matchAll(/\bKA(\d{1,3})\b/gi)) tags.add(`KA${m[1]}`.toUpperCase())
  for (const m of src.matchAll(/\bCB(\d{1,3})\b/gi)) tags.add(`CB${m[1]}`.toUpperCase())
  for (const m of src.matchAll(/\bBISV[\w/-]*/gi)) tags.add(String(m[0]).toUpperCase().slice(0, 12))
  for (const m of src.matchAll(/\bX(\d{1,3}\.\d)\b/gi)) {
    const a = normIo(`X${m[1]}`)
    if (a) ios.add(a)
  }
  for (const m of src.matchAll(/\bY(\d{1,3}\.\d)\b/gi)) {
    const a = normIo(`Y${m[1]}`)
    if (a) ios.add(a)
  }

  return { tags, ios }
}

export function extractJsonReference(docs) {
  const tags = new Set()
  const ios = new Set()
  for (const doc of docs || []) {
    for (const col of doc.columns || []) {
      for (const d of col.devices || []) {
        if (d?.tag) tags.add(String(d.tag).toUpperCase())
      }
    }
    for (const row of doc.io || []) {
      const a = normIo(row.addr)
      if (a) ios.add(a)
      if (row.term) tags.add(String(row.term).toUpperCase())
    }
  }
  return { tags, ios }
}

/** PDF 有关键位号时：JSON 必须覆盖 PDF 中的电机主回路、电源页 Q、I/O 地址 */
export function diffPdfReference(docs, pdfText) {
  const errors = []
  const pdf = extractPdfReferenceTags(pdfText)
  const json = extractJsonReference(docs)
  if (!pdfText || pdfText.length < 2000) return errors

  const motorQ = [...pdf.tags].filter((t) => /^Q2[0-9]$/.test(t)).sort()
  const motorKm = [...pdf.tags].filter((t) => /^KM2[0-9]$/.test(t)).sort()
  const motors = [...pdf.tags].filter((t) => /^M[1-9]\d*$/.test(t)).sort()

  for (const t of [...motorQ, ...motorKm, ...motors]) {
    if (!json.tags.has(t)) errors.push(`PDF 对照：缺少位号 ${t}`)
  }

  const powerTags = extractPowerPageTagSet(pdfText)
  for (const t of powerTags) {
    if (!json.tags.has(t)) errors.push(`PDF 对照：电源页缺少位号 ${t}`)
  }

  for (const addr of pdf.ios) {
    if (!json.ios.has(addr)) errors.push(`PDF 对照：缺少 I/O 地址 ${addr}`)
  }

  const inferredM = new Set()
  if (pdf.tags.has('Q25')) inferredM.add('M6')
  if (pdf.tags.has('Q26')) inferredM.add('M7')

  for (const t of json.tags) {
    if (/^Q2[0-9]$|^KM2[0-9]$/.test(t) && !pdf.tags.has(t)) {
      errors.push(`PDF 对照：JSON 多出 PDF 未出现的位号 ${t}`)
    }
    if (/^M[1-9]\d*$/.test(t) && !pdf.tags.has(t) && !inferredM.has(t)) {
      errors.push(`PDF 对照：JSON 多出 PDF 未出现的位号 ${t}`)
    }
    if (/^MSP\d+$/i.test(t)) {
      errors.push(`PDF 对照：JSON 含 PDF 不存在的占位位号 ${t}`)
    }
  }

  return errors
}

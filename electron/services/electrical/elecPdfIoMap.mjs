/**
 * I/O 地址工具 + 从 elecPdfParse 再导出描述映射。
 */
import { buildIoDescMapFromPdfPages, extractPowerPageTagSet, normIo, ioAddrsFromPageTitle, pageIoTitle } from './elecPdfParse.mjs'

export { normIo, ioAddrsFromPageTitle, pageIoTitle, buildIoDescMapFromPdfPages, extractPowerPageTagSet }

export function buildIoDescMapFromPdf(pdfText) {
  return buildIoDescMapFromPdfPages(pdfText)
}

export function formatIoDescBrief(pdfText, { max = 90 } = {}) {
  const ioMap = buildIoDescMapFromPdfPages(pdfText)
  if (!ioMap.size) return ''
  const lines = ['【PDF 提取的 I/O 功能名 — elec-json 的 io[].desc 必须逐条填写】']
  const sorted = [...ioMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [addr, { desc, page }] of sorted.slice(0, max)) {
    lines.push(`- ${addr}：${desc || '（PDF 未识别，请读图补全）'}${page ? ` · ${page}` : ''}`)
  }
  if (sorted.length > max) lines.push(`- …共 ${sorted.length} 个地址`)
  return lines.join('\n')
}

/**
 * 电路图资料库路径：03_电路图/<机床型号>/…
 */
import { sanitizeFolder } from '../samaLibrary.mjs'

export function elecMachineSlug(docsOrMachine) {
  const machine =
    typeof docsOrMachine === 'string'
      ? docsOrMachine
      : docsOrMachine?.[0]?.project?.machine || docsOrMachine?.project?.machine || '电路图'
  return String(machine || '电路图')
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || '电路图'
}

/** 例如 03_电路图/FAVRETTO_MC160 */
export function elecProjectRel(docs) {
  const list = Array.isArray(docs) ? docs : [docs]
  return `03_电路图/${elecMachineSlug(list)}`
}

export function elecProjectPageRel(docs, sub = '') {
  const base = elecProjectRel(docs)
  const tail = String(sub || '').replace(/\\/g, '/').replace(/^\/+/, '')
  return tail ? `${base}/${tail}` : base
}

export function elecPageSvgFileName(doc) {
  const no = doc?.page?.no || 1
  const title = sanitizeFolder(String(doc?.page?.title || 'sheet'), 'sheet')
  return `${title}_${no}.svg`
}

export function elecBookStem(docs, pageCount) {
  const machine = elecMachineSlug(docs)
  return `${machine}_整本_${pageCount}页`
}

export function elecConnectivityStem(docs) {
  const machine = elecMachineSlug(docs)
  const pages = Array.isArray(docs) ? docs.length : 1
  return `${machine}_连通性_${pages}页`
}

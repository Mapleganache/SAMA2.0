/**
 * 电路图读写：PDF 抽文本、渲染、写入 SAMA文件/03_电路图。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderElecSvg, renderElecBook } from './renderSheet.mjs'
import {
  parseElecJsonBlocks,
  normalizeElecJson,
  looksLikeElecTask,
  looksLikeElecEdit,
  mergeElecJson,
  countDevices,
} from './elecJson.mjs'
import { schematicFromPdfText } from './readSchematic.mjs'
import { lintElecDocs } from './elecLint.mjs'
import { exportConnectivity, defaultConnectivityStem, auditSvgTagCoverage } from './elecConnectivity.mjs'
import {
  formatWirePlanMarkdown,
  formatWirePlanText,
} from './wirePlanMotor.mjs'
import { verifyLogicAgainstPdf, formatLogicVerifyReport } from './elecLogicVerify.mjs'
import {
  validateDrawReady,
  auditSvgPhaseWiring,
  compareSamaToReference,
  formatCompareReport,
} from './elecRenderVerify.mjs'
import { buildElecBookFromPdf, docsToElecJsonFences, looksLikePdfReplicaTask } from './elecFromPdf.mjs'
import { buildSasl32Sheet, listSasl32Templates, SASL32_TOC } from './sasl32Pack.mjs'
import {
  elecProjectRel,
  elecProjectPageRel,
  elecPageSvgFileName,
  elecBookStem,
  elecConnectivityStem,
} from './elecLibraryPath.mjs'
import {
  saveNamedFileToLibrary,
  getDesktopLibraryRoot,
  getWorkspaceLibraryRoot,
  LIBRARY_NAME,
} from '../samaLibrary.mjs'

function writeBookPdfBinary(relUnder03, buf) {
  const rel = String(relUnder03 || '').replace(/\\/g, '/').replace(/^\/+/, '')
  const file = path.basename(rel)
  const dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '03_电路图'
  const wsAbs = path.join(getWorkspaceLibraryRoot(), dirRel.replaceAll('/', path.sep), file)
  const deskAbs = path.join(getDesktopLibraryRoot(), dirRel.replaceAll('/', path.sep), file)
  fs.mkdirSync(path.dirname(wsAbs), { recursive: true })
  fs.writeFileSync(wsAbs, buf)
  try {
    fs.mkdirSync(path.dirname(deskAbs), { recursive: true })
    fs.writeFileSync(deskAbs, buf)
  } catch {
    /* 桌面镜像失败不阻断 */
  }
  const fullRel = `${dirRel}/${file}`.replace(/\\/g, '/')
  return {
    path: `${LIBRARY_NAME}/${fullRel}`,
    desktopPath: deskAbs,
    bytes: buf.length,
  }
}

export {
  parseElecJsonBlocks,
  looksLikeElecTask,
  looksLikeElecEdit,
  buildSasl32Sheet,
  listSasl32Templates,
  SASL32_TOC,
  schematicFromPdfText,
  mergeElecJson,
  buildElecBookFromPdf,
  docsToElecJsonFences,
  looksLikePdfReplicaTask,
}

export async function extractPdfText(filePath) {
  const buf = fs.readFileSync(filePath)
  const mod = await import('pdf-parse')
  const PDFParse = mod.PDFParse || mod.default?.PDFParse || mod.default
  if (!PDFParse) return ''
  if (typeof PDFParse === 'function') {
    try {
      const parser = new PDFParse({ data: buf })
      if (typeof parser.getText === 'function') {
        const result = await parser.getText()
        return String(result?.text || result || '')
      }
    } catch {
      /* fall through */
    }
    const result = await PDFParse(buf)
    return String(result?.text || '')
  }
  return ''
}

export function renderAndSaveSheet(raw, { name = '', baseDoc, docs: docsCtx } = {}) {
  const doc = prepareDoc(raw, baseDoc)
  const rendered = renderElecSvg(doc)
  const { svg, bom, renderMode, wirePlan } = rendered
  const ctx = docsCtx || [doc]
  const fileName = name
    ? `${String(name).slice(0, 60)}.svg`
    : elecPageSvgFileName(doc)
  const saved = saveNamedFileToLibrary({
    name: elecProjectPageRel(ctx, `单页/${fileName}`),
    content: svg,
    hint: '电路图',
  })
  return {
    ok: true,
    svg,
    bom,
    doc,
    path: saved.path,
    desktopPath: saved.desktopPath,
    bytes: saved.bytes,
    renderMode,
    wirePlan,
  }
}

export async function readSchematicFile(filePath, opts = {}) {
  const ext = path.extname(filePath || '').toLowerCase()
  if (ext !== '.pdf') {
    throw new Error('目前识图电路图请提供 PDF（EPLAN 导出）或让模型填 elec-json')
  }
  const text = await extractPdfText(filePath)
  if (!text.trim()) throw new Error('PDF 未能抽出文字，可能是纯扫描件，请用识图模型看图')
  const parsed = schematicFromPdfText(text, opts)
  const book = buildElecBookFromPdf(text)
  const bookLint = book.docs.length
    ? lintElecDocs(book.docs, { pdfReferenceText: text, mode: 'connectivity' })
    : { errors: ['empty'] }
  if (book.docs.length >= 4 && !(bookLint.errors || []).length) {
    const stem = elecConnectivityStem(book.docs)
    const logicVerify = verifyLogicAgainstPdf(book.docs, text)
    const saved = exportAndSaveConnectivity(book.docs, { name: stem })
    const preview =
      book.docs.find((d) => d.page?.kind === 'motor') ||
      book.docs.find((d) => (d.columns || []).length) ||
      book.docs[0]
    return {
      ok: true,
      weak: false,
      fromPdf: true,
      deviceCount: book.docs.reduce(
        (n, d) => n + (d.columns || []).reduce((a, c) => a + (c.devices || []).length, 0),
        0,
      ),
      ...saved,
      doc: preview,
      docs: book.docs,
      toc: book.toc || parsed.toc,
      pages: book.pages || parsed.pages,
      project: book.project || parsed.project,
      textPreview: text.slice(0, 4000),
      logicVerify,
      logicVerifyText: formatLogicVerifyReport(logicVerify),
    }
  }

  const nDev = countDevices(parsed.doc)
  const weak =
    nDev < 5 ||
    (parsed.doc.uncertain || []).some((u) => /偏少|散乱|存疑/.test(String(u))) ||
    (parsed.doc.notes || []).some((n) => /需对照原图/.test(String(n)))

  if (weak) {
    return {
      ok: true,
      weak: true,
      ...parsed,
      deviceCount: nDev,
      hint: 'PDF 文本只能抽出目录和少量位号。请在对话里让 Agent 读 PDF 输出 elec-json，再点「导出连通性」。',
      textPreview: text.slice(0, 4000),
    }
  }

  const saved = exportAndSaveConnectivity([parsed.doc], {
    name: `${parsed.project.machine || 'schematic'}_p${parsed.doc.page.no}_连通性`,
  })
  return {
    ok: true,
    weak: false,
    deviceCount: nDev,
    ...parsed,
    ...saved,
    doc: parsed.doc,
    textPreview: text.slice(0, 4000),
  }
}

export function exportAndSaveConnectivity(docs, { name = '' } = {}) {
  const conn = exportConnectivity(docs)
  const stem = (name || elecConnectivityStem(docs)).slice(0, 55)
  const mdSaved = saveNamedFileToLibrary({
    name: elecProjectPageRel(docs, `${stem}.md`),
    content: conn.markdown,
    hint: '电路连通性',
  })
  const txtSaved = saveNamedFileToLibrary({
    name: elecProjectPageRel(docs, `${stem}.txt`),
    content: conn.text,
    hint: '电路连通性',
  })
  return {
    ok: true,
    isConnectivity: true,
    isBook: docs.length >= 2,
    pageCount: conn.pageCount,
    deviceCount: conn.deviceCount,
    edgeCount: conn.edgeCount,
    netCount: conn.netCount,
    path: mdSaved.path,
    desktopPath: mdSaved.desktopPath,
    txtPath: txtSaved.path,
    txtDesktopPath: txtSaved.desktopPath,
    bytes: mdSaved.bytes + txtSaved.bytes,
    markdown: conn.markdown,
    connectivityText: conn.text,
    docs,
    doc: docs[0] || {},
  }
}

function prepareDoc(doc, baseDoc) {
  const patch = normalizeElecJson(doc)
  if (baseDoc && countDevices(baseDoc)) return mergeElecJson(baseDoc, patch)
  return patch
}

/** 从已通过校验的 elec-json 渲染 IEC 原理图（连通性文本 → 施工图） */
export async function drawDiagramFromDocs(docs, { name = '', pdfReferenceText = '' } = {}) {
  const ready = validateDrawReady(docs, pdfReferenceText)
  if (!ready.ok) {
    return {
      ok: false,
      rejected: true,
      phase: 'pre-draw',
      errors: ready.errors,
      warnings: ready.warnings,
      logicVerify: ready.logicVerify,
      logicVerifyText: ready.logicVerifyText,
      elecLint: ready.errors,
    }
  }

  const pages = ready.linted.docs
  const conn = exportConnectivity(pages)

  // 有 wirePlan 时先落盘逻辑接线表，再按步骤画图
  let logicPlanSaved = null
  const wirePlan = pages[0]?.wirePlan
  if (Array.isArray(wirePlan) && wirePlan.length) {
    const stemLogic = `${elecConnectivityStem(pages).replace(/连通性/, '逻辑接线')}`
    const mdLogic = saveNamedFileToLibrary({
      name: elecProjectPageRel(pages, `${stemLogic}.md`),
      content: formatWirePlanMarkdown(wirePlan, '电动机逻辑接线步骤'),
      hint: '逻辑接线',
    })
    const txtLogic = saveNamedFileToLibrary({
      name: elecProjectPageRel(pages, `${stemLogic}.txt`),
      content: formatWirePlanText(wirePlan),
      hint: '逻辑接线',
    })
    logicPlanSaved = { mdPath: mdLogic.path, txtPath: txtLogic.path, desktopMd: mdLogic.desktopPath }
  }

  const logicVerify = ready.logicVerify
  const stem = (name || elecConnectivityStem(pages)).slice(0, 55)
  const bookRendered = pages.length >= 2 ? renderElecBook(pages) : null
  const diagram =
    pages.length >= 2
      ? await renderAndSaveBook(pages, { name: stem })
      : renderAndSaveSheet(pages[0], { docs: pages })
  if (!diagram.ok) return diagram

  const svgPages =
    bookRendered?.pages?.map((p) => p.svg) || (diagram.svg ? [diagram.svg] : [])
  const tagAudit = auditSvgTagCoverage(svgPages, pages)
  const wireAudit = auditSvgPhaseWiring(svgPages, pages)
  const compare = compareSamaToReference(pages, pdfReferenceText, svgPages)

  if (!wireAudit.ok) {
    return {
      ok: false,
      rejected: true,
      phase: 'post-draw',
      errors: wireAudit.errors,
      warnings: ready.warnings,
      wireAudit,
      compareReport: formatCompareReport(compare),
      compare,
      tagAudit,
      docs: pages,
    }
  }

  return {
    ...diagram,
    ok: true,
    isDiagram: true,
    connectivityText: conn.text,
    markdown: conn.markdown,
    deviceCount: conn.deviceCount,
    edgeCount: conn.edgeCount,
    netCount: conn.netCount,
    logicVerify,
    logicVerifyText: logicVerify ? formatLogicVerifyReport(logicVerify) : ready.logicVerifyText,
    tagAudit,
    wireAudit,
    compare,
    compareReport: formatCompareReport(compare),
    warnings: ready.warnings,
    logicPlanSaved,
    renderMode: diagram.renderMode || 'columns',
    docs: pages,
    doc: pages[0],
    bookPages: bookRendered?.pages,
  }
}

export async function renderAndSaveBook(docs, { name = '' } = {}) {
  const book = renderElecBook(docs)
  if (!book.pageCount) return { ok: false, error: '没有可合成的页' }
  const stem = elecBookStem(docs, book.pageCount)
  const stemShort = stem.slice(0, 55)
  const projectRel = elecProjectRel(docs)

  const pageSvgPaths = []
  for (let i = 0; i < book.pages.length; i++) {
    const doc = docs[i] || book.docs[i]
    const svgName = elecPageSvgFileName(doc)
    const saved = saveNamedFileToLibrary({
      name: elecProjectPageRel(docs, `单页/${svgName}`),
      content: book.pages[i].svg,
      hint: '电路图',
    })
    pageSvgPaths.push({ title: doc?.page?.title || svgName, path: saved.path, desktopPath: saved.desktopPath })
  }

  const htmlSaved = saveNamedFileToLibrary({
    name: `${projectRel}/${stemShort}.html`,
    content: book.html,
    hint: '整本电路图HTML',
  })

  let pdfSaved = null
  let pdfError = ''
  try {
    const { htmlToPagedPdf } = await import('./bookPdf.mjs')
    const tmpOut = path.join(os.tmpdir(), `sama-book-${Date.now()}.pdf`)
    const made = await htmlToPagedPdf(book.html, tmpOut)
    if (made.ok) {
      const bin = fs.readFileSync(tmpOut)
      pdfSaved = writeBookPdfBinary(`${projectRel}/${stemShort}.pdf`, bin)
      try {
        fs.unlinkSync(tmpOut)
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    pdfError = String(e.message || e)
  }

  const toc = (docs || [])
    .map((d, i) => `${i + 1}. /${d.page?.no || i + 1} ${d.page?.title || ''}`)
    .join('\n')
  const md = saveNamedFileToLibrary({
    name: `${projectRel}/${stemShort.slice(0, 50)}_目录.md`,
    content: [
      `# ${book.title}`,
      '',
      `机床目录：\`${projectRel}\``,
      '',
      `共 ${book.pageCount} 页。格式与 EPLAN 导出 PDF 一样：**一页一页翻**，不是竖着拼的长图。`,
      '',
      toc,
      '',
      '## 单页 SVG',
      pageSvgPaths.map((p) => `- ${p.title}：\`${p.path}\``).join('\n'),
      '',
      pdfSaved ? `PDF：\`${pdfSaved.path}\`` : `PDF 未生成${pdfError ? `（${pdfError}）` : ''}，请打开 HTML 阅览/打印。`,
      `HTML：\`${htmlSaved.path}\``,
      '',
    ].join('\n'),
    hint: '电路图目录',
  })

  const primaryPath = pdfSaved?.path || htmlSaved.path
  const primaryDesktop = pdfSaved?.desktopPath || htmlSaved.desktopPath
  return {
    ok: true,
    svg: book.svg,
    bom: book.bom,
    doc: {
      project: docs[0]?.project || {},
      page: { no: 1, of: book.pageCount, title: book.title, kind: 'book' },
      columns: [],
      rails: [],
      notes: [`整本 ${book.pageCount} 页（分页 PDF/HTML）`],
    },
    docs,
    pageCount: book.pageCount,
    isBook: true,
    path: primaryPath,
    desktopPath: primaryDesktop,
    bytes: pdfSaved?.bytes || htmlSaved.bytes,
    htmlPath: htmlSaved.path,
    pdfPath: pdfSaved?.path || '',
    tocPath: md.path,
    pdfError: pdfError || undefined,
    bookPages: book.pages,
    pageSvgPaths,
    projectRel,
  }
}

export async function generateSheet(opts = {}) {
  if (opts.text) {
    const arts = await applyElecJsonFromText(opts.text, { save: true, baseDoc: opts.baseDoc })
    const conn = arts.find((a) => a.isConnectivity)
    if (conn) return conn
    if (arts[0]) return arts[0]
  }
  if (opts.doc) {
    return exportAndSaveConnectivity([prepareDoc(opts.doc, opts.baseDoc)], {
      name: defaultConnectivityStem([opts.doc]),
    })
  }
  const id = String(opts.template || opts.id || 'power1')
  const doc = buildSasl32Sheet(id)
  if (opts.machine) doc.project.machine = String(opts.machine)
  return exportAndSaveConnectivity([doc], { name: `${id}_连通性` })
}

/** 预览优先示意图（若已出图），否则连通性表 */
export function pickElecPreviewArt(arts) {
  if (!arts?.length) return null
  const diagram = arts.find((a) => a.isDiagram && (a.svg || a.path))
  if (diagram) return diagram
  const conn = arts.find((a) => a.isConnectivity && a.path)
  if (conn) return conn
  const book = arts.find((a) => a.isBook)
  if (book) return book
  return arts.find((a) => a.path) || arts[arts.length - 1]
}

/** IPC/CDP 回包 */
export function slimElecRenderPayload(arts) {
  const rejected = (arts || []).find((a) => a.rejected)
  if (rejected) {
    const errs = rejected.errors || rejected.layoutErrors || []
    return {
      ok: false,
      rejected: true,
      phase: rejected.phase || 'pre-draw',
      error: rejected.error || `校验未通过（${errs.length} 条），未出图`,
      errors: errs,
      compareReport: rejected.compareReport,
      wireAudit: rejected.wireAudit,
      logicVerifyText: rejected.logicVerifyText,
      layoutErrors: rejected.layoutErrors || [],
      ioErrors: rejected.ioErrors || [],
      contentErrors: rejected.contentErrors || [],
    }
  }
  const pick = pickElecPreviewArt(arts)
  if (!pick || pick.ok === false) return { ok: false, error: '没有可导出的连通性数据' }
  return {
    ok: true,
    isConnectivity: pick.isConnectivity ?? !pick.isDiagram,
    isDiagram: pick.isDiagram ?? false,
    path: pick.path,
    desktopPath: pick.desktopPath,
    txtPath: pick.txtPath,
    connectivityText: pick.connectivityText || pick.markdown,
    svg: pick.svg,
    bom: pick.bom,
    doc: pick.doc,
    pageCount: pick.pageCount,
    deviceCount: pick.deviceCount,
    edgeCount: pick.edgeCount,
    netCount: pick.netCount,
    isBook: pick.isBook,
    elecLint: pick.elecLint,
    logicVerify: pick.logicVerify,
    logicVerifyText: pick.logicVerifyText,
    tagAudit: pick.tagAudit,
    wireAudit: pick.wireAudit,
    compareReport: pick.compareReport,
    htmlPath: pick.htmlPath,
    pdfPath: pick.pdfPath,
    sheetCount: arts.filter((a) => !a.isBook).length,
  }
}

export async function applyElecJsonFromText(
  text,
  { save = true, baseDoc, pdfReferenceText = '', mode = 'connectivity' } = {},
) {
  const docs = parseElecJsonBlocks(text)
  if (!docs.length) return []
  const prepared = docs.map((doc) => prepareDoc(doc, baseDoc))
  const linted = lintElecDocs(prepared, { sourceText: text, pdfReferenceText, mode: 'connectivity' })
  const pages = linted.docs
  const allErrors = linted.errors || []

  if (allErrors.length) {
    return [
      {
        ok: false,
        rejected: true,
        errors: allErrors,
        layoutErrors: linted.layoutErrors,
        ioErrors: linted.ioErrors,
        contentErrors: linted.contentErrors,
        elecLint: allErrors,
      },
    ]
  }

  if (!save) {
    const conn = exportConnectivity(pages)
    return [
      {
        ok: true,
        isConnectivity: true,
        markdown: conn.markdown,
        connectivityText: conn.text,
        deviceCount: conn.deviceCount,
        pageCount: conn.pageCount,
        docs: pages,
        doc: pages[0],
        elecLint: [],
        layoutErrors: [],
      },
    ]
  }

  const stem = elecConnectivityStem(pages)
  if (mode === 'diagram') {
    const drawn = await drawDiagramFromDocs(pages, { name: stem, pdfReferenceText })
    if (!drawn.ok) return [drawn]
    const connSaved = exportAndSaveConnectivity(pages, { name: stem })
    return [
      {
        ...drawn,
        path: drawn.path || connSaved.path,
        desktopPath: drawn.desktopPath || connSaved.desktopPath,
        txtPath: connSaved.txtPath,
        txtDesktopPath: connSaved.txtDesktopPath,
        isConnectivity: true,
        elecLint: [],
        layoutErrors: [],
      },
    ]
  }
  const saved = exportAndSaveConnectivity(pages, { name: stem })
  return [{ ...saved, elecLint: [], layoutErrors: [] }]
}

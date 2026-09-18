/**
 * 从 EPLAN 导出 PDF 文本程序化还原整本 elec-json。
 */
import { emptyElecJson, normalizeElecJson } from './elecJson.mjs'
import { schematicFromPdfText, splitSchematicPages, parseToc } from './readSchematic.mjs'
import { extractPdfReferenceTags } from './elecPdfRef.mjs'
import { buildIoDescMapFromPdfPages, pageIoTitle, ioAddrsFromPageTitle, normIo } from './elecPdfIoMap.mjs'
import { motorCircuitsFromPdf } from './elecPdfBrief.mjs'
import {
  findContentPage,
  parsePowerPageDevices,
  parseMikrosaPower1Columns,
  wirePowerColumns,
  kmCoilDesc,
  kaDescFromBody,
} from './elecPdfParse.mjs'

function rstPe() {
  return [
    { id: 'R', label: 'R', type: 'phase' },
    { id: 'S', label: 'S', type: 'phase' },
    { id: 'T', label: 'T', type: 'phase' },
    { id: 'PE', label: 'PE', type: 'pe' },
  ]
}

function dcRails() {
  return [
    { id: '24P1', label: '24P1', type: 'phase' },
    { id: '0V', label: '0V', type: 'phase' },
  ]
}

function motorIndex(qNum) {
  const n = Number(qNum)
  if (n >= 20 && n <= 29) return n - 19
  return n
}

function buildMotorPage(project, of, circuits) {
  const uncertain = []
  const columns = circuits.map((c, i) => {
    const q = String(c.q || '')
    const km = String(c.km || '')
    let mid
    let uvw
    let motorTag = c.motor && /^[0-9]?M\d+$/i.test(c.motor) ? c.motor : ''
    if (/^\dQ\d+$/i.test(q)) {
      const prefix = q.match(/^(\d)/)?.[1] || ''
      const n = q.replace(/\D/g, '')
      mid = [`${prefix}L${n}`, `${prefix}L${n}`, `${prefix}L${n}`]
      const mi = n
      uvw = [`${prefix}U${mi}`, `${prefix}V${mi}`, `${prefix}W${mi}`]
      if (!motorTag && c.motor) motorTag = c.motor
    } else {
      const n = String(c.q).replace(/\D/g, '')
      const mi = motorIndex(n)
      mid = [`R${n}`, `S${n}`, `T${n}`]
      uvw = [`U${mi}`, `V${mi}`, `W${mi}`]
      if (!motorTag && /^M\d+$/.test(c.motor || '')) motorTag = c.motor
    }
    if (!motorTag) {
      motorTag = /^M\d+$/.test(c.motor || '') ? c.motor : `M${String(q).replace(/\D/g, '')}`
      uncertain.push(`${q} 回路：PDF 文本未提取到 -M 位号，暂用 ${motorTag}（须对照原图）`)
    }
    const desc = c.desc || '电机'
    return {
      i,
      devices: [
        {
          tag: c.q,
          sym: 'breaker3',
          rating: c.rating || '',
          desc: `${desc}断路器`,
          wiresIn: ['R', 'S', 'T'],
          wiresOut: mid,
        },
        {
          tag: c.km,
          sym: 'contactor',
          rating: '',
          desc: `${desc}接触器`,
          wiresIn: mid,
          wiresOut: uvw,
        },
        {
          tag: motorTag,
          sym: 'motor3',
          rating: '3~',
          desc,
          wiresIn: uvw,
          wiresOut: [],
        },
      ],
    }
  })
  return emptyElecJson({
    project,
    page: { no: 4, of, title: '电机', kind: 'motor' },
    rails: rstPe(),
    columns,
    uncertain,
  })
}

function buildPowerPage(project, of, body, pageTitle = '电源') {
  let columns = wirePowerColumns(parsePowerPageDevices(body))
  if (!columns.length) columns = parseMikrosaPower1Columns(body)
  const title = /主回路1/.test(body) ? '主回路1' : pageTitle
  const no = title === '主回路1' ? 3 : 3
  return emptyElecJson({
    project,
    page: { no, of, title, kind: 'power' },
    rails: rstPe(),
    columns,
  })
}

function buildControlPages(project, of, pages, motorCircuits) {
  const kmDescMap = new Map(motorCircuits.map((c) => [c.km, c.desc]))
  const p1 = findContentPage(pages, /控制回路1/)
  const p2 = findContentPage(pages, /控制回路2/)
  const out = []
  if (p1) {
    const kms = [...new Set([...(p1.body.match(/\bKM2\d\b/gi) || [])])].map((t) => t.toUpperCase())
    const columns = kms.map((km, i) => {
      const n = km.replace(/\D/g, '')
      const ka = `KA${n}`
      const w = String(1000 + (Number(n) - 20))
      const desc = kmDescMap.get(km) || kmCoilDesc(p1.body, km, kmDescMap)
      return {
        i,
        devices: [
          {
            tag: ka,
            sym: 'relay',
            desc: kaDescFromBody(p1.body, ka) || desc,
            wiresIn: ['24P1'],
            wiresOut: [w],
          },
          {
            tag: km,
            sym: 'contactor',
            desc: desc || '',
            wiresIn: [w],
            wiresOut: ['0V'],
          },
        ],
      }
    })
    out.push(
      emptyElecJson({
        project,
        page: { no: 5, of, title: '控制回路1', kind: 'control' },
        rails: dcRails(),
        columns,
      }),
    )
  }
  if (p2) {
    const kas = [...new Set([...(p2.body.match(/\bKA3\d\b/gi) || [])])].map((t) => t.toUpperCase())
    const columns = kas.map((ka, i) => ({
      i,
      devices: [
        {
          tag: ka,
          sym: 'relay',
          desc: kaDescFromBody(p2.body, ka) || '',
          wiresIn: ['24P2'],
          wiresOut: ['0V'],
        },
      ],
    }))
    out.push(
      emptyElecJson({
        project,
        page: { no: 6, of, title: '控制回路2', kind: 'control' },
        rails: dcRails(),
        columns,
      }),
    )
  }
  return out
}

function buildDrivePages(project, of, pages) {
  const out = []
  const cnc = findContentPage(pages, /CNC CONTROL/i)
  if (cnc) {
    const tags = [...new Set([...(cnc.body.match(/\b(?:CP1|MDI|CB10[47])\b/gi) || [])])].map((t) =>
      t.toUpperCase(),
    )
    out.push(
      emptyElecJson({
        project,
        page: { no: 7, of, title: 'CNC CONTROL CIRCUIT', kind: 'drive' },
        rails: dcRails(),
        columns: (tags.length ? tags : ['CP1', 'MDI']).slice(0, 6).map((tag, i) => ({
          i,
          devices: [{ tag, sym: tag === 'CP1' ? 'psu' : 'other', desc: tag, wiresIn: ['24P1'], wiresOut: [] }],
        })),
      }),
    )
  }
  const servo = findContentPage(pages, /YZ SERVO|SERVO CIRCUIT/i)
  if (servo) {
    const amps = [...new Set([...(servo.body.match(/\b(?:BISV|SVM|AISV)[\w/-]*/gi) || [])])]
    const tags = amps.length ? amps : ['BISV']
    out.push(
      emptyElecJson({
        project,
        page: { no: 8, of, title: 'YZ SERVO CIRCUIT', kind: 'drive' },
        rails: rstPe(),
        columns: tags.slice(0, 6).map((tag, i) => ({
          i,
          devices: [
            {
              tag: String(tag).slice(0, 14).toUpperCase(),
              sym: 'servo',
              desc: '伺服放大器',
              wiresIn: ['R', 'S', 'T'],
              wiresOut: [],
            },
          ],
        })),
      }),
    )
  }
  return out
}

function ioRowsForPage(body, ioMap, pdfIos) {
  const title = pageIoTitle(body)
  let addrs = ioAddrsFromPageTitle(title)
  if (!addrs.length) addrs = [...pdfIos].filter((a) => body.includes(a))
  const term = /CB105/.test(title + body) ? 'TERM105' : /CB106/.test(title + body) ? 'TERM106' : ''
  return addrs.map((addr) => {
    const a = normIo(addr)
    const hit = ioMap.get(a)
    const unit = title.match(/CB10[56]-\d/i)?.[0] || 'I/O'
    const desc = hit?.desc || `${a} ${unit}${a.startsWith('Y') ? '输出' : '输入'}`
    return { addr: a, desc, name: desc, term }
  })
}

function buildIoPages(project, of, pages, pdfText) {
  const ioMap = buildIoDescMapFromPdfPages(pdfText)
  const pdfIos = extractPdfReferenceTags(pdfText).ios
  const ioPages = pages.filter((p) => /I\/O UNIT/i.test(p.body) && /TERM10[56]/i.test(p.body))
  return ioPages.map((p, idx) => {
    const title = pageIoTitle(p.body) || 'I/O UNIT'
    const drawNo = Number((p.body.match(/\n\s*(\d+)\s*\/\s*\n/) || [])[1]) || 9 + idx
    return emptyElecJson({
      project,
      page: { no: drawNo, of, title, kind: 'io' },
      rails: dcRails(),
      columns: [],
      io: ioRowsForPage(p.body, ioMap, pdfIos),
    })
  })
}

function buildCoverToc(project, of, toc) {
  return [
    emptyElecJson({
      project,
      page: { no: 1, of, title: '封面', kind: 'cover' },
      rails: [],
      columns: [],
      notes: [`${project.machine || ''} ${project.control || ''} ${project.drawing || ''}`.trim()],
    }),
    emptyElecJson({
      project,
      page: { no: 2, of, title: toc.length ? `目录 : ${toc[0]?.title || ''}`.slice(0, 40) : '目录', kind: 'toc' },
      rails: [],
      columns: [],
      notes: toc.map((t) => `/${t.no} ${t.title}`),
    }),
  ]
}

export function docsToElecJsonFences(docs) {
  return (docs || [])
    .map((d) => `\`\`\`elec-json\n${JSON.stringify(normalizeElecJson(d))}\n\`\`\``)
    .join('\n\n')
}

export function buildElecBookFromPdf(pdfText) {
  const text = String(pdfText || '')
  if (text.length < 500) return { docs: [], error: 'PDF 文本过短' }
  let parsed
  try {
    parsed = schematicFromPdfText(text)
  } catch (e) {
    return { docs: [], error: e.message || String(e) }
  }
  const pages = splitSchematicPages(text)
  const of = pages[0]?.of || pages.length || 16
  const project = parsed.project || {}
  const toc = (parsed.toc || []).length ? parsed.toc : parseToc(pages)
  const circuits = motorCircuitsFromPdf(text)

  const powerPage = findContentPage(pages, /主回路1|电源/)
  const powerBody = powerPage?.body || ''
  const powerTitle = /主回路1/.test(powerBody) ? '主回路1' : '电源'
  const docs = [
    ...buildCoverToc(project, of, toc),
    buildPowerPage(project, of, powerBody, powerTitle),
    buildMotorPage(project, of, circuits),
    ...buildControlPages(project, of, pages, circuits),
    ...buildDrivePages(project, of, pages),
    ...buildIoPages(project, of, pages, text),
  ].filter(Boolean)

  const seenNo = new Set()
  const unique = []
  for (const d of docs) {
    const key = `${d.page?.kind}:${d.page?.title}:${d.page?.no}`
    if (seenNo.has(key)) continue
    seenNo.add(key)
    unique.push(normalizeElecJson(d))
  }
  return { docs: unique, project, toc, pages: unique.map((d) => d.page) }
}

export function looksLikePdfReplicaTask(userText) {
  return /照着|一模一样|复刻|按.{0,6}PDF|生成.{0,8}电路图|出图|画.{0,8}电路/.test(String(userText || ''))
}

/**
 * MIKROSA SASL32 电路图页结构（对照现场 EPLAN 导出：标题栏 + 主回路 + I/O）。
 */
import { emptyElecJson } from './elecJson.mjs'

export const SASL32_PROJECT = {
  machine: 'MIKROSA SASL 3/2 CNC',
  control: 'FANUC 0iF',
  serial: '26590101',
  origin: 'CCFLO+',
  drawing: 'MIKROSA SASL3/1 AE',
}

export const SASL32_TOC = [
  { no: 1, title: '标题' },
  { no: 2, title: '目录 : /1 - /20' },
  { no: 3, title: '主回路1' },
  { no: 4, title: '主回路2' },
  { no: 5, title: '冷却站' },
  { no: 6, title: '直流电源回路' },
  { no: 7, title: '控制回路1' },
  { no: 8, title: '控制回路2' },
  { no: 9, title: '砂轮导轮变频器' },
  { no: 10, title: 'CNC系统' },
  { no: 11, title: 'X1Y1Z1轴 伺服放大器' },
  { no: 12, title: 'X2Y2Z2轴 伺服放大器' },
  { no: 13, title: 'I/O UNIT CB105-1 X3.0-X3.7 X8.0-X8.4 配电柜' },
  { no: 14, title: 'I/O UNIT CB105-2 X8.5-X9.7配电柜' },
  { no: 15, title: 'I/O UNIT CB105-3 Y2.0-Y2.7配电柜' },
  { no: 16, title: 'I/O UNIT CB105-4 Y3.0-Y3.7配电柜' },
  { no: 17, title: 'I/O UNIT CB106-1 X40-X54 配电柜' },
  { no: 18, title: 'I/O UNIT CB106-2 X55-X67配电柜' },
  { no: 19, title: 'I/O UNIT CB106-3 Y40-Y47配电柜' },
  { no: 20, title: 'I/O UNIT CB106-4 Y50-Y57配电柜' },
]

const RAILS_400 = [
  { id: 'L1', label: 'L1', type: 'phase' },
  { id: 'L2', label: 'L2', type: 'phase' },
  { id: 'L3', label: 'L3', type: 'phase' },
  { id: 'PE', label: 'PE', type: 'pe' },
]

function pageMeta(no, kind) {
  const hit = SASL32_TOC.find((t) => t.no === no)
  return { no, of: 20, title: hit?.title || '', kind }
}

export function sasl32Power1() {
  return emptyElecJson({
    project: SASL32_PROJECT,
    page: pageMeta(3, 'power'),
    rails: RAILS_400,
    columns: [
      {
        i: 0,
        devices: [{ tag: '1Q1', sym: 'breaker3', rating: '2.5-4A', desc: '伺服电源', wiresOut: ['1U1', '1V1', '1W1'] }],
      },
      {
        i: 1,
        devices: [{ tag: '1Q13', sym: 'breaker3', rating: '32A', desc: '', wiresOut: ['1L1', '1L2', '1L3'] }],
      },
      {
        i: 2,
        devices: [{ tag: '1F123', sym: 'fuse', rating: '32A', desc: '', wiresOut: ['2L1', '2L2', '2L3'] }],
      },
      {
        i: 3,
        devices: [{ tag: '1T3', sym: 'transformer', rating: '2.5KVA', desc: '220V', wiresOut: ['LM0'] }],
      },
      {
        i: 4,
        devices: [{ tag: '1F9', sym: 'fuse', rating: '6A', desc: '', wiresOut: ['L02'] }],
      },
      {
        i: 5,
        devices: [{ tag: 'T2', sym: 'transformer', rating: '4kW', desc: '380/220VAC', wiresOut: ['R200', 'S200', 'T200'] }],
      },
      {
        i: 6,
        devices: [{ tag: '1F60', sym: 'fuse', rating: '25A', desc: '', wiresIn: ['R200A'] }],
      },
      {
        i: 7,
        devices: [{ tag: '1A1', sym: 'psu', rating: '24VDC 40A', desc: '直流电源', wiresOut: ['P22'] }],
      },
    ],
    xrefs: [
      { pot: 'R200', page: 11, col: 0 },
      { pot: 'ZM0', page: 5, col: 1 },
    ],
    notes: ['对照 MIKROSA SASL32 主回路1。端子/线径以现场图为准。'],
  })
}

export function sasl32TocSheet() {
  return emptyElecJson({
    project: SASL32_PROJECT,
    page: pageMeta(2, 'toc'),
    rails: [],
    columns: [],
    io: SASL32_TOC.map((t) => ({
      addr: `/${t.no}`,
      name: t.title,
      term: '',
      xref: '',
      module: '',
    })),
    notes: ['目录页'],
  })
}

export function sasl32IoCb105() {
  return emptyElecJson({
    project: SASL32_PROJECT,
    page: pageMeta(13, 'io'),
    rails: [
      { id: 'P04', label: 'P04', type: 'phase' },
      { id: 'ZM0', label: 'ZM0', type: 'pe' },
    ],
    columns: [
      { i: 0, devices: [{ tag: 'CB105-1', sym: 'io', rating: '', desc: 'I/O UNIT CB105-1' }] },
    ],
    io: [
      { addr: 'X3.0', name: '急停', term: 'X82', xref: '/16.4', module: 'CB105-1' },
      { addr: 'X3.1', name: '磨削循环', term: 'X80', xref: '/16.2', module: 'CB105-1' },
      { addr: 'X3.2', name: '砂轮修整循环', term: 'X37', xref: '/16.1', module: 'CB105-1' },
      { addr: 'X3.3', name: '导轮修整循环', term: 'X36', xref: '/16.1', module: 'CB105-1' },
      { addr: 'X8.0', name: '下托板微进', term: 'X81', xref: '/16.3', module: 'CB105-1' },
      { addr: 'X8.1', name: '下托板微退', term: '', xref: '', module: 'CB105-1' },
    ],
    notes: ['I/O 名称来自现场图文字，地址以原图为准。'],
  })
}

export function sasl32ServoXyz() {
  return emptyElecJson({
    project: SASL32_PROJECT,
    page: pageMeta(11, 'drive'),
    rails: [
      { id: 'R200', label: 'R200', type: 'phase' },
      { id: 'S200', label: 'S200', type: 'phase' },
      { id: 'T200', label: 'T200', type: 'phase' },
      { id: 'PE', label: 'PE', type: 'pe' },
    ],
    columns: [
      { i: 1, devices: [{ tag: 'X1', sym: 'servo', rating: 'aiSV', desc: 'X1轴', wiresOut: ['CZ5L'] }] },
      { i: 3, devices: [{ tag: 'Z1', sym: 'motor3', rating: '3+PE', desc: 'Z1轴', wiresIn: ['CZ5M'] }] },
      { i: 5, devices: [{ tag: 'Y1', sym: 'motor3', rating: '3+PE', desc: 'Y1轴', wiresIn: ['CZ5N'] }] },
      { i: 7, devices: [{ tag: 'COP10A', sym: 'other', rating: '', desc: 'FSSB', wiresOut: [] }] },
    ],
    notes: ['FANUC 0iF 伺服页示意，端子以原图为准。'],
  })
}

export function listSasl32Templates() {
  return [
    { id: 'toc', label: '目录', build: sasl32TocSheet },
    { id: 'power1', label: '主回路1', build: sasl32Power1 },
    { id: 'servo', label: 'X1Y1Z1轴 伺服放大器', build: sasl32ServoXyz },
    { id: 'io', label: 'I/O UNIT CB105-1', build: sasl32IoCb105 },
  ]
}

export function buildSasl32Sheet(id = 'power1') {
  const hit = listSasl32Templates().find((t) => t.id === id) || listSasl32Templates()[1]
  return hit.build()
}

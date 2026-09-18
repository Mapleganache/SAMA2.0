/**
 * 按磨床体系生成可对照现场习惯的程序（不是把所有机床写成同一种 ISO）。
 */
import { dialectInfo } from './grindDialect.mjs'
import { fmtAllow, fmtMm as fmt, fmtSize, fmtUm, GRIND_UNIT_NOTE } from './grindUnits.mjs'

function dOf(dims) {
  if (dims.d != null) return dims.d
  if (dims.steps?.[0]?.d != null) return dims.steps[0].d
  return null
}

function LOf(dims) {
  if (dims.L != null) return dims.L
  if (dims.totalL != null) return dims.totalL
  if (dims.steps?.[0]?.L != null) return dims.steps[0].L
  return null
}

function stockOf(dims, d) {
  if (dims.stock != null) return dims.stock
  if (dims.steps?.[0]?.stock != null) return dims.steps[0].stock
  return d != null ? d + 0.3 : null
}

function head(dims, extra) {
  const info = dialectInfo(dims.dialect)
  const machine = dims.machine || info.label
  return [`(机床: ${machine})`, `(体系: ${info.label} / ${info.pack})`, `(${GRIND_UNIT_NOTE})`, extra].filter(Boolean)
}

function grindFaceComment(dims) {
  const d = dOf(dims)
  const L = LOf(dims)
  const bits = []
  if (d != null) bits.push(`φ${fmtSize(d)}`)
  if (L != null) bits.push(`×${fmtSize(L)}`)
  if (dims.type === 'taper' && dims.d_large != null) {
    return `锥度 φ${fmtSize(dims.d_large)} → φ${fmtSize(dims.d_small)} L${fmtSize(dims.L)}`
  }
  return bits.join('') || '磨削'
}

export function buildMikrosaSasl(dims) {
  const d = dOf(dims)
  const L = LOf(dims) || 20
  const stock = stockOf(dims, d)
  const radial = d != null && stock != null ? Math.max(0.05, (stock - d) / 2) : 0.15
  const y0 = 10

  if (dims.type === 'dress') {
    const w = LOf(dims) || 40
    return [
      '%',
      'O1111 (DATA SET 修整廓形 示意点数)',
      '(MIKROSA SASL32 砂轮修整：本机循环 O8201，禁止按工件外圆纵磨)',
      `(砂轮宽约 ${fmt(w)}，下机床前按画面/对刀改 #640/#680)`,
      '#524=4',
      '#640=0',
      `#680=${fmt(w + 2)}`,
      '#641=0',
      `#681=${fmt(w)}`,
      '#642=0',
      '#682=0',
      '#643=0',
      `#683=${fmt(-(w))}`,
      'G65 P8201',
      'M30',
      '%',
    ].join('\n')
  }

  return [
    '%',
    'O8001 (MIKROSA SASL32 JOB)',
    ...head(dims, `(无心磨 ${grindFaceComment(dims)}：Y 切入，禁止 G01 X直径 Z纵走)`),
    '(本机磨削主程序 O8205，回零 O8500，修整 O8201，廓形 O1111)',
    '(#540 必须改成画面当前磨削位；其余按余量相对 #540 递减，须 #540>#541>…≥0)',
    d != null
      ? `(目标直径 φ${fmtSize(d)}` +
        (stock != null ? ` 毛坯 φ${fmtSize(stock)} 余量 ${fmtAllow(d, stock)}` : '') +
        ')'
      : '',
    `(Y 切入阶梯 粗 ${fmtUm(radial * 0.55)} / 精 ${fmtUm(radial * 0.2)} / 光磨 ${fmtUm(radial * 0.08)})`,
    'IF[#540GT0]GOTO10',
    `#540=${fmt(y0)}`,
    'N10',
    `#541=#540-${fmt(radial * 0.55)}`,
    `#542=#540-${fmt(radial * 0.8)}`,
    `#543=#540-${fmt(radial * 0.92)}`,
    `#544=#540-${fmt(radial * 0.98)}`,
    `#545=#540-${fmt(radial)}`,
    '(进给 #546≤200  #547≤50  #548/#549/#550≤1，与 O8205 互锁一致)',
    '#546=80',
    '#547=20',
    '#548=0.4',
    '#549=0.2',
    '#550=0.08',
    '#551=1',
    'G54 G98',
    'M96 P8500',
    'M98 P8205',
    'M30',
    '%',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export function buildGaoqiaoFanuc(dims) {
  const d = dOf(dims)
  const L = LOf(dims) || 21
  const machine = dims.machine || '高桥 CNC FANUC'

  if (dims.type === 'dress') {
    return [
      '%',
      'O0510 (GAOQIAO DRESS)',
      `(机床: ${machine})`,
      '(修整：X=0 附近为接触，Z 走砂轮宽。禁止按工件 φ 写成 X直径)',
      'M21',
      'G99 T01',
      'G01 X-0.5 Z2. F10',
      'X0. F1',
      `Z-${fmt(LOf(dims) || 40)} F200`,
      'U0.2',
      'G01 X-140. Z60. F10',
      'M30',
      '%',
    ].join('\n')
  }

  if (dims.type === 'bore' || dims.process === 'id') {
    const r = d != null ? d / 2 : 20
    return [
      '%',
      'O0003 (GAOQIAO ID GRIND)',
      `(机床: ${machine})`,
      `(内圆磨衬套 孔约 φ${d != null ? fmt(d) : '?'} 深 ${fmt(L)}，X 按该机偏移坐标系)`,
      'M21',
      'M08',
      'G01 G99 S600 M04 T01',
      `G01 X-${fmt(r + 1)} Z2.0 F10.0`,
      `G90 X-${fmt(r + 0.6)} Z-${fmt(L)} F1.0`,
      `X-${fmt(r + 0.1)}`,
      `X-${fmt(r + 0.05)}`,
      'G01 X-80.0 Z60.0 F10.0',
      'M05',
      'M30',
      '%',
    ].join('\n')
  }

  if (dims.type === 'plunge' || dims.process === 'od_plunge') {
    return [
      '%',
      'O0002 (GAOQIAO PLUNGE OSCILLATION)',
      `(机床: ${machine})`,
      `(短轴颈切入振荡 成品 φ${d != null ? fmt(d) : '?'} 宽 ${fmt(L)}，X=0 为成品)`,
      'M21',
      'M08',
      'G99 S360 M04 T01',
      `G01 X-0.5 Z${fmt(Math.min(8, L))} F8.0`,
      'Z0.0 F2.0',
      'G01 X0.0 F0.5',
      'M98 P0022 L25',
      'X-150. F30.',
      'Z60.',
      'S80 M04',
      'M09',
      'M05',
      'M30',
      '',
      'O0022 (OSCILLATION SUB)',
      'G01 U0.01 F0.5',
      `Z${fmt(Math.min(7.6, L))} F0.5`,
      'Z0.0 F2.0',
      'M99',
      '%',
    ].join('\n')
  }

  if (dims.type === 'face') {
    return [
      '%',
      'O0005 (GAOQIAO FACE)',
      `(机床: ${machine})`,
      `(轴肩端面 Z 向切入，X=0 成品侧，停靠 φ${d != null ? fmt(d) : '?'})`,
      'M21',
      'G99 S200 M04 T01',
      'G01 X-0.5 Z1. F8',
      'X0. F0.5',
      'G01 Z0.20 F0.3',
      'Z0 F0.08',
      'G04 U1.0',
      'G01 X-140. Z60. F10',
      'M30',
      '%',
    ].join('\n')
  }

  return [
    '%',
    'O0001 (GAOQIAO OD TRAVERSE)',
    `(机床: ${machine})`,
    `(外圆纵磨 ${grindFaceComment(dims)}，X=0 为成品直径，Z-${fmt(L)} 为长度)`,
    'M08',
    'M21',
    'G99 S550 M04 T01',
    `G01 X${fmt(-0.05)} Z0 F10.0    (${fmtUm(0.05)} 靠近)`,
    `X${fmt(0.001)} F0.1             (微切入 ${fmtUm(0.001)})`,
    `Z-${fmt(L)} U${fmt(0.0005)} F0.1   (纵磨，U 补偿 ${fmtUm(0.0005)})`,
    `U${fmt(-0.05)} F2.0`,
    'Z0',
    `X${fmt(0.003)} F0.2             (${fmtUm(0.003)})`,
    'G04 U1.0',
    `Z-${fmt(L)} U${fmt(0.0005)} F0.08`,
    `U${fmt(-0.05)}`,
    'Z0 F2.0',
    `X${fmt(0.0055)} F1.0            (终档过零 ${fmtUm(0.0055)})`,
    'G04 U1.0',
    `Z-${fmt(L)} U${fmt(0.0005)} F0.04`,
    `U${fmt(0.2)}`,
    `G01 X${fmt(-140)} Z${fmt(60)} F10.0`,
    'M05',
    'M30',
    '%',
  ].join('\n')
}

export function buildStuderSiemens(dims) {
  const d = dOf(dims)
  const L = LOf(dims) || 40
  const stock = stockOf(dims, d)
  const contact = stock != null ? stock : d != null ? d + 0.15 : 30.15

  if (dims.type === 'dress') {
    const w = LOf(dims) || 40
    return [
      '%_N_LRXSL_MPF',
      ';$PATH=/_N_MPF_DIR',
      `; STUDER ${dims.machine || 'S40'}  砂轮外圆修整`,
      `; G55 = 修整坐标系  ${GRIND_UNIT_NOTE}`,
      `R1=${fmt(-0.03)}      ; 粗修每刀 ${fmtUm(0.03)}（直径）`,
      'R2=200',
      'R3=8',
      `R5=${fmt(-0.01)}      ; 精修每刀 ${fmtUm(0.01)}`,
      'R6=80',
      'R7=4',
      'R10=0.0',
      'R11=2.0',
      `R12=-${fmt(w + 2)}`,
      'G55',
      'T1 D2',
      'G90 G01 X50. F5000',
      'M07',
      'Z=R11',
      'X=R10+5. F2000',
      'X=R10 F20',
      'R100=R1',
      'R101=R2',
      'MSG("粗修")',
      'L100 P=R3',
      'R100=R5',
      'R101=R6',
      'MSG("精修")',
      'L100 P=R7',
      'G91 G01 X10 F2000',
      'M09',
      'G90 G01 X50. F5000',
      'M30',
      '',
      '%_N_L100_MPF',
      ';$PATH=/_N_MPF_DIR',
      'G91 G01 X=R100 F2.',
      'G90 Z=R12 F=R101',
      'G91 G01 X=R100 F2.',
      'G90 Z=R11 F=R101',
      'M17',
    ].join('\n')
  }

  if (dims.type === 'plunge') {
    return [
      '%_N_LRMWYQR_MPF',
      ';$PATH=/_N_MPF_DIR',
      `; STUDER ${dims.machine || 'S40'}  外圆切入磨  ${grindFaceComment(dims)}`,
      'R34=180',
      `R60=${fmt(contact)}`,
      'R61=0.0',
      `R62=${fmt(-0.15)}     ; 粗切入 ${fmtUm(0.15)}（直径）`,
      `R63=${fmt(-0.05)}     ; 精切入 ${fmtUm(0.05)}`,
      'R64=8',
      'R65=2',
      'R66=2.0',
      'G54',
      'M03 S=R34',
      'G90 G01 X100. F5000',
      'M07',
      'M10',
      'Z=R61+1',
      'X=R60+5. F2000',
      'X=R60 F20',
      'Z=R61 F50.',
      'G01 G91 X=R62 F=R64',
      'G01 G91 X=R63 F=R65',
      'G04 F=R66',
      'G91 G01 X10 F2000',
      'M05',
      'M09',
      'G90 G01 X100. F5000',
      'M30',
    ].join('\n')
  }

  if (dims.type === 'face') {
    const xPark = d != null ? d + 1 : 29
    return [
      '%_N_LRMDMQR_MPF',
      ';$PATH=/_N_MPF_DIR',
      `; STUDER ${dims.machine || 'S40'}  轴肩端面切入磨`,
      'R34=120',
      `R70=${fmt(xPark)}`,
      `R71=${fmt(0.2)}      ; 端面余量 ${fmtUm(0.2)}`,
      `R72=${fmt(-0.12)}     ; 粗切 ${fmtUm(0.12)}`,
      `R73=${fmt(-0.04)}     ; 精切 ${fmtUm(0.04)}`,
      'R74=6',
      'R75=1.5',
      'R76=1.5',
      'G54',
      'M03 S=R34',
      'G90 G01 X100. F5000',
      'M07',
      'Z=R71+1',
      'X=R70 F20',
      'Z=R71 F50.',
      'G01 G91 Z=R72 F=R74',
      'G01 G91 Z=R73 F=R75',
      'G04 F=R76',
      'G91 Z1. F100.',
      'G91 G01 X10 F2000',
      'M05',
      'M09',
      'G90 G01 X100. F5000',
      'M30',
    ].join('\n')
  }

  const dFinish = d != null ? d : 30
  return [
    '%_N_LRMWY_MPF',
    ';$PATH=/_N_MPF_DIR',
    `; 机床: ${dims.machine || 'STUDER S40'}    系统: Siemens 840D`,
    `; 工件: ${grindFaceComment(dims)} 外圆纵磨`,
    `; 成品直径 φ${fmtSize(dFinish)}  行程 Z=${fmt(2)} → ${fmt(-L)}`,
    `R15=${fmt(contact)}`,
    `R16=${fmt(2)}`,
    `R17=-${fmt(L)}`,
    'R19=0',
    `R20=${fmt(-0.02)}    ; 粗磨每行程 ${fmtUm(0.02)}（直径）`,
    'R21=400',
    'R22=6',
    'R23=0.5',
    `R25=${fmt(-0.005)}    ; 精磨每行程 ${fmtUm(0.005)}`,
    'R26=200',
    'R27=4',
    'R31=120',
    'R32=3',
    'R34=150',
    'G54',
    'T1 D2',
    'G90 G01 X100. F5000',
    'M03 S=R34',
    'M07',
    'Z=R16',
    'X=R15+5. F2000',
    'X=R15 F20',
    'R102=R20',
    'R103=R21',
    'MSG("粗磨")',
    'L101 P=R22',
    'R102=R25',
    'R103=R26',
    'MSG("精磨")',
    'L101 P=R27',
    'R102=0',
    'R103=R31',
    'MSG("光磨")',
    'L101 P=R32',
    'G91 G01 X10 F2000',
    'M09',
    'M05',
    'G90 G01 X100. F5000',
    'M30',
    '',
    '%_N_L101_MPF',
    ';$PATH=/_N_MPF_DIR',
    'G91 G01 X=R102 F2.',
    'G90 Z=R17 F=R103',
    'G04 F=R23',
    'G91 G01 X=R102 F2.',
    'G90 Z=R16 F=R103',
    'G04 F=R23',
    'M17',
  ].join('\n')
}

export function buildFanucG75(dims) {
  const d = dOf(dims) || 16
  const L = LOf(dims) || 20
  const stock = stockOf(dims, d)
  const k = stock != null ? Math.round((stock - d) * 10000) / 10000 : 0.4
  return [
    '%',
    'O1009 (FANUC G75 PLUNGE GRIND)',
    ...head(dims, `(销轴/轴颈 ${grindFaceComment(dims)} 切入磨，不是车床切槽)`),
    'G21 G90 G94',
    'T0101',
    'M03 S1800',
    'M04 S200',
    'M08',
    `G00 X${fmt(d + 4)} Z${fmt(10)}`,
    `G00 Z-${fmt(L / 2)}`,
    `G01 X${fmt(d + k)} F50`,
    `(G75 I ${fmtUm(0.02)}  J ${fmtUm(0.008)}  K总深 ${fmtUm(k)}  成品 φ${fmtSize(d)})`,
    `G75 I${fmt(-0.02)} J${fmt(-0.008)} K-${fmt(k)} Z${fmt(L)} R0.4 F800 P400 L1`,
    `G00 X${fmt(d + 24)}`,
    'G00 Z50.0',
    'M09',
    'M05',
    'M30',
    '%',
  ].join('\n')
}

export function buildFanucG78(dims) {
  const L = LOf(dims) || 120
  const k = 0.2
  return [
    '%',
    'O1010 (FANUC G78 SURFACE GRIND)',
    ...head(dims, `(平面磨 行程约 ${fmtSize(L)}，Z 切深 ${fmtUm(k)}，不要写成外圆纵磨)`),
    'G21 G90 G94',
    'T0101',
    'M03 S1450',
    'M08',
    'G00 Z50.0',
    'G00 X-5.0 Y0',
    'G00 Z2.0',
    `G01 Z${fmt(k)} F80`,
    `G78 I${fmt(-0.02)} J${fmt(-0.01)} K-${fmt(k)} X${fmt(L + 10)} R0.3 F12000 P200 L1`,
    'G00 Z50.0',
    'M09',
    'M05',
    'M30',
    '%',
  ].join('\n')
}

export function buildSiemens4071(dims) {
  const d = dOf(dims) || 25
  const L = LOf(dims) || 100
  const stock = stockOf(dims, d)
  return [
    '%_N_OD_TRAVERSE_MPF',
    ';$PATH=/_N_MPF_DIR',
    `; Siemens 840D sl  CYCLE4071  ${grindFaceComment(dims)}`,
    'N05 G90 G94 G54',
    'N10 T1 D1',
    'N12 M03 S160',
    'N14 M07',
    `N16 G00 X${fmt(d + 15)} Z5`,
    `N18 G01 X${fmt(stock || d + 0.3)} Z2 F200`,
    `N20 CYCLE4071(0.02,0.01,${fmt(L)},1,1,1000,2)`,
    `; 成品 φ${fmt(d)}  宽度 ${fmt(L)}`,
    `N22 G00 X${fmt(d + 55)}`,
    'N24 M09',
    'N26 M05',
    'N30 M30',
  ].join('\n')
}

export function buildSiemens4075(dims) {
  const L = LOf(dims) || 100
  return [
    '%_N_SURF_4075_MPF',
    ';$PATH=/_N_MPF_DIR',
    `; CYCLE4075 平面磨削 行程 ${fmt(L)}`,
    'N05 G90 G94 G54',
    'N10 T1 D1',
    'N12 M03 S1450',
    'N14 M08',
    'N16 G00 Z20',
    'N18 G00 X0 Y0',
    'N19 G01 Z0.5 F200',
    `N20 CYCLE4075(0.02,0.01,1,${fmt(L)},1,1000,1)`,
    'N22 G00 Z20',
    'N24 M09',
    'N26 M05',
    'N30 M30',
  ].join('\n')
}

export function buildNumFlexium(dims) {
  const steps = Array.isArray(dims.steps) && dims.steps.length ? dims.steps : null
  const d = dOf(dims) || 28
  const L = LOf(dims) || 25
  const lines = [
    '%',
    'O1012 (NUM G200/G206)',
    ...head(dims, `(NUMgrind ${grindFaceComment(dims)})`),
    'G90 G94 G54',
    'T1 M06',
    'G230',
    'M03 S200',
  ]
  if (dims.type === 'plunge' || dims.process === 'od_plunge' || !steps) {
    lines.push(`G00 X${fmt(d + 22)} Z-${fmt(L / 2)}`)
    lines.push(`G00 X${fmt(d + 2)}`)
    lines.push('G200')
    lines.push(`(G200 切入 成品 φ${fmt(d)} 宽 ${fmt(L)})`)
  }
  if (dims.type === 'step_shaft' && steps && steps.length >= 2) {
    const a = steps[0]
    const b = steps[1]
    lines.push(`G00 X${fmt((a.d || d) + 22)} Z-${fmt((a.L || L) / 2)}`)
    lines.push('G200')
    lines.push(`(G200 切入 φ${fmt(a.d)}×${fmt(a.L)})`)
    lines.push(`G00 X${fmt((b.d || d) + 30)}`)
    lines.push(`G00 Z-${fmt(b.L || L)}`)
    lines.push('G206')
    lines.push(`(G206 纵磨 φ${fmt(b.d)} 行程 ${fmt(b.L)})`)
  } else if (dims.type === 'shaft' || dims.process === 'od_traverse') {
    lines.push(`G00 X${fmt(d + 22)} Z-${fmt(L)}`)
    lines.push(`G00 X${fmt(d + 2)}`)
    lines.push('G206')
    lines.push(`(G206 纵磨 φ${fmt(d)} 行程 ${fmt(L)})`)
  }
  lines.push(`G00 X${fmt(d + 52)} Z80`)
  lines.push('M09', 'M05', 'M30', '%')
  return lines.join('\n')
}

export function buildYingbeiMd(dims) {
  return [
    '%',
    'O0003 (YINGBEI SURFACE GRIND)',
    ...head(dims, `(平面磨 ${grindFaceComment(dims)}，Y 为切入，变量由 HMI 写入)`),
    'M98 P1300',
    'M98 P1200',
    'G91',
    'G01 Y-#515 F#530',
    'G04 X1.0',
    'M98 P1000',
    'G90',
    'G01 Y-#121 F#522',
    'G04 X#507',
    'G01 Y-#501 F#524',
    'G04 X#508',
    'M02',
    '%',
  ].join('\n')
}

export function buildCenterlessThru(dims) {
  const d = dOf(dims)
  const L = LOf(dims)
  return [
    '%',
    'O7001 (CENTERLESS THRU-FEED)',
    ...head(dims, '(无心通磨：导轮倾角/速度决定通磨，禁止外圆磨 X/Z 纵走)'),
    d != null ? `(目标直径 φ${fmtSize(d)})` : '',
    L != null ? `(通磨长度 ${fmtSize(L)}mm)` : '',
    '(未绑定 MIKROSA/KRONOS 宏包时只给工艺说明，下机床用本机画面)',
    'M30',
    '%',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildByDialect(dims, isoBuilder) {
  const dialect = dims?.dialect || 'iso_generic'
  switch (dialect) {
    case 'mikrosa_sasl':
      return buildMikrosaSasl(dims)
    case 'gaoqiao_fanuc':
      return buildGaoqiaoFanuc(dims)
    case 'studer_siemens':
      return buildStuderSiemens(dims)
    case 'fanuc_g75':
      return buildFanucG75(dims)
    case 'fanuc_g78':
      return buildFanucG78(dims)
    case 'siemens_4071':
      return buildSiemens4071(dims)
    case 'siemens_4075':
      return buildSiemens4075(dims)
    case 'num_flexium':
      return buildNumFlexium(dims)
    case 'yingbei_md':
      return buildYingbeiMd(dims)
    case 'centerless_thru':
      return buildCenterlessThru(dims)
    case 'studer_iso':
    case 'iso_generic':
    default:
      return isoBuilder(dims)
  }
}

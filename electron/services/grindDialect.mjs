/**
 * 磨床出码体系：按机床/系统选 post，禁止一律写成 ISO 纵磨示意。
 */

export const DIALECTS = {
  mikrosa_sasl: {
    id: 'mikrosa_sasl',
    label: 'MIKROSA SASL32 无心磨（FANUC 宏包）',
    pack: 'GW PROGRAM O8205/O8201/O1111',
  },
  gaoqiao_fanuc: {
    id: 'gaoqiao_fanuc',
    label: '高桥 FANUC 外圆/万能磨',
    pack: 'X=0 为成品，Z 为长度',
  },
  studer_siemens: {
    id: 'studer_siemens',
    label: 'STUDER Siemens 840D',
    pack: 'R 参数 + L101/L100',
  },
  studer_iso: {
    id: 'studer_iso',
    label: 'STUDER/favorit FANUC 直径编程',
    pack: 'G00/G01 X=工件直径',
  },
  fanuc_g75: {
    id: 'fanuc_g75',
    label: 'FANUC G75 外圆切入循环',
    pack: 'G75',
  },
  fanuc_g78: {
    id: 'fanuc_g78',
    label: 'FANUC G78 平面磨削循环',
    pack: 'G78',
  },
  siemens_4071: {
    id: 'siemens_4071',
    label: 'Siemens CYCLE4071 外圆纵磨',
    pack: 'CYCLE4071',
  },
  siemens_4075: {
    id: 'siemens_4075',
    label: 'Siemens CYCLE4075 平面磨',
    pack: 'CYCLE4075',
  },
  num_flexium: {
    id: 'num_flexium',
    label: 'NUM Flexium NUMgrind',
    pack: 'G200/G206',
  },
  yingbei_md: {
    id: 'yingbei_md',
    label: '鹰贝 MD 平面磨',
    pack: 'Y 切入 + M98',
  },
  centerless_thru: {
    id: 'centerless_thru',
    label: '无心通磨（未绑定厂家宏包）',
    pack: '导轮通磨，无 X/Z 纵走',
  },
  iso_generic: {
    id: 'iso_generic',
    label: '通用 ISO 示意（未识别厂家）',
    pack: 'G00/G01 直径编程',
  },
}

export function dialectInfo(id) {
  return DIALECTS[id] || DIALECTS.iso_generic
}

/**
 * @param {string} text
 * @param {{ machine?: string, control?: string, dialect?: string, process?: string, type?: string }} [dims]
 */
export function resolveGrindDialect(text, dims = {}) {
  if (dims.dialect && DIALECTS[dims.dialect]) return dims.dialect
  const src = `${dims.machine || ''} ${dims.control || ''} ${text || ''}`

  if (/高桥/.test(src)) return 'gaoqiao_fanuc'
  if (/米克罗莎|SASL\s*3|SASL32|SASL3\/2|MIKROSA/i.test(src) && !/KRONOS/i.test(src)) {
    return 'mikrosa_sasl'
  }
  if (/KRONOS/i.test(src)) return 'centerless_thru'
  if (/鹰贝|MD\s*600|YINGBEI/i.test(src)) return 'yingbei_md'
  if (/\bNUM\b|Flexium|NUMgrind/i.test(src)) return 'num_flexium'

  const siemens = /Siemens|840D|SINUMERIK|CYCLE407/i.test(src)
  const studer = /STUDER|favoritCNC/i.test(src)
  const fanuc = /FANUC/i.test(src)
  const process = String(dims.process || dims.type || '')
  const surface = /平面|垫板|G78|CYCLE4075/i.test(src)

  if (fanuc && surface && !studer) return 'fanuc_g78'
  if (siemens && surface && !studer) return 'siemens_4075'
  if (/G75|磨床循环/i.test(src) && fanuc && !studer && !/高桥/.test(src)) return 'fanuc_g75'
  if (siemens && !studer) return 'siemens_4071'
  if (studer && (siemens || /\bS40\b/i.test(src))) return 'studer_siemens'
  if (studer || /favoritCNC/i.test(src)) return 'studer_iso'

  if (/无心|通磨|centerless/i.test(src)) return 'centerless_thru'
  if (fanuc && /plunge|od_plunge|切入/i.test(process) && !/高桥/.test(src)) return 'fanuc_g75'

  return 'iso_generic'
}

export function dialectHardRules(dialect) {
  switch (dialect) {
    case 'mikrosa_sasl':
      return '本机是 MIKROSA SASL32 无心磨。禁止写成 G01 X直径 Z纵走。磨削必须填 #540～#550（Y 切入阶梯，#540>#541>…≥0）并调用本机 O8205；修整调用 O8201，廓形在 O1111 的 #640/#680。X/Z 只用于修整，不是工件直径编程。'
    case 'gaoqiao_fanuc':
      return '高桥 FANUC：X=0 为成品直径，禁止把成品写成 X{φ}。Z 才是磨削长度（Z21≠φ21）。用 G99、M21、T01。短轴颈切入振荡用 M98 P0022。'
    case 'studer_siemens':
      return 'STUDER Siemens 840D：纵磨用 R 参数 + L101 子程序；切入用 G91 X；端面用 G91 Z；修整用 G55 + L100。禁止改成 ISO「G01 X成品 Z-长度」示意段，也禁止铣削 T1 M6 / G81。'
    case 'studer_iso':
      return 'STUDER/favorit 直径编程：X 是工件直径正值（φ40 写 X40）。Z0=左端，向右为负。禁止铣削换刀 T1 M6。'
    case 'fanuc_g75':
      return 'FANUC 磨床 G75 切入循环（不是车床切槽）。写出 G75 I/J/K/Z/R/F/P，成品直径与轴颈宽度必须出现。'
    case 'fanuc_g78':
      return 'FANUC 平面磨 G78。工作台往复，Z 为切深，不要写成外圆 X/Z 纵磨。'
    case 'siemens_4071':
      return 'Siemens 840D 外圆纵磨用 CYCLE4071，不要改成 FANUC G01 示意。'
    case 'siemens_4075':
      return 'Siemens 840D 平面磨用 CYCLE4075，不要改成外圆纵磨。'
    case 'num_flexium':
      return 'NUM Flexium：切入用 G200，纵磨用 G206。厂家循环不要替换成 ISO 纵磨模板。'
    case 'yingbei_md':
      return '鹰贝平面磨：Y 为切入轴，主程序调 M98 子程序。不要写成外圆 X 直径编程。'
    case 'centerless_thru':
      return '无心通磨：目标直径与通磨长度写在注释/参数里。禁止套外圆磨 G01 X直径 Z纵走。'
    default:
      return '未识别厂家时才用 ISO G00/G01 示意（X=工件直径）。图上有机床型号就必须走对应体系，不要改写成铣床。'
  }
}

export function usesIsoDiameter(dialect) {
  return dialect === 'studer_iso' || dialect === 'iso_generic'
}

/** 程序已经是该体系的厂家循环/宏，校验通过即可保留 */
export function ncLooksLikeDialect(nc, dialect) {
  const s = String(nc || '')
  switch (dialect) {
    case 'mikrosa_sasl':
      return /#540|O8205|M96\s*P8500|G65\s*P8201|#640/i.test(s)
    case 'gaoqiao_fanuc':
      return /M21|G99|M98\s*P0022|G97/.test(s) || /X\s*0(?:\.0+)?\b/.test(s)
    case 'studer_siemens':
      return /\bL10[01]\b|R1[5-7]\s*=|R60\s*=|R70\s*=|\$P_UIFR/i.test(s)
    case 'fanuc_g75':
      return /\bG75\b/.test(s)
    case 'fanuc_g78':
      return /\bG78\b/.test(s)
    case 'siemens_4071':
      return /CYCLE4071/i.test(s)
    case 'siemens_4075':
      return /CYCLE4075/i.test(s)
    case 'num_flexium':
      return /\bG200\b|\bG206\b|\bG230\b/.test(s)
    case 'yingbei_md':
      return /M98\s*P1[234]00|#515|Y-#/.test(s)
    case 'centerless_thru':
      return /无心|通磨|导轮|centerless/i.test(s)
    default:
      return false
  }
}

/** ISO 直径纵磨示意：用来判断「写错体系」 */
export function looksLikeIsoDiameterProgram(nc) {
  const s = String(nc || '')
  if (/\bG75\b|\bG78\b|\bG200\b|CYCLE407|#540|\bL10[01]\b|M98\s*P0022/i.test(s)) return false
  return /\bG0*1\b/i.test(s) && /\bX\s*\d{2,}/i.test(s) && /\bZ\s*-?\d/i.test(s)
}

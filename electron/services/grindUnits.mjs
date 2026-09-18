/**
 * 磨床单位：程序坐标仍是 G21 毫米，磨削量按微米、一位小数（0.1μm）。
 * 0.1μm = 0.0001mm，NC 小数须留到四位，不能用 toFixed(3) 把进给磨没。
 */

export function toUm(mm) {
  const n = Number(mm)
  return Number.isFinite(n) ? n * 1000 : NaN
}

/** 微米，固定一位小数：300.0μm */
export function fmtUm(mm) {
  const um = toUm(mm)
  if (!Number.isFinite(um)) return String(mm)
  const v = Math.round(um * 10) / 10
  const s = v.toFixed(1)
  return `${s === '-0.0' ? '0.0' : s}μm`
}

/** 外形尺寸（直径/长度）注释：毫米一位小数 */
export function fmtSize(mm) {
  const n = Number(mm)
  if (!Number.isFinite(n)) return String(mm)
  const v = Math.round(n * 10) / 10
  const s = v.toFixed(1)
  return s === '-0.0' ? '0.0' : s
}

/**
 * 写入 NC 的毫米数。
 * |v|<1：磨削增量，固定四位小数（0.1μm）。
 * 其余：外形/定位，一位小数。
 */
export function fmtMm(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  const q = Math.round(n * 10000) / 10000
  if (Math.abs(q) < 5e-8) return '0'
  if (Math.abs(q) < 1) {
    const s = q.toFixed(4)
    return s === '-0.0000' ? '0' : s
  }
  const s = q.toFixed(1)
  return s === '-0.0' ? '0' : s
}

export function fmtAllow(finish, stock) {
  if (finish == null || stock == null) return null
  const n = Number(stock) - Number(finish)
  if (!Number.isFinite(n)) return null
  return fmtUm(Math.abs(n))
}

export const GRIND_UNIT_NOTE = '程序坐标 G21 毫米；余量/进给/补偿按 μm，一位小数（0.1μm）'

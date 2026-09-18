/**
 * MachineProfile — 含支持 G/M 清单（V1.1）
 */

const FANUC_G = [
  0, 1, 2, 3, 17, 18, 19, 20, 21, 28, 40, 41, 42, 43, 49, 54, 55, 56, 57, 58, 59, 80, 81, 82, 83, 84, 85,
  90, 91, 94, 98, 99,
]
const FANUC_M = [0, 1, 2, 3, 4, 5, 6, 8, 9, 30, 98, 99]

export const BUILTIN_PROFILES = {
  FANUC_MILL: {
    id: 'FANUC_MILL',
    name: 'FANUC 三轴铣',
    controller: 'FANUC',
    axes: ['X', 'Y', 'Z'],
    travel: { X: [-500, 500], Y: [-300, 300], Z: [-400, 100] },
    maxSpindle: 8000,
    maxFeed: 5000,
    minSpindle: 50,
    minFeed: 1,
    toolSlots: 24,
    supportedG: FANUC_G,
    supportedM: FANUC_M,
  },
  FANUC_MILL_LARGE: {
    id: 'FANUC_MILL_LARGE',
    name: 'FANUC 大行程铣',
    controller: 'FANUC',
    axes: ['X', 'Y', 'Z'],
    travel: { X: [-5, 2000], Y: [-5, 2000], Z: [-500, 300] },
    maxSpindle: 12000,
    maxFeed: 5000,
    minSpindle: 50,
    minFeed: 1,
    toolSlots: 32,
    supportedG: FANUC_G,
    supportedM: FANUC_M,
  },
  FANUC_0I_MF: {
    id: 'FANUC_0I_MF',
    name: 'FANUC 0i-MF',
    controller: 'FANUC',
    axes: ['X', 'Y', 'Z'],
    travel: { X: [-400, 400], Y: [-250, 250], Z: [-350, 80] },
    maxSpindle: 8000,
    maxFeed: 10000,
    minSpindle: 50,
    minFeed: 1,
    toolSlots: 20,
    supportedG: FANUC_G,
    supportedM: FANUC_M,
  },
}

export function getMachineProfile(idOrPartial) {
  if (!idOrPartial) return { ...BUILTIN_PROFILES.FANUC_MILL_LARGE }
  if (typeof idOrPartial === 'string') {
    return { ...(BUILTIN_PROFILES[idOrPartial] || BUILTIN_PROFILES.FANUC_MILL) }
  }
  const base = BUILTIN_PROFILES[idOrPartial.id] || BUILTIN_PROFILES.FANUC_MILL_LARGE
  return {
    ...base,
    ...idOrPartial,
    travel: { ...base.travel, ...(idOrPartial.travel || {}) },
    supportedG: idOrPartial.supportedG || base.supportedG,
    supportedM: idOrPartial.supportedM || base.supportedM,
  }
}

export function listMachineProfiles() {
  return Object.values(BUILTIN_PROFILES).map((p) => ({
    id: p.id,
    name: p.name,
    controller: p.controller,
    toolSlots: p.toolSlots,
  }))
}

export function profileToLimits(profile) {
  const p = getMachineProfile(profile)
  return {
    xMin: p.travel.X[0],
    xMax: p.travel.X[1],
    yMin: p.travel.Y[0],
    yMax: p.travel.Y[1],
    zMin: p.travel.Z[0],
    zMax: p.travel.Z[1],
    feedMin: p.minFeed ?? 1,
    feedMax: p.maxFeed,
    spindleMin: p.minSpindle ?? 50,
    spindleMax: p.maxSpindle,
  }
}

export function isGSupported(profile, gNum) {
  const p = getMachineProfile(profile)
  return (p.supportedG || []).includes(Number(gNum))
}

export function isMSupported(profile, mNum) {
  const p = getMachineProfile(profile)
  return (p.supportedM || []).includes(Number(mNum))
}

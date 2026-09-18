/**
 * 简易刀具库 + 按特征选刀
 */

export const DEFAULT_TOOLS = [
  { tool: 'T01', type: 'endmill', diameter: 10, flutes: 4, material: 'carbide', maxRpm: 8000, maxFeed: 2000 },
  { tool: 'T02', type: 'endmill', diameter: 6, flutes: 4, material: 'carbide', maxRpm: 10000, maxFeed: 1500 },
  { tool: 'T03', type: 'drill', diameter: 10, flutes: 2, material: 'hss', maxRpm: 3000, maxFeed: 200 },
  { tool: 'T04', type: 'drill', diameter: 8, flutes: 2, material: 'hss', maxRpm: 3500, maxFeed: 180 },
  { tool: 'T05', type: 'face_mill', diameter: 50, flutes: 5, material: 'carbide', maxRpm: 4000, maxFeed: 2500 },
]

const STRATEGY = {
  pocket: 'pocket_mill',
  hole: 'drill',
  drill: 'drill',
  face: 'face_mill',
  profile: 'profile_mill',
  slot: 'slot_mill',
}

export function pickStrategy(feature) {
  const t = String(feature?.type || '')
  return STRATEGY[t] || 'unknown'
}

export function selectTool(feature, tools = DEFAULT_TOOLS) {
  const pool = tools.length ? tools : DEFAULT_TOOLS
  const t = String(feature?.type || '')
  if (t === 'hole' || t === 'drill') {
    const d = Number(feature.diameter)
    const drills = pool.filter((x) => x.type === 'drill')
    const exact = drills.find((x) => Math.abs(x.diameter - d) < 0.05)
    if (exact) return exact
    const smaller = drills.filter((x) => x.diameter <= d).sort((a, b) => b.diameter - a.diameter)[0]
    return smaller || drills[0] || pool[0]
  }
  if (t === 'face') {
    return pool.find((x) => x.type === 'face_mill') || pool.find((x) => x.type === 'endmill') || pool[0]
  }
  // pocket / profile / slot → endmill smaller than feature
  const mills = pool.filter((x) => x.type === 'endmill').sort((a, b) => b.diameter - a.diameter)
  const w = Number(feature.width || feature.length || feature.diameter || 20)
  const fit = mills.find((x) => x.diameter < w * 0.9)
  return fit || mills[mills.length - 1] || pool[0]
}

export function suggestParams(feature, tool, material = 'aluminum') {
  const strategy = pickStrategy(feature)
  const dia = Number(tool?.diameter) || 10
  let spindle = 3000
  let feed = 500
  let doc = Math.min(dia * 0.5, Number(feature.depth) || dia)
  let stepover = dia * 0.4

  if (material === 'steel') {
    spindle = Math.min(tool?.maxRpm || 4000, Math.round(80 * 1000 / (Math.PI * dia)))
    feed = Math.min(tool?.maxFeed || 800, Math.round(spindle * tool?.flutes * 0.05))
  } else {
    // aluminum defaults
    spindle = Math.min(tool?.maxRpm || 8000, Math.round(200 * 1000 / (Math.PI * dia)))
    feed = Math.min(tool?.maxFeed || 2000, Math.round(spindle * (tool?.flutes || 2) * 0.08))
  }

  if (strategy === 'drill') {
    spindle = Math.min(tool?.maxRpm || 3000, 2500)
    feed = Math.min(tool?.maxFeed || 200, Math.round(dia * 0.15 * 60))
    doc = Number(feature.depth) || dia * 2
    stepover = 0
  }
  if (strategy === 'face_mill') {
    doc = Math.min(1.5, Number(feature.depth) || 1)
    stepover = dia * 0.6
  }

  return {
    strategy,
    tool: tool?.tool || 'T01',
    toolSpec: tool,
    spindleRpm: Math.max(200, spindle),
    feedMmMin: Math.max(20, feed),
    depthOfCut: doc,
    stepover,
    material,
  }
}

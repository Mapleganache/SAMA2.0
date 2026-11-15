/**
 * SAMA 2.0 运行参数。
 * 调试阶段 maxStep 默认 8；稳定后再用 SAMA2_MAX_STEP=50 或调用参数调到上限。
 * forceMultiAgent 开启后按复杂题采样，仍先检查必填项。
 */

export const DIMENSIONS = [
  { key: 'accuracy', label: '故障定位准确性', weight: 0.3 },
  { key: 'safety', label: '操作安全性', weight: 0.25 },
  { key: 'feasibility', label: '现场可行性', weight: 0.2 },
  { key: 'completeness', label: '方案完整性', weight: 0.15 },
  { key: 'brevity', label: '简洁性', weight: 0.1 },
]

export function resolveConfig(options = {}) {
  const envForce = /^(1|true|yes)$/i.test(String(process.env.SAMA2_FORCE_MULTI || ''))
  const envStep = Number(process.env.SAMA2_MAX_STEP)
  const envSeed = Number(process.env.SAMA2_SEED_BASE)
  const maxStep = clampInt(options.maxStep ?? (Number.isFinite(envStep) && envStep > 0 ? envStep : 8), 1, 50)
  const subTimeoutMs = clampInt(options.subTimeoutMs ?? 180000, 5000, 600000)
  const concurrency = clampInt(options.concurrency ?? 5, 1, 5)
  const seedBase = clampInt(options.seedBase ?? (Number.isFinite(envSeed) ? envSeed : 1000), 0, 100000000)
  const allowWeb = Boolean(options.allowWeb) || /^(1|true|yes)$/i.test(String(process.env.SAMA2_ALLOW_WEB || ''))
  const webAuto = options.webAuto != null
    ? Boolean(options.webAuto)
    : !/^(0|false|no)$/i.test(String(process.env.SAMA2_WEB_AUTO ?? '1'))
  const briefEnabled = options.briefEnabled != null
    ? Boolean(options.briefEnabled)
    : /^(1|true|yes)$/i.test(String(process.env.SAMA2_BRIEF ?? '1'))
  const gateMode = String(options.gateMode || process.env.SAMA2_GATE || 'soft').toLowerCase() === 'hard' ? 'hard' : 'soft'
  const treeEnabled = options.treeEnabled != null
    ? Boolean(options.treeEnabled)
    : !/^(0|false|no)$/i.test(String(process.env.SAMA2_TREE ?? '1'))
  return {
    forceMultiAgent: Boolean(options.forceMultiAgent) || envForce,
    maxStep,
    subTimeoutMs,
    concurrency,
    llmTimeoutMs: clampInt(options.llmTimeoutMs ?? 90000, 5000, 180000),
    sampleCount: clampInt(options.sampleCount ?? 5, 1, 5),
    tauProp: 0.7,
    tauFinal: 0.2,
    tauJudge: 0.1,
    laneTemps: [0.35, 0.5, 0.85, 1.0, 0.95],
    treeEnabled,
    treeHops: clampInt(options.treeHops ?? process.env.SAMA2_TREE_HOPS ?? 2, 1, 6),
    treeTopK: clampInt(options.treeTopK ?? process.env.SAMA2_TREE_TOP_K ?? 3, 1, 10),
    treeBeamK: clampBeamK(options.treeBeamK ?? options.treeTopK ?? Number(process.env.SAMA2_TREE_BEAM_K) ?? 3),
    treeGamma: clampUnit(options.treeGamma ?? process.env.SAMA2_TREE_GAMMA ?? 0.6),
    treeHopCost: Math.max(0, Number(options.treeHopCost ?? process.env.SAMA2_TREE_HOP_COST ?? 0.15) || 0),
    treeAlpha: clampUnit(options.treeAlpha ?? process.env.SAMA2_TREE_ALPHA ?? 0.5),
    treeRetBudget: clampInt(options.treeRetBudget ?? process.env.SAMA2_TREE_RET_BUDGET ?? 12, 2, 64),
    treeHopFuse: clampInt(options.treeHopFuse ?? process.env.SAMA2_TREE_HOP_FUSE ?? 16, 2, 32),
    treeEntryMode: String(options.treeEntryMode || process.env.SAMA2_TREE_ENTRY || 'softmax').toLowerCase() === 'mmr' ? 'mmr' : 'softmax',
    treePriorBeta: clampUnit(options.treePriorBeta ?? process.env.SAMA2_TREE_PRIOR_BETA ?? 0.5),
    treeMmrLambda: clampUnit(options.treeMmrLambda ?? process.env.SAMA2_TREE_MMR_LAMBDA ?? 0.5),
    treeEntryRetry: clampInt(options.treeEntryRetry ?? process.env.SAMA2_TREE_ENTRY_RETRY ?? 3, 0, 8),
    treeEmbed: String(options.treeEmbed || process.env.SAMA2_EMBED || 'hash').toLowerCase() === 'jaccard' ? 'jaccard' : 'hash',
    thetaB: 6,
    seedBase,
    toolLimit: 4,
    obsPrefix: 200,
    toolTimeoutMs: clampInt(options.toolTimeoutMs ?? 5000, 1000, 30000),
    waveCap: 2,
    staggerMs: 400,
    allowWeb,
    webAuto,
    briefEnabled,
    gateMode,
    mtkbUrl: String(options.mtkbUrl || process.env.SAMA2_MTKB_URL || 'http://127.0.0.1:8765'),
  }
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clampUnit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}

function clampBeamK(value) {
  const allowed = [3, 5, 7]
  const n = Number(value)
  const raw = Number.isFinite(n) && n > 0 ? n : 3
  return allowed.reduce((best, item) => (Math.abs(item - raw) < Math.abs(best - raw) ? item : best))
}



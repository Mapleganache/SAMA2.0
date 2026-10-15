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
    thetaB: 6,
    seedBase,
    toolLimit: 4,
    obsPrefix: 200,
    toolTimeoutMs: clampInt(options.toolTimeoutMs ?? 5000, 1000, 30000),
    waveCap: 2,
    staggerMs: 400,
    allowWeb,
    mtkbUrl: String(options.mtkbUrl || process.env.SAMA2_MTKB_URL || 'http://127.0.0.1:8765'),
  }
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

/**
 * 加工分析报告
 */
export function buildMachiningReport(bundle) {
  const {
    programNumber,
    controller,
    stock,
    tools,
    time,
    validation,
    collision,
    removal,
    liteSimulation,
    risks = [],
  } = bundle

  const lines = []
  lines.push('# SAMA CNC Analysis Report')
  lines.push('')
  lines.push(`程序：O${String(programNumber || '????').padStart(4, '0')}`)
  lines.push(`控制器：${controller || 'FANUC'}`)
  lines.push('')
  if (stock) {
    lines.push('## 工件')
    lines.push('')
    lines.push(
      `${(stock.max.x - stock.min.x).toFixed(1)} × ${(stock.max.y - stock.min.y).toFixed(1)} × ${(stock.max.z - stock.min.z).toFixed(1)} mm`,
    )
    lines.push('')
  }
  if (tools?.length) {
    lines.push('## 刀具')
    lines.push('')
    for (const t of tools) lines.push(`- ${typeof t === 'string' ? t : JSON.stringify(t)}`)
    lines.push('')
  }
  if (time) {
    lines.push('## 预计时间')
    lines.push('')
    lines.push(`总计：${time.display}`)
    lines.push(`切削：${time.breakdown?.cutting}`)
    lines.push(`非切削：${time.breakdown?.nonCutting}`)
    lines.push('')
  }
  lines.push('## 检查')
  lines.push('')
  lines.push(`- 语法/模态：${validation?.ok ? '✓' : '✕'}`)
  lines.push(`- 碰撞/深度：${collision?.ok ? '✓' : '✕'}`)
  if (removal) {
    lines.push(`- 材料去除体积(近似)：${removal.removedVolumeApprox?.toFixed?.(1) ?? removal.removedVolumeApprox} mm³`)
    lines.push(`- 剩余材料比：${((removal.remainingRatio || 0) * 100).toFixed(1)}%`)
  }
  lines.push('')
  const allRisks = [
    ...risks,
    ...(validation?.warnings || []).map((w) => w.message),
    ...(collision?.warnings || []).map((w) => w.message),
    ...(collision?.errors || []).map((e) => e.message),
  ]
  lines.push('## 风险')
  lines.push('')
  if (!allRisks.length) lines.push('无')
  else for (const r of allRisks.slice(0, 20)) lines.push(`- ${r}`)
  lines.push('')
  lines.push('## 仿真')
  lines.push('')
  if (liteSimulation?.lite) {
    lines.push(liteSimulation.success ? '✓ 本地轻量仿真完成' : `✕ ${liteSimulation.error?.message || '未完成'}`)
  } else {
    lines.push('厂商 CNC 仿真器不可用（CNC_SIMULATOR_NOT_AVAILABLE）')
  }
  lines.push('')
  lines.push('---')
  lines.push('SAMA G-code V1.2 — 禁止自动下发真实机床。')
  lines.push('')
  return lines.join('\n')
}

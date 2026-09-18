/**
 * 电动机三相+PE 标准逻辑接线表（先逻辑、后画图）
 */
export function motorThreePhasePeWirePlan() {
  return [
    { step: 1, wire: 'R', from: 'R母线', to: 'Q1 上端', note: '三相进线 R 接主断路器 Q1 上端' },
    { step: 2, wire: 'S', from: 'S母线', to: 'Q1 上端', note: '三相进线 S 接 Q1 上端' },
    { step: 3, wire: 'T', from: 'T母线', to: 'Q1 上端', note: '三相进线 T 接 Q1 上端' },
    { step: 4, wire: 'R1', from: 'Q1 下端', to: 'KM1 上端', note: 'Q1 出线 R1 接接触器 KM1 上端 R 极' },
    { step: 5, wire: 'S1', from: 'Q1 下端', to: 'KM1 上端', note: 'Q1 出线 S1 接 KM1 上端 S 极' },
    { step: 6, wire: 'T1', from: 'Q1 下端', to: 'KM1 上端', note: 'Q1 出线 T1 接 KM1 上端 T 极' },
    { step: 7, wire: 'U1', from: 'KM1 下端', to: 'M1 U', note: 'KM1 出线接电动机 M1 绕组 U' },
    { step: 8, wire: 'V1', from: 'KM1 下端', to: 'M1 V', note: 'KM1 出线接电动机 M1 绕组 V' },
    { step: 9, wire: 'W1', from: 'KM1 下端', to: 'M1 W', note: 'KM1 出线接电动机 M1 绕组 W' },
    { step: 10, wire: 'PE', from: 'PE母线', to: 'M1 接地端', note: '保护接地 PE 母线接电机接地端' },
    { step: 11, wire: 'PE', from: 'PE母线', to: '接地符号', note: 'PE 母线接接地符号（保护地）' },
  ]
}

export function motorElecJsonWithWirePlan() {
  const wirePlan = motorThreePhasePeWirePlan()
  return {
    kind: 'elec-json',
    project: { machine: 'SAMA电动机逻辑接线', drawing: '三相电动机+PE', control: '测试' },
    page: { no: 1, of: 1, title: '电动机主回路', kind: 'motor' },
    rails: [
      { id: 'R', label: 'R', type: 'phase' },
      { id: 'S', label: 'S', type: 'phase' },
      { id: 'T', label: 'T', type: 'phase' },
      { id: 'PE', label: 'PE', type: 'pe' },
    ],
    columns: [
      {
        i: 2,
        devices: [
          {
            tag: 'Q1',
            sym: 'breaker3',
            rating: '32A',
            desc: '主断路器',
            wiresIn: ['R', 'S', 'T'],
            wiresOut: ['R1', 'S1', 'T1'],
          },
          {
            tag: 'KM1',
            sym: 'contactor3',
            desc: '主接触器',
            wiresIn: ['R1', 'S1', 'T1'],
            wiresOut: ['U1', 'V1', 'W1'],
          },
          {
            tag: 'M1',
            sym: 'motor3',
            rating: '3~',
            desc: '三相电动机',
            wiresIn: ['U1', 'V1', 'W1'],
            wiresOut: [],
          },
        ],
      },
    ],
    wirePlan,
    io: [],
    uncertain: [],
  }
}

export function formatWirePlanMarkdown(wirePlan, title = '逻辑接线步骤') {
  const lines = [
    `# ${title}`,
    '',
    '> 先确认逻辑接线，再按步骤序号在原理图上逐条核对导线。',
    '',
    '| 步骤 | 线号 | 从 | 到 | 说明 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const s of wirePlan) {
    lines.push(
      `| ${s.step} | ${s.wire} | ${s.from} | ${s.to} | ${s.note || ''} |`,
    )
  }
  lines.push('', '## 连通性摘要', '')
  for (const s of wirePlan) {
    lines.push(`${s.step}. **${s.wire}**：${s.from} ↔ ${s.to}（${s.note || ''}）`)
  }
  return lines.join('\n')
}

export function formatWirePlanText(wirePlan) {
  const lines = ['逻辑接线步骤（先读后画）', '---']
  for (const s of wirePlan) {
    lines.push(`[${s.step}] 线号 ${s.wire}: ${s.from} → ${s.to} | ${s.note || ''}`)
  }
  return lines.join('\n')
}

/**
 * MVP 模板：气缸自动夹紧机构
 * 夹紧到位保持 holdMs 后自动松开
 */

export function buildClampCylinderIrs(opts = {}) {
  const holdMs = Math.min(Math.max(Number(opts.holdMs) || 3000, 100), 60000)
  const plate = {
    width: Number(opts.plateWidth) || 200,
    depth: Number(opts.plateDepth) || 120,
    height: Number(opts.plateHeight) || 20,
  }
  const name = opts.name || 'clamp_cylinder'

  const cad = {
    schemaVersion: 1,
    kind: 'cad.ir',
    type: 'part',
    units: 'mm',
    meta: { name: `${name}_mech`, workflow: 'clamp_cylinder' },
    features: [
      { type: 'box', width: plate.width, depth: plate.depth, height: plate.height, origin: [0, 0, 0] },
      // 气缸筒示意
      {
        type: 'box',
        width: 40,
        depth: 40,
        height: 80,
        origin: [plate.width / 2 - 20, plate.depth / 2 - 20, plate.height],
      },
      // 夹爪示意
      {
        type: 'box',
        width: 60,
        depth: 20,
        height: 15,
        origin: [plate.width / 2 - 30, 10, plate.height + 40],
      },
      { type: 'hole', diameter: 8, position: [15, 15], through: true },
      { type: 'hole', diameter: 8, position: [plate.width - 15, 15], through: true },
      { type: 'hole', diameter: 8, position: [15, plate.depth - 15], through: true },
      { type: 'hole', diameter: 8, position: [plate.width - 15, plate.depth - 15], through: true },
    ],
  }

  const electrical = {
    schemaVersion: 1,
    kind: 'electrical.ir',
    meta: {
      name: `${name}_elec`,
      workflow: 'clamp_cylinder',
      forwardReverseInterlock: true,
    },
    power: { phases: 1, voltage: 24 },
    devices: [
      { id: 'QF1', type: 'breaker', rating: '24VDC' },
      { id: 'SB1', type: 'pushbutton', role: 'start' },
      { id: 'SB2', type: 'pushbutton', role: 'stop' },
      { id: 'KM1', type: 'contactor', role: 'forward', interlockedWith: 'KM2', label: 'CLAMP' },
      { id: 'KM2', type: 'contactor', role: 'reverse', interlockedWith: 'KM1', label: 'RELEASE' },
      { id: 'YV1', type: 'solenoid', role: 'clamp', label: 'CLAMP_VALVE' },
      { id: 'YV2', type: 'solenoid', role: 'release', label: 'RELEASE_VALVE' },
      { id: 'SQ1', type: 'sensor', role: 'clamp_pos', label: 'CLAMPED' },
      { id: 'SQ2', type: 'sensor', role: 'release_pos', label: 'RELEASED' },
    ],
    connections: [
      ['QF1', 'SB1'],
      ['SB1', 'KM1'],
      ['SB2', 'KM1'],
      ['QF1', 'KM1'],
      ['QF1', 'KM2'],
      ['KM1', 'YV1'],
      ['KM2', 'YV2'],
      ['SQ1', 'KM1'],
      ['SQ2', 'KM2'],
    ],
  }

  const plc = {
    schemaVersion: 1,
    kind: 'plc.ir',
    vendor: 'generic',
    meta: { name: `${name}_plc`, workflow: 'clamp_cylinder', holdMs },
    inputs: {
      X0: '启动',
      X1: '停止',
      X2: '夹紧到位',
      X3: '松开到位',
    },
    outputs: {
      Y0: '夹紧阀',
      Y1: '松开阀',
    },
    internals: {
      M0: '循环',
      M1: '保持完成',
    },
    logic: [
      { type: 'seal_in', input: 'X0', stop: 'X1', output: 'M0', comment: '循环自锁' },
      { type: 'seal_in', input: 'M0', stop: 'M1', output: 'Y0', comment: '夹紧直到保持完成' },
      { type: 'timer_on', input: 'X2', output: 'M1', presetMs: holdMs, comment: '夹紧到位后保持' },
      { type: 'and', inputs: ['M1'], output: 'Y1', comment: '保持完成后松开' },
    ],
  }

  const cam = {
    schemaVersion: 1,
    kind: 'cam.ir',
    units: 'mm',
    meta: { name: `${name}_cam`, vendor: 'fanuc', material: 'aluminum', workflow: 'clamp_cylinder' },
    stock: { x: plate.width + 10, y: plate.depth + 10, z: plate.height + 5 },
    features: [
      {
        type: 'face',
        width: plate.width,
        length: plate.depth,
        depth: 1,
        origin: [0, 0, 0],
      },
      {
        type: 'hole',
        diameter: 8,
        depth: plate.height,
        position: [15, 15, 0],
      },
    ],
  }

  const ioTable = [
    { addr: 'X0', name: '启动', device: 'SB1' },
    { addr: 'X1', name: '停止', device: 'SB2' },
    { addr: 'X2', name: '夹紧到位', device: 'SQ1' },
    { addr: 'X3', name: '松开到位', device: 'SQ2' },
    { addr: 'Y0', name: '夹紧阀', device: 'YV1' },
    { addr: 'Y1', name: '松开阀', device: 'YV2' },
  ]

  return {
    id: 'clamp_cylinder',
    name,
    holdMs,
    domains: { cad, electrical, plc, cam },
    ioTable,
    description: `气缸自动夹紧：到位保持 ${holdMs}ms 后松开`,
  }
}

/** 工作流级序贯：启动→夹紧→到位保持→松开（不依赖完整状态机梯级） */
export function clampSequenceSpec(holdMs = 3000) {
  return [
    { phase: 'idle', inputs: { X0: 0, X1: 0, X2: 0, X3: 1 }, expectHint: { Y0: 0, Y1: 0 } },
    { phase: 'start_clamp', inputs: { X0: 1, X1: 0, X2: 0, X3: 0 }, expectHint: { Y0: 1 } },
    { phase: 'clamped', inputs: { X0: 0, X1: 0, X2: 1, X3: 0 }, holdMs, expectHint: { Y0: 1 } },
    { phase: 'after_hold', inputs: { X0: 0, X1: 0, X2: 1, X3: 0 }, holdMs: 200, expectHint: { Y1: 1 } },
    { phase: 'released', inputs: { X0: 0, X1: 0, X2: 0, X3: 1 }, expectHint: { Y1: 1 } },
  ]
}

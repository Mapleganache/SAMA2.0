import { normalizeElecJson, mergeElecJson } from '../electron/services/electrical/elecJson.mjs'
import { sasl32ServoXyz } from '../electron/services/electrical/sasl32Pack.mjs'
import { renderElecSvg } from '../electron/services/electrical/renderSheet.mjs'

const loose = {
  kind: 'elec-json',
  project: 'MIKROSA SASL32',
  sheet: { title: 'X1Y1Z1轴 伺服放大器 + C轴（工件回转）', sheetNo: '/11-C' },
  potentials: [
    { id: 'R200', name: 'R200' },
    { id: 'PE', name: 'PE', voltage: 'PE' },
  ],
  components: [
    { id: '1Q21', type: 'MCCB', rating: '6A', description: 'C轴伺服断路器' },
    { id: 'SVM-C', type: 'SERVO_AMP', model: 'aiSV20', description: 'C轴伺服放大器' },
    { id: 'C-MOTOR', type: 'SERVO_MOTOR', description: 'C轴电机' },
  ],
  ioMapping: [{ address: 'X3.4', signal: '工件回转使能', unit: 'CB105-1' }],
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const coerced = normalizeElecJson(loose)
assert(
  coerced.columns.some((c) => c.devices.some((d) => d.tag === '1Q21' && d.sym === 'breaker3')),
  'coerce 1Q21',
)
assert(
  coerced.columns.some((c) => c.devices.some((d) => d.tag === 'SVM-C' && d.sym === 'servo')),
  'coerce SVM-C',
)
const merged = mergeElecJson(sasl32ServoXyz(), coerced)
const drawn = renderElecSvg(merged)
assert(drawn.svg.includes('1Q21'), 'render 1Q21')
assert(drawn.svg.includes('SVM-C'), 'render SVM-C')
assert(drawn.svg.includes('X1'), 'keep X1')
assert(drawn.svg.includes('C轴'), 'title C轴')
assert(drawn.svg.includes('X3.4'), 'io X3.4')
console.log('elec json coerce+merge ok')

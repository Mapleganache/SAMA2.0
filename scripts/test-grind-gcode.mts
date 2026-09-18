import { fmtMm, fmtUm } from '../electron/services/grindUnits.mjs'
import {
  extractGrindJson,
  extractGrindDims,
  validateGrindNc,
  buildGrindNc,
  repairAssistantGrindGcode,
  isReadCodeTask,
  wantsGrindProgram,
  resolveGrindDialect,
} from '../electron/services/grindGcode.mjs'

let failed = 0
let passed = 0

function assert(name, cond, detail) {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log('        ', detail)
  }
}

assert('fmtMm keeps 0.5μm', fmtMm(0.0005) === '0.0005')
assert('fmtMm does not round 0.5μm to 0.001', fmtMm(0.0005) !== '0.001')
assert('fmtUm one decimal', fmtUm(0.0005) === '0.5μm' && fmtUm(0.3) === '300.0μm')
assert('fmtMm size one decimal', fmtMm(20) === '20.0' && fmtMm(29.4) === '29.4')

assert(
  'dialect STUDER S40 → siemens',
  resolveGrindDialect('【看图出码】机床型号：STUDER S40') === 'studer_siemens',
)
assert(
  'dialect 高桥 → gaoqiao',
  resolveGrindDialect('【看图出码】机床型号：高桥 CNC 外圆磨床 FANUC') === 'gaoqiao_fanuc',
)
assert(
  'dialect MIKROSA SASL32',
  resolveGrindDialect('MIKROSA SASL32 无心磨') === 'mikrosa_sasl',
)
assert(
  'dialect NUM',
  resolveGrindDialect('【看图出码】NUM Flexium') === 'num_flexium',
)

const plungeJson = extractGrindJson(`\`\`\`grind-json
{"process":"od_plunge","type":"plunge","machine":"STUDER S40","steps":[{"d":22,"L":18,"stock":22.3,"grind":true},{"d":38,"L":16,"grind":false}],"totalL":50}
\`\`\``)
assert('plunge json type', plungeJson?.type === 'plunge', plungeJson)
assert('plunge only grind dia', plungeJson?.d === 22, plungeJson)
assert('plunge L is neck', plungeJson?.L === 18, plungeJson)
assert('plunge dialect siemens', plungeJson?.dialect === 'studer_siemens', plungeJson)

const plungeNc = `O1
G00 X48 Z5
G00 Z-9
G01 X22 F8
G04 P2000
G00 X48
M30`
const vPlungeIso = validateGrindNc(plungeJson, plungeNc)
assert('STUDER S40 rejects ISO plunge', vPlungeIso.ok === false, vPlungeIso.issues)

const builtPlunge = buildGrindNc(plungeJson)
assert('build plunge has R60 and φ22', /R60=/.test(builtPlunge) && /22/.test(builtPlunge), builtPlunge)
assert('build plunge not Z-50 traverse', !/Z-50/.test(builtPlunge), builtPlunge)
assert('siemens plunge um infeed', /150\.0μm/.test(builtPlunge), builtPlunge)
assert('siemens plunge validates', validateGrindNc(plungeJson, builtPlunge).ok, validateGrindNc(plungeJson, builtPlunge))

const stepAll = extractGrindJson(`\`\`\`grind-json
{"process":"od_traverse","type":"step_shaft","steps":[{"d":38,"L":16,"grind":true},{"d":22,"L":18,"grind":true},{"d":38,"L":16,"grind":true}],"totalL":50}
\`\`\``)
assert('full step still step_shaft', stepAll?.type === 'step_shaft' && stepAll.steps.length === 3, stepAll)

const faceJson = extractGrindJson(`\`\`\`grind-json
{"process":"face","type":"face","d":28,"L":0.2,"machine":"STUDER S40"}
\`\`\``)
const builtFace = buildGrindNc(faceJson)
assert('build face has Z plunge', /G91 Z|Z=R7/.test(builtFace), builtFace)
assert('face validate built', validateGrindNc(faceJson, builtFace).ok, validateGrindNc(faceJson, builtFace))

const dressKeep = repairAssistantGrindGcode(
  '这是修整\n```nc\nG90 G01 X50\nG01 Z-42 F200\nM30\n```',
  { type: 'dress', process: 'dress', d: 400, L: 40 },
  { force: true, userText: '【看图出码】STUDER S40 修整' },
)
assert('STUDER S40 dress rewritten to L100', dressKeep.repaired === true && /L100/.test(dressKeep.content), dressKeep.content?.slice(0, 400))

const svgEaten = `识件说明 φ28×25 与 φ20×50

\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg"><text>φ28</text></svg>
\`\`\`
`
const readCode = '【看码识件】请根据附件说明零件。不要改程序。'
assert('isReadCodeTask', isReadCodeTask(readCode))
assert('wantsGrindProgram false for read-code', wantsGrindProgram(readCode) === false)

const skipRead = repairAssistantGrindGcode(
  svgEaten,
  { type: 'step_shaft', steps: [{ d: 28, L: 25 }, { d: 20, L: 50 }], totalL: 75 },
  { force: true, userText: readCode },
)
assert('read-code does not replace svg', skipRead.repaired === false && /<svg/.test(skipRead.content), skipRead)

const g200 = repairAssistantGrindGcode(
  'NUM 台阶\n```nc\nG200\nG206\nM30\n```',
  { type: 'step_shaft', steps: [{ d: 28, L: 25 }, { d: 20, L: 50 }], totalL: 75, machine: 'NUM Flexium' },
  { force: true, userText: '【看图出码】NUM' },
)
assert('oem G200 not rewritten', g200.repaired === false && /G200/.test(g200.content), g200)

const faceFromText = extractGrindDims('STUDER S40 轴肩端面切入磨。磨削 φ42 与 φ28 之间的轴肩端面。')
assert('text face process', faceFromText?.type === 'face' || faceFromText?.process === 'face', faceFromText)

const plungeFromText = extractGrindDims('短轴颈外圆切入磨，磨削中间 φ22×18，两端 φ38 不磨。')
assert('text plunge from 磨削面', plungeFromText?.d === 22 && (plungeFromText.type === 'plunge' || plungeFromText.L === 18), plungeFromText)

const gaoqiao = extractGrindDims('看码识件 高桥 FANUC 外圆短轴纵磨到 Z21，X0 为成品')
assert('read-code text not forced step shaft', !gaoqiao || gaoqiao.type !== 'step_shaft' || isReadCodeTask(readCode), gaoqiao)

const onlyRed = extractGrindJson(`\`\`\`grind-json
{"process":"od_traverse","type":"shaft","steps":[{"d":20,"L":29.4,"stock":20.3,"grind":true},{"d":32,"L":12,"grind":false}],"totalL":53.4}
\`\`\``)
assert('only red neck as shaft', onlyRed?.type === 'shaft' && onlyRed.d === 20 && onlyRed.L === 29.4, onlyRed)
const neckNc = `G00 X42
G00 X20 Z0
G01 X20 Z-29.4 F0.08
G00 X42
M30`
assert('neck program ok without X32', validateGrindNc(onlyRed, neckNc).ok, validateGrindNc(onlyRed, neckNc))

const gqJson = extractGrindJson(`\`\`\`grind-json
{"process":"od_traverse","type":"shaft","machine":"高桥 CNC 外圆磨床 FANUC","d":20,"L":29.4,"stock":20.3}
\`\`\``)
assert('gaoqiao dialect', gqJson?.dialect === 'gaoqiao_fanuc', gqJson)
const builtGq = buildGrindNc(gqJson)
assert('gaoqiao X=0 not X20 diameter', /X0/.test(builtGq) && /Z-29\.4/.test(builtGq) && !/G01 X20 Z-29/.test(builtGq), builtGq)
assert('gaoqiao 0.5μm kept', /U0\.0005/.test(builtGq), builtGq)
assert('gaoqiao um comments', /0\.5μm/.test(builtGq) && /5\.5μm/.test(builtGq), builtGq)
assert('gaoqiao built validates', validateGrindNc(gqJson, builtGq).ok, validateGrindNc(gqJson, builtGq))
assert(
  'gaoqiao rejects ISO X20',
  validateGrindNc(gqJson, neckNc).ok === false,
  validateGrindNc(gqJson, neckNc),
)

const mkJson = extractGrindJson(`\`\`\`grind-json
{"process":"od_plunge","type":"plunge","machine":"MIKROSA SASL32","d":12,"L":20,"stock":12.3}
\`\`\``)
assert('mikrosa dialect', mkJson?.dialect === 'mikrosa_sasl', mkJson)
const builtMk = buildGrindNc(mkJson)
assert('mikrosa has #540 and O8205', /#540/.test(builtMk) && /O8205|P8205/.test(builtMk), builtMk)
assert('mikrosa not ISO traverse', !/G01 X12 Z-20/.test(builtMk), builtMk)
assert('mikrosa built validates', validateGrindNc(mkJson, builtMk).ok, validateGrindNc(mkJson, builtMk))

const isoFix = repairAssistantGrindGcode(
  '```gcode\nG21\nG01 X12 Z-20 F0.08\nM30\n```',
  mkJson,
  { force: true, userText: '【看图出码】MIKROSA SASL32' },
)
assert('mikrosa ISO rewritten', isoFix.repaired === true && /#540/.test(isoFix.content), isoFix.content?.slice(0, 500))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

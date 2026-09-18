import { readFileSync } from 'fs'
import { parseGcode, isGCodeFile, looksLikeGcode, suggestViewPlane, detectProgramStyle } from '../src/gcode/parseGcode.ts'

let failed = 0
let passed = 0

function assert(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log('        ', detail)
  }
}

function almost(a: number, b: number, tol = 0.05) {
  return Math.abs(a - b) <= tol
}

const grindO3301 = readFileSync('./docs/grind-web-cases/nc/O3301_S33_光轴φ40x120.nc', 'utf8')
const grindTaper = readFileSync('./docs/grind-web-cases/nc/O3304_S41_锥度φ40_φ34x60.nc', 'utf8')
const grindStep = readFileSync('./docs/grind-web-cases/nc/O3302_favoritCNC_台阶φ40x85_φ28x55.nc', 'utf8')
const grindBore = readFileSync('./docs/grind-web-cases/nc/O3306_S122_内孔φ20x40.nc', 'utf8')
const grindThru = readFileSync('./docs/grind-web-cases/nc/O3305_KRONOS_通磨φ12x80.nc', 'utf8')
const millProfile = readFileSync('./workspace/projects/gcode-samples/01_mill_profile.nc', 'utf8')
const millArc = readFileSync('./workspace/projects/gcode-samples/03_mill_circle.nc', 'utf8')
const millG81 = readFileSync('./workspace/projects/gcode-samples/05_mill_drill_g81.nc', 'utf8')
const millG83 = readFileSync('./workspace/projects/gcode-samples/06_mill_peck_g83.nc', 'utf8')

const lathe = `%
O2001 (SAMA LATHE XZ DEMO)
G21 G18 G90
G00 X80 Z5
G00 X50
G01 Z0 F0.2
G01 X20 Z-5
G01 Z-25
G02 X30 Z-30 R5
G01 X45
G00 Z5
G00 X80
M30
%
`

console.log('detect / file type')
assert('grind file is gcode', isGCodeFile('O3301_S33.nc') && looksLikeGcode(grindO3301))
assert('bare O number is gcode', isGCodeFile('O3301'))
assert('grind style', detectProgramStyle(grindO3301).kind === 'grind' && detectProgramStyle(grindO3301).diameter)
assert('lathe style', detectProgramStyle(lathe).kind === 'lathe' && detectProgramStyle(lathe).plane === 'XZ')
assert('mill style', detectProgramStyle(millProfile).kind === 'mill' && !detectProgramStyle(millProfile).diameter)

console.log('\ngrind O3301 光轴')
{
  const r = parseGcode(grindO3301)
  assert('kind grind + diameter + XZ', r.modal.kind === 'grind' && r.modal.diameter && r.modal.plane === 'XZ')
  assert('suggest XZ', suggestViewPlane(r.usedAxes, r.modal.kind) === 'XZ')
  assert('no ghost from origin', r.segments.every((s) => !(s.from.x === 0 && s.from.z === 0 && s.to.x === 50)))
  assert('xMin is grind diameter not 0', r.bounds.xMin >= 39 && r.bounds.xMax <= 51, r.bounds)
  assert('covers Z0 → Z-120', r.bounds.zMin <= -119 && r.bounds.zMax >= 0, r.bounds)
  assert('two grind feeds', r.stats.feedCount === 2, r.stats)
  assert('finish pass X40 Z-120', r.segments.some((s) => s.type === 'feed' && almost(s.to.x, 40) && almost(s.to.z, -120)))
  assert('no travel error', r.issues.filter((i) => i.level === 'error').length === 0, r.issues)
}

console.log('\ngrind taper / step / bore / thru')
{
  const t = parseGcode(grindTaper)
  assert(
    'taper simultaneous XZ feed',
    t.segments.some((s) => s.type === 'feed' && almost(s.from.x, 40) && almost(s.to.x, 34) && almost(s.to.z, -60)),
  )
  const s = parseGcode(grindStep)
  assert('step small dia 28', s.segments.some((s0) => s0.type === 'feed' && almost(s0.to.x, 28) && almost(s0.to.z, -140)))
  const b = parseGcode(grindBore)
  assert('ID grind X20 Z-40', b.modal.kind === 'grind' && b.segments.some((s0) => s0.type === 'feed' && almost(s0.to.x, 20) && almost(s0.to.z, -40)))
  const c = parseGcode(grindThru)
  assert('centerless +L', c.bounds.zMax >= 79 && c.segments.some((s0) => s0.type === 'feed' && almost(s0.to.z, 80)))
}

console.log('\nlathe arc (diameter R)')
{
  const r = parseGcode(lathe)
  const arc = r.segments.find((s) => s.type === 'arc_cw' || s.type === 'arc_ccw')
  assert('has arc', !!arc)
  assert('arc not collapsed to line', (arc?.points.length || 0) >= 8, arc?.points.length)
  assert('arc ends X30 Z-30', !!arc && almost(arc.to.x, 30) && almost(arc.to.z, -30))
  const mid = arc?.points[Math.floor((arc.points.length - 1) / 2)]
  assert('arc bulges off the chord', !!mid && Math.hypot(mid.x - 25, mid.z + 27.5) > 0.4, mid)
}

console.log('\nmill profile / arc')
{
  const r = parseGcode(millProfile)
  assert('mill XY', r.modal.kind === 'mill' && r.modal.plane === 'XY' && suggestViewPlane(r.usedAxes, r.modal.kind) === 'XY')
  assert('rectangle feeds', r.stats.feedCount >= 5)
  const a = parseGcode(millArc)
  const circle = a.segments.find((s) => s.type === 'arc_cw')
  assert('full circle sampled', (circle?.points.length || 0) >= 16, circle?.points.length)
}

console.log('\nG81 / G83 cycles')
{
  const r = parseGcode(millG81)
  assert('G81 has cutting feeds', r.stats.feedCount >= 4, r.stats)
  assert('not all rapids', r.stats.rapidCount > 0 && r.stats.feedCount > 0)
  assert('four hole bottoms', r.segments.filter((s) => s.type === 'feed' && almost(s.to.z, -12)).length === 4, r.stats)
  const p = parseGcode(millG83)
  assert('G83 pecks', p.stats.feedCount >= 4, p.stats)
}

console.log('\nU/W incremental, G28, long Z')
{
  const uw = parseGcode(`O1\nG21 G18 G90\nG00 X40 Z0\nG01 U-2 W-10 F0.1\nM30\n`)
  const last = uw.segments[uw.segments.length - 1]
  assert('U W incremental', !!last && almost(last.to.x, 38) && almost(last.to.z, -10), last?.to)
  const g28 = parseGcode(`O1\nG90 G00 X10 Y20 Z30\nG28 Z0\nM30\n`)
  const home = g28.segments[g28.segments.length - 1]
  assert('G28 only specified axis', !!home && almost(home.to.x, 10) && almost(home.to.y, 20) && almost(home.to.z, 0), home?.to)
  const longz = parseGcode(`O1\n(磨床)\nG21 G90\nG00 X50 Z5\nG01 X40 Z-450 F0.1\nM30\n`)
  assert('Z-450 not fatal on grind', longz.issues.every((i) => i.level !== 'error'), longz.issues)
  assert('Z-450 still parsed', longz.segments.some((s) => almost(s.to.z, -450)))
}

console.log('\nG90G01 glued words')
{
  const r = parseGcode(`O1\nG21G90G18\nG00X50Z5\nG01X40Z-60F0.08\nM30\n`)
  assert('glued G01 XZ', r.segments.some((s) => s.type === 'feed' && almost(s.to.x, 40) && almost(s.to.z, -60)))
}

console.log('\nMIKROSA SASL: glued G01, G04 dwell, dress table')
{
  const glued = parseGcode(`O8200\nG98G91G01F2000X4.\nG90G53G01F3000.Z3.5\nG91G01F2000X-3.9\nG91G01F100X-0.1\nG04X1.\nM02\n`)
  assert('glued G90G53G01 is feed not rapid', glued.segments.some((s) => s.type === 'feed' && almost(s.to.z, 3.5)), glued.segments.map((s) => s.type))
  assert(
    'G04 X is dwell not +X',
    almost(glued.segments[glued.segments.length - 1].to.x, 0),
    glued.segments.map((s) => s.to),
  )
  const dress = parseGcode(readFileSync('C:/Users/猫之泪伤/Desktop/米克罗莎SASL32/GW PROGRAM/O1111', 'utf8'))
  assert('O1111 dress profile points', dress.stats.feedCount === 19 && dress.modal.kind === 'grind', dress.stats)
  assert('O1111 ends near X1.889 Z-3', dress.segments.some((s) => almost(s.to.x, 1.889, 0.01) && almost(s.to.z, -3, 0.01)))
  const gw = parseGcode(readFileSync('C:/Users/猫之泪伤/Desktop/米克罗莎SASL32/GW PROGRAM/O8200', 'utf8'))
  assert('O8200 is grind not mill', gw.modal.kind === 'grind' && !gw.modal.diameter, gw.modal)
  assert('O8200 no dwell-as-X', gw.segments.every((s) => s.to.x <= 4.01 && s.to.x >= -0.05), gw.segments.map((s) => s.to))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

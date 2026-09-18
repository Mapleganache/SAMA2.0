import { extractNcFromAssistant, messageHasGcode } from '../src/gcode/extractNc.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const fenced = `按 STUDER 体系，程序如下：

\`\`\`gcode
O1234
G90 G94
G01 X20.0 Z0 F0.3
G01 Z-50
M30
\`\`\`
`
const nc = extractNcFromAssistant(fenced)
assert(nc.includes('O1234') && nc.includes('M30'), 'tagged gcode fence')

const unfenced = `完整程序：
O8205
G90
#540=0.02
M30
说明结束`
assert(extractNcFromAssistant(unfenced).startsWith('O8205'), 'unfenced O program')

const prose = '建议用 G01 直线，不要用 G02。'
assert(!messageHasGcode(prose), 'prose G01 is not a program')

const mpf = `\`\`\`nc
%_N_STEP_MPF
G90
G01 X20
M30
\`\`\``
assert(extractNcFromAssistant(mpf).includes('%_N_STEP_MPF'), 'mpf fence')

console.log('extractNc ok')

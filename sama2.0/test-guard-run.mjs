process.env.SAMA2_API_KEY = 'test-key'
process.env.SAMA2_BASE_URL = 'http://127.0.0.1:9/v1'
process.env.SAMA2_MODEL = 'test-model'

const control = { mode: 'repeat-args', calls: 0 }
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  const system = body.messages[0].content
  const user = body.messages[1].content
  if (system.includes('独立监督者')) {
    return json({ choices: [{ message: { content: '{"numeric_agree":true,"missing":[],"isolation_noted":false,"note":"ok"}' } }] })
  }
  if (system.includes('不要再要工具') || system.includes('禁止再调用工具')) {
    return json({ choices: [{ message: { content: '收束后的方案' } }] })
  }
  if (control.mode === 'final') {
    return json({ choices: [{ message: { content: '{"thought":"直接答","final":"直接方案"}' } }] })
  }
  if (control.mode === 'text') {
    return json({ choices: [{ message: { content: '不是 JSON 的成稿' } }] })
  }
  if (control.mode === 'repeat-args') {
    return json({ choices: [{ message: { content: '{"thought":"再查","tool":"search_knowledge","args":{"query":"主轴发热"}}' } }] })
  }
  if (control.mode === 'repeat-obs') {
    const query = user.includes('（还没有）') ? '甲' : '乙'
    return json({ choices: [{ message: { content: JSON.stringify({ thought: '查', tool: 'search_knowledge', args: { query } }) } }] })
  }
  const n = control.calls
  control.calls += 1
  return json({ choices: [{ message: { content: JSON.stringify({ thought: '换一个', tool: 'search_knowledge', args: { query: `词${n}` } }) } }] })
}

function json(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
}

const { buildRoles } = await import('./prompts.mjs')
const { runReactSub } = await import('./reactLoop.mjs')

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

const role = buildRoles(1)[0]
let toolCalls = 0
const repeat = await runReactSub({
  role,
  query: 'STUDER 主轴发热，空载，刚开机',
  runTool: async () => {
    toolCalls += 1
    return '本地资料没有命中。'
  },
  maxStep: 8,
  timeoutMs: 180000,
  llmTimeoutMs: 90000,
  seed: 1000,
  toolLimit: 4,
  toolTimeoutMs: 5000,
})
check('重复参数第二次不执行', toolCalls === 1 && repeat.stopReason === 'repeat_args' && repeat.stepCount <= 2)

control.mode = 'repeat-obs'
const sameObs = await runReactSub({
  role,
  query: 'STUDER 主轴发热，空载，刚开机',
  runTool: async () => '没有命中'.repeat(30),
  maxStep: 8,
  timeoutMs: 180000,
  llmTimeoutMs: 90000,
  seed: 1001,
  toolLimit: 4,
  toolTimeoutMs: 5000,
})
check('相同观察前缀后收束', sameObs.stopReason === 'repeat_obs' && sameObs.stepCount === 2)

control.mode = 'budget'
control.calls = 0
const budget = await runReactSub({
  role,
  query: 'STUDER 主轴发热，空载，刚开机',
  runTool: async (name, args) => `结果 ${args.query} ${Math.random()}`,
  maxStep: 8,
  timeoutMs: 180000,
  llmTimeoutMs: 90000,
  seed: 1002,
  toolLimit: 4,
  toolTimeoutMs: 5000,
})
check('四次工具后只许写方案', budget.stopReason === 'tool_budget' && budget.notes.filter((note) => note.executed).length === 4)

control.mode = 'final'
const direct = await runReactSub({
  role,
  query: 'STUDER 主轴发热，空载，刚开机',
  runTool: async () => '不应调用',
  maxStep: 8,
  timeoutMs: 180000,
  llmTimeoutMs: 90000,
  seed: 1003,
})
check('第一句成稿不比较工具', direct.stepCount === 1 && direct.plan.includes('直接方案'))

control.mode = 'text'
const plain = await runReactSub({
  role,
  query: 'STUDER 主轴发热，空载，刚开机',
  runTool: async () => '不应调用',
  maxStep: 8,
  timeoutMs: 180000,
  llmTimeoutMs: 90000,
  seed: 1004,
})
check('不是 JSON 时当成成稿', plain.stepCount === 1 && plain.plan.includes('不是 JSON'))

control.mode = 'hang'
const hung = await runReactSub({
  role,
  query: 'STUDER 主轴发热，空载，刚开机',
  runTool: () => new Promise(() => {}),
  maxStep: 8,
  timeoutMs: 180000,
  llmTimeoutMs: 90000,
  seed: 1005,
  toolTimeoutMs: 200,
})
check('工具不返回时超时收束', hung.stopReason === 'tool_timeout' && hung.notes.some((note) => String(note.observation).includes('工具超时')), `${hung.stopReason} / ${hung.notes.map((note) => note.observation).join(' | ').slice(0, 180)}`)

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nguard run ok')

/**
 * 用假的模型接口走一遍预设链路，不访问真实 API。
 * 简单题不应启动 5 个 Sub；复杂题应五路都跑完再评判。
 */
process.env.SAMA2_API_KEY = 'test-key'
process.env.SAMA2_BASE_URL = 'http://127.0.0.1:9/v1'
process.env.SAMA2_MODEL = 'test-model'

const calls = []
const control = {
  classifier: 'complex',
  failRole: '',
  alwaysTool: false,
}

globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  const system = body.messages[0].content
  const user = body.messages[1].content
  calls.push({ system, user })

  if (system.includes('问题分类器')) {
    return jsonResponse({ choices: [{ message: { content: `{"level":"${control.classifier}","reason":"分类器结果"}` } }] })
  }
  if (system.includes('准确性专评')) {
    return jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            note: '准确性与加权分分开',
            reviews: [
              { id: 'sub1', accuracy: 9, credibility: 8, reason: '现象对准且少下定论' },
              { id: 'sub2', accuracy: 7, credibility: 9, reason: '步骤清楚但根因略宽' },
              { id: 'sub4', accuracy: 6, credibility: 6, reason: '排查顺序可用' },
              { id: 'sub5', accuracy: 5, credibility: 5, reason: '工单完整但定位一般' },
            ],
          }),
        },
      }],
    })
  }
  if (system.includes('评判员')) {
    return jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            note: '按加权分选取',
            scores: [
              { id: 'sub1', scores: { accuracy: 6, safety: 6, feasibility: 6, completeness: 6, brevity: 6 }, defect: '根因证据偏少' },
              { id: 'sub2', scores: { accuracy: 9, safety: 9, feasibility: 8, completeness: 8, brevity: 7 }, defect: '' },
              { id: 'sub3', scores: { accuracy: 0, safety: 0, feasibility: 0, completeness: 0, brevity: 0 }, defect: '方案生成失败' },
              { id: 'sub4', scores: { accuracy: 7, safety: 7, feasibility: 7, completeness: 7, brevity: 7 }, defect: '步骤偏长' },
              { id: 'sub5', scores: { accuracy: 7, safety: 6, feasibility: 7, completeness: 8, brevity: 5 }, defect: '工单不够聚焦' },
            ],
          }),
        },
      }],
    })
  }
  if (system.includes('这是简单问题')) {
    return jsonResponse({ choices: [{ message: { content: '静压轴承靠压力油膜把主轴托起。' } }] })
  }
  if (system.includes('不要再要工具')) {
    return jsonResponse({ choices: [{ message: { content: '已按轮次上限收束的方案' } }] })
  }
  if (control.failRole && system.includes(control.failRole)) {
    return jsonResponse({ error: { message: '模拟这一路失败' } }, 500)
  }
  if (system.includes('禁止再调用工具') || control.alwaysTool) {
    if (system.includes('禁止再调用工具') && control.alwaysTool) {
      return jsonResponse({ choices: [{ message: { content: '{"thought":"还想查","tool":"lookup_baseline","args":{"query":"主轴"}}' } }] })
    }
  }
  const first = user.includes('（还没有）')
  if (first && !system.includes('禁止再调用工具')) {
    const tool = 'lookup_baseline'
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ thought: '先取测点', tool, args: { query: user.slice(0, 40) } }) } }],
    })
  }
  const lane = (system.match(/第(\d)路独立求解/) || [])[1]
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify({ thought: '可以收束', final: lane ? `第${lane}路的完整维修方案` : '维修的完整维修方案' }) } }],
  })
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

const { runSama2 } = await import('./index.mjs')

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

calls.length = 0
const simple = await runSama2({ userText: '什么是磨床静压轴承' })
check('简单题直接结束', simple.route === 'simple' && simple.plans.length === 0 && simple.judge == null)
check('简单题不启动 Sub 和 Judge', calls.every((call) => !call.system.includes('评判员') && !call.system.includes('独立求解')))
check('简单题有直接答复', simple.answer.includes('静压轴承靠压力油膜'))

calls.length = 0
control.classifier = 'simple'
const boundary = await runSama2({ userText: '主轴发热' })
check('边界题先问分类器', calls.some((call) => call.system.includes('问题分类器')))
check('分类器判简单后不启动五路', boundary.route === 'simple' && boundary.plans.length === 0 && calls.filter((call) => call.system.includes('独立求解')).length === 0)

calls.length = 0
control.classifier = 'complex'
const complex = await runSama2({ userText: '外圆磨床主轴发热、震动大', maxStep: 4 })
const ids = complex.plans.map((plan) => plan.id).sort()
check('复杂题走五路', complex.route === 'complex' && ids.join() === 'sub1,sub2,sub3,sub4,sub5')
check('硬规则复杂题不再调用分类器', calls.every((call) => !call.system.includes('问题分类器')))
check('每路都拿到完整原题', calls.filter((call) => call.system.includes('独立求解')).every((call) => call.user.includes('外圆磨床主轴发热、震动大')))
check('每路先行动再收束', complex.plans.every((plan) => plan.stepCount === 2 && plan.trace[0].tool && plan.trace[1].final))
check('五路提示没有指定分析角度', calls.filter((call) => call.system.includes('独立求解')).every((call) => !/根源分析专家|风险审查|分步排查|维修文档|现场实操/.test(call.system)))
const sub1Notes = calls.filter((call) => call.system.includes('第1路独立求解') && !call.user.includes('（还没有）'))
const sub2Notes = calls.filter((call) => call.system.includes('第2路独立求解') && !call.user.includes('（还没有）'))
check('子代理之间看不到对方记录', sub1Notes.length > 0 && sub1Notes.every((call) => !call.user.includes('第2路')) && sub2Notes.every((call) => !call.user.includes('第1路')))
check('Judge 选出加权最高的现场方案', complex.judge?.winnerId === 'sub2' && complex.answer.includes('第2路的完整维修方案') && complex.answer.includes('评分汇总'))
check('准确性专评独立给出可信度', complex.accuracy?.bestId === 'sub1' && complex.accuracy?.accuracy === 9 && complex.accuracy?.credibility === 8 && complex.answer.includes('准确性专评'))
check('流程走向和思考被记下来', complex.flow?.some((step) => step.title === '判定为复杂问题') && complex.plans.every((plan) => plan.trace.some((step) => step.thought)))

calls.length = 0
control.failRole = '第3路独立求解'
const partial = await runSama2({ userText: '主轴偶发异响', maxStep: 4 })
control.failRole = ''
const failed = partial.plans.find((plan) => plan.id === 'sub3')
const alive = partial.plans.filter((plan) => plan.id !== 'sub3')
check('单路失败不拖垮其余四路', failed?.plan.startsWith('方案生成失败') && alive.every((plan) => plan.status === 'done' && plan.plan.includes('完整维修方案')))
check('失败方案仍进入评判且不中选', partial.judge?.winnerId === 'sub2' && partial.answer.includes('方案生成失败'))

calls.length = 0
control.alwaysTool = true
const capped = await runSama2({ userText: '换了轴承还是发热', maxStep: 2 })
control.alwaysTool = false
check('达到轮次上限后强制收束', capped.plans.every((plan) => plan.stepCount === 2 && plan.plan.includes('已按轮次上限收束的方案')))
check('上限轮不再执行工具', capped.plans.every((plan) => plan.trace[1].tool === ''))

calls.length = 0
const forced = await runSama2({ userText: '什么是砂轮动平衡', forceMultiAgent: true, maxStep: 4 })
check('force_multi_agent 跳过简单题短路', forced.route === 'complex' && forced.complexity.source === 'force' && forced.plans.length === 5)

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nflow ok')

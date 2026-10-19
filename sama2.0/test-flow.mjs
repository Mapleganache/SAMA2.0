/**
 * 用假的模型接口走一遍预设链路，不访问真实 API。
 */
process.env.SAMA2_API_KEY = 'test-key'
process.env.SAMA2_BASE_URL = 'http://127.0.0.1:9/v1'
process.env.SAMA2_MODEL = 'test-model'

const calls = []
const control = {
  classifier: 'complex',
  failRole: '',
  alwaysTool: false,
  ungrounded: false,
}

globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  const system = body.messages[0].content
  const user = body.messages[1].content
  calls.push({ system, user, temperature: body.temperature, seed: body.seed })

  if (system.includes('问题分类器')) {
    return jsonResponse({ choices: [{ message: { content: `{"level":"${control.classifier}","reason":"分类器结果"}` } }] })
  }
  if (system.includes('独立监督者')) {
    return jsonResponse({ choices: [{ message: { content: '{"numeric_agree":true,"missing":[],"isolation_noted":false,"note":"对照完成"}' } }] })
  }
  if (system.includes('安全抽查')) {
    return jsonResponse({ choices: [{ message: { content: '{"safety":8}' } }] })
  }
  if (system.includes('准确性专评')) {
    return jsonResponse({ choices: [{ message: { content: '{"accuracy":8,"credibility":7,"reason":"对准现象"}' } }] })
  }
  if (system.includes('评判员')) {
    return jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            note: '按加权分选取',
            scores: [
              { id: 'sub0', scores: { accuracy: 6, safety: 6, feasibility: 6, completeness: 6, brevity: 6 }, defect: '根因证据偏少' },
              { id: 'sub1', scores: { accuracy: 9, safety: 9, feasibility: 8, completeness: 8, brevity: 7 }, defect: '' },
              { id: 'sub2', scores: { accuracy: 7, safety: 7, feasibility: 7, completeness: 7, brevity: 7 }, defect: '步骤偏长' },
              { id: 'sub3', scores: { accuracy: 7, safety: 6, feasibility: 7, completeness: 8, brevity: 5 }, defect: '工单不够聚焦' },
              { id: 'sub4', scores: { accuracy: 5, safety: 5, feasibility: 5, completeness: 5, brevity: 5 }, defect: '定位一般' },
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
  if (system.includes('禁止再调用工具') && control.alwaysTool) {
    return jsonResponse({ choices: [{ message: { content: '{"thought":"还想查","tool":"lookup_baseline","args":{"query":"主轴"}}' } }] })
  }
  if (control.askLane && system.includes(control.askLane) && user.includes('（还没有）')) {
    return jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            thought: '还要分清单元',
            tool: 'ask_user',
            args: { questions: [{ id: 'which_spindle', text: '发热的是砂轮主轴还是头架' }] },
          }),
        },
      }],
    })
  }
  const first = user.includes('（还没有）')
  if (first && !system.includes('禁止再调用工具')) {
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ thought: '先取测点', tool: 'lookup_baseline', args: { query: user.slice(0, 40) } }) } }],
    })
  }
  const lane = (system.match(/第(\d)路独立求解/) || [])[1]
  const extra = control.ungrounded ? ' 轴承间隙 0.02 mm' : ''
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify({ thought: '可以收束', final: lane ? `第${lane}路的完整维修方案${extra}` : `维修的完整维修方案${extra}` }) } }],
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

const ready = '外圆磨床主轴发热并且振动，空载，刚开机'

calls.length = 0
const simple = await runSama2({ userText: '什么是磨床静压轴承' })
check('简单题直接结束', simple.route === 'simple' && simple.plans.length === 0 && simple.judge == null)
check('简单题不启动 Sub 和 Judge', calls.every((call) => !call.system.includes('评判员') && !call.system.includes('独立求解')))
check('简单题有直接答复', simple.answer.includes('静压轴承靠压力油膜'))

calls.length = 0
const vague = await runSama2({ userText: '磨床有问题' })
check('含糊诊断先提问', vague.route === 'need_info' && vague.facts.subsystems.length === 0)
check('含糊诊断不问分类器', calls.every((call) => !call.system.includes('问题分类器')))
check('含糊诊断四项都缺', ['machine', 'phenomenon', 'load', 'thermal'].every((id) => vague.missing.includes(id)))
check('含糊诊断不给步骤', vague.answer.includes('还不能给出排查步骤') && !vague.answer.includes('主轴轴承'))

calls.length = 0
const heat = await runSama2({ userText: '主轴发热' })
check('只有主轴发热仍先提问', heat.route === 'need_info' && heat.missing.includes('machine') && heat.missing.includes('load') && !heat.missing.includes('phenomenon'))

calls.length = 0
control.classifier = 'simple'
const boundarySimple = await runSama2({ userText: 'STUDER 主轴发热，空载，刚开机' })
check('边界题先问分类器', calls.some((call) => call.system.includes('问题分类器')))
check('分类器判简单后不启动五路', boundarySimple.route === 'simple' && boundarySimple.plans.length === 0)

calls.length = 0
control.classifier = 'complex'
const boundary = await runSama2({ userText: 'STUDER 主轴发热，空载，刚开机', maxStep: 4 })
check('边界题第一份合格就停在一路', boundary.plans.length === 1 && boundary.judge?.winnerId === 'sub0')

calls.length = 0
control.ungrounded = true
const expanded = await runSama2({ userText: 'STUDER 主轴发热，空载，刚开机', maxStep: 4 })
control.ungrounded = false
check('无出处数值会补满五路', expanded.plans.length === 5)
check('无出处数值不交付步骤', expanded.route === 'no_plan' && expanded.answer.includes('没有可交付方案') && !expanded.answer.includes('拆卸'))

calls.length = 0
const complex = await runSama2({ userText: ready, maxStep: 4 })
const ids = complex.plans.map((plan) => plan.id).sort()
check('复杂题走五路', complex.route === 'complex' && ids.join() === 'sub0,sub1,sub2,sub3,sub4')
check('硬规则复杂题不再调用分类器', calls.every((call) => !call.system.includes('问题分类器')))
check('每路都拿到完整原题', calls.filter((call) => call.system.includes('独立求解')).every((call) => call.user.includes(ready)))
check('每路先行动再收束', complex.plans.every((plan) => plan.stepCount === 2 && plan.trace[0].tool && plan.trace[1].final))
check('提议温度和种子分开', calls.some((call) => call.system.includes('第1路独立求解') && call.temperature === 0.7 && call.seed === 1000) && calls.some((call) => call.system.includes('第2路独立求解') && call.seed === 1001))
check('五路提示没有指定分析角度', calls.filter((call) => call.system.includes('独立求解')).every((call) => !/根源分析专家|风险审查|分步排查|维修文档|现场实操/.test(call.system)))
const sub1Notes = calls.filter((call) => call.system.includes('第1路独立求解') && !call.user.includes('（还没有）'))
const sub2Notes = calls.filter((call) => call.system.includes('第2路独立求解') && !call.user.includes('（还没有）'))
check('子代理之间看不到对方记录', sub1Notes.length > 0 && sub1Notes.every((call) => !call.user.includes('第2路')) && sub2Notes.every((call) => !call.user.includes('第1路')))
check('只交付综合分最高的一份', complex.judge?.winnerId === 'sub1' && complex.accuracy?.bestId === 'sub1' && complex.answer.includes('第2路的完整维修方案') && complex.answer.includes('评分汇总') && !complex.answer.includes('两项分别保留'))
check('审计附在中选方案后面', complex.accuracy?.accuracy === 8 && complex.accuracy?.credibility === 7 && complex.answer.includes('审计附录'))
check('流程走向和思考被记下来', complex.flow?.some((step) => step.title === '判定为复杂问题') && complex.plans.every((plan) => plan.trace.some((step) => step.thought)))

calls.length = 0
control.failRole = '第3路独立求解'
const partial = await runSama2({ userText: 'STUDER 主轴偶发异响，空载，刚开机', maxStep: 4 })
control.failRole = ''
const failed = partial.plans.find((plan) => plan.id === 'sub2')
const alive = partial.plans.filter((plan) => plan.id !== 'sub2')
check('单路失败不拖垮其余四路', failed?.plan.startsWith('方案生成失败') && alive.every((plan) => plan.status === 'done' && plan.plan.includes('完整维修方案')))
check('失败方案不中选', partial.judge?.winnerId === 'sub1' && partial.answer.includes('方案生成失败'))

calls.length = 0
control.alwaysTool = true
const capped = await runSama2({ userText: 'STUDER 换了轴承还是发热，空载，刚开机', maxStep: 2 })
control.alwaysTool = false
check('达到轮次上限后强制收束', capped.plans.every((plan) => plan.stepCount === 2 && plan.plan.includes('已按轮次上限收束的方案')))
check('上限轮不再执行工具', capped.plans.every((plan) => plan.trace[1].tool === ''))

calls.length = 0
const forcedVague = await runSama2({ userText: '什么是砂轮动平衡', forceMultiAgent: true, maxStep: 4 })
check('强制多路仍先问必填项', forcedVague.route === 'need_info' && forcedVague.plans.length === 0)
calls.length = 0
const forced = await runSama2({ userText: ready, forceMultiAgent: true, maxStep: 4 })
check('force_multi_agent 在信息齐全时走满五路', forced.route === 'complex' && forced.complexity.source === 'force' && forced.plans.length === 5)

calls.length = 0
control.askLane = '第3路独立求解'
const mixed = await runSama2({ userText: ready, maxStep: 4 })
control.askLane = ''
check('有一路提问时不交付已写好的步骤', mixed.route === 'need_info' && mixed.judge == null && mixed.answer.includes('砂轮主轴还是头架') && mixed.answer.includes('还不能给出排查步骤') && !mixed.answer.includes('第2路的完整维修方案'))
check('提问留在各路记录里', mixed.plans.some((plan) => plan.status === 'need_info') && mixed.plans.some((plan) => String(plan.plan || '').includes('完整维修方案')))

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nflow ok')

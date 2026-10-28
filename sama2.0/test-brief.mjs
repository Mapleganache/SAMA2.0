/**
 * 主控分析简报：不联网，只测解析、rubric 与开关。
 */
process.env.SAMA2_API_KEY = 'test-key'
process.env.SAMA2_BASE_URL = 'http://127.0.0.1:9/v1'
process.env.SAMA2_MODEL = 'test-model'
process.env.SAMA2_JUDGE_MODEL = 'test-judge-model'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

const calls = []
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  const system = body.messages[0].content
  const user = body.messages[1].content
  calls.push({ system, user, model: body.model })
  if (system.includes('主控分析员')) {
    if (control.briefFail) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '不是 JSON' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            phenomena: ['发热', '异响'],
            hypotheses: [
              { id: 'h1', claim: '主轴润滑不足', checks: ['查油位', '查油压'] },
              { id: 'h2', claim: '轴承预紧异常', checks: ['查预紧'] },
            ],
            mustCheck: ['空载 vs 磨削分离', '冷机 vs 热机对比'],
            exclusions: ['不得编造未实测数值'],
            acceptance: ['每个假设都要有可执行的验证步骤'],
            confidence: 0.6,
            note: '',
          }),
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (system.includes('问题分类器')) {
    return json({ level: 'complex', reason: '分类器结果' })
  }
  if (system.includes('独立监督者')) {
    return json({ numeric_agree: true, missing: [], isolation_noted: false, note: '对照完成' })
  }
  if (system.includes('安全抽查')) return json({ safety: 8 })
  if (system.includes('准确性专评')) return json({ accuracy: 8, credibility: 7, reason: '对准现象' })
  if (system.includes('评判员')) {
    return json({
      note: '按加权分选取',
      scores: [
        { id: 'sub0', scores: { accuracy: 6, safety: 6, feasibility: 6, completeness: 6, brevity: 6 }, defect: '少' },
        { id: 'sub1', scores: { accuracy: 9, safety: 9, feasibility: 8, completeness: 8, brevity: 7 }, defect: '' },
        { id: 'sub2', scores: { accuracy: 7, safety: 7, feasibility: 7, completeness: 7, brevity: 7 }, defect: '长' },
        { id: 'sub3', scores: { accuracy: 7, safety: 6, feasibility: 7, completeness: 8, brevity: 5 }, defect: '散' },
        { id: 'sub4', scores: { accuracy: 5, safety: 5, feasibility: 5, completeness: 5, brevity: 5 }, defect: '弱' },
      ],
    })
  }
  if (user.includes('（还没有）') && !system.includes('禁止再调用工具')) {
    return json({ thought: '先取测点', tool: 'lookup_baseline', args: { query: user.slice(0, 40) } })
  }
  const lane = (system.match(/第(\d)路独立求解/) || [])[1]
  return json({ thought: '可以收束', final: lane ? `第${lane}路的完整维修方案` : '维修的完整维修方案' })
}

function json(payload) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const control = { briefFail: false }
const { buildBrief } = await import('./brief.mjs')
const { buildRubric } = await import('./rubric.mjs')
const { resolveConfig } = await import('./config.mjs')
const { runSama2 } = await import('./index.mjs')

const facts = { phenomena: ['发热'], machine: '外圆磨床', load: '空载', thermal: '冷机' }
control.briefFail = true
const failed = await buildBrief({ query: '外圆磨床主轴发热，空载，刚开机', facts, complexity: { level: 'complex' }, timeoutMs: 5000 })
control.briefFail = false
check('简报解析失败返回 ok:false 且不抛错', failed.ok === false && failed.source === 'fallback' && failed.exclusions.some((item) => item.includes('未实测')))

const brief = await buildBrief({ query: '外圆磨床主轴发热异响，空载，刚开机', facts, complexity: { level: 'complex' }, timeoutMs: 5000 })
check('简报解析成功', brief.ok === true && brief.source === 'llm' && brief.hypotheses.length >= 2)
const rubric = buildRubric(facts, brief)
check('rubric 含必查项与禁止项', rubric.caseNotes.some((note) => note.includes('必查项')) && rubric.caseNotes.some((note) => note.includes('禁止项')))
check('rubric 含检查表', String(rubric.checklist || '').includes('评分检查表'))
check('无 brief 时 rubric 与原先一致', buildRubric(facts).caseNotes.join('|') === buildRubric(facts, null).caseNotes.join('|'))

check('默认开启 brief', resolveConfig({}).briefEnabled === true)
process.env.SAMA2_BRIEF = '0'
check('SAMA2_BRIEF=0 关闭 brief', resolveConfig({}).briefEnabled === false)
delete process.env.SAMA2_BRIEF

calls.length = 0
process.env.SAMA2_BRIEF = '0'
const off = await runSama2({ userText: 'STUDER 主轴发热并且振动，空载，刚开机', maxStep: 4 })
check('关闭时主图不调用简报', calls.every((item) => !item.system.includes('主控分析员')))
check('关闭时 result.brief 为空', off.brief == null)
delete process.env.SAMA2_BRIEF

calls.length = 0
const on = await runSama2({ userText: 'STUDER 主轴发热并且振动，空载，刚开机', maxStep: 4, briefEnabled: true })
check('开启时产出 brief', on.brief?.ok === true && on.brief?.source === 'llm')
check('开启时第5路为反方', calls.some((item) => item.system.includes('第5路独立求解') && item.system.includes('挑战上面的分析')))
const judgeUser = calls.find((item) => item.system.includes('评判员'))?.user || ''
check('开启时 Judge 含检查表', judgeUser.includes('评分检查表'))

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nbrief ok')

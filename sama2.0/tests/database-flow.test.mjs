/** 最新LangGraph的实际调用链；仅替换模型HTTP，不需要API密钥，不评价答案正确率。 */
import test from 'node:test'
import assert from 'node:assert/strict'
process.env.SAMA2_API_KEY='offline-test-placeholder'
process.env.SAMA2_BASE_URL='http://127.0.0.1:9/v1'
process.env.SAMA2_MODEL='offline-only'
test('最新LangGraph的Main与五路Sub实际接收SQLite证据且通过引用检查',async()=>{
 const originalFetch=globalThis.fetch,received=new Set();let calls=0
 globalThis.fetch=async(url,init)=>{
  assert.match(String(url),/^http:\/\/127\.0\.0\.1:9\//);calls++
  const body=JSON.parse(init.body),system=body.messages[0].content,user=body.messages[1].content;let content
  if(system.includes('问题分类器'))content=JSON.stringify({level:'complex',reason:'离线接线测试'})
  else if(system.includes('主控分析员'))content=JSON.stringify({phenomena:['发热'],hypotheses:[{id:'h1',claim:'润滑不足',checks:['查油压']},{id:'h2',claim:'轴承预紧',checks:['查预紧']}],mustCheck:['空载与磨削分离'],exclusions:['不得编造未实测数值'],acceptance:['有验证步骤'],confidence:0.6,note:''})
  else if(system.includes('这是简单问题')){
   assert.match(user,/SQLite全量资料/);const id=user.match(/sqlite_(?:curated|fragment):\d+/)?.[0];assert.ok(id);received.add('Main');content='只读参考 '+id+'；本机适用性仍需核对。'
  }else if(system.includes('独立监督者'))content=JSON.stringify({numeric_agree:true,missing:[],isolation_noted:true,note:'离线测试'})
  else if(system.includes('安全抽查'))content=JSON.stringify({safety:8})
  else if(system.includes('准确性专评'))content=JSON.stringify({accuracy:0,credibility:0,reason:'桩响应不评价质量'})
  else if(system.includes('评判员'))content=JSON.stringify({note:'桩评分无质量含义',scores:[0,1,2,3,4].map(i=>({id:'sub'+i,scores:{accuracy:8,safety:8,feasibility:8,completeness:8,brevity:8},defect:''}))})
  else if(system.includes('独立求解')){
   if(user.includes('（还没有）'))content=JSON.stringify({thought:'离线接线测试',tool:'search_knowledge',args:{query:'润滑油代用原则',domain:'机械'}})
   else{
    assert.match(user,/SQLite全量资料/);const id=user.match(/sqlite_(?:curated|fragment):\d+/)?.[0];assert.ok(id)
    const lane=system.match(/第(\d+)路独立求解/)?.[1];received.add('Sub'+lane)
    content=JSON.stringify({thought:'离线接线测试',final:'拆卸前先隔离并保留砂轮防护。参见 '+id+' 核对厂家与油品条件，当前不作本机维修结论。'})
   }
  }else throw Error('未预期模型调用；不允许真实网络回退')
  return new Response(JSON.stringify({model:'offline-only',choices:[{message:{content}}]}),{status:200,headers:{'content-type':'application/json'}})
 }
 try{
  const {runSama2}=await import('../index.mjs')
  const simple=await runSama2({userText:'什么是磨床静压轴承'});assert.equal(simple.route,'simple')
  const multi=await runSama2({userText:'外圆磨床主轴发热并且振动，空载，刚开机',maxStep:4});assert.equal(multi.route,'complex');assert.equal(multi.plans.length,5)
  assert.ok(multi.plans.every(p=>p.trace.some(t=>t.observation?.includes('SQLite全量资料'))))
  assert.ok(multi.plans.every(p=>p.trace.some(t=>t.reason==='retrieval_tree'&&t.observation?.includes('SQLite全量资料（reference'))))
  assert.ok(multi.plans.every(p=>!(p.unsupported||[]).length))
  assert.equal(received.size,6);assert.ok(calls>0)
 }finally{globalThis.fetch=originalFetch}
})

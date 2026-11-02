import test from 'node:test'
import assert from 'node:assert/strict'
import {analyzeQuery} from '../sama-sqlite/query-analysis.mjs'
import {searchRecords,searchLibrary,closeDatabases} from '../sama-sqlite/library.mjs'
import {checkGrounding} from '../grounding.mjs'

test.after(()=>closeDatabases())
const ids=text=>[...text.matchAll(/\[\d+\]\s+(\S+)/g)].map(m=>m[1])

test('低温与导轨运动的改写能找到相关资料并保留出处',()=>{
 for(const [query,expected] of [
  ['寒冷天气下液压油系统刚启动反应慢，暖起来正常，先看什么？','H3842-2'],
  ['室温升高后恢复工作的液压装置，查油品的低温流动性','H3842-2'],
  ['导轨往返运动卡顿，正在使用普通机械油，请提供润滑适配资料','H3842-1'],
  ['磨床滑动导轨有爬动，润滑油牌号不确定，查选油原则','H3842-1'],
 ]){
  const result=searchLibrary(query,{excludeKinds:['case']})
  assert.ok(ids(result).includes(expected), `${query}: ${ids(result)}`)
  assert.match(result,/出处：/);assert.ok(result.length<=3400)
 }
})

test('缺失测量与回答限制不充当已观察症状，否定忽略仍保留关键词',()=>{
 const q=analyzeQuery('导轨爬行，尚无摩擦、压力实测。不要直接换油。不要忽略油压。')
 assert.match(q.positive,/导轨爬行/);assert.doesNotMatch(q.positive,/压力实测|直接换油/)
 assert.match(q.positive,/不要忽略油压/)
 assert.match(analyzeQuery('主轴没有油压但轴承发热').positive,/没有油压.*轴承发热/)
 assert.match(analyzeQuery('没有压力实测但主轴发热').positive,/主轴发热/)
 const result=searchLibrary('导轨往返运动卡顿，正在使用普通机械油，尚无压力实测，不直接确定换哪种油',{excludeKinds:['case']})
 assert.equal(ids(result)[0],'H3842-1')
})

test('跨设备压力不得直接迁移，并保留可追溯的资料和长度预算',()=>{
 const result=searchLibrary('油雾润滑装置的进气压力可直接用于型号和润滑结构不清的磨床吗？')
 assert.match(result,/不能直接套用/);assert.match(result,/测点和厂家资料/)
 assert.doesNotMatch(result,/\[\d+\] H2713-5/)
 assert.match(result,/油雾/)
 assert.match(result,/出处：/);assert.ok(result.length<=3400)
 const id=result.match(/sqlite_(?:curated|fragment|case):\d+/)?.[0]
 assert.ok(id);assert.equal(checkGrounding(`参考 ${id}`,result).pass,true)
})

test('扩展检索继续遵循生产审核、子系统和案例隔离',()=>{
 const query='寒冷天气下液压油反应慢，暖起来恢复'
 assert.equal(searchRecords(query,{mode:'production'}).records.length,0)
 const reviewed=searchRecords(query,{mode:'reviewed',subsystem:'液压润滑',excludeKinds:['case']})
 assert.ok(reviewed.records.length>0)
 assert.ok(reviewed.records.every(r=>r.kind==='curated'&&r.data.subsystem==='液压润滑'&&r.data.kind!=='case'))
 const isolated=searchRecords('第八章实例30抱轴',{mode:'reference',excludeKinds:['case']})
 assert.equal(isolated.records.length,0)
})

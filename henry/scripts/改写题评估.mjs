import {searchLibrary,closeDatabases} from '../../sama2.0/sama-sqlite/library.mjs'
const qs=[
 ['V01','冬天冷机时液压系统动作迟缓，机器热起来以后情况缓解，查找油液相关的检查依据。'],
 ['V02','车间低温时液压油流动性不好应该核对哪些手册资料？'],
 ['V03','机床工作台导轨爬行，目前使用机械油，请查找选用润滑剂应考虑的条件。'],
 ['V04','水基冷却液渗入液压油箱，油液颜色发白，请查可能涉及的油液问题。'],
 ['V05','油雾器进气压力能否直接用于主轴供油？机床型号和润滑结构不清楚。'],
 ['V06','查询第八章实例28的轴承损坏情况及出处。'],
]
const rows=qs.map(([id,query])=>{
 const start=performance.now(),result=searchLibrary(query,{excludeKinds:id==='V06'?[]:['case']})
 return {id,query,returnedIds:[...result.matchAll(/\[\d+\]\s+(\S+)/g)].map(m=>m[1]),elapsedMs:Math.round(performance.now()-start),result}
})
closeDatabases()
console.log(JSON.stringify({scope:'规则确定后拟定的6道人工改写题；未经过维修专家审核',rows},null,2))

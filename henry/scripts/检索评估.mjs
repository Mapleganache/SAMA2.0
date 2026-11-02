import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {searchRecords,searchLibrary,closeDatabases} from '../../sama2.0/sama-sqlite/library.mjs'
const dir=path.dirname(fileURLToPath(import.meta.url))
const questions=JSON.parse(fs.readFileSync(path.join(dir,'../数据库检索测试题集.json'),'utf8'))
const dbPath=path.resolve(dir,'../../sama2.0/data/sama_full.sqlite')
const rows=[]
for(const q of questions){
 const options={dbPath,mode:'reference',excludeKinds:q.exclude_casebook?['case']:[]}
 const start=performance.now(), result=searchLibrary(q.query,options), elapsedMs=Math.round(performance.now()-start)
 const ids=[...result.matchAll(/\[\d+\]\s+(\S+)/g)].map(m=>m[1]); const matches=q.required.filter(id=>ids.includes(id))
 rows.push({id:q.id,type:q.type,query:q.query,expectedIds:q.required,returnedIds:ids,matchedExpectedIds:matches,allExpectedFound:q.required.length?matches.length===q.required.length:null,casebookExcluded:q.exclude_casebook,elapsedMs,result})
}
closeDatabases()
const selected=rows.filter(r=>r.expectedIds.length)
console.log(JSON.stringify({scope:'开发题指定ID检索命中，不是资料准确率或诊断准确率',mode:'reference',targetQuestions:selected.length,questionsWithAllTargets:selected.filter(r=>r.allExpectedFound).length,targetIds:selected.reduce((n,r)=>n+r.expectedIds.length,0),targetIdsFound:selected.reduce((n,r)=>n+r.matchedExpectedIds.length,0),rows},null,2))

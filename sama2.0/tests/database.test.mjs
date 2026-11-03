import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {DatabaseSync} from 'node:sqlite'
import {prepareDatabase,hashFile} from '../scripts/prepare-db.mjs'
import {databaseOptions} from '../sama-sqlite/connection.mjs'
import {searchLibrary} from '../library.mjs'
import {checkGrounding} from '../grounding.mjs'
import {createToolRunner,buildDiagnosticTools} from '../tools.mjs'
import {searchRecords,closeDatabases} from '../sama-sqlite/library.mjs'
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url))),dbPath=path.join(ROOT,'data/sama_full.sqlite')
const digest=x=>createHash('sha256').update(x).digest('hex')
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'database-pack/manifest.json'),'utf8'))
test.after(()=>closeDatabases())
test('完整文本主库存在，大小和SHA与分发清单一致',async()=>{
 assert.equal(fs.statSync(dbPath).size,manifest.databaseBytes);assert.equal(await hashFile(dbPath),manifest.databaseSha256)
 const d=new DatabaseSync(dbPath,{readOnly:true});assert.equal(d.prepare('pragma integrity_check').get().integrity_check,'ok')
 for(const [table,n]of Object.entries(manifest.counts))assert.equal(d.prepare(`select count(*) n from ${table}`).get().n,n)
 d.close()
})
test('配置使用可移植相对路径，改变启动目录仍定位到仓库内主库',()=>{
 const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'sama-database.json')));assert.equal(path.isAbsolute(cfg.dbPath),false)
 const cwd=process.cwd();try{process.chdir(os.tmpdir());assert.equal(databaseOptions().dbPath,dbPath)}finally{process.chdir(cwd)}
})
test('最新版LangChain工具名保留，能真正invoke',async()=>{
 const ts=buildDiagnosticTools();assert.ok(ts.some(t=>t.name==='search_knowledge'));assert.ok(ts.some(t=>t.name==='search_mtkb'))
 const result=await ts.find(t=>t.name==='search_knowledge').invoke({query:'第八章实例30抱轴背景',domain:'机械'})
 assert.match(result,/C08-30/);assert.match(result,/临时措施/);assert.match(result,/sqlite_curated:\d+/)
})
test('全量检索包含20条试点之外的资料',()=>{
 const text=searchLibrary('滚珠丝杠预紧反向间隙',{domain:'机械'})
 assert.match(text,/FR-/);assert.match(text,/sqlite_fragment:\d+/);assert.match(text,/文本行/);assert.ok(text.length<=3400)
})
test('SQLite引用ID被最新版依据检查识别，伪造ID会被拒绝',()=>{
 const text=searchLibrary('第八章实例30抱轴背景'),id=text.match(/sqlite_curated:\d+/)[0]
 assert.equal(checkGrounding('参考 '+id,text).pass,true)
 assert.equal(checkGrounding('参考 sqlite_curated:99999999',text).pass,false)
 assert.equal(checkGrounding('参考 sqlite_curated:12','id: sqlite_curated:123').pass,false)
 assert.equal(checkGrounding('参考 sqlite_fragment:1','id: sqlite_fragment:10').pass,false)
 assert.equal(checkGrounding('参考 sqlite_curated:123','id: sqlite_curated:123').pass,true)
 assert.match(searchLibrary(id),/C08-30/)
})
test('原文片段引用ID支持精确续查，仍受审核限制',()=>{
 const text=searchLibrary('滚珠丝杠预紧反向间隙'),id=text.match(/sqlite_fragment:\d+/)[0]
 assert.match(searchLibrary(id),new RegExp(id));assert.match(searchLibrary('sqlite_fragment:99999999'),/没有对应/)
})
test('search_mtkb无需8765服务，不发起额外HTTP并保留设备匹配限制',async()=>{
 const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('测试禁止网络')}
 try{
  const run=createToolRunner({facts:{machine:'STUDER S40'}})
  const text=await run('search_mtkb',{query:'主轴油压与润滑',model:'模型伪传型号'})
  assert.match(text,/本机SQLite/);assert.match(text,/未知型号不代表/);assert.doesNotMatch(text,/MTKB 未连接/);assert.ok(text.length<=3400)
 }finally{globalThis.fetch=fetch}
})
test('领域、型号、LAD边界及无依据数值不越级',()=>{
 assert.match(searchLibrary('急停',{domain:'电路'}),/没有该领域/)
 assert.match(searchLibrary('液压油乳化起泡 换油周期缩短',{domain:'液压'}),/C08-31/)
 assert.match(searchLibrary('液压油乳化起泡 换油周期缩短',{domain:'光学'}),/C08-31/)
 assert.match(searchLibrary('磨床型号ZXQ987654321的报警'),/尚无经核验/)
 assert.match(searchLibrary('STUDER PMC急停'),/原图\/LAD/)
 assert.match(searchLibrary('无型号主轴油压应该设多少MPa确定值'),/不能给出确定数值/)
 assert.match(searchLibrary('轴承发烫超过多少温度必须更换阈值'),/没有可适用/)
})
test('正式模式不将待审核文本当作已批准资料',()=>{
 const result=searchRecords('润滑油代用',{dbPath,mode:'production'});assert.equal(result.records.length,0)
})
test('章节重复编号需要补充，不能默认第八章',()=>assert.match(searchLibrary('实例30的故障原因'),/多个章节/))
async function fixture(){
 const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'sama-db-fixture-'));await fsp.mkdir(path.join(folder,'database-pack'));await fsp.mkdir(path.join(folder,'data'))
 const sql=path.join(folder,'fixture.sqlite'),d=new DatabaseSync(sql);d.exec('create table x(v text);insert into x values(\'fixture\')');d.close()
 const bytes=await fsp.readFile(sql),gz=gzipSync(bytes),part='part-000.gzpart'
 await fsp.writeFile(path.join(folder,'database-pack',part),gz)
 const m={format:'sama-sqlite-gzip-parts-v1',databaseFile:'sama_full.sqlite',databaseBytes:bytes.length,databaseSha256:digest(bytes),compressedBytes:gz.length,compressedSha256:digest(gz),parts:[{file:part,bytes:gz.length,sha256:digest(gz)}]}
 await fsp.writeFile(path.join(folder,'database-pack/manifest.json'),JSON.stringify(m));return folder
}
test('安装器可还原且重复运行不覆盖已有正确库',async()=>{
 const f=await fixture();try{const p=await prepareDatabase({appRoot:f});assert.ok(fs.existsSync(p));assert.equal(await prepareDatabase({appRoot:f}),p)}finally{await fsp.rm(f,{recursive:true,force:true})}
})
test('分片损坏时失败并清理半成品',async()=>{
 const f=await fixture();try{await fsp.appendFile(path.join(f,'database-pack/part-000.gzpart'),'bad');await assert.rejects(prepareDatabase({appRoot:f}));assert.equal(fs.existsSync(path.join(f,'data/sama_full.sqlite')),false);assert.deepEqual(await fsp.readdir(path.join(f,'data')),[])}finally{await fsp.rm(f,{recursive:true,force:true})}
})
test('已存在的不同数据库不被安装器覆盖',async()=>{
 const f=await fixture();try{const p=path.join(f,'data/sama_full.sqlite');await fsp.writeFile(p,'user data');await assert.rejects(prepareDatabase({appRoot:f}),/已有/);assert.equal(await fsp.readFile(p,'utf8'),'user data')}finally{await fsp.rm(f,{recursive:true,force:true})}
})
test('可选工厂与最新版工具名相同并可被真实LangChain调用',async()=>{
 const {tool}=await import('langchain'),{z}=await import('zod'),{makeSamaSqliteTools}=await import('../sama-sqlite/langchain-tools.mjs')
 const tools=makeSamaSqliteTools({tool,z,options:{dbPath,mode:'reference'}})
 assert.deepEqual(tools.map(t=>t.name),['search_knowledge','search_mtkb'])
 assert.match(await tools[0].invoke({query:'润滑油代用原则'}),/sqlite_curated:\d+/)
 assert.match(await tools[1].invoke({query:'急停',domain:'电路'}),/没有该领域/)
})

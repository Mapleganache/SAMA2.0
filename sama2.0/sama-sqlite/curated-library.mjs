/** SQLite只读资料工具。沿用searchLibrary签名，无Markdown依赖、不允许模型提交SQL。 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SOURCE_OK=['selected_fields_pdf_visual_checked','original_markdown_exact_checked_pdf_pending']
const STOP=new Set(['数控','磨床','资料','查询','请给','给出','请问','什么','是否','说明','依据','不要','一个','这个','目前','情况','问题','没有','要求','对应','需要'])
const normalize=s=>String(s||'').toLowerCase().replaceAll('粘','黏')
const dbs=new Map()
export function closeDatabases(){for(const db of dbs.values())db.close();dbs.clear()}
function open(dbPath){
 const file=path.resolve(dbPath||process.env.SAMA2_SQLITE_PATH||path.join(ROOT,'data/sama_direct.sqlite'))
 if(dbs.has(file))return dbs.get(file)
 const db=new DatabaseSync(file,{readOnly:true})
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;')
  if(db.prepare("SELECT value FROM release_meta WHERE key='direct_adapter_version'").get()?.value!=='1')throw Error('不支持的直连数据库版本')
  dbs.set(file,db);return db
 }catch(e){db.close();throw e}
}
function config(options){
 const mode=options.mode||process.env.SAMA2_SQLITE_MODE||'production'
 if(!['production','experiment'].includes(mode))throw Error('mode只能是production或experiment')
 const exclusions=options.excludeKinds||(/^(1|true)$/i.test(process.env.SAMA2_SQLITE_EXCLUDE_CASES||'')?['case']:[])
 return {...options,mode,excludeKinds:exclusions,limit:Math.max(1,Math.min(4,Math.floor(Number(options.limit)||4)))}
}
function eligibility(o){
 const parts=[`u.source_check_status IN (${SOURCE_OK.map(()=>'?').join(',')})`,`u.expert_status<>'rejected'`],params=[...SOURCE_OK]
 if(o.mode==='production')parts.push("u.production_allowed=1 AND u.expert_status='approved'")
 else parts.push('u.experiment_allowed=1')
 if(o.subsystem){parts.push('u.subsystem=?');params.push(o.subsystem)}
 if(o.machineModel){parts.push('u.machine_model=?');params.push(o.machineModel)}
 for(const kind of o.excludeKinds){parts.push('u.kind<>?');params.push(kind)}
 return {sql:parts.join(' AND '),params}
}
function queryTerms(query,vocabulary){
 const q=normalize(query),terms=new Map()
 for(const word of q.match(/[\p{Script=Han}]+|[a-z0-9]+(?:[-.#][a-z0-9]+)*/gu)||[]){
  if(/^\p{Script=Han}+$/u.test(word))for(let i=0;i<word.length-1;i++){const t=word.slice(i,i+2);if(!STOP.has(t))terms.set(t,1)}
  else if(word.length>1)terms.set(word,3)
 }
 for(const {term} of vocabulary)if(q.includes(term))terms.set(term,term==='代用'?12:term.length>=3?5:3)
 return [...terms].slice(0,512)
}
const JOIN=`SELECT u.*,p.summary,p.structure_requirement,p.search_length,e.locator,e.line_start,e.line_end,e.source_id,s.title AS source_title,s.version AS source_version,s.version_status,s.relative_path,s.pdf_path FROM units u JOIN retrieval_profiles p ON p.unit_id=u.id JOIN evidence e ON e.id=u.evidence_id JOIN sources s ON s.id=e.source_id`
export function searchRecords(query,options={}){
 const raw=String(query||'').trim();if(!raw)return {mode:'none',records:[],reason:'没有查询词。'}
 if(raw.length>8000)return {mode:'none',records:[],reason:'查询过长，请限定为一个故障或资料问题。'}
 const o=config(options),db=open(o.dbPath),gate=eligibility(o)
 const eligible=db.prepare(`${JOIN} WHERE ${gate.sql} ORDER BY u.id`).all(...gate.params)
 if(!eligible.length)return {mode:o.mode,records:[],reason:o.mode==='production'?'没有已通过专业审核且获准正式使用的资料；当前试点仅可显式开启experiment模式。':'本查询条件下没有可用资料；不扩大设备或子系统范围。'}
 // 明确给出的机床型号必须有精确对应记录；控制器名称不能冒充机床型号。
 const named=raw.match(/(?:机床型号|磨床型号|型号)[\s：:]*([A-Za-z][A-Za-z0-9_.-]{2,})/i)?.[1]
 if(named&&!/^(FANUC|SIEMENS)$/i.test(named)&&!eligible.some(u=>normalize(u.machine_model)===normalize(named)))return {mode:o.mode,records:[],reason:`没查到机床型号${named}的精确对应资料，不能套用其他型号的报警或参数。`}
 const explicit=raw.match(/\b(?:C\d{2}-\d+|H\d{4}(?:-\d+)?)\b/i)?.[0]?.toUpperCase()
 const instance=raw.match(/实例\s*(\d+)/)?.[1]
 const requested=explicit||(instance?`C08-${Number(instance)}`:null)
 if(requested){const one=eligible.find(u=>u.id===requested);return {mode:o.mode,records:one?[hydrate(db,one,{score:null,reason:'exact_id_or_case'})]:[],reason:one?'':`未找到可用条目${requested}，不借用相似案例。`}}
 const terms=queryTerms(raw,db.prepare('SELECT term FROM search_vocabulary').all())
 if(!terms.length)return {mode:o.mode,records:[],reason:'没有可检索的有效词。'}
 const ids=new Set(eligible.map(u=>u.id)),lookup=new Map(eligible.map(u=>[u.id,u]))
 const postings=db.prepare(`SELECT term,unit_id,title_tf,body_tf FROM search_postings WHERE term IN (${terms.map(()=>'?').join(',')})`).all(...terms.map(([t])=>t)).filter(r=>ids.has(r.unit_id))
 const df=new Map();for(const r of postings)df.set(r.term,(df.get(r.term)||0)+1)
 const weight=new Map(terms),n=eligible.length,avg=eligible.reduce((s,u)=>s+u.search_length,0)/n,scores=new Map()
 for(const r of postings){
  const u=lookup.get(r.unit_id),tf=3*r.title_tf+r.body_tf,idf=Math.log(1+(n-df.get(r.term)+0.5)/(df.get(r.term)+0.5))
  const score=idf*(tf*2.2)/(tf+1.2*(0.25+0.75*u.search_length/avg))*weight.get(r.term)
  scores.set(r.unit_id,(scores.get(r.unit_id)||0)+score)
 }
 let ranked=[...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([id,score])=>({...lookup.get(id),score,reason:'bm25'}))
 if(!ranked.length)return {mode:o.mode,records:[],reason:'本地SQLite没有命中，不得编造手册条款或具体参数。'}
 // 相关选油前提占一个返回位置，且必须通过同一审核/型号/子系统筛选。
 const first=ranked[0],links=db.prepare('SELECT * FROM unit_links WHERE from_id=? ORDER BY to_id').all(first.id)
 for(const link of links){const related=lookup.get(link.to_id);if(!related)continue
  ranked=ranked.filter(r=>r.id!==related.id);ranked.splice(Math.min(1,ranked.length),0,{...related,score:0,reason:link.relation,linkReason:link.reason})
 }
 return {mode:o.mode,records:ranked.slice(0,o.limit).map(r=>hydrate(db,r,{score:r.score,reason:r.reason,linkReason:r.linkReason})),reason:''}
}
function hydrate(db,u,rank){
 const evidence=db.prepare('SELECT e.id,e.locator,e.line_start,e.line_end,e.raw_text,e.source_check_status FROM evidence e JOIN unit_evidence m ON m.evidence_id=e.id WHERE m.unit_id=? ORDER BY e.id').all(u.id)
 const paths=db.prepare('SELECT * FROM diagnostic_paths WHERE unit_id=? ORDER BY id').all(u.id)
 const parameters=db.prepare('SELECT * FROM parameters WHERE unit_id=? ORDER BY id').all(u.id)
 return {...u,...rank,evidence,paths,parameters}
}
function renderRecord(u,index){
 const parts=[`[${index}] ${u.id} ${u.title}`,`子系统：${u.subsystem}；类型：${u.kind==='case'?'历史案例':'通用原理'}；专业审核：${u.expert_status}。`,
 `适用：${u.structure_requirement}；机床型号：${u.machine_model||'未知'}${u.controller_model?`；控制器：${u.controller_model}`:''}。`,
 `内容：${u.summary}`]
 if(u.kind==='case'){
  const main=u.paths.find(p=>p.cause_kind==='historical_source_assertion')
  if(main)parts.push(`原例分析：${main.possible_cause}。`,main.action?`原例历史处理（不可直接用于本机）：${main.action}。`:'原例历史处理：未给。')
  parts.push('检查/判定/验收：原文未给完整本机规程，不能据此确定修复值。')
 }
 parts.push(`限制：${u.limitations}`)
 const quote=u.paths.find(p=>p.quote)?.quote
 if(quote)parts.push(`原文引句：${quote}`)
 parts.push(`出处：${u.source_title}；版本：${u.source_version||'未知'}；${u.locator}${u.line_start?`；MD行${u.line_start}—${u.line_end}`:''}；证据：${u.evidence.map(e=>e.id).join(',')}。`)
 if(u.source_check_status.includes('pdf_pending'))parts.push('原文核验：仅Markdown核对，PDF及本机适用性待核。')
 return parts.join('\n')
}
export function formatSearch(result,{budget=3400}={}){
 if(!result.records.length)return result.reason
 const header=`SQLite资料（${result.mode==='experiment'?'实验集，未经维修专家复核':'正式审核集'}）。一般原理与历史处理不等于本机结论；缺型号/结构/实测时不能推定，不得补造数值。\n`
 let output=header;const emitted=[],omitted=[]
 for(const r of result.records){const block=renderRecord(r,emitted.length+1)
  if(output.length+block.length+90>Math.min(3400,budget)){omitted.push(r.id);continue}
  output+=(emitted.length?'\n\n':'')+block;emitted.push(r.id)
 }
 if(omitted.length)output+=`\n完整性提示：受工具总长度限制未传入${omitted.join(',')}，请缩小查询范围；未截断条目中的条件或出处。`
 if(!emitted.length)return '所查资料无法在工具长度限制内完整返回，请缩小到一个条目；不得根据截断文本下结论。'
 return output
}
export function searchLibrary(query,options={}){
 try{return formatSearch(searchRecords(query,options),options)}catch(error){return `SQLite检索失败：${error.message}。未改用其他资料，不得声称已查到。`}
}

/** 全量SQLite资料接入。只读、绑定参数；全文参考与人工核对试点分层。 */
import {DatabaseSync} from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {searchRecords as curatedSearch,formatSearch as formatCurated,closeDatabases as closeCurated} from './curated-library.mjs'
import {analyzeQuery} from './query-analysis.mjs'
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const opened=new Map()
export function closeDatabases(){for(const d of opened.values())d.close();opened.clear();closeCurated()}
function config(o){
 const mode=o.mode||process.env.SAMA2_SQLITE_MODE||'reference'
 if(!['production','reviewed','reference','catalog'].includes(mode))throw Error('资料模式必须为production/reviewed/reference/catalog')
 return {...o,mode,dbPath:path.resolve(o.dbPath||process.env.SAMA2_SQLITE_PATH||path.join(ROOT,'data/sama_full.sqlite')),limit:Math.max(1,Math.min(4,Number(o.limit)||4))}
}
function dbFor(p){
 if(opened.has(p))return opened.get(p)
 const d=new DatabaseSync(p,{readOnly:true})
 try{d.exec('PRAGMA query_only=ON;PRAGMA trusted_schema=OFF;');if(d.prepare("select value from release_meta where key='full_archive_version'").get()?.value!=='1')throw Error('全量主库版本不支持');opened.set(p,d);return d}catch(e){d.close();throw e}
}
const stop=new Set(['数控','磨床','资料','什么','请给','给出','不要','说明','是否','没有','需要','目前','进行','一个','要求','检查','对应','机床','依据','原文','方法','查询'])
function terms(q){
 const {positive:text,expansions}=analyzeQuery(q),map=new Map()
 for(const w of text.match(/[\p{Script=Han}]+|[a-z0-9]+(?:[-.#][a-z0-9]+)*/gu)||[]){
  if(/^\p{Script=Han}+$/u.test(w))for(let i=0;i<w.length-1;i++){const t=w.slice(i,i+2);if(!stop.has(t))map.set(t,1)}
  else if(w.length>1)map.set(w,4)
 }
 for(const word of expansions)for(let i=0;i<word.length-1;i++){
  const term=word.slice(i,i+2);if(!stop.has(term)&&!map.has(term))map.set(term,0.6)
 }
 return [...map].slice(0,256)
}
const CHAPTER={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
function caseLookup(db,query,o){
 const num=query.match(/实例\s*(\d+)/)?.[1];if(!num)return null
 const chapter=query.match(/第([一二三四五六七八九\d]+)章/)?.[1];const n=CHAPTER[chapter]||Number(chapter)
 let rows=db.prepare('select r.rowid as citation_row,r.*,s.path,s.title as source_title from case_relations r join file_sources s on r.file_id=s.id where r.case_number=? order by r.line_start').all(Number(num))
 if(n)rows=rows.filter(r=>r.chapter.startsWith('第'+(Object.keys(CHAPTER).find(k=>CHAPTER[k]===n)||String(n))+'章'))
 if(!rows.length)return {records:[],reason:'没有该章节和实例的对应原文，不能借用相似案例。'}
 if(!chapter&&new Set(rows.map(r=>r.chapter)).size>1)return {records:[],reason:`实例${num}在多个章节重复编号，请补充章节；不能默认当第八章。`}
 if(rows.some(r=>r.machine_type!=='grinder')&&o.mode!=='catalog')return {records:[],reason:'该实例属于非磨床或设备类别未知资料，不进入磨床正常参考集；可在资料目录中查阅。'}
 return {records:rows.map(r=>({kind:'archive_case',...r})),reason:''}
}
export function searchRecords(query,options={}){
 const q=String(query||'').trim();if(!q)return {records:[],reason:'没有查询词。',mode:'none'}
 if(q.length>8000)return {records:[],reason:'查询过长，请限定到一个问题。',mode:'none'}
 const o=config(options),db=dbFor(o.dbPath),exclude=o.excludeKinds||(/^(1|true)$/i.test(process.env.SAMA2_SQLITE_EXCLUDE_CASES||'')?['case']:[])
 if(/\b(?:LAD|PMC)\b|梯形图|电路图|急停|STUDER|MIKROSA|FAVRETTO|米克罗莎/i.test(q)&&o.mode!=='catalog')return {mode:o.mode,records:[],reason:'电路与设备专有资料已登记入库，但原图/LAD逐点核验和专业适用性仍待完成，未进入正常维修参考；可用只读资料目录查询来源。'}
 const curated=curatedSearch(q,{...o,mode:o.mode==='production'?'production':'experiment',excludeKinds:exclude})
 const citation=q.match(/\bsqlite_(curated|fragment|case):(\d+)\b/)
 if(citation){
  const [_,kind,num]=citation
  if(kind==='curated'){
   const found=db.prepare('SELECT id FROM units WHERE rowid=?').get(Number(num))
   if(!found)return {mode:o.mode,records:[],reason:'没有对应的SQLite证据ID。'}
   const result=curatedSearch(found.id,{...o,mode:o.mode==='production'?'production':'experiment',excludeKinds:exclude})
   return {mode:o.mode,records:result.records.map(data=>({kind:'curated',data})),reason:result.reason}
  }
  if(o.mode==='production'||o.mode==='reviewed')return {mode:o.mode,records:[],reason:'原文片段和未核对历史案例不能绕过该模式的审核条件。'}
  if(kind==='fragment'){
   const found=db.prepare('SELECT id FROM full_fragments WHERE rowid=?').get(Number(num))
   return found?searchRecords(found.id,o):{mode:o.mode,records:[],reason:'没有对应的SQLite片段ID。'}
  }
  const row=db.prepare('select r.rowid as citation_row,r.*,s.path,s.title as source_title from case_relations r join file_sources s on r.file_id=s.id where r.rowid=?').get(Number(num))
  if(!row||exclude.includes('case')||(row.machine_type!=='grinder'&&o.mode!=='catalog'))return {mode:o.mode,records:[],reason:'该案例不存在或被机型/实验隔离条件限制。'}
  return {mode:o.mode,records:[{kind:'archive_case',...row}],reason:''}
 }
 if(o.mode==='production'||o.mode==='reviewed')return {mode:o.mode,records:curated.records.map(r=>({kind:'curated',data:r})),reason:curated.reason}
 // 精确型号无已确认对应文档时不以未知机型或控制器替代。
 const named=q.match(/(?:机床型号|磨床型号|型号)[\s：:]*([A-Za-z][A-Za-z0-9_.-]{2,})/i)?.[1]
 if(named&&!/^(FANUC|SIEMENS)$/i.test(named))return {mode:o.mode,records:[],reason:`本全量参考库尚无经核验的机床型号${named}专属资料，不能借用其他型号解释报警或设定参数。`}
 if(/油压|压力|温度|温升|阈值/.test(q)&&/确定值|必须更换|应该设多少|设多少/.test(q)) {
  const approved=db.prepare("SELECT count(*) AS n FROM parameters p JOIN units u ON u.id=p.unit_id WHERE p.allow_as_threshold=1 AND u.expert_status='approved' AND u.production_allowed=1 AND u.machine_model=?").get(o.machineModel||null).n
  if(!approved)return {mode:o.mode,records:[],reason:'当前数据库没有可适用于该机床的已核验压力或更换温度阈值，不能给出确定数值；需要机床型号、轴承/润滑结构、实测和本机手册。历史数值不是本机判据。'}
 }
 const cas=caseLookup(db,q,o)
 if(cas){
  if(exclude.includes('case'))return {mode:o.mode,records:[],reason:'本次查询已隔离历史案例，未返回对应答案案例。'}
  const exact=q.match(/第(?:八|8)章/)&&curated.records.length&&curated.records[0].id.startsWith('C08-')
  return exact?{mode:o.mode,records:[{kind:'curated',data:curated.records[0]}],reason:''}:{...cas,mode:o.mode}
 }
 const fragmentId=q.match(/\bFR-[a-f0-9]{24}\b/i)?.[0]
 if(fragmentId){
  const row=db.prepare('select f.rowid as citation_row,f.*,s.path,s.title as source_title,s.version_text,b.raw_text,b.clean_text from full_fragments f join file_sources s on s.id=f.file_id join content_blobs b on b.sha256=f.content_sha256 where f.id=?').get(fragmentId)
  if(!row||!row.reference_allowed||(o.subsystem&&!JSON.parse(row.subsystems_json).includes(o.subsystem))||(exclude.includes('case')&&row.path.includes('实例宝典')))return {mode:o.mode,records:[],reason:'该片段不存在或被审核/机型/实验隔离条件限制，未绕过准入返回。'}
  return {mode:o.mode,records:[{...row,kind:'source_reference'}],reason:''}
 }
 const toks=terms(q)
 if(!toks.length)return {mode:o.mode,records:[],reason:'没有可检索词。'}
 const stats=db.prepare(`select term,document_frequency from full_term_stats where term in (${toks.map(()=>'?').join(',')})`).all(...toks.map(([t])=>t));const df=new Map(stats.map(r=>[r.term,r.document_frequency]))
 const corpus=db.prepare('select fragment_count,avg_length from full_corpus_stats').get();const n=corpus.fragment_count,avg=corpus.avg_length
 const weighted=toks.filter(([t])=>df.has(t)).map(([t,w])=>[t,w*Math.log(1+(n-df.get(t)+.5)/(df.get(t)+.5))])
 if(!weighted.length)return {mode:o.mode,records:curated.records.slice(0,o.limit).map(r=>({kind:'curated',data:r})),reason:curated.reason}
 const conditions=['f.reference_allowed=1'],params=weighted.flat()
 if(o.subsystem){conditions.push('EXISTS (SELECT 1 FROM json_each(f.subsystems_json) x WHERE x.value=?)');params.push(o.subsystem)}
 if(exclude.includes('case'))conditions.push("s.path NOT LIKE '%实例宝典%'")
 const sql=`WITH q(term,weight) AS (VALUES ${weighted.map(()=>'(?,?)').join(',')}) SELECT f.id, SUM(q.weight*(3*p.title_tf+p.body_tf)*2.2/(3*p.title_tf+p.body_tf+1.2*(.25+.75*f.token_length/?))) AS score FROM full_postings p JOIN q ON q.term=p.term JOIN full_fragments f ON f.id=p.fragment_id JOIN file_sources s ON s.id=f.file_id WHERE ${conditions.join(' AND ')} GROUP BY f.id ORDER BY score DESC,f.id LIMIT 40`
 // avg参数在WHERE参数前。
 const args=[...weighted.flat(),avg,...params.slice(weighted.length*2)]
 const ranked=db.prepare(sql).all(...args)
 const candidates=ranked.map(({id,score})=>{const row=db.prepare('select f.rowid as citation_row,f.*,s.path,s.title as source_title,s.version_text,b.raw_text,b.clean_text from full_fragments f join file_sources s on s.id=f.file_id join content_blobs b on b.sha256=f.content_sha256 where f.id=?').get(id);return {...row,score,kind:'source_reference',entryKind:row?.kind||''}})
 // 同时命中问题核心现象与资料主题的原文优先；不据此放宽任何准入条件。
 const {positive}=analyzeQuery(q)
 const focus=/导轨/.test(positive)&&/爬行|爬动|运动不平稳|卡顿/.test(positive)?'guide'
  :/乳化/.test(positive)&&/油|液压/.test(positive)?'emulsion'
  :/油雾/.test(positive)&&/压力/.test(positive)?'mist':''
 if(focus)for(const row of candidates){
  const text=(row.title+' '+row.clean_text).toLowerCase()
  const matched=focus==='guide'?/导轨/.test(text)&&/爬行|润滑|摩擦/.test(text)
   :focus==='emulsion'?/乳化/.test(text)&&/检查|污染|变质|外观|含水/.test(text)
   :/油雾/.test(text)
  if(matched)row.score*=1.5
 }
 candidates.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
 // 明确的报警号/案例号：标题命中的结构化条目强制优先（案例条目、报警表条目）。
 const codeToken=q.match(/(?:例\s*\d+|#\s*\d{3,4}|\b\d{3,4}\b|ALM\s*\d{2,4})/i)?.[0]?.replace(/\s+/g,'')
 if(codeToken){
  const norm=codeToken.replace(/^#/,'').replace(/^例/,'')
  for(const row of candidates){
   const title=String(row.title||'')
   const isStructured=/案例|报警表|例\d+/.test(title+' '+(row.kind||''))
   if((title.includes(codeToken)||title.includes(norm)||title.includes('例'+norm))&&isStructured)row.score*=3
  }
  candidates.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
 }
 const out=[]
 // 油雾问题不强塞与油雾无关的试点，给原文检索留出位置。
 const selectedCurated=focus==='mist'?curated.records.filter(r=>/油雾/.test(r.title+' '+r.summary)):curated.records
 if(selectedCurated[0])out.push({kind:'curated',data:selectedCurated[0]})
 if(selectedCurated[1]?.reason?.endsWith('prerequisite')&&o.limit>1)out.push({kind:'curated',data:selectedCurated[1]})
 // 同源同层级最多一段，避免近重复连续占满结果；仅抑制本次返回，数据库记录不删。
 const groups=new Set()
 for(const row of candidates){const key=row.file_id+'|'+row.hierarchy;if(groups.has(key))continue;groups.add(key);out.push(row);if(out.length>=o.limit)break}
 if(!candidates.length)for(const row of selectedCurated.slice(1))if(out.length<o.limit)out.push({kind:'curated',data:row})
 return {mode:o.mode,records:out,reason:out.length?'':'全量库没有符合范围的资料；隔离资料不自动加入维修参考。'}
}
function render(r,i,db){
 if(r.kind==='curated')return formatCurated({mode:'experiment',records:[r.data],reason:''}).replace(/^SQLite资料[^\n]*\n/,'').replace(/^\[1\]/,`[${i}]`)
 if(r.kind==='archive_case'){
  return `[${i}] ${r.id} ${r.title}\nid: sqlite_case:${r.citation_row}\n用途：历史案例原表转写，PDF与专业适用性待核。机床型号未知，不是当前现场事实。\n症状：${r.symptom||'原文缺失'}\n作者原因分析：${r.possible_cause||'原文缺失'}\n历史处理：${r.action||'原文缺失'}\n检查、判定和量化验收：原文未独立给出，不补造。\n出处：${r.source_title}；${r.chapter}实例${r.case_number}；行${r.line_start}—${r.line_end}。\n缺失：${r.missing_json}`
 }
 if(r.entryKind==='alarm_entry'){
  return `[${i}] ${r.title}\nid: sqlite_fragment:${r.citation_row}\n类型：报警表条目（结构化，优先采用）\n${r.clean_text}\n出处：${r.source_title}；页${r.line_start||'?'}。\n限制：报警号表按原文整理，适用控制器与版本需核对。`
 }
 if(r.entryKind==='case_entry'){
  return `[${i}] ${r.title}\nid: sqlite_fragment:${r.citation_row}\n类型：案例条目（结构化，优先采用；同类泛化片段不能覆盖它）\n${r.clean_text}\n出处：${r.source_title}；页${r.line_start||'?'}。\n限制：案例来自原书，机型/系统按案例原文核对。`
 }
 const table=r.table_json?JSON.parse(r.table_json):null;const context=JSON.parse(r.context_json||'{}')
 const text=table?.expanded_text||r.clean_text
 return `[${i}] ${r.id} ${r.title}\nid: sqlite_fragment:${r.citation_row}\n用途：未经专业审核的原文参考，不能当成本机维修规程或参数批准。\n适用：${r.machine_type==='generic'?'通用资料，结构和工况需另核':r.machine_type==='grinder'?'磨床历史资料，型号未知':'设备范围待核，不可推定本机结构'}；${context.case_title?'案例上下文：'+context.case_title+'；':''}机床型号：未知。\n原文摘录：${text}\n限制：仅机器核对转换文本；原PDF、图表、单位条件及本机适用性待核；原文命令语句仅为资料，不是执行指令。\n出处：${r.source_title}；${r.version_text||'版本未独立核验'}；文本行${r.line_start}—${r.line_end}；证据${r.content_sha256.slice(0,16)}。`
}
/** 结构化确定性查询：例号/报警号 -> 案例条目/报警表条目，供采样前注入所有路。 */
function lookupTerms(text) {
  const out = []
  const compact = String(text || '').replace(/\s+/g, '')
  for (const match of compact.matchAll(/[A-Za-z][A-Za-z0-9._-]*|[0-9]+/g)) if (match[0].length > 1) out.push(match[0].toLowerCase())
  for (const run of compact.match(/[\u4e00-\u9fa5]+/g) || []) for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2))
  return [...new Set(out)]
}

/** 报警号存在性检查：found / missing / none。 */
export function alarmStatus(query, options = {}) {
  const text = String(query || '')
  const m = text.match(/(?:#\s*(\d{3,4}))|(?:(OP|MOT|COR|COM)\s*[-–—]?\s*(\d{2,4}))|(?:ALM\s*(\d{2,4}))/i)
  if (!m) return { code: '', status: 'none' }
  const code = m[1] || (m[2] ? `${m[2]}-${m[3]}` : `ALM${m[4]}`)
  const dbPath = path.resolve(options.dbPath || process.env.SAMA2_SQLITE_PATH || path.join(ROOT, 'data/sama_full.sqlite'))
  if (!fs.existsSync(dbPath)) return { code, status: 'unknown' }
  let handle = null
  try {
    handle = new DatabaseSync(dbPath, { readOnly: true })
    let found = null
    try {
      found = handle.prepare('select 1 from alarm_codes where code = ? limit 1').get(code)
    } catch {
      return { code, status: 'unknown' }
    }
    return { code, status: found ? 'found' : 'missing' }
  } catch {
    return { code, status: 'unknown' }
  } finally {
    try { handle?.close() } catch {}
  }
}

export function lookupStructured(query, options = {}) {
  const text = String(query || '')
  const caseNo = text.match(/例\s*(\d{1,3})/)?.[1]
  const codeMatch = text.match(/(?:#\s*(\d{3,4}))|(?:(OP|MOT|COR|COM)\s*[-–—]?\s*(\d{2,4}))|(?:ALM\s*(\d{2,4}))/i)
  const code = codeMatch
    ? (codeMatch[1] || (codeMatch[2] ? `${codeMatch[2]}-${codeMatch[3]}` : `ALM${codeMatch[4]}`))
    : ''
  const paramNo = text.match(/(?:参数|參數|Pr|No\.?)\s*(\d{2,5})/i)?.[1] || ''
  const terms = lookupTerms(text)
  if (!caseNo && !code && !paramNo && terms.length < 2) return ''
  const dbPath = path.resolve(options.dbPath || process.env.SAMA2_SQLITE_PATH || path.join(ROOT, 'data/sama_full.sqlite'))
  if (!fs.existsSync(dbPath)) return ''
  let handle = null
  try {
    handle = new DatabaseSync(dbPath, { readOnly: true })
    const rows = new Map()
    const push = (row) => { if (row && !rows.has(row.rowid)) rows.set(row.rowid, row) }
    const pick = handle.prepare(`select f.rowid, f.title, f.kind, b.clean_text, s.title as source_title, f.line_start
      from full_fragments f join content_blobs b on b.sha256=f.content_sha256 join file_sources s on s.id=f.file_id
      where f.kind in ('case_entry','alarm_entry') and (f.title like ? or f.title like ?) limit 4`)
    const pickParam = handle.prepare(`select f.rowid, f.title, f.kind, b.clean_text, s.title as source_title, f.line_start
      from full_fragments f join content_blobs b on b.sha256=f.content_sha256 join file_sources s on s.id=f.file_id
      where f.kind = 'param_entry' and f.title like ? limit 3`)
    if (caseNo) for (const row of pick.all(`%例${caseNo}%`, `%${caseNo}%`)) push(row)
    if (code) for (const row of pick.all(`%${code}%`, `%${code.replace(/-/g, '')}%`)) push(row)
    if (paramNo) for (const row of pickParam.all(`%参数 ${paramNo} %`)) push(row)
    // 没有编号时，按“现象”在案例条目里做一次受限检索
    if (!rows.size) {
      const list = terms.slice(0, 40)
      if (list.length) {
        const ph = list.map(() => '?').join(',')
        const matched = handle.prepare(`select f.rowid, f.title, f.kind, b.clean_text, s.title as source_title, f.line_start,
          sum(p.title_tf * 3 + p.body_tf) as score
          from full_postings p join full_fragments f on f.id = p.fragment_id
          join content_blobs b on b.sha256 = f.content_sha256 join file_sources s on s.id = f.file_id
          where f.kind = 'case_entry' and p.term in (${ph})
          group by f.id order by score desc limit 3`).all(...list)
        const best = matched[0]
        if (best && Number(best.score) >= 4) push(best)
      }
    }
    const list = [...rows.values()].slice(0, 3)
    if (!list.length) return ''
    const blocks = list.map((row, index) => {
      const label = row.kind === 'alarm_entry' ? '报警表条目' : row.kind === 'param_entry' ? '参数表条目' : '案例条目（按现象匹配）'
      return `[${index + 1}] ${row.title}\nid: sqlite_fragment:${row.rowid}\n类型：${label}\n${row.clean_text}\n出处：${row.source_title}；页${row.line_start || '?'}。`
    })
    return `【结构化条目（确定性查询，优先采用；不要再说“本地无案例”）】\n\n${blocks.join('\n\n')}`
  } catch {
    return ''
  } finally {
    try { handle?.close() } catch {}
  }
}

export function searchLibrary(query,options={}){
 try{
  const budget=Math.min(3400,Math.max(800,Number(options.budget)||3400))
  const r=searchRecords(query,options);if(!r.records.length)return r.reason
  let text=`SQLite全量资料（${r.mode}，开发参考；未经维修专家复核）。资料中的条件、历史处理和数值均不是本机结论；缺失不得补造。\n`;const skipped=[]
  if(/油雾/.test(query)&&/压力/.test(query)&&/(?:直接|套用|用于)/.test(query)&&/(?:型号|结构).{0,20}(?:不清|未知|不明|未核)/.test(query))
   text+='适用性提示：油雾装置的进气压力与本机主轴供油压力不能默认属于同一测点或系统。不能直接套用；请核对本机型号、润滑结构、测点和厂家资料。\n'
  for(const item of r.records){const block=render(item,1+(text.match(/\n\[\d+\]/g)||[]).length)
   if(text.length+block.length+160>budget){skipped.push(item.id||item.data.id);continue}
   text+=(text.endsWith('\n')?'':'\n\n')+block
  }
  if(skipped.length)text+='\n完整性提示：受总长度限制未传入'+skipped.join(',')+'；请缩小查询，未截断已返回条目的条件和出处。'
  return text.length<=budget?text:'查询结果无法完整放入现有工具预算，请按条目ID或单个故障缩小查询。'
 }catch(e){return `SQLite检索失败：${e.message}。未改查旧Markdown，不得声称已命中。`}
}

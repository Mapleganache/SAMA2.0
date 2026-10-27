/** 可选工具工厂：与当前主体保持同名；正常入口使用tools.mjs。 */
import {searchLibrary} from './library.mjs'
export function makeSamaSqliteTools({tool,z,options={}}){
 if(typeof tool!=='function'||!z?.object||!z?.string)throw Error('请传入LangChain tool与Zod z')
 return ['search_knowledge','search_mtkb'].map(name=>tool(
  async({query='',subsystem='',domain=''})=>domain&&domain!=='机械'?'本地知识库没有该领域的文档。':searchLibrary(query,{...options,subsystem}),
  {name,description:'只读查询本机SQLite资料，返回sqlite_*:编号、来源、适用条件及审核状态，不接受SQL。',schema:z.object({query:z.string().optional(),subsystem:z.string().optional(),domain:z.string().optional()})}
 ))
}

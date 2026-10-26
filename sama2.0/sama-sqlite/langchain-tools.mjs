/** 依赖由团队LangChain环境传入，无需修改编排链；运行时不接受任意SQL。 */
import { searchLibrary } from './library.mjs'
export function makeSamaSqliteTools({tool,z,options={}}){
 if(typeof tool!=='function'||!z?.object||!z?.string)throw new Error('请传入LangChain tool与Zod z')
 return ['search_knowledge','search_mechanical'].map(name=>tool(
  async({query,subsystem=''})=>searchLibrary(query,{...options,subsystem}),
  {name,description:'只读查询SAMA SQLite维修资料，返回适用条件、证据出处、缺失及审核状态；不能提交SQL。',schema:z.object({query:z.string(),subsystem:z.string().optional()})}
 ))
}

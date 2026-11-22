/** Node自带工具还原随Git分发的SQLite包；逐片及整库校验，不覆盖不匹配的已有库。 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {createGunzip} from 'node:zlib'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export async function hashFile(file){const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex')}
export async function prepareDatabase({appRoot=root}={}){
 const packDir=path.join(appRoot,'database-pack'),manifestPath=path.join(packDir,'manifest.json')
 if(!fs.existsSync(manifestPath)){
  console.log('未随代码提供 database-pack，跳过数据库还原。请把 sama_full.sqlite 放到 data/，或设置 SAMA2_SQLITE_PATH。')
  return null
 }
 const manifest=JSON.parse(await fsp.readFile(manifestPath,'utf8'))
 if(manifest.format!=='sama-sqlite-gzip-parts-v1'||!Array.isArray(manifest.parts)||!manifest.parts.length)throw Error('不支持的数据库分片清单')
 if(path.basename(manifest.databaseFile)!==manifest.databaseFile)throw Error('数据库文件名非法')
 const folder=path.join(appRoot,'data'),target=path.join(folder,manifest.databaseFile)
 if(fs.existsSync(target)){
  if((await fsp.stat(target)).size===manifest.databaseBytes&&await hashFile(target)===manifest.databaseSha256){console.log('SQLite已就绪，指纹匹配。');return target}
  throw Error('已有data/'+manifest.databaseFile+'与分发包指纹不同，已保留。请先备份并移走该文件，或使用SAMA2_SQLITE_PATH连接自己的库。')
 }
 await fsp.mkdir(folder,{recursive:true});const partial=target+'.partial-'+randomUUID(),dbHash=createHash('sha256'),compressedHash=createHash('sha256');let bytes=0,compressedBytes=0
 async function* readParts(){
  for(const part of manifest.parts){
   if(path.basename(part.file)!==part.file)throw Error('分片文件名非法')
   const file=path.join(packDir,part.file),h=createHash('sha256');let size=0
   for await(const chunk of fs.createReadStream(file)){h.update(chunk);compressedHash.update(chunk);size+=chunk.length;compressedBytes+=chunk.length;yield chunk}
   if(size!==part.bytes||h.digest('hex')!==part.sha256)throw Error('分片校验失败：'+part.file)
  }
 }
 const verify=new Transform({transform(chunk,encoding,cb){bytes+=chunk.length;if(bytes>manifest.databaseBytes)return cb(Error('还原数据超过清单大小'));dbHash.update(chunk);cb(null,chunk)}})
 try{
  console.log(`正在还原SQLite（${(manifest.databaseBytes/1024**3).toFixed(2)} GiB），只使用本地分片。`)
  await pipeline(Readable.from(readParts()),createGunzip(),verify,fs.createWriteStream(partial,{flags:'wx'}))
  if(bytes!==manifest.databaseBytes||dbHash.digest('hex')!==manifest.databaseSha256)throw Error('还原后的数据库校验失败')
  if(compressedBytes!==manifest.compressedBytes||compressedHash.digest('hex')!==manifest.compressedSha256)throw Error('压缩流整体校验失败')
  // 排他地发布目标，避免覆盖并发启动已生成的库。
  await fsp.link(partial,target);await fsp.unlink(partial)
  console.log('SQLite还原完成，SHA-256校验通过。');return target
 }catch(e){await fsp.rm(partial,{force:true});throw e}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.env.SAMA2_SKIP_DB_PREPARE==='1')console.log('显式跳过本地数据库还原。')
 else prepareDatabase().catch(e=>{console.error(e.message);process.exitCode=1})
}

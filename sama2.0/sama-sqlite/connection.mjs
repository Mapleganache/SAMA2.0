import fs from 'node:fs'
import path from 'node:path'
import {sama2Root} from '../settings.mjs'
export function databaseOptions(){
 const file=path.join(sama2Root(),'sama-database.json')
 if(!fs.existsSync(file))return null
 const config=JSON.parse(fs.readFileSync(file,'utf8'))
 if(!config.enabled)return null
 return {
  dbPath:path.resolve(sama2Root(),process.env.SAMA2_SQLITE_PATH||config.dbPath||'data/sama_full.sqlite'),
  mode:process.env.SAMA2_SQLITE_MODE||config.mode||'production',
 }
}

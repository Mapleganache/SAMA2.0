import { databaseOptions } from './sama-sqlite/connection.mjs'
import { searchLibrary as searchSqliteLibrary } from './sama-sqlite/library.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { sama2Root } from './settings.mjs'

export function searchLibrary(query, { subsystem = '', domain = '', limit = 4 } = {}) {
  const area = String(domain || '').trim()
  if (area && area !== '机械') return '本地知识库没有该领域的文档。'
  try {
    const database = databaseOptions()
    if (database) return searchSqliteLibrary(query, { subsystem, limit, ...database })
  } catch (error) {
    return `SQLite配置读取失败：${error.message}。未改用旧Markdown，不得声称已查到。`
  }
  const raw = String(query || '').trim()
  if (!raw) return '没有查询词。'
  const docs = readDocs()
  if (!docs.length) return 'sama2.0/knowledge 里还没有资料。不要编造手册条款。'
  const filtered = subsystem
    ? docs.filter((doc) => doc.subsystem === subsystem || doc.text.includes(subsystem))
    : docs
  const pool = filtered.length ? filtered : docs
  const terms = termsOf(raw)
  const ranked = pool
    .map((doc) => ({ ...doc, score: scoreDoc(doc, terms) }))
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  if (!ranked.length) return `本地资料没有命中「${raw}」。不要把未查到的内容写成手册条款或具体数值。`
  const note = subsystem && !filtered.length ? `未按子系统「${subsystem}」筛到专文，下面是全文检索结果。\n\n` : ''
  return note + ranked.map((doc, index) => formatHit(doc, index)).join('\n\n')
}

function formatHit(doc, index) {
  const end = Math.min(doc.text.length, 700)
  const excerpt = doc.text.slice(0, end)
  return `[${index + 1}] ${doc.title}\nid：knowledge/${doc.file}#0-${end}\n${excerpt}`
}

let docCache = { key: '', docs: [] }

function readDocs() {
  const dir = path.join(sama2Root(), 'knowledge')
  if (!fs.existsSync(dir)) return []
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
  const key = names.map((name) => {
    const stat = fs.statSync(path.join(dir, name))
    return `${name}:${stat.mtimeMs}:${stat.size}`
  }).join('|')
  if (key === docCache.key) return docCache.docs
  const docs = names.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8')
    const title = (text.match(/^#\s+(.+)$/m) || [])[1] || file
    const subsystem = (text.match(/^子系统：(.+)$/m) || [])[1]?.trim() || ''
    return { file, title, subsystem, text }
  })
  docCache = { key, docs }
  return docs
}

function termsOf(query) {
  const compact = String(query || '').toLowerCase().replace(/\s+/g, '')
  const words = compact.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2)
  const grams = []
  for (let i = 0; i < compact.length - 1 && grams.length < 20; i += 1) grams.push(compact.slice(i, i + 2))
  return [...new Set([...words, ...grams])]
}

function scoreDoc(doc, terms) {
  const hay = `${doc.title}\n${doc.text}`.toLowerCase()
  return terms.reduce((sum, term) => sum + (hay.includes(term) ? (term.length > 1 ? 2 : 1) : 0), 0)
}

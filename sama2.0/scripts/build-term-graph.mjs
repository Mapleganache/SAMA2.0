/** 从全量 SQLite 的 full_postings 生成诊断词共现图。 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { buildTermGraph, writeTermGraph, TERM_GRAPH_FILE } from '../sama-sqlite/term-graph.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dbPath = process.env.SAMA2_SQLITE_PATH || path.join(root, 'data/sama_full.sqlite')
const db = new DatabaseSync(dbPath, { readOnly: true })
db.exec('PRAGMA query_only=ON')
const graph = buildTermGraph(db)
db.close()
writeTermGraph(graph, TERM_GRAPH_FILE)
const sample = graph.nodes['粗糙']?.map((row) => row.term).join('、') || '（无）'
console.log(`term-graph: ${graph.nodeCount} 个节点 fingerprint=${graph.fingerprint} → ${TERM_GRAPH_FILE}`)
console.log(`粗糙 邻域：${sample}`)

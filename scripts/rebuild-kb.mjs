/**
 * 不依赖 Electron 进程即可重建知识库索引
 * 运行：node scripts/rebuild-kb.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const kbRoot = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'sama',
  'sama-data',
  'kb',
)
const docsDir = path.join(kbRoot, 'docs')

function listTextFiles(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) out.push(...listTextFiles(full))
    else if (/\.(md|txt|nc|xml)$/i.test(name)) out.push(full)
  }
  return out
}

function chunkText(text, size, overlap) {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const parts = []
  let i = 0
  while (i < clean.length) {
    parts.push(clean.slice(i, i + size))
    i += Math.max(1, size - overlap)
  }
  return parts
}

function fingerprint(files) {
  return files
    .map((f) => {
      const st = fs.statSync(f)
      const rel = path.relative(kbRoot, f).split(path.sep).join('/')
      return `${rel}:${st.size}:${Math.round(st.mtimeMs)}`
    })
    .sort()
    .join('|')
}

const files = listTextFiles(docsDir)
const fp = fingerprint(files)
const chunks = []

for (const file of files) {
  const rel = path.relative(docsDir, file).split(path.sep).join('/')
  const brand = rel.includes('/') ? rel.split('/')[0] : '通用'
  const text = fs.readFileSync(file, 'utf8')
  chunkText(text, 800, 120).forEach((content, i) => {
    chunks.push({ id: `${rel}#${i}`, brand, source: rel, content })
  })
}

const brands = [...new Set(chunks.map((c) => c.brand))]
const manifest = {
  ready: chunks.length > 0,
  docCount: files.length,
  chunkCount: chunks.length,
  updatedAt: new Date().toISOString(),
  brands,
  docsFingerprint: fp,
  note: '知识库已就绪：资料未改时启动直接加载，不会每次重学',
}

fs.mkdirSync(kbRoot, { recursive: true })
fs.writeFileSync(path.join(kbRoot, 'index.json'), JSON.stringify({ version: 1, chunks, docsFingerprint: fp }))
fs.writeFileSync(path.join(kbRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

console.log(
  JSON.stringify(
    {
      docsDir,
      docCount: files.length,
      chunkCount: chunks.length,
      brands,
      indexMB: +(fs.statSync(path.join(kbRoot, 'index.json')).size / 1024 / 1024).toFixed(2),
    },
    null,
    2,
  ),
)

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  assertAllowedUserAbs,
  normalizeAbs,
  writeTextFile,
  deny,
} from './safeFs.mjs'

/**
 * 真实 FANUC PICTURE 工程里：
 * - `.fp2`：很小的工程索引文本（不是画面本体）
 * - `FPicture*.xml`：真正可编辑的画面（UTF-16，根节点 FANUCPicture）
 */

export function buildFp2Content(mainScreenBase = 'FPicture1') {
  const name = String(mainScreenBase || 'FPicture1').replace(/\.xml$/i, '')
  return `3Xi\r\n${name}\r\n"[RETURN]"3206""1\r\n"${name}"3207""0\r\n`
}

export function buildMinimalFanucScreenXml({
  screenComment = 'SAMA generated',
  scale = 100,
} = {}) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<FANUCPicture><Version>2.30</Version><Scale>${scale}</Scale><FPScrnSet Type="Control" ObjectID=""><Version>1.10</Version><Cursol><Up>0</Up><Down>0</Down><Left>0</Left><Right>0</Right><ContinuosInput>0</ContinuosInput><CursolDirection>-1</CursolDirection><ScreenSet>0</ScreenSet></Cursol><Option><SignalNotice>0</SignalNotice><PMC PMCType="SB7" Type="Output" Symbol="Off">R0.0</PMC><EnableSignal>0</EnableSignal><PMC PMCType="SB7" Type="Input" Symbol="Off">R0.0</PMC><ScreenNumber>1</ScreenNumber><ScreenSymbol>SAMA</ScreenSymbol><Color Disable="0">0</Color><TabIndex>0</TabIndex><Comment>${escapeXml(
    screenComment,
  )}</Comment></Option><CompEdit><ScreenName1></ScreenName1><ScreenName2></ScreenName2><ScreenName3></ScreenName3><ScreenName4></ScreenName4><ScreenName5></ScreenName5><ScreenName6></ScreenName6><ScreenName7></ScreenName7><ScreenName8></ScreenName8><ScreenName9></ScreenName9><ScreenName10></ScreenName10></CompEdit></FPScrnSet></FANUCPicture>
`
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function createFanucPictureProject(targetDir, opts = {}) {
  const dir = normalizeAbs(targetDir)
  assertAllowedUserAbs(dir, opts.trustedPaths || [dir])
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.statSync(dir).isDirectory()) throw deny('目标不是文件夹')

  const projectName = String(opts.projectName || 'SAMA_SCREEN').replace(
    /[<>:"/\\|?*\u0000-\u001f]/g,
    '_',
  )
  const screenBase = String(opts.screenName || 'FPicture1').replace(/\.xml$/i, '')
  const fp2Path = path.join(dir, `${projectName}.fp2`)
  const xmlPath = path.join(dir, `${screenBase}.xml`)

  writeTextFile(fp2Path, buildFp2Content(screenBase), 'utf8')

  let xmlCreated = false
  if (!fs.existsSync(xmlPath) || opts.overwriteXml) {
    writeTextFile(
      xmlPath,
      buildMinimalFanucScreenXml({
        screenComment: opts.comment || `SAMA ${projectName}`,
      }),
      'utf16le',
    )
    xmlCreated = true
  }

  const savescrPath = path.join(dir, 'savescr.txt')
  if (!fs.existsSync(savescrPath) || opts.overwriteMeta) {
    writeTextFile(savescrPath, `"${screenBase}" 0 P\r\n`, 'utf8')
  }

  return {
    ok: true,
    dir,
    fp2Path,
    xmlPath,
    xmlCreated,
    hint: '请用 FANUC PICTURE 打开生成的 .fp2；画面在同目录 FPicture*.xml。',
  }
}

export function wantsCreateFp2Project(userText = '') {
  const t = String(userText || '')
  return (
    /(?:能不能|可否|可以|能).{0,12}(?:生成|创建|新建|写).{0,12}(?:fp2?|\.fp2?|fp\s*文件)/i.test(
      t,
    ) ||
    /(?:生成|创建|新建|写|做).{0,24}(?:fp2?|\.fp2?|fp\s*文件|fp\s*语言|picture)/i.test(t) ||
    /(?:fp2?|\.fp2?|fp\s*文件).{0,16}(?:生成|创建|新建|吗|嘛|不)/i.test(t)
  )
}

export function defaultFanucOutputDir() {
  return path.join(app.getPath('desktop'), 'SAMA_FANUC_GEN')
}

/** 已知本机 FANUC 案例目录（若存在则优先） */
export function preferredFanucDirs() {
  const desk = app.getPath('desktop')
  return [
    path.join(
      desk,
      'FAUNC PICTURE',
      'FAUNC PICTURE',
      'FANUC PICTURE',
      'AUTO FIND CENTER20200302(1)',
      'AUTO FIND CENTER20200302',
    ),
    path.join(desk, 'SAMA_FANUC_GEN'),
  ]
}

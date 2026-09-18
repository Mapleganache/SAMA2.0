/**
 * 在非 macOS 主机上交叉打出 SAMA.app，并打成带 Unix 可执行位的 zip。
 * 真机 Mac 请用 `npm run dist:mac:native` 打 dmg。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const require = createRequire(import.meta.url)
const png2icons = require('png2icons')
const yazl = require('yazl')

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const releaseDir = path.join(root, 'release')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version || '0.0.0'
const canvasVersion = '0.1.80'
const electronMirror = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/'

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${result.status})`)
  }
}

function ensureIcns() {
  const icnsPath = path.join(root, 'build', 'icon.icns')
  const pngPath = path.join(root, 'build', 'icon.png')
  if (fs.existsSync(icnsPath) && fs.statSync(icnsPath).size > 1024) return icnsPath
  if (!fs.existsSync(pngPath)) throw new Error('缺少 build/icon.png')
  const buf = png2icons.createICNS(fs.readFileSync(pngPath), png2icons.BILINEAR, 0)
  if (!buf) throw new Error('无法从 PNG 生成 ICNS')
  fs.writeFileSync(icnsPath, buf)
  console.log('Wrote', icnsPath)
  return icnsPath
}

function ensureDarwinCanvas() {
  for (const name of ['@napi-rs/canvas-darwin-arm64', '@napi-rs/canvas-darwin-x64']) {
    const dest = path.join(root, 'node_modules', name)
    const marker = path.join(dest, 'package.json')
    if (fs.existsSync(marker)) continue
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sama-npm-pack-'))
    run('npm', ['pack', `${name}@${canvasVersion}`, `--pack-destination=${tmp}`])
    const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))
    if (!tgz) throw new Error(`npm pack 未得到 ${name}`)
    fs.mkdirSync(dest, { recursive: true })
    run('tar', ['-xzf', path.join(tmp, tgz), '-C', dest, '--strip-components=1'])
    fs.rmSync(tmp, { recursive: true, force: true })
    console.log('Installed', name, '->', dest)
  }
}

function isUnixExecutable(relPosix) {
  if (relPosix.includes('/MacOS/')) return true
  if (relPosix.includes('/Helpers/')) return true
  if (relPosix.endsWith('.dylib')) return true
  if (/\.framework\/(Versions\/[^/]+\/)?[^/]+$/.test(relPosix) && !path.extname(relPosix)) return true
  return false
}

function patchPlist(plistPath) {
  if (!fs.existsSync(plistPath)) return
  let xml = fs.readFileSync(plistPath, 'utf8')
  xml = xml.replace(
    /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1SAMA$2`,
  )
  xml = xml.replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]+(<\/string>)/, `$1SAMA$2`)
  xml = xml.replace(
    /(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1com.sama.app$2`,
  )
  fs.writeFileSync(plistPath, xml)
}

function countCodeSignature(appDir) {
  let n = 0
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const st = fs.lstatSync(full)
      if (st.isDirectory()) {
        if (name === '_CodeSignature') n += 1
        walk(full)
      }
    }
  }
  walk(appDir)
  return n
}

function finalizeSamaApp(electronApp, samaApp) {
  if (fs.existsSync(samaApp)) fs.rmSync(samaApp, { recursive: true, force: true })
  fs.renameSync(electronApp, samaApp)
  patchPlist(path.join(samaApp, 'Contents', 'Info.plist'))
  const sigCount = countCodeSignature(samaApp)
  console.log('Renamed Electron.app -> SAMA.app；_CodeSignature 目录数:', sigCount)
  if (sigCount === 0) {
    console.warn(
      '警告：包内无 CodeSignature（Windows 交叉打包常见）。Mac 上必须运行「修复并打开.command」做 ad-hoc 签名。',
    )
  }
}

/** Mac 双击即可：去隔离标记 + ad-hoc 签名（解决微信传包「文件已损坏」） */
const fixCommand = `#!/bin/bash
set -e
cd "$(dirname "$0")"
APP="SAMA.app"
if [ ! -d "$APP" ]; then
  echo "找不到 $APP，请先解压 zip，并把本脚本与 SAMA.app 放在同一目录。"
  read -r -p "按回车关闭…"
  exit 1
fi
echo "正在移除隔离标记（微信/浏览器下载会带上）…"
xattr -cr "$APP" || true
echo "正在用本机 ad-hoc 签名补齐 _CodeSignature…"
codesign --force --deep --sign - "$APP"
echo "校验…"
codesign --verify --deep --strict "$APP" && echo "签名 OK" || echo "校验有告警，仍可尝试打开"
echo "启动 SAMA…"
open "$APP"
`

const readme = `SAMA ${version} macOS
====================

【重要】不要用微信传这个 zip（会打隔离标记，系统常报「文件已损坏」）。
请用 AirDrop / U盘 / 网盘 / scp。

Apple 芯片（M1/M2/M3/M4）→ arm64 包
Intel Mac → x64 包

第一次打开（二选一）：

A. 推荐：双击「修复并打开.command」
   （若提示无法打开：系统设置 → 隐私与安全性 → 仍要打开）

B. 手动在「终端」执行（先 cd 到解压目录）：
   xattr -cr SAMA.app
   codesign --force --deep --sign - SAMA.app
   open SAMA.app

说明：本包在 Windows 交叉打出，无法带上完整 Apple 公证签名。
Mac 上 ad-hoc 签名一次即可本地运行。正式公证需在 Mac 上 npm run dist:mac:native。

设置和对话在本机用户目录，不会打进安装包。
`

function zipApp(appDir, zipPath, readmeText) {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile()
    zipfile.on('error', reject)
    const appName = path.basename(appDir)
    const walk = (dir, prefix) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name)
        const rel = `${prefix}/${name}`.replace(/\\/g, '/')
        const st = fs.lstatSync(full)
        if (st.isSymbolicLink()) {
          const target = fs.readlinkSync(full).replace(/\\/g, '/')
          zipfile.addBuffer(Buffer.from(target), rel, {
            mode: 0o120755,
            mtime: st.mtime,
          })
          continue
        }
        if (st.isDirectory()) {
          walk(full, rel)
          continue
        }
        const mode = isUnixExecutable(rel) ? 0o100755 : 0o100644
        zipfile.addFile(full, rel, { mode, mtime: st.mtime })
      }
    }
    walk(appDir, appName)
    zipfile.addBuffer(Buffer.from(readmeText, 'utf8'), '请读我-Mac启动说明.txt', {
      mode: 0o100644,
    })
    // .command 需可执行；Unix mode 在解压后仍可能要 chmod +x
    zipfile.addBuffer(Buffer.from(fixCommand.replace(/\r\n/g, '\n'), 'utf8'), '修复并打开.command', {
      mode: 0o100755,
    })
    fs.mkdirSync(path.dirname(zipPath), { recursive: true })
    zipfile.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('error', reject)
      .on('close', resolve)
    zipfile.end()
  })
}

const ignore = [
  /^\/src($|\/)/,
  /^\/evals($|\/)/,
  /^\/docs($|\/)/,
  /^\/release($|\/)/,
  /^\/scripts($|\/)/,
  /^\/public($|\/)/,
  /^\/resources($|\/)/,
  /^\/build($|\/)/,
  /^\/canvases($|\/)/,
  /^\/\.git($|\/)/,
  /^\/\.cursor($|\/)/,
  /^\/\.vscode($|\/)/,
  /^\/tsconfig/,
  /^\/vite\.config/,
  /^\/index\.html$/,
  /^\/start-dev\.bat$/,
]

async function main() {
  if (process.platform === 'darwin') {
    console.log('本机是 macOS，改走 electron-builder 打 dmg/zip')
    run('npx', ['electron-builder', '--mac', 'dmg', 'zip'])
    return
  }

  const distHtml = path.join(root, 'dist', 'index.html')
  if (!fs.existsSync(distHtml) && !process.argv.includes('--zip-only')) {
    throw new Error('缺少 dist/，请先 npm run build')
  }

  if (process.argv.includes('--zip-only')) {
    for (const arch of ['arm64', 'x64']) {
      const appDir = path.join(releaseDir, `SAMA-darwin-${arch}`, 'SAMA.app')
      if (!fs.existsSync(appDir)) {
        throw new Error(`未找到 ${appDir}，请先完整打包`)
      }
      const zipPath = path.join(releaseDir, `SAMA-${version}-mac-${arch}.zip`)
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
      console.log('Zipping', appDir, '->', zipPath)
      await zipApp(appDir, zipPath, readme)
      console.log('OK', zipPath, `${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`)
    }
    return
  }

  const icon = ensureIcns()
  ensureDarwinCanvas()
  fs.mkdirSync(releaseDir, { recursive: true })
  // tmpdir 必须在项目目录外：放在 release/ 里会触发「复制源码到自身子目录」EINVAL。
  // 也不要改 Helper (Plugin).app 的名字，Windows 会 EPERM。
  const packTmp = path.join(os.tmpdir(), 'sama-mac-pack')
  fs.rmSync(packTmp, { recursive: true, force: true })
  fs.mkdirSync(packTmp, { recursive: true })

  const extraResource = [
    path.join(root, 'build', 'icon.png'),
    path.join(root, 'electron', 'resources', 'lad'),
    path.join(root, 'electron', 'resources', 'grind-packs'),
    path.join(root, 'resources', 'mtkb'),
  ].filter((p) => fs.existsSync(p))

  const archs = ['arm64', 'x64']
  console.log('Packaging macOS', archs.join(','), 'via @electron/packager')

  const outputs = []
  for (const arch of archs) {
    // Windows 交叉打包时，把 Electron Helper (Plugin).app 改名为 SAMA Helper
    // (Plugin).app 会 EPERM。先打成 Electron.app（helper 不用改名），再改成 SAMA.app。
    const packed = await packager({
      dir: root,
      name: 'Electron',
      appBundleId: 'com.sama.app',
      appVersion: version,
      buildVersion: version,
      electronVersion: require('electron/package.json').version,
      platform: 'darwin',
      arch: [arch],
      out: releaseDir,
      overwrite: true,
      tmpdir: packTmp,
      asar: { unpack: '**/*.node' },
      prune: true,
      icon,
      extraResource,
      ignore,
      darwinDarkModeSupport: true,
      appCategoryType: 'public.app-category.utilities',
      download: {
        mirrorOptions: {
          mirror: electronMirror,
        },
      },
      afterPrune: [
        async ({ buildPath, arch: builtArch }) => {
          const pkgName =
            builtArch === 'x64' ? '@napi-rs/canvas-darwin-x64' : '@napi-rs/canvas-darwin-arm64'
          const src = path.join(root, 'node_modules', pkgName)
          const dest = path.join(buildPath, 'node_modules', pkgName)
          if (!fs.existsSync(src)) {
            console.warn('skip canvas inject, missing', src)
            return
          }
          fs.cpSync(src, dest, { recursive: true })
          console.log('Injected', pkgName, 'into', dest)
        },
      ],
    })
    outputs.push(...packed)
  }

  for (const outDir of outputs) {
    const electronApp = path.join(outDir, 'Electron.app')
    const appDir = path.join(outDir, 'SAMA.app')
    if (fs.existsSync(electronApp) && !fs.existsSync(appDir)) {
      finalizeSamaApp(electronApp, appDir)
    }
    if (!fs.existsSync(appDir)) {
      throw new Error(`未找到 ${appDir}`)
    }
    const arch = outDir.includes('arm64') ? 'arm64' : outDir.includes('x64') ? 'x64' : 'unknown'
    const zipPath = path.join(releaseDir, `SAMA-${version}-mac-${arch}.zip`)
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
    console.log('Zipping', appDir, '->', zipPath)
    await zipApp(appDir, zipPath, readme)
    console.log('OK', zipPath, `${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`)
    fs.rmSync(outDir, { recursive: true, force: true })
    console.log('Removed unpacked', outDir)
  }
  fs.rmSync(packTmp, { recursive: true, force: true })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

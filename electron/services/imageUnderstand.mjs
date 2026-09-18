/**
 * 对话识图：视觉模型看图 + Windows OCR 读尺寸（交叉核对）。
 * DeepSeek 等无视觉模型时只走 OCR，并标明能力边界。
 */
import fs from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import { loadSettings } from './store.mjs'
import { chatWithLlm } from './deepseek.mjs'
import { ocrLocalPng, ocrTempDir } from './desktop/ocrManager.mjs'
import {
  modelAcceptsImages,
  providerHasVision,
  resolveVisionPlan,
  resolveVisionSettings,
  visionModelFor,
} from './visionPlan.mjs'

export { modelAcceptsImages, providerHasVision, resolveVisionPlan, resolveVisionSettings, visionModelFor }

const DRAWING_EXTRACT_PROMPT = `你是机床/机械图纸识读专家。车间常见图：扫描件、手机拍照、绿笔手写、红章、圈号、局部放大图。只根据图片可见内容提取，禁止编造看不清的数字。

请用中文输出结构化结果，尽量包含：
1. 图片类型：零件图 / 草图 / 照片 / 屏幕截图 / 其它
2. 零件简述（轴/套/盘等）与总体外形
3. 视图：主视图、局部放大（如 X部/Y部）、剖视；不确定就写不确定
4. 标题栏：图号、名称、材料、件数、硬度（若有）
5. 尺寸表（印刷尺寸优先，绿笔手写只当备注）：
   - 直径Ø（含上下偏差，如 φ8 -0.007/-0.011）
   - 长度/宽度/槽宽/倒角/半径 R / 锥角
   - 形位公差（圆度、同轴、跳动等）与粗糙度
6. 两端/沟槽/锥面等关键结构（对照局部放大图）
7. 技术要求原文要点
8. 存疑项：看不清或可能 OCR 误读的数字单独列出
9. 若是磨削/轴类/砂轮图，文末必须再给一段 grind-json（数字必须来自图面）：
\`\`\`grind-json
{"process":"od_traverse","type":"shaft","machine":"STUDER S40","control":"Siemens 840D","dialect":"studer_siemens","steps":[{"d":30,"L":40,"stock":30.3,"grind":true},{"d":40,"L":18,"grind":false}],"totalL":40}
\`\`\`
process 只能是 od_traverse / od_plunge / face / dress / id。type 只能是 shaft / step_shaft / taper / bore / plunge / face / dress。
dialect 按机床填：studer_siemens（STUDER+840D/S40）、studer_iso（STUDER FANUC/favorit）、gaoqiao_fanuc（高桥）、mikrosa_sasl（米克罗莎 SASL）、fanuc_g75、fanuc_g78、siemens_4071、siemens_4075、num_flexium、yingbei_md、centerless_thru。看不清体系就不要编。
**steps 只放本次要磨的面**：红线、「磨削面」、Ra 那一档 grind:true；两端未磨台阶 grind:false 或不要写入切削 steps。
切入/横磨用 process=od_plunge、type=plunge，L=轴颈宽度不是整根总长。轴肩端面用 process=face。砂轮修整示意图用 process=dress（对象是砂轮不是零件）。
机床型号、控制必须从图面标题栏抄，不要猜。看不清的字段不要编。

数字必须来自图面。看不清写「存疑」，不要估算凑整。手写「8×77」这类是备注，以标题栏和尺寸标注为准。

      10. 若是机床电路图 / 主回路 / I/O 页，文末必须再给一段 elec-json（禁止手绘 SVG）。系统会据此导出 **连通性 md/txt**（元件谁与谁相连），不渲染 SVG/PDF 原理图。改图时 columns 必须含原位号和新位号。字段只能是 kind/project/page/rails/columns/io：
\`\`\`elec-json
{"kind":"elec-json","project":{"machine":"MIKROSA SASL 3/2 CNC","control":"FANUC 0iF"},"page":{"no":3,"of":20,"title":"主回路1","kind":"power"},"rails":[{"id":"L1","label":"L1"},{"id":"L2","label":"L2"},{"id":"L3","label":"L3"},{"id":"PE","label":"PE","type":"pe"}],"columns":[{"i":0,"devices":[{"tag":"1Q1","sym":"breaker3","rating":"2.5-4A"}]}],"io":[],"uncertain":[]}
\`\`\`
sym 只能是 breaker3/fuse/transformer/contactor/motor3/vfd/servo/psu/io/relay/other。位号、电位、I/O 地址必须从图面抄。看不清的放 uncertain。`

function isImageAttachment(a) {
  if (!a) return false
  if (a.kind === 'image') return true
  if (String(a.dataUrl || '').startsWith('data:image')) return true
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name || a.path || '')
}

function dataUrlFromFile(abs) {
  const buf = fs.readFileSync(abs)
  const ext = path.extname(abs).toLowerCase().replace('.', '') || 'png'
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

function prepareImageDataUrl(att) {
  let url = String(att.dataUrl || '')
  if (!url.startsWith('data:image') && att.path && fs.existsSync(att.path)) {
    try {
      url = dataUrlFromFile(att.path)
    } catch {
      url = ''
    }
  }
  if (!url.startsWith('data:image')) return ''
  try {
    const img = nativeImage.createFromDataURL(url)
    if (img.isEmpty()) return url
    const size = img.getSize()
    const maxEdge = 2048
    const long = Math.max(size.width || 0, size.height || 0)
    const ready =
      long > maxEdge
        ? img.resize({
            width: size.width >= size.height ? maxEdge : undefined,
            height: size.height > size.width ? maxEdge : undefined,
            quality: 'best',
          })
        : img
    return ready.toDataURL()
  } catch {
    return url
  }
}

function ocrFromDataUrl(dataUrl, index) {
  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    if (img.isEmpty()) return { available: false, text: '', lines: [] }
    const png = img.toPNG()
    const dir = ocrTempDir()
    const file = path.join(dir, `img-${Date.now()}-${index}.png`)
    fs.writeFileSync(file, png)
    try {
      return ocrLocalPng(file)
    } finally {
      try {
        fs.unlinkSync(file)
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    return {
      available: false,
      text: '',
      lines: [],
      error: { message: e?.message || String(e) },
    }
  }
}

function imagePartsFromUrls(urls) {
  return urls.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }))
}

/**
 * @returns {Promise<{
 *   imageCount: number
 *   usedVision: boolean
 *   visionModel: string | null
 *   chatModel: string
 *   remapped: boolean
 *   ocrUsed: boolean
 *   report: string
 *   imageParts: object[]
 *   note: string
 *   userNote: string
 * }>}
 */
export async function understandImageAttachments(attachments = [], { userText = '' } = {}) {
  const images = (attachments || []).filter(isImageAttachment).slice(0, 4)
  const settings = loadSettings()
  const vis = resolveVisionSettings(settings)
  const empty = {
    imageCount: 0,
    usedVision: false,
    visionModel: null,
    chatModel: vis.answerModel,
    remapped: false,
    ocrUsed: false,
    report: '',
    imageParts: [],
    note: '',
    userNote: '',
  }
  if (!images.length) return empty

  const vlModel = vis.visionModel
  const urls = []
  const ocrBlocks = []

  for (let i = 0; i < images.length; i++) {
    const a = images[i]
    const url = prepareImageDataUrl(a)
    if (url) urls.push(url)
    const ocr = url
      ? ocrFromDataUrl(url, i)
      : { available: false, text: '', lines: [] }
    const name = a.name || a.path || `图片${i + 1}`
    if (ocr.available && (ocr.text || ocr.lines?.length)) {
      const lines = (ocr.lines || [])
        .slice(0, 80)
        .map((l) => (l.x != null ? `- (${l.x},${l.y}) ${l.text}` : `- ${l.text}`))
        .join('\n')
      ocrBlocks.push(
        `### ${name}\n全文：\n${String(ocr.text || '').slice(0, 4000)}\n行（含近似坐标）：\n${lines || '（无）'}`,
      )
    } else {
      ocrBlocks.push(
        `### ${name}\nWindows OCR 不可用或无文字。${ocr.error?.message || ''}`,
      )
    }
  }

  const ocrSection = ocrBlocks.length
    ? `## Windows OCR（图面文字/尺寸，供核对）\n${ocrBlocks.join('\n\n')}`
    : ''
  const ocrUsed = ocrBlocks.some((b) => /全文：/.test(b) && !/不可用或无文字/.test(b))

  let vlText = ''
  let usedVision = false
  let note = vis.userNote || ''

  if (vlModel && urls.length) {
    try {
      const extractUser = [
        {
          type: 'text',
          text: `${DRAWING_EXTRACT_PROMPT}\n\n用户原话（供判断关注点，不要被带跑去编尺寸）：\n${String(userText || '').slice(0, 1500)}\n\n${ocrSection}`,
        },
        ...imagePartsFromUrls(urls),
      ]
      const extracted = await chatWithLlm({
        messages: [
          {
            role: 'system',
            content: '只做图纸/照片结构化提取。看不清就标存疑。不要写 G 代码。',
          },
          { role: 'user', content: extractUser },
        ],
        provider: vis.visionProvider,
        model: vlModel,
        temperature: 0.1,
        maxTokens: 3500,
        timeoutMs: 180000,
      })
      vlText = String(extracted.content || '').trim()
      usedVision = Boolean(vlText)
    } catch (e) {
      const fail = `视觉模型 ${vis.visionProvider} ${vlModel} 调用失败（${e?.message || e}），已退回 OCR。`
      note = note ? `${note}\n${fail}` : fail
    }
  } else if (!vlModel && !note) {
    note =
      '当前供应商没有识图能力。已尽量用 Windows OCR 提取图面文字。图纸请改用 Gemini 或通义 qwen-vl-max。'
  }

  const report = [
    '【识图结果 · 请以此为准，禁止编造图上没有的尺寸】',
    vis.split
      ? `## 模型分工\n识图：${vis.visionProvider} ${vlModel || '（无）'}\n回答：${vis.answerProvider} ${vis.answerModel}`
      : vis.remapped
        ? `## 模型分工\n对话模型：${vis.answerModel}（用户所选，文本）\n识图模型：${vlModel}（自动改用，因所选模型不能看图）`
        : usedVision
          ? `## 视觉模型（${vlModel}，即用户当前所选）`
          : '## 视觉模型\n（未使用）',
    vlText || '（无）',
    ocrSection,
    note ? `## 说明\n${note}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    imageCount: images.length,
    usedVision,
    visionModel: usedVision ? vlModel : null,
    chatModel: vis.answerModel,
    remapped: vis.remapped,
    ocrUsed,
    report,
    imageParts: imagePartsFromUrls(urls),
    note,
    userNote: note,
  }
}

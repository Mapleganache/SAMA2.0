/**
 * 对话模型 vs 识图模型。
 * 原则：用户选什么，问答/写码就用什么；附图时若该模型看不了图，
 * 只把「读图」改到同家视觉模型，并明确告知，不偷偷换掉对话模型。
 */

const VISION_FALLBACK = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o',
  qwen: 'qwen-vl-max',
  grok: 'grok-4-1-fast-non-reasoning',
  groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
}

export function modelAcceptsImages(provider, model) {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '')
  if (p === 'gemini' || p === 'grok') return true
  if (p === 'openai') return /gpt-4o|gpt-5|vision|omni/i.test(m) || !m
  if (p === 'qwen') return /vl|3\.8-max|qwen2\.5-vl|qwen3-vl/i.test(m)
  if (p === 'groq') return /llama-4|scout|vision|llava/i.test(m)
  return false
}

export function resolveVisionPlan(provider, selectedModel) {
  const p = String(provider || '').toLowerCase()
  const selected = String(selectedModel || '')
  const fallback = VISION_FALLBACK[p] || null
  const selectedCanSee = modelAcceptsImages(p, selected)
  const visionModel = selectedCanSee ? selected || fallback : fallback
  const remapped = Boolean(visionModel && selected && visionModel !== selected && !selectedCanSee)

  let userNote = ''
  if (!visionModel) {
    userNote = `【识图】当前服务商没有看图模型。已尽量用 Windows OCR。图纸请改用通义千问（qwen3.8-max / qwen-vl-max）或 Gemini。问答仍用你选的 ${selected || p}。`
  } else if (remapped) {
    userNote = `【识图】你选的是 ${selected}（文本，看不了图）。读图已改用 ${visionModel}；写程序/回答仍用 ${selected}。若要模型自己看图，请在设置里改成带「识图」的项。`
  }

  return {
    chatModel: selected,
    visionModel: visionModel || null,
    selectedCanSee,
    remapped,
    userNote,
  }
}

export function visionModelFor(provider, currentModel) {
  return resolveVisionPlan(provider, currentModel).visionModel
}

export function providerHasVision(provider, model) {
  return Boolean(visionModelFor(provider, model))
}

/**
 * 识图服务商可与回答服务商不同（例如千问看图 + DeepSeek 写工艺）。
 */
export function resolveVisionSettings(settings = {}) {
  const answerProvider = String(settings.provider || 'groq').toLowerCase()
  const answerModel = String(settings.model || '')
  const rawVision = String(settings.visionProvider || '')
    .trim()
    .toLowerCase()
  const split = Boolean(rawVision && rawVision !== answerProvider)
  const visionProvider = split ? rawVision : answerProvider
  const selectedVisionModel = split
    ? String(settings.visionModel || '').trim() || VISION_FALLBACK[visionProvider] || ''
    : answerModel
  const plan = resolveVisionPlan(visionProvider, selectedVisionModel)

  let userNote = plan.userNote
  if (split) {
    if (!plan.visionModel) {
      userNote = `【识图】识图服务商 ${visionProvider} 没有看图能力。请改成千问 / Gemini。回答仍用 ${answerProvider} ${answerModel}。`
    } else {
      userNote = `【识图】读图用 ${visionProvider} ${plan.visionModel}，回答用 ${answerProvider} ${answerModel}。`
      if (plan.remapped) {
        userNote += `识图项看不了图，已改用 ${plan.visionModel}。`
      }
    }
  }

  return {
    answerProvider,
    answerModel,
    visionProvider,
    split,
    remapped: plan.remapped,
    selectedCanSee: plan.selectedCanSee,
    visionModel: plan.visionModel,
    userNote,
  }
}

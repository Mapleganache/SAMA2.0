(() => {
  'use strict'

  const api = window.sama
  if (!api) return

  const STAGES = ['设备身份', '任务与子系统', '症状工况', '安全与实测', '现场约束', '诊断步骤', '修复记录', '验收报告']
  const SUBSYSTEMS = ['主轴', '进给/滚珠丝杠', '导轨', '刀库', '润滑', '液压气动', '冷却', '夹紧', '振动异响', '钻削刀具', '其他']
  const TASK_TYPES = ['故障诊断', '保养', '拆装调整', '精度恢复']
  const ACCEPTANCE = ['空载运行记录', '低速分段运行记录', '负载工况复核', '温升趋势复核', '振动/异响复核', '精度复核', '泄漏检查', '报警与联锁复位检查']
  const CIRCUIT_GROUPS = ['供电与上电', '驱动与运动', '主轴/砂轮', '液压润滑冷却', '安全与联锁', '测量信号与 PLC', '辅助功能', '工程审查']
  const state = {
    mode: '', stage: 0, workOrder: null, drafts: [], draftPanel: false, saveTimer: null,
    message: '', busy: false, evidenceQuery: '', evidenceResults: [], mechanicalLibrary: null,
    circuitOpen: false, circuitCatalog: null, circuitCase: null, circuitTab: 0,
    circuitFilters: { machineId: '', functionGroup: '', search: '' }, viewer: null, zoom: 1,
    conversation: { messages: [], proposals: [] }, askText: '', askAttachments: [], asking: false,
    electricalOpen: false, electricalProject: null, electricalRender: null, electricalSymbols: [], electricalSaved: [],
    electricalSheet: 0, electricalSelected: '', electricalZoom: 1, electricalUndo: [], electricalRedo: [], wireStart: null,
  }

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch])
  const id = () => `MWO-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const now = () => new Date().toISOString()

  function blankWorkOrder() {
    return {
      id: id(), title: '', status: 'draft', createdAt: now(), updatedAt: now(),
      machine: { machineType: '', brand: '未知', model: '未知', assetNo: '' },
      task: { taskType: '故障诊断', subsystem: '' },
      symptom: { description: '', alarms: '', conditions: '', thermalState: '', loadState: '', direction: '', speedRange: '', frequency: '', recentChanges: '' },
      safety: { powerIsolated: false, pressureReleased: false, fallProtected: false, verified: false, hazards: '' },
      measurements: [], attachments: [],
      constraints: { tools: '', downtime: '', parts: '', access: '' },
      diagnosis: null, repairRecords: '', acceptance: {}, technician: '',
    }
  }

  function getPath(object, dotted) {
    return dotted.split('.').reduce((value, key) => value?.[key], object)
  }

  function setPath(object, dotted, value) {
    const keys = dotted.split('.')
    let target = object
    keys.slice(0, -1).forEach((key) => { target[key] ||= {}; target = target[key] })
    target[keys.at(-1)] = value
  }

  function field(path, label, options = {}) {
    const value = getPath(state.workOrder, path) || ''
    const required = options.required ? '<b class="wb-required">必填</b>' : ''
    if (options.type === 'textarea') return `<label class="wb-field wb-field-wide"><span>${esc(label)} ${required}</span><textarea data-field="${esc(path)}" rows="${options.rows || 4}" placeholder="${esc(options.placeholder || '')}">${esc(value)}</textarea></label>`
    return `<label class="wb-field"><span>${esc(label)} ${required}</span><input data-field="${esc(path)}" type="${options.type || 'text'}" value="${esc(value)}" placeholder="${esc(options.placeholder || '')}"></label>`
  }

  function selectField(path, label, choices, required = false) {
    const value = getPath(state.workOrder, path) || ''
    return `<label class="wb-field"><span>${esc(label)} ${required ? '<b class="wb-required">必填</b>' : ''}</span><select data-field="${esc(path)}"><option value="">请选择</option>${choices.map((choice) => `<option value="${esc(choice)}" ${choice === value ? 'selected' : ''}>${esc(choice)}</option>`).join('')}</select></label>`
  }

  function checkField(path, label) {
    return `<label class="wb-check"><input data-field="${esc(path)}" type="checkbox" ${getPath(state.workOrder, path) ? 'checked' : ''}><span>${esc(label)}</span></label>`
  }

  function validateCore() {
    const errors = []
    if (!state.workOrder.machine.machineType.trim()) errors.push('机床类型')
    if (!state.workOrder.task.subsystem.trim()) errors.push('机械子系统')
    if (!state.workOrder.symptom.description.trim()) errors.push('故障症状')
    state.workOrder.measurements.forEach((m, index) => {
      const missing = ['value', 'unit', 'instrument', 'location', 'condition', 'recorder'].filter((key) => !String(m[key] || '').trim())
      if (missing.length) errors.push(`第${index + 1}条测量记录不完整`)
    })
    return errors
  }

  function updateTitle() {
    if (!state.workOrder.title) state.workOrder.title = `${state.workOrder.machine.machineType || '未命名机床'} · ${state.workOrder.task.subsystem || '机械维修工单'}`
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer)
    state.message = '正在自动保存…'
    state.saveTimer = setTimeout(async () => {
      updateTitle()
      const result = await api.maintenanceDraftSave(state.workOrder)
      if (result.ok) {
        state.workOrder = result.workOrder
        state.message = `已自动保存 · ${new Date(result.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        await loadDrafts(false)
      } else state.message = result.error || '保存失败'
      renderMechanical()
    }, 650)
  }

  function stageIdentity() {
    return `<section class="wb-card"><h2>设备身份</h2><p class="wb-muted">先锁定是哪台设备。未知内容可以明确填写“未知”，不要靠猜测补齐。</p><div class="wb-form-grid">${field('machine.machineType', '机床类型', { required: true, placeholder: '如：数控外圆磨床、立式加工中心' })}${field('machine.brand', '品牌/制造商', { placeholder: '未知' })}${field('machine.model', '型号', { placeholder: '未知' })}${field('machine.assetNo', '序列号/资产编号', { placeholder: '可稍后补充' })}${field('technician', '维修人员', { placeholder: '姓名或班组' })}${field('title', '工单标题', { placeholder: '自动按设备和子系统生成' })}</div></section>`
  }

  function stageTask() {
    return `<section class="wb-card"><h2>任务与机械子系统</h2><p class="wb-muted">分类用于选择离线检查基线和缩小手册检索范围。</p><div class="wb-form-grid">${selectField('task.taskType', '任务类型', TASK_TYPES, true)}${selectField('task.subsystem', '机械子系统', SUBSYSTEMS, true)}</div><div class="wb-callout">本工作台只处理机械维修流程；电路、PMC 和梯形图请进入“电气设计 → 电路案例库”或 PLC 页面。</div></section>`
  }

  function stageSymptom() {
    return `<section class="wb-card"><h2>症状与发生工况</h2><div class="wb-form-grid">${field('symptom.description', '现场症状', { type: 'textarea', required: true, rows: 5, placeholder: '描述声音、温度、阻力、精度变化、动作失败等可观察事实' })}${field('symptom.alarms', '报警/提示', { placeholder: '无报警请写“无”' })}${field('symptom.conditions', '发生条件', { placeholder: '动作、程序段、加工阶段、轴位置等' })}${field('symptom.thermalState', '冷热状态', { placeholder: '冷机/热机/运行多久后' })}${field('symptom.loadState', '负载状态', { placeholder: '空载/轻载/加工负载' })}${field('symptom.direction', '方向/位置', { placeholder: '正向、反向、某行程区间' })}${field('symptom.speedRange', '转速/速度范围', { placeholder: '只记录实际已知范围' })}${field('symptom.frequency', '频率', { placeholder: '持续/偶发/每循环一次' })}${field('symptom.recentChanges', '近期变化', { type: 'textarea', rows: 3, placeholder: '拆装、碰撞、换件、换油、改工艺、长期停机等' })}</div></section>`
  }

  function measurementRows() {
    if (!state.workOrder.measurements.length) return '<div class="wb-empty">尚无实测记录。诊断可以先生成通用检查表，但不会给出确定性修复动作。</div>'
    return `<div class="wb-table-wrap"><table class="wb-table"><thead><tr><th>数值</th><th>单位</th><th>仪器</th><th>测点</th><th>工况</th><th>记录人</th><th></th></tr></thead><tbody>${state.workOrder.measurements.map((m, i) => `<tr>${['value', 'unit', 'instrument', 'location', 'condition', 'recorder'].map((key) => `<td><input data-measure="${i}.${key}" value="${esc(m[key] || '')}"></td>`).join('')}<td><button class="wb-icon-btn" data-action="remove-measure" data-index="${i}" title="删除">×</button></td></tr>`).join('')}</tbody></table></div>`
  }

  function stageSafety() {
    const attachments = state.workOrder.attachments || []
    return `<section class="wb-card"><h2>安全隔离</h2><p class="wb-danger-text">涉及拆罩、伸入运动区域、液压储能或重力部件时，必须先完成并验证能量隔离。</p><div class="wb-check-grid">${checkField('safety.powerIsolated', '主电源已断开并锁定挂牌')}${checkField('safety.pressureReleased', '液压/气压及储能已释放')}${checkField('safety.fallProtected', '垂直轴/重物已采取防坠落措施')}${checkField('safety.verified', '已用合适方法验证隔离有效')}</div>${field('safety.hazards', '当前危险与限制', { type: 'textarea', rows: 3, placeholder: '记录不能隔离的能源、悬挂负载、热表面等' })}</section><section class="wb-card"><div class="wb-card-head"><div><h2>实测记录</h2><p class="wb-muted">每条记录必须有数值、单位、仪器、测点、工况和记录人。</p></div><button class="ghost-btn" data-action="add-measure">+ 添加实测</button></div>${measurementRows()}</section><section class="wb-card"><div class="wb-card-head"><div><h2>现场证据附件</h2><p class="wb-muted">引用照片、PDF、DXF 等原文件，不修改也不复制知识库大文件。</p></div><button class="ghost-btn" data-action="add-attachment">选择附件</button></div>${attachments.length ? `<ul class="wb-attachment-list">${attachments.map((file, i) => `<li><span>${esc(file.name || file.path)}</span><small>${esc(file.path || '')}</small><button data-action="remove-attachment" data-index="${i}">移除</button></li>`).join('')}</ul>` : '<div class="wb-empty">尚未添加附件</div>'}</section>`
  }

  function stageConstraints() {
    return `<section class="wb-card"><h2>现场约束</h2><p class="wb-muted">这些条件会改变检查顺序，但不会改变安全边界。</p><div class="wb-form-grid">${field('constraints.tools', '可用工具/仪器', { type: 'textarea', rows: 3, placeholder: '量具、测温、振动、吊装、专用工具等' })}${field('constraints.downtime', '允许停机时间', { placeholder: '如：本班内、可停两天' })}${field('constraints.parts', '备件与耗材', { type: 'textarea', rows: 3, placeholder: '已有/缺少的轴承、密封、润滑品等' })}${field('constraints.access', '拆装与空间限制', { type: 'textarea', rows: 3, placeholder: '吊装、护罩、干涉、权限等' })}</div></section>`
  }

  function resultBadge(result) {
    const map = { passed: '通过', failed: '异常', pending: '待执行' }
    return `<span class="wb-badge ${esc(result || 'pending')}">${map[result] || '待执行'}</span>`
  }

  function diagnosisContent() {
    const diagnosis = state.workOrder.diagnosis
    if (!diagnosis) return '<div class="wb-empty wb-empty-large"><strong>尚未生成诊断步骤</strong><span>先完成必填信息。无 API 时会生成可离线执行的通用检查清单。</span></div>'
    return `<div class="wb-diagnosis-banner ${diagnosis.mode === 'offline' ? 'offline' : ''}"><strong>${esc(diagnosis.label || '')}</strong><span>${esc(diagnosis.fallbackReason || `生成于 ${new Date(diagnosis.generatedAt).toLocaleString('zh-CN')}`)}</span></div>
      <div class="wb-two-col"><section class="wb-card"><h2>已知事实</h2><ul>${(diagnosis.knownFacts || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>暂无</li>'}</ul></section><section class="wb-card"><h2>缺失信息 / 停机条件</h2><ul>${(diagnosis.missingFacts || []).map((x) => `<li>${esc(x)}</li>`).join('')}${(diagnosis.stopConditions || []).map((x) => `<li class="wb-danger-text">${esc(x)}</li>`).join('') || '<li>暂无额外停机条件</li>'}</ul></section></div>
      <section class="wb-card"><h2>可能原因排序</h2><div class="wb-cause-list">${(diagnosis.causes || []).map((cause, i) => `<article><b>${i + 1}</b><div><strong>${esc(cause.title)}</strong><p>${esc(cause.evidence)}</p></div><span>${esc(cause.confidence)}</span></article>`).join('')}</div></section>
      <section class="wb-card"><h2>分步诊断表</h2><div class="wb-step-list">${(diagnosis.diagnosticSteps || []).map((step) => `<article class="wb-step ${step.result || 'pending'}"><header><code>${esc(step.id)}</code>${resultBadge(step.result)}<strong>${esc(step.measurementPoint)}</strong></header><div class="wb-step-grid"><p><b>安全状态</b>${esc(step.safetyState)}</p><p><b>仪器</b>${esc(step.instrument)}</p><p><b>操作</b>${esc(step.action)}</p><p><b>期望</b>${esc(step.expectedResult)}</p><p><b>下一分支</b>${esc(step.nextBranch)}</p></div><label><span>师傅实测/现场现象</span><textarea data-observation="${esc(step.id)}" rows="2">${esc(step.observedResult || '')}</textarea></label><div class="wb-step-actions"><button class="ghost-btn" data-action="step-result" data-step="${esc(step.id)}" data-result="passed">记录为通过</button><button class="ghost-btn wb-danger-btn" data-action="step-result" data-step="${esc(step.id)}" data-result="failed">记录为异常</button></div></article>`).join('')}</div></section>
      <section class="wb-card"><h2>资料证据</h2>${(diagnosis.evidence || []).length ? `<div class="wb-source-list">${diagnosis.evidence.map(sourceCardHtml).join('')}</div>` : '<div class="wb-empty">本次没有检索到可引用资料；当前内容仅为通用检查方向。</div>'}</section>`
  }

  function sourceCardHtml(source) {
    return `<article class="wb-source"><strong>${esc(source.document || source.title)}</strong><span>${esc([source.volume, source.hierarchy].filter(Boolean).join(' · '))}</span><small>${esc(source.verificationStatus || '待核对')}</small>${source.sourcePath ? `<button class="text-btn" data-action="open-path" data-path="${esc(source.sourcePath)}">打开原文</button>` : ''}</article>`
  }

  function mechanicalLibraryHtml() {
    const library = state.mechanicalLibrary
    if (!library?.ok) return '<div class="wb-kb-status error"><strong>机械资料库未加载</strong><span>请检查应用资源中的 mechanical.sqlite。</span></div>'
    return `<div class="wb-kb-status"><div><strong>机械资料库已加载</strong><span>${library.documents.toLocaleString('zh-CN')} 份来源文档 · ${library.sections.toLocaleString('zh-CN')} 个标题层级段落 · ${library.assets.toLocaleString('zh-CN')} 条原图关联</span></div><small>只读 · ${esc(library.version)}</small></div>`
  }

  function conversationHtml() {
    const conversation = state.conversation || { messages: [], proposals: [] }
    const pending = (conversation.proposals || []).filter((proposal) => proposal.status === 'pending')
    return `<section class="wb-card wb-conversation"><div class="wb-card-head"><div><h2>工单内进一步诊断</h2><p class="wb-muted">可以直接追问当前步骤，并附现场照片、PDF或测量证据。回答不会直接改工单。</p></div><span class="wb-badge">${conversation.messages.length} 条消息</span></div>
      <div class="wb-chat-log">${conversation.messages.length ? conversation.messages.map((message) => `<article class="${esc(message.role)}"><header><strong>${message.role === 'user' ? '师傅' : 'SAMA 诊断助手'}</strong><small>${new Date(message.createdAt).toLocaleString('zh-CN')}</small></header><p>${esc(message.content)}</p>${(message.sources || []).length ? `<div class="wb-chat-sources">${message.sources.map((source) => `<button class="text-btn" data-action="open-path" data-path="${esc(source.sourcePath || '')}">${esc(source.document || source.title || source.id)}</button>`).join('')}</div>` : ''}</article>`).join('') : '<div class="wb-empty">例如：为什么要先检查这个测点？这个异常还需要补什么证据？</div>'}</div>
      ${pending.length ? `<div class="wb-proposals"><h3>待师傅确认的写回建议</h3>${pending.map((proposal) => `<article><label>${(proposal.changes || []).map((change) => `<span><input type="checkbox" data-proposal-change="${esc(proposal.id)}" value="${esc(change.id)}" checked><b>${esc(change.summary)}</b><small>${esc(change.type)}</small></span>`).join('')}</label><button class="primary-btn" data-action="apply-proposal" data-id="${esc(proposal.id)}">采用并重新诊断</button></article>`).join('')}</div>` : ''}
      <div class="wb-ask-attachments">${state.askAttachments.map((file, index) => `<span>${esc(file.name)}<button data-action="remove-ask-attachment" data-index="${index}">×</button></span>`).join('')}</div>
      <div class="wb-ask-box"><textarea id="wb-ask-text" rows="3" placeholder="围绕当前工单和诊断步骤继续提问…">${esc(state.askText)}</textarea><div><button class="ghost-btn" data-action="add-ask-attachment">附照片/PDF</button><button class="primary-btn" data-action="ask-maintenance" ${state.asking ? 'disabled' : ''}>${state.asking ? '正在分析…' : '发送追问'}</button></div></div></section>`
  }

  function stageDiagnosis() {
    return `${mechanicalLibraryHtml()}<div class="wb-action-bar"><button class="primary-btn" data-action="diagnose" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在生成…' : state.workOrder.diagnosis ? '依据最新记录重新诊断' : '生成分步诊断'}</button><span>模型结果必须通过结构与安全校验；失败自动回退离线清单。</span></div>${diagnosisContent()}${conversationHtml()}<section class="wb-card"><h2>机械手册离线检索</h2><div class="wb-search"><input id="wb-evidence-query" value="${esc(state.evidenceQuery)}" placeholder="如：滚珠丝杠异响、主轴温升、钻孔偏斜"><button class="ghost-btn" data-action="search-evidence">检索</button></div>${state.evidenceResults.length ? `<div class="wb-evidence-results">${state.evidenceResults.map((r) => `<article><h3>${esc(r.title)}</h3><p>${esc(r.content)}</p>${sourceCardHtml(r.source)}${(r.assets || []).slice(0, 3).map((a) => `<button class="text-btn" data-action="open-path" data-path="${esc(a.sourcePath)}">查看图片：${esc(a.label)}</button>`).join('')}</article>`).join('')}</div>` : ''}</section>`
  }

  function stageRepair() {
    const actions = state.workOrder.diagnosis?.repairActions || []
    return `<section class="wb-card"><h2>已确认的修复动作</h2>${actions.length ? `<ol>${actions.map((x) => `<li>${esc(typeof x === 'string' ? x : x.action || JSON.stringify(x))}</li>`).join('')}</ol>` : '<div class="wb-callout">当前没有足够的通过项与实测证据，因此系统不生成确定性拆装、调整或换件动作。</div>'}</section><section class="wb-card"><h2>师傅修复记录</h2><p class="wb-muted">记录实际做了什么、使用了哪些零件/耗材、调整前后现象。不要把计划写成已完成。</p>${field('repairRecords', '现场修复记录', { type: 'textarea', rows: 10, placeholder: '日期/人员/动作/零件或耗材/结果/遗留问题' })}</section>`
  }

  function stageAcceptance() {
    return `<section class="wb-card"><h2>验收项目</h2><p class="wb-muted">按设备适用性逐项完成。勾选代表师傅已实际验证，不代表系统自动通过。</p><div class="wb-acceptance">${ACCEPTANCE.map((name) => `<label><input type="checkbox" data-acceptance="${esc(name)}" ${state.workOrder.acceptance?.[name] ? 'checked' : ''}><span>${esc(name)}</span></label>`).join('')}</div></section><section class="wb-card"><h2>完成与导出</h2><div class="wb-summary-grid"><div><span>已完成验收</span><strong>${Object.values(state.workOrder.acceptance || {}).filter(Boolean).length} / ${ACCEPTANCE.length}</strong></div><div><span>诊断步骤</span><strong>${(state.workOrder.diagnosis?.diagnosticSteps || []).filter((x) => x.completed).length} / ${(state.workOrder.diagnosis?.diagnosticSteps || []).length}</strong></div><div><span>安全隔离</span><strong>${['powerIsolated', 'pressureReleased', 'fallProtected', 'verified'].every((key) => state.workOrder.safety[key]) ? '已确认' : '未全部确认'}</strong></div></div><div class="wb-action-bar"><button class="primary-btn" data-action="complete-order">标记为完成</button><button class="ghost-btn" data-action="export-order">导出 Markdown + JSON</button></div></section>`
  }

  function stageHtml() {
    return [stageIdentity, stageTask, stageSymptom, stageSafety, stageConstraints, stageDiagnosis, stageRepair, stageAcceptance][state.stage]()
  }

  function draftsHtml() {
    if (!state.draftPanel) return ''
    return `<div class="wb-draft-panel"><header><strong>本机工单草稿</strong><button data-action="close-drafts">×</button></header>${state.drafts.length ? state.drafts.map((draft) => `<article class="${draft.id === state.workOrder.id ? 'active' : ''}"><button data-action="load-draft" data-id="${esc(draft.id)}"><strong>${esc(draft.title)}</strong><span>${esc(draft.machineType)} · ${esc(draft.subsystem)}</span><small>${new Date(draft.updatedAt).toLocaleString('zh-CN')}</small></button><button class="wb-delete" data-action="delete-draft" data-id="${esc(draft.id)}">删除</button></article>`).join('') : '<div class="wb-empty">暂无草稿</div>'}</div>`
  }

  function renderMechanical() {
    const root = ensureRoot()
    if (state.mode !== 'mech') return
    root.className = 'sama-workbench-root mechanical'
    root.innerHTML = `<div class="wb-shell"><header class="wb-header"><div><div class="wb-eyebrow">SAMA 1.3.0 · 机械维修工作台</div><h1>${esc(state.workOrder.title || '新建机械维修工单')}</h1><p>${esc(state.message || '本地自动保存 · 表单、检索与基础清单可离线使用')}</p></div><div class="wb-header-actions"><button class="ghost-btn" data-action="toggle-drafts">草稿 ${state.drafts.length}</button><button class="ghost-btn" data-action="new-order">新建工单</button></div></header><nav class="wb-stepper">${STAGES.map((name, i) => `<button class="${i === state.stage ? 'active' : ''} ${i < state.stage ? 'done' : ''}" data-action="goto-stage" data-stage="${i}"><b>${i + 1}</b><span>${esc(name)}</span></button>`).join('')}</nav><main class="wb-content">${stageHtml()}</main><footer class="wb-footer"><button class="ghost-btn" data-action="prev-stage" ${state.stage === 0 ? 'disabled' : ''}>上一步</button><span>${state.stage + 1} / ${STAGES.length}</span><button class="primary-btn" data-action="next-stage" ${state.stage === STAGES.length - 1 ? 'disabled' : ''}>保存并进入下一步</button></footer>${draftsHtml()}</div>`
    const eyebrow = root.querySelector('.wb-eyebrow'); if (eyebrow) eyebrow.textContent = 'SAMA 1.3.0 · 机械维修工作台'
    const importButton = document.createElement('button'); importButton.className = 'ghost-btn'; importButton.dataset.action = 'import-order'; importButton.textContent = '导入旧工单'; root.querySelector('.wb-header-actions')?.prepend(importButton)
    bindRoot(root)
  }

  function ensureRoot() {
    const pane = document.querySelector('.center-pane')
    if (!pane) return null
    let root = pane.querySelector(':scope > #sama-workbench-root')
    if (!root) { root = document.createElement('div'); root.id = 'sama-workbench-root'; pane.appendChild(root) }
    return root
  }

  function bindRoot(root) {
    root.oninput = (event) => {
      const el = event.target
      if (el.dataset.field) {
        setPath(state.workOrder, el.dataset.field, el.type === 'checkbox' ? el.checked : el.value)
        scheduleSave()
      } else if (el.dataset.measure) {
        const [index, key] = el.dataset.measure.split('.')
        state.workOrder.measurements[Number(index)][key] = el.value
        scheduleSave()
      } else if (el.dataset.observation) {
        const step = state.workOrder.diagnosis?.diagnosticSteps?.find((x) => x.id === el.dataset.observation)
        if (step) { step.observedResult = el.value; scheduleSave() }
      } else if (el.id === 'wb-evidence-query') state.evidenceQuery = el.value
      else if (el.id === 'wb-ask-text') state.askText = el.value
    }
    root.onchange = (event) => {
      const el = event.target
      if (el.dataset.acceptance) { state.workOrder.acceptance[el.dataset.acceptance] = el.checked; scheduleSave(); renderMechanical() }
    }
    root.onclick = async (event) => {
      const button = event.target.closest('[data-action]')
      if (!button) return
      await handleAction(button.dataset.action, button.dataset)
    }
  }

  async function handleAction(action, data) {
    if (action === 'goto-stage') { state.stage = Number(data.stage); if (state.stage === 5) await loadConversation(false); renderMechanical() }
    if (action === 'prev-stage') { state.stage = Math.max(0, state.stage - 1); renderMechanical() }
    if (action === 'next-stage') { updateTitle(); await api.maintenanceDraftSave(state.workOrder); state.stage = Math.min(7, state.stage + 1); if (state.stage === 5) await loadConversation(false); renderMechanical() }
    if (action === 'new-order') { state.workOrder = blankWorkOrder(); state.conversation = { messages: [], proposals: [] }; state.stage = 0; state.message = '已创建新工单'; renderMechanical() }
    if (action === 'import-order') { const r = await api.maintenanceDraftImport(); if (r.ok) { state.workOrder = r.workOrder; state.conversation = { messages: [], proposals: [] }; await loadDrafts(false); state.stage = 0; state.message = '旧版 JSON 工单已作为新草稿导入' } else if (!r.canceled) state.message = r.error || '导入失败'; renderMechanical() }
    if (action === 'toggle-drafts') { state.draftPanel = !state.draftPanel; renderMechanical() }
    if (action === 'close-drafts') { state.draftPanel = false; renderMechanical() }
    if (action === 'load-draft') { const r = await api.maintenanceDraftGet(data.id); if (r.ok) { state.workOrder = r.workOrder; await loadConversation(false); state.draftPanel = false; state.stage = 0; state.message = '已载入草稿'; renderMechanical() } }
    if (action === 'delete-draft') { if (confirm('删除这份本机草稿？此操作不可在应用内撤销。')) { await api.maintenanceDraftDelete(data.id); await loadDrafts(); } }
    if (action === 'add-measure') { state.workOrder.measurements.push({ value: '', unit: '', instrument: '', location: '', condition: '', recorder: state.workOrder.technician || '' }); scheduleSave(); renderMechanical() }
    if (action === 'remove-measure') { state.workOrder.measurements.splice(Number(data.index), 1); scheduleSave(); renderMechanical() }
    if (action === 'add-attachment') {
      const r = await api.openLocalFiles()
      if (r.ok && !r.canceled) { state.workOrder.attachments.push(...r.files.map((f) => ({ name: f.name, path: f.path, kind: f.kind, size: f.size || 0 }))); scheduleSave(); renderMechanical() }
    }
    if (action === 'remove-attachment') { state.workOrder.attachments.splice(Number(data.index), 1); scheduleSave(); renderMechanical() }
    if (action === 'diagnose') {
      const errors = validateCore()
      if (errors.length) { state.message = `请先补全：${errors.join('、')}`; renderMechanical(); return }
      state.busy = true; state.message = '正在校验工单并生成诊断步骤…'; renderMechanical()
      const r = await api.maintenanceDiagnose(state.workOrder)
      state.busy = false
      if (r.ok) { state.workOrder.diagnosis = r.diagnosis; state.message = r.diagnosis.mode === 'offline' ? '已生成通用离线检查清单' : '已生成并通过安全校验'; await api.maintenanceDraftSave(state.workOrder) }
      else state.message = r.error || '诊断失败'
      renderMechanical()
    }
    if (action === 'step-result') {
      const step = state.workOrder.diagnosis?.diagnosticSteps?.find((x) => x.id === data.step)
      if (step) { step.result = data.result; step.completed = true; await api.maintenanceUpdateObservation(state.workOrder.id, step.id, { observedResult: step.observedResult, result: step.result, completed: true }); state.message = '已记录现场结果；可重新诊断更新原因排序'; renderMechanical() }
    }
    if (action === 'search-evidence') { const r = await api.mechanicalSearch(state.evidenceQuery, { subsystem: state.workOrder.task.subsystem, limit: 12 }); state.evidenceResults = r.results || []; state.message = `检索到 ${state.evidenceResults.length} 条结构化资料`; renderMechanical() }
    if (action === 'add-ask-attachment') {
      const r = await api.openLocalFiles()
      if (r.ok && !r.canceled) state.askAttachments.push(...r.files.map((f) => ({ name: f.name, path: f.path, kind: f.kind, size: f.size || 0 })))
      renderMechanical()
    }
    if (action === 'remove-ask-attachment') { state.askAttachments.splice(Number(data.index), 1); renderMechanical() }
    if (action === 'ask-maintenance') {
      if (!state.askText.trim()) { state.message = '请输入要追问的问题'; renderMechanical(); return }
      updateTitle(); await api.maintenanceDraftSave(state.workOrder)
      state.asking = true; state.message = '正在结合当前工单、资料证据和附件进一步诊断…'; renderMechanical()
      const r = await api.maintenanceAsk(state.workOrder.id, state.askText, state.askAttachments)
      state.asking = false
      if (r.ok) { state.askText = ''; state.askAttachments = []; await loadConversation(false); state.message = r.mode === 'offline' ? '已生成通用离线追问' : '追问结果已通过结构与安全校验' }
      else state.message = r.error || '追问失败'
      renderMechanical()
    }
    if (action === 'apply-proposal') {
      const checked = [...document.querySelectorAll(`[data-proposal-change="${CSS.escape(data.id)}"]:checked`)].map((el) => el.value)
      const r = await api.maintenanceApplyProposal(state.workOrder.id, data.id, checked)
      if (r.ok) { state.workOrder = r.workOrder; await loadConversation(false); state.message = '建议已由师傅确认写回，正在依据新信息重新诊断…'; renderMechanical(); const diagnosed = await api.maintenanceDiagnose(state.workOrder); if (diagnosed.ok) { state.workOrder.diagnosis = diagnosed.diagnosis; await api.maintenanceDraftSave(state.workOrder); state.message = '已采用建议并重新排序诊断'; } }
      else state.message = r.error || '写回失败'
      renderMechanical()
    }
    if (action === 'open-path') await api.workbenchOpenPath(data.path)
    if (action === 'complete-order') { state.workOrder.status = 'completed'; await api.maintenanceDraftSave(state.workOrder); state.message = '工单已标记为完成'; renderMechanical() }
    if (action === 'export-order') { const r = await api.maintenanceExport(state.workOrder.id, ['md', 'json'], state.workOrder); state.message = r.ok ? `已导出 ${r.files.length} 个文件` : (r.canceled ? '已取消导出' : r.error); renderMechanical() }
  }

  async function loadDrafts(render = true) {
    const result = await api.maintenanceDraftList()
    state.drafts = result.drafts || []
    if (render && state.mode === 'mech') renderMechanical()
  }

  async function loadConversation(render = true) {
    if (!state.workOrder?.id || !api.maintenanceConversationGet) return
    const result = await api.maintenanceConversationGet(state.workOrder.id)
    if (result.ok) state.conversation = { messages: result.messages || [], proposals: result.proposals || [] }
    if (render && state.mode === 'mech') renderMechanical()
  }

  function activeElectricalSheet() {
    return state.electricalProject?.sheets?.[state.electricalSheet] || null
  }

  function selectedElectricalDevice() {
    return activeElectricalSheet()?.devices?.find((device) => device.id === state.electricalSelected) || null
  }

  function rememberElectrical() {
    if (!state.electricalProject) return
    state.electricalUndo.push(JSON.stringify(state.electricalProject))
    if (state.electricalUndo.length > 50) state.electricalUndo.shift()
    state.electricalRedo = []
  }

  async function refreshElectrical({ render = true } = {}) {
    if (!state.electricalProject) return
    const result = await api.electricalV2Render(state.electricalProject)
    if (result.ok) { state.electricalProject = result.project; state.electricalRender = result }
    else state.message = result.error || '专业电路图渲染失败'
    if (render) renderElectrical()
  }

  function electricalPropertyHtml(device) {
    if (!device) return '<div class="wb-empty">在图纸中选择元件后，可修改位号、说明、属性和位置。</div>'
    return `<div class="wb-elec-properties"><h3>${esc(device.tag)} · ${esc(state.electricalSymbols.find((x) => x.id === device.type)?.label || device.type)}</h3>
      <label><span>位号</span><input data-elec-device="tag" value="${esc(device.tag)}"></label>
      <label><span>功能说明</span><textarea data-elec-device="description" rows="3">${esc(device.description)}</textarea></label>
      <label><span>厂家</span><input data-elec-device="manufacturer" value="${esc(device.manufacturer)}"></label>
      <label><span>型号/规格</span><input data-elec-device="partNo" value="${esc(device.partNo)}" placeholder="没有证据时留空"></label>
      <label><span>额定信息</span><input data-elec-device="rating" value="${esc(device.rating)}" placeholder="没有证据时留空"></label>
      <label><span>验证状态</span><select data-elec-device="verificationStatus"><option ${device.verificationStatus === '待现场核对' ? 'selected' : ''}>待现场核对</option><option ${device.verificationStatus === '资料已核对' ? 'selected' : ''}>资料已核对</option><option ${device.verificationStatus === '已核对' ? 'selected' : ''}>已核对</option></select></label>
      <div class="wb-elec-move"><button data-action="elec-move" data-dx="0" data-dy="-5">↑</button><button data-action="elec-move" data-dx="-5" data-dy="0">←</button><button data-action="elec-move" data-dx="5" data-dy="0">→</button><button data-action="elec-move" data-dx="0" data-dy="5">↓</button></div>
      <label><span>连线起点引脚</span><select id="elec-wire-pin">${device.pins.map((pin) => `<option value="${esc(pin.id)}">${esc(pin.name || pin.id)} · ${esc(pin.role)}</option>`).join('')}</select></label>
      <div class="wb-elec-property-actions"><button class="ghost-btn" data-action="elec-wire-start">从此引脚连线</button><button class="ghost-btn" data-action="elec-copy">复制</button><button class="ghost-btn wb-danger-btn" data-action="elec-delete">删除</button></div></div>`
  }

  function electricalEditorHtml() {
    const project = state.electricalProject
    const sheet = activeElectricalSheet()
    const rendered = state.electricalRender
    const svg = rendered?.svgs?.find((item) => item.sheetId === sheet?.id)?.svg || ''
    const drc = rendered?.drc || { errors: 0, warnings: 0, issues: [] }
    return `<div class="wb-electrical-shell"><header class="wb-header"><div><div class="wb-eyebrow">SAMA · ElectricalProject v2</div><h1>${esc(project?.name || '专业电路编辑器')}</h1><p>${esc(state.message || 'IEC 符号 · 正交布线 · 可编辑源工程 · EPLAN Electric P8 出口（优先 2.7）')}</p></div><div class="wb-header-actions"><button class="ghost-btn" data-action="elec-close">返回电气设计</button></div></header>
      <div class="wb-elec-toolbar"><button data-action="elec-new">新建</button><button data-action="elec-sample">载入示例</button><button data-action="elec-save">保存工程</button><button data-action="elec-undo" ${state.electricalUndo.length ? '' : 'disabled'}>撤销</button><button data-action="elec-redo" ${state.electricalRedo.length ? '' : 'disabled'}>重做</button><button data-action="elec-add-sheet">新增页</button><select id="elec-sheet-select">${(project?.sheets || []).map((s, i) => `<option value="${i}" ${i === state.electricalSheet ? 'selected' : ''}>${s.pageNo}. ${esc(s.title)}</option>`).join('')}</select><button data-action="elec-drc">DRC：${drc.errors} 错 / ${drc.warnings} 警告</button><button data-action="elec-export">导出全套</button><button class="primary-btn" data-action="elec-eplan">导出到 EPLAN</button></div>
      <main class="wb-elec-main"><aside class="wb-elec-palette"><h3>IEC 元件</h3>${state.electricalSymbols.map((symbol) => `<button data-action="elec-add-device" data-type="${esc(symbol.id)}"><b>${esc(symbol.label)}</b><small>${esc(symbol.id)}</small></button>`).join('')}<h3>已保存工程</h3>${state.electricalSaved.length ? state.electricalSaved.map((p) => `<button data-action="elec-load" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.machine || '机床待填写')}</small></button>`).join('') : '<p class="wb-muted">尚无本机工程</p>'}</aside>
      <section class="wb-elec-work"><div class="wb-elec-project-fields"><input data-elec-project="name" value="${esc(project?.name)}" placeholder="工程名称"><input data-elec-project="machine" value="${esc(project?.machine)}" placeholder="机床/项目"><select data-elec-project="verificationStatus"><option ${project?.verificationStatus === '待现场核对' ? 'selected' : ''}>待现场核对</option><option ${project?.verificationStatus === '资料已核对' ? 'selected' : ''}>资料已核对</option><option ${project?.verificationStatus === '已核对' ? 'selected' : ''}>已核对</option></select><span>${state.wireStart ? '连线模式：请选择目标元件' : '网格 5 mm · 正交自动布线'}</span></div><div class="wb-elec-canvas"><div style="transform:scale(${state.electricalZoom})">${svg}</div></div><div class="wb-elec-zoom"><button data-action="elec-zoom" data-delta="-0.1">−</button><span>${Math.round(state.electricalZoom * 100)}%</span><button data-action="elec-zoom" data-delta="0.1">＋</button></div></section>
      <aside class="wb-elec-inspector">${electricalPropertyHtml(selectedElectricalDevice())}<section class="wb-elec-drc"><h3>设计规则检查</h3>${drc.issues?.length ? drc.issues.slice(0, 30).map((issue) => `<p class="${esc(issue.severity)}"><b>${esc(issue.code)}</b>${esc(issue.message)}</p>`).join('') : '<p class="ok">当前没有 DRC 问题</p>'}</section></aside></main></div>`
  }

  function renderElectrical() {
    const root = ensureRoot()
    if (!root || state.mode !== 'elec' || !state.electricalOpen) return
    root.className = 'sama-workbench-root electrical-v2'
    root.innerHTML = electricalEditorHtml()
    root.oninput = (event) => {
      const el = event.target
      if (el.dataset.elecProject) state.electricalProject[el.dataset.elecProject] = el.value
      if (el.dataset.elecDevice) { const device = selectedElectricalDevice(); if (device) device[el.dataset.elecDevice] = el.value }
    }
    root.onchange = async (event) => {
      if (event.target.id === 'elec-sheet-select') { state.electricalSheet = Number(event.target.value); state.electricalSelected = ''; renderElectrical() }
      else if (event.target.dataset.elecProject || event.target.dataset.elecDevice) await refreshElectrical()
    }
    root.onclick = async (event) => {
      const deviceGroup = event.target.closest('[data-device-id]')
      if (deviceGroup) { await electricalSelectDevice(deviceGroup.dataset.deviceId); return }
      const button = event.target.closest('[data-action]'); if (!button) return
      await handleElectricalAction(button.dataset.action, button.dataset)
    }
  }

  async function electricalSelectDevice(deviceId) {
    if (state.wireStart && state.wireStart.deviceId !== deviceId) {
      const sheet = activeElectricalSheet(); const target = sheet.devices.find((d) => d.id === deviceId)
      if (target) { rememberElectrical(); sheet.nets.push({ id: `N-${Date.now()}`, name: '待核对', wireNo: '', potential: '', verificationStatus: '待现场核对', connections: [state.wireStart, { deviceId, pinId: target.pins[0]?.id || '1' }] }); state.wireStart = null; state.electricalSelected = deviceId; await refreshElectrical(); return }
    }
    state.electricalSelected = deviceId; renderElectrical()
  }

  async function handleElectricalAction(action, data) {
    if (action === 'elec-close') { state.electricalOpen = false; syncMode(); return }
    if (action === 'elec-new' || action === 'elec-sample') { const r = await api.electricalV2Create({ sample: action === 'elec-sample' }); if (r.ok) { state.electricalProject = r.project; state.electricalSheet = 0; state.electricalSelected = ''; state.electricalUndo = []; state.electricalRedo = []; await refreshElectrical() } }
    if (action === 'elec-add-device') { rememberElectrical(); const sheet = activeElectricalSheet(); const n = sheet.devices.length; sheet.devices.push({ id: `D-${Date.now()}`, tag: `?${n + 1}`, type: data.type, description: '待填写', x: 45 + (n % 6) * 55, y: 55 + Math.floor(n / 6) * 55, verificationStatus: '待现场核对' }); await refreshElectrical() }
    if (action === 'elec-delete') { const sheet = activeElectricalSheet(); if (state.electricalSelected && confirm('删除所选元件及其连接引用？')) { rememberElectrical(); sheet.devices = sheet.devices.filter((d) => d.id !== state.electricalSelected); sheet.nets = sheet.nets.map((n) => ({ ...n, connections: n.connections.filter((c) => c.deviceId !== state.electricalSelected) })); state.electricalSelected = ''; await refreshElectrical() } }
    if (action === 'elec-copy') { const device = selectedElectricalDevice(); if (device) { rememberElectrical(); const copy = JSON.parse(JSON.stringify(device)); copy.id = `D-${Date.now()}`; copy.tag = `${device.tag}_COPY`; copy.x += 15; copy.y += 15; activeElectricalSheet().devices.push(copy); state.electricalSelected = copy.id; await refreshElectrical() } }
    if (action === 'elec-move') { const device = selectedElectricalDevice(); if (device) { rememberElectrical(); device.x = Math.max(20, Math.min(385, device.x + Number(data.dx))); device.y = Math.max(30, Math.min(245, device.y + Number(data.dy))); await refreshElectrical() } }
    if (action === 'elec-wire-start') { const device = selectedElectricalDevice(); if (device) { const pinId = document.querySelector('#elec-wire-pin')?.value || device.pins[0]?.id; state.wireStart = { deviceId: device.id, pinId }; state.message = `从 ${device.tag}:${pinId} 开始连线，请点击目标元件`; renderElectrical() } }
    if (action === 'elec-add-sheet') { rememberElectrical(); const i = state.electricalProject.sheets.length; state.electricalProject.sheets.push({ id: `S${i + 1}-${Date.now()}`, pageNo: i + 1, title: `第 ${i + 1} 页`, size: 'A3-L', devices: [], nets: [], wireSegments: [] }); state.electricalSheet = i; await refreshElectrical() }
    if (action === 'elec-undo' && state.electricalUndo.length) { state.electricalRedo.push(JSON.stringify(state.electricalProject)); state.electricalProject = JSON.parse(state.electricalUndo.pop()); await refreshElectrical() }
    if (action === 'elec-redo' && state.electricalRedo.length) { state.electricalUndo.push(JSON.stringify(state.electricalProject)); state.electricalProject = JSON.parse(state.electricalRedo.pop()); await refreshElectrical() }
    if (action === 'elec-zoom') { state.electricalZoom = Math.max(0.4, Math.min(2.5, state.electricalZoom + Number(data.delta))); renderElectrical() }
    if (action === 'elec-drc') { const r = await api.electricalV2Drc(state.electricalProject); state.message = r.ok ? `DRC 完成：${r.drc.errors} 个错误，${r.drc.warnings} 个警告` : r.error; await refreshElectrical() }
    if (action === 'elec-save') { const r = await api.electricalV2Save(state.electricalProject); if (r.ok) { state.electricalProject = r.project; state.message = `工程已保存：${r.path}`; await loadElectricalSaved(); } else state.message = r.error; renderElectrical() }
    if (action === 'elec-load') { const r = await api.electricalV2Load(data.id); if (r.ok) { state.electricalProject = r.project; state.electricalSheet = 0; state.electricalSelected = ''; state.electricalUndo = []; state.electricalRedo = []; await refreshElectrical() } }
    if (action === 'elec-export') { const r = await api.electricalV2Export(state.electricalProject, ['json', 'svg', 'pdf', 'dxf', 'tables', 'drc']); state.message = r.ok ? `已导出 ${r.files.length} 个文件：${r.root}` : (r.canceled ? '已取消导出' : r.error); renderElectrical() }
    if (action === 'elec-eplan') {
      const preview = await api.eplanExportPreview({ project: state.electricalProject })
      if (!preview.ok) { state.message = preview.error; renderElectrical(); return }
      const details = `页 ${preview.changes.sheets}、元件 ${preview.changes.devices}、连接 ${preview.changes.connections}、端子 ${preview.changes.terminals}。\nDRC：${preview.drc.errors} 错 / ${preview.drc.warnings} 警告。\n模式：${preview.mode === 'official-api' ? 'EPLAN 官方 API' : 'EPLAN 导入任务包'}。\n\n确认导出？`
      if (confirm(details)) { const r = await api.eplanExportProject({ project: state.electricalProject, confirmed: true }); state.message = r.ok ? `${r.note} 输出：${r.root}` : (r.canceled ? '已取消 EPLAN 导出' : r.error); renderElectrical() }
    }
  }

  async function loadElectricalSaved() {
    const result = await api.electricalV2List()
    state.electricalSaved = result.projects || []
  }

  async function openElectricalEditor() {
    state.electricalOpen = true; state.circuitOpen = false
    if (!state.electricalProject) {
      const [created, symbols] = await Promise.all([api.electricalV2Create({ sample: true }), api.electricalV2Symbols(), loadElectricalSaved()])
      state.electricalProject = created.project; state.electricalSymbols = symbols.symbols || []
      await refreshElectrical({ render: false })
    }
    syncMode()
  }

  function circuitCatalogHtml() {
    const catalog = state.circuitCatalog || { machines: [], cases: [], groups: CIRCUIT_GROUPS }
    const cases = catalog.cases || []
    return `<div class="wb-circuit-shell"><header class="wb-header"><div><div class="wb-eyebrow">SAMA 1.3.0 · 电路案例工作台</div><h1>按机床、功能和证据查看电路</h1><p>规范化案例与原始资料分开；端子、定值和 PMC 地址未经核实时不会作为现场事实。</p></div><button class="ghost-btn" data-action="close-circuit">返回电气设计</button></header><div class="wb-circuit-filters"><select id="circuit-machine"><option value="">全部机床</option>${catalog.machines.map((m) => `<option value="${esc(m.id)}" ${m.id === state.circuitFilters.machineId ? 'selected' : ''}>${esc(m.brand)} ${esc(m.model)}</option>`).join('')}</select><select id="circuit-group"><option value="">全部功能</option>${(catalog.groups || CIRCUIT_GROUPS).map((g) => `<option ${g === state.circuitFilters.functionGroup ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select><input id="circuit-search" value="${esc(state.circuitFilters.search)}" placeholder="标题或功能关键词"><button class="ghost-btn" data-action="filter-circuit">筛选</button><span>${cases.length} 个案例</span></div><main class="wb-circuit-main"><aside class="wb-case-list">${catalog.machines.map((machine) => { const list = cases.filter((c) => c.machineId === machine.id); if (!list.length) return ''; return `<section><h2>${esc(machine.brand)} <small>${esc(machine.model)}</small></h2>${machine.warning ? `<p class="wb-warning">${esc(machine.warning)}</p>` : ''}${(catalog.groups || CIRCUIT_GROUPS).map((group) => { const grouped = list.filter((c) => c.functionGroup === group); return grouped.length ? `<h3>${esc(group)}</h3>${grouped.map((c) => `<button data-action="open-case" data-id="${esc(c.id)}"><strong>${esc(c.title)}</strong><span>${c.caseType === 'engineering_review' ? '工程审查' : '功能案例'} · ${esc(c.verificationStatus)}</span></button>`).join('')}` : '' }).join('')}</section>` }).join('') || '<div class="wb-empty">没有符合筛选条件的案例</div>'}</aside><section class="wb-case-detail">${state.circuitCase ? circuitCaseHtml(state.circuitCase) : '<div class="wb-empty wb-empty-large"><strong>选择左侧案例</strong><span>查看功能、具体图纸/PMC、文字化电路、诊断核对点和来源状态。</span></div>'}</section></main>${viewerHtml()}</div>`
  }

  function circuitCaseHtml(c) {
    const tabs = c.caseType === 'engineering_review' ? ['工程审查内容', '来源与验证'] : ['功能与适用条件', '具体电路图 / PMC', '文字化电路图', '故障诊断与核对点', '修改/改造边界', '来源与验证状态']
    let content = ''
    if (c.caseType === 'engineering_review') content = state.circuitTab === 0 ? c.pmcLogic || c.summary : `${c.sources}\n\n验证状态：${c.verificationStatus}`
    else content = [c.summary, c.pmcLogic, c.textualFlow, c.diagnosticChecks, c.changeBoundary, `${c.sources}\n\n验证状态：${c.verificationStatus}`][state.circuitTab] || ''
    return `<article><div class="wb-case-title"><div><span>${esc(c.brand)} ${esc(c.model)} · ${esc(c.functionGroup)}</span><h2>${esc(c.title)}</h2></div><b class="wb-badge ${c.caseType === 'engineering_review' ? 'warn' : ''}">${c.caseType === 'engineering_review' ? '工程审查' : '功能案例'}</b></div>${c.warning ? `<div class="wb-danger-callout"><strong>资料一致性警告</strong>${esc(c.warning)}</div>` : ''}<nav class="wb-case-tabs">${tabs.map((tab, i) => `<button class="${i === state.circuitTab ? 'active' : ''}" data-action="case-tab" data-index="${i}">${esc(tab)}</button>`).join('')}</nav>${state.circuitTab === 1 && c.caseType !== 'engineering_review' && c.diagramAssets?.length ? `<div class="wb-diagram-grid">${c.diagramAssets.map((a, i) => a.type === 'image' ? `<button data-action="view-diagram" data-index="${i}"><img src="${esc(a.url)}" alt="${esc(a.label)}"><span>${esc(a.label)}${a.page ? ` · 第${a.page}页` : ''}</span></button>` : `<button class="wb-document-card" data-action="open-path" data-path="${esc(a.absolutePath)}"><strong>PDF/文档</strong><span>${esc(a.label)}</span></button>`).join('')}</div>` : ''}<pre class="wb-case-text">${esc(content)}</pre><footer><button class="text-btn" data-action="open-path" data-path="${esc(c.sourcePath)}">打开规范化案例原文</button><span>${esc(c.verificationStatus)}</span></footer></article>`
  }

  function viewerHtml() {
    const a = state.viewer
    if (!a) return ''
    return `<div class="wb-viewer"><header><strong>${esc(a.label)}</strong><div><button data-action="zoom-out">−</button><span>${Math.round(state.zoom * 100)}%</span><button data-action="zoom-in">＋</button><button data-action="close-viewer">关闭</button></div></header><main><img src="${esc(a.url)}" style="transform:scale(${state.zoom})" alt="${esc(a.label)}"></main><footer><span>${a.page ? `原图第 ${a.page} 页` : '原图'}</span><button class="text-btn" data-action="open-path" data-path="${esc(a.absolutePath)}">用系统应用打开原图</button></footer></div>`
  }

  function renderCircuit() {
    const root = ensureRoot()
    if (!root) return
    root.className = 'sama-workbench-root circuit'
    root.innerHTML = circuitCatalogHtml()
    const eyebrow = root.querySelector('.wb-eyebrow'); if (eyebrow) eyebrow.textContent = 'SAMA 1.3.0 · 电路案例工作台'
    root.onchange = (event) => {
      if (event.target.id === 'circuit-machine') state.circuitFilters.machineId = event.target.value
      if (event.target.id === 'circuit-group') state.circuitFilters.functionGroup = event.target.value
      if (event.target.id === 'circuit-search') state.circuitFilters.search = event.target.value
    }
    root.oninput = (event) => { if (event.target.id === 'circuit-search') state.circuitFilters.search = event.target.value }
    root.onclick = async (event) => {
      const button = event.target.closest('[data-action]'); if (!button) return
      const { action } = button.dataset
      if (action === 'close-circuit') { state.circuitOpen = false; syncMode() }
      if (action === 'filter-circuit') await loadCircuitCatalog()
      if (action === 'open-case') { const r = await api.circuitCaseGet(button.dataset.id); if (r.ok) { state.circuitCase = r.case; state.circuitTab = 0; renderCircuit() } }
      if (action === 'case-tab') { state.circuitTab = Number(button.dataset.index); renderCircuit() }
      if (action === 'view-diagram') { state.viewer = state.circuitCase.diagramAssets[Number(button.dataset.index)]; state.zoom = 1; renderCircuit() }
      if (action === 'close-viewer') { state.viewer = null; renderCircuit() }
      if (action === 'zoom-in') { state.zoom = Math.min(3, state.zoom + 0.25); renderCircuit() }
      if (action === 'zoom-out') { state.zoom = Math.max(0.5, state.zoom - 0.25); renderCircuit() }
      if (action === 'open-path') await api.workbenchOpenPath(button.dataset.path)
    }
  }

  async function loadCircuitCatalog() {
    try {
      const result = await api.circuitCatalogList(state.circuitFilters)
      if (result.ok) state.circuitCatalog = result
      else state.circuitCatalog = { machines: [{ id: 'load-error', brand: '加载错误', model: '', warning: result.error || '电路数据库返回失败' }], cases: [{ id: 'load-error-case', machineId: 'load-error', caseType: 'engineering_review', functionGroup: '工程审查', title: result.error || '电路数据库返回失败', verificationStatus: '请查看应用日志' }], groups: CIRCUIT_GROUPS }
    } catch (error) {
      const message = error?.message || String(error)
      state.circuitCatalog = { machines: [{ id: 'load-error', brand: '加载错误', model: '', warning: message }], cases: [{ id: 'load-error-case', machineId: 'load-error', caseType: 'engineering_review', functionGroup: '工程审查', title: message, verificationStatus: 'IPC 调用失败' }], groups: CIRCUIT_GROUPS }
    }
    renderCircuit()
  }

  function injectCircuitButton() {
    const actions = document.querySelector('.center-pane .chat-header-actions')
    if (!actions) return
    if (!actions.querySelector('#sama-electrical-v2-open')) {
      const editor = document.createElement('button')
      editor.id = 'sama-electrical-v2-open'; editor.className = 'ghost-btn sama-electrical-v2-open'; editor.textContent = '专业电路编辑器'
      editor.onclick = () => openElectricalEditor()
      actions.prepend(editor)
    }
    if (!actions.querySelector('#sama-circuit-open')) {
      const button = document.createElement('button')
      button.id = 'sama-circuit-open'; button.className = 'ghost-btn sama-circuit-open'; button.textContent = '电路案例库'
      button.onclick = async () => { state.electricalOpen = false; state.circuitOpen = true; await loadCircuitCatalog(); syncMode() }
      actions.prepend(button)
    }
  }

  function injectMechanicalKnowledgeStatus() {
    const library = state.mechanicalLibrary
    if (!library?.ok) return
    const meta = document.querySelector('.topbar-meta')
    if (meta && !meta.querySelector('#sama-mechanical-kb-pill')) {
      const pill = document.createElement('span')
      pill.id = 'sama-mechanical-kb-pill'
      pill.className = 'pill sama-mechanical-kb-pill'
      pill.textContent = `机械库 ${library.sections.toLocaleString('zh-CN')} 段`
      pill.title = `${library.documents} 份来源文档 · ${library.assets.toLocaleString('zh-CN')} 条原图关联`
      meta.prepend(pill)
    }
    const importModal = document.querySelector('.import-db-modal')
    const importBody = importModal?.querySelector('.settings-body')
    if (importBody && !importBody.querySelector('.sama-built-in-mechanical-summary')) {
      const summary = document.createElement('div')
      summary.className = 'sama-built-in-mechanical-summary'
      summary.innerHTML = `<strong>内置机械维修知识库已就绪</strong><span>${library.documents.toLocaleString('zh-CN')} 份来源文档 · ${library.sections.toLocaleString('zh-CN')} 个段落 · ${library.assets.toLocaleString('zh-CN')} 条原图关联</span><small>这是随应用提供的只读库，无需在这里重复导入。</small>`
      importBody.prepend(summary)
    }
    const settingsPanel = document.querySelector('.modal .kb-panel')
    if (settingsPanel && !settingsPanel.querySelector('.sama-built-in-mechanical-summary')) {
      const summary = document.createElement('div')
      summary.className = 'sama-built-in-mechanical-summary compact'
      summary.innerHTML = `<strong>机械维修专用库</strong><span>已就绪 · ${library.documents.toLocaleString('zh-CN')} 份来源 · ${library.sections.toLocaleString('zh-CN')} 个段落</span>`
      settingsPanel.append(summary)
    }
  }

  function injectBuildStatus() {
    const meta = document.querySelector('.topbar-meta')
    if (!meta || meta.querySelector('#sama-build-status')) return
    const pill = document.createElement('span'); pill.id = 'sama-build-status'; pill.className = 'pill sama-build-status'
    pill.textContent = '1.3.0 · 专业工作台'; pill.title = '此内部交付未购买 Windows 代码签名证书，首次运行可能出现 SmartScreen 提示。'
    meta.prepend(pill)
  }

  function syncMode() {
    injectBuildStatus()
    injectMechanicalKnowledgeStatus()
    const selected = [...document.querySelectorAll('.industrial-nav button[aria-selected="true"]')].find((el) => ['机械设计', '电气设计'].includes(el.textContent.trim()))
    const mode = selected?.textContent.trim() === '机械设计' ? 'mech' : selected?.textContent.trim() === '电气设计' ? 'elec' : ''
    const pane = document.querySelector('.center-pane')
    const root = ensureRoot()
    state.mode = mode
    if (!pane || !root) return
    pane.classList.toggle('sama-workbench-active', mode === 'mech' || (mode === 'elec' && (state.circuitOpen || state.electricalOpen)))
    if (mode === 'mech') {
      root.hidden = false
      if (state.shownMode !== 'mech') renderMechanical()
      state.shownMode = 'mech'
    }
    else if (mode === 'elec') {
      injectCircuitButton()
      if (state.electricalOpen) {
        root.hidden = false
        if (state.shownMode !== 'electrical-v2') renderElectrical()
        state.shownMode = 'electrical-v2'
      } else if (state.circuitOpen) {
        root.hidden = false
        if (!state.circuitCatalog) loadCircuitCatalog()
        else if (state.shownMode !== 'circuit') renderCircuit()
        state.shownMode = 'circuit'
      } else { root.hidden = true; state.shownMode = 'elec' }
    } else { state.circuitOpen = false; state.electricalOpen = false; root.hidden = true; state.shownMode = '' }
  }

  async function init() {
    state.workOrder = blankWorkOrder()
    const [, library] = await Promise.all([
      loadDrafts(false),
      api.mechanicalLibraryStatus ? api.mechanicalLibraryStatus().catch((error) => ({ ok: false, error: error?.message || String(error) })) : Promise.resolve({ ok: false, error: '接口不可用' }),
    ])
    state.mechanicalLibrary = library
    const latest = state.drafts[0]
    if (latest) {
      const result = await api.maintenanceDraftGet(latest.id)
      if (result.ok) { state.workOrder = result.workOrder; await loadConversation(false) }
    }
    const observer = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement
        if (target?.closest?.('#sama-workbench-root')) return false
        return record.type === 'childList' || Boolean(target?.closest?.('.industrial-nav'))
      })
      if (relevant) requestAnimationFrame(syncMode)
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected', 'class'] })
    syncMode()
  }

  init().catch((error) => console.error('[SAMA Workbench]', error))
})()

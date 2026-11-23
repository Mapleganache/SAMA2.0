(() => {
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    judgeModel: '',
    maxStep: '8',
  };
  const fields = ['apiKey', 'baseUrl', 'model', 'judgeModel', 'maxStep'];
  const I18N = {
    zh: {
      brandSub: '数控机床故障诊断', newChat: '新对话', recent: '最近问题', settings: '设置',
      title: '故障诊断', subtitle: '描述现象，SAMA 会检索资料、对照案例，给出原因与处置。',
      detail: '详情', detailTitle: '显示/隐藏诊断详情', themeTitle: '切换主题', report: '架构报告',
      welcomeTitle: '从现象出发，找到可验证的原因',
      welcomeText: '不要只写“坏了”。带上机型、工况、冷热态和报警号，诊断会更准。',
      placeholder: '描述故障现象，例如：高桥外圆磨，磨削中，热机，主轴发热并振动',
      webToggle: '联网兜底', forceToggle: '强制五路', footState: 'Enter 发送 · Shift+Enter 换行',
      sendTitle: '发送', disclaimer: 'SAMA 给出的是待验证方向，不替代现场安全确认与厂家手册。',
      inspectorTitle: '诊断详情', inspectorWaiting: '等待提问',
      inspectorEmpty: '提交问题后，这里会显示：<br/>判定路线、证据、候选方案与评分。',
      collapse: '收起/展开', settingsTitle: '模型与诊断设置', settingsSub: '配置只保存在本机浏览器',
      model: '模型', judgeModel: '判分模型（可空）', judgePlaceholder: '默认同模型', maxStep: '最大步数',
      showDetail: '显示详细过程（流程 / 各路轨迹）', restore: '恢复默认', cancel: '取消', save: '保存', close: '关闭',
      statusUnconfigured: '未配置 API Key', statusServer: '服务端', historyEmpty: '还没有记录',
      routeSimple: '简单题', routeComplex: '复杂故障', routeNeed: '需要补充', routeNoPlan: '无方案', routeUnknown: '未知',
      loading: '正在诊断', loadingHint: '复杂故障会并行五路，通常需要 30–90 秒',
      assumptions: '按假设作答', questions: '先补充这些信息', candidateTitle: '候选方案与评分',
      scoreIntro: '系统按综合分排序，评分只作参考，最终由你决定。', recommended: '推荐', alternative: '备选',
      accuracy: '准确性', weighted: '加权', plan: '方案', scoreTable: '评分检查表', authorView: '作者视图',
      detailFlow: '流程', detailPlans: '各路过程', machine: '设备', phenomena: '现象', judgment: '判断',
      inspectorRoute: '路线', inspectorComplexity: '复杂度', inspectorElapsed: '耗时', inspectorModel: '模型',
      inspectorInfo: '识别到的信息', inspectorPlans: '候选方案', inspectorFlow: '流程', noDetail: '（没有成稿）',
      historyEmptyShort: '还没有记录', apiKeyMissing: '请先在设置里填写 API Key。', diagnoseFailed: '诊断失败',
      diagnosing: '诊断中…', done: '已完成', supplementHint: '正在补充信息：原问题会保留，直接在下面写补充内容即可。',
      supplementPlaceholder: '只写补充，例如：刚开机的冷机，现象出现在空载', supplementMode: '补充模式 · Enter 发送',
      langTitle: '切换语言 / Switch language',
    },
    en: {
      brandSub: 'CNC machine tool diagnosis', newChat: 'New chat', recent: 'Recent', settings: 'Settings',
      title: 'Fault diagnosis', subtitle: 'Describe the symptom. SAMA searches the library and cases, then proposes causes and actions.',
      detail: 'Details', detailTitle: 'Show/hide diagnosis details', themeTitle: 'Toggle theme', report: 'Architecture',
      welcomeTitle: 'Start from the symptom. Find a cause you can verify.',
      welcomeText: 'Do not just say “it is broken”. Add the model, operating condition, cold/hot state and alarm code for a sharper diagnosis.',
      placeholder: 'Describe the fault, e.g. Takasago cylindrical grinder, grinding, hot, spindle heat and vibration',
      webToggle: 'Web fallback', forceToggle: 'Force 5 lanes', footState: 'Enter to send · Shift+Enter for a new line',
      sendTitle: 'Send', disclaimer: 'SAMA gives directions to verify, not a substitute for on-site safety checks or the manufacturer manual.',
      inspectorTitle: 'Diagnosis details', inspectorWaiting: 'Waiting for a question',
      inspectorEmpty: 'After you submit a question, this panel shows:<br/>route, evidence, candidate plans and scores.',
      collapse: 'Collapse/expand', settingsTitle: 'Model & diagnosis settings', settingsSub: 'Stored only in this browser',
      model: 'Model', judgeModel: 'Judge model (optional)', judgePlaceholder: 'Same as model', maxStep: 'Max steps',
      showDetail: 'Show detailed process (flow / lane traces)', restore: 'Restore defaults', cancel: 'Cancel', save: 'Save', close: 'Close',
      statusUnconfigured: 'API key not configured', statusServer: 'server', historyEmpty: 'No history yet',
      routeSimple: 'Simple', routeComplex: 'Complex fault', routeNeed: 'Need details', routeNoPlan: 'No plan', routeUnknown: 'Unknown',
      loading: 'Diagnosing', loadingHint: 'Complex faults run five lanes in parallel; usually 30–90 seconds',
      assumptions: 'Answered with assumptions', questions: 'Please provide these details', candidateTitle: 'Candidate plans & scores',
      scoreIntro: 'Plans are ranked by weighted score. Scores are advisory; you decide.', recommended: 'Recommended', alternative: 'Alternative',
      accuracy: 'Accuracy', weighted: 'Weighted', plan: 'Plan', scoreTable: 'Scoring checklist', authorView: 'Author view',
      detailFlow: 'Flow', detailPlans: 'Lane traces', machine: 'Machine', phenomena: 'Symptoms', judgment: 'Assessment',
      inspectorRoute: 'Route', inspectorComplexity: 'Complexity', inspectorElapsed: 'Elapsed', inspectorModel: 'Model',
      inspectorInfo: 'Recognized information', inspectorPlans: 'Candidate plans', inspectorFlow: 'Flow', noDetail: '(no draft)',
      historyEmptyShort: 'No history yet', apiKeyMissing: 'Please enter an API key in Settings first.', diagnoseFailed: 'Diagnosis failed',
      diagnosing: 'Diagnosing…', done: 'Done', supplementHint: 'Adding details: the original question is kept. Write only the supplement below.',
      supplementPlaceholder: 'Only the supplement, e.g. cold start, symptom appears at idle', supplementMode: 'Supplement mode · Enter to send',
      langTitle: 'Switch language / 切换语言',
    },
  };
  let lang = localStorage.getItem('sama2-lang') === 'en' ? 'en' : 'zh';
  const tr = (key) => (I18N[lang] && I18N[lang][key]) || I18N.zh[key] || key;
  const routeLabel = (route) => ({
    simple: tr('routeSimple'), complex: tr('routeComplex'), need_info: tr('routeNeed'),
    no_plan: tr('routeNoPlan'), unknown: tr('routeUnknown'),
  }[route] || route || tr('routeUnknown'));
  const EXAMPLES = {
    zh: [
      { q: '高桥外圆磨床，磨削中，热机，主轴发热并且振动，空载时也有轻微异响', label: '主轴发热伴振动' },
      { q: '外圆磨床，磨削细长工件，热机，死顶尖处中心孔咬毛、顶尖烧伤', label: '中心孔咬毛' },
      { q: '数控磨床，磨削中，热机，加工齿轮时齿面粗糙度始终达不到工艺要求', label: '齿面粗糙度超差' },
      { q: '加工中心，换刀时刀库停在半途，刀具不能到位，无报警', label: '刀库换刀中途停止' },
    ],
    en: [
      { q: 'Takasago cylindrical grinder, grinding, hot, spindle heats up and vibrates, slight abnormal noise at idle', label: 'Spindle heat + vibration' },
      { q: 'Cylindrical grinder, grinding a slender workpiece, hot, dead-center hole galled and center burned', label: 'Center-hole galling' },
      { q: 'CNC grinder, grinding, hot, gear flank roughness never meets the process requirement', label: 'Roughness out of spec' },
      { q: 'Machining center, tool magazine stops halfway during tool change, tool not in position, no alarm', label: 'Tool change stalls' },
    ],
  };

  const chatBox = $('chat');
  const messages = $('messages');
  const welcome = $('welcome');
  const input = $('question');
  const sendBtn = $('send');
  const hint = $('hint');
  const inspectorBody = $('inspectorBody');
  const inspectorState = $('inspectorState');
  const inspector = $('inspector');

  let session = null;
  let busy = false;
  let lastData = null;
  let serverConfigured = false;
  let needInfo = false;

  /* ---------------- settings ---------------- */
  function loadSettings() {
    for (const id of fields) {
      const saved = localStorage.getItem('sama2-' + id);
      $(id).value = saved !== null ? saved : (DEFAULTS[id] ?? '');
    }
    $('force').checked = localStorage.getItem('sama2-force') === '1';
    $('web').checked = localStorage.getItem('sama2-web') === '1';
    $('showDetail').checked = localStorage.getItem('sama2-detail') !== '0';
    refreshStatus();
  }
  function saveSettings() {
    for (const id of fields) localStorage.setItem('sama2-' + id, $(id).value);
    localStorage.setItem('sama2-force', $('force').checked ? '1' : '0');
    localStorage.setItem('sama2-web', $('web').checked ? '1' : '0');
    localStorage.setItem('sama2-detail', $('showDetail').checked ? '1' : '0');
    refreshStatus();
  }
  function refreshStatus() {
    const key = $('apiKey').value || localStorage.getItem('sama2-apiKey');
    const configured = Boolean(key) || serverConfigured;
    $('keyDot').classList.toggle('on', configured);
    const model = $('model').value || 'deepseek-chat';
    $('modelState').textContent = key ? model : serverConfigured ? `${model} · ${tr('statusServer')}` : tr('statusUnconfigured');
  }
  $('settingsBtn').onclick = () => { loadSettings(); $('settings').showModal(); };
  $('saveSettings').onclick = () => { saveSettings(); $('settings').close(); };
  $('resetSettings').onclick = () => {
    for (const id of fields) localStorage.removeItem('sama2-' + id);
    localStorage.removeItem('sama2-force');
    localStorage.removeItem('sama2-web');
    localStorage.removeItem('sama2-detail');
    loadSettings();
  };
  for (const id of fields) $(id).addEventListener('input', () => { if (id !== 'apiKey') refreshStatus(); });

  /* ---------------- theme ---------------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('sama2-theme', theme);
  }
  applyTheme(localStorage.getItem('sama2-theme') || 'light');
  $('themeBtn').onclick = () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  };

  function applyLanguage() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = tr(el.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-example]').forEach((el) => {
      const example = EXAMPLES[lang][Number(el.dataset.example)] || EXAMPLES[lang][0];
      el.textContent = example.label;
      el.dataset.q = example.q;
    });
    const langBtn = $('langBtn');
    if (langBtn) {
      langBtn.textContent = lang === 'zh' ? 'EN' : '中文';
      langBtn.title = tr('langTitle');
    }
    refreshStatus();
    renderHistory();
    updateHint({ route: needInfo ? 'need_info' : 'complex' });
    renderInspector(lastData);
    inspectorState.textContent = lastData ? routeLabel(lastData.route) : tr('inspectorWaiting');
  }

  $('langBtn').onclick = () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('sama2-lang', lang);
    applyLanguage();
  };

  /* ---------------- history ---------------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('sama2-history') || '[]'); } catch { return []; }
  }
  function renderHistory() {
    const list = loadHistory();
    const box = $('history');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = `<div class="history-empty">${tr('historyEmpty')}</div>`;
      return;
    }
    for (const row of list) {
      const btn = document.createElement('button');
      btn.className = 'history-item';
      btn.textContent = row.q;
      btn.title = row.q;
      btn.onclick = () => {
        input.value = row.q;
        autoGrow();
        input.focus();
      };
      box.appendChild(btn);
    }
  }
  function pushHistory(q, route) {
    const list = loadHistory().filter((row) => row.q !== q);
    list.unshift({ q: q.length > 80 ? q.slice(0, 80) + '…' : q, route });
    localStorage.setItem('sama2-history', JSON.stringify(list.slice(0, 12)));
    renderHistory();
  }

  /* ---------------- markdown ---------------- */
  function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(sqlite_(?:curated|fragment|case):\d+)/g, '<span class="cite">$1</span>');
  }
  function md(src) {
    const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const body = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i += 1; }
        i += 1;
        out.push('<pre><code>' + esc(body.join('\n')) + '</code></pre>');
        continue;
      }
      if (!line.trim()) { i += 1; continue; }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }
      if (/^\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i += 1; }
        const cells = rows
          .filter((row) => !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(row.trim()))
          .map((row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => inline(cell.trim())));
        if (cells.length) {
          const head = cells[0];
          const body = cells.slice(1);
          out.push('<table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
            body.map((row) => '<tr>' + row.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
        }
        continue;
      }
      if (/^>\s?/.test(line)) {
        const body = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, '')); i += 1; }
        out.push('<blockquote>' + body.map(inline).join('<br>') + '</blockquote>');
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i += 1; }
        out.push('<ul>' + items.map((item) => `<li>${inline(item)}</li>`).join('') + '</ul>');
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i += 1; }
        out.push('<ol>' + items.map((item) => `<li>${inline(item)}</li>`).join('') + '</ol>');
        continue;
      }
      if (/^---+$/.test(line.trim())) { out.push('<hr>'); i += 1; continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>|[-*]\s|\d+\.\s|---+$)/.test(lines[i])) {
        para.push(lines[i]); i += 1;
      }
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
    }
    return out.join('\n');
  }

  /* ---------------- chat ---------------- */
  function scrollBottom() {
    requestAnimationFrame(() => { chatBox.scrollTop = chatBox.scrollHeight; });
  }
  function addUser(text) {
    welcome.hidden = true;
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = `<div class="bubble">${inline(text).replace(/\n/g, '<br>')}</div><div class="avatar">你</div>`;
    messages.appendChild(el);
    scrollBottom();
  }
  function addError(text) {
    const el = document.createElement('div');
    el.className = 'msg error';
    el.innerHTML = `<div class="avatar">!</div><div class="bubble">${esc(text)}</div>`;
    messages.appendChild(el);
    scrollBottom();
  }
  function addLoading() {
    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = `<div class="avatar">S</div><div class="bubble">
      <div class="loading">${tr('loading')}<i></i><i></i><i></i></div>
      <div class="loading-hint">${tr('loadingHint')}</div>
    </div>`;
    messages.appendChild(el);
    scrollBottom();
    return el;
  }

  function routeChip(route) {
    const cls = route === 'simple' ? 'simple' : route === 'need_info' ? 'need' : route === 'no_plan' ? 'err' : 'complex';
    return `<span class="chip ${cls}">${esc(routeLabel(route))}</span>`;
  }

  function addBot(data) {
    welcome.hidden = true;
    const meta = data.meta || {};
    const chips = [routeChip(data.route)];
    if (meta.elapsedMs) chips.push(`<span class="chip">${(meta.elapsedMs / 1000).toFixed(1)} s</span>`);
    if (meta.model) chips.push(`<span class="chip mono">${esc(meta.model)}</span>`);
    if (data.accuracy?.accuracy != null) chips.push(`<span class="chip">${tr('accuracy')} ${esc(data.accuracy.accuracy)}/10</span>`);

    const assumptions = Array.isArray(data.assumptions) && data.assumptions.length
      ? `<div class="assume"><b>${tr('assumptions')}</b><ul>${data.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
      : '';
    const pending = data.route === 'need_info' && (data.questions || []).length
      ? `<div class="questions"><b>${tr('questions')}</b><ol>${data.questions.map((q) => `<li>${esc(q.text || q)}</li>`).join('')}</ol></div>`
      : '';
    const cites = [...new Set(String(data.answer || '').match(/sqlite_(?:curated|fragment|case):\d+/g) || [])];
    const citeRow = cites.length
      ? `<div class="cites">${cites.map((id) => `<span class="cite">${esc(id)}</span>`).join('')}</div>`
      : '';

    let html = `<div class="avatar">S</div><div class="bubble"><div class="meta-row">${chips.join('')}</div>${assumptions}${md(data.answer || '')}${pending}${citeRow}`;
    if (localStorage.getItem('sama2-detail') !== '0') {
      html += candidateDetails(data);
      html += authorDetails(data);
      if (data.rubric?.checklist) html += detailsBlock('评分检查表', `<div class="muted">${inline(data.rubric.checklist).replace(/\n/g, '<br>')}</div>`);
    }
    html += '</div>';

    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = html;
    messages.appendChild(el);
    scrollBottom();
    lastData = data;
    renderInspector(data);
    inspectorState.textContent = routeLabel(data.route) || tr('done');
  }

  function candidateDetails(data) {
    const ranked = data.judge?.ranked || [];
    if (!ranked.length) return '';
    const plans = new Map((data.plans || []).map((p) => [p.id, p]));
    const dims = lang === 'en'
      ? [['accuracy', 'Accuracy'], ['safety', 'Safety'], ['feasibility', 'Feasible'], ['completeness', 'Complete'], ['brevity', 'Concise']]
      : [['accuracy', '准确性'], ['safety', '安全'], ['feasibility', '可行'], ['completeness', '完整'], ['brevity', '简洁']];
    const rows = ranked.map((row) => {
      const cells = dims.map((d) => `<td>${esc(row.scores?.[d[0]] ?? '-')}</td>`).join('');
      return `<tr><td>${esc(row.title || row.id)}</td>${cells}<td>${esc(row.total)}</td></tr>`;
    }).join('');
    const cards = ranked.slice(0, 2).map((row, index) => {
      const plan = plans.get(row.id);
      return `<div class="plan-card ${index === 0 ? 'win' : ''}">
        <h3>${index === 0 ? tr('recommended') : tr('alternative')} · ${esc(row.title || row.id)}（${esc(row.total)} / 10）</h3>
        <div class="plan-text">${esc(plan?.plan || tr('noDetail'))}</div>
      </div>`;
    }).join('');
    const body = `<div class="muted" style="margin-bottom:8px">${tr('scoreIntro')}</div>
      <div class="plan-cards">${cards}</div>
      <table class="score-table" style="margin-top:10px"><thead><tr><th>${tr('plan')}</th>${dims.map((d) => `<th>${d[1]}</th>`).join('')}<th>${tr('weighted')}</th></tr></thead><tbody>${rows}</tbody></table>`;
    return detailsBlock(`${tr('candidateTitle')}（${ranked.length}）`, body);
  }

  function authorDetails(data) {
    const facts = data.facts || {};
    const complexity = data.complexity || {};
    const flow = (data.flow || []).map((step, index) => `<li><b>${index + 1}. ${esc(step.stage)} · ${esc(step.title)}</b><div class="muted">${esc(step.detail || '')}</div></li>`).join('');
    const plans = (data.plans || []).map((plan) => {
      const trace = (plan.trace || []).map((s) => `<div class="muted">${lang === 'en' ? `Step ${esc(s.step)} ${esc(s.tool || 'finish')}` : `第${esc(s.step)}步 ${esc(s.tool || '收束')}`}${s.observation ? `${lang === 'en' ? ': ' : '：'}<span style="white-space:pre-wrap">${esc(String(s.observation).slice(0, 400))}</span>` : ''}</div>`).join('');
      return `<div class="plan-card"><h3>${esc(plan.title)} <span class="muted">${esc(plan.status)} · ${esc(plan.stepCount)} ${lang === 'en' ? 'steps' : '轮'}</span></h3>${trace}</div>`;
    }).join('');
    const body = `<p class="muted">${tr('judgment')}: ${esc(complexity.reason || (lang === 'en' ? 'none' : '无'))}（${esc(complexity.source || '')}）</p>
      <p class="muted">${tr('machine')}: ${esc(facts.machine || (lang === 'en' ? 'unknown' : '未识别'))}；${tr('phenomena')}: ${esc((facts.phenomena || []).join(lang === 'en' ? ', ' : '、') || (lang === 'en' ? 'not extracted' : '未提取'))}</p>
      ${flow ? `<h4>${tr('detailFlow')}</h4><ol class="flow-list">${flow}</ol>` : ''}
      ${plans ? `<h4>${tr('detailPlans')}</h4>${plans}` : ''}`;
    return detailsBlock(tr('authorView'), body);
  }

  function detailsBlock(summary, bodyHtml, open = false) {
    return `<details class="block"${open ? ' open' : ''}><summary>${esc(summary)}</summary><div class="body">${bodyHtml}</div></details>`;
  }

  /* ---------------- inspector ---------------- */
  function kv(label, value) {
    return `<div class="kv"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  }
  function renderInspector(data) {
    if (!data) {
      inspectorBody.innerHTML = `<div class="empty-state"><div class="empty-mark">⌁</div><p>${tr('inspectorEmpty')}</p></div>`;
      return;
    }
    const facts = data.facts || {};
    const complexity = data.complexity || {};
    const ranked = data.judge?.ranked || [];
    const flow = data.flow || [];
    const meta = data.meta || {};

    let html = `<div class="inspector-group"><h4>${tr('judgment')}</h4>
      ${kv(tr('inspectorRoute'), routeLabel(data.route))}
      ${kv(tr('inspectorComplexity'), complexity.level || '—')}
      ${meta.elapsedMs ? kv(tr('inspectorElapsed'), (meta.elapsedMs / 1000).toFixed(1) + ' s') : ''}
      ${meta.model ? kv(tr('inspectorModel'), meta.model) : ''}
    </div>`;

    if (facts.machine || (facts.phenomena || []).length || facts.controller) {
      html += `<div class="inspector-group"><h4>${tr('inspectorInfo')}</h4>
        ${facts.machine ? kv(tr('machine'), facts.machine) : ''}
        ${facts.controller ? kv(lang === 'en' ? 'Control' : '系统', facts.controller) : ''}
        ${(facts.phenomena || []).length ? kv(tr('phenomena'), facts.phenomena.join(lang === 'en' ? ', ' : '、')) : ''}
      </div>`;
    }

    if (ranked.length) {
      const rows = ranked.slice(0, 5).map((row) => `
        <div class="plan-row">
          <span class="name" title="${esc(row.title || row.id)}">${esc(row.title || row.id)}</span>
          <span class="score">${esc(row.total)}</span>
        </div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(row.total) * 10))}%"></i></div>`).join('');
      html += `<div class="inspector-group"><h4>${tr('inspectorPlans')}</h4>${rows}</div>`;
    }

    if (flow.length) {
      const items = flow.map((step) => `<li><b>${esc(step.stage)} · ${esc(step.title)}</b><span>${esc(step.detail || '')}</span></li>`).join('');
      html += `<div class="inspector-group"><h4>${tr('inspectorFlow')}</h4><ul class="flow-list">${items}</ul></div>`;
    }

    inspectorBody.innerHTML = html;
  }

  /* ---------------- send ---------------- */
  function payload(text) {
    return {
      apiKey: $('apiKey').value,
      baseUrl: $('baseUrl').value,
      model: $('model').value,
      judgeModel: $('judgeModel').value,
      maxStep: Number($('maxStep').value) || 8,
      forceMultiAgent: $('force').checked,
      allowWeb: $('web').checked,
      webAuto: true,
      language: lang,
      userText: text,
      session,
    };
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    if (!($('apiKey').value || localStorage.getItem('sama2-apiKey') || serverConfigured)) {
      $('settings').showModal();
      addError(tr('apiKeyMissing'));
      return;
    }
    addUser(text);
    input.value = '';
    autoGrow();
    setBusy(true);
    const loading = addLoading();
    inspectorState.textContent = tr('diagnosing');
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(text)),
      });
      const data = await response.json();
      loading.remove();
      if (!data.ok) { addError(data.error || tr('diagnoseFailed')); return; }
      addBot(data);
      session = data.route === 'need_info' ? data.session : null;
      needInfo = data.route === 'need_info';
      pushHistory(text, data.route);
      updateHint(data);
    } catch (error) {
      loading.remove();
      addError(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  function updateHint(data) {
    if (data.route === 'need_info') {
      needInfo = true;
      hint.hidden = false;
      hint.textContent = tr('supplementHint');
      input.placeholder = tr('supplementPlaceholder');
      $('footState').textContent = tr('supplementMode');
    } else {
      needInfo = false;
      hint.hidden = true;
      input.placeholder = tr('placeholder');
      $('footState').textContent = tr('footState');
    }
  }

  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value;
    input.disabled = value;
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }

  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  sendBtn.onclick = send;

  document.querySelectorAll('.example').forEach((example) => {
    example.onclick = () => {
      input.value = example.dataset.q;
      autoGrow();
      input.focus();
    };
  });

  $('newChat').onclick = () => {
    messages.innerHTML = '';
    welcome.hidden = false;
    session = null;
    needInfo = false;
    lastData = null;
    hint.hidden = true;
    input.value = '';
    autoGrow();
    updateHint({ route: 'complex' });
    renderInspector(null);
    inspectorState.textContent = tr('inspectorWaiting');
    input.focus();
  };

  function toggleInspector() {
    inspector.classList.toggle('hidden');
    $('inspectorToggle').textContent = inspector.classList.contains('hidden') ? '⇤' : '⇥';
  }
  $('inspectorToggle').onclick = toggleInspector;
  $('detailBtn').onclick = toggleInspector;
  if (window.innerWidth <= 820) inspector.classList.add('hidden');

  loadSettings();
  applyLanguage();
  autoGrow();
  input.focus();
  fetch('/api/health')
    .then((response) => response.json())
    .then((data) => {
      serverConfigured = Boolean(data?.configured);
      if (data?.model && !$('model').value) $('model').value = data.model;
      refreshStatus();
    })
    .catch(() => {});
})();




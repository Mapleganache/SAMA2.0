(() => {
  const $ = (id) => document.getElementById(id);
  const DEFAULTS = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    judgeModel: '',
    maxStep: '8',
  };
  const fields = ['apiKey', 'baseUrl', 'model', 'judgeModel', 'maxStep'];
  const routeText = {
    simple: '简单题',
    complex: '复杂故障',
    need_info: '需要补充',
    no_plan: '无方案',
    unknown: '未知',
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
    $('modelState').textContent = key ? model : serverConfigured ? `${model} · 服务端` : '未配置 API Key';
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

  /* ---------------- history ---------------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('sama2-history') || '[]'); } catch { return []; }
  }
  function renderHistory() {
    const list = loadHistory();
    const box = $('history');
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="history-empty">还没有记录</div>';
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
      <div class="loading">正在诊断<i></i><i></i><i></i></div>
      <div class="loading-hint">复杂故障会并行五路，通常需要 30–90 秒</div>
    </div>`;
    messages.appendChild(el);
    scrollBottom();
    return el;
  }

  function routeChip(route) {
    const cls = route === 'simple' ? 'simple' : route === 'need_info' ? 'need' : route === 'no_plan' ? 'err' : 'complex';
    return `<span class="chip ${cls}">${esc(routeText[route] || route || '未知')}</span>`;
  }

  function addBot(data) {
    welcome.hidden = true;
    const meta = data.meta || {};
    const chips = [routeChip(data.route)];
    if (meta.elapsedMs) chips.push(`<span class="chip">${(meta.elapsedMs / 1000).toFixed(1)} s</span>`);
    if (meta.model) chips.push(`<span class="chip mono">${esc(meta.model)}</span>`);
    if (data.accuracy?.accuracy != null) chips.push(`<span class="chip">准确性 ${esc(data.accuracy.accuracy)}/10</span>`);

    const assumptions = Array.isArray(data.assumptions) && data.assumptions.length
      ? `<div class="assume"><b>按假设作答</b><ul>${data.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
      : '';
    const pending = data.route === 'need_info' && (data.questions || []).length
      ? `<div class="questions"><b>先补充这些信息</b><ol>${data.questions.map((q) => `<li>${esc(q.text || q)}</li>`).join('')}</ol></div>`
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
    inspectorState.textContent = routeText[data.route] || '已完成';
  }

  function candidateDetails(data) {
    const ranked = data.judge?.ranked || [];
    if (!ranked.length) return '';
    const plans = new Map((data.plans || []).map((p) => [p.id, p]));
    const dims = [['accuracy', '准确性'], ['safety', '安全'], ['feasibility', '可行'], ['completeness', '完整'], ['brevity', '简洁']];
    const rows = ranked.map((row) => {
      const cells = dims.map((d) => `<td>${esc(row.scores?.[d[0]] ?? '-')}</td>`).join('');
      return `<tr><td>${esc(row.title || row.id)}</td>${cells}<td>${esc(row.total)}</td></tr>`;
    }).join('');
    const cards = ranked.slice(0, 2).map((row, index) => {
      const plan = plans.get(row.id);
      return `<div class="plan-card ${index === 0 ? 'win' : ''}">
        <h3>${index === 0 ? '推荐' : '备选'} · ${esc(row.title || row.id)}（${esc(row.total)} / 10）</h3>
        <div class="plan-text">${esc(plan?.plan || '（没有成稿）')}</div>
      </div>`;
    }).join('');
    const body = `<div class="muted" style="margin-bottom:8px">系统按综合分排序，评分只作参考，最终由你决定。</div>
      <div class="plan-cards">${cards}</div>
      <table class="score-table" style="margin-top:10px"><thead><tr><th>方案</th>${dims.map((d) => `<th>${d[1]}</th>`).join('')}<th>加权</th></tr></thead><tbody>${rows}</tbody></table>`;
    return detailsBlock(`候选方案与评分（${ranked.length} 路）`, body);
  }

  function authorDetails(data) {
    const facts = data.facts || {};
    const complexity = data.complexity || {};
    const flow = (data.flow || []).map((step, index) => `<li><b>${index + 1}. ${esc(step.stage)} · ${esc(step.title)}</b><div class="muted">${esc(step.detail || '')}</div></li>`).join('');
    const plans = (data.plans || []).map((plan) => {
      const trace = (plan.trace || []).map((s) => `<div class="muted">第${esc(s.step)}步 ${esc(s.tool || '收束')}${s.observation ? '：<span style="white-space:pre-wrap">' + esc(String(s.observation).slice(0, 400)) + '</span>' : ''}</div>`).join('');
      return `<div class="plan-card"><h3>${esc(plan.title)} <span class="muted">${esc(plan.status)} · ${esc(plan.stepCount)} 轮</span></h3>${trace}</div>`;
    }).join('');
    const body = `<p class="muted">判断：${esc(complexity.reason || '无')}（${esc(complexity.source || '')}）</p>
      <p class="muted">设备：${esc(facts.machine || '未识别')}；现象：${esc((facts.phenomena || []).join('、') || '未提取')}</p>
      ${flow ? `<h4>流程</h4><ol class="flow-list">${flow}</ol>` : ''}
      ${plans ? `<h4>各路过程</h4>${plans}` : ''}`;
    return detailsBlock('作者视图', body);
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
      inspectorBody.innerHTML = `<div class="empty-state"><div class="empty-mark">⌁</div><p>提交问题后，这里会显示：<br/>判定路线、证据、候选方案与评分。</p></div>`;
      return;
    }
    const facts = data.facts || {};
    const complexity = data.complexity || {};
    const ranked = data.judge?.ranked || [];
    const flow = data.flow || [];
    const meta = data.meta || {};

    let html = `<div class="inspector-group"><h4>判定</h4>
      ${kv('路线', routeText[data.route] || data.route || '未知')}
      ${kv('复杂度', complexity.level || '—')}
      ${meta.elapsedMs ? kv('耗时', (meta.elapsedMs / 1000).toFixed(1) + ' s') : ''}
      ${meta.model ? kv('模型', meta.model) : ''}
    </div>`;

    if (facts.machine || (facts.phenomena || []).length || facts.controller) {
      html += `<div class="inspector-group"><h4>识别到的信息</h4>
        ${facts.machine ? kv('设备', facts.machine) : ''}
        ${facts.controller ? kv('系统', facts.controller) : ''}
        ${(facts.phenomena || []).length ? kv('现象', facts.phenomena.join('、')) : ''}
      </div>`;
    }

    if (ranked.length) {
      const rows = ranked.slice(0, 5).map((row) => `
        <div class="plan-row">
          <span class="name" title="${esc(row.title || row.id)}">${esc(row.title || row.id)}</span>
          <span class="score">${esc(row.total)}</span>
        </div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(row.total) * 10))}%"></i></div>`).join('');
      html += `<div class="inspector-group"><h4>候选方案</h4>${rows}</div>`;
    }

    if (flow.length) {
      const items = flow.map((step) => `<li><b>${esc(step.stage)} · ${esc(step.title)}</b><span>${esc(step.detail || '')}</span></li>`).join('');
      html += `<div class="inspector-group"><h4>流程</h4><ul class="flow-list">${items}</ul></div>`;
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
      userText: text,
      session,
    };
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    if (!($('apiKey').value || localStorage.getItem('sama2-apiKey') || serverConfigured)) {
      $('settings').showModal();
      addError('请先在设置里填写 API Key。');
      return;
    }
    addUser(text);
    input.value = '';
    autoGrow();
    setBusy(true);
    const loading = addLoading();
    inspectorState.textContent = '诊断中…';
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(text)),
      });
      const data = await response.json();
      loading.remove();
      if (!data.ok) { addError(data.error || '诊断失败'); return; }
      addBot(data);
      session = data.route === 'need_info' ? data.session : null;
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
      hint.hidden = false;
      hint.textContent = '正在补充信息：原问题会保留，直接在下面写补充内容即可。';
      input.placeholder = '只写补充，例如：刚开机的冷机，现象出现在空载';
      $('footState').textContent = '补充模式 · Enter 发送';
    } else {
      hint.hidden = true;
      input.placeholder = '描述故障现象，例如：高桥外圆磨，磨削中，热机，主轴发热并振动';
      $('footState').textContent = 'Enter 发送 · Shift+Enter 换行';
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
    hint.hidden = true;
    input.value = '';
    autoGrow();
    updateHint({ route: 'complex' });
    renderInspector(null);
    inspectorState.textContent = '等待提问';
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
  renderHistory();
  renderInspector(null);
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



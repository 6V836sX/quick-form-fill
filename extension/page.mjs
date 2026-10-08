// Self-contained function: Chrome serializes this into the isolated execution world.
export function pageAction(action, payload = {}) {
  const stateKey = '__quickFormFillV3';
  const cleanText = text => String(text || '').replace(/\s+/g, ' ').trim();
  const parent = element => element.assignedSlot || element.parentElement || element.getRootNode().host;
  const labelledBy = element => {
    // IDs inside separate shadow trees can repeat. Resolve in the control's own tree.
    const root = element.getRootNode();
    return (element.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => root.getElementById?.(id)?.textContent || '').join(' ');
  };
  const labelOf = element => cleanText(
    Array.from(element.labels || [], label => label.textContent).join(' ') ||
    element.getAttribute('aria-label') || labelledBy(element) ||
    element.getRootNode().host?.getAttribute('label') || ''
  );
  const safe = element => {
    const type = (element.type || '').toLowerCase();
    const hints = [element.name, element.id, element.autocomplete, element.placeholder, labelOf(element)].join(' ');
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
      (element.tagName === 'INPUT' && !['text', 'email', 'tel', 'url'].includes(type)) ||
      element.matches(':disabled') || element.readOnly || !element.getClientRects().length ||
      ['hidden', 'collapse'].includes(getComputedStyle(element).visibility) ||
      /password|passcode|one.time|captcha|verification|otp|credit|card.number|bank|ssn|密码|验证码|银行卡|身份证/i.test(hints)) return false;
    // closest() stops at a shadow boundary; follow the composed tree to its hosts.
    for (let node = element; node; node = parent(node)) {
      if (node.hasAttribute('inert') || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' ||
        node.getAttribute('aria-disabled') === 'true' || node.hasAttribute('disabled') || node.hasAttribute('readonly')) return false;
    }
    return true;
  };
  const describe = element => ({
    label: labelOf(element).slice(0, 240),
    name: (element.name || element.id || '').slice(0, 120),
    placeholder: (element.placeholder || '').slice(0, 160), autocomplete: (element.autocomplete || '').split(' ').at(-1),
    type: element.type,
    requiresSelection: element.getAttribute('role') === 'combobox' || ['list', 'both'].includes(element.getAttribute('aria-autocomplete')),
    options: element.tagName === 'SELECT' ? Array.from(element.options).slice(0, 250).map(option => ({ value: option.value, label: option.text })) : undefined,
  });
  const isEmpty = element => !element.value.trim();
  if (action === 'hover' || action === 'stop-hover') {
    const helperKey = '__quickFormFillHoverV1';
    globalThis[helperKey]?.();
    if (action === 'stop-hover') return { enabled: false };
    const host = document.createElement('div');
    host.setAttribute('data-quick-form-fill-help', '');
    host.style.cssText = 'all:initial;position:fixed!important;z-index:2147483647!important;display:none;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{font:13px/1.5 system-ui,sans-serif;color:#182c3b}*{box-sizing:border-box}
      button{font:inherit;cursor:pointer;border:0;border-radius:7px;padding:7px 10px;background:#155e75;color:white}
      button:disabled{opacity:.6;cursor:wait}button:focus-visible{outline:3px solid #67c6e2;outline-offset:2px}
      section{width:310px;max-width:calc(100vw - 16px);max-height:55vh;overflow:auto;background:white;border:1px solid #cbd5df;border-radius:10px;padding:12px;box-shadow:0 4px 20px #0003;margin-top:5px}
      header{display:flex;justify-content:space-between;align-items:center;gap:8px}h2{font-size:14px;margin:0;overflow-wrap:anywhere}
      p{margin:9px 0;white-space:pre-wrap;overflow-wrap:anywhere}small{display:block;color:#536575}#close{padding:3px 8px;background:#eaf0f4;color:#182c3b}[hidden]{display:none!important}
    </style><button id="explain" type="button" title="点击后使用 GPT 分析此字段；悬停不会调用 API">✦ 解释与填写建议</button>
    <section id="panel" hidden aria-label="字段填写帮助"><header><h2 id="title"></h2><button id="close" type="button" aria-label="关闭字段帮助">×</button></header>
    <div role="status" aria-live="polite"><p id="explanation"></p><p id="suggestion"></p><small id="profile"></small><small id="usage"></small></div></section>`;
    document.documentElement.append(host);
    const ui = id => root.getElementById(id);
    let current = null, dismissed = null, snapshot = '', sequence = 0, hideTimer;
    const hide = () => { clearTimeout(hideTimer); current = null; sequence++; host.style.display = 'none'; ui('panel').hidden = true; ui('explain').disabled = false; };
    const position = () => {
      if (!current?.isConnected || !safe(current) || !isEmpty(current)) return hide();
      const rect = current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return hide();
      host.style.left = `${Math.max(8, Math.min(rect.right - 150, innerWidth - (ui('panel').hidden ? 180 : 326)))}px`;
      host.style.top = `${Math.max(8, Math.min(rect.bottom + 3, innerHeight - host.getBoundingClientRect().height - 8))}px`;
    };
    const show = element => {
      clearTimeout(hideTimer);
      if (current !== element) { sequence++; current = element; snapshot = JSON.stringify(describe(element)); ui('panel').hidden = true; ui('explain').disabled = false; }
      host.style.display = 'block'; position();
    };
    const enter = event => {
      if (event.composedPath().includes(host)) { clearTimeout(hideTimer); return; }
      const field = event.composedPath().find(node => node?.matches?.('input, textarea, select'));
      if (field && field === dismissed) return;
      dismissed = null;
      if (field && safe(field) && isEmpty(field)) show(field);
      else if (ui('panel').hidden) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 250); }
    };
    const leave = () => { if (ui('panel').hidden) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 250); } };
    const dismiss = () => { dismissed = current; hide(); };
    const keydown = event => { if (event.key === 'Escape') dismiss(); };
    const changed = event => { if (event.composedPath().includes(current)) position(); };
    ui('close').addEventListener('click', dismiss);
    ui('explain').addEventListener('click', async event => {
      // Page scripts cannot generate trusted clicks that spend the user's API quota.
      if (!event.isTrusted || !current || !safe(current) || !isEmpty(current)) return;
      const field = describe(current), request = ++sequence;
      snapshot = JSON.stringify(field); ui('panel').hidden = false; ui('title').textContent = field.label || field.name || '字段说明';
      ui('explanation').textContent = 'GPT 正在分析…'; ui('suggestion').textContent = ''; ui('profile').textContent = '';
      ui('usage').textContent = '仅发送字段描述和资料名称，不发送保存的资料值。'; ui('explain').disabled = true; position();
      try {
        const result = await chrome.runtime.sendMessage({ type: 'quick-form-fill:explain', field });
        if (request !== sequence) return;
        if (!current?.isConnected || !safe(current) || !isEmpty(current) || JSON.stringify(describe(current)) !== snapshot) return hide();
        if (!result?.ok) throw new Error(result?.error || '扩展连接已失效，请刷新网页后重新启用。');
        ui('explanation').textContent = result.explanation;
        ui('suggestion').textContent = `填写建议：${result.suggestion}`;
        ui('profile').textContent = result.profileLabel ? `可参考已保存的「${result.profileLabel}」资料；通过扩展预览后填入。` : '';
        ui('usage').textContent = result.cached ? '使用缓存，本次未调用 API。' : `输入 / 输出 tokens：${result.usage?.inputTokens ?? '未知'} / ${result.usage?.outputTokens ?? '未知'}`;
      } catch (error) { if (request === sequence) { ui('explanation').textContent = error.message; ui('usage').textContent = '未自动重试。'; } }
      finally { if (request === sequence) { ui('explain').disabled = false; position(); } }
    });
    document.addEventListener('pointerover', enter, true);
    document.addEventListener('pointerout', leave, true);
    document.addEventListener('focusin', enter, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('input', changed, true);
    document.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    globalThis[helperKey] = () => {
      hide(); host.remove();
      document.removeEventListener('pointerover', enter, true); document.removeEventListener('pointerout', leave, true);
      document.removeEventListener('focusin', enter, true); document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('input', changed, true); document.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position); delete globalThis[helperKey];
    };
    return { enabled: true };
  }
  if (action === 'scan') {
    const controls = [], diagnostics = { shadowRoots: 0, frames: 0, controls: 0, eligible: 0 };
    const roots = [document];
    // Visit each light-DOM element once, then descend into every open shadow root.
    // No MAIN-world injection and no attempts to open closed component roots.
    for (let index = 0; index < roots.length; index++) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot) { roots.push(element.shadowRoot); diagnostics.shadowRoots++; }
        if (element.tagName === 'IFRAME') diagnostics.frames++;
        if (element.matches('input, textarea, select')) controls.push(element);
      }
    }
    diagnostics.controls = controls.length;
    const eligible = controls.filter(element => safe(element) && isEmpty(element));
    diagnostics.eligible = eligible.length;
    const entries = eligible.slice(0, 100);
    const token = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
    const fields = entries.map((element, index) => ({ id: String(index), ...describe(element) }));
    globalThis[stateKey] = { token, entries, fields, url: location.href };
    return { token, fields, url: location.href, diagnostics };
  }
  const state = globalThis[stateKey];
  if (!state || state.token !== payload.token || state.url !== location.href) throw new Error('页面已变化，请重新扫描。');
  const results = [];
  for (const mapping of payload.mappings || []) {
    const index = Number(mapping.id), element = state.entries[index], snapshot = state.fields[index];
    if (!snapshot || !element?.isConnected || !safe(element) || !isEmpty(element) ||
      JSON.stringify(describe(element)) !== JSON.stringify((({ id, ...rest }) => rest)(snapshot))) {
      results.push({ id: mapping.id, filled: false }); continue;
    }
    let value = mapping.value;
    if (typeof value !== 'string' || value.length > 2000) { results.push({ id: mapping.id, filled: false }); continue; }
    if (element.tagName === 'SELECT') {
      const matches = Array.from(element.options).filter(option => !option.disabled && !option.parentElement?.disabled &&
        [option.value, option.text].some(text => text.trim().toLowerCase() === value.trim().toLowerCase()));
      if (matches.length !== 1) { results.push({ id: mapping.id, filled: false }); continue; }
      value = matches[0].value;
    }
    const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    // Framework listeners outside a component need events that cross shadow boundaries.
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    results.push({ id: mapping.id, filled: element.value === value, requiresSelection: snapshot.requiresSelection });
  }
  delete globalThis[stateKey];
  return results;
}

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

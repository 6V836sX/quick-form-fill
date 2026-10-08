// Self-contained function: Chrome serializes this into the isolated execution world.
export function pageAction(action, payload = {}) {
  const stateKey = '__quickFormFillV2';
  const safe = element => {
    const type = (element.type || '').toLowerCase();
    const hints = [element.name, element.id, element.autocomplete, element.placeholder,
      element.getAttribute('aria-label'), (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '), ...Array.from(element.labels || [], label => label.textContent)].join(' ');
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) &&
      (element.tagName !== 'INPUT' || ['text', 'email', 'tel', 'url'].includes(type)) &&
      !element.disabled && !element.readOnly && !element.closest('[inert]') && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden' &&
      !/password|passcode|one.time|captcha|verification|otp|credit|card.number|bank|ssn|密码|验证码|银行卡|身份证/i.test(hints);
  };
  const describe = element => ({
    label: (Array.from(element.labels || [], label => label.textContent).join(' ') || element.getAttribute('aria-label') ||
      (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')).trim().slice(0, 240),
    name: (element.name || element.id || '').slice(0, 120),
    placeholder: (element.placeholder || '').slice(0, 160), autocomplete: (element.autocomplete || '').split(' ').at(-1),
    type: element.type, options: element.tagName === 'SELECT' ? Array.from(element.options).slice(0, 250).map(option => ({ value: option.value, label: option.text })) : undefined,
  });
  const isEmpty = element => !element.value.trim();
  if (action === 'scan') {
    const entries = Array.from(document.querySelectorAll('input, textarea, select')).filter(element => safe(element) && isEmpty(element)).slice(0, 100);
    const token = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
    const fields = entries.map((element, index) => ({ id: String(index), ...describe(element) }));
    globalThis[stateKey] = { token, entries, fields, url: location.href };
    return { token, fields, url: location.href };
  }
  const state = globalThis[stateKey];
  if (!state || state.token !== payload.token || state.url !== location.href) throw new Error('页面已变化，请重新扫描。');
  const results = [];
  for (const mapping of payload.mappings || []) {
    const element = state.entries[Number(mapping.id)];
    if (!element?.isConnected || !safe(element) || !isEmpty(element) || JSON.stringify(describe(element)) !== JSON.stringify((({ id, ...rest }) => rest)(state.fields[Number(mapping.id)]))) {
      results.push({ id: mapping.id, filled: false }); continue;
    }
    let value = mapping.value;
    if (typeof value !== 'string' || value.length > 2000) continue;
    if (element.tagName === 'SELECT') {
      const matches = Array.from(element.options).filter(option => !option.disabled && !option.parentElement?.disabled &&
        [option.value, option.text].some(text => text.trim().toLowerCase() === value.trim().toLowerCase()));
      if (matches.length !== 1) { results.push({ id: mapping.id, filled: false }); continue; }
      value = matches[0].value;
    }
    const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    results.push({ id: mapping.id, filled: element.value === value });
  }
  delete globalThis[stateKey];
  return results;
}

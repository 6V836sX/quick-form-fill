import { explainField, helpMetadata } from './openai.mjs';
import { definitionsFor } from './profile.mjs';
import { initializeStorage, readKey } from './settings.mjs';
import { API_ORIGIN } from './model-config.mjs';
const ready = initializeStorage(chrome.storage);
const cache = new Map(), pending = new Set();
chrome.storage.onChanged.addListener(() => cache.clear());
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'quick-form-fill:explain' || sender.id !== chrome.runtime.id || !sender.tab?.id || sender.frameId !== 0 || !/^https?:/.test(sender.url || '')) return false;
  (async () => {
    await ready;
    if (pending.has(sender.tab.id)) throw new Error('已有字段正在分析，请稍后再试。');
    const { apiKey } = await readKey(chrome.storage);
    if (!apiKey) throw new Error('请打开扩展，在 GPT 设置中保存 API key，再启用悬停帮助。');
    if (!await chrome.permissions.contains({ origins: [API_ORIGIN] })) throw new Error('请打开扩展，点击“启用悬停帮助”并授权访问 OpenAI。');
    const saved = await chrome.storage.local.get(['profile', 'custom']);
    const definitions = definitionsFor(saved.custom || []), profile = saved.profile || {};
    const available = Object.keys(definitions).filter(key => typeof profile[key] === 'string' && profile[key].trim())
      .map(key => ({ key, description: definitions[key][0] }));
    const field = helpMetadata(message.field);
    const cacheKey = JSON.stringify([field, available]);
    if (cache.has(cacheKey)) return { ...cache.get(cacheKey), cached: true };
    if (pending.has(sender.tab.id)) throw new Error('已有字段正在分析，请稍后再试。');
    pending.add(sender.tab.id);
    try {
      const result = await explainField(field, available, apiKey);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, result);
      return result;
    } finally { pending.delete(sender.tab.id); }
  })().then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message || '字段分析失败，请稍后重试。' }));
  return true;
});

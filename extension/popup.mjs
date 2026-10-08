import { PROFILE_FIELDS, exactMatches } from './matching.mjs';
import { semanticMatches } from './openai.mjs';
import { MODEL, API_ORIGIN } from './model-config.mjs';
import { definitionsFor } from './profile.mjs';
import { initializeStorage, readKey, saveKey, deleteKey } from './settings.mjs';
import { pageAction } from './page.mjs';
const $ = id => document.getElementById(id);
let profile = {}, custom = [], definitions = PROFILE_FIELDS, scan, tabId, mappings = [], keySettings = { apiKey: '', remember: false };
const status = text => { $('status').textContent = text; };
const showUsage = usage => { $('usage').textContent = usage ? `本次模型 ${usage.model}；输入/输出 tokens：${usage.inputTokens ?? '未知'}/${usage.outputTokens ?? '未知'}；缓存输入：${usage.cachedInputTokens ?? '未知'}` : ''; };
$('model').textContent = MODEL;
for (const [key, names] of Object.entries(PROFILE_FIELDS)) {
  const label = document.createElement('label'); label.textContent = names[0];
  const input = document.createElement('input'); input.id = key; input.maxLength = 500; label.append(input); $('profile').append(label);
}
$('profile').addEventListener('submit', event => event.preventDefault());
function customRow(item = { key: `custom_${crypto.randomUUID()}`, label: '' }, value = '') {
  const row = document.createElement('div'); row.className = 'custom-row'; row.dataset.key = item.key;
  const name = document.createElement('input'); name.placeholder = '资料名称，如：学校、部门'; name.setAttribute('aria-label', '自定义资料名称'); name.maxLength = 80; name.value = item.label;
  const input = document.createElement('input'); input.placeholder = '资料内容'; input.setAttribute('aria-label', '自定义资料内容'); input.maxLength = 500; input.value = value;
  const remove = document.createElement('button'); remove.textContent = '移除'; remove.type = 'button'; remove.addEventListener('click', () => row.remove());
  row.append(name, input, remove); $('customFields').append(row);
}
$('addCustom').addEventListener('click', () => { if ($('customFields').children.length < 20) customRow(); else status('最多添加 20 项自定义资料。'); });
function reset() { scan = null; mappings = []; $('preview').replaceChildren(); $('fill').disabled = true; $('ai').disabled = true; showUsage(null); }
function render() {
  $('preview').replaceChildren();
  for (const field of scan.fields) {
    const match = mappings.find(item => item.id === field.id), row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!match; check.dataset.field = field.id;
    label.append(check, document.createTextNode(` ${field.label || field.name || field.placeholder || field.type}`));
    const select = document.createElement('select'); select.dataset.field = field.id; select.setAttribute('aria-label', `对应资料：${field.label || field.name || field.id}`);
    select.add(new Option('跳过', ''));
    for (const [key, names] of Object.entries(definitions)) if (profile[key]) select.add(new Option(`${names[0]}：${profile[key]}`, key));
    select.value = match?.key || ''; select.addEventListener('change', () => { check.checked = !!select.value; });
    const note = document.createElement('small'); note.textContent = (match?.source || '未匹配，可手动选择') + (field.requiresSelection ? ' · 填入后请在网页选择候选项' : '');
    row.append(label, select, note); $('preview').append(row);
  }
}
async function execute(action, payload) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: pageAction, args: [action, payload] });
  if (!result?.result) throw new Error('无法读取页面，请重新扫描。');
  return result.result;
}
function run(id, handler) {
  $(id).addEventListener('click', async () => {
    const controls = [...document.querySelectorAll('button, input, select')], previous = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { await handler(); } catch (error) { if (error.usage) showUsage(error.usage); status(error.message || '操作失败，请重新扫描。'); }
    finally { controls.forEach((control, index) => { control.disabled = previous[index]; }); $('ai').disabled = !scan?.fields.length; $('fill').disabled = !scan?.fields.length; }
  });
}
function refreshKeyUI() {
  $('apiKey').value = ''; $('apiKey').placeholder = keySettings.apiKey ? '已配置；输入新 key 可替换' : 'sk-…';
  $('rememberKey').checked = keySettings.remember;
  $('keyStatus').textContent = keySettings.apiKey ? (keySettings.remember ? '已配置 · 本地保存' : '已配置 · 本次会话') : '未配置';
}
run('saveKey', async () => {
  const value = $('apiKey').value.trim() || keySettings.apiKey;
  await saveKey(chrome.storage, value, $('rememberKey').checked);
  keySettings = await readKey(chrome.storage); refreshKeyUI(); status('API key 已保存。仅点击 GPT 按钮才会发起请求。');
});
run('deleteKey', async () => { await deleteKey(chrome.storage); keySettings = await readKey(chrome.storage); refreshKeyUI(); status('API key 已删除，仍可使用规则和手动匹配。'); });
run('save', async () => {
  const next = Object.fromEntries(Object.keys(PROFILE_FIELDS).map(key => [key, $(key).value.trim()]));
  const nextCustom = [...$('customFields').children].map(row => { const [label, value] = row.querySelectorAll('input'); next[row.dataset.key] = value.value.trim(); return { key: row.dataset.key, label: label.value.trim() }; }).filter(item => item.label);
  const nextDefinitions = definitionsFor(nextCustom);
  const nextProfile = Object.fromEntries(Object.keys(nextDefinitions).map(key => [key, next[key] || '']));
  await chrome.storage.local.set({ profile: nextProfile, custom: nextCustom });
  profile = nextProfile; custom = nextCustom; definitions = nextDefinitions; reset(); status('资料已保存，请扫描页面。'); $('profilePanel').open = false;
});
run('clear', async () => {
  await chrome.storage.local.remove(['profile', 'custom']); profile = {}; custom = []; definitions = PROFILE_FIELDS;
  for (const key of Object.keys(PROFILE_FIELDS)) $(key).value = '';
  $('customFields').replaceChildren(); reset(); status('填表资料已删除。API key 可在 GPT 设置中单独删除。');
});
run('scan', async () => {
  reset(); const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('请在普通 http/https 表单页面使用。');
  tabId = tab.id; scan = await execute('scan', {}); mappings = exactMatches(scan.fields, profile, definitions); render();
  if (!scan.fields.length) {
    status(scan.diagnostics?.frames
      ? '未找到可填的空白字段。页面包含嵌入表单，当前版本暂不支持 iframe；可尝试直接打开表单页面。'
      : '未找到可填的空白字段。请等待页面加载后重新扫描；已有内容、隐藏及受保护字段会跳过。');
  } else {
    status(`找到 ${scan.fields.length} 个空白字段，匹配 ${mappings.length} 项。请核对下方预览。`);
  }
});
run('ai', async () => {
  if (!keySettings.apiKey) { $('apiPanel').open = true; throw new Error('请先配置并保存 OpenAI API key。'); }
  const selects = [...$('preview').querySelectorAll('select')];
  const chosen = selects.filter(select => select.value).map(select => ({ id: select.dataset.field, key: select.value, source: '已选匹配' }));
  const unchecked = new Set([...$('preview').querySelectorAll('input')].filter(input => !input.checked).map(input => input.dataset.field));
  const remaining = scan.fields.filter(field => !chosen.some(item => item.id === field.id));
  if (!remaining.length) return status('所有字段已有匹配，本次不调用 GPT。');
  if (!Object.keys(definitions).some(key => profile[key])) throw new Error('请先保存至少一项资料。');
  const allowed = await chrome.permissions.request({ origins: [API_ORIGIN] });
  if (!allowed) throw new Error('未授权访问 OpenAI，仍可使用规则或手动匹配。');
  status('GPT 正在分析未匹配字段…'); showUsage(null);
  const result = await semanticMatches(remaining, profile, keySettings.apiKey, definitions);
  mappings = [...chosen, ...result.mappings]; render(); showUsage(result.usage);
  for (const input of $('preview').querySelectorAll('input')) if (unchecked.has(input.dataset.field) && !result.mappings.some(item => item.id === input.dataset.field)) input.checked = false;
  status(`GPT 新增 ${result.mappings.length} 项，请核对后填入。`);
});
run('fill', async () => {
  const selected = [...$('preview').querySelectorAll('select')].filter(select => select.value && [...$('preview').querySelectorAll('input')].some(input => input.dataset.field === select.dataset.field && input.checked));
  const result = await execute('fill', { token: scan.token, mappings: selected.map(select => ({ id: select.dataset.field, value: profile[select.value] })) });
  const selectionCount = result.filter(item => item.filled && item.requiresSelection).length;
  reset(); status(`已填入 ${result.filter(item => item.filled).length} 项，跳过 ${result.filter(item => !item.filled).length} 项。请在网页核对后自行提交。` +
    (selectionCount ? `其中 ${selectionCount} 项需在网页选择候选项（如城市）。` : ''));
});
await initializeStorage(chrome.storage);
const saved = await chrome.storage.local.get(['profile', 'custom']); profile = saved.profile || {}; custom = saved.custom || []; definitions = definitionsFor(custom);
for (const key of Object.keys(PROFILE_FIELDS)) $(key).value = profile[key] || '';
for (const item of custom) customRow(item, profile[item.key] || '');
keySettings = await readKey(chrome.storage); refreshKeyUI();
$('profilePanel').open = !Object.values(profile).some(Boolean);
if (!$('profilePanel').open) status('资料已加载，点击扫描当前页面。');

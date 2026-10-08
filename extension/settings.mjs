export async function initializeStorage(storage) {
  await storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
export async function readKey(storage) {
  const local = await storage.local.get('apiKey');
  if (typeof local.apiKey === 'string' && local.apiKey) return { apiKey: local.apiKey, remember: true };
  const session = await storage.session.get('apiKey');
  return { apiKey: typeof session.apiKey === 'string' ? session.apiKey : '', remember: false };
}
export async function saveKey(storage, value, remember) {
  if (typeof value !== 'string' || !/^sk-[A-Za-z0-9_-]{8,}$/.test(value.trim())) throw new Error('请输入有效格式的 OpenAI API key（以 sk- 开头）。');
  const apiKey = value.trim();
  // Write first; if storage fails the previous key is not silently discarded.
  await (remember ? storage.local : storage.session).set({ apiKey });
  await (remember ? storage.session : storage.local).remove('apiKey');
}
export async function deleteKey(storage) {
  await storage.local.remove('apiKey');
  await storage.session.remove('apiKey');
}

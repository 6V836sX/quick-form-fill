import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeStorage, readKey, saveKey, deleteKey } from '../extension/settings.mjs';
function storageArea() {
  const data = {}; let access;
  return { data, get access() { return access; }, setAccessLevel: async level => { access = level.accessLevel; }, get: async key => ({ [key]: data[key] }), set: async entries => Object.assign(data, entries), remove: async key => { delete data[key]; } };
}
test('key defaults to session, persists only by choice, and deletion clears both areas', async () => {
  const storage = { local: storageArea(), session: storageArea() };
  await initializeStorage(storage);
  assert.equal(storage.local.access, 'TRUSTED_CONTEXTS'); assert.equal(storage.session.access, 'TRUSTED_CONTEXTS');
  await saveKey(storage, 'sk-synthetic-key', false);
  assert.equal(storage.local.data.apiKey, undefined); assert.equal((await readKey(storage)).remember, false);
  await saveKey(storage, 'sk-synthetic-key', true);
  assert.equal(storage.session.data.apiKey, undefined); assert.equal((await readKey(storage)).remember, true);
  await saveKey(storage, 'sk-synthetic-key', false);
  assert.equal(storage.local.data.apiKey, undefined);
  await deleteKey(storage); assert.equal((await readKey(storage)).apiKey, '');
});
test('invalid key is rejected without overwriting a saved key', async () => {
  const storage = { local: storageArea(), session: storageArea() };
  await saveKey(storage, 'sk-synthetic-key', true);
  await assert.rejects(saveKey(storage, 'not-a-key', true));
  assert.equal((await readKey(storage)).apiKey, 'sk-synthetic-key');
});

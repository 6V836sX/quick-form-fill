import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticMatches } from '../extension/openai.mjs';
import { MODEL, API_URL } from '../extension/model-config.mjs';
import { definitionsFor } from '../extension/profile.mjs';
const fields = [{ id: 'a', label: 'Where can we contact you electronically?', value: 'page-secret', options: [{ value: 'secret-option' }] }];
const profile = { email: 'synthetic-private@example.test' };
const key = 'sk-synthetic-test-only';
const response = (overrides = {}) => ({ status: 'completed', model: MODEL, output: [{ type: 'message', content: [{ type: 'output_text', text: '{"mappings":[{"id":"a","key":"email"}]}' }] }], usage: { input_tokens: 40, output_tokens: 12, input_tokens_details: { cached_tokens: 8 } }, ...overrides });
const fake = body => async () => ({ ok: true, json: async () => body });
test('Responses request restricts schema and never sends saved values or page values', async () => {
  let calls = 0;
  const result = await semanticMatches(fields, profile, key, undefined, async (url, options) => {
    calls++; assert.equal(url, API_URL); assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.store, false); assert.deepEqual(body.reasoning, { effort: 'none' });
    assert.equal(body.text.format.strict, true); assert.equal(body.max_output_tokens, 3000);
    assert.deepEqual(body.text.format.schema.properties.mappings.items.properties.key.enum, ['email']);
    for (const secret of [key, profile.email, 'page-secret', 'secret-option']) assert(!options.body.includes(secret));
    return { ok: true, json: async () => response() };
  });
  assert.equal(calls, 1); assert.equal(result.mappings[0].key, 'email');
  assert.deepEqual(result.usage, { model: MODEL, inputTokens: 40, outputTokens: 12, cachedInputTokens: 8 });
});
test('custom information descriptions are sent without their values', async () => {
  const definitions = definitionsFor([{ key: 'custom_school', label: '学校' }]);
  await semanticMatches(fields, { custom_school: 'PRIVATE-SCHOOL' }, key, definitions, async (_url, options) => {
    assert(options.body.includes('学校')); assert(!options.body.includes('PRIVATE-SCHOOL'));
    return { ok: true, json: async () => response({ output: [{ content: [{ type: 'output_text', text: '{"mappings":[]}' }] }] }) };
  });
});
test('missing key, empty input or no saved facts make no billable call', async () => {
  const fail = () => { throw Error('Unexpected network'); };
  await assert.rejects(semanticMatches(fields, profile, '', undefined, fail), /API key/);
  assert.equal((await semanticMatches([], profile, key, undefined, fail)).usage, null);
  assert.equal((await semanticMatches(fields, {}, key, undefined, fail)).usage, null);
});
test('HTTP failures never retry or expose server error bodies', async () => {
  for (const code of [400, 401, 403, 404, 429, 500]) {
    let calls = 0;
    await assert.rejects(semanticMatches(fields, profile, key, undefined, async () => { calls++; return { ok: false, status: code, json: () => { throw Error('Do not read secret server messages'); } }; }), new RegExp(String(code)));
    assert.equal(calls, 1);
  }
});
test('network, timeout, incomplete, refusal and malformed outputs fail safely', async () => {
  for (const name of ['TypeError', 'TimeoutError']) await assert.rejects(semanticMatches(fields, profile, key, undefined, async () => { throw Object.assign(new Error(key), { name }); }), error => !error.message.includes(key));
  for (const body of [response({ status: 'incomplete' }), response({ output: [{ content: [{ type: 'refusal' }] }] }), response({ output: [{ content: [{ type: 'output_text', text: 'not json' }] }] }), response({ output: [{ content: [{ type: 'output_text', text: '{"mappings":{}}' }] }] })]) {
    await assert.rejects(semanticMatches(fields, profile, key, undefined, fake(body)), error => error.usage.outputTokens === 12);
  }
});

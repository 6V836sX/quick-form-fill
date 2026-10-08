import test from 'node:test';
import assert from 'node:assert/strict';
import { exactMatches, validateMappings } from '../extension/matching.mjs';
import { definitionsFor } from '../extension/profile.mjs';

test('rules match common labels and skip ambiguous or absent information', () => {
  const profile = { email: 'person@example.test', fullName: 'Example Person' };
  assert.deepEqual(exactMatches([{ id: 'a', label: '电子邮件' }, { id: 'b', label: 'Name', name: 'email' }, { id: 'c', label: 'City' }], profile), [{ id: 'a', key: 'email', source: '规则' }]);
});
test('custom facts support generic forms and cannot replace built-in keys', () => {
  const definitions = definitionsFor([{ key: 'custom_school', label: '学校' }, { key: '__proto__', label: 'Bad' }, { key: 'email', label: 'Bad' }]);
  assert.equal(definitions.email[0], '邮箱');
  assert.deepEqual(exactMatches([{ id: 'a', label: '学校' }], { custom_school: 'Synthetic School' }, definitions), [{ id: 'a', key: 'custom_school', source: '规则' }]);
});
test('only unique known field IDs and saved keys can be used', () => {
  const fields = [{ id: 'a' }], profile = { email: 'person@example.test' };
  for (const result of [[null], [{ id: 'z', key: 'email' }], [{ id: 'a', key: 'password' }], [{ id: 'a', key: 'toString' }], [{ id: 'a', key: 'email' }, { id: 'a', key: 'email' }]]) assert.deepEqual(validateMappings(result, fields, profile), []);
  assert.throws(() => validateMappings({}, fields, profile));
});

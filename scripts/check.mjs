import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
for (const dir of ['extension', 'scripts', 'tests']) {
  for (const name of fs.readdirSync(new URL(`${dir}/`, root))) {
    if (name.endsWith('.mjs')) execFileSync(process.execPath, ['--check', new URL(`${dir}/${name}`, root).pathname]);
  }
}
const manifest = JSON.parse(fs.readFileSync(new URL('extension/manifest.json', root)));
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
assert.deepEqual(manifest.optional_host_permissions, ['https://api.openai.com/*']);
assert.equal(manifest.content_scripts, undefined);
for (const name of fs.readdirSync(new URL('extension/', root))) {
  if (!/\.(mjs|html|json)$/.test(name)) continue;
  const content = fs.readFileSync(new URL(`extension/${name}`, root), 'utf8');
  assert(!/127\.0\.0\.1:11434|ollama|\.\.\/web\/|EVIWARD_ROOT/i.test(content), `Unexpected old dependency: ${name}`);
}
console.log('Syntax, permissions, and standalone dependency checks passed.');

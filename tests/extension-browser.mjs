import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { MODEL } from '../extension/model-config.mjs';

test('unpacked extension: key lifecycle, custom facts, mocked GPT mapping and reviewed shadow-DOM fill', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-form-fill-test-'));
  const extension = path.join(base, 'extension');
  fs.cpSync(fileURLToPath(new URL('../extension', import.meta.url)), extension, { recursive: true });
  // Test harness opens the popup as a tab instead of clicking the browser toolbar.
  // Pregrant hosts in this temporary copy, including our synthetic fixture origin.
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://api.openai.com/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(new URL('./fixtures/shadow-form.html', import.meta.url))); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const fixtureURL = `http://127.0.0.1:${server.address().port}/`;
  const id = crypto.createHash('sha256').update(fs.realpathSync(extension)).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(base, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    let calls = 0;
    await context.route('https://api.openai.com/v1/responses', async route => {
      calls++;
      const request = route.request(), body = request.postDataJSON();
      assert.equal(request.headers().authorization, 'Bearer sk-synthetic-browser-key');
      assert.equal(body.model, MODEL); assert.equal(body.store, false);
      assert(!request.postData().includes('Synthetic Person'));
      assert(!request.postData().includes('synthetic@example.test'));
      assert(!request.postData().includes('Synthetic School'));
      const input = JSON.parse(body.input); assert.equal(input.fields.length, 1);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'completed', model: MODEL, usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ mappings: [{ id: input.fields[0].id, key: 'fullName' }] }) }] }] }) });
    });
    const target = await context.newPage(); await target.goto(fixtureURL);
    assert.equal(await target.evaluate(() => document.querySelectorAll('input').length), 0);
    await target.evaluate(() => { window.submitted = false; document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.submitted = true; }); });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('#email').fill('synthetic@example.test');
    await popup.locator('#fullName').fill('Synthetic Person');
    await popup.locator('#addCustom').click();
    await popup.getByLabel('自定义资料名称').fill('学校');
    await popup.getByLabel('自定义资料内容').fill('Synthetic School');
    await popup.locator('#save').click();
    await popup.getByText('资料已保存，请扫描页面。').waitFor();
    await popup.locator('#apiPanel summary').click();
    await popup.locator('#apiKey').fill('sk-synthetic-browser-key');
    await popup.locator('#saveKey').click();
    await popup.getByText('已配置 · 本次会话', { exact: true }).waitFor();
    assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get('apiKey')).apiKey), undefined);
    await popup.reload();
    await popup.getByText('已配置 · 本次会话', { exact: true }).waitFor();
    assert.equal(await popup.locator('#apiKey').inputValue(), '');
    // Use the synthetic page as the toolbar invocation target for this tab-based harness.
    await popup.evaluate(async url => {
      const original = chrome.tabs.query.bind(chrome.tabs);
      const target = (await original({})).find(tab => tab.url === url);
      chrome.tabs.query = async query => query.active ? [target] : original(query);
    }, fixtureURL);
    // Mock GPT in the real service worker; no real credentials or paid calls.
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      globalThis.helpRequests = [];
      globalThis.fetch = async (url, options) => {
        globalThis.helpRequests.push({ url, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ status: 'completed', usage: { input_tokens: 80, output_tokens: 30 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ explanation: '用于接收联系邮件。', suggestion: '填写包含 @ 的常用邮箱地址。', profileKey: 'email' }) }] }] }) };
      };
    });
    await popup.locator('#hover').click();
    await popup.getByText('悬停帮助已启用。关闭弹窗，将鼠标移到空白字段，再点击“解释与填写建议”。').waitFor();
    await target.locator('[name=email]').hover();
    const helper = target.locator('[data-quick-form-fill-help]');
    await helper.locator('#explain').waitFor({ state: 'visible' });
    assert.equal(await worker.evaluate(() => globalThis.helpRequests.length), 0);
    // A website's synthetic click cannot spend API quota.
    await helper.locator('#explain').evaluate(button => button.click());
    assert.equal(await worker.evaluate(() => globalThis.helpRequests.length), 0);
    await helper.locator('#explain').click();
    await helper.getByText('用于接收联系邮件。', { exact: true }).waitFor();
    await helper.getByText('填写建议：填写包含 @ 的常用邮箱地址。', { exact: true }).waitFor();
    assert.equal(await target.locator('[name=email]').inputValue(), '');
    const requests = await worker.evaluate(() => globalThis.helpRequests);
    assert.equal(requests.length, 1);
    for (const secret of ['synthetic@example.test', 'Synthetic Person', 'Synthetic School', 'sk-synthetic-browser-key']) assert(!JSON.stringify(requests).includes(secret));
    await helper.locator('#explain').click();
    await helper.getByText('使用缓存，本次未调用 API。').waitFor();
    assert.equal(await worker.evaluate(() => globalThis.helpRequests.length), 1);
    await target.keyboard.press('Escape');
    await helper.waitFor({ state: 'hidden' });
    await popup.locator('#stopHover').click();
    await helper.waitFor({ state: 'detached' });
    await popup.locator('#scan').click();
    await popup.getByText('找到 3 个空白字段，匹配 2 项。请核对下方预览。').waitFor();
    await popup.locator('#ai').click();
    await popup.getByText('GPT 新增 1 项，请核对后填入。').waitFor();
    assert.equal(calls, 1);
    await popup.locator('#ai').click();
    await popup.getByText('所有字段已有匹配，本次不调用 GPT。').waitFor();
    assert.equal(calls, 1);
    await popup.locator('#fill').click();
    await popup.getByText('已填入 3 项，跳过 0 项。请在网页核对后自行提交。').waitFor();
    assert.equal(await target.locator('[name=email]').inputValue(), 'synthetic@example.test');
    assert.equal(await target.locator('[name=contact_person]').inputValue(), 'Synthetic Person');
    assert.equal(await target.locator('[name=school]').inputValue(), 'Synthetic School');
    assert.equal(await target.locator('[type=password]').inputValue(), '');
    assert.equal(await target.evaluate(() => window.submitted), false);
    await popup.locator('#apiPanel summary').click();
    await popup.locator('#rememberKey').check();
    await popup.locator('#saveKey').click();
    await popup.getByText('已配置 · 本地保存', { exact: true }).waitFor();
    assert.equal(await popup.evaluate(async () => (await chrome.storage.session.get('apiKey')).apiKey), undefined);
    await popup.locator('#deleteKey').click();
    await popup.getByText('API key 已删除，仍可使用规则和手动匹配。').waitFor();
    assert.equal(await popup.evaluate(async () => (await chrome.storage.local.get('apiKey')).apiKey), undefined);
    await popup.reload();
    await popup.getByText('未配置', { exact: true }).waitFor();
  } finally { if (context) await context.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(base, { recursive: true, force: true }); }
});

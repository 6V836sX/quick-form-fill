import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pageAction } from '../extension/page.mjs';
test('browser fills only reviewed empty fields and rejects stale scans', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><label>Email<input name="email"></label><input name="phone" value="existing"><input type="password"><input name="otp"><input style="display:none" name="city"><input type="checkbox"><select name="country"><option value="">Choose</option><option value="NZ">New Zealand</option></select><input name="firstName"><input name="company"><button>Submit</button></form>`);
    await page.evaluate(() => { window.events = []; document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); window.events.push('submit'); }); document.querySelector('[name=email]').addEventListener('input', () => window.events.push('input')); });
    const scan = await page.evaluate(pageAction, 'scan');
    assert.equal(scan.fields.length, 4);
    await page.locator('[name=firstName]').fill('User intervened');
    await page.locator('[name=company]').evaluate(element => { element.name = 'password'; });
    const fields = Object.fromEntries(scan.fields.map(field => [field.name, field.id]));
    const payload = { token: scan.token, mappings: [{ id: fields.email, value: 'person@example.test' }, { id: fields.country, value: 'New Zealand' }, { id: fields.firstName, value: 'Overwrite' }, { id: fields.company, value: 'Unsafe' }] };
    const run = async payload => page.evaluate(({ source, payload }) => (0, eval)(`(${source})`)('fill', payload), { source: pageAction.toString(), payload });
    const result = await run(payload);
    assert.equal(result.filter(item => item.filled).length, 2);
    assert.equal(await page.locator('[name=country]').inputValue(), 'NZ');
    assert.equal(await page.locator('[name=firstName]').inputValue(), 'User intervened');
    assert.equal(await page.locator('[name=password]').inputValue(), '');
    assert.deepEqual(await page.evaluate(() => window.events), ['input']);
    await assert.rejects(run(payload), /重新扫描/);
  } finally { await browser.close(); }
});

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

test('nested open roots resolve local labels, exclude protected controls, and send composed events', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<span id="shared-label">Wrong label from document</span><div id="wrapper"></div>');
    await page.evaluate(() => {
      const wrapper = document.querySelector('#wrapper').attachShadow({ mode: 'open' });
      wrapper.innerHTML = '<section id="nested"></section><fieldset disabled><input name="disabled-native"></fieldset><div id="inert" inert></div><div id="disabled" disabled></div><div id="hidden" hidden></div><div id="closed"></div>';
      const nested = wrapper.querySelector('#nested').attachShadow({ mode: 'open' });
      nested.innerHTML = '<span id="shared-label">First name</span><input id="first-name" aria-labelledby="shared-label"><label for="email">邮箱</label><input id="email" type="email"><label for="city">City</label><input id="city" role="combobox" aria-autocomplete="list"><span id="sensitive-label">Verification code</span><input aria-labelledby="sensitive-label"><input type="password"><input type="file"><input value="Existing"><input readonly><input style="display:none"><input type="checkbox">';
      for (const id of ['inert', 'disabled', 'hidden']) wrapper.getElementById(id).attachShadow({ mode: 'open' }).innerHTML = `<input name="${id}">`;
      wrapper.getElementById('closed').attachShadow({ mode: 'closed' }).innerHTML = '<input name="closed">';
      window.received = [];
      document.addEventListener('input', event => window.received.push(event.composedPath()[0].value));
      document.addEventListener('change', event => window.received.push(`change:${event.composedPath()[0].value}`));
    });
    const scan = await page.evaluate(pageAction, 'scan');
    assert.equal(scan.fields.length, 3);
    assert.deepEqual(scan.fields.map(field => field.label), ['First name', '邮箱', 'City']);
    assert.equal(scan.fields[2].requiresSelection, true);
    assert.equal(scan.diagnostics.shadowRoots, 5);
    const result = await page.evaluate(({ source, token }) => (0, eval)(`(${source})`)('fill', { token, mappings: [{ id: '0', value: 'Synthetic' }, { id: '2', value: 'Wellington' }] }), { source: pageAction.toString(), token: scan.token });
    assert.equal(result.filter(item => item.filled).length, 2);
    assert.equal(result[1].requiresSelection, true);
    assert.deepEqual(await page.evaluate(() => window.received), ['Synthetic', 'change:Synthetic', 'Wellington', 'change:Wellington']);
  } finally { await browser.close(); }
});

test('shadow controls hidden, replaced or relabelled after scanning are not filled', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="a"></div><div id="b"></div><div id="c"></div>');
    await page.evaluate(() => { for (const id of ['a', 'b', 'c']) document.getElementById(id).attachShadow({ mode: 'open' }).innerHTML = '<span id="label">Email</span><input aria-labelledby="label">'; });
    const scan = await page.evaluate(pageAction, 'scan');
    assert.equal(scan.fields.length, 3);
    await page.evaluate(() => {
      document.getElementById('a').setAttribute('inert', '');
      document.getElementById('b').shadowRoot.innerHTML = '<span id="label">Email</span><input aria-labelledby="label">';
      document.getElementById('c').shadowRoot.getElementById('label').textContent = 'Verification code';
    });
    const result = await page.evaluate(({ source, token }) => (0, eval)(`(${source})`)('fill', { token, mappings: ['0', '1', '2'].map(id => ({ id, value: 'synthetic@example.test' })) }), { source: pageAction.toString(), token: scan.token });
    assert.equal(result.filter(item => item.filled).length, 0);
  } finally { await browser.close(); }
});

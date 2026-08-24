'use strict';
/**
 * #540: an OpenAI account, added from the Accounts page with a pasted key
 * and offered on the create form. Driven in a real browser against a board
 * booted with AGENT_WORKFORCE_CODEX_BIN pointed at a stand-in codex that
 * writes auth.json from stdin (tools/browser-checks.sh writes it), so no
 * real key is ever involved and nothing reaches the operator's ~/.codex-*.
 *
 * What it asserts, each a thing a person would see: the form reveals on
 * its button; the key field is a password field; the answer names the
 * key's tail and never the key; the field is emptied once stored; the row
 * lists by provider; no OpenAI row carries the Claude history arm (no
 * ruling for codex yet); on the create form, choosing OpenAI leaves the
 * account menu live and offers the new account while the model menu still
 * parks; and choosing Anthropic back shows no OpenAI account.
 *
 * Computed-state only, so headless is sound. First run is completed
 * through the product's own route first: on a fresh board the first-run
 * pane sits ON TOP of Settings, which is how this check found itself
 * clicking a paragraph.
 */
const pw = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:4399';
let failed = 0;
(async () => {
  const r = await fetch(BASE + '/api/first-run/complete', { method: 'POST' });
  if (!r.ok) { console.log('FAIL  could not complete first run on the board'); process.exit(1); }
  const b = await pw.chromium.launch({ headless: true }); const p = await b.newPage();
  const say = (k, v, d) => { if (!v) failed += 1; console.log((v ? 'PASS' : 'FAIL') + '  ' + k + (d ? '  ' + d : '')); };
  await p.goto(BASE + '/?tab=settings', { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  if (await p.evaluate(() => document.getElementById('panel-settings').hidden)) {
    await p.goto(BASE + '/#settings', { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
  }
  if (await p.evaluate(() => document.getElementById('panel-settings').hidden)) {
    // Last resort so the ACCOUNTS flow can still be exercised: open the panel the way the tab code does.
    await p.evaluate(() => { document.getElementById('panel-settings').hidden = false; });
    console.log('NOTE  settings panel opened by hand; the URL route did not open it');
  }
  // Settings > Accounts
  await p.evaluate(() => { try { settingsGo('accounts'); } catch (e) { try { showTab('settings'); } catch (e2) {} const b = document.querySelector('[data-go="accounts"]'); if (b) b.click(); } });
  await p.waitForTimeout(800);
  const vis = await p.evaluate(() => { let el = document.getElementById('acct-add-openai'); const hid = []; while (el) { const cs = getComputedStyle(el); if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') hid.push(el.tagName + '#' + el.id + '.' + String(el.className).split(' ')[0]); el = el.parentElement; } return hid; });
  say('nothing above the button is hidden', vis.length === 0, JSON.stringify(vis));
  const sec = await p.evaluate(() => { const s = document.getElementById('s-sec-accounts'); return s ? !s.hidden : null; });
  say('accounts section opens', sec === true, String(sec));
  const geo = await p.evaluate(() => { const b = document.getElementById('acct-add-openai'); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vw: [innerWidth, innerHeight], onTop: top ? top.tagName + '#' + top.id + '.' + String(top.className).split(' ')[0] : null }; });
  say('the button has a size and is on top at its centre', geo.rect[2] > 0 && geo.rect[3] > 0 && /acct-add-openai/.test(geo.onTop || ''), JSON.stringify(geo));
  await p.click('#acct-add-openai', { timeout: 5000 }).catch(async () => { console.log('NOTE  normal click failed; clicking by force to continue the flow'); await p.click('#acct-add-openai', { force: true }); });
  say('add-by-key form reveals on the button', await p.isVisible('#acct-openai-flow'));
  say('the key field is a password field', (await p.getAttribute('#acct-openai-key', 'type')) === 'password');
  await p.fill('#acct-openai-key', 'sk-proj-walkwalkwalkwalkwalkWALK');
  await p.fill('#acct-openai-label', 'Walk Test');
  await p.click('#acct-openai-go');
  await p.waitForTimeout(1200);
  const msg = await p.textContent('#acct-openai-msg');
  say('adding answers with the tail, never the key', /API key ending WALK/.test(msg) && !/walkwalk/.test(msg), msg);
  say('the key field is emptied after the add', (await p.inputValue('#acct-openai-key')) === '');
  const rows = await p.evaluate(() => [...document.querySelectorAll('#set-accounts .acct-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  say('the row lists by provider with the key tail', rows.some((r) => /OpenAI/.test(r) && !/Codex/.test(r) && /API key ending WALK/.test(r)), JSON.stringify(rows));
  say('no OpenAI row carries the history arm', !rows.some((r) => /OpenAI/.test(r) && /history/.test(r)));
  // Create form: OpenAI provider -> account menu offers the new account
  await p.goto(BASE + '/?tab=create', { waitUntil: 'load' });
  await p.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });
  await p.evaluate(() => { document.getElementById('pick-pm').click(); document.getElementById('role-next').click(); });
  await p.waitForTimeout(700);
  const hasProv = await p.evaluate(() => !!document.getElementById('create-provider'));
  say('create form present', hasProv);
  await p.selectOption('#create-provider', 'openai');
  await p.waitForTimeout(300);
  const opts = await p.evaluate(() => { const s = document.getElementById('create-account'); return { disabled: s.disabled, opts: [...s.options].map((o) => o.textContent), val: s.value }; });
  say('account menu is enabled for OpenAI and offers the new account', !opts.disabled && opts.opts.some((o) => /API key ending WALK/.test(o)), JSON.stringify(opts));
  const model = await p.evaluate(() => document.getElementById('create-model').disabled);
  say('model menu still parks for OpenAI', model === true);
  await p.selectOption('#create-provider', 'anthropic');
  await p.waitForTimeout(300);
  const back = await p.evaluate(() => { const s = document.getElementById('create-account'); return [...s.options].map((o) => o.textContent); });
  say('switching back to Anthropic shows no OpenAI account', !back.some((o) => /API key/.test(o)), JSON.stringify(back));
  await b.close();
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL  check threw  ' + e.message); process.exit(1); });

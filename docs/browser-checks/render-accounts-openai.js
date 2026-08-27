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
/* #1156: this check POSTs /api/first-run/complete to whatever BASE it is
   given, so it declines rather than mutating a board that is not a fixture. */
require('./lib-sandbox-guard.js').requireSandbox('render-accounts-openai.js');
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
  const sec = await p.evaluate(() => { const s = document.getElementById('s-sec-accounts'); return s ? !s.hidden : null; });
  say('accounts section opens', sec === true, String(sec));
  // #770: the picker moved into its own "Add a provider" dialog, reached
  // through a door in the section; it opens on a dropdown (Josh's word,
  // not the old data-pick button pair #730 shipped, which is gone) and the
  // OpenAI key form is revealed by picking OpenAI in it.
  say('the door into Add a provider is visible', await p.isVisible('#acct-add-open'));
  say('before opening, the dialog is hidden', await p.isHidden('#acct-add-modal'));
  await p.click('#acct-add-open');
  await p.waitForTimeout(300);
  say('the dialog opens', await p.isVisible('#acct-add-modal'));
  const vis = await p.evaluate(() => { let el = document.getElementById('acct-provider-pick'); const hid = []; if (!el) return ['(no #acct-provider-pick)']; while (el) { const cs = getComputedStyle(el); if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') hid.push(el.tagName + '#' + el.id + '.' + String(el.className).split(' ')[0]); el = el.parentElement; } return hid; });
  say('nothing above the provider dropdown is hidden', vis.length === 0, JSON.stringify(vis));
  const geo = await p.evaluate(() => { const b = document.getElementById('acct-provider-pick'); if (!b) return { rect: [0, 0, 0, 0] }; const r = b.getBoundingClientRect(); return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; });
  say('the provider dropdown has a size', geo.rect[2] > 0 && geo.rect[3] > 0, JSON.stringify(geo));
  // Before the pick: neither form is showing. Without this, "reveals on the
  // pick" cannot be told from "always shown", the regression #730 exists to
  // prevent.
  say('before the pick, the OpenAI form is hidden', await p.isHidden('#acct-openai-flow'));
  // #770: every provider named in the dropdown, live ones enabled, coming
  // ones disabled -- the same claim #730's two-button check made, restated
  // for a select's options.
  const opts770 = await p.evaluate(() => [...document.querySelectorAll('#acct-provider-pick option')].map((o) => ({ value: o.value, text: o.textContent, disabled: o.disabled })));
  say('Anthropic Claude and OpenAI are live options', opts770.some((o) => o.value === 'claude' && !o.disabled && /Claude/.test(o.text)) && opts770.some((o) => o.value === 'openai' && !o.disabled && /OpenAI/.test(o.text)), JSON.stringify(opts770));
  say('at least one other provider is listed and disabled', opts770.some((o) => o.disabled && /coming/i.test(o.text)), JSON.stringify(opts770));
  await p.selectOption('#acct-provider-pick', 'openai');
  await p.waitForTimeout(300);
  say('add-by-key form reveals on picking OpenAI', await p.isVisible('#acct-openai-flow'));
  say('and the Claude flow is closed (one provider at a time, #730)', await p.isHidden('#acct-claude-flow'));
  say('the key field is a password field', (await p.getAttribute('#acct-openai-key', 'type')) === 'password');
  await p.fill('#acct-openai-key', 'sk-proj-walkwalkwalkwalkwalkWALK');
  /* 🛑 A UNIQUE LABEL PER ATTEMPT, BECAUSE THE RETRY COULD NEVER PASS AND
     REPLACED THE REAL ERROR. This check creates an OpenAI account and has no
     cleanup: the runner's flaky-retry re-runs it against the SAME still-live
     board, so attempt 2 hit "there is already an OpenAI account by that name"
     and that became the reported failure. On 0.5.88 the true cause (the
     Connected rename above) was visible only in attempt 1.
     ⚠️ THE GUARD MEANT TO ABSORB A FLAKE GUARANTEED A SECOND FAILURE, and a
     different one, which is worse than not retrying: it overwrites the
     diagnosis with a consequence of the first attempt.
     ⇒ Disconnect has no engine route yet (#770), so the account cannot be
     removed from the page. A per-attempt label is the fix available here.
     Nothing asserts on this string; it is checked as "API key ending WALK". */
  await p.fill('#acct-openai-label', 'Walk Test ' + process.pid + '-' + Date.now().toString(36).slice(-4));
  await p.click('#acct-openai-go');
  await p.waitForTimeout(1200);
  const msg = await p.innerText('#acct-openai-msg');
  say('adding answers with the tail, never the key', /API key ending WALK/.test(msg) && !/walkwalk/.test(msg), msg);
  say('the key field is emptied after the add', (await p.inputValue('#acct-openai-key')) === '');
  // #770: each account is its own box now (.acct-row retired), a green
  // Connected mark and a Disconnect door on every one.
  const rows = await p.evaluate(() => [...document.querySelectorAll('#set-accounts .acct-box')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  say('the row lists by provider with the key tail', rows.some((r) => /OpenAI/.test(r) && !/Codex/.test(r) && /API key ending WALK/.test(r)), JSON.stringify(rows));
  say('no OpenAI row carries the history arm', !rows.some((r) => /OpenAI/.test(r) && /history/.test(r)));
  // #962: the badge is a LIVE answer. The harness points the check at a stub
  // that accepts exactly the walk key (tools/browser-checks.sh), so this line
  // proves the live path renders it on an accepted key, not that a badge is
  // hardcoded.
  /* 🛑 THE WORD IS "Signed in", NOT "Connected" (#874, merged 16:42 on
     2026-08-27 as 7fddbacc). This assertion still said Connected and it took
     down cut 0.5.88, which was the FIRST cut to carry #874.
     ⚠️ IT IS NOT A FLAKE AND IT WAS NOT CONTENTION. It reproduces on the
     first run against the runner's own sandbox-4 fixture, every time. The
     retry made it look intermittent, for a separate reason recorded below.
     📌 The page is right and this was wrong: the badge says what it knows,
     and "Connected" claimed more than a signed-in account establishes. The
     rename is the product decision; this line was left behind by it. */
  say('every box says Signed in (live check against the harness stub accepted the walk key)', rows.length > 0 && rows.every((r) => /Signed in/.test(r)), JSON.stringify(rows));
  const disconnectDisabled = await p.evaluate(() => [...document.querySelectorAll('#set-accounts .acct-disconnect')].every((b) => b.disabled));
  say('Disconnect is disabled everywhere (no engine route yet, #770)', disconnectDisabled);
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

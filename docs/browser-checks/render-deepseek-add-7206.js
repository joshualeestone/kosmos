// Browser-check-surface: acct-compat-flow acct-compat-key acct-compat-go acct-compat-msg
'use strict';
/**
 * kosmos#7206 slice 1b: DeepSeek in Settings, AI Models, Add a provider. HERMETIC (file://, fetch stubbed): the
 * board's switch answer (/api/accounts/compat) and its add route are stand-ins. Asserts, in the browser:
 *   - switch OFF: the DeepSeek row says "coming soon" and cannot be picked (the select option and the visible
 *     combobox row); forcing a pick anyway shows no key form, and nothing is posted;
 *   - switch ON (the control): the row reads "DeepSeek" and can be picked; the key form opens with the key field
 *     focused; Add with no key asks for one and posts nothing;
 *   - a key DeepSeek refuses: the board's words show and the pasted key stays, so the person can fix it;
 *   - a key DeepSeek accepts: the post carries the vendor, the key and the name, and the success view shows by
 *     itself (the key form does not stay on screen beside it);
 *   - the switch turned off while the form is open: the next ask puts the form away and empties the pasted key.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-deepseek-add-7206.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-deepseek-add-7206: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-deepseek-add-7206: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__on = false;          // the board's switch
    window.__posts = [];          // every POST to the add route
    window.__addAnswer = null;    // { status, body } for the next add
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/\/api\/accounts\/compat$/.test(u) && opts && opts.method === 'POST') {
        window.__posts.push(JSON.parse(opts.body));
        const a = window.__addAnswer || { status: 200, body: { ok: true, connection: { state: 'ok' } } };
        return enc(a.body, a.status);
      }
      if (/\/api\/accounts\/compat(\?|$)/.test(u)) {
        return enc(window.__on ? { enabled: true, vendors: [{ id: 'deepseek', name: 'DeepSeek' }] } : { enabled: false, vendors: [] });
      }
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: [] });
      if (/\/api\/runners(\?|$)/.test(u)) return enc({ runners: {} });
      if (/\/api\/antigravity(\?|$)/.test(u)) return enc({ enabled: true, supported: false, installed: false });
      return enc({});
    };
  });
  await page.goto(PAGE);
  const q = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => q(() => new Promise((r) => setTimeout(r, 300)));
  // A fresh ask each time the switch moves (the page reuses an answer for 5 seconds).
  const reopen = async () => { await q(() => { COMPAT_ASK = null; if (!document.getElementById('acct-add-modal').hidden) closeAcctAdd(); openAcctAdd(); }); await settle(); };
  const row = () => q(() => {
    const opt = document.querySelector('#acct-provider-pick option[value="deepseek"]');
    const sel = document.getElementById('acct-provider-pick');
    // As a person sees it: the list re-reads its options when it opens (enhanceProviderSelect's syncOpts).
    const trig = sel.parentNode.querySelector('.pcombo-trigger');
    if (trig) { trig.click(); trig.click(); }
    const li = sel.parentNode.querySelector('.pcombo-opt[data-value="deepseek"]');
    return {
      text: opt && opt.textContent, disabled: !!(opt && opt.disabled),
      combo: li ? { text: li.textContent.trim(), off: li.getAttribute('aria-disabled') === 'true' || li.classList.contains('off') || li.hasAttribute('data-off') } : null,
    };
  });
  const pick = () => q(() => {
    const sel = document.getElementById('acct-provider-pick');
    sel.value = 'deepseek';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const form = () => q(() => ({
    shown: !document.getElementById('acct-compat-flow').hidden,
    key: document.getElementById('acct-compat-key').value,
    msg: document.getElementById('acct-compat-msg').textContent,
    focus: document.activeElement && document.activeElement.id,
    success: !document.getElementById('acct-success').hidden,
  }));

  // First run opens by itself on this hermetic page; close it the page's own way (it lifts first run's inert).
  await q(() => { if (typeof frClose === 'function') frClose(); });
  // ---- switch OFF
  await reopen();
  const r0 = await row();
  chk(r0.disabled && /coming soon/.test(r0.text || ''), 'off: the DeepSeek row says coming soon and cannot be picked', JSON.stringify(r0));
  chk(!r0.combo || r0.combo.off, 'off: the visible combobox row is not offered either', JSON.stringify(r0.combo));
  await pick(); await settle();
  const f0 = await form();
  const posts0 = await q(() => window.__posts.length);
  chk(!f0.shown && posts0 === 0, 'off: forcing a pick shows no key form and posts nothing', JSON.stringify({ f0, posts0 }));

  // ---- switch ON (control)
  await q(() => { window.__on = true; });
  await reopen();
  const r1 = await row();
  chk(!r1.disabled && r1.text === 'DeepSeek', 'CONTROL on: the row reads DeepSeek and can be picked', JSON.stringify(r1));
  chk(!r1.combo || !r1.combo.off, 'CONTROL on: the combobox row is offered', JSON.stringify(r1.combo));
  await pick(); await settle();
  const f1 = await form();
  chk(f1.shown && f1.focus === 'acct-compat-key', 'on: picking DeepSeek opens the key form, key field focused', JSON.stringify(f1));
  await q(() => document.getElementById('acct-compat-go').click()); await settle();
  const f2 = await form();
  chk(f2.msg === 'Paste the key first.' && (await q(() => window.__posts.length)) === 0, 'on: Add with no key asks for one and posts nothing', JSON.stringify(f2));

  // ---- a key DeepSeek refuses
  await q(() => {
    window.__addAnswer = { status: 400, body: { error: 'DeepSeek did not accept that key' } };
    document.getElementById('acct-compat-key').value = 'sk-wrong-0000';
    document.getElementById('acct-compat-go').click();
  });
  await settle();
  const f3 = await form();
  chk(f3.msg === 'DeepSeek did not accept that key' && f3.key === 'sk-wrong-0000' && f3.shown && !f3.success,
    'refused: the board\'s words show and the pasted key stays', JSON.stringify(f3));

  // ---- a key DeepSeek accepts
  await q(() => {
    window.__addAnswer = null;
    window.__posts.length = 0;
    document.getElementById('acct-compat-key').value = 'sk-good-1111';
    document.getElementById('acct-compat-name').value = 'work';
    document.getElementById('acct-compat-go').click();
  });
  await settle();
  const posted = await q(() => window.__posts.slice());
  chk(posted.length === 1 && posted[0].vendor === 'deepseek' && posted[0].key === 'sk-good-1111' && posted[0].label === 'work',
    'accepted: one post with the vendor, the key and the name', JSON.stringify(posted));
  const f4 = await form();
  chk(f4.success && !f4.shown && f4.key === '', 'accepted: the success view shows by itself, without the key form beside it', JSON.stringify(f4));

  // ---- the switch turned off while the form is open
  await reopen();
  await pick(); await settle();
  await q(() => { document.getElementById('acct-compat-key').value = 'sk-pasted-2222'; window.__on = false; COMPAT_ASK = null; return compatAsk(); });
  await settle();
  const f5 = await form();
  const r5 = await row();
  chk(!f5.shown && f5.key === '' && r5.disabled && /coming soon/.test(r5.text || ''), 'turned off: the next ask puts the form away and empties the pasted key', JSON.stringify({ f5, r5 }));

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) { console.log('\nrender-deepseek-add-7206: ' + fail.length + ' failed'); process.exit(1); }
  console.log('\nrender-deepseek-add-7206: all passed');
})().catch((e) => { console.error('FAIL  render-deepseek-add-7206: ' + ((e && e.stack) || e)); process.exit(1); });

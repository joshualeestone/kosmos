// Browser-check-surface: acct-compat-flow acct-compat-key acct-compat-go acct-compat-msg acct-compat-keylabel acct-compat-keypage acct-compat-bills data-compat-tile
'use strict';
/**
 * kosmos#7206 slice 2b: Z.ai GLM in Settings, AI Models, Add a provider, beside DeepSeek on one key form, each vendor
 * by its OWN switch. HERMETIC (file://, fetch stubbed): the board's answer (/api/accounts/compat, the vendors whose
 * switch is on) and its add route are stand-ins. Asserts, in the browser:
 *   - DeepSeek's switch alone: the GLM row says "coming soon" and cannot be picked; forcing a pick shows no form;
 *   - GLM's switch on (the control): the row reads "Z.ai GLM"; picking it opens the key form in GLM's own words (the
 *     label, the Coding Plan sentence, the link to z.ai), never DeepSeek's, with the key field focused;
 *   - a key Z.ai accepts: the post names vendor glm, and the success view names Z.ai GLM;
 *   - picking DeepSeek after GLM: the form is DeepSeek's again, nothing of GLM's words left;
 *   - GLM switched off while its form is open: the next ask puts it away and empties the pasted key, and an off for
 *     DeepSeek alone does not touch an open GLM form;
 *   - the setup step's GLM row reads "Add in Settings" only while GLM's switch is on; DeepSeek's stays "Coming soon";
 *   - slice 3: MiniMax by its own switch alone, in its own words, posting vendor minimax.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-glm-add-7206.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-glm-add-7206: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

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
    console.error('FAIL  render-glm-add-7206: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__on = ['deepseek'];   // the vendors whose switch is on
    window.__posts = [];
    window.__addAnswer = null;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/\/api\/accounts\/compat$/.test(u) && opts && opts.method === 'POST') {
        window.__posts.push(JSON.parse(opts.body));
        if (window.__slow) await new Promise((r) => { window.__release = r; });
        const a = window.__addAnswer || { status: 200, body: { ok: true, connection: { state: 'ok' } } };
        return enc(a.body, a.status);
      }
      if (/\/api\/accounts\/compat(\?|$)/.test(u)) {
        return enc({ enabled: window.__on.length > 0, vendors: window.__on.map((id) => ({ id })) });
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
  const reopen = async () => { await q(() => { COMPAT_ASK = null; if (!document.getElementById('acct-add-modal').hidden) closeAcctAdd(); openAcctAdd(); }); await settle(); };
  const row = (id) => q((v) => {
    const opt = document.querySelector('#acct-provider-pick option[value="' + v + '"]');
    const sel = document.getElementById('acct-provider-pick');
    const trig = sel.parentNode.querySelector('.pcombo-trigger');
    if (trig) { trig.click(); trig.click(); }
    const li = sel.parentNode.querySelector('.pcombo-opt[data-value="' + v + '"]');
    return {
      text: opt && opt.textContent, disabled: !!(opt && opt.disabled),
      combo: li ? { text: li.textContent.trim(), off: li.getAttribute('aria-disabled') === 'true' || li.classList.contains('off') || li.hasAttribute('data-off') } : null,
    };
  }, id);
  const pick = (id) => q((v) => {
    const sel = document.getElementById('acct-provider-pick');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
  const form = () => q(() => ({
    shown: !document.getElementById('acct-compat-flow').hidden,
    key: document.getElementById('acct-compat-key').value,
    msg: document.getElementById('acct-compat-msg').textContent,
    focus: document.activeElement && document.activeElement.id,
    success: !document.getElementById('acct-success').hidden,
    successText: document.getElementById('acct-success').textContent.replace(/\s+/g, ' ').trim(),
    words: document.getElementById('acct-compat-flow').textContent.replace(/\s+/g, ' ').trim(),
    label: document.getElementById('acct-compat-keylabel').textContent,
    aria: document.getElementById('acct-compat-key').getAttribute('aria-label'),
    href: document.getElementById('acct-compat-keypage').getAttribute('href'),
  }));
  const tiles = () => q(() => {
    const out = {};
    for (const t of document.querySelectorAll('[data-compat-tile]')) {
      out[t.getAttribute('data-compat-tile')] = { soon: (t.querySelector('.soon') || {}).textContent, off: t.classList.contains('off') };
    }
    return out;
  });

  await q(() => { if (typeof frClose === 'function') frClose(); });
  // ---- DeepSeek's switch alone
  await reopen();
  const r0 = await row('glm');
  chk(r0.disabled && /coming soon/.test(r0.text || ''), 'DeepSeek only: the GLM row says coming soon and cannot be picked', JSON.stringify(r0));
  chk(!r0.combo || r0.combo.off, 'DeepSeek only: the visible GLM combobox row is not offered', JSON.stringify(r0.combo));
  const d0 = await row('deepseek');
  chk(!d0.disabled && d0.text === 'DeepSeek', 'CONTROL DeepSeek only: the DeepSeek row is offered', JSON.stringify(d0));
  await pick('glm'); await settle();
  const f0 = await form();
  chk(!f0.shown && (await q(() => window.__posts.length)) === 0, 'DeepSeek only: forcing a GLM pick shows no key form and posts nothing', JSON.stringify(f0));
  await q(() => frPaintCompat()); await settle();
  const t0 = await tiles();
  chk(t0.glm && t0.glm.soon === 'Coming soon' && t0.glm.off, 'DeepSeek only: the setup GLM row stays Coming soon', JSON.stringify(t0));

  // ---- GLM's switch on too
  await q(() => { window.__on = ['deepseek', 'glm']; });
  await reopen();
  const r1 = await row('glm');
  chk(!r1.disabled && r1.text === 'Z.ai GLM', 'CONTROL GLM on: the row reads Z.ai GLM and can be picked', JSON.stringify(r1));
  await pick('glm'); await settle();
  const f1 = await form();
  chk(f1.shown && f1.focus === 'acct-compat-key', 'GLM on: picking it opens the key form, key field focused', JSON.stringify({ shown: f1.shown, focus: f1.focus }));
  chk(f1.label === 'Z.ai API key (GLM Coding Plan)' && f1.aria === f1.label && /^https:\/\/z\.ai\//.test(f1.href || ''),
    'GLM on: the label, the field and the link are GLM\'s', JSON.stringify({ label: f1.label, aria: f1.aria, href: f1.href }));
  chk(/pointed at Z\.ai GLM/.test(f1.words) && /Coding Plan key/.test(f1.words) && !/DeepSeek/.test(f1.words),
    'GLM on: the form says Z.ai GLM and Coding Plan, never DeepSeek', f1.words);
  await q(() => {
    window.__posts.length = 0;
    document.getElementById('acct-compat-key').value = 'zai-good-3333';
    document.getElementById('acct-compat-go').click();
  });
  await settle();
  const posted = await q(() => window.__posts.slice());
  chk(posted.length === 1 && posted[0].vendor === 'glm' && posted[0].key === 'zai-good-3333', 'accepted: one post naming vendor glm', JSON.stringify(posted));
  const f2 = await form();
  chk(f2.success && !f2.shown && f2.key === '' && /Z\.ai GLM/.test(f2.successText), 'accepted: the success view names Z.ai GLM', JSON.stringify({ success: f2.success, text: f2.successText }));

  // ---- review 1: a vendor change with the form open clears the pasted key (no reopen in between)
  await reopen();
  await pick('deepseek'); await settle();
  await q(() => { window.__posts.length = 0; document.getElementById('acct-compat-key').value = 'sk-deepseek-5555'; document.getElementById('acct-compat-name').value = 'ds'; });
  await pick('glm'); await settle();
  const fx = await form();
  const nm = await q(() => document.getElementById('acct-compat-name').value);   // read before Add, which clears it on success
  await q(() => document.getElementById('acct-compat-go').click()); await settle();
  const fxPosts = await q(() => window.__posts.slice());
  chk(fx.shown && fx.key === '' && fx.label === 'Z.ai API key (GLM Coding Plan)' && fxPosts.length === 0,
    'switching DeepSeek to GLM with a key typed clears it, and Add sends nothing to Z.ai', JSON.stringify({ key: fx.key, label: fx.label, posts: fxPosts }));
  chk(nm === '', 'switching vendors clears the typed name too', JSON.stringify(nm));
  // CONTROL: picking the SAME vendor again keeps what was typed.
  await q(() => { document.getElementById('acct-compat-key').value = 'zai-keep-6666'; });
  await pick('glm'); await settle();
  const fk = await form();
  chk(fk.key === 'zai-keep-6666', 'CONTROL: re-picking the same vendor keeps the typed key', JSON.stringify(fk.key));
  // review 1: an add still in flight when the vendor changes does not leave the new form's Add dead.
  await q(() => {
    window.__slow = true;
    document.getElementById('acct-compat-go').click();
  });
  await pick('deepseek'); await settle();
  const goOff = await q(() => document.getElementById('acct-compat-go').disabled);
  chk(goOff === false, 'a vendor change during a check leaves the new form\'s Add usable', JSON.stringify({ disabled: goOff }));
  await q(() => { window.__slow = false; if (window.__release) window.__release(); });
  await settle();
  // review 2: re-picking the SAME vendor during a check is not a new visit: Add stays down (no second post of the
  // key), and the check that was running still finishes and re-arms it.
  await reopen();
  await pick('glm'); await settle();
  await q(() => {
    window.__posts.length = 0; window.__slow = true; window.__addAnswer = { status: 400, body: { error: 'Z.ai did not accept that key' } };
    document.getElementById('acct-compat-key').value = 'zai-once-7777';
    document.getElementById('acct-compat-go').click();
  });
  await pick('glm'); await settle();
  const during = await q(() => ({ disabled: document.getElementById('acct-compat-go').disabled, msg: document.getElementById('acct-compat-msg').textContent }));
  await q(() => document.getElementById('acct-compat-go').click()); await settle();
  await q(() => { window.__slow = false; if (window.__release) window.__release(); });
  await settle();
  const after = await q(() => ({ posts: window.__posts.length, disabled: document.getElementById('acct-compat-go').disabled, msg: document.getElementById('acct-compat-msg').textContent }));
  await q(() => { window.__addAnswer = null; });
  chk(during.disabled === true && /Checking the key with Z\.ai GLM/.test(during.msg), 're-picking GLM during its check keeps Add down and the check line', JSON.stringify(during));
  chk(after.posts === 1 && after.disabled === false && after.msg === 'Z.ai did not accept that key',
    'that check still finishes: one post, its answer shown, Add usable again', JSON.stringify(after));

  // ---- DeepSeek after GLM: its own words again
  await reopen();
  await pick('deepseek'); await settle();
  const f3 = await form();
  chk(f3.shown && f3.label === 'DeepSeek API key' && /platform\.deepseek\.com/.test(f3.href || '') && !/GLM|Z\.ai|Coding Plan/.test(f3.words),
    'DeepSeek after GLM: the form is DeepSeek\'s again, nothing of GLM left', JSON.stringify({ label: f3.label, href: f3.href, words: f3.words }));

  // ---- an off for DeepSeek alone leaves an open GLM form alone; GLM's own off puts it away
  await reopen();
  await pick('glm'); await settle();
  await q(() => { document.getElementById('acct-compat-key').value = 'zai-pasted-4444'; window.__on = ['glm']; COMPAT_ASK = null; return compatAsk(); });
  await settle();
  const f4 = await form();
  chk(f4.shown && f4.key === 'zai-pasted-4444', 'DeepSeek off: the open GLM form and its pasted key stay', JSON.stringify({ shown: f4.shown, key: f4.key }));
  await q(() => frPaintCompat()); await settle();
  const t1 = await tiles();
  chk(t1.glm && t1.glm.soon === 'Add in Settings' && !t1.glm.off && t1.deepseek && t1.deepseek.soon === 'Coming soon',
    'GLM on: the setup GLM row reads Add in Settings, DeepSeek\'s Coming soon', JSON.stringify(t1));
  await q(() => { window.__on = []; COMPAT_ASK = null; return compatAsk(); });
  await settle();
  const f5 = await form();
  const r5 = await row('glm');
  chk(!f5.shown && f5.key === '' && r5.disabled && /coming soon/.test(r5.text || ''), 'GLM off: the next ask puts its form away and empties the pasted key', JSON.stringify({ f5: { shown: f5.shown, key: f5.key }, r5 }));

  // ---- slice 3: MiniMax, by its own switch alone, on the same form
  await q(() => { window.__on = ['minimax']; });
  await reopen();
  const m0 = await row('minimax');
  const g0 = await row('glm');
  chk(!m0.disabled && m0.text === 'MiniMax' && g0.disabled, 'MiniMax only: its row is offered, GLM\'s is not', JSON.stringify({ m0, g0 }));
  await pick('minimax'); await settle();
  const fm = await form();
  chk(fm.shown && fm.label === 'MiniMax API key' && /^https:\/\/platform\.minimax\.io\//.test(fm.href || '') && /pointed at MiniMax/.test(fm.words) && !/GLM|DeepSeek|Coding Plan/.test(fm.words),
    'MiniMax: the form is in MiniMax\'s words only', JSON.stringify({ label: fm.label, href: fm.href, words: fm.words }));
  await q(() => { window.__posts.length = 0; document.getElementById('acct-compat-key').value = 'mm-good-8888'; document.getElementById('acct-compat-go').click(); });
  await settle();
  const pm = await q(() => window.__posts.slice());
  chk(pm.length === 1 && pm[0].vendor === 'minimax', 'MiniMax: an accepted key posts vendor minimax', JSON.stringify(pm));
  await q(() => frPaintCompat()); await settle();
  const t2 = await tiles();
  chk(t2.minimax && t2.minimax.soon === 'Add in Settings' && t2.glm && t2.glm.soon === 'Coming soon', 'MiniMax only: its setup row reads Add in Settings, GLM\'s Coming soon', JSON.stringify(t2));

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) { console.log('\nrender-glm-add-7206: ' + fail.length + ' failed'); process.exit(1); }
  console.log('\nrender-glm-add-7206: all passed');
})().catch((e) => { console.error('FAIL  render-glm-add-7206: ' + ((e && e.stack) || e)); process.exit(1); });

'use strict';
/**
 * kosmos#3658 (Josh, 2026-09-24 17:46): on first run's "Choose a model", Gemini and Grok
 * connect right there, with the same gold Connect as Claude and GPT, instead of an
 * "After setup" pill and a pointer to Settings. API key only for now (the subscription
 * paths wait on #3391 and #3568). HERMETIC (file://, fetch stubbed). Asserts:
 *   - one uninterrupted list, Claude, GPT, Gemini, Grok first, no tier heading, no
 *     "After setup", no "connect later in Settings" line;
 *   - Connect opens the shared key box for that provider (heading, Get a key link,
 *     aria-expanded), and switching provider clears the other's key;
 *   - an empty Add is refused without a request;
 *   - Add POSTs {key} to /api/accounts/<route>/apikey, closes the box, says so, and the
 *     row turns to a disabled "Connected";
 *   - a missing runner (the route's needsRunner answer) is said plainly and the box stays.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-firstrun-keyed-connect-3658.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-firstrun-keyed-connect-3658: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

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
    console.error('FAIL  render-firstrun-keyed-connect-3658: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(() => {
    window.__posts = [];
    window.__accounts = [];
    window.__nextKeyAnswer = null;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      const m = u.match(/\/api\/accounts\/(gemini|grok)\/apikey$/);
      if (m && opts && opts.method === 'POST') {
        window.__posts.push({ route: m[1], body: JSON.parse(opts.body) });
        const a = window.__nextKeyAnswer;
        if (a && a.status !== 200) return enc(a.body, a.status);
        const provider = m[1] === 'gemini' ? 'google' : 'xai';
        const account = { provider, connection: { state: 'connected' } };
        window.__accounts.push(account);
        return enc({ ok: true, account });
      }
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: window.__accounts });
      return enc({});
    };
  });
  await page.goto(PAGE);
  const q = (fn, arg) => page.evaluate(fn, arg);
  await q(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false;
    document.querySelectorAll('.fr-pane').forEach((p) => { p.hidden = p.id !== 'fr-pane-5'; });
  });

  const list = await q(() => {
    const pane = document.getElementById('fr-pane-5');
    const names = [...pane.querySelectorAll('.llm .llm-w b')].map((b) => b.textContent);
    const text = pane.innerText;
    return { first4: names.slice(0, 4), heading: !!pane.querySelector('.smore-t'), after: /After setup/.test(text),
      later: !!document.getElementById('fr-later-models'), runs: /Runs on this computer/i.test(text) };
  });
  chk(JSON.stringify(list.first4) === JSON.stringify(['Claude', 'GPT', 'Gemini', 'Grok']), 'the list starts Claude, GPT, Gemini, Grok', JSON.stringify(list.first4));
  chk(!list.heading && !list.runs, 'one uninterrupted list: no "Runs on this computer" heading', JSON.stringify(list));
  chk(!list.after && !list.later, 'no "After setup" pill and no "connect later in Settings" line', JSON.stringify(list));

  const g = await q(() => {
    document.getElementById('fr-gemini-connect').click();
    const flow = document.getElementById('fr-apikey-flow');
    return { open: !flow.hidden, head: document.getElementById('fr-apikey-t').textContent,
      href: document.getElementById('fr-apikey-getkey').getAttribute('href'),
      expanded: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded') };
  });
  chk(g.open && /Google API key for Gemini/.test(g.head) && /aistudio\.google\.com/.test(g.href) && g.expanded === 'true',
    'Gemini\'s Connect opens the key box for Gemini', JSON.stringify(g));

  const k = await q(() => {
    document.getElementById('fr-apikey-key').value = 'AIza-typed-for-gemini';
    document.getElementById('fr-grok-connect').click();
    return { head: document.getElementById('fr-apikey-t').textContent, key: document.getElementById('fr-apikey-key').value,
      gem: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded'),
      grok: document.getElementById('fr-grok-connect').getAttribute('aria-expanded') };
  });
  chk(/Paste an xAI API key for Grok/.test(k.head) && k.key === '' && k.gem === 'false' && k.grok === 'true',
    'switching to Grok re-labels the box and clears the Gemini key', JSON.stringify(k));

  const empty = await q(async () => {
    document.getElementById('fr-apikey-go').click();
    await new Promise((r) => setTimeout(r, 50));
    return { posts: window.__posts.length, msg: document.getElementById('fr-apikey-msg').textContent };
  });
  chk(empty.posts === 0 && /Paste the key first/.test(empty.msg), 'an empty Add is refused without a request', JSON.stringify(empty));

  const add = await q(async () => {
    document.getElementById('fr-apikey-key').value = '  xai-secret  ';
    document.getElementById('fr-apikey-go').click();
    for (let i = 0; i < 50 && !/connected/.test(document.getElementById('fr-apikey-msg').textContent); i++) await new Promise((r) => setTimeout(r, 20));
    const b = document.getElementById('fr-grok-connect');
    return { posts: window.__posts.slice(), msg: document.getElementById('fr-apikey-msg').textContent,
      boxHidden: document.getElementById('fr-apikey-flow').hidden, btn: b.textContent.trim(), disabled: b.disabled };
  });
  const p0 = add.posts[0] || {};
  chk(add.posts.length === 1 && p0.route === 'grok' && p0.body && p0.body.key === 'xai-secret',
    'Add POSTs the trimmed key to the Grok route', JSON.stringify(add.posts));
  chk(add.boxHidden && add.msg === 'Grok is connected.', 'a good key closes the box and says Grok is connected', JSON.stringify(add));
  chk(/Connected/.test(add.btn) && add.disabled, 'the Grok row turns to a disabled Connected', JSON.stringify(add));

  const missing = await q(async () => {
    window.__posts.length = 0;
    window.__nextKeyAnswer = { status: 400, body: { needsRunner: true, error: 'we could not find the Gemini runner on this computer' } };
    document.getElementById('fr-gemini-connect').click();
    document.getElementById('fr-apikey-key').value = 'AIza-key';
    document.getElementById('fr-apikey-go').click();
    for (let i = 0; i < 50 && !/runner/.test(document.getElementById('fr-apikey-msg').textContent); i++) await new Promise((r) => setTimeout(r, 20));
    const b = document.getElementById('fr-gemini-connect');
    return { posts: window.__posts.length, msg: document.getElementById('fr-apikey-msg').textContent,
      boxOpen: !document.getElementById('fr-apikey-flow').hidden, btn: b.textContent.trim() };
  });
  chk(missing.posts === 1 && /Gemini runner is not installed on this computer yet/.test(missing.msg) && missing.boxOpen && missing.btn === 'Connect',
    'a missing runner is said plainly, the box stays and the row stays Connect', JSON.stringify(missing));
  chk(errs.length === 0, 'no page errors', errs.join(' | '));

  await browser.close();
  if (fail.length) {
    console.error('render-firstrun-keyed-connect-3658: ' + fail.length + ' check(s) failed');
    process.exit(1);
  }
  console.log('render-firstrun-keyed-connect-3658: Gemini and Grok connect by API key on first run, in one uninterrupted list.');
})().catch((err) => {
  console.error('FAIL  render-firstrun-keyed-connect-3658: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});

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
    window.__runnerMissing = {};
    window.__hold = null;
    window.__unknown = false;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      const m = u.match(/\/api\/accounts\/(gemini|grok)\/apikey$/);
      if (m && opts && opts.method === 'POST') {
        const body = JSON.parse(opts.body || '{}');
        window.__posts.push({ route: m[1], body });
        // Same order as the server: the runner first, then the key.
        if (window.__runnerMissing[m[1]]) return enc({ needsRunner: true, error: 'we could not find the runner' }, 400);
        if (!body.key) return enc({ error: 'that does not look like a key' }, 400);
        if (window.__hold) await window.__hold;
        const provider = m[1] === 'gemini' ? 'google' : 'xai';
        const account = { provider, connection: { state: window.__unknown ? 'unknown' : 'connected' } };
        window.__accounts.push(account);   // the server keeps an unconfirmed key too
        return enc({ ok: true, account });
      }
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: window.__accounts });
      return enc({});
    };
  });
  await page.goto(PAGE);
  const q = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => q(() => new Promise((r) => setTimeout(r, 120)));
  await q(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false;
    frGo(5);
  });
  await settle();

  const list = await q(() => {
    const pane = document.getElementById('fr-pane-5');
    const names = [...pane.querySelectorAll('.llm .llm-w b')].map((b) => b.textContent);
    const text = pane.innerText;
    return { visible: !pane.hidden, first4: names.slice(0, 4), heading: !!pane.querySelector('.smore-t'), after: /After setup/.test(text),
      later: !!document.getElementById('fr-later-models'), runs: /Runs on this computer/i.test(text) };
  });
  chk(list.visible, 'frGo(5) shows the model step', JSON.stringify(list));
  chk(JSON.stringify(list.first4) === JSON.stringify(['Claude', 'GPT', 'Gemini', 'Grok']), 'the list starts Claude, GPT, Gemini, Grok', JSON.stringify(list.first4));
  chk(!list.heading && !list.runs, 'one uninterrupted list: no "Runs on this computer" heading', JSON.stringify(list));
  chk(!list.after && !list.later, 'no "After setup" pill and no "connect later in Settings" line', JSON.stringify(list));

  // Missing runner: the probe says so and the box never opens, so nobody is sent for a key.
  const miss = await q(async () => {
    window.__posts.length = 0;
    window.__runnerMissing = { gemini: true };
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    return { posts: window.__posts.slice(), boxHidden: document.getElementById('fr-apikey-flow').hidden,
      msg: document.getElementById('fr-apikey-msg').textContent, expanded: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded') };
  });
  chk(miss.posts.length === 1 && !miss.posts[0].body.key && miss.boxHidden && /"gemini"/.test(miss.msg) && /not installed/.test(miss.msg) && miss.expanded === 'false',
    'a missing runner is found BEFORE the key box: the box stays shut and the tool is named', JSON.stringify(miss));

  const g = await q(async () => {
    window.__runnerMissing = {};
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    return { open: !document.getElementById('fr-apikey-flow').hidden, head: document.getElementById('fr-apikey-t').textContent,
      href: document.getElementById('fr-apikey-getkey').getAttribute('href'),
      expanded: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded') };
  });
  chk(g.open && /Google API key for Gemini/.test(g.head) && /aistudio\.google\.com/.test(g.href) && g.expanded === 'true',
    'with the runner present, Gemini\'s Connect opens the key box for Gemini', JSON.stringify(g));

  const k = await q(async () => {
    document.getElementById('fr-apikey-key').value = 'AIza-typed-for-gemini';
    document.getElementById('fr-grok-connect').click();
    await new Promise((r) => setTimeout(r, 120));
    return { head: document.getElementById('fr-apikey-t').textContent, key: document.getElementById('fr-apikey-key').value,
      gem: document.getElementById('fr-gemini-connect').getAttribute('aria-expanded'),
      grok: document.getElementById('fr-grok-connect').getAttribute('aria-expanded') };
  });
  chk(/Paste an xAI API key for Grok/.test(k.head) && k.key === '' && k.gem === 'false' && k.grok === 'true',
    'switching to Grok re-labels the box and clears the Gemini key', JSON.stringify(k));

  const empty = await q(async () => {
    window.__posts.length = 0;
    document.getElementById('fr-apikey-go').click();
    await new Promise((r) => setTimeout(r, 50));
    return { posts: window.__posts.length, msg: document.getElementById('fr-apikey-msg').textContent };
  });
  chk(empty.posts === 0 && /Paste the key first/.test(empty.msg), 'an empty Add is refused without a request', JSON.stringify(empty));

  // Switch provider while an Add is in flight: Add must not stay disabled, and the key
  // that landed must still show its row as Connected.
  const sw = await q(async () => {
    window.__posts.length = 0;
    let release; window.__hold = new Promise((r) => { release = r; });
    document.getElementById('fr-apikey-key').value = 'xai-in-flight';
    document.getElementById('fr-apikey-go').click();
    await new Promise((r) => setTimeout(r, 30));
    document.getElementById('fr-gemini-connect').click();
    await new Promise((r) => setTimeout(r, 80));
    release(); window.__hold = null;
    await new Promise((r) => setTimeout(r, 200));
    const b = document.getElementById('fr-grok-connect');
    return { addDisabled: document.getElementById('fr-apikey-go').disabled, grok: b.textContent.trim(), grokDisabled: b.disabled };
  });
  chk(sw.addDisabled === false, 'switching provider mid-request leaves Add usable', JSON.stringify(sw));
  chk(/Connected/.test(sw.grok) && sw.grokDisabled, 'a key that landed after the switch still shows its row as Connected', JSON.stringify(sw));

  // A normal Add for Gemini, with the provider's answer "unknown": saved, but not claimed connected.
  const unk = await q(async () => {
    window.__unknown = true;
    document.getElementById('fr-apikey-key').value = '  AIza-secret  ';
    document.getElementById('fr-apikey-go').click();
    for (let i = 0; i < 50 && !/saved|connected/.test(document.getElementById('fr-apikey-msg').textContent); i++) await new Promise((r) => setTimeout(r, 20));
    window.__unknown = false;
    const b = document.getElementById('fr-gemini-connect');
    return { last: window.__posts[window.__posts.length - 1], msg: document.getElementById('fr-apikey-msg').textContent,
      boxHidden: document.getElementById('fr-apikey-flow').hidden, btn: b.textContent.trim(), disabled: b.disabled, expanded: b.getAttribute('aria-expanded'),
      focused: document.activeElement && document.activeElement.id };
  });
  chk(unk.last && unk.last.route === 'gemini' && unk.last.body.key === 'AIza-secret', 'Add POSTs the trimmed key to the Gemini route', JSON.stringify(unk.last));
  chk(unk.boxHidden && /key is saved/.test(unk.msg) && unk.btn === 'Key saved' && unk.disabled, 'an unconfirmed key is said to be saved, not connected, and Connect is not offered again (no duplicate)', JSON.stringify(unk));
  chk(unk.expanded === 'false' && unk.focused === 'fr-apikey-msg', 'after Add the button is no longer expanded and focus lands on the result', JSON.stringify(unk));
  // Reset: forget the unconfirmed Gemini account so the arms below start from Connect.
  await q(async () => {
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'google');
    await frPaintKeyed();
  });

  // Away and back: a Gemini Add lands after the person closed the box and reopened it (Grok is
  // already connected by now, so its disabled Connect cannot be the way away).
  // The reopened box must close (a second Add would make a second account) and the row show Connected.
  const back = await q(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('fr-gemini-connect').click(); await wait(120);
    document.getElementById('fr-apikey-key').value = 'AIza-away-and-back';
    let release; window.__hold = new Promise((r) => { release = r; });
    document.getElementById('fr-apikey-go').click(); await wait(30);
    document.getElementById('fr-gemini-connect').click(); await wait(120);   // away: closes the box
    document.getElementById('fr-gemini-connect').click(); await wait(120);   // back: reopens it
    const reopened = !document.getElementById('fr-apikey-flow').hidden;
    release(); window.__hold = null; await wait(200);
    const b = document.getElementById('fr-gemini-connect');
    return { reopened, boxHidden: document.getElementById('fr-apikey-flow').hidden, btn: b.textContent.trim(),
      msg: document.getElementById('fr-apikey-msg').textContent };
  });
  chk(back.reopened && back.boxHidden && /Connected/.test(back.btn) && back.msg === 'Gemini is connected.',
    'an Add that lands after switching away and back closes the reopened box and shows Connected', JSON.stringify(back));

  // Enter adds the key and does not bubble; the aria-label follows the state; closing mid-Add clears the message.
  const more = await q(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__accounts = window.__accounts.filter((a) => a.provider !== 'google');
    await frPaintKeyed();
    const labelBefore = document.getElementById('fr-gemini-connect').getAttribute('aria-label');
    document.getElementById('fr-gemini-connect').click(); await wait(120);
    let bubbled = false;
    const spy = () => { bubbled = true; };
    document.addEventListener('keydown', spy);
    let release; window.__hold = new Promise((r) => { release = r; });
    window.__posts.length = 0;
    const key = document.getElementById('fr-apikey-key');
    key.value = 'AIza-enter';
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(30);
    document.removeEventListener('keydown', spy);
    const posted = window.__posts.length;
    document.getElementById('fr-gemini-connect').click(); await wait(60);   // close while the Add is pending
    const msgAfterClose = document.getElementById('fr-apikey-msg').textContent;
    release(); window.__hold = null; await wait(200);
    return { labelBefore, posted, bubbled, msgAfterClose,
      msgEnd: document.getElementById('fr-apikey-msg').textContent,
      labelAfter: document.getElementById('fr-gemini-connect').getAttribute('aria-label') };
  });
  chk(more.posted === 1 && more.bubbled === false, 'Enter in the key field adds the key and does not reach the step', JSON.stringify(more));
  chk(more.msgAfterClose === '' && !/Checking/.test(more.msgEnd), 'closing the box mid-Add clears the message and "Checking..." never comes back', JSON.stringify(more));
  chk(more.labelBefore === 'Connect Gemini' && more.labelAfter === 'Gemini is connected', 'the button\'s accessible name follows the state', JSON.stringify(more));

  // Entering the step paints a row whose account already connected.
  const entry = await q(async () => {
    window.__accounts.push({ provider: 'google', connection: { state: 'connected' } });
    frGo(5);
    await new Promise((r) => setTimeout(r, 150));
    const b = document.getElementById('fr-gemini-connect');
    return { btn: b.textContent.trim(), disabled: b.disabled };
  });
  chk(/Connected/.test(entry.btn) && entry.disabled, 'entering the step shows an already-connected Gemini as Connected', JSON.stringify(entry));
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

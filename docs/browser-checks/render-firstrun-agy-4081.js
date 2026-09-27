// Browser-check-surface: fr-gemini-sub-paste-row fr-gemini-sub-paste fr-gemini-sub-paste-go fr-gemini-sub-page fr-gemini-sub-show-row fr-gemini-sub-cancel
'use strict';
/**
 * kosmos#4081 (a #3998 follow-up): first run's Gemini subscription step, in a real browser. The
 * Settings step has its own check (render-settings-agy-3874); this one is the same driver in first
 * run's "Choose a model", which until now only had DOM-stub unit tests (web.agy-on-3568.test.js).
 * HERMETIC: the real page from file://, with fetch answered in the page (engine/agysignin.js and
 * engine/agystatus.js stood in for). Asserts:
 *   - Connect on Gemini offers the choice; Sign in with Subscription checks, then offers Sign in with Google;
 *   - that press starts the hidden sign-in and shows the paste box with focus in it, and the link back
 *     to Google's page; no window button yet;
 *   - a sign-in Kosmos cannot read on its own ("stuck") offers Show the sign-in window, and hides the box;
 *   - Stop this sign-in stops it on the board and goes back to the choice;
 *   - a pasted code goes to the board with the sign-in's id, and the step ends on Ready.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-firstrun-agy-4081.js [shots-dir]
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-firstrun-agy-4081: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const ID = 'a1b2c3d4e5f60718';
const URL_G = 'https://accounts.google.com/o/oauth2/auth?x=1';
const CODE = '4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v';
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-firstrun-agy-4081: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    process.exit(1);
  }
  const SHOTS = process.argv[2] || null;
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript(({ id }) => {
    window.__posts = [];
    window.__check = [{ installed: true, signedIn: null }];
    window.__signin = [{ state: 'starting' }];
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      const post = opts && opts.method === 'POST';
      if (/\/api\/antigravity\/signin(\/(code|show|stop))?$/.test(u)) {
        const which = u.endsWith('/signin') ? 'signin' : u.split('/').pop();
        if (!post) return enc({ id, ...(window.__signin.length > 1 ? window.__signin.shift() : window.__signin[0]) });
        window.__posts.push(which);
        if (which === 'code') { const b = JSON.parse(opts.body || '{}'); window.__codeSent = b.code; window.__codeId = b.id; }
        return enc({ ok: true, id, state: which === 'signin' ? 'starting' : 'checking' });
      }
      if (/\/api\/antigravity\/(check|install)$/.test(u) && post) {
        const which = u.split('/').pop();
        window.__posts.push(which);
        if (which === 'check') return enc(window.__check.length > 1 ? window.__check.shift() : window.__check[0]);
        return enc({ ok: true, installed: true });
      }
      if (/\/api\/antigravity(\?|$)/.test(u)) return enc({ enabled: true, supported: true, installed: true });
      if (/\/api\/runners(\?|$)/.test(u)) return enc({ runners: { gemini: { present: true, job: null }, grok: { present: true } } });
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: [] });
      return enc({});
    };
  }, { id: ID });
  await page.goto(PAGE);
  const q = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => q((t) => new Promise((r) => setTimeout(r, t)), ms);
  // The Gemini step while it shows, else the whole model step (after Ready the step is hidden).
  const shot = async (name) => {
    if (!SHOTS) return;
    const step = page.locator('#fr-gemini-sub-step:not([hidden]), #fr-gemini-pick:not([hidden])');
    const target = (await step.count()) ? step.first() : page.locator('#fr-pane-5');
    await target.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 5000 });
  };
  const look = () => q(() => {
    const v = (id) => { const e = document.getElementById(id); return !!e && !e.hidden; };
    const go = document.getElementById('fr-gemini-sub-go');
    return {
      pick: v('fr-gemini-pick'), step: v('fr-gemini-sub-step'), paste: v('fr-gemini-sub-paste-row'), show: v('fr-gemini-sub-show-row'),
      stop: v('fr-gemini-sub-cancel-row'), button: go && !go.hidden ? go.textContent : '',
      text: document.getElementById('fr-gemini-sub-code').textContent, page: document.getElementById('fr-gemini-sub-page').getAttribute('href'),
      focus: document.activeElement && document.activeElement.id, posts: window.__posts.slice(),
    };
  });

  await q(() => { const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false; frGo(5); });
  await wait(200);
  await q(() => document.getElementById('fr-gemini-connect').click());
  await wait(300);
  const a = await look();
  chk(a.pick && !a.step, 'Connect on Gemini offers the choice (subscription or key)', JSON.stringify(a));

  await q(() => document.getElementById('fr-gemini-pick-sub').click());
  await wait(400);
  const b = await look();
  chk(b.step && b.posts.includes('check') && b.button === 'Sign in with Google' && !b.paste,
    'Sign in with Subscription checks Antigravity, then offers Sign in with Google (no box yet)', JSON.stringify(b));

  await q((u) => { window.__signin = [{ state: 'code', url: u }]; document.getElementById('fr-gemini-sub-go').click(); }, URL_G);
  await wait(1500);
  const c = await look();
  chk(c.posts.includes('signin') && c.paste && !c.show && c.focus === 'fr-gemini-sub-paste' && c.page === URL_G
      && /paste it below/.test(c.text),
    'Sign in with Google starts the hidden sign-in: the paste box shows with focus in it, and the link back to Google\'s page', JSON.stringify(c));
  const box = await q(() => { const r = document.getElementById('fr-gemini-sub-paste').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  chk(box.w > 120 && box.h > 20, 'the paste box is drawn at a usable size', JSON.stringify(box));
  await shot('firstrun-gemini-paste-4081');

  await q(() => { window.__signin = [{ state: 'stuck', because: 'Antigravity is showing a step Kosmos does not recognise' }]; });
  await wait(1500);
  const d = await look();
  chk(d.show && !d.paste && d.stop && /Show the sign-in window/.test(d.text),
    'a step Kosmos cannot read offers Show the sign-in window, and hides the box', JSON.stringify(d));
  await shot('firstrun-gemini-stuck-4081');

  await q(() => document.getElementById('fr-gemini-sub-cancel').click());
  await wait(400);
  const e = await look();
  chk(e.posts.includes('stop') && e.pick && !e.step, 'Stop this sign-in stops it on the board and goes back to the choice', JSON.stringify(e));

  // Again, to the end: a pasted code goes to the board with the sign-in's id, and the step says Ready.
  await q(() => { window.__posts.length = 0; window.__check = [{ installed: true, signedIn: null }]; document.getElementById('fr-gemini-pick-sub').click(); });
  await wait(400);
  await q((u) => { window.__signin = [{ state: 'code', url: u }]; document.getElementById('fr-gemini-sub-go').click(); }, URL_G);
  await wait(1500);
  await q((code) => { document.getElementById('fr-gemini-sub-paste').value = code; window.__signin = [{ state: 'setup', step: 'terms' }, { state: 'done' }]; document.getElementById('fr-gemini-sub-paste-go').click(); }, CODE);
  await wait(2800);
  const f = await look();
  const sent = await q(() => ({ code: window.__codeSent, id: window.__codeId }));
  chk(sent.code === CODE && sent.id === ID && /^Ready\./.test(f.text) && !f.paste && !f.stop,
    'the pasted code goes to the board with the sign-in\'s id, and the step ends on Ready', JSON.stringify({ sent, f }));
  await shot('firstrun-gemini-ready-4081');

  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await browser.close();
  if (fail.length) { for (const x of fail) console.error('  FAIL  ' + x); process.exit(1); }
  console.log('render-firstrun-agy-4081: all passed');
})().catch((err) => { console.error('FAIL  render-firstrun-agy-4081: the check itself threw: ' + (err && err.stack || err)); process.exit(1); });

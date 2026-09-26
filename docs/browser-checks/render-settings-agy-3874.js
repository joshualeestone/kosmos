// Browser-check-surface: acct-gemini-flow acct-gemini-pick acct-gemini-sub-step acct-keyed-install
'use strict';
/**
 * kosmos#3874: Settings, AI Models, Add a provider offers Gemini on a Google subscription, as the
 * first-run Gemini row does. HERMETIC (file://, fetch stubbed; Antigravity's routes answer from a
 * script). Asserts:
 *   - where it is offered, picking Google Gemini shows the choice (Sign in with Subscription / Use an
 *     API key) first, with no key box and no download showing, and focus on the first choice;
 *   - "Use an API key" with the Gemini CLI missing goes to its download step;
 *   - switching provider and back returns to the choice (nothing left over);
 *   - "Sign in with Subscription" walks not installed -> Install Antigravity -> Open -> Check again
 *     -> Ready, in the dialog, each press posting only its own route;
 *   - Stop partway returns to the choice;
 *   - control: where it is NOT offered, the choice never shows and Gemini goes to its download.
 * SHOT_DIR=<dir> saves screenshots of the choice and of Ready.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-settings-agy-3874.js
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-settings-agy-3874: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

async function openPage(browser, offered) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript((isOffered) => {
    window.__posts = [];
    window.__check = [{ installed: false, signedIn: false }];
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      const post = opts && opts.method === 'POST';
      if (/\/api\/antigravity\/(check|install|open)$/.test(u) && post) {
        const which = u.split('/').pop();
        window.__posts.push(which);
        if (which === 'check') return enc(window.__check.length > 1 ? window.__check.shift() : window.__check[0]);
        return enc({ ok: true, installed: true });
      }
      if (/\/api\/antigravity(\?|$)/.test(u)) return enc({ enabled: true, supported: isOffered, installed: false });
      if (/\/api\/runners(\?|$)/.test(u)) return enc({ runners: { gemini: { present: false, downloadBytes: 20772697, job: null }, grok: { present: true } } });
      if (/\/api\/accounts(\?|$)/.test(u)) return enc({ accounts: [] });
      return enc({});
    };
  }, offered);
  await page.goto(PAGE);
  return { page, errs, q: (fn, arg) => page.evaluate(fn, arg) };
}
const settle = () => new Promise((r) => setTimeout(r, 300));
const view = () => ({
  flow: !document.getElementById('acct-gemini-flow').hidden,
  pick: !document.getElementById('acct-gemini-pick').hidden,
  sub: !document.getElementById('acct-gemini-sub-step').hidden,
  key: !document.getElementById('acct-apikey-flow').hidden,
  install: !document.getElementById('acct-keyed-install').hidden,
  text: document.getElementById('acct-gemini-sub-code').textContent,
  button: document.getElementById('acct-gemini-sub-go').hidden ? '' : document.getElementById('acct-gemini-sub-go').textContent,
  stop: !document.getElementById('acct-gemini-sub-cancel-row').hidden,
  focus: document.activeElement && document.activeElement.id,
  posts: window.__posts.slice(),
});

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-settings-agy-3874: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    process.exit(1);
  }
  const shots = process.env.SHOT_DIR;
  const { page, errs, q } = await openPage(browser, true);
  const V = `(${view})()`;
  const look = () => q(V);
  const open = async (which) => { await q((w) => { if (w === 'open') openAcctAdd(); else acctPick(w); }, which); await q(settle); };

  await q(() => { frClose(); });   // first run is up on a fresh page and makes the rest inert (as render-keyed-install-3713)
  await open('open');
  await open('google');
  const a = await look();
  chk(a.flow && a.pick && !a.sub && !a.key && !a.install && a.focus === 'acct-gemini-pick-sub',
    'offered: Google Gemini shows the choice first, no key box and no download, focus on Sign in with Subscription', JSON.stringify(a));
  const labels = await q(() => [document.getElementById('acct-gemini-pick-sub').textContent, document.getElementById('acct-gemini-pick-key').textContent]);
  chk(labels[0] === 'Sign in with Subscription' && labels[1] === 'Use an API key', 'the choice reads as Grok\'s and first run\'s', JSON.stringify(labels));
  if (shots) await page.locator('#acct-add-dialog').screenshot({ path: path.join(shots, 'settings-gemini-choice-3874.png') });

  await q(() => document.getElementById('acct-gemini-pick-key').click());
  await q(settle);
  const b = await look();
  chk(!b.flow && b.install && !b.key, 'Use an API key with the Gemini CLI missing goes to its download', JSON.stringify(b));

  await open('xai');
  await open('google');
  const c = await look();
  chk(c.flow && c.pick && !c.install && !c.key, 'switching provider and back returns to the choice, nothing left over', JSON.stringify(c));

  await q(() => { window.__check = [{ installed: false, signedIn: false }, { installed: true, signedIn: true }]; document.getElementById('acct-gemini-pick-sub').click(); });
  await q(settle);
  const d1 = await look();
  chk(d1.sub && !d1.pick && /not on this computer yet/.test(d1.text) && d1.button === 'Install Antigravity' && d1.stop && d1.posts.join() === 'check',
    'Sign in with Subscription checks at once and offers Install Antigravity, with Stop', JSON.stringify(d1));
  await q(() => document.getElementById('acct-gemini-sub-go').click());
  await q(settle);
  const d2 = await look();
  chk(d2.button === 'Open Antigravity to sign in' && d2.posts.join() === 'check,install', 'Install runs, then offers Open (no check spent)', JSON.stringify(d2));
  await q(() => document.getElementById('acct-gemini-sub-go').click());
  await q(settle);
  const d3 = await look();
  chk(d3.button === 'Check again' && /opens Google's sign-in in your browser/.test(d3.text) && d3.posts.join() === 'check,install,open', 'Open runs on its own press, then offers Check again', JSON.stringify(d3));
  await q(() => document.getElementById('acct-gemini-sub-go').click());
  await q(settle);
  const d4 = await look();
  chk(/^Ready\. Gemini runs on your Google subscription/.test(d4.text) && d4.button === '' && !d4.stop, 'Check again reaches Ready in the dialog, with no Stop', JSON.stringify(d4));
  if (shots) await page.locator('#acct-add-dialog').screenshot({ path: path.join(shots, 'settings-gemini-ready-3874.png') });

  await open('xai');
  await open('google');
  await q(() => { window.__check = [{ installed: false, signedIn: false }]; document.getElementById('acct-gemini-pick-sub').click(); });
  await q(settle);
  await q(() => document.getElementById('acct-gemini-sub-cancel').click());
  const e = await look();
  chk(e.pick && !e.sub && e.focus === 'acct-gemini-pick-sub' && e.button === 'Sign in with Google', 'Stop partway returns to the choice, the step\'s button reset', JSON.stringify(e));
  chk(errs.length === 0, 'no page errors (offered)', errs.join(' | '));
  await page.close();

  // CONTROL: not offered (not a Mac, or switched off): no choice, today's path.
  const n = await openPage(browser, false);
  await n.q(() => { frClose(); openAcctAdd(); }); await n.q(settle);
  await n.q(() => acctPick('google')); await n.q(settle);
  const f = await n.q(V);
  chk(!f.flow && f.install, 'control: not offered, Gemini goes straight to its download, no choice', JSON.stringify(f));
  chk(n.errs.length === 0, 'no page errors (not offered)', n.errs.join(' | '));
  await browser.close();
  if (fail.length) { for (const x of fail) console.error('  FAIL  ' + x); process.exit(1); }
  console.log('render-settings-agy-3874: all passed');
})().catch((err) => { console.error('FAIL  render-settings-agy-3874: the check itself threw: ' + (err && err.stack || err)); process.exit(1); });

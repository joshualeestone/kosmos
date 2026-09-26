// Browser-check-surface: acct-gemini-flow acct-gemini-pick acct-gemini-sub-step acct-keyed-install
'use strict';
/**
 * kosmos#3874: Settings, AI Models, Add a provider offers Gemini on a Google subscription, as the
 * first-run Gemini row does. HERMETIC (file://, fetch stubbed; Antigravity's routes answer from a
 * script). Asserts:
 *   - where it is offered, picking Google Gemini shows the choice (Sign in with Google / Use an
 *     API key) first, with no key box and no download showing, and focus on the first choice;
 *   - "Use an API key" with the Gemini CLI missing goes to its download step;
 *   - switching provider and back returns to the choice (nothing left over);
 *   - "Sign in with Google" walks not installed -> Install Antigravity -> Sign in with Google (the
 *     hidden sign-in, #3998) -> the code pasted in the dialog -> the gold connected box
 *     -> Ready, in the dialog, each press posting only its own route;
 *   - Stop partway returns to the choice;
 *   - a slow availability read answering after the dialog closed, or after a switch to Grok, paints
 *     no Gemini choice (the visit re-check after agyAsk), and the same read on an open dialog does;
 *   - a keyboard press on the step's button keeps focus in the dialog (on Stop) while it hides;
 *   - at a 320px viewport the "Google Gemini (Google subscription)" row keeps its mark and name on one line;
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
    window.__signin = [{ state: 'starting' }];   // #3998: what GET /api/antigravity/signin answers, in turn
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      const post = opts && opts.method === 'POST';
      // #3998: the hidden sign-in's addresses (engine/agysignin.js stood in for).
      if (/\/api\/antigravity\/signin(\/(code|show|stop))?$/.test(u)) {
        const which = u.endsWith('/signin') ? 'signin' : u.split('/').pop();
        const ID = 'a1b2c3d4e5f60718';   // the sign-in start() names; every state read carries it
        if (!post) return enc({ id: ID, ...(window.__signin.length > 1 ? window.__signin.shift() : window.__signin[0]) });
        window.__posts.push(which);
        if (which === 'code') { const b = JSON.parse(opts.body || '{}'); window.__codeSent = b.code; window.__codeId = b.id; }
        return enc({ ok: true, id: ID, state: which === 'signin' ? 'starting' : 'checking' });
      }
      if (/\/api\/antigravity\/(check|install)$/.test(u) && post) {
        const which = u.split('/').pop();
        window.__posts.push(which);
        if (which === 'check') return enc(window.__check.length > 1 ? window.__check.shift() : window.__check[0]);
        return enc({ ok: true, installed: true });
      }
      if (/\/api\/antigravity(\?|$)/.test(u)) {
        if (window.__agyHold) await window.__agyHold;   // a slow availability read, released by the check
        return enc({ enabled: true, supported: isOffered, installed: false });
      }
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
    'offered: Google Gemini shows the choice first, no key box and no download, focus on Sign in with Google', JSON.stringify(a));
  const labels = await q(() => [document.getElementById('acct-gemini-pick-sub').textContent, document.getElementById('acct-gemini-pick-key').textContent]);
  chk(labels[0] === 'Sign in with Google' && labels[1] === 'Use an API key', 'the choice names the provider, as Settings\' Grok and ChatGPT do', JSON.stringify(labels));
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
    'Sign in with Google checks at once and offers Install Antigravity, with Stop', JSON.stringify(d1));
  await q(() => { const g = document.getElementById('acct-gemini-sub-go'); g.focus(); g.click(); });
  await q(settle);
  const d2 = await look();
  chk(d2.focus === 'acct-gemini-sub-cancel' || d2.focus === 'acct-gemini-sub-go', 'a keyboard press keeps focus inside the dialog while the button it pressed hides', JSON.stringify({ focus: d2.focus }));
  chk(d2.button === 'Sign in with Google' && d2.posts.join() === 'check,install', 'Install runs, then offers Sign in with Google (no check spent)', JSON.stringify(d2));
  /* #3998: no Terminal. The press starts the hidden sign-in; the step shows a paste box for the code
     Google's page shows, with a way back to Google's page. */
  await q(() => { window.__signin = [{ state: 'code', url: 'https://accounts.google.com/o/oauth2/auth?x=1' }]; document.getElementById('acct-gemini-sub-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 1500)));
  const d3 = await q(() => ({
    posts: window.__posts.slice(), text: document.getElementById('acct-gemini-sub-code').textContent,
    paste: !document.getElementById('acct-gemini-sub-paste-row').hidden,
    page: document.getElementById('acct-gemini-sub-page').getAttribute('href'),
    focus: document.activeElement && document.activeElement.id,
  }));
  chk(d3.posts.join() === 'check,install,signin' && d3.paste && /copy the code Google shows and paste it below/.test(d3.text)
      && d3.page === 'https://accounts.google.com/o/oauth2/auth?x=1' && d3.focus === 'acct-gemini-sub-paste',
    '#3998 Sign in with Google starts the hidden sign-in and asks for Google\'s code in the dialog, focus in the box', JSON.stringify(d3));
  if (shots) await page.locator('#acct-add-dialog').screenshot({ path: path.join(shots, 'settings-gemini-paste-3998.png') });
  await q(() => { document.getElementById('acct-gemini-sub-paste').value = '4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v'; window.__signin = [{ state: 'setup', step: 'terms' }, { state: 'done' }]; document.getElementById('acct-gemini-sub-paste-go').click(); });
  await q(() => new Promise((r) => setTimeout(r, 2800)));
  const d4 = await q(() => ({
    code: window.__codeSent, codeId: window.__codeId, box: !document.getElementById('acct-success-box').hidden,
    boxText: document.getElementById('acct-success-box').textContent.replace(/\s+/g, ' ').trim(),
    flow: !document.getElementById('acct-gemini-flow').hidden,
  }));
  chk(d4.code === '4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v' && d4.codeId === 'a1b2c3d4e5f60718' && d4.box && /Gemini is connected/.test(d4.boxText) && !d4.flow,
    '#3998 the pasted code goes to the board, and the dialog ends on the gold connected box, like GPT and Grok', JSON.stringify(d4));
  if (shots) await page.locator('#acct-add-dialog').screenshot({ path: path.join(shots, 'settings-gemini-connected-3998.png') });
  await q(() => { closeAcctAdd(); });
  await open('open');

  await open('xai');
  await open('google');
  await q(() => { window.__check = [{ installed: false, signedIn: false }]; document.getElementById('acct-gemini-pick-sub').click(); });
  await q(settle);
  await q(() => document.getElementById('acct-gemini-sub-cancel').click());
  const e = await look();
  chk(e.pick && !e.sub && e.focus === 'acct-gemini-pick-sub' && e.button === 'Sign in with Google', 'Stop partway returns to the choice, the step\'s button reset', JSON.stringify(e));
  chk(errs.length === 0, 'no page errors (offered)', errs.join(' | '));
  await page.close();

  // A slow availability read: closed, then switched, mid-read. Each on a fresh page (agyAsk settles once).
  for (const leave of ['close', 'switch', 'stay']) {
    const s = await openPage(browser, true);
    const r = await s.q(async (how) => {
      let release; window.__agyHold = new Promise((ok) => { release = ok; });
      frClose(); openAcctAdd(); acctPick('google');
      await new Promise((ok) => setTimeout(ok, 200));
      if (how === 'close') closeAcctAdd(); else if (how === 'switch') acctPick('xai');
      release();
      await new Promise((ok) => setTimeout(ok, 300));
      return { flow: !document.getElementById('acct-gemini-flow').hidden, grok: !document.getElementById('acct-grok-flow').hidden,
        modal: !document.getElementById('acct-add-modal').hidden };
    }, leave);
    if (leave === 'stay') chk(r.flow && r.modal, 'control: the same slow read on an open dialog does paint the choice', JSON.stringify(r));
    else chk(!r.flow, 'a slow availability read answering after a ' + leave + ' paints no Gemini choice', JSON.stringify(r));
    chk(s.errs.length === 0, 'no page errors (slow read, ' + leave + ')', s.errs.join(' | '));
    await s.page.close();
  }

  // A narrow screen: the long name stays on its mark's line (it shrinks with an ellipsis), only the
  // pill wraps. Measured 360px down to 240px: the list holds at 288px and the name shrinks in place.
  {
    const s = await openPage(browser, true);
    await s.page.setViewportSize({ width: 320, height: 700 });
    await s.q(settle);
    const g = await s.q(() => {
      const select = document.getElementById('create-provider');
      const wrap = select && select.parentNode.querySelector('.pcombo');
      if (!wrap) return { fatal: 'no .pcombo on #create-provider' };
      for (let p = select; p && p !== document.body; p = p.parentNode) {
        if (p.hasAttribute && p.hasAttribute('hidden')) p.hidden = false;
        if (p.style && p.style.display === 'none') p.style.display = '';
      }
      wrap.querySelector('.pcombo-trigger').click();
      const li = wrap.querySelector('.pcombo-opt[data-value="antigravity"]');
      if (!li || li.offsetParent === null) return { fatal: 'the antigravity row is not showing' };
      const m = li.querySelector('.pcombo-mark').getBoundingClientRect();
      const n = li.querySelector('.pcombo-name').getBoundingClientRect();
      return { sameLine: Math.abs((m.top + m.height / 2) - (n.top + n.height / 2)) < 6, mark: Math.round(m.top), name: Math.round(n.top) };
    });
    chk(!g.fatal && g.sameLine, 'at 320px the Gemini (Google subscription) row keeps its mark and name on one line', JSON.stringify(g));
    await s.page.close();
  }

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

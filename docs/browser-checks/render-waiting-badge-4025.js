// Browser-check-surface: wb-row wb-toggle wb-msg
'use strict';
/**
 * kosmos#4025: Settings > Computer > App icon, the switch for the waiting count on the Kosmos
 * icon (the #3996 Dock badge; the box is hidden on Windows until a taskbar count ships). HERMETIC: the real page from
 * file://, with fetch answered in the page. What the node test (web.waiting-badge-4025.test.js)
 * cannot see: that the row draws beside Sounds, the switch paints its position only once the board's
 * setting is read, a click flips the drawn and accessible state from the board's answer, and a failed
 * read leaves no switch but a sentence.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-waiting-badge-4025.js
 *   (HEADED by default; HEADED=0 on a console-less machine. SHOT_DIR=<dir> saves the row.)
 */
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-waiting-badge-4025: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

async function openPage(browser, readOk) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  await page.addInitScript((ok) => {
    window.__posts = [];
    window.__stored = true;
    const enc = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (/\/api\/settings(\?|$)/.test(u)) {
        if (opts && opts.method === 'POST') {
          const body = JSON.parse(opts.body);
          window.__posts.push(body);
          window.__stored = body.waitingBadge;
          return enc({ ok: true, waitingBadge: window.__stored });
        }
        return ok ? enc({ timezone: null, waitingBadge: window.__stored }) : enc({ error: 'no' }, 500);
      }
      return enc({});
    };
  }, readOk);
  await page.goto(PAGE);
  return { page, errs, q: (fn, arg) => page.evaluate(fn, arg) };
}
const settle = () => new Promise((r) => setTimeout(r, 200));
const look = () => {
  const t = document.getElementById('wb-toggle');
  const b = t.getBoundingClientRect();
  return { hidden: t.hidden, drawn: b.width > 0 && b.height > 0, aria: t.getAttribute('aria-checked'), on: t.classList.contains('on'),
    msg: document.getElementById('wb-msg').textContent, posts: window.__posts.slice() };
};
const reveal = () => {
  for (const id of ['s-sec-mac']) {
    const sec = document.getElementById(id);
    if (sec) sec.hidden = false;
    for (let n = sec; n; n = n.parentElement) { if (n.hidden) n.hidden = false; if (getComputedStyle(n).display === 'none') n.style.display = 'block'; }
  }
};

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-waiting-badge-4025: could not start a browser' + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    process.exit(1);
  }
  const shots = process.env.SHOT_DIR;
  const L = `(${look})()`;
  const { page, errs, q } = await openPage(browser, true);
  await q(() => { if (typeof frClose === 'function') frClose(); });
  await q(reveal);
  const before = await q(L);
  chk(before.hidden && before.aria === null, 'before the setting is read the switch is hidden and claims no position', JSON.stringify(before));
  await q(() => paintWaitingBadge()); await q(settle);
  const a = await q(L);
  chk(!a.hidden && a.drawn && a.aria === 'true' && a.on, 'read from the board: the switch draws On (the default)', JSON.stringify(a));
  const copy = await q(() => ({ label: document.querySelector('#wb-row b').textContent, name: document.getElementById('wb-toggle').getAttribute('aria-label') }));
  chk(copy.name.includes(copy.label), 'the accessible name contains the visible label (WCAG 2.5.3)', JSON.stringify(copy));
  if (shots) await page.locator('#wb-row').screenshot({ path: path.join(shots, 'settings-app-icon-on-4025.png') });
  await q(() => document.getElementById('wb-toggle').click()); await q(settle);
  const b = await q(L);
  chk(b.aria === 'false' && !b.on && JSON.stringify(b.posts) === '[{"waitingBadge":false}]', 'a click saves Off and draws what the board stored', JSON.stringify(b));
  if (shots) await page.locator('#wb-row').screenshot({ path: path.join(shots, 'settings-app-icon-off-4025.png') });
  await q(() => document.getElementById('wb-toggle').click()); await q(settle);
  const c = await q(L);
  chk(c.aria === 'true' && c.on && c.posts.length === 2, 'a second click saves On again', JSON.stringify(c));
  chk(errs.length === 0, 'no page errors', errs.join(' | '));
  await page.close();

  // CONTROL: a board that cannot answer: no switch, a sentence, never a false Off.
  const n = await openPage(browser, false);
  await n.q(() => { if (typeof frClose === 'function') frClose(); });
  await n.q(reveal);
  await n.q(() => paintWaitingBadge()); await n.q(settle);
  const d = await n.q(L);
  chk(d.hidden && d.aria === null && /could not read/.test(d.msg), 'control: a failed read leaves no switch and says so', JSON.stringify(d));
  chk(n.errs.length === 0, 'no page errors (failed read)', n.errs.join(' | '));
  await browser.close();
  if (fail.length) { for (const x of fail) console.error('  FAIL  ' + x); process.exit(1); }
  console.log('render-waiting-badge-4025: all passed');
})().catch((err) => { console.error('FAIL  render-waiting-badge-4025: the check itself threw: ' + (err && err.stack || err)); process.exit(1); });

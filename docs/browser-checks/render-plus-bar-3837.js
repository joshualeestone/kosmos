// Browser-check-surface: kplus-bar kplus-logout kplus-bar-msg apphead
'use strict';

/**
 * The Kosmos+ remote bar (#3837 F, Josh 2026-09-25 17:21-17:22): viewed through a Kosmos+ address, a thin Kosmos+ bar
 * sits above the board, "a tiny KOSMOS+ logo on the left, and a Log Out on the far right with a blue background".
 *
 * Harness: the real board, reached two ways. Through 127.0.0.1 it is the Mac's own window (no bar: the CONTROL), and
 * through remote.test, which Chromium maps to the same loopback address and the board is told to accept
 * (AGENT_WORKFORCE_ALLOWED_HOSTS, its deliberate opt-in), it is what a Kosmos+ address shows. The tunnel's own
 * /_kosmos/logout is answered here (the tunnel is kosmos-relay's; its route has its own test there, door.rs 6b).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-plus-bar-3837.js [shots-dir]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kpb-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_ALLOWED_HOSTS = 'remote.test';   // read when server.js loads, so set before it

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const SHOTS = process.argv[2] || null;
const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
const bar = (page) => page.evaluate(() => {
  const b = document.getElementById('kplus-bar');
  if (!b) return { present: false };
  const r = b.getBoundingClientRect(), head = document.querySelector('.apphead'), cv = b.querySelector('canvas'), out = document.getElementById('kplus-logout');
  let inked = 0;
  try { const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) inked++; } catch { inked = -1; }
  const ob = out.getBoundingClientRect(), cb = cv.getBoundingClientRect();
  return { present: true, first: head && head.firstElementChild === b, top: Math.round(r.top), left: Math.round(r.left), right: Math.round(document.documentElement.clientWidth - r.right),
    h: Math.round(r.height), inked, markLeft: Math.round(cb.left - r.left), markH: Math.round(cb.height), outRightGap: Math.round(r.right - ob.right), outText: out.textContent,
    outBg: getComputedStyle(out).backgroundImage, bg: getComputedStyle(b).backgroundColor, label: b.getAttribute('aria-label') };
});

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', args: ['--host-resolver-rules=MAP remote.test 127.0.0.1'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const settle = async () => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };

    // P1 CONTROL: the Mac's own window (loopback) has no bar.
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle' });
    await settle();
    chk(!(await bar(page)).present, 'P1 CONTROL: on the Mac itself (127.0.0.1) there is no Kosmos+ bar');

    // P2: through a Kosmos+ address, the bar is the header's first row, edge to edge at the very top, the mark drawn
    // on its left and a blue Log out on its right.
    await page.goto('http://remote.test:' + port + '/', { waitUntil: 'networkidle' });
    await settle();
    chk(await page.evaluate(() => location.hostname === 'remote.test' && !!document.querySelector('#grid, .apphead')), 'P2 precondition: the real board answered through remote.test');
    const b2 = await bar(page);
    chk(b2.present && b2.first && b2.top === 0 && b2.left === 0 && b2.right === 0, 'P2 through a Kosmos+ address the bar is the header\'s first row, edge to edge at the top', JSON.stringify(b2));
    chk(b2.inked > 200 && b2.markLeft > 0 && b2.markLeft < 48 && b2.markH === 14, 'P2 the tiny KOSMOS+ mark is drawn on its left (the real dots)', JSON.stringify({ inked: b2.inked, markLeft: b2.markLeft, markH: b2.markH }));
    chk(b2.outText === 'Log out' && /gradient/.test(b2.outBg) && b2.outRightGap > 0 && b2.outRightGap < 48 && b2.h <= 44, 'P2 a blue Log out on the far right, and the bar is thin', JSON.stringify({ outText: b2.outText, outBg: b2.outBg.slice(0, 40), outRightGap: b2.outRightGap, h: b2.h }));
    chk(b2.bg === 'rgb(23, 35, 61)' && b2.label === 'Kosmos+', 'P2 on the Kosmos+ navy, named Kosmos+ for a screen reader', JSON.stringify({ bg: b2.bg, label: b2.label }));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'plus-bar-tabs.png'), clip: { x: 0, y: 0, width: 1280, height: 200 } }); }
    // The sticky header keeps it: scrolled, the bar is still at the top.
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(200);
    const scrolled = await bar(page);
    chk(scrolled.present && scrolled.top === 0, 'P2 scrolled, the bar stays at the top with the header', JSON.stringify({ top: scrolled.top }));
    await page.evaluate(() => window.scrollTo(0, 0));

    // P3: Log out that the tunnel refuses (here, a 403): it says so, the button works again, and the page stays.
    let asked = 0, answer = 403;
    await page.route('**/_kosmos/logout', (route) => { asked++; route.fulfill({ status: answer, contentType: 'application/json', body: answer === 200 ? '{"ok":true}' : '{"because":"no"}' }); });
    await page.click('#kplus-logout');
    await page.waitForFunction(() => document.getElementById('kplus-bar-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    const p3 = await page.evaluate(() => ({ msg: document.getElementById('kplus-bar-msg').textContent, dis: document.getElementById('kplus-logout').disabled, bar: !!document.getElementById('kplus-bar') }));
    chk(asked === 1 && p3.msg === 'Could not log out just now. Try again.' && !p3.dis && p3.bar, 'P3 a refused log out says so and leaves the page as it was', JSON.stringify({ asked, p3 }));

    // P4: Log out that works: one POST to the tunnel's route, then the page goes to the address's root (the tunnel's
    // sign-in page, once the session is gone).
    answer = 200;
    await page.evaluate(() => { window.__before = true; });
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/_kosmos/logout') && r.method() === 'POST'),
      page.click('#kplus-logout'),
    ]);
    await page.waitForFunction(() => !window.__before, null, { timeout: 8000 }).catch(() => {});
    const p4 = await page.evaluate(() => ({ reloaded: !window.__before, path: location.pathname, host: location.hostname }));
    chk(!!req && asked === 2 && p4.reloaded && p4.path === '/' && p4.host === 'remote.test', 'P4 a log out that works posts once and goes to the address\'s start', JSON.stringify({ asked, p4 }));
    await page.unroute('**/_kosmos/logout');

    // P5: the consolidated layout (its header is not sticky and has no padding): still the first row, edge to edge.
    await settle();
    await page.evaluate(() => applyLayout('consolidated', true));
    await page.waitForTimeout(400);
    const b5 = await bar(page);
    chk(b5.present && b5.first && b5.top === 0 && b5.left === 0 && b5.right === 0, 'P5 under the consolidated layout the bar is still the first row, edge to edge', JSON.stringify(b5));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'plus-bar-consolidated.png'), clip: { x: 0, y: 0, width: 1280, height: 200 } });
    await page.evaluate(() => applyLayout('tabs', true));

    chk(errs.length === 0, 'P6 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall plus-bar checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(1); });

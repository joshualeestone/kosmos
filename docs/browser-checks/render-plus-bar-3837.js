// Browser-check-surface: kplus-bar plus-logout plus-logout-row plus-logout-msg apphead s-sec-plus
'use strict';

/**
 * Viewed through a Kosmos+ address. History: #3837 F (Josh 2026-09-25) put a thin Kosmos+ bar above the board with a
 * blue Log out. kosmos#6718 (Josh 2026-10-20 08:42): on an agent's page that bar was cut to half its height, so it
 * is gone at desktop widths and Log out sits at the bottom of Settings > Kosmos+. On a phone the bar stays: there it
 * is the whole header (the Kosmos+ mark and the menu, #4823, render-mobilenav-4823.js).
 *
 * Harness: the real board, reached two ways. Through 127.0.0.1 it is the Mac's own window (the CONTROL: no Kosmos+
 * session, so no Log out anywhere), and through remote.test, which Chromium maps to the same loopback address and the
 * board is told to accept (AGENT_WORKFORCE_ALLOWED_HOSTS, its deliberate opt-in), it is what a Kosmos+ address shows.
 * The tunnel's own /_kosmos/logout is answered here (the tunnel is kosmos-relay's; its route has its own test there).
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

/* Is the bar drawn at all (an element can exist and take no box), and where does the header start. */
const head = (page) => page.evaluate(() => {
  const b = document.getElementById('kplus-bar'), h = document.querySelector('.apphead');
  const shown = !!b && b.getClientRects().length > 0 && b.getBoundingClientRect().height > 0;
  const hr = h ? h.getBoundingClientRect() : null;
  return { exists: !!b, shown, headTop: hr ? Math.round(hr.top) : null, headH: hr ? Math.round(hr.height) : null };
});
/* The Log out row in Settings > Kosmos+: shown, and the last thing drawn in the section (its bottom). */
const logoutRow = (page) => page.evaluate(() => {
  const row = document.getElementById('plus-logout-row'), sec = document.getElementById('s-sec-plus');
  if (!row || !sec) return { present: false };
  const drawn = [...sec.children].filter((c) => c.getClientRects().length > 0 && getComputedStyle(c).position !== 'fixed' && c.tagName !== 'CANVAS');
  const btn = document.getElementById('plus-logout');
  return { present: true, shown: !row.hidden && row.getClientRects().length > 0, last: drawn[drawn.length - 1] === row,
    text: btn ? btn.textContent : null, secShown: sec.getClientRects().length > 0 };
});
const openPlus = async (page) => {
  await page.evaluate(() => { showTab('settings'); settingsGo('plus'); });
  await page.waitForFunction(() => { const s = document.getElementById('s-sec-plus'); return !!s && !s.hidden; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
};

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

    // P1 CONTROL: the Mac's own window (loopback): no bar, and no Log out in Settings > Kosmos+ (no session to end).
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle' });
    await settle();
    const h1 = await head(page);
    chk(!h1.exists && !h1.shown, 'P1 CONTROL: on the Mac itself (127.0.0.1) there is no Kosmos+ bar', JSON.stringify(h1));
    await openPlus(page);
    const l1 = await logoutRow(page);
    chk(l1.present && l1.secShown && !l1.shown, 'P1 CONTROL: on the Mac itself Settings > Kosmos+ shows no Log out', JSON.stringify(l1));

    // P2: through a Kosmos+ address at a desktop width, no bar is drawn: the board's own header is the top of the page.
    await page.goto('http://remote.test:' + port + '/', { waitUntil: 'networkidle' });
    await settle();
    chk(await page.evaluate(() => location.hostname === 'remote.test' && document.documentElement.classList.contains('kremote')), 'P2 precondition: the real board answered through remote.test and knows it is remote');
    const h2 = await head(page);
    chk(h2.exists && !h2.shown && h2.headTop === 0, 'P2 through a Kosmos+ address at desktop width no Kosmos+ bar is drawn (kosmos#6718); the header starts at the top', JSON.stringify(h2));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'plus-nobar-board.png'), clip: { x: 0, y: 0, width: 1280, height: 200 } }); }

    // P3: no jump between the board and an agent's page (Josh's screenshot: the bar was half hidden on the agent's page).
    await page.evaluate(() => showTab('agents'));
    await page.waitForTimeout(300);
    const board = await head(page);
    await page.evaluate(() => { const a = document.querySelector('#grid [data-agent="beatrix"]'); if (a) a.click(); });
    await page.waitForFunction(() => { const s = document.getElementById('d-sec-talk'); return !!s && !s.hidden; }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    chk(await page.evaluate(() => { const s = document.getElementById('d-sec-talk'); return !!s && !s.hidden && s.getClientRects().length > 0; }), 'P3 precondition: an agent\'s talk view is open');
    const talk = await head(page);
    chk(!board.shown && !talk.shown && board.headTop === 0 && talk.headTop === 0 && board.headH === talk.headH, 'P3 on the board and on an agent\'s page alike, no bar, the header at the top and the same height (no jump, nothing cut)', JSON.stringify({ board, talk }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'plus-nobar-talk.png'), clip: { x: 0, y: 0, width: 1280, height: 160 } });

    // P4: Log out is at the bottom of Settings > Kosmos+ through a Kosmos+ address.
    await openPlus(page);
    const l4 = await logoutRow(page);
    chk(l4.present && l4.shown && l4.last && l4.text === 'Log out', 'P4 through a Kosmos+ address Settings > Kosmos+ ends with Log out', JSON.stringify(l4));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'plus-logout-settings.png'), fullPage: true });

    // P4b: and while connected, the state anyone reaching the board through Kosmos+ is in (review 1: P4 saw only the
    // not-connected pane, since this sandbox has no Kosmos+ account). The connected pane's own parts are answered here
    // the way render-plus-panel-3829.js answers them; Log out still ends the section, under Remove this computer.
    {
      const cp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        const remote = { configured: true, on: true, ok: true, enrolled: true, email: 'you@example.com', status: { state: 'up', address: 'remote.test' } };
        await cp.route('**/api/remote', (route, req) => route.fulfill(json(req.method() === 'GET' ? remote : { ok: true })));
        await cp.route('**/api/remote/pending', (route) => route.fulfill(json({ devices: [], email: 'you@example.com', self_device_id: 'd-self' })));
        await cp.route('**/api/remote/devices**', (route) => route.fulfill(json({ on: true, allowed: [{ device_id: 'd-self', allowed_at: Math.floor(Date.now() / 1000) - 60 }], pending: [], self_device_id: 'd-self' })));
        await cp.goto('http://remote.test:' + port + '/', { waitUntil: 'networkidle' });
        if (await cp.$('#firstrun:not([hidden])')) { await cp.keyboard.press('Escape'); await cp.waitForTimeout(200); }
        await openPlus(cp);
        await cp.waitForFunction(() => { const f = document.getElementById('plus-forget'); return !!f && !f.hidden; }, null, { timeout: 8000 }).catch(() => {});
        chk(await cp.evaluate(() => { const f = document.getElementById('plus-forget'); return !!f && !f.hidden && f.getClientRects().length > 0; }),
          'P4b precondition: the connected pane is drawn (Remove this computer is shown)');
        const l4b = await logoutRow(cp);
        chk(l4b.present && l4b.shown && l4b.last && l4b.text === 'Log out', 'P4b while connected, Settings > Kosmos+ still ends with Log out', JSON.stringify(l4b));
        if (SHOTS) await cp.screenshot({ path: path.join(SHOTS, 'plus-logout-connected.png'), fullPage: true });
      } finally { await cp.close(); }
    }

    // P5: a log out the tunnel refuses (here, a 403): it says so, the button works again, and the page stays.
    let asked = 0, answer = 403;
    await page.route('**/_kosmos/logout', (route) => { asked++; route.fulfill({ status: answer, contentType: 'application/json', body: answer === 200 ? '{"ok":true}' : '{"because":"no"}' }); });
    await page.click('#plus-logout');
    await page.waitForFunction(() => document.getElementById('plus-logout-msg').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    const p5 = await page.evaluate(() => ({ msg: document.getElementById('plus-logout-msg').textContent, dis: document.getElementById('plus-logout').disabled, host: location.hostname }));
    chk(asked === 1 && p5.msg === 'Could not log out just now. Try again.' && !p5.dis && p5.host === 'remote.test', 'P5 a refused log out says so and leaves the page as it was', JSON.stringify({ asked, p5 }));

    // P6: a log out that works posts once and lands on the address's start, signed out (kosmos#4879). Settings writes
    // its tab into the address (?tab=settings&sec=plus), so this is kplusLogout's query branch. The bare-'/' branch is
    // reachable only from the phone menu now; render-mobilenav-4823.js drives that menu's Log out with a refusal, not a
    // success, so that branch's success path has no browser check after this change (it had P4 before).
    answer = 200;
    chk(await page.evaluate(() => location.search.includes('tab=settings')), 'P6 precondition: Settings put its tab in the address', await page.evaluate(() => location.href));
    await page.evaluate(() => { window.__before = true; });
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith('/_kosmos/logout') && r.method() === 'POST'),
      page.click('#plus-logout'),
    ]);
    await page.waitForFunction(() => !window.__before, null, { timeout: 8000 }).catch(() => {});
    const p6 = await page.evaluate(() => ({ reloaded: !window.__before, path: location.pathname, search: location.search, host: location.hostname, hash: location.hash }));
    chk(!!req && asked === 2 && p6.reloaded && p6.search === '' && p6.path + p6.hash === '/#signed-out' && p6.host === 'remote.test', 'P6 a log out that works posts once and goes to the address\'s start, signed out', JSON.stringify({ asked, p6 }));
    await page.unroute('**/_kosmos/logout');

    chk(errs.length === 0, 'P7 no page errors', errs.join(' | '));

    // P8 CONTROL for the CSS change: at a phone width through Kosmos+ the bar is still drawn, 48px, as the header
    // (#4823). Without this, hiding the bar everywhere would pass every arm above.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await phone.goto('http://remote.test:' + port + '/', { waitUntil: 'networkidle' });
      if (await phone.$('#firstrun:not([hidden])')) { await phone.keyboard.press('Escape'); await phone.waitForTimeout(200); }
      const p8 = await phone.evaluate(() => { const b = document.getElementById('kplus-bar'); const r = b ? b.getBoundingClientRect() : null;
        return { shown: !!b && b.getClientRects().length > 0, h: r ? Math.round(r.height) : null, menu: !!document.getElementById('kplus-menu') && document.getElementById('kplus-menu').getClientRects().length > 0 }; });
      chk(p8.shown && p8.h === 48 && p8.menu, 'P8 CONTROL: on a phone through Kosmos+ the bar is still the 48px header with its menu', JSON.stringify(p8));
    } finally { await phone.close(); }
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall plus-bar checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(1); });

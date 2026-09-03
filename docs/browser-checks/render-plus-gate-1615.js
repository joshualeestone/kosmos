'use strict';
/**
 * The Kosmos Plus tab gates the on-switch on ENROLMENT, on a screen (#1615).
 *
 * The text tests prove paintPlus reads `enrolled !== true`; only a browser proves what a
 * person actually SEES: that an unenrolled machine (which is everyone today, since nobody can
 * pay or enrol yet) shows the state 1 holding place with NO "Turn on" switch, and that an
 * enrolled machine still gets the connected flow with the switch so it can turn Plus off.
 * The bug this guards: `configured` is Boolean(RELAY()) with a production default, so it is
 * always true; gating on it showed the relay on-switch to every user with no paid gate.
 *
 * /api/remote is stubbed per scenario with page.route so the same sandboxed server can be
 * driven through both states; the devices endpoint is stubbed empty so the enrolled flow has
 * nothing to fetch from the real (empty) sandbox.
 *
 *   node docs/browser-checks/render-plus-gate-1615.js            # headed
 *   HEADED=0 node docs/browser-checks/render-plus-gate-1615.js   # headless
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusgate-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusgate-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusgate-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusgate-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-plusgate-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'plusgate-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// The two states the gate must distinguish. `configured` is left true in BOTH, deliberately:
// it is always true in production, so a correct gate must NOT let it decide anything.
const UNENROLLED = { configured: true, on: false, ok: true, enrolled: false, email: '', status: {} };
const ENROLLED = { configured: true, on: false, ok: true, enrolled: true, email: 'you@example.com',
  status: { state: 'down' } };

async function openPlus(page, remote) {
  // Stub /api/remote (the gate's input) and the devices list (empty) BEFORE anything paints.
  await page.route('**/api/remote', (route, req) => {
    const m = req.method();
    if (m === 'GET' || m === 'HEAD') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remote) });
    } else { route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
  });
  await page.route('**/api/remote/devices**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: [], pending: [] }) });
  });
  await page.goto(page.__url, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="plus"]');
  // Wait for paintPlus to settle to a definitive state instead of a fixed sleep: state1 and
  // the connected flow are mutually exclusive here (state2 has no signal), so wait until
  // exactly one of them has real height. Robust to a slow paint without a fragile timeout.
  await page.waitForFunction(() => {
    const s1 = document.getElementById('plus-state1');
    const fl = document.getElementById('plus-flow');
    if (!s1 || !fl) return false;
    return (s1.offsetHeight > 0) !== (fl.offsetHeight > 0);
  }, null, { timeout: 5000 });
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      page.__url = URL;
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));

      // The retitle: the section heading and its nav pill both read "Kosmos Plus".
      await openPlus(page, UNENROLLED);
      const titles = await page.evaluate(() => ({
        h2: (document.querySelector('#s-sec-plus h2') || {}).textContent,
        nav: (document.querySelector('#s-nav button[data-go="plus"] span') || {}).textContent,
      }));
      chk(titles.h2 === 'Kosmos Plus', `[${theme}] the section heading reads "Kosmos Plus"`, JSON.stringify(titles));
      chk(titles.nav === 'Kosmos Plus', `[${theme}] the Settings nav pill reads "Kosmos Plus"`, JSON.stringify(titles));

      // UNENROLLED: state 1 is on screen, the connected flow (and its switch) is NOT.
      const un = await page.evaluate(() => {
        const h = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect().height : -1; };
        const sw = document.getElementById('plus-switch');
        return {
          state1: h('plus-state1'), flow: h('plus-flow'), state2: h('plus-state2'),
          switchVisible: !!(sw && sw.getBoundingClientRect().height > 0),
        };
      });
      chk(un.state1 > 0, `[${theme}] unenrolled: the state 1 holding place is on screen`, JSON.stringify(un));
      chk(un.flow === 0 || un.flow === -1, `[${theme}] unenrolled: the connected flow is NOT on screen`, JSON.stringify(un));
      chk(un.switchVisible === false, `[${theme}] unenrolled: the "Turn on" switch is NOT reachable (the whole bug)`, JSON.stringify(un));
      await page.screenshot({ path: path.join(OUT, `plus-unenrolled-${theme}.png`), fullPage: false });

      // ENROLLED: the connected flow (with the switch) is on screen, state 1 is not.
      await openPlus(page, ENROLLED);
      const en = await page.evaluate(() => {
        const h = (id) => { const e = document.getElementById(id); return e ? e.getBoundingClientRect().height : -1; };
        const sw = document.getElementById('plus-switch');
        return { state1: h('plus-state1'), flow: h('plus-flow'),
          switchVisible: !!(sw && sw.getBoundingClientRect().height > 0),
          switchText: sw ? sw.textContent : null };
      });
      chk(en.flow > 0, `[${theme}] enrolled: the connected flow is on screen`, JSON.stringify(en));
      chk(en.state1 === 0 || en.state1 === -1, `[${theme}] enrolled: the state 1 holding place is not shown`, JSON.stringify(en));
      chk(en.switchVisible === true && en.switchText === 'Turn on',
        `[${theme}] enrolled: the switch is present so a connected person can still turn Plus off`, JSON.stringify(en));
      await page.screenshot({ path: path.join(OUT, `plus-enrolled-${theme}.png`), fullPage: false });

      chk(errs.length === 0, `[${theme}] no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
  }
  console.log('screenshots: ' + OUT);
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });

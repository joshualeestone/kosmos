'use strict';
/**
 * The Assigner control is LIVE, DEFAULT ON, and follows the status contract, on a screen (#3595
 * phase 2).
 *
 * What this pins, and why each line can fail:
 *  - with nothing stored, the toggle appears once the read lands and reads ON (the default flipped
 *    with the behaviour), and no "not active yet" note is left,
 *  - clicking it stores off, read back from the route rather than from the switch; clicking again
 *    stores on,
 *  - a failed read hides the toggle and says so, never a false Off,
 *  - the hint names what ships (idle agents get the next task nobody is on), not goals.
 *
 * Not part of `npm test` -- it needs a browser, and this repo has no dependencies. See
 * README.md in this directory for the sandboxed recipe.
 *
 *   node docs/browser-checks/render-assigner-live-3595.js            # headed
 *   HEADED=0 node docs/browser-checks/render-assigner-live-3595.js   # headless
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-assigner-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-assigner-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-assigner-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-assigner-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-assigner-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');
const assignerSetting = require('../../engine/assigner-setting');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

async function openAutomation(page, URL) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  await page.evaluate(() => showTab('settings'));
  await page.waitForSelector('#panel-settings:not([hidden])');
  await page.click('#s-nav button[data-go="automation"]');
  await page.waitForFunction(
    () => document.getElementById('s-sec-automation').getBoundingClientRect().height > 0,
    null, { timeout: 8000 },
  ).catch(() => {});
}

const readRow = () => {
  const vis = (n) => !!(n && (n.offsetWidth || n.offsetHeight || n.getClientRects().length));
  const tog = document.getElementById('asg-toggle');
  return {
    toggleVisible: vis(tog),
    checked: tog ? tog.getAttribute('aria-checked') : null,
    hint: (document.querySelector('#asg-row .dhint') || {}).textContent || '',
    msg: (document.getElementById('asg-msg') || {}).textContent || '',
    notActive: /Not active yet/.test((document.getElementById('s-sec-automation') || {}).textContent || ''),
  };
};

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      // Start each theme from NOTHING stored, so the default-ON read is real.
      // The engine's own path (it lives under the data root's Kosmos/ folder, not the root itself).
      fs.rmSync(assignerSetting.FILE, { force: true });
      chk(!fs.existsSync(assignerSetting.FILE), `[${theme}] setup: nothing is stored`, assignerSetting.FILE);
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      await openAutomation(page, URL);
      await page.waitForFunction(() => document.getElementById('asg-toggle').hasAttribute('aria-checked'), null, { timeout: 8000 }).catch(() => {});
      const first = await page.evaluate(readRow);
      chk(first.toggleVisible && first.checked === 'true', `[${theme}] with nothing stored the Assigner is on screen and reads ON`, JSON.stringify(first));
      chk(!first.notActive, `[${theme}] no "not active yet" note is left in the section`, String(first.notActive));
      chk(/nothing to do for 20 minutes/.test(first.hint) && !/goals/i.test(first.hint), `[${theme}] the hint says what ships`, JSON.stringify(first.hint));

      const putDone = () => page.waitForResponse((r) => r.url().endsWith('/api/assigner-setting') && r.request().method() === 'PUT', { timeout: 8000 });
      await Promise.all([putDone(), page.click('#asg-toggle')]);
      const off = await (await page.request.get(URL + '/api/assigner-setting')).json();
      const offRow = await page.evaluate(readRow);
      chk(off.on === false && offRow.checked === 'false', `[${theme}] clicking stores off, read back from the route`, JSON.stringify({ off, offRow }));
      await Promise.all([putDone(), page.click('#asg-toggle')]);
      const on = await (await page.request.get(URL + '/api/assigner-setting')).json();
      chk(on.on === true, `[${theme}] clicking again stores on`, JSON.stringify(on));
      await page.close();

      const bad = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      await bad.route('**/api/assigner-setting', (route) => route.fulfill({ status: 500, body: '{}' }));
      await openAutomation(bad, URL);
      await bad.waitForTimeout(800);
      const failed = await bad.evaluate(readRow);
      chk(!failed.toggleVisible && /could not read this setting/.test(failed.msg), `[${theme}] a failed read hides the toggle and says so`, JSON.stringify(failed));
      await bad.close();
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';
/**
 * The Recommender control is LIVE and follows the status contract, on a screen (#3595).
 *
 * What this pins, and why each line can fail:
 *  - the toggle appears only once the server read lands, reads OFF by default (Splinter
 *    2026-09-24: default OFF until tool-level guards exist), and the off note shows while the
 *    guards row hides,
 *  - turning it on shows the three guards, all ticked, plus the plain disclosure that they are
 *    instructions Kosmos cannot yet enforce,
 *  - unticking ONE guard is stored as exactly that change (the other two stay on), read back
 *    from the route rather than from the checkbox,
 *  - a failed read hides the toggle and says so, never a false Off,
 *  - the hint says what ships (Kosmos asks teammates), not a consensus engine.
 *
 * Not part of `npm test` -- it needs a browser, and this repo has no dependencies. See
 * README.md in this directory for the sandboxed recipe.
 *
 *   node docs/browser-checks/render-recommender-live-3595.js            # headed
 *   HEADED=0 node docs/browser-checks/render-recommender-live-3595.js   # headless
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recommender-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recommender-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recommender-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recommender-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recommender-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

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
  const tog = document.getElementById('rec-toggle');
  const row = document.getElementById('rec-guards-row');
  const guards = {};
  for (const k of ['money', 'public', 'delete']) {
    const cb = document.getElementById('rec-guard-' + k);
    guards[k] = cb ? cb.checked : null;
  }
  return {
    toggleVisible: vis(tog),
    checked: tog ? tog.getAttribute('aria-checked') : null,
    guardsVisible: vis(row),
    offNoteVisible: vis(document.getElementById('rec-off-note')),
    guards,
    disclosure: row ? row.textContent : '',
    hint: (document.querySelector('#rec-row .dhint') || {}).textContent || '',
    msg: (document.getElementById('rec-msg') || {}).textContent || '',
  };
};

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const theme of ['light', 'dark']) {
      // Start each theme from the default (nothing stored), so the default-OFF read is real.
      await (await browser.newPage()).request.put(URL + '/api/recommender-setting', { data: { on: false } }).catch(() => {});
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      await openAutomation(page, URL);
      await page.waitForFunction(() => document.getElementById('rec-toggle').hasAttribute('aria-checked'), null, { timeout: 8000 }).catch(() => {});
      const off = await page.evaluate(readRow);
      chk(off.toggleVisible && off.checked === 'false', `[${theme}] the Recommender toggle is on screen and reads OFF by default`, JSON.stringify(off));
      chk(!off.guardsVisible && off.offNoteVisible, `[${theme}] while off, the guards hide and the off note shows`, JSON.stringify(off));
      chk(/Kosmos asks two of its teammates/.test(off.hint) && !/agree on a recommendation/.test(off.hint),
        `[${theme}] the hint says what ships`, JSON.stringify(off.hint));

      await page.click('#rec-toggle');
      await page.waitForFunction(() => document.getElementById('rec-toggle').getAttribute('aria-checked') === 'true', null, { timeout: 8000 }).catch(() => {});
      const on = await page.evaluate(readRow);
      chk(on.checked === 'true' && on.guardsVisible && !on.offNoteVisible, `[${theme}] turning it on shows the guards`, JSON.stringify(on));
      chk(on.guards.money && on.guards.public && on.guards.delete, `[${theme}] all three guards start ticked`, JSON.stringify(on.guards));
      chk(/cannot yet stop these actions/.test(on.disclosure), `[${theme}] the instruction-only disclosure is on screen`, JSON.stringify(on.disclosure));

      await page.click('#rec-guard-money');
      await page.waitForTimeout(600);
      const stored = await (await page.request.get(URL + '/api/recommender-setting')).json();
      chk(stored.on === true && stored.guards && stored.guards.money === false && stored.guards.public === true && stored.guards.delete === true,
        `[${theme}] unticking one guard stores exactly that change`, JSON.stringify(stored));
      await page.click('#rec-guard-money');
      await page.click('#rec-toggle');
      await page.waitForFunction(() => document.getElementById('rec-toggle').getAttribute('aria-checked') === 'false', null, { timeout: 8000 }).catch(() => {});
      const back = await (await page.request.get(URL + '/api/recommender-setting')).json();
      chk(back.on === false && back.guards.money === true, `[${theme}] ticking back and turning off are stored`, JSON.stringify(back));
      await page.close();

      // A failed read: the toggle hides and the message says so, never a false Off.
      const bad = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      await bad.route('**/api/recommender-setting', (route) => route.fulfill({ status: 500, body: '{}' }));
      await openAutomation(bad, URL);
      await bad.waitForTimeout(800);
      const failed = await bad.evaluate(readRow);
      chk(!failed.toggleVisible && /could not read this setting/.test(failed.msg) && !failed.guardsVisible && !failed.offNoteVisible,
        `[${theme}] a failed read hides the toggle and says so`, JSON.stringify(failed));
      await bad.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

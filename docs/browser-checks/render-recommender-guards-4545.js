'use strict';
/**
 * The Recommender's guards are a tidy left-aligned list (#4545, Josh 2026-09-29: "style this up to
 * be a bit nicer looking"; before, they sat centred and staggered under their legend).
 *
 * What this pins, and why each line can fail:
 *  - all three guards are on screen once the Recommender is on (counted, so an empty set fails),
 *  - every checkbox has the same x (against the staggered layout this fails: three different
 *    x's, 671 / 662 / 659 at 1400px), and the list starts at the legend's x,
 *  - each checkbox sits on the centre of its label's first line (within 1.5px),
 *  - each label spans the whole list, so the whole row is the target, and clicking the row's
 *    far end really toggles the box,
 *  - nothing scrolls sideways, and the page throws no error,
 * in light and dark, at 1400px and at a 390px phone.
 *
 *   node docs/browser-checks/render-recommender-guards-4545.js [shots-dir]            # headed
 *   HEADED=0 node docs/browser-checks/render-recommender-guards-4545.js [shots-dir]   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recguards-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recguards-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recguards-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recguards-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-recguards-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
const SANDBOXES = [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
  process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT];

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

const SHOTS = process.argv[2] || '';
const GEOM = () => {
  const R = (n) => n.getBoundingClientRect();
  const fs = document.getElementById('rec-guards-row');
  const list = fs.querySelector('.rec-guard-list') || fs;
  const labels = [...fs.querySelectorAll('label')].filter((l) => l.getClientRects().length);
  return {
    shown: !!fs.getClientRects().length,
    legendX: R(fs.querySelector('legend')).left,
    listX: R(list).left,
    listW: R(list).width,
    rows: labels.map((l) => {
      const cb = R(l.querySelector('input[type="checkbox"]'));
      const sp = l.querySelector('span');
      const lh = parseFloat(getComputedStyle(sp).lineHeight);
      return { cbX: cb.left, off: (cb.top + cb.height / 2) - (R(sp).top + lh / 2), labelW: R(l).width };
    }),
    wide: document.documentElement.scrollWidth > window.innerWidth,
  };
};

let ran = 0;
(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  const hook = (label) => { ran++; return label; };
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [1400, 390]) {
        const tag = `[${theme} ${width}]`;
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme });
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(String(e)));
        const reset = await page.request.put(URL + '/api/recommender-setting', { data: { on: false }, headers: { 'sec-fetch-site': 'same-origin' } });
        chk(reset.status() === 200, hook(`${tag} setup: the setting was reset to off`), String(reset.status()));
        await openAutomation(page, URL);
        await page.waitForFunction(() => document.getElementById('rec-toggle').hasAttribute('aria-checked'), null, { timeout: 8000 }).catch(() => {});
        await Promise.all([
          page.waitForResponse((r) => r.url().endsWith('/api/recommender-setting') && r.request().method() === 'PUT', { timeout: 8000 }).catch(() => {}),
          page.click('#rec-toggle'),
        ]);
        await page.waitForFunction(() => document.getElementById('rec-guards-row').getClientRects().length > 0, null, { timeout: 8000 }).catch(() => {});
        await page.mouse.move(1, 1);
        const g = await page.evaluate(GEOM);
        chk(g.shown && g.rows.length === 3, hook(`${tag} the three guards are on screen once it is on`), JSON.stringify(g));
        const xs = g.rows.map((r) => r.cbX);
        chk(xs.length === 3 && Math.max(...xs) - Math.min(...xs) < 0.5, hook(`${tag} every checkbox has the same x (one left column)`), JSON.stringify(xs));
        chk(Math.abs(g.listX - g.legendX) < 1.5, hook(`${tag} the list starts at its legend's left edge`), JSON.stringify([g.legendX, g.listX]));
        chk(g.rows.length === 3 && g.rows.every((r) => Math.abs(r.off) <= 1.5), hook(`${tag} each checkbox sits on the centre of its label's first line`), JSON.stringify(g.rows.map((r) => r.off)));
        chk(g.rows.length === 3 && g.rows.every((r) => r.labelW >= g.listW - 3), hook(`${tag} each guard's label spans the whole row`), JSON.stringify([g.listW, g.rows.map((r) => r.labelW)]));
        chk(!g.wide, hook(`${tag} nothing scrolls sideways`), JSON.stringify(g.wide));

        /* The whole row is the target: a click near the row's far end, well past the words,
           toggles the box (it starts ticked, so this unticks it), then a second click puts it
           back, waiting for each save so no click races one. */
        const putDone = () => page.waitForResponse((r) => r.url().endsWith('/api/recommender-setting') && r.request().method() === 'PUT', { timeout: 8000 });
        /* Aimed at the LIST's right edge, not the label's: a label that shrinks to its words ends
           short of it, and a click there must miss (it does on the staggered layout at 1400px). */
        const far = await page.evaluate(() => {
          const fs = document.getElementById('rec-guards-row');
          const edge = (fs.querySelector('.rec-guard-list') || fs).getBoundingClientRect().right;
          const b = document.querySelector('label[for="rec-guard-delete"]').getBoundingClientRect();
          return { x: edge - 6, y: b.top + b.height / 2 };
        });
        // A click that misses saves nothing, so a missing save is a result here, not a crash.
        await Promise.all([putDone().catch(() => null), page.mouse.click(far.x, far.y)]);
        const after = await page.evaluate(() => document.getElementById('rec-guard-delete').checked);
        chk(after === false, hook(`${tag} a click at the row's far end toggles the box`), String(after));
        if (after === false) await Promise.all([putDone(), page.mouse.click(far.x, far.y)]);
        await page.mouse.move(1, 1);
        if (SHOTS) {
          fs.mkdirSync(SHOTS, { recursive: true });
          const box = await page.evaluateHandle(() => document.getElementById('rec-guards-row').closest('.dbox'));
          await box.asElement().screenshot({ path: path.join(SHOTS, `recommender-${theme}-${width}.png`) });
        }
        chk(pageErrors.length === 0, hook(`${tag} no page errors`), pageErrors.join(' | ').slice(0, 300));
        await page.request.put(URL + '/api/recommender-setting', { data: { on: false }, headers: { 'sec-fetch-site': 'same-origin' } });
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
    for (const d of SANDBOXES) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  console.log(`\n${ran - fail.length}/${ran} passed`);
  process.exit(fail.length || ran < 36 ? 1 : 0);   // 4 arms x 9 checks; a skipped arm must fail
})().catch((e) => { console.error(e); process.exit(1); });

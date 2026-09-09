// Browser-check-surface: fr-foundcount
'use strict';

/**
 * #2497: the found-agents list (and its #1346 count) is GONE from first run.
 *
 * #1346 fixed a headline-vs-trailing-line count disagreement on the first-run found-agents screen
 * ("We found 3 agents" over three rows, then "6 agents" counting a second surface's rows too).
 * #2497 (Josh, 2026-09-08, watching Ben + Nacho test) removed the whole found-agents list from
 * onboarding: a developer's many tmux Claude Code sessions filled first run with garbage agents.
 * First run now ALWAYS lands on the no-agent "Create your first agent." / Giddy Up screen, so no
 * found rows and no count line render on first-run S9, whatever discovery returns.
 *
 * This check now guards the SUPPRESSION: fed a found-agents payload (three, then thirty), first-run
 * S9 must show the create / Giddy Up screen with NO found rows and NO count line, and must not
 * auto-connect anything. The found-agents engine is kept-but-bypassed (per the card); a user pulls
 * real agents in later via the manual Import Agent (#1652) on the Create Agent screen.
 *
 * ⚠️ TAKES A RUNNING BOARD, like the other found-screen checks. Start a sandboxed board first
 * (see tools/browser-checks.sh boot_board), then:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-found-count.js http://127.0.0.1:PORT
 */
const { chromium } = require('playwright');
const { gotoStepForAnchor } = require('./lib-firstrun-steps.js');
const BASE = process.argv[2] || 'http://127.0.0.1:4711';

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const agent = (name, role) => ({
  name, displayName: name, role, dir: '/Users/x/work/workers/' + name,
  already: false, runner: 'claude',
});
const THREE = { ok: true, agents: [agent('miles', 'researcher'), agent('nadia', 'support specialist'), agent('sarah', 'copywriter')] };
const MANY = { ok: true, agents: Array.from({ length: 30 }, (_, i) => agent('agent' + i, 'a role')) };

async function landOnGiddyUp(browser, found, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const errs = [];
  let connectCalls = 0;
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.route('**/api/found-agents', (r) => r.fulfill({ json: found }));
  await page.route('**/api/first-run', (r) => r.fulfill({
    json: { done: false, path: 'create', fleetCount: 0, known: true },
  }));
  await page.route('**/api/scan-agents', (r) => r.fulfill({ json: { ok: true, candidates: [] } }));
  await page.route('**/api/connect-agent', (r) => { connectCalls += 1; r.fulfill({ json: { ok: true, name: 'x', started: true } }); });

  await gotoStepForAnchor(page, BASE, '#fr-fleet');
  await page.waitForSelector('#fr-fleet', { timeout: 12000 });
  await page.waitForTimeout(500);

  const seen = await page.evaluate(() => ({
    heading: (document.getElementById('fr-fleet-title') || {}).textContent || '',
    box: (document.getElementById('fr-fleet') || {}).innerHTML || '',
    foundRowsOnScreen: document.querySelectorAll('#fr-fleet .fr-foundrow, #fr-fleet .fr-scanrow, #fr-fleet .fr-adoptrow').length,
    countLine: (document.getElementById('fr-foundcount') || {}).textContent || null,
  }));

  chk(/create your first agent/i.test(seen.heading), `[${label}] first run shows the create heading, not a found list`, seen.heading);
  chk(/let’s get started/i.test(seen.box), `[${label}] the Giddy Up copy is present`, seen.box.slice(0, 120));
  chk(seen.foundRowsOnScreen === 0, `[${label}] no found/scan/adopt rows render on first run`, String(seen.foundRowsOnScreen));
  chk(seen.countLine === null, `[${label}] no found-count line renders`, JSON.stringify(seen.countLine));
  chk(connectCalls === 0, `[${label}] nothing was auto-connected on first run`, String(connectCalls));
  chk(errs.length === 0, `[${label}] no page errors`, errs.join(' | '));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    await landOnGiddyUp(browser, THREE, 'three found');
    await landOnGiddyUp(browser, MANY, 'thirty found');
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });

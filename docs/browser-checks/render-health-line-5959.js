'use strict';
/**
 * #5959 slice 2: the agent's page carries one health line under Runs on (its AI Settings section): sign-in, usage, and when it last worked
 * (the card's lastWorked, engine/status.js lastWorkedOf, from observed.js's newest OK).
 *
 * ⚠️ THE SERVER RUNS IN THIS PROCESS WITH A FIXTURE FLEET, every state root a temp dir (as render-made-before.js).
 * The check opens agent pages and reads text: no Save, no Restart, no Remove.
 *
 * 🔑 CONTROLS: Rick was seen working five minutes ago, Bob never was, and Agy runs on a runner Kosmos cannot observe.
 * If all three said the same thing, the check would be reading the fixture, not the card. Each page is opened from a
 * fresh load, so this does not test one page following another without a reload.
 *
 *   node docs/browser-checks/render-health-line-5959.js            # headed
 *   HEADED=0 node docs/browser-checks/render-health-line-5959.js   # headless
 */
require('./lib-sandbox-home.js'); // #3675: never read the host computer's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hl-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hl-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hl-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hl-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hl-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-health-line-5959: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const fleet = require('../../test-support/fleet');
const observed = require('../../engine/observed');
const srv = require('../../server.js');

const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

(async () => {
  fleet.install([
    fleet.agent('rick', { state: 'idle', displayName: 'Rick', role: 'a researcher' }),
    fleet.agent('bob', { state: 'idle', displayName: 'Bob', role: 'a bookkeeper' }),
    fleet.agent('agy', { state: 'unknown', displayName: 'Agy', runner: 'antigravity', command: 'agy' }),
  ]);
  const seenAt = Date.now() - 5 * 60e3;
  observed.saw(observed.PROVIDER.ANTHROPIC, 'rick', observed.OUTCOME.OK, seenAt);

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="rick"]', { timeout: 8000 });

    const healthOf = async (who) => {
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.click('[data-agent="' + who + '"]');
      await page.waitForSelector('#panel-detail:not([hidden])');
      // The line sits under Runs on, in the AI Settings section, beside the model and account it is about.
      await page.click('#d-nav button[data-go="model"]');
      await page.waitForTimeout(400);
      return page.evaluate(() => {
        const el = document.getElementById('d-health');
        return el && el.getBoundingClientRect().height > 0 ? el.innerText : '';   // rendered text (#687)
      });
    };
    const rick = await healthOf('rick');
    // The page's own words for that time (a weekday when it was yesterday, as it can be just after midnight).
    const at = await page.evaluate((t) => seenAtWords(t, Date.now()), seenAt);
    say(rick === 'Sign-in: no problem showing · Usage: no limit showing · Last seen working: ' + at, 'Rick, seen working five minutes ago, shows when', rick);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-agent="bob"]', { timeout: 8000 });
    const bob = await healthOf('bob');
    say(/Last seen working: no record$/.test(bob), 'CONTROL: Bob, never seen working, says so', bob);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-agent="agy"]', { timeout: 8000 });
    const agy = await healthOf('agy');
    say(/Last seen working: Kosmos cannot see this agent's turns$/.test(agy), 'CONTROL: an Antigravity agent says Kosmos cannot see its turns', agy);
    say(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });

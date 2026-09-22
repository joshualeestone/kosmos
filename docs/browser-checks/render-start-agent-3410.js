'use strict';
/**
 * #3410 (Josh, 0.6.88 live test, 2026-09-22): the "Start this agent" affordance
 * in the detail header's identity column.
 *
 * Josh had seven agents that never connected and no way to start one from the UI
 * without the buried Fresh-start section. This check drives the REAL page and the
 * REAL openDetail painter and reads the REAL DOM, because web/index.html has no
 * unit coverage and the affordance is a DOM outcome of the painter on a real
 * fixture card.
 *
 * What it asserts:
 *   1. A NOT-RUNNING agent (state 'stopped' -> cardStOf.pres === 'off') opens with
 *      #d-start-wrap visible, the button reading "Start this agent", enabled.
 *   2. A RUNNING agent (state 'idle') opens with #d-start-wrap hidden -- the
 *      affordance is reserved for not-running, never offered on a healthy agent.
 *   3. Clicking Start POSTs /api/agent/<name>/restart (the existing start-a-stopped
 *      route, not a new endpoint), and on a refused outcome it shows the honest
 *      failure line (restartFailureLine) and re-enables, rather than claiming
 *      success. The route is intercepted so the check is fast and deterministic.
 *
 *   node docs/browser-checks/render-start-agent-3410.js            # headed
 *   HEADED=0 node docs/browser-checks/render-start-agent-3410.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-start-agent-3410.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sa-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sa-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sa-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sa-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sa-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'sa-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('nyx', { state: 'stopped', displayName: 'Nyx', role: 'Research Analyst' }),
    fleet.agent('bea', { state: 'idle', displayName: 'Bea', role: 'Collections Coordinator' }),
  ]);
  // Plists so both agents have a recorded model and the panel renders fully.
  for (const n of ['nyx', 'bea']) {
    fs.writeFileSync(create.plistPath(n),
      create.plistFor(n, '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');
  }

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }

    // ── Part 1: a not-running agent shows the Start affordance. ───────────────
    await page.waitForSelector('[data-agent="nyx"]', { timeout: 8000 });
    // Open via the real openDetail (the same entry a card click uses); switching
    // agents this way avoids the back-then-click dance and is what production
    // calls on a project-member open too.
    await page.evaluate(() => openDetail('nyx'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);
    const stopped = await page.evaluate(() => {
      const wrap = document.getElementById('d-start-wrap');
      const btn = document.getElementById('d-start-agent');
      return {
        wrapHidden: !wrap || wrap.hidden,
        btnText: btn ? btn.textContent.trim() : null,
        btnDisabled: btn ? btn.disabled : null,
        // pres derivation the visibility gate uses, so a failure names the cause.
        pres: (typeof cardStOf === 'function' && CURRENT) ? cardStOf(CURRENT).pres : '(unavailable)',
      };
    });
    chk(!stopped.wrapHidden, 'not-running agent: Start affordance is visible', JSON.stringify(stopped));
    chk(stopped.btnText === 'Start this agent', 'the button reads "Start this agent"', stopped.btnText);
    chk(stopped.btnDisabled === false, 'the button is enabled at open', JSON.stringify(stopped.btnDisabled));
    chk(stopped.pres === 'off', 'gated on cardStOf(a).pres === "off"', stopped.pres);

    // ── Part 2: a running agent does NOT show it. ─────────────────────────────
    await page.evaluate(() => openDetail('bea'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);
    const running = await page.evaluate(() => {
      const wrap = document.getElementById('d-start-wrap');
      return {
        wrapHidden: !wrap || wrap.hidden,
        pres: (typeof cardStOf === 'function' && CURRENT) ? cardStOf(CURRENT).pres : '(unavailable)',
      };
    });
    chk(running.wrapHidden, 'running agent: Start affordance is hidden', JSON.stringify(running));
    chk(running.pres !== 'off', 'running agent pres is not "off"', running.pres);

    // ── Part 3: click Start POSTs /restart and reports an honest failure. ─────
    let restartHit = null;
    await page.route('**/api/agent/*/restart', async (route) => {
      restartHit = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ outcome: 'refused', because: 'Test refusal, not started.' }),
      });
    });
    await page.evaluate(() => openDetail('nyx'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);
    await page.click('#d-start-agent');
    // The failure branch is synchronous after the fetch resolves; give it a beat.
    await page.waitForFunction(() => {
      const m = document.getElementById('d-start-msg');
      return m && /Test refusal/.test(m.textContent);
    }, { timeout: 6000 }).catch(() => {});
    const clicked = await page.evaluate(() => {
      const btn = document.getElementById('d-start-agent');
      const msg = document.getElementById('d-start-msg');
      return {
        msg: msg ? msg.textContent.trim() : null,
        btnDisabled: btn ? btn.disabled : null,
      };
    });
    chk(!!restartHit && /\/api\/agent\/nyx\/restart$/.test(restartHit),
      'clicking Start POSTs /api/agent/<name>/restart', String(restartHit));
    chk(!!clicked.msg && /Test refusal, not started\./.test(clicked.msg),
      'a refused start shows the honest failure line, not "started"', clicked.msg);
    chk(clicked.btnDisabled === false, 'the button re-enables after a failed start', JSON.stringify(clicked.btnDisabled));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.screenshot({ path: path.join(OUT, 'start-agent.png'), clip: { x: 0, y: 0, width: 480, height: 700 } }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();

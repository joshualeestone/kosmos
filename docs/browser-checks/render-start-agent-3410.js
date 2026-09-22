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
      // The real route answers 400 for a refused restart (see the restartTook
      // comment in web/index.html); match that so the fixture is faithful.
      await route.fulfill({
        status: 400,
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

    // ── Part 3b: a refused start with NO `because` must not double up on the
    // restart-worded generic. restartFailureLine's shared fallback is "We could
    // not restart them."; in this START context the handler must suppress it (our
    // lead already said the generic, start-worded), so the message is just "We
    // could not start Nyx." and never contains "restart".
    await page.unroute('**/api/agent/*/restart');
    await page.route('**/api/agent/*/restart', async (route) => {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ outcome: 'refused' }) });
    });
    await page.evaluate(() => openDetail('nyx'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);
    await page.click('#d-start-agent');
    await page.waitForFunction(() => {
      const m = document.getElementById('d-start-msg');
      return m && /could not start/i.test(m.textContent);
    }, { timeout: 6000 }).catch(() => {});
    const noReason = await page.evaluate(() => {
      const m = document.getElementById('d-start-msg');
      return m ? m.textContent.trim() : null;
    });
    chk(noReason === 'We could not start Nyx.',
      'a refused start with no reason reads cleanly, no restart-worded double-up', noReason);
    chk(!!noReason && !/restart/i.test(noReason),
      'and it never says "restart" in the start context', noReason);

    // ── Part 4: the #3418 honesty path -- the novel behaviour this button exists
    // for. The route ACCEPTS the restart (outcome:'restarted', the false-success
    // restartInner returns even when the launchd relaunch never loaded), but the
    // agent never actually comes up (nyx stays 'stopped' in the fixture, so
    // /api/status never reports it ready). The button must NOT claim "Started";
    // it must wait on restartReadyWait and then show the honest "has not come
    // back yet" line. Shorten the readiness window so the timeout arm runs fast
    // (the same let-seam render-autohello-2686 / render-restart-kloader-2831 use).
    await page.unroute('**/api/agent/*/restart');
    await page.evaluate(() => { RESTART_READY_WINDOW_MS = 800; RESTART_READY_POLL_MS = 60; });
    let restartedHit = null;
    await page.route('**/api/agent/*/restart', async (route) => {
      restartedHit = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ outcome: 'restarted' }),   // the #3418 false-success
      });
    });
    await page.evaluate(() => openDetail('nyx'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);
    await page.click('#d-start-agent');
    // restartReadyWait times out after ~800ms without ever seeing the agent ready
    // (nyx is stopped, so restartedAndReady is false every poll); then the handler
    // writes the "has not come back" line. Wait for it, with margin.
    await page.waitForFunction(() => {
      const m = document.getElementById('d-start-msg');
      return m && /has not come back/i.test(m.textContent);
    }, { timeout: 8000 }).catch(() => {});
    const unready = await page.evaluate(() => {
      const btn = document.getElementById('d-start-agent');
      const msg = document.getElementById('d-start-msg');
      return {
        msg: msg ? msg.textContent.trim() : null,
        btnDisabled: btn ? btn.disabled : null,
      };
    });
    chk(!!restartedHit, 'restarted-but-never-ready: the restart was POSTed', String(restartedHit));
    chk(!!unready.msg && /has not come back/i.test(unready.msg),
      'a restart that never becomes ready shows the honest "has not come back" line (#3418 defense)', unready.msg);
    chk(!!unready.msg && !/\bStarted\b/.test(unready.msg),
      'and it does NOT falsely claim "Started" on the restart false-success', unready.msg);
    chk(unready.btnDisabled === false, 'the button re-enables so the person can try again', JSON.stringify(unready.btnDisabled));

    // ── Part 5: reopening the panel DURING the readiness wait must suppress the
    // stale handler's late write (the START_EPOCH guard). Reuses Part 4's
    // restarted-but-never-ready route and shortened window. Click Start (begins
    // the ~800ms wait), reopen nyx mid-wait (openDetail bumps START_EPOCH and
    // clears the message), then let the stale wait resolve: its "has not come
    // back" line must NOT land on the freshly-reopened panel. Without the epoch
    // guard (a bare sessionName check) it would, since the reopened agent has the
    // same sessionName.
    await page.evaluate(() => openDetail('nyx'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(200);
    await page.click('#d-start-agent');           // begins the ~800ms readiness wait
    await page.waitForTimeout(150);               // still inside the wait
    await page.evaluate(() => openDetail('nyx')); // reopen: START_EPOCH bumps, msg cleared
    await page.waitForTimeout(1300);              // let the stale wait resolve past 800ms
    const afterReopen = await page.evaluate(() => {
      const m = document.getElementById('d-start-msg');
      return m ? m.textContent.trim() : null;
    });
    chk(!/has not come back/i.test(afterReopen || ''),
      'a reopen during the readiness wait suppresses the stale handler’s late write (epoch guard)',
      JSON.stringify(afterReopen));

    // ── Part 6: the in-flight guard (START_FLIGHT). When a Start is in flight for
    // the current open, refreshStartAffordance (the poll's reappear arm re-derive)
    // must NOT re-enable the disabled button, or a person could fire a second
    // restart mid-wait. Drive it directly: open nyx (stopped), mark a start
    // in-flight for this open and disable the button as the click would, then run
    // refreshStartAffordance and assert the button stays disabled. Without the
    // guard it re-enables (notRunning is true), so this arm is red-capable.
    await page.evaluate(() => openDetail('nyx'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(200);
    const guarded = await page.evaluate(() => {
      const btn = document.getElementById('d-start-agent');
      START_FLIGHT = START_EPOCH;      // a start owns this open
      btn.disabled = true;             // as the click handler sets it
      refreshStartAffordance(CURRENT); // the reappear-arm re-derive
      const held = btn.disabled;
      START_FLIGHT = null;             // clean up so later state is unaffected
      refreshStartAffordance(CURRENT);
      return { held, afterClear: btn.disabled };
    });
    chk(guarded.held === true,
      'an in-flight Start keeps the button disabled through a re-derive (no double-restart)', JSON.stringify(guarded));
    chk(guarded.afterClear === false,
      'and once the start clears, a re-derive re-enables it', JSON.stringify(guarded));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.screenshot({ path: path.join(OUT, 'start-agent.png'), clip: { x: 0, y: 0, width: 480, height: 700 } }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();

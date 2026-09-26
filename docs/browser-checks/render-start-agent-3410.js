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
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
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
const store = require('../../engine/store');
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
  // A genuinely-OFFLINE agent for Part 7: a profile + worker folder + a plist (job)
  // but NO pane, which the server builds as state:'stopped' with session:null, i.e.
  // FOUND.NONE. Unlike 'nyx' (a login-shell pane = FOUND.OURS, which is why Parts
  // 3-6 must MOCK /restart), 'ghost' lets Part 7 exercise the REAL /restart route.
  // Post-#3418/#3429 restartInner BOOTSTRAPS the FOUND.NONE launchd job instead of
  // refusing; in this dry-run sandbox the job never reports ready, so the honest
  // "has not come back yet" line is shown (not the old refusal). (Recipe from
  // render-made-before.js: writeProfile + workerDir make a known offline row.)
  store.writeProfile('ghost', { displayName: 'Ghost' });
  fs.mkdirSync(create.workerDir('ghost'), { recursive: true });
  fs.writeFileSync(create.plistPath('ghost'),
    create.plistFor('ghost', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');

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

    // ── Part 7: the REAL /restart route against a genuinely-offline agent
    // (FOUND.NONE). Parts 3-6 mock /restart because 'nyx' has a login-shell pane
    // (FOUND.OURS); this arm removes the mock and opens 'ghost' (profile + folder +
    // plist, no pane -> session:null -> FOUND.NONE), so restartInner runs for real.
    // #3418 (#3429) LANDED: FOUND.NONE now bootstraps the launchd job instead of
    // refusing, so the real route no longer writes "could not start". In this
    // sandbox live-execution is dry-run (launchctl does nothing), so the job never
    // reports ready and the honest "has not come back yet" line is written, the
    // same one Part 4's not-ready arm asserts. The button must surface that honest
    // line, never a false "Started". (Before #3429 this arm expected the
    // "...is not running, so there is nothing to restart" refusal; the prior
    // comment here predicted this exact update the day #3418 shipped.)
    await page.unroute('**/api/agent/*/restart');   // let the real route run
    await page.evaluate(() => openDetail('ghost'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);
    const ghostShows = await page.evaluate(() => {
      const wrap = document.getElementById('d-start-wrap');
      const btn = document.getElementById('d-start-agent');
      return { wrapHidden: !wrap || wrap.hidden, btnHidden: btn ? btn.hidden : null };
    });
    chk(!ghostShows.wrapHidden && ghostShows.btnHidden === false,
      'offline (FOUND.NONE) agent: the Start button shows', JSON.stringify(ghostShows));
    await page.click('#d-start-agent');
    // Relies on Part 4 having shortened RESTART_READY_WINDOW_MS/POLL_MS to 800/60
    // (line 193), so ghost's readiness wait times out inside this 8000ms window and
    // the "has not come back" line is written. If a future edit restores the full
    // window, this arm goes RED (the wait outlives 8s), which is honest, not a false
    // green. Same inheritance Part 8 notes.
    await page.waitForFunction(() => {
      const m = document.getElementById('d-start-msg');
      return m && /has not come back/i.test(m.textContent);
    }, { timeout: 8000 }).catch(() => {});
    const ghostMsg = await page.evaluate(() => {
      const btn = document.getElementById('d-start-agent');
      const m = document.getElementById('d-start-msg');
      return { msg: m ? m.textContent.trim() : null, btnDisabled: btn ? btn.disabled : null };
    });
    chk(!!ghostMsg.msg && /has not come back/i.test(ghostMsg.msg),
      'the REAL FOUND.NONE route now bootstraps and surfaces the honest "has not come back" line (#3418/#3429, not a false "Started")', ghostMsg.msg);
    chk(!!ghostMsg.msg && !/Started /.test(ghostMsg.msg),
      'and no false-success "Started X" line on the real bootstrap attempt', ghostMsg.msg);
    chk(ghostMsg.btnDisabled === false, 'the button re-enables after the real bootstrap attempt', JSON.stringify(ghostMsg.btnDisabled));

    // ── Part 8: the SUCCESS terminal state (the happy path). Mock /restart ->
    // restarted, and flip /api/status so nyx reports unready first (the gap) then
    // ready, so restartReadyWait returns true; mock /thread -> placed. Then the
    // button must show "Started Nyx, and said hello to wake them." and HIDE itself
    // (sb.hidden = true), leaving just the receipt. Mirrors render-autohello-2686's
    // restarting->ready recovery pattern. (Readiness window already shortened to
    // 800ms/60ms in Part 4.)
    await page.unroute('**/api/agent/*/restart');
    await page.route('**/api/agent/*/restart', (r) => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ outcome: 'restarted' }),
    }));
    await page.route('**/api/agent/*/thread', (r) => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ recorded: true, delivery: { state: 'placed' } }),
    }));
    let statusPolls = 0;
    await page.route('**/api/status', async (route) => {
      const resp = await route.fetch();
      let json;
      try { json = await resp.json(); } catch { return route.fulfill({ response: resp }); }
      statusPolls++;
      // Unready on the first poll (the gap restartReadyWait requires), then ready.
      // restartedAndReady = boardCanSeeIt (isAgentSession && isNamedOurs && state
      // !== 'stopped') && state !== 'restarting', so set all of them.
      if (statusPolls >= 2 && Array.isArray(json.agents)) {
        const a = json.agents.find((x) => x.sessionName === 'nyx');
        if (a) { a.state = 'idle'; a.running = true; a.isAgentSession = true; a.isNamedOurs = true; }
      }
      return route.fulfill({ response: resp, body: JSON.stringify(json), contentType: 'application/json' });
    });
    await page.evaluate(() => openDetail('nyx'));
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);
    await page.click('#d-start-agent');
    await page.waitForFunction(() => {
      const m = document.getElementById('d-start-msg');
      return m && /said hello to wake them/i.test(m.textContent);
    }, { timeout: 8000 }).catch(() => {});
    const success = await page.evaluate(() => {
      const btn = document.getElementById('d-start-agent');
      const m = document.getElementById('d-start-msg');
      return { msg: m ? m.textContent.trim() : null, btnHidden: btn ? btn.hidden : null };
    });
    chk(!!success.msg && /Started Nyx, and said hello to wake them\./.test(success.msg),
      'success: the confirmed-started + said-hello receipt is shown', success.msg);
    chk(success.btnHidden === true,
      'and the button hides on success, leaving just the receipt', JSON.stringify(success.btnHidden));
    /* ── Part 9 (#4008): the waiting line carries the Sweep loader, and when a NEWER start or restart of the
       same agent supersedes the hello (no report comes), the line settles on "Started Nyx." instead of
       spinning forever. The button is re-armed by hand; the hello is held so the newer restart can land
       while it is out. */
    statusPolls = 0;   // the gap again, so the readiness wait sees unready then ready
    await page.unroute('**/api/agent/*/thread');
    await page.route('**/api/agent/*/thread', async (r) => {
      await new Promise((res) => setTimeout(res, 1200));
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recorded: true, delivery: { state: 'placed' } }) });
    });
    await page.evaluate(() => { const b = document.getElementById('d-start-agent'); b.hidden = false; b.disabled = false; });
    await page.click('#d-start-agent');
    await page.waitForFunction(() => { const m = document.getElementById('d-start-msg'); return m && /Waking them/.test(m.textContent); }, { timeout: 8000 }).catch(() => {});
    const waking = await page.evaluate(() => { const m = document.getElementById('d-start-msg'); const sp = m && m.querySelector('.spin.spin-sweep');
      return { text: m ? m.textContent : null, sweep: !!sp, dots: sp ? sp.querySelectorAll('i').length : 0 }; });
    await page.evaluate(() => { RESTART_HELLO_SEQ.nyx = (RESTART_HELLO_SEQ.nyx || 0) + 1; });   // a newer restart of nyx
    await page.waitForTimeout(2000);   // past the held hello
    const settled = await page.evaluate(() => { const m = document.getElementById('d-start-msg');
      return { text: m ? m.textContent.trim() : null, sweep: !!(m && m.querySelector('.spin')) }; });
    chk(waking.sweep && waking.dots === 8 && /^Started Nyx\. Waking them…$/.test(waking.text || ''),
      '#4008: Start\'s "Waking them..." carries the Sweep loader', JSON.stringify(waking));
    chk(settled.text === 'Started Nyx.' && !settled.sweep,
      '#4008: a hello superseded by a newer restart settles the line ("Started Nyx."), with no loader left spinning', JSON.stringify(settled));
    await page.unroute('**/api/status');

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.screenshot({ path: path.join(OUT, 'start-agent.png'), clip: { x: 0, y: 0, width: 480, height: 700 } }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();

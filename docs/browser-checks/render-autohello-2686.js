'use strict';

/**
 * kosmos#2686: after a USER-INITIATED restart, the board auto-sends the wake
 * 'hello' instead of asking the person to type it -- but only AFTER the
 * restarted agent is back up (a restart is async: it kills the pane and a
 * supervisor respawns it later, so an immediate send types into a dead pane).
 *
 * ⚠️ WHY THIS NEEDS A BROWSER. The behaviour is a SEQUENCE of fetches driven by
 * the real restart handler and a readiness poll -- restart -> poll /api/status
 * until ready -> POST /api/agent/<name>/thread {text:'hello'}. `node --test`
 * lifting the helper against stubs cannot see the real rst-go click listener
 * invoke it, cannot see the poll wait past the #2019 'restarting' gap, and
 * cannot see the notice resolve on screen. This drives the real page.
 *
 * Per docs/browser-checks/README.md (#1769): a committed headless check runs
 * from ANY session, no MCP, no operator. It loads the page over file:// and
 * answers every route from a `window.fetch` stub (the render-pj-clear-2575.js
 * model), so it needs no board and can never touch a real one.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-autohello-2686.js
 *
 * ⚠️ NODE_PATH is not optional: require resolves from THIS file's directory, so
 * without it the script walks docs/browser-checks/node_modules and exits
 * MODULE_NOT_FOUND.
 *
 * The red-capable contrast is the three timing arms: an agent that goes
 * restarting->idle gets exactly one hello (success); an agent that stays
 * restarting gets none (the 'restarting'-gap guard); an agent that is ready on
 * the very first poll with no observed gap gets none (the stale-snapshot guard).
 * A regression that always-sends or never-sends fails one of the two contrasts.
 */

const playwright = require('playwright');
const path = require('node:path');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

/* The fetch stub. Records every request in __posted; answers the four routes
   this flow touches and a benign default for everything else (boot polls). The
   readiness of the restarted agent is TIME-BASED off __readyAt so it is robust
   to the extra /api/status calls tick() makes -- a per-call counter would be
   thrown off by them. */
function initStub() {
  window.__posted = [];
  // Refuse repeat polls (render-talk lesson: a visible Playwright page keeps
  // polling and would race every hand-driven step). A fake id is enough.
  window.setInterval = () => 0;
  // Readiness is COUNT-based, not wall-clock: the restarted agent reports the
  // #2019 'restarting' gap until it has answered more than __readyAfterCalls
  // /api/status polls since the restart POST, then 'idle' (back and ready).
  // Count-based because the handler's `await tick()` (its own status poll) makes
  // any wall-clock gap racy -- tick's latency could swallow the whole gap before
  // the readiness poll starts, so no gap would be observed. Infinity = never.
  window.__readyAfterCalls = Number.POSITIVE_INFINITY;
  window.__statusSinceRestart = 0;
  // What the thread route (the wake send) returns. delivery.state 'placed' is
  // the composer's own "reached the agent" signal, which the notice claims on.
  window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
  const enc = (o, status) => new Response(JSON.stringify(o), {
    status: status || 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method ? String(opts.method) : 'GET').toUpperCase();
    window.__posted.push({ url: u, method, body: (opts && opts.body) || null });
    // The restart itself: 'restarted' outcome so restartTook() is true. Resets
    // the poll counter so pre-restart boot reads do not count toward readiness.
    if (/\/api\/agent\/[^/]+\/restart$/.test(u) && method === 'POST') {
      window.__statusSinceRestart = 0;
      return enc({ outcome: 'restarted', steps: [] });
    }
    // The wake send.
    if (/\/api\/agent\/[^/]+\/thread$/.test(u) && method === 'POST') {
      return enc(window.__threadResp);
    }
    // The readiness poll (and tick's board read). One agent; its state flips to
    // idle only after enough polls, so the gap-then-recovery is deterministic.
    if (/\/api\/status(\?|$)/.test(u)) {
      window.__statusSinceRestart += 1;
      const ready = window.__statusSinceRestart > window.__readyAfterCalls;
      return enc({ agents: [{
        sessionName: 'april', name: 'April', displayName: 'April',
        isAgentSession: true, isNamedOurs: true,
        state: ready ? 'idle' : 'restarting',
      }] });
    }
    // Everything else benign; agents:[] so any boot poll that assigns LAST keeps
    // an array rather than undefined.
    return enc({ agents: [] });
  };
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-autohello-2686: could not start a browser'
      + (HEADED ? ' (headed; try HEADED=0).' : '.'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;   // file:// cannot serve avatars
    pageErrors.push('console: ' + m.text());
  });

  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');

  // Shorten the readiness window so the timeout arms run in ~1s, and seed the
  // board snapshot openRestartModal reads. These top-level `let`s are reachable
  // from the page's global lexical scope, the same seam WATCH/PROJECTS use.
  await page.evaluate(() => {
    RESTART_READY_WINDOW_MS = 800;
    RESTART_READY_POLL_MS = 60;
    LAST = [{ sessionName: 'april', name: 'April', displayName: 'April', role: 'a researcher' }];
    // The open agent is april, so the rst-go receipt's CURRENT.sessionName===name
    // guard passes and the note writes. Arm 8 changes this mid-wait to prove the
    // guard suppresses a resolution meant for an agent the person navigated off.
    CURRENT = { sessionName: 'april', name: 'April' };
    // A restart button + its stale-notice sibling, exactly the shape noteFor()
    // reads (btn.parentNode .instr-restart-note). Kept in a known host so each
    // arm can reset the note text.
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    const host = document.createElement('div'); host.id = '__ah';
    host.innerHTML = '<div class="row"><button type="button" data-restart-agent="april">Restart</button>'
      + '<span class="instr-restart-note"></span></div>';
    document.body.appendChild(host);
  });

  const NOTE = '#__ah .instr-restart-note';
  const SAID = 'Restarted, and said hello to wake them.';
  const MANUAL = 'Restarted. You will need to say ‘hello’ to wake them.';

  // Drive the REAL rst-go confirm for the __ah button, wait for the note to
  // reach a terminal line, and report what happened. `readyAfter` = how many
  // /api/status polls after the restart before the agent flips to idle ('inf' =
  // never). tick() makes the first post-restart status call, so readyAfter=2
  // gives the readiness wait a real restarting poll (the gap) before recovery.
  async function runRestart(readyAfter) {
    await page.evaluate((n) => {
      window.__posted = [];
      window.__readyAfterCalls = n === 'inf' ? Number.POSITIVE_INFINITY : n;
      window.__statusSinceRestart = 0;
      document.querySelector('#__ah .instr-restart-note').textContent = '';
      const btn = document.querySelector('#__ah [data-restart-agent]');
      openRestartModal(btn, 'april');
    }, readyAfter);
    await page.click('#rst-go');
    // Terminal when the note is neither empty nor the interim 'Waking' line.
    await page.waitForFunction(() => {
      const t = (document.querySelector('#__ah .instr-restart-note') || {}).textContent || '';
      return t && !/Waking them/.test(t);
    }, { timeout: 4000 }).catch(() => {});
    return page.evaluate(() => {
      const t = (document.querySelector('#__ah .instr-restart-note') || {}).textContent || '';
      const thread = window.__posted.filter((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && p.method === 'POST');
      let helloBody = null;
      try { helloBody = thread[0] && thread[0].body ? JSON.parse(thread[0].body) : null; } catch { helloBody = 'unparseable'; }
      return { note: t, threadCalls: thread.length, threadUrl: thread[0] && thread[0].url, helloBody };
    });
  }

  // ---- Arm 1: SUCCESS. restarting (the gap) -> idle -> exactly one hello ----
  const s1 = await runRestart(2);
  check('success: exactly one wake hello is sent', s1.threadCalls === 1, 'calls=' + s1.threadCalls);
  check('success: it POSTs the restarted agent\'s thread', /\/api\/agent\/april\/thread$/.test(s1.threadUrl || ''), s1.threadUrl || '');
  check('success: the wake text is "hello"', s1.helloBody && s1.helloBody.text === 'hello', JSON.stringify(s1.helloBody));
  check('success: the notice becomes "said hello"', s1.note === SAID, JSON.stringify(s1.note));

  // ---- Arm 2: STAYS RESTARTING. never ready -> NO hello, manual fallback ----
  // The 'restarting'-gap guard: boardCanSeeIt alone would call this ready.
  const s2 = await runRestart('inf');
  check('gap-forever: NO wake hello is sent (never fires into a booting pane)', s2.threadCalls === 0, 'calls=' + s2.threadCalls);
  check('gap-forever: the notice falls back to the manual line', s2.note === MANUAL, JSON.stringify(s2.note));

  // ---- Arm 3: READY ON THE FIRST POLL, NO GAP. -> NO hello (stale-snapshot guard) ----
  // readyAfter=0: every status poll reads idle, so no unready state is ever
  // observed. Without the sawUnready guard this would fire hello into what could
  // be the stale pre-restart session.
  const s3 = await runRestart(0);
  check('no-gap: NO wake hello when ready on the first poll with no observed gap', s3.threadCalls === 0, 'calls=' + s3.threadCalls);
  check('no-gap: the notice falls back to the manual line', s3.note === MANUAL, JSON.stringify(s3.note));

  // ---- Arm 4: the helper is SITE-AGNOSTIC (the doctrine flow's phrasings) ----
  // Drive autoHelloAfterRestart directly with the doctrine flow's said/manual
  // strings and its own report sink, proving the shared helper carries either
  // site's wording. Success timing (ready quickly).
  const s4 = await page.evaluate(async () => {
    window.__posted = [];
    window.__readyAfterCalls = 1; window.__statusSinceRestart = 0;   // gap then ready
    window.__docLine = '';
    const said = 'Added and restarted, and said hello to wake April.';
    const manual = 'Added and restarted. You will need to say ‘hello’ to April to wake them.';
    await autoHelloAfterRestart('april', (t) => { window.__docLine = t; }, said, manual);
    const thread = window.__posted.filter((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && p.method === 'POST');
    return { line: window.__docLine, threadCalls: thread.length, said };
  });
  check('doctrine-phrasing: the helper sends one hello for the second site too', s4.threadCalls === 1, 'calls=' + s4.threadCalls);
  check('doctrine-phrasing: it reports the doctrine flow\'s own "said hello" line', s4.line === s4.said, JSON.stringify(s4.line));

  // ---- Arm 5: a send that did NOT reach the agent (unconfirmed) -> manual ----
  // A wake that could not be confirmed placed must not read as "said hello".
  const s5 = await page.evaluate(async () => {
    window.__posted = [];
    window.__readyAfterCalls = 1; window.__statusSinceRestart = 0;   // gap then ready
    window.__threadResp = { recorded: true, delivery: { state: 'unconfirmed', because: 'we could not tell whether it arrived' } };
    window.__line = '';
    const said = 'X-said';
    const manual = 'X-manual';
    await autoHelloAfterRestart('april', (t) => { window.__line = t; }, said, manual);
    window.__threadResp = { recorded: true, delivery: { state: 'placed' } };  // restore
    return { line: window.__line };
  });
  check('unconfirmed send: never claims "said hello" when delivery was not placed', s5.line === 'X-manual', JSON.stringify(s5.line));

  // ---- Arm 6: the thread POST THROWS (network drop) -> manual, note resolves ----
  // Guards the catch block: a bad supersession check there would return without
  // reporting, leaving the notice stuck on the interim "Waking..." line forever.
  const s6 = await page.evaluate(async () => {
    window.__posted = [];
    window.__readyAfterCalls = 1; window.__statusSinceRestart = 0;   // gap then ready
    window.__line = 'Waking...';
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (/\/api\/agent\/[^/]+\/thread$/.test(String(url)) && (opts && opts.method) === 'POST') {
        throw new Error('network drop');
      }
      return realFetch(url, opts);
    };
    const said = 'Y-said';
    const manual = 'Y-manual';
    await autoHelloAfterRestart('april', (t) => { window.__line = t; }, said, manual);
    window.fetch = realFetch;   // restore
    return { line: window.__line };
  });
  check('thread throws: the notice resolves to the manual line (not stuck on "Waking")', s6.line === 'Y-manual', JSON.stringify(s6.line));

  // ---- Arm 7: the note node is DETACHED mid-wait, the real stale-notice case ----
  // On the stale-instructions notice, renderStale regenerates #d-instr-stale
  // (setLive innerHTML=) on every tick, so the captured note is detached before
  // the async resolution. Driving the real rst-go handler and removing the note
  // node mid-wait must still fire the wake hello and must not throw (the
  // isConnected guard no-ops the dead write instead of crashing the resolution).
  await page.evaluate(() => {
    window.__posted = [];
    window.__readyAfterCalls = 2; window.__statusSinceRestart = 0;
    document.querySelector('#__ah .instr-restart-note').textContent = '';
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  await page.click('#rst-go');
  // Remove the note node while the readiness wait is in flight (renderStale's
  // setLive(innerHTML=) has the same detaching effect on the real notice).
  await page.evaluate(() => { const n = document.querySelector('#__ah .instr-restart-note'); if (n) n.remove(); });
  await page.waitForFunction(
    () => window.__posted.some((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && (p.method === 'POST')),
    { timeout: 4000 },
  ).catch(() => {});
  const s7 = await page.evaluate(() => ({
    threadCalls: window.__posted.filter((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && p.method === 'POST').length,
  }));
  check('detached note: the wake hello still fires when the notice was regenerated away', s7.threadCalls === 1, 'calls=' + s7.threadCalls);

  // ---- Arm 8: the person NAVIGATES to another agent mid-wait ----
  // On the detail-page control the note (d-restart-msg) is shared across agents
  // and stays connected, so isConnected alone would let agent A's resolution land
  // in agent B's open dialog. The CURRENT.sessionName===name guard must suppress
  // it. The wake hello still fires (it is not gated on who is viewing).
  await page.evaluate(() => {
    window.__posted = [];
    window.__readyAfterCalls = 2; window.__statusSinceRestart = 0;
    // Rebuild the host: arm 7 removed the note node, so recreate it fresh.
    document.querySelector('#__ah').innerHTML =
      '<div class="row"><button type="button" data-restart-agent="april">Restart</button>'
      + '<span class="instr-restart-note"></span></div>';
    CURRENT = { sessionName: 'april', name: 'April' };
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  await page.click('#rst-go');
  // Navigate away: CURRENT becomes a different agent while the wait is in flight.
  await page.evaluate(() => { CURRENT = { sessionName: 'other', name: 'Other' }; });
  await page.waitForFunction(
    () => window.__posted.some((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && (p.method === 'POST')),
    { timeout: 4000 },
  ).catch(() => {});
  const s8 = await page.evaluate(() => ({
    threadCalls: window.__posted.filter((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && p.method === 'POST').length,
    note: (document.querySelector('#__ah .instr-restart-note') || {}).textContent || '',
  }));
  check('navigate-away: the wake hello still fires for the restarted agent', s8.threadCalls === 1, 'calls=' + s8.threadCalls);
  check('navigate-away: the resolution does NOT land in the other agent\'s dialog', s8.note !== SAID, JSON.stringify(s8.note));
  // Restore CURRENT so a later re-use of the page starts clean.
  await page.evaluate(() => { CURRENT = { sessionName: 'april', name: 'April' }; });

  if (pageErrors.length) check('no page/console errors during the run', false, pageErrors.join(' | '));
  else check('no page/console errors during the run', true);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (failed.length ? 'FAIL  ' + failed.length + ' of ' + results.length + ' checks failed'
    : 'PASS  all ' + results.length + ' checks passed'));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('FAIL  render-autohello-2686: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});

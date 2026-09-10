'use strict';

/**
 * kosmos#2633 (follow-up to #2628): the SILENT world-switch abandon is now VISIBLE.
 *
 * #2628 shipped a user-facing message in `worldswReconnect` (web/index.html): when a
 * switch reports restarting:true but the board comes back on Kosmos 1 having ABANDONED
 * the world you asked for (engine/worldenv + engine/worldbootguard, the #2528 lockout
 * recovery), the client used to poll a bare "Switching..." spinner for the whole ~150s
 * ceiling. Now it says at once: `"<name>" could not start, so Kosmos brought you back to
 * Kosmos 1. Check the board log for why, or try switching again.` -- and does NOT reload
 * (the board is on Kosmos 1 and the point is that the person reads why). The engine
 * abandon SIGNAL is unit-tested in engine/worldenv.abandon-2628.test.js; #2628 shipped
 * the UI branch under a Browser-check trailer with no browser check. This is that check.
 *
 * The abandon is guarded so a STALE abandon from an EARLIER boot cannot fire it:
 *   `abandoned.id === switchedId && Number(abandoned.at) > switchStart`
 * where switchStart is captured in worldswSwitch BEFORE the POST. lastAbandonedWorld
 * persists for the life of a board, so without the `at > switchStart` guard the
 * still-running old board's stale value would fire the banner the instant the poll
 * first reached it -- a false abandon on a switch that is actually still restarting.
 *
 * Two scenarios, hermetic (file://), the board stubbed:
 *  - A (FRESH abandon): POST -> restarting:true for w2; /api/status reports the board
 *    back on the DEFAULT world w1 (never w2) AND lastAbandonedWorld = { id:w2, at:AFTER
 *    the switch }. The banner must read `"Side Project" could not start, so Kosmos
 *    brought you back to Kosmos 1...`, the switcher menu (which holds the banner) stays
 *    open, and worldswReload is NEVER called.
 *  - B (STALE abandon -- the guard): same, but lastAbandonedWorld.at is OLDER than the
 *    switch start. The abandon banner must NOT fire; the reconnect falls through to the
 *    normal slow ("taking longer than usual") then timeout ("taking a while to restart")
 *    guidance, and still never reloads.
 *
 * CONTROL (red without the #2628 branch): remove the abandon branch in worldswReconnect
 * and scenario A reds -- the banner never becomes the abandon message (it falls through
 * to the slow/timeout guidance), so `sawAbandon`/`namedWorld` go red. Scenario B is the
 * negative arm proving the probe is not just asserting the message is always present: a
 * stale abandon must NOT produce it.
 *
 * ⚠️ WHY A BROWSER. engine/worldenv.abandon-2628 proves the SIGNAL; it cannot prove a
 * real DOM turns lastAbandonedWorld into the right banner, keys the guard on the switch
 * time, and withholds the reload. Hermetic (file://), no board -- /api/status and
 * /api/worlds(/active) are stubbed. This reuses the #1704/#2238 switcher flow (row click
 * -> #6 confirm modal -> "Restart Kosmos"); it keeps its own minimal abandon stub rather
 * than folding into render-worldswitch-2238.js's stateful reboot-poll machinery (that
 * file is Angel's active lane). See kosmos#2633.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-worldsw-abandon-2628.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldsw-abandon-2628: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldsw-abandon-2628: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const bannerMsg = () => (document.getElementById('worldsw-restart-msg').textContent || '');
    const bannerHidden = () => document.getElementById('worldsw-restart').hidden;
    const menuHidden = () => document.getElementById('worldsw-menu').hidden;

    // Stub state. registryActive is what the SWITCH flips instantly (GET /api/worlds
    // reflects it). bootedActive is what a LIVE board reports on /api/status.activeWorldId
    // -- and the whole point of an abandon is that it STAYS on w1 (Kosmos 1), never
    // flipping to the switched-to w2. abandonMode drives lastAbandonedWorld on /api/status.
    let registryActive = 'w1';
    let bootedActive = 'w1';
    let abandonMode = 'off';           // 'off' | 'fresh' | 'stale'
    const calls = [];
    let reloadCount = 0;

    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      const method = (opts && opts.method) || 'GET';
      if (url.indexOf('/api/worlds/active') !== -1 && method === 'POST') {
        const id = JSON.parse((opts && opts.body) || '{}').id;
        calls.push({ url: '/api/worlds/active', id });
        registryActive = id;   // the registry pointer flips instantly on switch
        const world = { id, name: id === 'w2' ? 'Side Project' : 'Home' };
        // restarting:true -- the board self-restarts, but (this check's whole point) it
        // ABANDONS the switch and comes back on Kosmos 1: bootedActive stays 'w1'.
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: true, restarting: true }) });
      }
      if (url.indexOf('/api/status') !== -1 && method === 'GET') {
        const body = { activeWorldId: bootedActive };
        // FRESH: stamped AFTER the switch (Date.now()+60s is unambiguously > switchStart,
        // which was captured before the POST, so no ms-equality flake). STALE: stamped
        // BEFORE the switch (an earlier boot's abandon), so the `at > switchStart` guard
        // must reject it.
        if (abandonMode === 'fresh') body.lastAbandonedWorld = { id: 'w2', name: 'Side Project', at: Date.now() + 60000 };
        else if (abandonMode === 'stale') body.lastAbandonedWorld = { id: 'w2', name: 'Side Project', at: Date.now() - 60000 };
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      if (url.indexOf('/api/worlds') !== -1 && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds: [{ id: 'w1', name: 'Home' }, { id: 'w2', name: 'Side Project' }], activeWorldId: registryActive }) });
      }
      return realFetch(u, opts);
    };
    if (typeof worldsFetch !== 'function') return { error: 'worldsFetch is not a function' };
    if (typeof worldswReload !== 'function') return { error: 'worldswReload is not a function (reconnect reload not wired)' };
    if (typeof WORLDSW_RECONNECT_INTERVAL_MS === 'undefined') return { error: 'WORLDSW_RECONNECT_INTERVAL_MS missing -- cannot speed the reconnect poll' };

    // Speed the reconnect poll; observe the reload instead of navigating.
    WORLDSW_RECONNECT_INTERVAL_MS = 15;
    worldswReload = () => { reloadCount += 1; };

    // The real switch flow (#6): a row click opens the confirm modal; only "Restart
    // Kosmos" (#world-switch-go) runs the switch. Drive both, like render-worldswitch-2238.
    const clickSide = async () => {
      // Open the switcher menu first, the way a person does: the status banner lives
      // INSIDE #worldsw-menu, so the whole point of the abandon guidance depends on the
      // menu being open. worldswReconnect (WORLDSW_RECONNECTING) keeps it open across the
      // poll; this check asserts it is still open once the abandon banner shows.
      if (typeof worldswOpen === 'function') worldswOpen();
      const rows = [...document.querySelectorAll('#worldsw-list .worldsw-row')];
      const side = rows.find((el) => /Side Project/.test(el.textContent || ''));
      if (!side) return { error: 'no Side Project row rendered' };
      side.click();
      const go = document.getElementById('world-switch-go');
      if (!go) return { error: 'the row click did not open the #6 confirm modal (#world-switch-go absent)' };
      go.click();
      return {};
    };
    const waitFor = async (pred, capMs) => {
      const end = Date.now() + capMs;
      while (Date.now() < end) { if (pred()) return true; await sleep(15); }
      return pred();
    };
    const ABANDON_RE = /could not start, so kosmos brought you back to kosmos 1/i;

    // ---- Scenario A: FRESH abandon -> the abandon banner, menu stays open, NO reload ----
    abandonMode = 'fresh';
    registryActive = 'w1'; bootedActive = 'w1'; reloadCount = 0; calls.length = 0;
    WORLDSW_RECONNECT_SLOW_MS = 100000;   // keep the slow guidance out of the way; the abandon fires on the first poll
    WORLDSW_RECONNECT_TIMEOUT_MS = 4000;
    await worldsFetch(); await sleep(10);
    const cA = await clickSide();
    if (cA.error) return { error: cA.error };
    const sawAbandon = await waitFor(() => ABANDON_RE.test(bannerMsg()), 3000);
    const abandonMsg = bannerMsg();
    await sleep(80);   // give any (wrong) reload a chance to happen
    const afterFresh = {
      switchPosted: calls.some((c) => c.id === 'w2'),
      sawAbandon,
      abandonMsg,
      namedWorld: /"side project" could not start/i.test(abandonMsg),
      reloaded: reloadCount > 0,
      menuOpen: !menuHidden(),
      bannerVisible: !bannerHidden(),   // the banner region itself must be shown, not just have text set
    };

    // ---- Scenario B: STALE abandon (older than the switch) -> banner does NOT fire;
    //      falls through to the normal slow -> timeout reconnect guidance, still no reload ----
    abandonMode = 'stale';
    registryActive = 'w1'; bootedActive = 'w1'; reloadCount = 0; calls.length = 0;
    WORLDSW_RECONNECT_SLOW_MS = 40;
    WORLDSW_RECONNECT_TIMEOUT_MS = 300;
    await worldsFetch(); await sleep(10);
    const cB = await clickSide();
    if (cB.error) return { error: cB.error };
    const sawSlow = await waitFor(() => /taking longer than usual/i.test(bannerMsg()), 2000);
    const sawTimeout = await waitFor(() => /taking a while to restart/i.test(bannerMsg()), 2000);
    const afterStale = {
      abandonFired: ABANDON_RE.test(bannerMsg()),   // must be false for a stale abandon
      sawSlow,
      sawTimeout,
      reloaded: reloadCount > 0,
      finalMsg: bannerMsg(),
    };

    return { afterFresh, afterStale };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push('the check could not run: ' + r.error);
  if (!r.error) {
    // Scenario A: a fresh switch-abandon is surfaced, named, and does not reload.
    const a = r.afterFresh;
    if (!a.switchPosted) problems.push('scenario A setup: the switch never POSTed /api/worlds/active {id:w2}');
    if (!a.sawAbandon) problems.push('a fresh switch-abandon (board back on Kosmos 1, lastAbandonedWorld.id===switched, at>switchStart) must show the "could not start, so Kosmos brought you back to Kosmos 1" banner, but it did not (got "' + a.abandonMsg + '")');
    if (!a.namedWorld) problems.push('the abandon banner must NAME the world it could not start ("Side Project" could not start...), got "' + a.abandonMsg + '"');
    if (a.reloaded) problems.push('an abandoned switch must NOT reload -- the board is back on Kosmos 1 and the point is that the person reads why (worldswReload was called)');
    if (!a.menuOpen) problems.push('the switcher menu (which contains the banner) must stay open so the abandon guidance stays visible');
    if (!a.bannerVisible) problems.push('the #worldsw-restart banner region must be unhidden so the abandon guidance is actually shown, not just set as text on a hidden region');

    // Scenario B: the stale-abandon guard -- an earlier boot's abandon must not fire it.
    const b = r.afterStale;
    if (b.abandonFired) problems.push('THE STALE-ABANDON GUARD: a lastAbandonedWorld older than the switch start (an EARLIER boot\'s abandon) must NOT fire the abandon banner, but it did -- the `at > switchStart` guard is not holding');
    if (!b.sawSlow) problems.push('a stale abandon must fall through to the normal reconnect: the slow banner ("taking longer than usual") should appear, but it did not (got "' + b.finalMsg + '")');
    if (!b.sawTimeout) problems.push('a stale abandon must land on the timeout fallback ("taking a while to restart") after the ceiling, but it did not (got "' + b.finalMsg + '")');
    if (b.reloaded) problems.push('a stale abandon whose board never reboots must NOT reload');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-worldsw-abandon-2628: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldsw-abandon-2628: a fresh world-switch abandon (board back on Kosmos 1, lastAbandonedWorld matching the switched world and stamped after the switch) shows the "could not start, so Kosmos brought you back" banner naming the world and does NOT reload; a STALE abandon from an earlier boot does not fire the banner and falls through to the normal slow/timeout reconnect guidance. Neither false-succeeds.');
})();

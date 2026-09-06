'use strict';

/**
 * kosmos#2238: the multiple-Kosmos SWITCH is wired, actionable, and reconnects. On
 * 0.6.35 the switcher rows were READ-ONLY (create worked, selecting a world did
 * nothing) -- Josh's bug. #2346 landed the fail-safe board self-restart, so
 * POST /api/worlds/active now returns a FINAL { restartRequired, restarting } and the
 * client acts on it. This drives the real switcher UI against a stubbed board and
 * asserts the whole client flow across the three server outcomes:
 *
 *  - a NON-active row is a real, actionable menuitem and clicking it calls
 *    POST /api/worlds/active with that world's id (the switch the old rows never made);
 *  - restarting:true  -> the board is self-restarting: the banner reads "Switching...",
 *    the client POLLS /api/status.activeWorldId (the BOOTED world), and RELOADS only
 *    once that flips to the new world. The poll keys on the booted world, NOT the
 *    registry pointer (which the switch flips instantly) -- so we assert it observed the
 *    OLD id at least once before the reboot, proving the false-success race is closed;
 *  - restarting:false (real restartRequired) -> a from-source / unmanaged board: an
 *    HONEST manual-restart banner, NO reconnect, NO reload;
 *  - restartRequired:false -> a no-op switch to the already-booted world: "already your
 *    active Kosmos", NO reload.
 *
 * The CONTROL that proves the probe can see a real switch: the pre-fix page has no click
 * handler on .worldsw-row, so the POST-called + marker-moved + reload assertions red on it.
 *
 * A browser check speeds the reconnect poll via WORLDSW_RECONNECT_INTERVAL_MS /
 * _TIMEOUT_MS (module `let`s), and stubs worldswReload so a confirmed switch is observed
 * without navigating the test page.
 *
 * ⚠️ WHY A BROWSER. A source test can read that worldswSwitch posts and polls; it cannot
 * prove a rendered row invokes it, that the marker moves, and that the reconnect actually
 * reloads on the booted-world flip in a real DOM. Hermetic (file://), no board. The
 * server endpoint is stubbed.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-worldswitch-2238.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldswitch-2238: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldswitch-2238: could not start a browser'
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

    // Stub state. registryActive is what the SWITCH flips instantly (GET /api/worlds
    // reflects it, so the rendered marker moves at once). bootedActive is what a LIVE
    // board reports on /api/status.activeWorldId -- it stays on the OLD world until the
    // board "reboots", which we simulate on a timer after a restarting:true switch.
    let registryActive = 'w1';
    let bootedActive = 'w1';
    let postMode = 'restarting';            // 'restarting' | 'manual' | 'noop'
    const calls = [];
    const statusObserved = [];              // every activeWorldId the reconnect poll saw
    let reloadCount = 0;

    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      const method = (opts && opts.method) || 'GET';
      if (url.indexOf('/api/worlds/active') !== -1 && method === 'POST') {
        const id = JSON.parse((opts && opts.body) || '{}').id;
        calls.push({ url: '/api/worlds/active', id });
        registryActive = id;
        const world = { id, name: id === 'w2' ? 'Side Project' : 'Home' };
        if (postMode === 'noop') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: false, restarting: false }) });
        }
        if (postMode === 'manual') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: true, restarting: false }) });
        }
        // restarting:true -- the board self-restarts; simulate the reboot flipping the
        // BOOTED world after a short delay (several poll intervals at the sped-up cadence).
        setTimeout(() => { bootedActive = id; }, 90);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: true, restarting: true }) });
      }
      if (url.indexOf('/api/status') !== -1 && method === 'GET') {
        statusObserved.push(bootedActive);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ activeWorldId: bootedActive }) });
      }
      if (url.indexOf('/api/worlds') !== -1 && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds: [{ id: 'w1', name: 'Home' }, { id: 'w2', name: 'Side Project' }], activeWorldId: registryActive }) });
      }
      return realFetch(u, opts);
    };
    if (typeof worldsFetch !== 'function') return { error: 'worldsFetch is not a function' };
    if (typeof worldswReload !== 'function') return { error: 'worldswReload is not a function (reconnect reload not wired)' };

    // Speed the reconnect poll; observe the reload instead of navigating.
    WORLDSW_RECONNECT_INTERVAL_MS = 15;
    WORLDSW_RECONNECT_TIMEOUT_MS = 4000;
    worldswReload = () => { reloadCount += 1; };

    const clickSide = async () => {
      const rows = [...document.querySelectorAll('#worldsw-list .worldsw-row')];
      const side = rows.find((el) => /Side Project/.test(el.textContent || ''));
      if (!side) return { error: 'no Side Project row rendered' };
      side.click();  // proves the row (not a direct call) invokes the switch
      return { rows };
    };
    const waitFor = async (pred, capMs) => {
      const end = Date.now() + capMs;
      while (Date.now() < end) { if (pred()) return true; await sleep(15); }
      return pred();
    };

    // ---- initial render + the read-only-rows control ----
    await worldsFetch();
    await sleep(10);
    const rows0 = [...document.querySelectorAll('#worldsw-list .worldsw-row')];
    const before = {
      rowCount: rows0.length,
      activeName: (document.getElementById('worldsw-name').textContent || '').trim(),
      sideIsActionable: rows0.some((el) => el.tagName === 'BUTTON' && /Side Project/.test(el.textContent || '')),
      activeNotButton: rows0.some((el) => el.getAttribute('aria-current') === 'true' && el.tagName !== 'BUTTON' && /Home/.test(el.textContent || '')),
      bannerHiddenInitially: bannerHidden(),
    };

    // ---- Scenario A: restarting:true -> Switching..., poll booted world, reload on flip ----
    postMode = 'restarting';
    const cA = await clickSide();
    if (cA.error) return { error: cA.error };
    // The banner should read "Switching..." while the board restarts.
    const sawSwitching = await waitFor(() => /switching to side project/i.test(bannerMsg()), 500);
    const switchingMsg = bannerMsg();
    // The reconnect must reload once the BOOTED world flips (not before).
    const reloaded = await waitFor(() => reloadCount > 0, 3000);
    const afterRestarting = {
      switchPosted: calls.some((c) => c.url === '/api/worlds/active' && c.id === 'w2'),
      activeName: (document.getElementById('worldsw-name').textContent || '').trim(),
      sawSwitching, switchingMsg,
      reloaded,
      finalMsg: bannerMsg(),
      observedOldBeforeFlip: statusObserved.indexOf('w1') !== -1,   // polled the old booted id first
      observedNewId: statusObserved.indexOf('w2') !== -1,
    };

    // ---- Scenario B: restarting:false (manual) -> honest manual banner, no reconnect ----
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'manual';
    reloadCount = 0; statusObserved.length = 0;
    await worldsFetch(); await sleep(10);
    const cB = await clickSide();
    if (cB.error) return { error: cB.error };
    await waitFor(() => /restart kosmos/i.test(bannerMsg()), 500);
    await sleep(60);  // give any (wrongly-fired) reconnect a chance to poll
    const afterManual = {
      msg: bannerMsg(),
      polled: statusObserved.length,
      reloaded: reloadCount > 0,
    };

    // ---- Scenario C: restartRequired:false -> no-op, already active, no reload ----
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'noop';
    reloadCount = 0; statusObserved.length = 0;
    await worldsFetch(); await sleep(10);
    const cC = await clickSide();
    if (cC.error) return { error: cC.error };
    await waitFor(() => /already/i.test(bannerMsg()), 500);
    await sleep(60);
    const afterNoop = {
      msg: bannerMsg(),
      polled: statusObserved.length,
      reloaded: reloadCount > 0,
    };

    return { before, afterRestarting, afterManual, afterNoop };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  if (!r.error) {
    // baseline render + control
    if (r.before.rowCount !== 2) problems.push('expected 2 world rows, got ' + r.before.rowCount);
    if (!r.before.sideIsActionable) problems.push('the non-active row is not an actionable native <button> -- this is the #2238 read-only-rows bug');
    if (!r.before.activeNotButton) problems.push('the active row should be a non-interactive element (aria-current, not a button)');
    if (r.before.bannerHiddenInitially !== true) problems.push('the status banner should be hidden before any switch');
    if (r.before.activeName !== 'Home') problems.push('expected the active name "Home" initially, got "' + r.before.activeName + '"');

    // Scenario A: restarting:true -> switching banner, poll booted world, reload on flip
    const a = r.afterRestarting;
    if (!a.switchPosted) problems.push('clicking a world row did NOT POST /api/worlds/active {id:w2} -- the switch is not wired (the exact 0.6.35 bug)');
    if (a.activeName !== 'Side Project') problems.push('after switching, the promoted name should be "Side Project", got "' + a.activeName + '"');
    if (!a.sawSwitching) problems.push('on restarting:true the banner should read "Switching to <world>...", got "' + a.switchingMsg + '"');
    if (!a.reloaded) problems.push('on restarting:true the client should RELOAD once the board reboots onto the new world (worldswReload never fired)');
    if (!a.observedOldBeforeFlip) problems.push('the reconnect poll never observed the OLD booted world before the flip -- the false-success race is not closed (it must key on /api/status.activeWorldId, the booted world, not the registry pointer)');
    if (!a.observedNewId) problems.push('the reconnect poll never observed the NEW booted world -- it did not confirm the reboot before reloading');

    // Scenario B: manual -> honest banner, no reconnect/reload
    const b = r.afterManual;
    if (!/restart kosmos/i.test(b.msg)) problems.push('on restarting:false the banner should give the manual "restart Kosmos" guidance, got "' + b.msg + '"');
    if (b.reloaded) problems.push('a manual (restarting:false) switch must NOT auto-reload');
    if (b.polled !== 0) problems.push('a manual (restarting:false) switch must NOT poll /api/status (no reconnect), but it polled ' + b.polled + ' time(s)');

    // Scenario C: no-op -> already active, no reload
    const c = r.afterNoop;
    if (!/already/i.test(c.msg)) problems.push('a no-op switch (restartRequired:false) should say the world is already active, got "' + c.msg + '"');
    if (c.reloaded) problems.push('a no-op switch must NOT reload');
    if (c.polled !== 0) problems.push('a no-op switch must NOT poll /api/status, but it polled ' + c.polled + ' time(s)');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-worldswitch-2238: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldswitch-2238: switcher rows switch the active Kosmos (POST /api/worlds/active); restarting:true shows "Switching...", polls the BOOTED world (race-safe), and reloads on the confirmed flip; restarting:false gives honest manual guidance with no reconnect; a no-op switch says already-active. None false-succeed.');
})();

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
 * #6 EXTENSION: a row click now opens a switch-CONFIRM modal (Josh: switching a Kosmos is
 * not silent/inline) and only "Restart Kosmos" runs the real switch. Scenario G asserts the
 * modal appears (Josh-verbatim title, no POST on open), Cancel does not switch and leaves the
 * menu open, and -- the regression guard -- the #worldsw-restart banner (which lives INSIDE
 * the switcher menu) survives the Restart click: the modal sits OUTSIDE #worldsw, so without
 * excluding it from the switcher's outside-click handler that click ran worldswClose() and
 * cleared the banner mid-switch, hiding the manual/fallback guidance the person needs.
 *
 * CONTROLS (confirmed red-without-fix, then restored): the banner-survival guard (remove
 * the #world-switch-modal exclusion -> menuStillOpen / afterCancel.menuOpen / scenario F
 * red), the focus-restore guard (remove worldswFocusTrigger on the error path ->
 * afterErrFocus.focusRestored red, activeId ""), and the in-flight-confirm guard (remove
 * the WORLDSW_SWITCHING early-return -> midSwitchModalHidden red). The remaining #6
 * assertions (modal-appears, Josh-verbatim title, focus-on-Cancel-on-open) are structurally
 * falsifiable -- each pins an exact id/text/element -- rather than perturbation-demonstrated.
 *
 * #1704 PR3 EXTENSION (Josh: the dialog asks each time): Scenario J asserts the two
 * choices ("Pause this Kosmos's agents" / "Keep them running") are rendered as labelled
 * radios, neither preselected; "Restart Kosmos" is disabled (a click posts nothing) until
 * one is chosen; the chosen value rides in the POST body as `agents`; a reopened dialog
 * asks again; and notPaused names lead the status line. The other scenarios answer
 * "keep" before confirming (confirmSwitchGo), which is the switch they always made.
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
    const menuHidden = () => document.getElementById('worldsw-menu').hidden;

    // Stub state. registryActive is what the SWITCH flips instantly (GET /api/worlds
    // reflects it, so the rendered marker moves at once). bootedActive is what a LIVE
    // board reports on /api/status.activeWorldId -- it stays on the OLD world until the
    // board "reboots", which we simulate on a timer after a restarting:true switch.
    let registryActive = 'w1';
    let bootedActive = 'w1';
    // #2454b: GET /api/worlds now also carries bootedWorldId (the world the board
    // actually BOOTED into), and the client marks the CURRENT world by it, falling
    // back to activeWorldId when it is absent. Scenarios A-H leave this false so the
    // fallback path keeps their behaviour byte-identical; Scenario I turns it on to
    // exercise the divergence (pointer flipped, board not yet rebooted).
    let sendBooted = false;
    let postMode = 'restarting';            // 'restarting' | 'manual' | 'noop'
    // The simulated reboot flips the booted world after this many /api/status polls, so
    // the reconnect deterministically observes the OLD booted world at least once first.
    const REBOOT_AFTER_POLLS = 2;
    let pendingReboot = false;
    let rebootPollsSeen = 0;
    const calls = [];
    const statusObserved = [];              // every activeWorldId the reconnect poll saw
    let reloadCount = 0;

    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      const method = (opts && opts.method) || 'GET';
      if (url.indexOf('/api/worlds/active') !== -1 && method === 'POST') {
        const sent = JSON.parse((opts && opts.body) || '{}');
        const id = sent.id;
        calls.push({ url: '/api/worlds/active', id, agents: sent.agents });
        registryActive = id;
        const world = { id, name: id === 'w2' ? 'Side Project' : 'Home' };
        if (postMode === 'manual-notpaused') {
          // #1704 PR3: a pause-switch where one agent could not be stopped.
          return Promise.resolve({ ok: true, status: 200, json: async () => ({
            ok: true, world, restartRequired: true, restarting: false,
            agents: sent.agents, paused: [], notPaused: [{ name: 'ava', because: 'we could not stop ava, so it keeps running' }],
          }) });
        }
        if (postMode === 'err409') {
          // A non-ok response (another world op in progress): worldswSwitch shows the
          // guidance and must restore focus to the trigger (#6: the confirm button was
          // destroyed on the way in).
          return Promise.resolve({ ok: false, status: 409, json: async () => ({ because: 'Another Kosmos operation is in progress. Try again in a moment.' }) });
        }
        if (postMode === 'noop') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: false, restarting: false }) });
        }
        if (postMode === 'manual') {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: true, restarting: false }) });
        }
        if (postMode === 'restart-stuck') {
          // restarting:true but the board's self-restart silently no-ops: the booted
          // world NEVER flips (pendingReboot left false), so the poll runs to the slow
          // threshold and then the timeout, and must never reload.
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: true, restarting: true }) });
        }
        if (postMode === 'restart-norequire') {
          // Contract-INVALID shape (the server never sends restarting:true with
          // restartRequired:false), used to prove the client checks restarting BEFORE
          // noop: it must RECONNECT (the board is restarting), not treat it as a no-op.
          pendingReboot = true;
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: false, restarting: true }) });
        }
        // restarting:true -- the board self-restarts; the reboot flips the BOOTED world
        // on a poll COUNT (see the status stub), not a wall-clock timer, so the "observed
        // the OLD id before the flip" control cannot flake on event-loop timing.
        pendingReboot = true;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world, restartRequired: true, restarting: true }) });
      }
      if (url.indexOf('/api/status') !== -1 && method === 'GET') {
        // Simulate the board rebooting onto the new world: report the OLD booted world
        // for the first REBOOT_AFTER_POLLS polls, then flip. Deterministic in poll count
        // (not wall-clock), so the reconnect ALWAYS observes the old id first (poll #1)
        // and the new id on the flip poll -- the race-safe assertion cannot flake.
        if (pendingReboot) {
          rebootPollsSeen += 1;
          if (rebootPollsSeen >= REBOOT_AFTER_POLLS) { bootedActive = registryActive; pendingReboot = false; rebootPollsSeen = 0; }
        }
        const reported = bootedActive;   // capture post-flip so statusObserved == what was returned
        statusObserved.push(reported);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ activeWorldId: reported }) });
      }
      if (url.indexOf('/api/worlds') !== -1 && method === 'GET') {
        const body = { worlds: [{ id: 'w1', name: 'Home' }, { id: 'w2', name: 'Side Project' }], activeWorldId: registryActive };
        if (sendBooted) body.bootedWorldId = bootedActive;   // #2454b: the real server always sends this
        return Promise.resolve({ ok: true, status: 200, json: async () => body });
      }
      return realFetch(u, opts);
    };
    if (typeof worldsFetch !== 'function') return { error: 'worldsFetch is not a function' };
    if (typeof worldswReload !== 'function') return { error: 'worldswReload is not a function (reconnect reload not wired)' };

    // Speed the reconnect poll; observe the reload instead of navigating.
    WORLDSW_RECONNECT_INTERVAL_MS = 15;
    WORLDSW_RECONNECT_TIMEOUT_MS = 4000;
    worldswReload = () => { reloadCount += 1; };

    // #6: a row click no longer switches inline -- it opens the switch-CONFIRM modal
    // (worldswConfirmSwitch), and only "Restart Kosmos" (world-switch-go) runs the real
    // switch. So the row-invokes-the-switch proof is now two steps: click the row, then
    // confirm. clickSide does both so the downstream scenarios (banner/POST/reload) still
    // exercise the whole flow; clickRowOnly stops at the modal for the #6 modal scenario.
    const clickRowOnly = async () => {
      const rows = [...document.querySelectorAll('#worldsw-list .worldsw-row')];
      const side = rows.find((el) => /Side Project/.test(el.textContent || ''));
      if (!side) return { error: 'no Side Project row rendered' };
      side.click();  // proves the row (not a direct call) opens the confirm modal
      return { rows };
    };
    // #1704 PR3: Restart is disabled until the pause/keep question is answered, so the
    // confirm answers it first ("keep", the switch these scenarios always made).
    const confirmSwitchGo = () => {
      document.getElementById('world-switch-keep').click();
      document.getElementById('world-switch-go').click();
    };
    const clickSide = async () => {
      const r = await clickRowOnly();
      if (r.error) return r;
      confirmSwitchGo();  // confirm the modal -> worldswSwitch runs
      return r;
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
    pendingReboot = false; rebootPollsSeen = 0;
    reloadCount = 0; statusObserved.length = 0;
    await worldsFetch(); await sleep(10);
    const cB = await clickSide();
    if (cB.error) return { error: cB.error };
    await waitFor(() => /quit and reopen kosmos/i.test(bannerMsg()), 500);
    await sleep(60);  // give any (wrongly-fired) reconnect a chance to poll
    const afterManual = {
      msg: bannerMsg(),
      polled: statusObserved.length,
      reloaded: reloadCount > 0,
    };

    // ---- Scenario C: restartRequired:false -> no-op, already active, no reload ----
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'noop';
    pendingReboot = false; rebootPollsSeen = 0;
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

    // ---- Scenario D: contract-invalid restarting:true + restartRequired:false ----
    // The client must check restarting BEFORE noop, so this RECONNECTS (the board is
    // restarting) rather than being mistaken for an already-active no-op.
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'restart-norequire';
    pendingReboot = false; rebootPollsSeen = 0;
    reloadCount = 0; statusObserved.length = 0;
    await worldsFetch(); await sleep(10);
    const cD = await clickSide();
    if (cD.error) return { error: cD.error };
    const dReloaded = await waitFor(() => reloadCount > 0, 3000);
    const afterInvalid = {
      reloaded: dReloaded,
      polled: statusObserved.length,
      saidAlready: /already/i.test(bannerMsg()),
    };

    // ---- Scenario E: restarting:true but the board never reboots (self-restart no-op) ----
    // The banner must offer the manual escape hatch at the SLOW threshold, then land on
    // the timeout fallback, and must NEVER reload.
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'restart-stuck';
    pendingReboot = false; rebootPollsSeen = 0; reloadCount = 0; statusObserved.length = 0;
    WORLDSW_RECONNECT_SLOW_MS = 40;
    WORLDSW_RECONNECT_TIMEOUT_MS = 500;
    await worldsFetch(); await sleep(10);
    const cE = await clickSide();
    if (cE.error) return { error: cE.error };
    const slowSeen = await waitFor(() => /taking longer than usual/i.test(bannerMsg()), 900);
    const finalSeen = await waitFor(() => /taking a while to restart/i.test(bannerMsg()), 1500);
    await sleep(30);
    const afterStuck = {
      slowSeen, finalSeen,
      reloaded: reloadCount > 0,
      polled: statusObserved.length,
      guardReleased: (typeof WORLDSW_SWITCHING === 'boolean') ? WORLDSW_SWITCHING === false : null,
    };

    // ---- Scenario F: closing the menu DURING a reconnect keeps it open (guidance stays) ----
    // The status banner lives inside the menu, so a close would hide the reconnect
    // guidance. worldswClose must no-op while a reconnect is polling, then work again once
    // it ends.
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'restart-stuck';
    pendingReboot = false; rebootPollsSeen = 0; reloadCount = 0; statusObserved.length = 0;
    WORLDSW_RECONNECT_SLOW_MS = 40;
    WORLDSW_RECONNECT_TIMEOUT_MS = 600;
    await worldsFetch(); await sleep(10);
    if (typeof worldswOpen === 'function') worldswOpen();
    const menuEl = document.getElementById('worldsw-menu');
    const cF = await clickSide();
    if (cF.error) return { error: cF.error };
    await waitFor(() => typeof WORLDSW_RECONNECTING !== 'undefined' && WORLDSW_RECONNECTING === true, 300);
    const menuOpenBeforeClose = !!menuEl && menuEl.hidden === false;
    // #6 NIT: a row click DURING an in-flight switch (WORLDSW_SWITCHING held across the
    // reconnect) must NOT open a confirm modal -- worldswSwitch would early-return on that
    // guard, so the modal would dismiss as if it acted while doing nothing. worldswConfirmSwitch
    // is guarded to ignore the click; assert the modal stays hidden.
    worldswConfirmSwitch('w2', 'Side Project');
    const midSwitchModalHidden = document.getElementById('world-switch-modal').hidden === true;
    worldswClose();  // an outside-click / Escape / trigger toggle during the reconnect
    const menuStillOpenAfterClose = !!menuEl && menuEl.hidden === false;
    const bannerVisibleAfterClose = !document.getElementById('worldsw-restart').hidden;
    // Let the reconnect time out, then the menu must be closable again.
    await waitFor(() => typeof WORLDSW_RECONNECTING !== 'undefined' && WORLDSW_RECONNECTING === false, 1500);
    worldswClose();
    const menuClosedAfterTimeout = !!menuEl && menuEl.hidden === true;
    const afterMenuClose = { menuOpenBeforeClose, midSwitchModalHidden, menuStillOpenAfterClose, bannerVisibleAfterClose, menuClosedAfterTimeout };

    // ---- Scenario G: #6 the switch-CONFIRM modal, and the banner survives Restart ----
    // A row click opens a confirm modal (Josh's requirement: switching is not silent/inline);
    // Cancel does not switch and leaves the menu open; "Restart Kosmos" runs the real switch.
    // THE REGRESSION GUARD: the modal lives OUTSIDE #worldsw but is left open over the menu,
    // and the #worldsw-restart banner lives INSIDE the menu. A click on Restart bubbles to the
    // switcher's outside-click document handler; without the modal exclusion that handler ran
    // worldswClose() (hiding the menu + clearing the banner) while the switch's fetch was still
    // in flight, so the fallback/manual guidance was written into a hidden menu and never seen.
    // On a MANUAL switch (no reload), assert the menu is still open and the guidance is visible.
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'manual';
    pendingReboot = false; rebootPollsSeen = 0; reloadCount = 0; statusObserved.length = 0;
    WORLDSW_RECONNECT_SLOW_MS = 20000; WORLDSW_RECONNECT_TIMEOUT_MS = 150000;
    await worldsFetch(); await sleep(10);
    if (typeof worldswOpen === 'function') worldswOpen();      // menu open behind the modal
    const postsBeforeModal = calls.length;
    const cG1 = await clickRowOnly();
    if (cG1.error) return { error: cG1.error };
    const modalOnRowClick = {
      visible: !document.getElementById('world-switch-modal').hidden,
      title: (document.getElementById('world-switch-t').textContent || ''),
      go: (document.getElementById('world-switch-go').textContent || ''),
      postedOnOpen: calls.length - postsBeforeModal,     // must be 0: opening the modal is not a switch
      menuOpen: !menuHidden(),
    };
    // Cancel: no switch, menu stays open (matching Escape).
    document.getElementById('world-switch-cancel').click();
    const afterCancel = {
      modalHidden: document.getElementById('world-switch-modal').hidden === true,
      posted: calls.length - postsBeforeModal,           // still 0
      menuOpen: !menuHidden(),
    };
    // Confirm on a manual switch: the switch fires AND the banner survives the click.
    const cG2 = await clickRowOnly();
    if (cG2.error) return { error: cG2.error };
    confirmSwitchGo();
    const sawManual = await waitFor(() => /quit and reopen kosmos/i.test(bannerMsg()), 500);
    await sleep(30);
    const afterConfirm = {
      modalHidden: document.getElementById('world-switch-modal').hidden === true,
      posted: calls.some((c) => c.url === '/api/worlds/active' && c.id === 'w2'),
      sawManual,
      guidance: bannerMsg(),
      bannerVisible: !bannerHidden(),
      menuStillOpen: !menuHidden(),                       // THE regression guard
    };
    const afterConfirmModal = { modalOnRowClick, afterCancel, afterConfirm };

    // ---- Scenario H: #6 keyboard focus -- Cancel on open, trigger restored on error ----
    // (1) The confirm modal opens with focus on Cancel, not the destructive "Restart
    // Kosmos": #6 makes switching deliberate, so a reflexive Enter cancels rather than
    // restarts. (2) On an error switch (409), worldswSwitchGo has already hidden the modal
    // (destroying the focused button), so worldswSwitch must restore focus to the switcher
    // trigger -- else a keyboard user is stranded on a hidden element and focus falls to
    // <body>. Guards the two iteration-3 focus WARNINGs.
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'err409';
    pendingReboot = false; rebootPollsSeen = 0; reloadCount = 0; statusObserved.length = 0;
    await worldsFetch(); await sleep(10);
    if (typeof worldswOpen === 'function') worldswOpen();
    const cH = await clickRowOnly();
    if (cH.error) return { error: cH.error };
    const focusOnCancelOnOpen = !!document.activeElement && document.activeElement.id === 'world-switch-cancel';
    confirmSwitchGo();
    await waitFor(() => /in progress/i.test(bannerMsg()), 500);
    await sleep(20);
    const afterErrFocus = {
      focusOnCancelOnOpen,
      said409: /in progress/i.test(bannerMsg()),
      focusRestored: !!document.activeElement && document.activeElement.id === 'worldsw-btn',
      activeId: document.activeElement ? document.activeElement.id : null,
    };

    // ---- Scenario J: #1704 PR3 the pause/keep choice ----
    registryActive = 'w1'; bootedActive = 'w1'; postMode = 'manual-notpaused';
    pendingReboot = false; rebootPollsSeen = 0; reloadCount = 0; statusObserved.length = 0;
    WORLDSW_RECONNECT_SLOW_MS = 20000; WORLDSW_RECONNECT_TIMEOUT_MS = 150000;
    await worldsFetch(); await sleep(10);
    if (typeof worldswOpen === 'function') worldswOpen();
    const cJ = await clickRowOnly();
    if (cJ.error) return { error: cJ.error };
    const pauseEl = document.getElementById('world-switch-pause');
    const keepEl = document.getElementById('world-switch-keep');
    const goEl = document.getElementById('world-switch-go');
    if (!pauseEl || !keepEl) return { error: 'the switch modal has no pause/keep radios' };
    const labelOf = (el) => (el.closest('label') ? el.closest('label').textContent.trim() : '');
    const onOpen = {
      pauseLabel: labelOf(pauseEl), keepLabel: labelOf(keepEl),
      bothRadios: pauseEl.type === 'radio' && keepEl.type === 'radio' && pauseEl.name === keepEl.name,
      noneChecked: !pauseEl.checked && !keepEl.checked,
      goDisabled: goEl.disabled === true,
      focusOnCancel: !!document.activeElement && document.activeElement.id === 'world-switch-cancel',
    };
    const postsBeforeJ = calls.length;
    goEl.click();                                      // disabled: must do nothing
    const postedWhileDisabled = calls.length - postsBeforeJ;
    const modalOpenAfterDisabledClick = !document.getElementById('world-switch-modal').hidden;
    pauseEl.click();                                   // a real click fires the change handler
    const goEnabledAfterChoice = goEl.disabled === false;
    goEl.click();
    await waitFor(() => /quit and reopen kosmos/i.test(bannerMsg()), 500);
    const lastPost = calls[calls.length - 1] || {};
    // Reopen: the last answer must not be carried into a new question.
    const cJ2 = await clickRowOnly();
    if (cJ2.error) return { error: cJ2.error };
    const reopened = { noneChecked: !pauseEl.checked && !keepEl.checked, goDisabled: goEl.disabled === true };
    document.getElementById('world-switch-cancel').click();
    const afterChoice = {
      ...onOpen, postedWhileDisabled, modalOpenAfterDisabledClick, goEnabledAfterChoice,
      postedId: lastPost.id, postedAgents: lastPost.agents, banner: bannerMsg(), reopened,
    };

    // ---- Scenario I: #2454b the CURRENT marker follows the BOOTED world, not the pointer ----
    // The divergence state: a switch flipped the registry pointer to Side Project (w2),
    // but the board has NOT rebooted, so it is still SERVING Home (w1). The UI must mark
    // Home as current (aria-current, non-clickable) and leave Side Project a switchable
    // button -- otherwise the world you are actually on shows as switchable and clicking
    // it demands a needless restart into the Kosmos you are already on (the #2454b loop).
    sendBooted = true;
    registryActive = 'w2';   // pointer flipped by the earlier switch
    bootedActive = 'w1';     // board still serving the old world (restart not applied)
    pendingReboot = false; rebootPollsSeen = 0; reloadCount = 0; statusObserved.length = 0;
    await worldsFetch(); await sleep(10);
    const rowsI = [...document.querySelectorAll('#worldsw-list .worldsw-row')];
    const homeRowI = rowsI.find((el) => /Home/.test(el.textContent || ''));
    const sideRowI = rowsI.find((el) => /Side Project/.test(el.textContent || ''));
    const afterDivergence = {
      promotedName: (document.getElementById('worldsw-name').textContent || '').trim(),
      // the BOOTED world (Home) is current: aria-current AND not a <button> (unclickable)
      bootedMarkedCurrent: !!homeRowI && homeRowI.getAttribute('aria-current') === 'true' && homeRowI.tagName !== 'BUTTON',
      // the pointer world (Side Project) is still a switchable native button
      pointerIsActionable: !!sideRowI && sideRowI.tagName === 'BUTTON',
      // and crucially the booted world is NOT actionable -- you can't be asked to restart into it
      bootedNotActionable: !!homeRowI && homeRowI.tagName !== 'BUTTON',
    };

    return { before, afterRestarting, afterManual, afterNoop, afterInvalid, afterStuck, afterMenuClose, afterConfirmModal, afterErrFocus, afterChoice, afterDivergence };
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
    if (!/quit and reopen kosmos/i.test(b.msg)) problems.push('on restarting:false the banner should give the softened manual "quit and reopen Kosmos" guidance (Josh scrapped the "run kosmos restart" CLI copy), got "' + b.msg + '"');
    if (b.reloaded) problems.push('a manual (restarting:false) switch must NOT auto-reload');
    if (b.polled !== 0) problems.push('a manual (restarting:false) switch must NOT poll /api/status (no reconnect), but it polled ' + b.polled + ' time(s)');

    // Scenario C: no-op -> already active, no reload
    const c = r.afterNoop;
    if (!/already/i.test(c.msg)) problems.push('a no-op switch (restartRequired:false) should say the world is already active, got "' + c.msg + '"');
    if (c.reloaded) problems.push('a no-op switch must NOT reload');
    if (c.polled !== 0) problems.push('a no-op switch must NOT poll /api/status, but it polled ' + c.polled + ' time(s)');

    // Scenario D: contract-invalid restarting:true + restartRequired:false -> reconnect, not no-op
    const d = r.afterInvalid;
    if (d.saidAlready) problems.push('restarting:true with restartRequired:false was mistaken for a no-op ("already active") -- the client must check restarting BEFORE noop');
    if (!d.reloaded) problems.push('restarting:true (even with restartRequired:false) must RECONNECT and reload -- the board is restarting');
    if (d.polled === 0) problems.push('restarting:true must poll /api/status to confirm the reboot, but it polled 0 times');

    // Scenario E: restarting:true but the board never reboots -> slow guidance, timeout, no reload
    const e = r.afterStuck;
    if (!e.slowSeen) problems.push('a stuck restart should offer the manual restart at the slow threshold ("taking longer than usual"), but that guidance never appeared');
    if (!e.finalSeen) problems.push('a stuck restart should land on the timeout fallback ("taking a while to restart") after the ceiling, but it did not');
    if (e.reloaded) problems.push('a restart that never reboots must NOT reload (no false-success on a stuck board)');
    if (e.polled === 0) problems.push('a stuck restart should have polled /api/status, but polled 0 times');
    if (e.guardReleased === false) problems.push('WORLDSW_SWITCHING must be released after the reconnect times out (finally), but it is still held');

    // Scenario F: closing the menu during a reconnect keeps it open so guidance stays visible
    const f = r.afterMenuClose;
    if (!f.menuOpenBeforeClose) problems.push('scenario F setup: the menu should have been open before the mid-reconnect close');
    if (!f.menuStillOpenAfterClose) problems.push('closing the switcher menu DURING a reconnect must keep it open (the guidance banner lives inside it) -- worldswClose should no-op while WORLDSW_RECONNECTING');
    if (!f.bannerVisibleAfterClose) problems.push('the reconnect guidance banner must stay visible after a mid-reconnect menu close');
    if (!f.menuClosedAfterTimeout) problems.push('after the reconnect ends, the menu must be closable again (worldswClose no longer no-ops)');
    if (!f.midSwitchModalHidden) problems.push('#6: a confirm attempt DURING an in-flight switch must be ignored (the modal must stay hidden), or it would dismiss as if it acted while worldswSwitch early-returns -- false feedback');

    // Scenario G: the #6 confirm modal, and the banner survives the Restart click
    const g = r.afterConfirmModal;
    if (!g.modalOnRowClick.visible) problems.push('#6: a row click must open the switch-confirm modal (Josh: switching is not silent/inline), but the modal did not appear');
    if (!/restart kosmos in order to switch to a different kosmos/i.test(g.modalOnRowClick.title)) problems.push('#6: the confirm modal should show Josh\'s verbatim title, got "' + g.modalOnRowClick.title + '"');
    if (!/restart kosmos/i.test(g.modalOnRowClick.go)) problems.push('#6: the confirm button should read "Restart Kosmos", got "' + g.modalOnRowClick.go + '"');
    if (g.modalOnRowClick.postedOnOpen !== 0) problems.push('#6: opening the confirm modal must NOT switch yet (POSTed ' + g.modalOnRowClick.postedOnOpen + ' time(s) on open)');
    if (!g.modalOnRowClick.menuOpen) problems.push('#6: the switcher menu must stay open behind the modal (the status banner lives inside it)');
    if (!g.afterCancel.modalHidden) problems.push('#6: Cancel must close the confirm modal');
    if (g.afterCancel.posted !== 0) problems.push('#6: Cancel must NOT switch (POSTed ' + g.afterCancel.posted + ' time(s))');
    if (!g.afterCancel.menuOpen) problems.push('#6: button/backdrop Cancel must leave the menu open, matching the Escape-cancel path (it tripped the outside-click handler and closed the menu)');
    if (!g.afterConfirm.modalHidden) problems.push('#6: "Restart Kosmos" must close the confirm modal');
    if (!g.afterConfirm.posted) problems.push('#6: "Restart Kosmos" must run the real switch (POST /api/worlds/active {id:w2}), but it did not');
    if (!g.afterConfirm.sawManual || !/quit and reopen kosmos/i.test(g.afterConfirm.guidance)) problems.push('#6: on a manual switch the banner should give the softened "quit and reopen Kosmos" guidance, got "' + g.afterConfirm.guidance + '"');
    if (!g.afterConfirm.bannerVisible) problems.push('#6 REGRESSION: the #worldsw-restart banner is hidden after clicking Restart -- the outside-click handler cleared it mid-switch');
    if (!g.afterConfirm.menuStillOpen) problems.push('#6 REGRESSION: the switcher menu is closed after clicking Restart, so the banner (nested inside it) is invisible -- the modal was not excluded from the outside-click handler and worldswClose() ran mid-switch');

    // Scenario H: keyboard focus -- Cancel on open, trigger restored on an error switch
    const h = r.afterErrFocus;
    if (!h.focusOnCancelOnOpen) problems.push('#6: opening the confirm modal must focus Cancel (deliberate confirm; a reflexive Enter must not restart the app), but activeElement was "' + h.activeId + '"');
    if (!h.said409) problems.push('#6: a 409 switch should show the "in progress" guidance, got a different banner');
    if (!h.focusRestored) problems.push('#6 REGRESSION: after an error switch, keyboard focus must return to the switcher trigger (worldsw-btn), but it was on "' + h.activeId + '" -- worldswSwitchGo destroyed the confirm button and the error path did not restore focus');

    // Scenario J: #1704 PR3 the pause/keep choice
    const j = r.afterChoice;
    if (j.pauseLabel !== "Pause this Kosmos's agents") problems.push('#1704 PR3: the pause choice should be labelled "Pause this Kosmos\'s agents" (its label wrapping the radio), got "' + j.pauseLabel + '"');
    if (j.keepLabel !== 'Keep them running') problems.push('#1704 PR3: the keep choice should be labelled "Keep them running" (its label wrapping the radio), got "' + j.keepLabel + '"');
    if (!j.bothRadios) problems.push('#1704 PR3: pause/keep must be two radios in one group');
    if (!j.noneChecked) problems.push('#1704 PR3: neither choice may be preselected (Josh: the dialog ASKS each time)');
    if (!j.goDisabled) problems.push('#1704 PR3: "Restart Kosmos" must be disabled until a choice is made');
    if (!j.focusOnCancel) problems.push('#1704 PR3: Cancel must keep the initial focus with the radios added');
    if (j.postedWhileDisabled !== 0) problems.push('#1704 PR3: clicking the disabled "Restart Kosmos" switched anyway (' + j.postedWhileDisabled + ' POST(s))');
    if (!j.modalOpenAfterDisabledClick) problems.push('#1704 PR3: clicking the disabled "Restart Kosmos" closed the dialog');
    if (!j.goEnabledAfterChoice) problems.push('#1704 PR3: choosing an answer must enable "Restart Kosmos"');
    if (j.postedId !== 'w2' || j.postedAgents !== 'pause') problems.push('#1704 PR3: the POST must carry {id:"w2", agents:"pause"}, got id=' + j.postedId + ' agents=' + j.postedAgents);
    if (!/^Still running, could not be paused: ava\./.test(j.banner)) problems.push('#1704 PR3: agents that could not be paused must lead the status line ("Still running, could not be paused: ava."), got "' + j.banner + '"');
    if (!j.reopened.noneChecked || !j.reopened.goDisabled) problems.push('#1704 PR3: a reopened dialog must ask again (no carried answer, Restart disabled)');

    // Scenario I: #2454b the current marker follows the BOOTED world, not the registry pointer
    const i = r.afterDivergence;
    if (i.promotedName !== 'Home') problems.push('#2454b: with the pointer on Side Project but the board still booted on Home, the promoted name must be the BOOTED world "Home", got "' + i.promotedName + '"');
    if (!i.bootedMarkedCurrent) problems.push('#2454b: the BOOTED world (Home) must be marked current (aria-current, non-button) -- the marker must key on bootedWorldId, not the flipped registry pointer');
    if (!i.pointerIsActionable) problems.push('#2454b: the pending pointer world (Side Project) must stay a switchable <button>');
    if (!i.bootedNotActionable) problems.push('#2454b THE BUG: the world the board is actually on (Home) is a clickable row, so clicking it demands a needless restart into the Kosmos you are already on');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-worldswitch-2238: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldswitch-2238: a switcher row opens the #6 confirm modal (Josh-verbatim, no switch on open); Cancel leaves the menu open and does not switch; "Restart Kosmos" runs the real switch (POST /api/worlds/active) and the banner survives the click; restarting:true shows "Switching...", polls the BOOTED world (race-safe), and reloads on the confirmed flip; restarting:false gives honest manual guidance with no reconnect; a no-op switch says already-active. None false-succeed.');
})();

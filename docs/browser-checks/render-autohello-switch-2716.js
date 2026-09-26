'use strict';

/**
 * kosmos#2716: the model-switch / provider-switch dialogs auto-send the wake `hello`
 * after they restart the agent, and confirm it in the changeDialog message (chg-msg),
 * reusing #2686's autoHelloAfterRestart. This drives the wiring helper
 * autoHelloOnSwitchRestart, which is the piece #2716 adds.
 *
 * ⚠️ WHY A BROWSER. The helper writes to a live DOM element (chg-msg) only when the
 * dialog is still open and still the same agent, and it rides #2686's async
 * readiness+delivery state machine. A source test cannot see whether the guarded write
 * lands, is suppressed on a closed dialog / switched agent, or falls to the manual line
 * on a non-placed delivery.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-autohello-switch-2716.js
 *
 * ⚠️ NODE_PATH is not optional: require resolves from THIS file's directory.
 *
 * Model: render-autohello-2686.js (the same count-based fetch stub, file://).
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

function initStub() {
  window.__posted = [];
  window.setInterval = () => 0;
  // Readiness is COUNT-based (see render-autohello-2686.js): the agent reports the
  // #2019 'restarting' gap until it has answered more than __readyAfterCalls polls,
  // then 'idle'. Infinity = never ready.
  window.__readyAfterCalls = Number.POSITIVE_INFINITY;
  window.__statusSinceRestart = 0;
  window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
  const enc = (o, status) => new Response(JSON.stringify(o), {
    status: status || 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method ? String(opts.method) : 'GET').toUpperCase();
    window.__posted.push({ url: u, method, body: (opts && opts.body) || null });
    if (/\/api\/agent\/[^/]+\/thread$/.test(u) && method === 'POST') return enc(window.__threadResp);
    // The real model-switch and provider-switch flows (arms 11, 11b) POST here first.
    if (/\/api\/agent\/[^/]+\/model$/.test(u) && method === 'POST') {
      window.__statusSinceRestart = 0;
      return enc({ outcome: window.__modelOutcome || 'changed', because: 'Changed and restarting on the new model.' });
    }
    if (/\/api\/agent\/[^/]+\/provider$/.test(u) && method === 'POST') {
      window.__statusSinceRestart = 0;
      return enc({ outcome: 'changed', provider: 'openai', because: 'OpenAI it is. It is starting again now.' });
    }
    if (/\/api\/status(\?|$)/.test(u)) {
      window.__statusSinceRestart += 1;
      const ready = window.__statusSinceRestart > window.__readyAfterCalls;
      return enc({ agents: [{
        sessionName: 'april', name: 'April', displayName: 'April',
        isAgentSession: true, isNamedOurs: true, state: ready ? 'idle' : 'restarting',
      }] });
    }
    return enc({ agents: [] });
  };
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-autohello-switch-2716: could not start a browser'
      + (HEADED ? ' (headed; try HEADED=0).' : '.'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/ERR_FILE_NOT_FOUND/.test(m.text())) return;
    pageErrors.push('console: ' + m.text());
  });

  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');

  await page.evaluate(() => {
    RESTART_READY_WINDOW_MS = 800;
    RESTART_READY_POLL_MS = 60;
    CURRENT = { sessionName: 'april', name: 'April' };
  });

  // #4008: the finished line is "Ready: X is on Y." (these direct calls pass no onWhat, so Y is the provider).
  const SAID = 'Ready: April is on OpenAI.';
  const MANUAL = 'April is on OpenAI. Send them a message to wake them.';
  // What the dialog paints while the hello is pending; the helper resolves it.
  const WAITING = 'Restarted on OpenAI. Waking them…';

  // Drive the helper against the real chg-msg element. Optional `mutate` runs mid-wait
  // (close the modal / switch agents) to exercise the guards.
  // `seed` is chg-msg's content when the helper starts: the waiting line by default (the
  // floor already painted), or the interstitial caption for the early-report arms, where
  // `mutate` later paints the waiting line the way changeDialog's floor render would.
  // `hold` is the __kosmosRestartHoldMs seam the helper's bound reads (300ms by default),
  // so no arm's retries outlive the arm.
  async function run({ readyAfter, threadResp, mutate, mutateArg, seed, settleMs, hold }) {
    await page.evaluate(({ n, tr, sd, hd }) => {
      window.__kosmosRestartHoldMs = hd;
      window.__posted = [];
      window.__readyAfterCalls = n === 'inf' ? Number.POSITIVE_INFINITY : n;
      window.__statusSinceRestart = 0;
      if (tr) window.__threadResp = tr; else window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
      CURRENT = { sessionName: 'april', name: 'April' };
      // A minimal open changeDialog: the modal (not hidden) and its message element,
      // seeded with the waiting line the real `say` would have rendered.
      const back = document.getElementById('chg-modal');
      const msg = document.getElementById('chg-msg');
      back.hidden = false;
      msg.textContent = sd || 'Restarted on OpenAI. Waking them…';
      // #4008: a fresh dialog's Done: shown, and plain (changeDialog resets the gold on every open).
      const kp = document.getElementById('chg-keep'); kp.hidden = false; kp.classList.remove('uprime');
      // The call site builds the manual and waiting lines once and passes both in.
      autoHelloOnSwitchRestart('april', 'April', 'OpenAI', 'April is on OpenAI. Send them a message to wake them.', 'Restarted on OpenAI. Waking them…');
    }, { n: readyAfter, tr: threadResp, sd: seed, hd: hold || 300 });
    if (mutate) await page.evaluate(mutate, mutateArg);
    // Wait until either a thread POST fired or the readiness window elapsed and the
    // message settled (not still the seeded manual line for the success arm).
    await page.waitForTimeout(settleMs || 1000);
    return page.evaluate(() => ({
      msg: document.getElementById('chg-msg').textContent,
      gold: document.getElementById('chg-keep').classList.contains('uprime'),
      check: !!document.querySelector('#chg-msg svg.wake-done'),
      threadCalls: window.__posted.filter((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && p.method === 'POST').length,
    }));
  }

  // ---- Arm 1: success -> chg-msg becomes the confirmation, one hello ----
  const s1 = await run({ readyAfter: 2 });
  check('success: exactly one wake hello is sent', s1.threadCalls === 1, 'calls=' + s1.threadCalls);
  check('success: chg-msg becomes the reactivated+said-hello confirmation', s1.msg === SAID, JSON.stringify(s1.msg));

  // ---- Arm 2: unconfirmed delivery -> manual line, never a false confirmation ----
  const s2 = await run({ readyAfter: 2, threadResp: { recorded: true, delivery: { state: 'unconfirmed', because: 'x' } } });
  check('unconfirmed: the hello WAS posted (helper ran, not a silent no-op)', s2.threadCalls === 1, 'calls=' + s2.threadCalls);
  check('unconfirmed: chg-msg resolves to the manual reactivate line (no false confirmation)', s2.msg === MANUAL, JSON.stringify(s2.msg));
  // #4008 (round 2): the wait is over either way, so Done turns gold; only the placed hello earns the check.
  check('#4008 a hello that did not land still finishes the dialog (Done gold) but shows NO check', s2.gold && !s2.check, JSON.stringify({ gold: s2.gold, check: s2.check }));
  check('#4008 CONTROL: a placed hello finishes with Done gold AND the check', s1.gold && s1.check, JSON.stringify({ gold: s1.gold, check: s1.check }));

  // ---- Arm 3: stays restarting (timeout) -> manual line ----
  const s3 = await run({ readyAfter: 'inf' });
  check('timeout: NO hello, chg-msg resolves to the manual line', s3.threadCalls === 0 && s3.msg === MANUAL, 'calls=' + s3.threadCalls + ' msg=' + JSON.stringify(s3.msg));

  // ---- Arm 4: the dialog is CLOSED mid-wait -> the write is suppressed ----
  const s4 = await run({ readyAfter: 2, mutate: () => { document.getElementById('chg-modal').hidden = true; } });
  check('closed dialog: the hello fired but the confirmation is NOT written into a closed modal',
    s4.threadCalls === 1 && s4.msg === WAITING, 'calls=' + s4.threadCalls + ' msg=' + JSON.stringify(s4.msg));

  // ---- Arm 5: the person SWITCHED agents mid-wait -> the write is suppressed ----
  const s5 = await run({ readyAfter: 2, mutate: () => { CURRENT = { sessionName: 'other', name: 'Other' }; } });
  check('switched agent: the hello fired but the confirmation does NOT land in another agent\'s dialog',
    s5.threadCalls === 1 && s5.msg === WAITING, 'calls=' + s5.threadCalls + ' msg=' + JSON.stringify(s5.msg));

  // ---- Arm 6: Done-then-REOPEN a different dialog for the same agent mid-wait ----
  // The open+agent guards both pass (a changeDialog IS open for this agent), so only the
  // content check (chg-msg still shows the exact waiting line this helper rendered) stops
  // the resolution from clobbering the reopened dialog's own message. Simulate the reopen
  // by changing chg-msg to a different action's content mid-wait; the confirmation must
  // NOT overwrite it.
  const REOPENED = 'Setting up Anthropic';   // e.g. an account-move / provider interstitial caption
  const s6 = await run({ readyAfter: 2, mutate: () => { document.getElementById('chg-msg').textContent = 'Setting up Anthropic'; } });
  check('reopened dialog: the confirmation does NOT clobber a different dialog shown for the same agent',
    s6.threadCalls === 1 && s6.msg === REOPENED, 'calls=' + s6.threadCalls + ' msg=' + JSON.stringify(s6.msg));

  // ---- Arms 7-9: the report arrives BEFORE the floor paints the waiting line ----
  // changeDialog holds its render until RESTART_HOLD_MS (4400ms since #2692) while the
  // readiness wait can accept after two polls (4000ms in production), so the confirmation
  // can come first. A first version stood down when chg-msg did not yet show its line,
  // and the confirmation was lost. The helper now waits for the line.
  const BUSY = 'Restarting April';   // the interstitial is up; the waiting line is not painted yet
  // 7: the floor paints after the report -> the confirmation still lands.
  const s7 = await run({ readyAfter: 2, seed: BUSY, settleMs: 1200,
    mutate: () => { setTimeout(() => { document.getElementById('chg-msg').textContent = 'Restarted on OpenAI. Waking them…'; }, 700); } });
  check('early report: the confirmation lands once the floor paints the waiting line',
    s7.threadCalls === 1 && s7.msg === SAID, 'calls=' + s7.threadCalls + ' msg=' + JSON.stringify(s7.msg));
  // 8: the dialog closes before the floor paints -> nothing is written, the wait stops.
  const s8 = await run({ readyAfter: 2, seed: BUSY, settleMs: 1200,
    mutate: () => { setTimeout(() => {
      document.getElementById('chg-modal').hidden = true;
      document.getElementById('chg-msg').textContent = 'Restarted on OpenAI. Waking them…';
    }, 700); } });
  check('early report, dialog closed before the paint: nothing is written into it',
    s8.threadCalls === 1 && s8.msg === WAITING, 'calls=' + s8.threadCalls + ' msg=' + JSON.stringify(s8.msg));
  // 9: the waiting line never appears within the bound (the hold + 1s) -> the wait
  // gives up; a line painted after that is left alone. Proves the wait is bounded.
  // The helper reads the same hold seam changeDialog does, so a short test hold keeps this
  // arm fast while still proving the bound (production: RESTART_HOLD_MS + 1s = 5.4s).
  const bound = 600 + 1000;
  // The paint lands 1.5s after the bound, so a report delayed by a loaded machine still
  // has its deadline well before the paint.
  const s9 = await run({ readyAfter: 2, seed: BUSY, hold: 600, settleMs: bound + 2500, mutateArg: bound + 1500,
    mutate: (ms) => { setTimeout(() => { document.getElementById('chg-msg').textContent = 'Restarted on OpenAI. Waking them…'; }, ms); } });
  check('early report, line never painted within the bound: the wait gives up (bounded, no late write)',
    s9.threadCalls === 1 && s9.msg === WAITING, 'bound=' + bound + 'ms calls=' + s9.threadCalls + ' msg=' + JSON.stringify(s9.msg));

  // ---- Arm 9b: the margin past the hold is load-bearing ----
  // The wait runs to hold + 1s from the report. Paint 500ms after the hold (measured from
  // when the report fired), inside the margin: the confirmation must still land, so a
  // bound of the bare hold (the margin dropped) reds here.
  const s9b = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const back = document.getElementById('chg-modal');
    const msg = document.getElementById('chg-msg');
    const MAN = 'April is on OpenAI. Send them a message to wake them.';
    const WAIT = 'Restarted on OpenAI. Waking them…';
    window.__kosmosRestartHoldMs = 300;
    window.__posted = [];
    window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
    window.__statusSinceRestart = 0;
    window.__readyAfterCalls = 2;
    CURRENT = { sessionName: 'april', name: 'April' };
    back.hidden = false; msg.textContent = 'Restarting April';
    autoHelloOnSwitchRestart('april', 'April', 'OpenAI', MAN, WAIT);
    const t0 = Date.now();
    while (!window.__posted.some((x) => /\/thread$/.test(x.url)) && Date.now() - t0 < 3000) await sleep(5);
    await sleep(300 + 500);                     // hold + 500ms after the report: inside hold + 1s
    msg.textContent = WAIT;
    await sleep(400);
    window.__kosmosRestartHoldMs = undefined;
    return { msg: msg.textContent };
  });
  check('early report: a paint inside the one-second margin past the hold still gets the confirmation',
    s9b.msg === SAID, JSON.stringify(s9b.msg));

  // ---- Arm 10: a STALE report from an earlier restart of the same agent ----
  // Two switches of one agent to the same provider paint the identical waiting line. The
  // first restart's report, still waiting for that line, must not write "said hello" into
  // the second dialog: its hello went to a session the second switch replaced.
  const s10 = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const back = document.getElementById('chg-modal');
    const msg = document.getElementById('chg-msg');
    const MAN = 'April is on OpenAI. Send them a message to wake them.';
    const WAIT = 'Restarted on OpenAI. Waking them…';
    window.__posted = [];
    window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
    window.__statusSinceRestart = 0;
    window.__readyAfterCalls = 2;
    window.__kosmosRestartHoldMs = 300;
    CURRENT = { sessionName: 'april', name: 'April' };
    back.hidden = false; msg.textContent = 'Restarting April';
    autoHelloOnSwitchRestart('april', 'April', 'OpenAI', MAN, WAIT);          // restart A
    await sleep(400);                                                    // A's hello placed; A waits for the line
    const aPosted = window.__posted.filter((x) => /\/thread$/.test(x.url)).length;
    window.__readyAfterCalls = Number.POSITIVE_INFINITY;                 // B never comes back
    autoHelloOnSwitchRestart('april', 'April', 'OpenAI', MAN, WAIT);          // restart B, same agent, same line
    await sleep(200);
    msg.textContent = WAIT;                                              // B's dialog paints the same waiting line
    await sleep(1400);                                                   // past B's readiness window
    window.__kosmosRestartHoldMs = undefined;
    return { aPosted, msg: msg.textContent };
  });
  check('stale report: an earlier restart\'s confirmation does NOT land in the next dialog for the same agent',
    s10.aPosted === 1 && s10.msg === MANUAL, 'aPosted=' + s10.aPosted + ' msg=' + JSON.stringify(s10.msg));

  // ---- Arm 11: the REAL model-switch path, with the real hold longer than two polls ----
  // Arms 7-9 paint the line by hand. This one clicks #d-model-go and lets changeDialog
  // hold its render (__kosmosRestartHoldMs, 1500ms: generous so a throttled runner still
  // sees the report first) past the readiness accept (2 x 60ms poll), the
  // production relationship (4400ms hold vs 2 x 2000ms), so the report comes first for real.
  const s11 = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const back = document.getElementById('chg-modal');
    const msg = document.getElementById('chg-msg');
    back.hidden = true; msg.textContent = '';
    window.__posted = [];
    window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
    window.__statusSinceRestart = 0;
    window.__readyAfterCalls = 2;
    window.__kosmosRestartHoldMs = 1500;
    CURRENT = { sessionName: 'april', name: 'April', displayName: 'April', runner: 'claude', isNamedOurs: true };
    const sel = document.getElementById('d-model');
    sel.innerHTML = '<option value="opus5">Claude Opus 5</option>';
    sel.value = 'opus5';
    // #4008: Runs on as the agent's page painted it before the switch (openDetail's shape).
    document.getElementById('d-runson').innerHTML = 'Right now: <b>Claude Sonnet 5</b> (hello@example.com)';
    const dgo = document.getElementById('d-model-go');
    dgo.disabled = false;
    dgo.click();
    document.getElementById('chg-go').click();
    let helloAt = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 3500) {
      if (helloAt === null && window.__posted.some((x) => /\/thread$/.test(x.url))) helloAt = Date.now() - t0;
      await sleep(20);
    }
    const keep = document.getElementById('chg-keep');
    // #4008: the finished dialog: the title is no longer the question, Done is the gold button with the
    // focus, and the line leads with a check.
    const out = { helloAt, msg: msg.textContent, threads: window.__posted.filter((x) => /\/thread$/.test(x.url)).length,
      title: document.getElementById('chg-title').textContent, gold: keep.classList.contains('uprime'), focused: document.activeElement === keep,
      check: !!msg.querySelector('svg.wake-done'), keepText: keep.textContent,
      runsOn: document.getElementById('d-runson').textContent };
    window.__kosmosRestartHoldMs = undefined;
    keep.click();
    return out;
  });
  check('real model switch: the hello is placed BEFORE the held render (the race actually occurs)',
    s11.helloAt !== null && s11.helloAt < 1500, 'helloAt=' + s11.helloAt + 'ms, hold=1500ms');
  check('real model switch: the dialog still ends on the confirmation',
    s11.threads === 1 && s11.msg === 'Ready: April is on Claude Opus 5.', 'threads=' + s11.threads + ' msg=' + JSON.stringify(s11.msg));
  check('#4008 real model switch: the finished dialog titles what happened, leads with a check, and Done is the gold button with the focus',
    s11.title === 'Changed to Claude Opus 5' && s11.check && s11.gold && s11.focused && s11.keepText === 'Done', JSON.stringify(s11));
  check('#4008 real model switch: Runs on behind the dialog reads the new model (the account kept), not the old session\'s',
    s11.runsOn === 'Right now: Claude Opus 5 (hello@example.com)', JSON.stringify(s11.runsOn));

  // ---- Arm 11b: the REAL provider-switch path, same timing relationship ----
  // changeProviderNow has its own call site and an extra awaited accounts refresh, so it
  // is driven end to end too rather than inferred from the model path.
  const s11b = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const back = document.getElementById('chg-modal');
    const msg = document.getElementById('chg-msg');
    back.hidden = true; msg.textContent = '';
    window.__posted = [];
    window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
    window.__statusSinceRestart = 0;
    window.__readyAfterCalls = 2;
    window.__kosmosRestartHoldMs = 1500;
    CURRENT = { sessionName: 'april', name: 'April', displayName: 'April', runner: 'claude', isNamedOurs: true };
    const psel = document.getElementById('d-provider');
    psel.innerHTML = '<option value="openai">OpenAI</option>';
    psel.value = 'openai';
    // #4008: Runs on as the agent's page painted it before the switch.
    document.getElementById('d-runson').innerHTML = 'Right now: <b>Claude Sonnet 5</b> (hello@example.com)';
    const pgo = document.getElementById('d-provider-go');
    pgo.disabled = false;
    pgo.click();
    document.getElementById('chg-go').click();
    let helloAt = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 3500) {
      if (helloAt === null && window.__posted.some((x) => /\/thread$/.test(x.url))) helloAt = Date.now() - t0;
      await sleep(20);
    }
    const keep = document.getElementById('chg-keep');
    const out = { helloAt, msg: msg.textContent, threads: window.__posted.filter((x) => /\/thread$/.test(x.url)).length,
      title: document.getElementById('chg-title').textContent, gold: keep.classList.contains('uprime'), check: !!msg.querySelector('svg.wake-done'),
      runsOn: document.getElementById('d-runson').textContent };
    window.__kosmosRestartHoldMs = undefined;
    keep.click();
    return out;
  });
  check('real provider switch: the hello is placed BEFORE the held render (the race actually occurs)',
    s11b.helloAt !== null && s11b.helloAt < 1500, 'helloAt=' + s11b.helloAt + 'ms, hold=1500ms');
  check('real provider switch: the dialog still ends on the confirmation',
    s11b.threads === 1 && s11b.msg === 'Ready: April is on OpenAI.', 'threads=' + s11b.threads + ' msg=' + JSON.stringify(s11b.msg));
  check('#4008 real provider switch: the finished dialog is titled "Switched to OpenAI", with a check and a gold Done',
    s11b.title === 'Switched to OpenAI' && s11b.check && s11b.gold, JSON.stringify(s11b));
  check('#4008 real provider switch: Runs on names the provider it moved to (the account kept), not the old Claude model',
    s11b.runsOn === 'Right now: OpenAI Codex (hello@example.com)', JSON.stringify(s11b.runsOn));

  // ---- Arm 11c: a real switch that does NOT restart sends no hello ----
  const s11c = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const back = document.getElementById('chg-modal');
    const msg = document.getElementById('chg-msg');
    back.hidden = true; msg.textContent = '';
    window.__posted = [];
    window.__statusSinceRestart = 0;
    window.__readyAfterCalls = 2;
    window.__modelOutcome = 'partial';
    window.__kosmosRestartHoldMs = 300;
    CURRENT = { sessionName: 'april', name: 'April', displayName: 'April', runner: 'claude', isNamedOurs: true };
    const sel = document.getElementById('d-model');
    sel.innerHTML = '<option value="opus5">Claude Opus 5</option>';
    sel.value = 'opus5';
    const dgo = document.getElementById('d-model-go');
    dgo.disabled = false;
    dgo.click();
    document.getElementById('chg-go').click();
    await sleep(1500);
    const out = { threads: window.__posted.filter((x) => /\/thread$/.test(x.url)).length, msg: msg.textContent };
    window.__modelOutcome = undefined;
    window.__kosmosRestartHoldMs = undefined;
    document.getElementById('chg-keep').click();
    return out;
  });
  check('real model switch that does not restart: no hello is sent and no confirmation is shown',
    s11c.threads === 0 && !/Reactivated/.test(s11c.msg), 'threads=' + s11c.threads + ' msg=' + JSON.stringify(s11c.msg));

  if (pageErrors.length) check('no page/console errors during the run', false, pageErrors.join(' | '));
  else check('no page/console errors during the run', true);

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (failed.length ? 'FAIL  ' + failed.length + ' of ' + results.length + ' checks failed'
    : 'PASS  all ' + results.length + ' checks passed'));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('FAIL  render-autohello-switch-2716: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});

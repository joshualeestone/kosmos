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

  const SAID = 'Reactivated on OpenAI, and said hello to wake April.';
  const MANUAL = 'Say hello to April to reactivate them on OpenAI.';

  // Drive the helper against the real chg-msg element. Optional `mutate` runs mid-wait
  // (close the modal / switch agents) to exercise the guards.
  // `seed` is chg-msg's content when the helper starts: the manual line by default (the
  // floor already painted), or the interstitial caption for the early-report arms, where
  // `mutate` later paints the manual line the way changeDialog's floor render would.
  async function run({ readyAfter, threadResp, mutate, mutateArg, seed, settleMs }) {
    await page.evaluate(({ n, tr, sd }) => {
      window.__posted = [];
      window.__readyAfterCalls = n === 'inf' ? Number.POSITIVE_INFINITY : n;
      window.__statusSinceRestart = 0;
      if (tr) window.__threadResp = tr; else window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
      CURRENT = { sessionName: 'april', name: 'April' };
      // A minimal open changeDialog: the modal (not hidden) and its message element,
      // seeded with the manual line the real `say` would have rendered.
      const back = document.getElementById('chg-modal');
      const msg = document.getElementById('chg-msg');
      back.hidden = false;
      msg.textContent = sd || 'Say hello to April to reactivate them on OpenAI.';
      // 4th arg is the manual line the call site builds once and passes in (matches MANUAL).
      autoHelloOnSwitchRestart('april', 'April', 'OpenAI', 'Say hello to April to reactivate them on OpenAI.');
    }, { n: readyAfter, tr: threadResp, sd: seed });
    if (mutate) await page.evaluate(mutate, mutateArg);
    // Wait until either a thread POST fired or the readiness window elapsed and the
    // message settled (not still the seeded manual line for the success arm).
    await page.waitForTimeout(settleMs || 1000);
    return page.evaluate(() => ({
      msg: document.getElementById('chg-msg').textContent,
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
  check('unconfirmed: chg-msg stays the manual reactivate line (no false confirmation)', s2.msg === MANUAL, JSON.stringify(s2.msg));

  // ---- Arm 3: stays restarting (timeout) -> manual line ----
  const s3 = await run({ readyAfter: 'inf' });
  check('timeout: NO hello, chg-msg stays the manual line', s3.threadCalls === 0 && s3.msg === MANUAL, 'calls=' + s3.threadCalls + ' msg=' + JSON.stringify(s3.msg));

  // ---- Arm 4: the dialog is CLOSED mid-wait -> the write is suppressed ----
  const s4 = await run({ readyAfter: 2, mutate: () => { document.getElementById('chg-modal').hidden = true; } });
  check('closed dialog: the hello fired but the confirmation is NOT written into a closed modal',
    s4.threadCalls === 1 && s4.msg === MANUAL, 'calls=' + s4.threadCalls + ' msg=' + JSON.stringify(s4.msg));

  // ---- Arm 5: the person SWITCHED agents mid-wait -> the write is suppressed ----
  const s5 = await run({ readyAfter: 2, mutate: () => { CURRENT = { sessionName: 'other', name: 'Other' }; } });
  check('switched agent: the hello fired but the confirmation does NOT land in another agent\'s dialog',
    s5.threadCalls === 1 && s5.msg === MANUAL, 'calls=' + s5.threadCalls + ' msg=' + JSON.stringify(s5.msg));

  // ---- Arm 6: Done-then-REOPEN a different dialog for the same agent mid-wait ----
  // The open+agent guards both pass (a changeDialog IS open for this agent), so only the
  // content check (chg-msg still shows the exact manual line this helper rendered) stops
  // the resolution from clobbering the reopened dialog's own message. Simulate the reopen
  // by changing chg-msg to a different action's content mid-wait; the confirmation must
  // NOT overwrite it.
  const REOPENED = 'Setting up Anthropic';   // e.g. an account-move / provider interstitial caption
  const s6 = await run({ readyAfter: 2, mutate: () => { document.getElementById('chg-msg').textContent = 'Setting up Anthropic'; } });
  check('reopened dialog: the confirmation does NOT clobber a different dialog shown for the same agent',
    s6.threadCalls === 1 && s6.msg === REOPENED, 'calls=' + s6.threadCalls + ' msg=' + JSON.stringify(s6.msg));

  // ---- Arms 7-9: the report arrives BEFORE the floor paints the manual line ----
  // changeDialog holds its render until RESTART_HOLD_MS (4400ms since #2692) while the
  // readiness wait can accept after two polls (4000ms in production), so the confirmation
  // can come first. A first version stood down when chg-msg did not yet show the manual
  // line, and the confirmation was lost. The helper now waits for the line.
  const BUSY = 'Restarting April';   // the interstitial is up; the manual line is not painted yet
  // 7: the floor paints after the report -> the confirmation still lands.
  const s7 = await run({ readyAfter: 2, seed: BUSY, settleMs: 1200,
    mutate: () => { setTimeout(() => { document.getElementById('chg-msg').textContent = 'Say hello to April to reactivate them on OpenAI.'; }, 700); } });
  check('early report: the confirmation lands once the floor paints the manual line',
    s7.threadCalls === 1 && s7.msg === SAID, 'calls=' + s7.threadCalls + ' msg=' + JSON.stringify(s7.msg));
  // 8: the dialog closes before the floor paints -> nothing is written, the wait stops.
  const s8 = await run({ readyAfter: 2, seed: BUSY, settleMs: 1200,
    mutate: () => { setTimeout(() => {
      document.getElementById('chg-modal').hidden = true;
      document.getElementById('chg-msg').textContent = 'Say hello to April to reactivate them on OpenAI.';
    }, 700); } });
  check('early report, dialog closed before the paint: nothing is written into it',
    s8.threadCalls === 1 && s8.msg === MANUAL, 'calls=' + s8.threadCalls + ' msg=' + JSON.stringify(s8.msg));
  // 9: the manual line never appears within the bound (RESTART_HOLD_MS + 1s) -> the wait
  // gives up; a line painted after that is left alone. Proves the wait is bounded.
  const bound = await page.evaluate(() => RESTART_HOLD_MS + 1000);
  // The paint lands 1.5s after the bound, so a report delayed by a loaded machine still
  // has its deadline well before the paint.
  const s9 = await run({ readyAfter: 2, seed: BUSY, settleMs: bound + 2500, mutateArg: bound + 1500,
    mutate: (ms) => { setTimeout(() => { document.getElementById('chg-msg').textContent = 'Say hello to April to reactivate them on OpenAI.'; }, ms); } });
  check('early report, line never painted within the bound: the wait gives up (bounded, no late write)',
    s9.threadCalls === 1 && s9.msg === MANUAL, 'bound=' + bound + 'ms calls=' + s9.threadCalls + ' msg=' + JSON.stringify(s9.msg));

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

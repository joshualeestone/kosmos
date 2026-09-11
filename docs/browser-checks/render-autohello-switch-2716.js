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
  async function run({ readyAfter, threadResp, mutate }) {
    await page.evaluate(({ n, tr }) => {
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
      msg.textContent = 'Say hello to April to reactivate them on OpenAI.';
      autoHelloOnSwitchRestart('april', 'April', 'OpenAI');
    }, { n: readyAfter, tr: threadResp });
    if (mutate) await page.evaluate(mutate);
    // Wait until either a thread POST fired or the readiness window elapsed and the
    // message settled (not still the seeded manual line for the success arm).
    await page.waitForTimeout(1000);
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
  check('closed dialog: the confirmation is NOT written into a closed modal', s4.msg !== SAID, JSON.stringify(s4.msg));

  // ---- Arm 5: the person SWITCHED agents mid-wait -> the write is suppressed ----
  const s5 = await run({ readyAfter: 2, mutate: () => { CURRENT = { sessionName: 'other', name: 'Other' }; } });
  check('switched agent: the confirmation does NOT land in another agent\'s dialog', s5.msg !== SAID, JSON.stringify(s5.msg));

  // ---- The no-race invariant, guarded from source (not exercised by the arms above,
  // which drive the helper directly). The chg-msg confirmation must not be clobbered by
  // changeDialog's floor render, which repaints the manual line at RESTART_HOLD_MS. That
  // holds only while the readiness wait's first accept (>= 2 polls, since sawUnready
  // requires a gap) lands after the floor: 2 * RESTART_READY_POLL_MS > RESTART_HOLD_MS.
  // Parse the production constants (not the test-overridden ones) and assert it, so a
  // future retune that would silently regress to "shows manual instead of the
  // confirmation" reds here. Benign direction (never a false claim), but caught. ----
  const src = require('node:fs').readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'), 'utf8');
  const num = (re) => { const m = src.match(re); return m ? Number(m[1]) : NaN; };
  const poll = num(/RESTART_READY_POLL_MS\s*=\s*(\d+)/);
  const hold = num(/RESTART_HOLD_MS\s*=\s*(\d+)/);
  check('no-race invariant holds: 2 * RESTART_READY_POLL_MS > RESTART_HOLD_MS',
    Number.isFinite(poll) && Number.isFinite(hold) && (2 * poll > hold), 'poll=' + poll + ' hold=' + hold);

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

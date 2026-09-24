'use strict';

/**
 * kosmos#3492 (Josh, 2026-09-23): the restart confirm dialog's THIRD option,
 * "Write a handoff, then restart". A plain restart forgets everything the agent
 * was doing; this option asks the agent to write a handoff first, WAITS for it,
 * then restarts and points the fresh session at that handoff.
 *
 * WHAT SOURCE CANNOT SEE, and why this needs a browser: that clicking the REAL
 * rst-handoff-go handler drives the four-phase flow through the DOM -- (1) it
 * asks the live agent (POST .../handoff-restart/ask) and shows a "writing its
 * handoff" status while it polls, (2) it advances to the restart ONLY once the
 * handoff is confirmed fresh (GET .../handoff-restart/status -> fresh:true), (3)
 * it plays the shared restart interstitial (the loader canvas mounts in the
 * dialog), and (4) after the restart it delivers the pickup (POST
 * .../handoff-restart/pickup) and lands the placed receipt. And the two safety
 * arms a source read cannot prove: an UNCONFIRMED ask and a handoff that never
 * arrives BOTH restore the confirm view and NEVER POST /restart -- an agent's
 * context is never lost to a mistimed restart.
 *
 * The paint of the loader itself is covered by render-restart-kloader-2831; this
 * check asserts the FLOW and its DOM STATES, so it deliberately does not re-check
 * pixels. HERMETIC (file://, every route answered by a window.fetch stub).
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 \
 *     node docs/browser-checks/render-handoff-restart-3492.js
 *
 * NODE_PATH is not optional: require resolves from THIS file's directory.
 */

const nodePath = require('node:path');
const fs = require('node:fs');
let playwright;
try { playwright = require('playwright'); }
catch { console.log('render-handoff-restart-3492: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE_PATH = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const PAGE = 'file://' + PAGE_PATH;
const HEADED = process.env.HEADED !== '0';

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

// The fetch stub. Answers the routes the flow touches. Knobs let each arm shape
// the ask verdict, when the handoff becomes fresh, and the restart outcome.
function initStub() {
  window.__posted = [];
  window.setInterval = () => 0;   // stop the page's own polling racing the hand-driven steps
  window.__askState = 'placed';        // an arm sets 'could_not' to exercise the refused-ask path
  window.__freshAfterStatusCalls = 1;  // status returns fresh:true after this many polls (Infinity = never)
  window.__statusCalls = 0;
  window.__restartOutcome = 'restarted';
  window.__readyAfterCalls = 2;        // /api/status gap-then-ready for restartReadyWait
  window.__statusSinceRestart = 0;
  window.__pickupResp = { delivery: { state: 'placed' }, handoffPath: '/data/handoffs/april.md' };
  const enc = (o, status) => new Response(JSON.stringify(o), {
    status: status || 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method ? String(opts.method) : 'GET').toUpperCase();
    window.__posted.push({ url: u, method });
    if (/\/handoff-restart\/ask$/.test(u) && method === 'POST') {
      return enc({ delivery: { state: window.__askState, because: window.__askState === 'could_not' ? 'its window is not answering' : null },
        handoffPath: '/data/handoffs/april.md', baseline: '' },
        window.__askState === 'could_not' ? 409 : 200);
    }
    if (/\/handoff-restart\/status(\?|$)/.test(u) && method === 'GET') {
      window.__statusCalls += 1;
      const fresh = window.__statusCalls >= window.__freshAfterStatusCalls;
      return enc({ fresh, exists: fresh, mtimeMs: fresh ? 123 : null });
    }
    if (/\/handoff-restart\/pickup$/.test(u) && method === 'POST') return enc(window.__pickupResp);
    if (/\/api\/agent\/[^/]+\/restart$/.test(u) && method === 'POST') {
      window.__statusSinceRestart = 0;
      if (window.__restartOutcome === 'refused') {
        return enc({ outcome: 'refused', because: 'It was not started by Kosmos, so we cannot start it again.',
          steps: [{ label: 'close its window', ok: false }] }, 400);
      }
      return enc({ outcome: 'restarted', steps: [] });
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

const posted = (page, re, method) => page.evaluate(({ src, m }) => {
  const rx = new RegExp(src);
  return window.__posted.filter((p) => rx.test(p.url) && (!m || p.method === m)).length;
}, { src: re.source, m: method || null });

(async () => {
  // Source controls: the handler wires all four primitives and gates the restart
  // on a PLACED ask AND a fresh handoff (never restarts on a maybe).
  const src = fs.readFileSync(PAGE_PATH, 'utf8');
  const h = src.slice(src.indexOf("getElementById('rst-handoff-go').addEventListener"));
  const body = h.slice(0, h.indexOf('\n});'));
  check('#3492: the handler wires ask -> status -> restart -> pickup',
    /handoff-restart\/ask/.test(body) && /handoff-restart\/status\?baseline=/.test(body)
    && /\/restart'/.test(body) && /deliverPickup\(name\)/.test(body));
  check('#3492: it proceeds only on a PLACED ask AND a fresh handoff (no restart on a maybe)',
    /delivery\.state === 'placed'/.test(body) && /st\.fresh === true/.test(body));

  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-handoff-restart-3492: could not start a browser'
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

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');

  await page.evaluate(() => {
    // Shrink every timing seam so the flow drives fast and deterministically.
    HANDOFF_WAIT_MS = 1500; HANDOFF_POLL_MS = 40;
    RESTART_READY_WINDOW_MS = 1500; RESTART_READY_POLL_MS = 40;
    LAST = [{ sessionName: 'april', name: 'April', displayName: 'April', role: 'a researcher' }];
    CURRENT = { sessionName: 'april', name: 'April' };
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    const host = document.createElement('div'); host.id = '__ah';
    host.innerHTML = '<div class="row"><button type="button" data-restart-agent="april" data-restart-note="__note">Restart</button>'
      + '<span class="instr-restart-note" id="__note"></span></div>';
    document.body.appendChild(host);
  });

  // The third button renders in the modal actions with a clear label.
  await page.evaluate(() => openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april'));
  const btnState = await page.evaluate(() => {
    const b = document.getElementById('rst-handoff-go');
    return { present: !!b, hidden: b ? b.hidden : null, disabled: b ? b.disabled : null, label: b ? b.textContent : null };
  });
  check('the third button renders in the restart dialog, enabled, with its label',
    btnState.present && btnState.hidden === false && btnState.disabled === false
    && /handoff/i.test(btnState.label || ''), JSON.stringify(btnState));

  // ---- Arm 1: SUCCESS. ask placed -> handoff becomes fresh -> restart -> pickup placed.
  await page.evaluate(() => {
    window.__posted = [];
    window.__askState = 'placed';
    window.__statusCalls = 0; window.__freshAfterStatusCalls = 2;   // fresh on the 2nd poll
    window.__restartOutcome = 'restarted';
    window.__readyAfterCalls = 2; window.__statusSinceRestart = 0;
    window.__kosmosRestartHoldMs = 120;
    document.getElementById('__note').textContent = '';
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  await page.click('#rst-handoff-go');
  // The pre-restart phase shows the handoff-writing status while it polls.
  const wroteStatus = await page.waitForFunction(
    () => /writing its handoff/i.test(document.getElementById('rst-msg').textContent || ''),
    { timeout: 2000 }).then(() => true).catch(() => false);
  // Then the restart interstitial mounts (the loader canvas appears in the dialog).
  const loaderMounted = await page.waitForFunction(
    () => !!document.querySelector('#rst-modal #rst-msg canvas.chg-restart-k'),
    { timeout: 3000 }).then(() => true).catch(() => false);
  // Then the modal closes and the receipt reaches the pickup-placed line.
  const settled = await page.waitForFunction(() => {
    const t = (document.getElementById('__note') || {}).textContent || '';
    return t && !/Pointing the fresh session/.test(t);
  }, { timeout: 4000 }).then(() => true).catch(() => false);
  const done = await page.evaluate(() => ({
    note: (document.getElementById('__note') || {}).textContent || '',
    modalHidden: document.getElementById('rst-modal').hidden === true,
  }));
  const askN = await posted(page, /\/handoff-restart\/ask$/, 'POST');
  const restartN = await posted(page, /\/api\/agent\/[^/]+\/restart$/, 'POST');
  const pickupN = await posted(page, /\/handoff-restart\/pickup$/, 'POST');
  check('SUCCESS: the pre-restart phase shows the handoff-writing status while it polls', wroteStatus);
  check('SUCCESS: once the handoff is fresh, the restart interstitial mounts in the dialog', loaderMounted);
  check('SUCCESS: it asked once, restarted once, and delivered the pickup once',
    askN === 1 && restartN === 1 && pickupN === 1, `ask=${askN} restart=${restartN} pickup=${pickupN}`);
  check('SUCCESS: the modal closes and the receipt reports the fresh session was pointed at its handoff',
    settled && done.modalHidden && /pointed the fresh session at its handoff/i.test(done.note), JSON.stringify(done));

  // ---- Arm 2: HANDOFF NEVER ARRIVES. The wait elapses; it must NOT restart, and
  //             it restores the confirm view with the "has not finished" line.
  await page.evaluate(() => {
    window.__posted = [];
    window.__askState = 'placed';
    window.__statusCalls = 0; window.__freshAfterStatusCalls = Infinity;   // never fresh
    document.getElementById('__note').textContent = '';
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  await page.click('#rst-handoff-go');
  const timedOut = await page.waitForFunction(
    () => /has not finished its handoff yet/i.test(document.getElementById('rst-msg').textContent || ''),
    { timeout: 4000 }).then(() => true).catch(() => false);
  const afterTimeout = await page.evaluate(() => ({
    goBack: document.getElementById('rst-go').hidden === false && document.getElementById('rst-go').disabled === false,
    hgoBack: document.getElementById('rst-handoff-go').hidden === false,
    modalOpen: document.getElementById('rst-modal').hidden === false,
    note: (document.getElementById('__note') || {}).textContent || '',
  }));
  const restartOnTimeout = await posted(page, /\/api\/agent\/[^/]+\/restart$/, 'POST');
  check('TIMEOUT: an unwritten handoff NEVER triggers a restart (context is not lost to a maybe)',
    restartOnTimeout === 0, 'restart POSTs=' + restartOnTimeout);
  check('TIMEOUT: the confirm view is restored so the person can Restart-anyway or leave it running',
    timedOut && afterTimeout.goBack && afterTimeout.hgoBack && afterTimeout.modalOpen && afterTimeout.note === '',
    JSON.stringify(afterTimeout));

  // ---- Arm 3: THE ASK IS REFUSED. Never reaches the poll or the restart; the
  //             confirm view comes back with a could-not-ask line.
  await page.evaluate(() => {
    window.__posted = [];
    window.__askState = 'could_not';
    document.getElementById('__note').textContent = '';
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  await page.click('#rst-handoff-go');
  const refusedAsk = await page.waitForFunction(
    () => /could not ask .* to write a handoff/i.test(document.getElementById('rst-msg').textContent || ''),
    { timeout: 3000 }).then(() => true).catch(() => false);
  const askOnly = await posted(page, /\/handoff-restart\/ask$/, 'POST');
  const statusAfterRefuse = await posted(page, /\/handoff-restart\/status/, 'GET');
  const restartAfterRefuse = await posted(page, /\/api\/agent\/[^/]+\/restart$/, 'POST');
  const afterRefuse = await page.evaluate(() => ({
    goBack: document.getElementById('rst-go').hidden === false && document.getElementById('rst-go').disabled === false,
    modalOpen: document.getElementById('rst-modal').hidden === false,
  }));
  check('REFUSED-ASK: an unconfirmed ask never polls and never restarts',
    refusedAsk && askOnly === 1 && statusAfterRefuse === 0 && restartAfterRefuse === 0,
    `ask=${askOnly} status=${statusAfterRefuse} restart=${restartAfterRefuse}`);
  check('REFUSED-ASK: the confirm view is restored so the person can choose', afterRefuse.goBack && afterRefuse.modalOpen, JSON.stringify(afterRefuse));

  // ---- Arm 4: ABORT DURING THE WAIT. Nothing irreversible has happened yet, so
  //             "Leave it running" stays live through the handoff-write wait; clicking
  //             it closes the modal and NEVER restarts.
  await page.evaluate(() => {
    window.__posted = [];
    window.__askState = 'placed';
    window.__statusCalls = 0; window.__freshAfterStatusCalls = Infinity;   // never fresh, so the wait runs
    document.getElementById('__note').textContent = '';
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  await page.click('#rst-handoff-go');
  // Wait until we are in the writing-handoff phase.
  const inWait = await page.waitForFunction(
    () => /writing its handoff/i.test(document.getElementById('rst-msg').textContent || ''),
    { timeout: 2000 }).then(() => true).catch(() => false);
  // During the wait: RST_BUSY is false and "Leave it running" is visible + live.
  const duringWait = await page.evaluate(() => ({
    busy: (typeof RST_BUSY !== 'undefined') ? RST_BUSY : null,
    keepVisible: document.getElementById('rst-keep').hidden === false,
  }));
  // Click "Leave it running" to abort.
  await page.click('#rst-keep');
  await page.waitForTimeout(120);   // let a poll tick land so a racing restart would show
  const afterAbort = await page.evaluate(() => ({
    modalHidden: document.getElementById('rst-modal').hidden === true,
  }));
  const restartAfterAbort = await posted(page, /\/api\/agent\/[^/]+\/restart$/, 'POST');
  check('ABORT: during the handoff-write wait the flow is abortable (RST_BUSY false, Leave-it-running live)',
    inWait && duringWait.busy === false && duringWait.keepVisible, JSON.stringify(duringWait));
  check('ABORT: clicking Leave-it-running closes the modal and NEVER restarts',
    afterAbort.modalHidden && restartAfterAbort === 0, `modalHidden=${afterAbort.modalHidden} restart=${restartAfterAbort}`);

  if (pageErrors.length) check('no page/console errors during the run', false, pageErrors.join(' | '));
  else check('no page/console errors during the run', true);

  await browser.close();
  if (problems.length) {
    console.error('render-handoff-restart-3492: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-handoff-restart-3492: the restart dialog\'s third option drives ask -> wait-for-handoff -> restart -> pickup, shows the writing status then the restart interstitial, and lands the "pointed the fresh session at its handoff" receipt; an unwritten handoff and a refused ask both restore the confirm view and never restart.');
})().catch((err) => {
  console.error('FAIL  render-handoff-restart-3492: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});

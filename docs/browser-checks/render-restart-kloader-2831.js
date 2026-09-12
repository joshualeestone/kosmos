'use strict';

/**
 * kosmos#2831 (Josh, 0.6.57 live review, 2026-09-11): "if i restart an agent from here, it
 * should show the animated K to circle, send an auto hello, and tell the user to say hello to
 * wake the agent."
 *
 * The auto-hello already fires (#2686, covered by render-autohello-2686.js) and the branded K
 * loader already plays during a MODEL/PROVIDER change (#2692, covered by
 * render-model-restart-interstitial.js). This check covers the DELTA: the explicit
 * restart-from-here path (the rst-go confirm) now ALSO plays the loader -- the same
 * RESTART_BUSY_HTML + startKLoader interstitial, held on the RESTART_HOLD_MS floor -- before it
 * hands off to the existing auto-hello receipt.
 *
 * WHAT SOURCE CANNOT SEE, and why this needs a browser: that clicking the REAL rst-go handler
 * (1) mounts the branded loader canvas in rst-modal and it ACTUALLY PAINTS, (2) hides the confirm
 * content while it holds, (3) HOLDS for the floor on success then tears the loader down (canvas
 * detached, so its rAF loop bails) and resolves the receipt to the placed line WITH the say-hello
 * nudge, and (4) on a REFUSED restart does NOT hold -- the failure line shows at once and the
 * confirm controls come back. window.__kosmosRestartHoldMs shortens the prod hold so the check is
 * fast; a source control asserts the interstitial is wired on this path and the hold is the shared
 * floor.
 *
 * Per docs/browser-checks/README.md (#1769): a committed headless check runs from ANY session, no
 * MCP, no operator. It loads the page over file:// and answers every route from a window.fetch stub.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 \
 *     node docs/browser-checks/render-restart-kloader-2831.js
 *
 * NODE_PATH is not optional: require resolves from THIS file's directory.
 */

const nodePath = require('node:path');
const fs = require('node:fs');
let playwright;
try { playwright = require('playwright'); }
catch { console.log('render-restart-kloader-2831: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE_PATH = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const PAGE = 'file://' + PAGE_PATH;
const HEADED = process.env.HEADED !== '0';

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

// The fetch stub. Answers the three routes this flow touches (restart, status poll, thread) and a
// benign default for everything else. `__restartOutcome` lets an arm make the restart REFUSE.
function initStub() {
  window.__posted = [];
  window.setInterval = () => 0;   // stop the page's own polling racing the hand-driven steps
  window.__statusSinceRestart = 0;
  window.__readyAfterCalls = 1;   // gap-then-ready, so the auto-hello sends and reports "placed"
  window.__restartOutcome = 'restarted';   // an arm sets 'refused' to exercise the failure path
  window.__threadResp = { recorded: true, delivery: { state: 'placed' } };
  const enc = (o, status) => new Response(JSON.stringify(o), {
    status: status || 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method ? String(opts.method) : 'GET').toUpperCase();
    window.__posted.push({ url: u, method });
    if (/\/api\/agent\/[^/]+\/restart$/.test(u) && method === 'POST') {
      window.__statusSinceRestart = 0;
      if (window.__restartOutcome === 'refused') {
        return enc({ outcome: 'refused', because: 'It was not started by Kosmos, so we cannot start it again.',
          steps: [{ label: 'close its window', ok: false }] }, 400);
      }
      return enc({ outcome: 'restarted', steps: [] });
    }
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
  // Source controls: the interstitial is wired on the rst-go path (RESTART_BUSY_HTML mounted +
  // startKLoader driven on its canvas), and it holds on the SHARED floor RESTART_HOLD_MS -- the
  // same constant the model/provider interstitial uses, so the two cannot drift.
  const src = fs.readFileSync(PAGE_PATH, 'utf8');
  const rstGo = src.slice(src.indexOf("getElementById('rst-go').addEventListener"));
  const rstGoBody = rstGo.slice(0, rstGo.indexOf('\n});'));
  check('#2831: the rst-go handler mounts the branded loader markup (RESTART_BUSY_HTML) and drives startKLoader on its canvas',
    /rst-msg'\)\.innerHTML = RESTART_BUSY_HTML/.test(rstGoBody) && /startKLoader\(kcv\)/.test(rstGoBody));
  check('#2831: the rst-go hold reads the SHARED RESTART_HOLD_MS floor (via the __kosmosRestartHoldMs test seam), not a bare literal',
    /window\.__kosmosRestartHoldMs/.test(rstGoBody) && /RESTART_HOLD_MS/.test(rstGoBody));

  let browser;
  try { browser = await playwright.chromium.launch({ headless: !HEADED }); }
  catch (err) {
    console.error('FAIL  render-restart-kloader-2831: could not start a browser'
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

  // Pin reduced-motion OFF so startKLoader takes its ANIMATING (rAF) path and paints deterministically.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(initStub);
  await page.goto(PAGE);
  if (await page.isVisible('#firstrun')) await page.keyboard.press('Escape');

  await page.evaluate(() => {
    RESTART_READY_WINDOW_MS = 800;
    RESTART_READY_POLL_MS = 60;
    LAST = [{ sessionName: 'april', name: 'April', displayName: 'April', role: 'a researcher' }];
    CURRENT = { sessionName: 'april', name: 'April' };
    // A restart button + its stale-notice sibling, exactly the shape noteFor() reads.
    document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    const host = document.createElement('div'); host.id = '__ah';
    host.innerHTML = '<div class="row"><button type="button" data-restart-agent="april">Restart</button>'
      + '<span class="instr-restart-note"></span></div>';
    document.body.appendChild(host);
  });

  const PLACED = 'Restarted, and said hello to wake them. Say hello when you want to talk to them.';

  // Does the loader canvas mounted in the rst-modal interstitial have painted pixels?
  const loaderPaints = () => page.evaluate(() => {
    const kcv = document.querySelector('#rst-msg .chg-restart-k');
    if (!kcv || !kcv.getContext) return false;
    try {
      const d = kcv.getContext('2d').getImageData(0, 0, kcv.width, kcv.height).data;
      for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return true; }
    } catch { return false; }
    return false;
  });

  // ---- Arm 1: SUCCESS. The loader shows + paints + hides the confirm content while it holds,
  //             then tears down and the receipt reaches the placed line with the say-hello nudge.
  await page.evaluate(() => {
    window.__posted = [];
    window.__restartOutcome = 'restarted';
    // readyAfter=2 (not 1): tick()'s own status call consumes the first poll, so the
    // readiness wait must see a SECOND restarting poll before recovery, or its #2019
    // sawUnready guard never observes the gap and falls to the manual line. Same value
    // render-autohello-2686's success arm uses, for the same reason.
    window.__readyAfterCalls = 2; window.__statusSinceRestart = 0;
    window.__kosmosRestartHoldMs = 300;   // long enough to observe the held interstitial, fast to pass
    document.querySelector('#__ah .instr-restart-note').textContent = '';
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  await page.click('#rst-go');
  await page.waitForTimeout(80);   // interstitial up, well inside the 300ms hold
  const busy = await page.evaluate(() => ({
    modalOpen: document.getElementById('rst-modal').hidden === false,
    hasCanvas: !!document.querySelector('#rst-modal #rst-msg canvas.chg-restart-k'),
    restartingText: /Restarting the agent/i.test(document.getElementById('rst-msg').innerHTML),
    keepHidden: document.getElementById('rst-keep').hidden === true,
    goHidden: document.getElementById('rst-go').hidden === true,
    smallHidden: document.getElementById('rst-small').hidden === true,
    costHidden: document.getElementById('rst-cost').hidden === true,
    noReceiptYet: (document.querySelector('#__ah .instr-restart-note').textContent || '') === '',
  }));
  const busyPaints = await loaderPaints();
  // Hold a reference to the live canvas to prove the success teardown detaches it.
  await page.evaluate(() => { window.__kcv = document.querySelector('#rst-modal #rst-msg canvas.chg-restart-k'); });
  const stillHeld = await page.evaluate(() => {
    // still inside the hold: interstitial up, receipt not written yet
    return /Restarting the agent/i.test(document.getElementById('rst-msg').innerHTML)
      && (document.querySelector('#__ah .instr-restart-note').textContent || '') === '';
  });
  await page.waitForFunction(() => {
    const t = (document.querySelector('#__ah .instr-restart-note') || {}).textContent || '';
    return t && !/Waking them/.test(t);
  }, { timeout: 4000 }).catch(() => {});
  const done = await page.evaluate(() => ({
    note: (document.querySelector('#__ah .instr-restart-note') || {}).textContent || '',
    modalHidden: document.getElementById('rst-modal').hidden === true,
    canvasDetached: !!(window.__kcv && !window.__kcv.isConnected),
    threadCalls: window.__posted.filter((p) => /\/api\/agent\/[^/]+\/thread$/.test(p.url) && p.method === 'POST').length,
  }));

  check('SUCCESS: the branded loader canvas mounts in the restart dialog and is ACTUALLY PAINTING while it holds',
    busy.hasCanvas && busyPaints && busy.restartingText, JSON.stringify(busy) + ' paints=' + busyPaints);
  check('SUCCESS: the confirm content (Restart/Leave-running buttons, the two sentences) is HIDDEN behind the interstitial',
    busy.keepHidden && busy.goHidden && busy.smallHidden && busy.costHidden, JSON.stringify(busy));
  check('SUCCESS: nothing is claimed while the loader holds (no receipt yet)', busy.noReceiptYet && stillHeld,
    'noReceiptYet=' + busy.noReceiptYet + ' stillHeld=' + stillHeld);
  check('SUCCESS: exactly one auto-hello is sent after the restart (the #2686 behavior is preserved)',
    done.threadCalls === 1, 'calls=' + done.threadCalls);
  check('SUCCESS: the receipt reaches the placed line WITH the say-hello nudge (#2831)', done.note === PLACED, JSON.stringify(done.note));
  check('SUCCESS: the modal closes and the loader canvas is DETACHED afterwards (its rAF loop bails, no leak)',
    done.modalHidden && done.canvasDetached, JSON.stringify(done));

  // ---- Arm 2: REFUSED. No hold on failure -- the failure line shows at once even with a LONG
  //             hold set, the confirm controls come back, and no loader canvas is left mounted.
  await page.evaluate(() => {
    window.__posted = [];
    window.__restartOutcome = 'refused';
    window.__kosmosRestartHoldMs = 5000;   // if the failure path (wrongly) held, this arm would time out
    document.querySelector('#__ah .instr-restart-note').textContent = '';
    openRestartModal(document.querySelector('#__ah [data-restart-agent]'), 'april');
  });
  const clickAt = Date.now();
  await page.click('#rst-go');
  await page.waitForFunction(() => /cannot start it again/i.test(document.getElementById('rst-msg').textContent || ''),
    { timeout: 3000 }).catch(() => {});
  const failMs = Date.now() - clickAt;
  const refused = await page.evaluate(() => ({
    failLine: /cannot start it again/i.test(document.getElementById('rst-msg').textContent || ''),
    noCanvas: !document.querySelector('#rst-msg canvas.chg-restart-k'),
    goBack: document.getElementById('rst-go').hidden === false && document.getElementById('rst-go').disabled === false,
    modalStillOpen: document.getElementById('rst-modal').hidden === false,
    note: (document.querySelector('#__ah .instr-restart-note') || {}).textContent || '',
  }));
  check('REFUSED: the failure line shows WELL under the 5000ms hold -- a failure does not hold the loader',
    refused.failLine && failMs < 3000, 'failLine=' + refused.failLine + ' ms=' + failMs);
  check('REFUSED: the loader is torn down and the confirm controls are restored so the person can retry',
    refused.noCanvas && refused.goBack && refused.modalStillOpen, JSON.stringify(refused));
  check('REFUSED: no false auto-hello receipt is written for a restart that did not take', refused.note === '', JSON.stringify(refused.note));

  if (pageErrors.length) check('no page/console errors during the run', false, pageErrors.join(' | '));
  else check('no page/console errors during the run', true);

  await browser.close();
  if (problems.length) {
    console.error('render-restart-kloader-2831: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-restart-kloader-2831: the explicit restart-from-here (rst-go) path plays the branded K-into-circle loader (RESTART_BUSY_HTML + startKLoader) held on the shared RESTART_HOLD_MS floor with the confirm content hidden, then tears it down and lands the #2686 auto-hello receipt on the placed line WITH the say-hello nudge; a refused restart does not hold, shows the failure line, and restores the controls.');
})().catch((err) => {
  console.error('FAIL  render-restart-kloader-2831: the check itself threw: '
    + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});

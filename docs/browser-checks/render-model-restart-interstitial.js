'use strict';
/**
 * kosmos#768-batch (Josh 0.6.47 notes, screenshot 5.51.59): switching an agent's model
 * shows a RESTART INTERSTITIAL over "Restarting the agent", held on screen while the agent
 * restarts, then the confirm dialog reduces to the one action left: "Say hello to <agent>
 * to reactivate them on <provider>."
 *
 * #2692 (Josh, design channel 2026-09-10): the interstitial's mark is now the BRANDED K
 * LOADER (the big K made of dots that gathers and opens back to the circle, startKLoader),
 * NOT the small breathing .kspin Kosmos MARK Josh flagged as the wrong asset. It holds for
 * at least one full loop of that animation -- the floor is max(2s, K_LOADER_CYCLE_MS).
 *
 * #2463 follow-up (Mona): the PROVIDER switch now shows the same interstitial, worded
 * "Setting up OpenAI" / "Setting up Anthropic", and reduces to the same reactivate line.
 * The remaining three change dialogs (account move, compact, clear) are unchanged: plain
 * "Working…", no hold. And the hold is now a ~2s FLOOR (RESTART_HOLD_MS), not a fixed ~10s:
 * the interstitial stays until the restart finishes (the awaited POST), the floor only keeps
 * a fast restart on screen long enough to read.
 *
 * WHAT SOURCE CANNOT SEE: that the opt-in `busyHtml`/`minBusyMs` added to the shared
 * changeDialog actually (1) paints the interstitial, (2) HOLDS it on success then renders
 * the reduced sentence, (3) does NOT hold on failure (renders at once), (4) never traps
 * the modal, (5) leaves the three plain callers on "Working…", and (6) drives BOTH the model
 * and the provider flows to the reduced reactivate line. This drives the REAL functions in a
 * browser. `window.__kosmosRestartHoldMs` shortens the prod hold so the check is fast; a
 * control asserts the prod floor is 2000 in source.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-model-restart-interstitial.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */
const nodePath = require('node:path');
const fs = require('node:fs');
let playwright;
try { playwright = require('playwright'); }
catch { console.log('render-model-restart-interstitial: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

(async () => {
  // Source control: #2692 raised the prod hold FLOOR from a bare 2s to max(2s, one full
  // K-loader cycle) so a fast restart still shows one whole K-into-circle animation, per
  // Josh's ask; the floor is DERIVED from the loader's own cycle constant so the two cannot
  // drift. The provider switch opts into the interstitial with its own "Setting up <provider>".
  const src = fs.readFileSync(PAGE, 'utf8');
  check('#2692: the restart hold floor is max(2000, one loader cycle), derived from K_LOADER_CYCLE_MS (not a bare 2000 that could no longer cover a full animation)',
    /const RESTART_HOLD_MS = Math\.max\(2000, K_LOADER_CYCLE_MS\);/.test(src));
  check('#2692: K_LOADER_CYCLE_MS is the single source for the loop length (4400ms), shared by the loader and the hold floor',
    /const K_LOADER_CYCLE_MS = 4400;/.test(src) && /el % K_LOADER_CYCLE_MS/.test(src));
  check('#2692: the interstitial markup mounts the BRANDED loader canvas (.chg-restart-k), not the small breathing .kspin img',
    /class="chg-restart-k"/.test(src) && !/chg-restart"><span class="kspin"/.test(src));
  check('the provider switch opts into the interstitial with a "Setting up <provider>" line',
    /busyHtml:\s*chgBusyHtml\('Setting up ' \+ label\)/.test(src));

  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-model-restart-interstitial: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  // #2692: pin reduced-motion OFF so the detached-canvas control below deterministically
  // exercises startKLoader's ANIMATING path -- the only path with an rAF loop, and so the
  // only path the !cv.isConnected guard governs. Under prefers-reduced-motion: reduce the
  // loader takes a one-shot synchronous frame(1,0) and never enters tick(), which both paints
  // a detached canvas (false-red for the control) and has no loop to leak anyway. Emulating
  // no-preference makes the check machine-independent instead of depending on the host's
  // motion setting (the animating arms -- loaderPainted etc. -- are unaffected: they animate
  // under no-preference and painted a static frame under reduce, so both were already green).
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const back = document.getElementById('chg-modal');
    const msg = document.getElementById('chg-msg');
    const keep = document.getElementById('chg-keep');
    const goBtn = document.getElementById('chg-go');
    const sm = document.getElementById('chg-small');
    if (typeof changeDialog !== 'function') return { error: 'changeDialog is not on the page' };

    // #2692: the hold floor and the loop length are top-level consts (like CURRENT). Reading
    // them here proves both that they evaluated with no scope/TDZ error at load AND that the
    // floor covers at least one full K-into-circle animation (Josh's requirement).
    const holdFloor = (typeof RESTART_HOLD_MS !== 'undefined') ? RESTART_HOLD_MS : null;
    const cycleMs = (typeof K_LOADER_CYCLE_MS !== 'undefined') ? K_LOADER_CYCLE_MS : null;
    // Does the loader canvas currently mounted in the interstitial have any painted pixels?
    // A present-but-blank canvas would pass a mere querySelector; this proves startKLoader ran.
    const loaderPainted = () => {
      const kcv = document.querySelector('#chg-msg .chg-restart-k');
      if (!kcv || !kcv.getContext) return false;
      try {
        const d = kcv.getContext('2d').getImageData(0, 0, kcv.width, kcv.height).data;
        for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return true; }
      } catch { return false; }
      return false;
    };

    // #2692 lifecycle guard (negative control for the fix): on the ANIMATING path, startKLoader
    // must NOT drive a DETACHED canvas -- its rAF loop bails on `!cv.isConnected`. A connected
    // canvas paints (proven in the model arm below); a detached one stays blank, which is exactly
    // why the loop self-terminates when the restart interstitial is torn down instead of leaking.
    // If someone deletes the guard, tick draws the ring here and this arm goes red. Scope: this
    // covers the rAF path only -- reduced-motion takes a one-shot frame(1,0) with no loop, so
    // there is nothing to leak and nothing for the guard to do there; reduced-motion is pinned
    // off above so this control always runs the path it is written for.
    let detachedPainted = null;
    if (typeof startKLoader === 'function') {
      const detached = document.createElement('canvas');
      detached.width = 176; detached.height = 206;
      startKLoader(detached);
      await sleep(140);
      detachedPainted = false;
      try {
        const d = detached.getContext('2d').getImageData(0, 0, detached.width, detached.height).data;
        for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) { detachedPainted = true; break; } }
      } catch { detachedPainted = null; }
    }

    // 1. MECHANISM, success: busyHtml paints, HOLDS for minBusyMs, then the sentence.
    changeDialog({ title: 't', small: 's', go: 'Go', busyHtml: '<span class="chg-restart">BUSYMARK</span>',
      minBusyMs: 400, run: (say) => { say('DONEMARK', true); } });
    goBtn.click();
    await sleep(60);
    // CLEAN interstitial: the interstitial paints, the modal has no exit, AND the
    // now-decided confirm button + small text are HIDDEN (not tacked under the question).
    const busyShown = /BUSYMARK/.test(msg.innerHTML) && back.hidden === false
      && goBtn.hidden === true && keep.hidden === true && sm.hidden === true;
    await sleep(120); // still inside the 400ms hold
    const stillHeld = /BUSYMARK/.test(msg.innerHTML) && !/DONEMARK/.test(msg.textContent);
    await sleep(400); // past the hold
    const rendered = /DONEMARK/.test(msg.textContent) && keep.hidden === false && keep.textContent === 'Done';
    keep.click();

    // 2. MECHANISM, failure: minBusyMs set but NOT held -- error shows at once.
    changeDialog({ title: 't', small: 's', go: 'Go', busyHtml: '<span>BUSY2</span>',
      minBusyMs: 5000, run: (say) => { say('FAILMARK', false); } });
    goBtn.click();
    await sleep(80); // well under 5000
    const failFast = /FAILMARK/.test(msg.textContent) && keep.hidden === false && keep.textContent === 'Close';
    keep.click();

    // 3. MECHANISM, no-hold caller is byte-unchanged: plain "Working…", renders at once.
    let plainBusy = '';
    let plainSmHidden = null;
    changeDialog({ title: 't', small: 's', go: 'Go', run: (say) => { plainBusy = msg.textContent; plainSmHidden = sm.hidden; say('PLAINDONE', true); } });
    goBtn.click();
    await sleep(30);
    // Unchanged caller: plain "Working…", and the small text is NOT hidden (interstitial-hide is opt-in).
    const plainWorking = plainBusy === 'Working…' && plainSmHidden === false && /PLAINDONE/.test(msg.textContent);
    keep.click();

    // 4. THE MODEL FLOW: stub the POST, set CURRENT + the picker, click the real
    //    #d-model-go handler. Shorten the hold so the reduced text is reachable fast.
    window.__kosmosRestartHoldMs = 300;
    // CURRENT is a top-level `let`, not a window property, so assign the binding directly.
    CURRENT = { sessionName: 'sess-1', name: 'FClaude-Casey', runner: 'claude', isNamedOurs: true };
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/api/agent/') !== -1 && u.indexOf('/model') !== -1 && opts && opts.method === 'POST') {
        return { ok: true, json: async () => ({ outcome: 'changed', because: 'Changed and restarting on the new model.' }) };
      }
      return realFetch(url, opts);
    };
    const curAfterSet = (typeof CURRENT !== 'undefined' && CURRENT && CURRENT.sessionName) || null;
    const sel = document.getElementById('d-model');
    sel.innerHTML = '<option value="opus5">Claude Opus 5</option>';
    sel.value = 'opus5';
    const dgo = document.getElementById('d-model-go');
    dgo.disabled = false;                       // the picker's change-listener normally enables it; we set value directly
    dgo.click();                                // opens the confirm dialog (title/small/Go)
    document.getElementById('chg-go').click();  // confirm -> triggers the busy interstitial + run
    await sleep(70); // interstitial is up, before the 300ms hold elapses
    const modelBusy = {
      restarting: /Restarting the agent/i.test(msg.innerHTML),
      // #2692: the BRANDED loader canvas is mounted, it is actually painting, and the old
      // small pulsing .kspin mark Josh flagged is GONE from the interstitial.
      hasLoaderCanvas: !!document.querySelector('#chg-msg .chg-restart canvas.chg-restart-k'),
      loaderPainted: loaderPainted(),
      noPulsingIcon: !document.querySelector('#chg-msg .chg-restart .kspin'),
      noReducedYet: !/Say hello/i.test(msg.textContent),
    };
    await sleep(400); // past the 300ms hold
    const reducedText = msg.textContent;
    const modelDone = /Say hello to FClaude-Casey to reactivate them on Claude\./.test(reducedText) && keep.textContent === 'Done';
    if (!back.hidden) keep.click();

    // 5. THE PROVIDER FLOW (#2463 follow-up): stub the POST, set the provider picker to
    //    OpenAI, click the real #d-provider-go handler. Same shortened hold. CURRENT is on
    //    Claude (runner 'claude'), so OpenAI is a real switch. With no OpenAI accounts,
    //    openaiAllDead returns false (no rows to be dead), so the switch is not refused.
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/api/agent/') !== -1 && u.indexOf('/provider') !== -1 && opts && opts.method === 'POST') {
        return { ok: true, json: async () => ({ outcome: 'changed', provider: 'openai', because: 'OpenAI it is. It is starting again now, and it will look idle until you say something to it.' }) };
      }
      return realFetch(url, opts);
    };
    const psel = document.getElementById('d-provider');
    psel.innerHTML = '<option value="openai">OpenAI</option>';
    psel.value = 'openai';
    const pgo = document.getElementById('d-provider-go');
    pgo.disabled = false;                        // the provider change-listener normally enables it
    pgo.click();                                 // opens the confirm dialog
    document.getElementById('chg-go').click();   // confirm -> "Setting up OpenAI" interstitial + run
    await sleep(70); // interstitial up, before the 300ms hold elapses
    const providerBusy = {
      settingUp: /Setting up OpenAI/i.test(msg.innerHTML),
      hasLoaderCanvas: !!document.querySelector('#chg-msg .chg-restart canvas.chg-restart-k'),
      noPulsingIcon: !document.querySelector('#chg-msg .chg-restart .kspin'),
      noReducedYet: !/Say hello/i.test(msg.textContent),
    };
    await sleep(400); // past the 300ms hold
    const providerReducedText = msg.textContent;
    const providerDone = /Say hello to FClaude-Casey to reactivate them on OpenAI\./.test(providerReducedText) && keep.textContent === 'Done';
    if (!back.hidden) keep.click();

    // 6. THE PROVIDER FLOW, ANTHROPIC ARM: the switch names ONE vocabulary end to end. CURRENT
    //    is now an OpenAI agent (runner 'codex'), so switching to Anthropic is a real change; the
    //    interstitial must say "Setting up Anthropic" and the reduced line "reactivate them on
    //    Anthropic" (the provider the person chose), NOT "Claude". want !== 'openai', so the
    //    openaiAllDead guard does not apply. This arm was previously untested.
    CURRENT = { sessionName: 'sess-2', name: 'FCodex-Casey', runner: 'codex', isNamedOurs: true };
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/api/agent/') !== -1 && u.indexOf('/provider') !== -1 && opts && opts.method === 'POST') {
        return { ok: true, json: async () => ({ outcome: 'changed', provider: 'anthropic', because: 'Claude it is. It is starting again now, and it will look idle until you say something to it.' }) };
      }
      return realFetch(url, opts);
    };
    const psel2 = document.getElementById('d-provider');
    psel2.innerHTML = '<option value="anthropic">Anthropic</option>';
    psel2.value = 'anthropic';
    const pgo2 = document.getElementById('d-provider-go');
    pgo2.disabled = false;
    pgo2.click();
    document.getElementById('chg-go').click();
    await sleep(70);
    const providerAnthBusy = {
      settingUp: /Setting up Anthropic/i.test(msg.innerHTML),
      hasLoaderCanvas: !!document.querySelector('#chg-msg .chg-restart canvas.chg-restart-k'),
      noPulsingIcon: !document.querySelector('#chg-msg .chg-restart .kspin'),
      notClaudeSetup: !/Setting up Claude/i.test(msg.innerHTML),
    };
    await sleep(400);
    const providerAnthReducedText = msg.textContent;
    // The whole dialog speaks "Anthropic", never "Claude": consistent last-screen vocabulary.
    const providerAnthConsistent = /Say hello to FCodex-Casey to reactivate them on Anthropic\./.test(providerAnthReducedText)
      && !/reactivate them on Claude/i.test(providerAnthReducedText) && keep.textContent === 'Done';
    if (!back.hidden) keep.click();

    return { holdFloor, cycleMs, detachedPainted, busyShown, stillHeld, rendered, failFast, plainWorking, curAfterSet, modelBusy, reducedText, modelDone,
      providerBusy, providerReducedText, providerDone,
      providerAnthBusy, providerAnthReducedText, providerAnthConsistent };
  });

  if (r.error) { console.error('render-model-restart-interstitial: ' + r.error); await browser.close(); process.exit(1); }
  if (pageErrors.length) { console.error('page error(s): ' + pageErrors.join(' | ')); await browser.close(); process.exit(1); }

  check('MECHANISM: busyHtml paints and the modal has no exit while it holds', r.busyShown, JSON.stringify(r.busyShown));
  check('MECHANISM: the interstitial is HELD for minBusyMs before the success sentence renders', r.stillHeld, JSON.stringify(r.stillHeld));
  check('MECHANISM: after the hold the success sentence renders with a Done exit', r.rendered, JSON.stringify(r.rendered));
  check('MECHANISM: a FAILURE renders at once (minBusyMs is success-only, so the modal never hangs on an error)', r.failFast, JSON.stringify(r.failFast));
  check('CONTROL: a caller with NO busyHtml is byte-unchanged -- plain "Working…", renders at once', r.plainWorking, JSON.stringify(r.plainWorking));
  check('PROBE: CURRENT reassigned for the model test', r.curAfterSet === 'sess-1', 'curAfterSet=' + JSON.stringify(r.curAfterSet));
  check('#2692: the hold floor (RESTART_HOLD_MS) is at least one full loader cycle (K_LOADER_CYCLE_MS), so a fast restart shows the whole K-into-circle animation',
    r.holdFloor === 4400 && r.cycleMs === 4400 && r.holdFloor >= r.cycleMs, 'holdFloor=' + r.holdFloor + ' cycleMs=' + r.cycleMs);
  check('#2692 lifecycle guard: startKLoader does NOT paint a DETACHED canvas -- its loop bails on !isConnected, so a torn-down interstitial cannot leak an rAF loop',
    r.detachedPainted === false, 'detachedPainted=' + JSON.stringify(r.detachedPainted));
  check('MODEL: the change-model dialog shows the branded K-LOADER "Restarting the agent" interstitial (canvas present, actually painting), not plain "Working…"',
    r.modelBusy && r.modelBusy.restarting && r.modelBusy.hasLoaderCanvas && r.modelBusy.loaderPainted && r.modelBusy.noReducedYet, JSON.stringify(r.modelBusy));
  check('#2692: the small pulsing .kspin mark Josh flagged is GONE from the restart interstitial',
    r.modelBusy && r.modelBusy.noPulsingIcon, JSON.stringify(r.modelBusy));
  check('MODEL: after the hold the dialog reduces to "Say hello to <agent> to reactivate them on <provider>"',
    r.modelDone, JSON.stringify((r.reducedText || '').slice(0, 90)));
  check('PROVIDER: the provider switch shows the branded K-loader "Setting up OpenAI" interstitial (canvas present, pulsing .kspin gone), not plain "Working…"',
    r.providerBusy && r.providerBusy.settingUp && r.providerBusy.hasLoaderCanvas && r.providerBusy.noPulsingIcon && r.providerBusy.noReducedYet, JSON.stringify(r.providerBusy));
  check('PROVIDER: after the hold the provider dialog reduces to "Say hello to <agent> to reactivate them on OpenAI"',
    r.providerDone, JSON.stringify((r.providerReducedText || '').slice(0, 90)));
  check('PROVIDER (Anthropic arm): the branded-loader interstitial says "Setting up Anthropic" (not "Setting up Claude"), pulsing .kspin gone',
    r.providerAnthBusy && r.providerAnthBusy.settingUp && r.providerAnthBusy.hasLoaderCanvas && r.providerAnthBusy.noPulsingIcon && r.providerAnthBusy.notClaudeSetup, JSON.stringify(r.providerAnthBusy));
  check('PROVIDER (Anthropic arm): the dialog speaks ONE vocabulary -- reduces to "reactivate them on Anthropic", never "on Claude"',
    r.providerAnthConsistent, JSON.stringify((r.providerAnthReducedText || '').slice(0, 90)));

  await browser.close();
  if (problems.length) {
    console.error('render-model-restart-interstitial: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-model-restart-interstitial: the model switch ("Restarting the agent") and the provider switch ("Setting up OpenAI") both show the #2692 branded K-loader interstitial (canvas, actually painting, the old pulsing .kspin gone), held on the max(2s, one-cycle) floor on success then reduced to "Say hello to <agent> to reactivate them on <provider>"; a failure renders at once; the three remaining dialogs (account move, compact, clear) stay on plain "Working…".');
})();

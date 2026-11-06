'use strict';
/**
 * kosmos#768-batch (Josh 0.6.47 notes, screenshot 5.51.59): switching an agent's model
 * shows a RESTART INTERSTITIAL over "Restarting the agent", held on screen while the agent
 * restarts, then the confirm dialog reduces to one line naming the provider. Since #2716 the
 * app sends the wake hello itself, so that line is "Restarted on <provider>. Waking them..."
 * while the hello is pending; render-autohello-switch-2716.js covers how it resolves (to the
 * finished "Ready: <agent> is on <what>.", or to "<agent> is on <what>. Send them a message to wake
 * them."). #4008: the waiting line carries the Sweep loader, and Done is not gold until it finishes.
 *
 * #2692 (Josh, design channel 2026-09-10): the interstitial's mark became the BRANDED K
 * LOADER (startKLoader), NOT the small breathing .kspin Kosmos MARK Josh flagged as the wrong
 * asset. #7896 (Josh 11-06 12:17, "anywhere we had the K Loader I want it to be the Orb"): it
 * is now the 88 px turning KOSMOS orb, chgBusyHtml's kOrbWaitHtml('chg-restart-k', '', 88),
 * which KORB draws into its own canvas.korb once it is in the page (no call site drives
 * startKLoader on it any more). The hold floor is unchanged: max(2s, K_LOADER_CYCLE_MS).
 *
 * #2463 follow-up (Mona): the PROVIDER switch now shows the same interstitial, worded
 * "Setting up OpenAI" / "Setting up Anthropic", and reduces to the same reactivate line.
 * The remaining three change dialogs (account move, compact, clear) are unchanged: plain
 * "Working…", no hold. The hold is a FLOOR (RESTART_HOLD_MS), not a fixed duration: the
 * interstitial stays until the restart finishes (the awaited POST), and the floor only keeps
 * a fast restart on screen long enough to read. #2463 set that floor at ~2s; #2692 raised it
 * to max(2s, K_LOADER_CYCLE_MS) = 4400ms so a fast restart still shows one whole animation.
 *
 * WHAT SOURCE CANNOT SEE: that the opt-in `busyHtml`/`minBusyMs` added to the shared
 * changeDialog actually (1) paints the interstitial, (2) HOLDS it on success then renders
 * the reduced sentence, (3) does NOT hold on failure (renders at once), (4) never traps
 * the modal, (5) leaves the three plain callers on "Working…", and (6) drives BOTH the model
 * and the provider flows to the reduced reactivate line. This drives the REAL functions in a
 * browser. `window.__kosmosRestartHoldMs` shortens the prod hold so the check is fast; a
 * control asserts the prod floor is max(2000, K_LOADER_CYCLE_MS) in source, and the runtime
 * reads the live value (4400). "The mark shows" is proved by ink in the orb's canvas.korb and
 * "it is moving" by two samples some frames apart that differ.
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
  // K-loader cycle); the floor is DERIVED from the loader's own cycle constant so the two cannot
  // drift, and #7896 kept it when the orb replaced the K here. The provider switch opts into the interstitial with its own "Setting up <provider>".
  const src = fs.readFileSync(PAGE, 'utf8');
  check('#2692: the restart hold floor is max(2000, one loader cycle), derived from K_LOADER_CYCLE_MS (not a bare 2000 that could no longer cover a full animation)',
    /const RESTART_HOLD_MS = Math\.max\(2000, K_LOADER_CYCLE_MS\);/.test(src));
  check('#2692: K_LOADER_CYCLE_MS is the single source for the hold\'s loop length (4400ms), kept when #7896 retired the K loader',
    /const K_LOADER_CYCLE_MS = 4400;/.test(src));
  check('#7896: the interstitial markup (chgBusyHtml) mounts the turning KOSMOS orb (kOrbWaitHtml chg-restart-k, 88 px), not the K canvas or the breathing .kspin',
    /const chgBusyHtml = \(line\) => '<span class="chg-restart">'\s*\+ kOrbWaitHtml\('chg-restart-k', '', 88\)/.test(src)
      && !/class="chg-restart-k"/.test(src) && !/chg-restart"><span class="kspin"/.test(src));
  check('#7896: no call site drives the K loader on the interstitial any more (KORB draws the orb itself)',
    !/startKLoader\(kcv\)/.test(src));
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
  // #7896: reduced motion OFF also lets KORB turn the orb (under reduce it draws it once, still).
  // #2692 (history): reduced-motion was pinned OFF for the K loader's detached-canvas control, which
  // #7896 retired with the loader; it stays OFF so the orb's moving arms test a turning orb on any host.
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
    // #7896: the orb KORB draws into the interstitial. ink = pixels with alpha over 20 (a laid-out
    // blank canvas has none), sum = a hash of the alpha plane, so two samples a few frames apart
    // differ only if the orb is turning.
    const ORB_CV = '#chg-msg .chg-restart .chg-restart-k.orb-wait:not(.orb-still) > canvas.korb';
    const orbSample = () => {
      const kcv = document.querySelector(ORB_CV);
      if (!kcv || !kcv.width) return { ink: 0, sum: -1 };
      try {
        const d = kcv.getContext('2d').getImageData(0, 0, kcv.width, kcv.height).data;
        let ink = 0; let sum = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i] > 20) ink += 1; sum = (sum + d[i] * (i + 1)) % 1000000007; }
        return { ink, sum };
      } catch { return { ink: 0, sum: -1 }; }
    };
    // Drawn, and turning: sampled, then again 150 ms (about four KORB frames) later.
    const orbTurning = async () => {
      const a = orbSample(); await sleep(150); const b = orbSample();
      return { drawn: a.ink > 200, moving: a.ink > 200 && b.ink > 200 && a.sum !== b.sum, ink: a.ink };
    };

    // #7896 (Josh 11-06 12:17): the K loader is gone from the app; every wait it drew is the orb, which KORB lets go of
    // once its canvas leaves the page (pinned by the teardown arm below).
    const kLoaderGone = typeof startKLoader === 'undefined';

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
    window.__kosmosRestartHoldMs = 500;   // long enough to sample the orb twice inside it
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
    await sleep(70); // interstitial is up, before the 500ms hold elapses
    // #2692: hold a reference to the LIVE interstitial canvas so we can prove, end to end, that
    // the REAL teardown path (the success render replacing the modal's content) detaches it -
    // which is what makes the isConnected guard fire in production. The detached-canvas control
    // above is a unit proxy for the guard; this is the integration proof that the guard's
    // precondition (a detach) actually happens on the real success transition.
    const modelCanvas = document.querySelector(ORB_CV);
    const modelCanvasConnectedDuringBusy = !!(modelCanvas && modelCanvas.isConnected);
    const modelBusy = {
      restarting: /Restarting the agent/i.test(msg.innerHTML),
      // #7896: the orb is mounted, drawn and turning; the K canvas and the old pulsing .kspin are gone.
      hasOrb: !!document.querySelector(ORB_CV),
      orb: await orbTurning(),
      noPulsingIcon: !document.querySelector('#chg-msg .chg-restart .kspin') && !document.querySelector('#chg-msg canvas.chg-restart-k'),
      noReducedYet: !/Say hello|Waking them/i.test(msg.textContent),
    };
    await sleep(500); // past the 500ms hold
    const reducedText = msg.textContent;
    const modelDone = /^Restarted on Claude\. Waking them…$/.test(reducedText) && keep.hidden === true;   // #4963: no button while waking
    /* #4008 (Josh): the waiting line carries OUR loader, the Sweep dots (.spin.spin-sweep, eight <i>),
       decorative to a screen reader, and not the .kspin mark; Done stays plain until the wake finishes. */
    const wsp = msg.querySelector('.spin.spin-sweep');
    const wakeSpin = { sweep: !!wsp, dots: wsp ? wsp.querySelectorAll('i').length : 0, hidden: !!wsp && wsp.getAttribute('aria-hidden') === 'true',
      noKspin: !msg.querySelector('.kspin'), doneNotGoldYet: !keep.classList.contains('uprime') };
    // The success render detached the canvas (msg.textContent replaced the interstitial), so the
    // real loader's rAF loop bails on its next frame. It was connected during busy and is not now.
    const modelCanvasDetachedAfter = modelCanvasConnectedDuringBusy && !!modelCanvas && !modelCanvas.isConnected;
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
    await sleep(70); // interstitial up, before the 500ms hold elapses
    const providerBusy = {
      settingUp: /Setting up OpenAI/i.test(msg.innerHTML),
      hasOrb: !!document.querySelector(ORB_CV),
      orb: await orbTurning(),
      noPulsingIcon: !document.querySelector('#chg-msg .chg-restart .kspin') && !document.querySelector('#chg-msg canvas.chg-restart-k'),
      noReducedYet: !/Say hello|Waking them/i.test(msg.textContent),
    };
    await sleep(500); // past the 500ms hold
    const providerReducedText = msg.textContent;
    const providerDone = /^Restarted on OpenAI\. Waking them…$/.test(providerReducedText) && keep.hidden === true;   // #4963
    if (!back.hidden) keep.click();

    // 6. THE PROVIDER FLOW, ANTHROPIC ARM: the switch names ONE vocabulary end to end. CURRENT
    //    is now an OpenAI agent (runner 'codex'), so switching to Anthropic is a real change; the
    //    interstitial must say "Setting up Anthropic" and the reduced line "Restarted on
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
      hasOrb: !!document.querySelector(ORB_CV),
      orb: await orbTurning(),
      noPulsingIcon: !document.querySelector('#chg-msg .chg-restart .kspin') && !document.querySelector('#chg-msg canvas.chg-restart-k'),
      notClaudeSetup: !/Setting up Claude/i.test(msg.innerHTML),
    };
    await sleep(500);
    const providerAnthReducedText = msg.textContent;
    // The whole dialog speaks "Anthropic", never "Claude": consistent last-screen vocabulary.
    const providerAnthConsistent = /^Restarted on Anthropic\. Waking them…$/.test(providerAnthReducedText)
      && !/on Claude/i.test(providerAnthReducedText) && keep.hidden === true;   // #4963
    if (!back.hidden) keep.click();

    return { wakeSpin, holdFloor, cycleMs, kLoaderGone, modelCanvasDetachedAfter, busyShown, stillHeld, rendered, failFast, plainWorking, curAfterSet, modelBusy, reducedText, modelDone,
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
  check('#2692: the hold floor (RESTART_HOLD_MS) is at least one full loader cycle (K_LOADER_CYCLE_MS), unchanged by the orb (#7896)',
    r.holdFloor === 4400 && r.cycleMs === 4400 && r.holdFloor >= r.cycleMs, 'holdFloor=' + r.holdFloor + ' cycleMs=' + r.cycleMs);
  check('#7896: the K loader is gone from the page (startKLoader undefined); the orb replaced it everywhere',
    r.kLoaderGone === true, 'kLoaderGone=' + JSON.stringify(r.kLoaderGone));
  check('teardown (integration): the REAL interstitial orb canvas is connected during the busy hold and DETACHED after the success render, so KORB lets it go',
    r.modelCanvasDetachedAfter === true, 'modelCanvasDetachedAfter=' + JSON.stringify(r.modelCanvasDetachedAfter));
  check('MODEL: the change-model dialog shows the "Restarting the agent" interstitial with the KOSMOS orb (canvas.korb has ink and is turning), not plain "Working…"',
    r.modelBusy && r.modelBusy.restarting && r.modelBusy.hasOrb && r.modelBusy.orb.drawn && r.modelBusy.orb.moving && r.modelBusy.noReducedYet, JSON.stringify(r.modelBusy));
  check('#2692/#7896: the small pulsing .kspin mark and the K loader canvas are GONE from the restart interstitial',
    r.modelBusy && r.modelBusy.noPulsingIcon, JSON.stringify(r.modelBusy));
  check('MODEL: after the hold the dialog reduces to "Restarted on <provider>. Waking them..." (#2716: the app sends the hello), with no button while waking (#4963)',
    r.modelDone, JSON.stringify((r.reducedText || '').slice(0, 90)));
  check('#4008 MODEL: "Waking them..." carries the Sweep loader (eight dots, hidden from screen readers, not the .kspin mark), and Done is not gold yet',
    r.wakeSpin && r.wakeSpin.sweep && r.wakeSpin.dots === 8 && r.wakeSpin.hidden && r.wakeSpin.noKspin && r.wakeSpin.doneNotGoldYet, JSON.stringify(r.wakeSpin));
  check('PROVIDER: the provider switch shows the "Setting up OpenAI" interstitial with the orb (ink, turning; the K and .kspin gone), not plain "Working…"',
    r.providerBusy && r.providerBusy.settingUp && r.providerBusy.hasOrb && r.providerBusy.orb.drawn && r.providerBusy.orb.moving && r.providerBusy.noPulsingIcon && r.providerBusy.noReducedYet, JSON.stringify(r.providerBusy));
  check('PROVIDER: after the hold the provider dialog reduces to "Restarted on OpenAI. Waking them...", with no button while waking (#4963)',
    r.providerDone, JSON.stringify((r.providerReducedText || '').slice(0, 90)));
  check('PROVIDER (Anthropic arm): the orb interstitial says "Setting up Anthropic" (not "Setting up Claude"), orb drawn and turning, the K and .kspin gone',
    r.providerAnthBusy && r.providerAnthBusy.settingUp && r.providerAnthBusy.hasOrb && r.providerAnthBusy.orb.drawn && r.providerAnthBusy.orb.moving && r.providerAnthBusy.noPulsingIcon && r.providerAnthBusy.notClaudeSetup, JSON.stringify(r.providerAnthBusy));
  check('PROVIDER (Anthropic arm): the dialog speaks ONE vocabulary -- reduces to "Restarted on Anthropic", never "on Claude"',
    r.providerAnthConsistent, JSON.stringify((r.providerAnthReducedText || '').slice(0, 90)));

  await browser.close();
  if (problems.length) {
    console.error('render-model-restart-interstitial: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-model-restart-interstitial: the model switch ("Restarting the agent") and the provider switch ("Setting up OpenAI") both show the restart interstitial with the turning KOSMOS orb (#7896: canvas.korb drawn and moving, the K loader and the old pulsing .kspin gone), held on the max(2s, one-cycle) floor on success then reduced to "Restarted on <provider>. Waking them..." while the app sends the hello; a failure renders at once; the three remaining dialogs (account move, compact, clear) stay on plain "Working…".');
})();

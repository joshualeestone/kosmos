'use strict';
/**
 * kosmos#768-batch (Josh 0.6.47 notes, screenshot 5.51.59): switching an agent's model
 * shows a RESTART INTERSTITIAL -- the breathing Kosmos K over "Restarting the agent" --
 * held on screen while the agent restarts, then the confirm dialog reduces to the one
 * action left: "Say hello to <agent> to reactivate them on <provider>."
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
  // Source control: the prod hold FLOOR is 2s (#2463 demoted it from a fixed ~10s), and the
  // provider switch opts into the interstitial with its own "Setting up <provider>" line.
  const src = fs.readFileSync(PAGE, 'utf8');
  check('the prod restart hold floor is 2000ms (RESTART_HOLD_MS), not the old fixed 10000 and not accidentally shortened to 0',
    /const RESTART_HOLD_MS = 2000;/.test(src));
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
      hasKMark: !!document.querySelector('#chg-msg .chg-restart .kspin img'),
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
      hasKMark: !!document.querySelector('#chg-msg .chg-restart .kspin img'),
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
      hasKMark: !!document.querySelector('#chg-msg .chg-restart .kspin img'),
      notClaudeSetup: !/Setting up Claude/i.test(msg.innerHTML),
    };
    await sleep(400);
    const providerAnthReducedText = msg.textContent;
    // The whole dialog speaks "Anthropic", never "Claude": consistent last-screen vocabulary.
    const providerAnthConsistent = /Say hello to FCodex-Casey to reactivate them on Anthropic\./.test(providerAnthReducedText)
      && !/reactivate them on Claude/i.test(providerAnthReducedText) && keep.textContent === 'Done';
    if (!back.hidden) keep.click();

    return { busyShown, stillHeld, rendered, failFast, plainWorking, curAfterSet, modelBusy, reducedText, modelDone,
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
  check('MODEL: the change-model dialog shows the breathing-K "Restarting the agent" interstitial (not plain "Working…")',
    r.modelBusy && r.modelBusy.restarting && r.modelBusy.hasKMark && r.modelBusy.noReducedYet, JSON.stringify(r.modelBusy));
  check('MODEL: after the hold the dialog reduces to "Say hello to <agent> to reactivate them on <provider>"',
    r.modelDone, JSON.stringify((r.reducedText || '').slice(0, 90)));
  check('PROVIDER: the provider switch shows the breathing-K "Setting up OpenAI" interstitial (not plain "Working…")',
    r.providerBusy && r.providerBusy.settingUp && r.providerBusy.hasKMark && r.providerBusy.noReducedYet, JSON.stringify(r.providerBusy));
  check('PROVIDER: after the hold the provider dialog reduces to "Say hello to <agent> to reactivate them on OpenAI"',
    r.providerDone, JSON.stringify((r.providerReducedText || '').slice(0, 90)));
  check('PROVIDER (Anthropic arm): the interstitial says "Setting up Anthropic" (not "Setting up Claude")',
    r.providerAnthBusy && r.providerAnthBusy.settingUp && r.providerAnthBusy.hasKMark && r.providerAnthBusy.notClaudeSetup, JSON.stringify(r.providerAnthBusy));
  check('PROVIDER (Anthropic arm): the dialog speaks ONE vocabulary -- reduces to "reactivate them on Anthropic", never "on Claude"',
    r.providerAnthConsistent, JSON.stringify((r.providerAnthReducedText || '').slice(0, 90)));

  await browser.close();
  if (problems.length) {
    console.error('render-model-restart-interstitial: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-model-restart-interstitial: the model switch ("Restarting the agent") and the provider switch ("Setting up OpenAI") both show the breathing-K interstitial, held on the ~2s floor on success then reduced to "Say hello to <agent> to reactivate them on <provider>"; a failure renders at once; the three remaining dialogs (account move, compact, clear) stay on plain "Working…".');
})();

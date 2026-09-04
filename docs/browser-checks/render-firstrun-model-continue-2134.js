'use strict';

/**
 * kosmos#2134: the first-run wizard MODEL step (step 3) must offer Continue when
 * OpenAI is the connected model provider, not only when Claude is. Josh's live
 * OpenAI-only test hit a model step with no Continue button, only "Skip connecting
 * a model", because frPaintSubscription set Continue only in the Claude-connected
 * arm and frPaintOpenai never touched the action buttons.
 *
 * ⚠️ WHY A BROWSER. Drives the REAL frPaintOpenai against the real first-run markup
 * in web/index.html and reads the rendered #fr-next (Continue) / #fr-alt state, with
 * the real frActions/frGo in scope. Reds on origin/main, where frPaintOpenai does
 * not offer Continue and the OpenAI-only model step shows only Skip.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-model-continue-2134.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts rendered DOM.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-firstrun-model-continue-2134: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-firstrun-model-continue-2134: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof frPaintOpenai !== 'function') return { error: 'frPaintOpenai is not a function' };
    if (typeof FR === 'undefined') return { error: 'FR is not in scope' };
    const next = document.getElementById('fr-next');
    const alt = document.getElementById('fr-alt');
    if (!next || !alt) return { error: '#fr-next / #fr-alt missing' };
    const read = () => ({ nextHidden: !!next.hidden, nextText: next.textContent || '', altHidden: !!alt.hidden, altText: alt.textContent || '' });

    // OpenAI connected, Claude NOT: the model step should offer Continue. FR is
    // null before the wizard fetches first-run state, so seed the whole object
    // (Claude subscription unknown = not connected).
    FR = { subscription: { state: 'unknown', because: 'we have not been able to look' } };
    if (typeof frPaintSubscription === 'function') frPaintSubscription(); // sets Skip (the pre-fix state)
    await frPaintOpenai({ connected: true, keyTail: 'ab12', justAdded: true });
    const openaiOnly = read();

    return { openaiOnly };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    /* nextHidden and altHidden are the real discriminators: #fr-next's static
       markup label is already "Continue", so a nextText check reads "Continue"
       even while the button is hidden on origin/main -- it cannot red on its own,
       so it is not asserted. The button being SHOWN (not hidden) with Skip HIDDEN
       is what reds on main and passes here. */
    if (r.openaiOnly.nextHidden) problems.push('OpenAI connected (Claude not): the Continue button is HIDDEN -- an OpenAI-only user is stuck at the model step (#2134)');
    if (!r.openaiOnly.altHidden) problems.push('OpenAI connected: the "Skip connecting a model" alt is still shown alongside Continue (should be hidden)');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-firstrun-model-continue-2134: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-firstrun-model-continue-2134: a connected OpenAI account offers Continue on the model step (Skip hidden).');
})();

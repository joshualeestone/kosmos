'use strict';

/**
 * kosmos#2365 / retest #11 (Josh 0.6.40) + #2236 (Josh 0.6.42 re-test): the Choose-a-Model
 * screen's system-working loading lines must show Mona Lisa's "Sweep" loading spinner (the
 * dots-trail she designed and Josh chose 2026-09-05; installkosmos.com/design/loading-indicators,
 * variant D) -- rendered here as `<span class="spin spin-sweep"> x8 <i></i>`.
 *
 * WHY THIS CHECK WAS REWRITTEN (the bug it now catches): the first version asserted only that
 * *a* spinner (`.kspin`) was present. #11 shipped the wrong asset -- the `.kspin` Kosmos MARK
 * (a tiny Kosmos icon), not the loading dots -- and the check passed anyway, because "a spinner
 * exists" was true. Josh caught the wrong icon by eye on the 0.6.42 re-test. This version pins
 * the SPECIFIC component so that failure cannot recur: each system-working state must render a
 * `.spin.spin-sweep` with its eight `<i>` dots, and must NOT render a `.kspin` icon.
 *
 * Uses the page's own painter (frPaintConnect into #fr-sub) plus the OpenAI connect handler in
 * a real DOM:
 *  - the SYSTEM-working connect phases (downloading, installing, signin-launching,
 *    signin-completing) each render a `.spin.spin-sweep` (8 dots) and NO `.kspin`;
 *  - the OpenAI "Adding..." validate state renders a `.spin.spin-sweep` and NO `.kspin`;
 *  - the CONTROL that keeps this honest: 'signin-browser-open' is waiting on the PERSON to
 *    sign in in their browser, NOT the system working, so it must render NEITHER a spinner nor
 *    an icon.
 *
 * CONTROL for the whole feature: on a page whose loading states render the Kosmos icon (the
 * pre-fix #11 shape) or no spinner, the sweep+no-icon assertions red.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-model-spinners-2365.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-model-spinners-2365: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-model-spinners-2365: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    if (typeof frPaintConnect !== 'function') return { error: 'frPaintConnect is not a function' };
    const sub = document.getElementById('fr-sub');
    if (!sub) return { error: 'no #fr-sub connect box on the page' };
    // Read the component precisely: is Mona's Sweep spinner present, does it have its 8 dots,
    // and is the wrong-asset Kosmos icon (.kspin) present? The .kspin read is the negative
    // assertion that would have caught the original #11 defect.
    const probe = (el) => {
      const sweep = el.querySelector('.spin.spin-sweep');
      return {
        sweep: !!sweep,
        dots: sweep ? sweep.querySelectorAll('i').length : 0,
        icon: !!el.querySelector('.kspin'),   // the wrong asset (Kosmos mark) must be absent
      };
    };
    // frPaintConnect skips a repaint when the phase+because key is unchanged; give each call
    // a distinct `because` so nothing is skipped.
    let n = 0;
    const paint = (phase) => {
      n += 1;
      try { frPaintConnect({ phase, because: 'probe' + n, progress: { receivedBytes: 0, totalBytes: 230000000 }, url: '' }); }
      catch (e) { return { threw: String((e && e.message) || e) }; }
      const p = probe(sub);
      p.html = sub.innerHTML.slice(0, 140);
      return p;
    };
    const out = {
      downloading: paint('downloading'),
      installing: paint('installing'),
      signinLaunching: paint('signin-launching'),
      signinCompleting: paint('signin-completing'),
      signinBrowserOpen: paint('signin-browser-open'),   // control: waiting on the person
    };
    // OpenAI "Adding..." validate state: stub the POST as never-resolving, put a key in the
    // field, click, and read #fr-openai-msg while the validation is in flight.
    out.openaiAdding = null;
    try {
      const key = document.getElementById('fr-openai-key');
      const go = document.getElementById('fr-openai-go');
      const msg = document.getElementById('fr-openai-msg');
      if (key && go && msg) {
        const realFetch = window.fetch;
        window.fetch = (u) => (String(u).indexOf('/api/accounts/openai') !== -1)
          ? new Promise(() => {})   // never resolves: hold the "Adding..." state
          : realFetch(u);
        key.value = 'sk-test-probe';
        go.click();
        const p = probe(msg);
        p.text = (msg.textContent || '').trim();
        out.openaiAdding = p;
        window.fetch = realFetch;
      } else {
        out.openaiAdding = { error: 'openai field/button/msg missing' };
      }
    } catch (e) { out.openaiAdding = { threw: String((e && e.message) || e) }; }
    return out;
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  if (!r.error) {
    const want = [['downloading', r.downloading], ['installing', r.installing], ['signin-launching', r.signinLaunching], ['signin-completing', r.signinCompleting]];
    for (const [name, res] of want) {
      if (res.threw) { problems.push('phase ' + name + ' threw: ' + res.threw); continue; }
      if (!res.sweep) problems.push('phase ' + name + ' has no .spin.spin-sweep loading spinner (system-working wait): ' + res.html);
      else if (res.dots !== 8) problems.push('phase ' + name + ' spinner has ' + res.dots + ' dots, expected 8 (the Sweep component is eight <i>): ' + res.html);
      if (res.icon) problems.push('phase ' + name + ' renders the .kspin Kosmos ICON instead of the loading dots (the exact #11 wrong-asset defect): ' + res.html);
    }
    // Control: the user-action wait must render NEITHER a spinner nor an icon.
    if (r.signinBrowserOpen.threw) problems.push('phase signin-browser-open threw: ' + r.signinBrowserOpen.threw);
    else {
      if (r.signinBrowserOpen.sweep) problems.push('phase signin-browser-open should NOT have a spinner (it waits on the person to sign in, not the system): ' + r.signinBrowserOpen.html);
      if (r.signinBrowserOpen.icon) problems.push('phase signin-browser-open should NOT render the .kspin icon: ' + r.signinBrowserOpen.html);
    }
    // The OpenAI "Adding..." validate state.
    if (!r.openaiAdding) problems.push('the OpenAI Adding probe did not run');
    else if (r.openaiAdding.threw) problems.push('the OpenAI Adding probe threw: ' + r.openaiAdding.threw);
    else if (r.openaiAdding.error) problems.push('the OpenAI Adding probe could not run: ' + r.openaiAdding.error);
    else {
      if (!r.openaiAdding.sweep) problems.push('the OpenAI "Adding..." validate state (#fr-openai-msg) has no .spin.spin-sweep spinner: text="' + r.openaiAdding.text + '"');
      else if (r.openaiAdding.dots !== 8) problems.push('the OpenAI "Adding..." spinner has ' + r.openaiAdding.dots + ' dots, expected 8: text="' + r.openaiAdding.text + '"');
      if (r.openaiAdding.icon) problems.push('the OpenAI "Adding..." validate state renders the .kspin Kosmos ICON instead of the loading dots: text="' + r.openaiAdding.text + '"');
    }
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-model-spinners-2365: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-model-spinners-2365: the Choose-a-Model system-working waiting states (download/install/sign-in-completing + the OpenAI Adding validate) show Mona\'s .spin-sweep loading dots (8 dots, no Kosmos icon); the user-action wait (browser sign-in) correctly shows neither.');
})();

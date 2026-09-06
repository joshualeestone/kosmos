'use strict';

/**
 * kosmos#2365 / retest #11 (Josh 0.6.40): the existing inline .kspin spinner appears on the
 * Choose-a-Model screen's loading/waiting lines, so a person watching a connect step does not
 * see a still "Setting Claude up... A moment or two." with nothing moving.
 *
 * Uses the page's own painter (frPaintConnect into #fr-sub) plus the OpenAI connect handler
 * in a real DOM:
 *  - the SYSTEM-working connect phases (downloading, installing, signin-launching,
 *    signin-completing) each render a `.kspin` spinner;
 *  - the OpenAI "Adding..." validate state renders a `.kspin`;
 *  - the CONTROL that keeps this honest: 'signin-browser-open' is waiting on the PERSON to
 *    sign in in their browser, NOT the system working, so it must NOT get a spinner.
 *
 * CONTROL for the whole feature: on the pre-fix page none of these render a `.kspin`, so the
 * spinner assertions red.
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
    const hasSpinner = () => !!sub.querySelector('.kspin');
    // frPaintConnect skips a repaint when the phase+because key is unchanged; give each call
    // a distinct `because` so nothing is skipped.
    let n = 0;
    const paint = (phase) => {
      n += 1;
      try { frPaintConnect({ phase, because: 'probe' + n, progress: { receivedBytes: 0, totalBytes: 230000000 }, url: '' }); }
      catch (e) { return { threw: String((e && e.message) || e) }; }
      return { spinner: hasSpinner(), html: sub.innerHTML.slice(0, 120) };
    };
    const out = {
      downloading: paint('downloading'),
      installing: paint('installing'),
      signinLaunching: paint('signin-launching'),
      signinCompleting: paint('signin-completing'),
      signinBrowserOpen: paint('signin-browser-open'),   // control: waiting on the person, no spinner
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
        out.openaiAdding = { spinner: !!msg.querySelector('.kspin'), text: (msg.textContent || '').trim() };
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
      if (res.threw) problems.push('phase ' + name + ' threw: ' + res.threw);
      else if (!res.spinner) problems.push('phase ' + name + ' has no .kspin spinner (it is a system-working wait): ' + res.html);
    }
    // Control: the user-action wait must NOT get a spinner.
    if (r.signinBrowserOpen.threw) problems.push('phase signin-browser-open threw: ' + r.signinBrowserOpen.threw);
    else if (r.signinBrowserOpen.spinner) problems.push('phase signin-browser-open should NOT have a spinner (it waits on the person to sign in, not the system): ' + r.signinBrowserOpen.html);
    // The OpenAI "Adding..." validate state.
    if (!r.openaiAdding) problems.push('the OpenAI Adding probe did not run');
    else if (r.openaiAdding.threw) problems.push('the OpenAI Adding probe threw: ' + r.openaiAdding.threw);
    else if (r.openaiAdding.error) problems.push('the OpenAI Adding probe could not run: ' + r.openaiAdding.error);
    else if (!r.openaiAdding.spinner) problems.push('the OpenAI "Adding..." validate state (#fr-openai-msg) has no .kspin spinner: text="' + r.openaiAdding.text + '"');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-model-spinners-2365: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-model-spinners-2365: the Choose-a-Model system-working waiting states (download/install/sign-in-completing + the OpenAI Adding validate) show the .kspin spinner; the user-action wait (browser sign-in) correctly does not.');
})();

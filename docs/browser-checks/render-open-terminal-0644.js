'use strict';

/**
 * kosmos 0.6.44: the View-Agent Terminal tab carries an "Open Terminal" button that POSTs
 * to /api/agent/<name>/launch-terminal (Pete's route: attaches a Terminal.app window to the
 * agent's live tmux session so the person can watch it or answer a prompt -- read-only about
 * the agent, it only adds a viewer, it does NOT restart it). On 200 {ok:true} the window
 * opens on the person's machine; on a 400 refusal the route hands back `because` (agent not
 * running, or a HEADLESS board with no desktop -- expected, not a bug).
 *
 * This check drives the button's own handler in a real DOM against a STUBBED fetch, and
 * asserts:
 *  1. the button exists in the Terminal section (#d-sec-term #d-open-terminal);
 *  2. clicking it POSTs to /api/agent/<encoded name>/launch-terminal (method POST);
 *  3. a 200 {ok:true} shows the "opening" confirmation, not a blank;
 *  4. any non-200 {ok:false, because} shows the reason -- BOTH a 400 genuine refusal (agent
 *     not running) AND a 503 environment failure (headless board), since the handler must not
 *     special-case the status code (Pete's Contract-2 amendment);
 *  5. a network throw shows the friendly fallback, not a blank;
 *  6. the name is URL-encoded.
 *
 * CONTROL: on a page without the button arm 1 reds; the stub records the exact URL+method
 * so a wrong route/method would red arm 2.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-open-terminal-0644.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-open-terminal-0644: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-open-terminal-0644: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('file://' + PAGE);

  const run = async (sessionName, scenario) => {
    await page.evaluate(({ sessionName, scenario }) => {
      CURRENT = { sessionName, name: sessionName };
      const sec = document.getElementById('d-sec-term');
      if (sec) sec.hidden = false;
      const msg = document.getElementById('d-open-terminal-msg');
      if (msg) msg.textContent = '';
      window.__cap = null;
      const realFetch = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).indexOf('/launch-terminal') !== -1) {
          window.__cap = { url: String(url), method: (opts && opts.method) || 'GET' };
          if (scenario === 'throw') return Promise.reject(new Error('offline'));
          if (scenario === 'refused400') {
            // Genuine refusal (agent not running / unconfirmable) -> 400 {ok:false, because}.
            return Promise.resolve({ ok: false, status: 400,
              json: () => Promise.resolve({ ok: false, because: 'That agent is not running, so there is nothing to attach to.' }) });
          }
          if (scenario === 'env503') {
            // Environment failure (headless board / osascript / tmux) -> 503 {ok:false, because}
            // per Pete's Contract-2 amendment. The frontend must NOT special-case 400 vs 503.
            return Promise.resolve({ ok: false, status: 503,
              json: () => Promise.resolve({ ok: false, because: 'This board has no desktop, so there is no window to open here.' }) });
          }
          return Promise.resolve({ ok: true, status: 200,
            json: () => Promise.resolve({ ok: true, session: sessionName + '-discord' }) });
        }
        return realFetch(url, opts);
      };
    }, { sessionName, scenario });

    const present = await page.$('#d-open-terminal');
    if (!present) return { noButton: true };
    // Fire via the DOM: this checks the HANDLER wiring, not whether the detail-view ancestors
    // happen to be revealed, so a hidden ancestor must not gate it.
    await page.evaluate(() => document.getElementById('d-open-terminal').click());
    try {
      await page.waitForFunction(() => {
        const m = document.getElementById('d-open-terminal-msg');
        return m && m.textContent && m.textContent !== 'Opening the Terminal window…';
      }, { timeout: 4000 });
    } catch { /* fall through; read the (possibly interim) state below */ }
    return page.evaluate(() => ({
      cap: window.__cap,
      msg: (document.getElementById('d-open-terminal-msg') || {}).textContent || '',
    }));
  };

  const problems = [];

  const exists = await page.$('#d-open-terminal');
  if (!exists) problems.push('the #d-open-terminal button does not exist in the page');

  if (exists) {
    // Arms 2, 3, 6: success -> POST to the encoded route, confirmation shown.
    const ok = await run('a space name', 'success');
    if (ok.noButton) problems.push('the button vanished before the success click');
    else {
      if (!ok.cap) problems.push('success click did not call fetch on /launch-terminal');
      else {
        if (ok.cap.method !== 'POST') problems.push('launch-terminal used method ' + ok.cap.method + ', expected POST');
        if (ok.cap.url.indexOf('/api/agent/a%20space%20name/launch-terminal') === -1)
          problems.push('the route/name is not URL-encoded as expected: ' + ok.cap.url);
      }
      if (!/opening the terminal window/i.test(ok.msg)) problems.push('the 200 confirmation was not shown: ' + JSON.stringify(ok.msg));
    }

    // Arm 4a: a 400 genuine refusal (agent not running) shows its `because`.
    const refused = await run('test-agent', 'refused400');
    if (!/not running/i.test(refused.msg)) problems.push('the 400 refusal `because` was not shown: ' + JSON.stringify(refused.msg));

    // Arm 4b: a 503 environment failure (headless board) ALSO shows its `because` -- the
    // handler must NOT special-case the status code (Pete's Contract-2 amendment: env
    // failures are 503, genuine refusals are 400, both carry ok:false + because).
    const env = await run('test-agent', 'env503');
    if (!/no desktop/i.test(env.msg)) problems.push('the 503 environment-failure `because` was not shown (did the handler special-case the status?): ' + JSON.stringify(env.msg));

    // Arm 5: a network throw shows the friendly fallback.
    const threw = await run('test-agent', 'throw');
    if (!/could not be reached/i.test(threw.msg)) problems.push('a network failure did not show the fallback message: ' + JSON.stringify(threw.msg));
  }

  await browser.close();

  if (problems.length) {
    console.error('render-open-terminal-0644: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-open-terminal-0644: the Open Terminal button POSTs to the URL-encoded /launch-terminal route and shows the opening confirmation on success, the route\'s `because` on a refusal (incl. the headless-board case), and a friendly fallback on a network failure.');
})();

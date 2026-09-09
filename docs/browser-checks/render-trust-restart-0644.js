// Browser-check-surface: d-trust-restart d-trust-restart-msg d-qask-trust-restart d-qask-trust-restart-msg
'use strict';

/**
 * kosmos 0.6.44 (#5 insurance): the View-Agent Terminal tab carries a "Trust & Restart"
 * button that POSTs to /api/agent/<name>/trust-and-restart (Pete's route: writes the
 * folder-trust key then restarts, so an agent stuck at the terminal trust question can be
 * unblocked from the page). The route hands back a friendly `because` on 200 (restarted)
 * AND on a 400 refusal; a bad-name/500 has only `error`.
 *
 * This check drives the button's own handler in a real DOM against a STUBBED fetch, and
 * asserts:
 *  1. the button exists in the Terminal section (#d-sec-term #d-trust-restart);
 *  2. clicking it POSTs to /api/agent/<encoded name>/trust-and-restart (method POST);
 *  3. a 200 `{because}` is shown in #d-trust-restart-msg;
 *  4. a 400 refusal `{because}` is shown (the refusal reason reaches the user);
 *  5. a network throw shows the friendly fallback, not a blank;
 *  6. the name is URL-encoded (a name with a space POSTs to the encoded path).
 *  7. (#2129) the chat-box twin #d-qask-trust-restart (in the "Needs you" box, not
 *     only the Terminal tab) exists and POSTs the same URL-encoded route with the
 *     `because` shown. The RENDER gates its visibility on body.answerNote (the
 *     folder-trust state only); the static wiring + gate are pinned by
 *     web.qask-trust-restart-2129.test.js, and the live show-on-trust-state walk is
 *     owed to the dedicated claude-fe agent. Here we exercise the HANDLER by
 *     revealing the button directly, the same way `run` reveals d-sec-term.
 *
 * CONTROL: on a page without the button the querySelector is null, so arm 1 reds -- the
 * button is genuinely new. The stub records the exact URL+method, so a handler that hit
 * the wrong route or method would red arm 2.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-trust-restart-0644.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-trust-restart-0644: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-trust-restart-0644: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto('file://' + PAGE);

  // Drive one click of the button against a stubbed fetch, and read back what the handler
  // sent (url+method) and what it showed the user (the message). `scenario` decides the
  // stub's response so the same probe covers 200 / 400-refused / throw.
  const run = async (sessionName, scenario) => {
    await page.evaluate(({ sessionName, scenario }) => {
      // The button lives in the Terminal section; make CURRENT this agent and reveal it.
      CURRENT = { sessionName, name: sessionName };
      const sec = document.getElementById('d-sec-term');
      if (sec) sec.hidden = false;
      const msg = document.getElementById('d-trust-restart-msg');
      if (msg) msg.textContent = '';
      window.__cap = null;
      const realFetch = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).indexOf('/trust-and-restart') !== -1) {
          window.__cap = { url: String(url), method: (opts && opts.method) || 'GET' };
          if (scenario === 'throw') return Promise.reject(new Error('offline'));
          if (scenario === 'refused') {
            return Promise.resolve({ ok: false, status: 400,
              json: () => Promise.resolve({ outcome: 'refused', because: 'That agent is not running, so there is nothing to restart.', steps: [], trusted: { wrote: false } }) });
          }
          // success (200)
          return Promise.resolve({ ok: true, status: 200,
            json: () => Promise.resolve({ outcome: 'restarted', because: 'Trusted and restarting. It will look idle until you speak to it.', steps: [], trusted: { wrote: true, runner: 'claude', already: false } }) });
        }
        return realFetch(url, opts);
      };
    }, { sessionName, scenario });

    const present = await page.$('#d-trust-restart');
    if (!present) return { noButton: true };
    // Fire the click via the DOM rather than Playwright's visibility-gated click: this
    // check exercises the button's HANDLER wiring (route + method + message), not whether
    // the detail-view ancestors happen to be revealed, so a hidden ancestor must not gate it.
    await page.evaluate(() => document.getElementById('d-trust-restart').click());
    // The handler awaits the fetch, then writes the message; wait for it to settle past
    // the interim "Trusting and restarting…" text.
    try {
      await page.waitForFunction(() => {
        const m = document.getElementById('d-trust-restart-msg');
        return m && m.textContent && m.textContent !== 'Trusting and restarting…';
      }, { timeout: 4000 });
    } catch { /* fall through; the read below reports the (possibly interim) state */ }
    return page.evaluate(() => ({
      cap: window.__cap,
      msg: (document.getElementById('d-trust-restart-msg') || {}).textContent || '',
    }));
  };

  // #2129: the chat-box twin. Same shape as `run`, but the button lives in the
  // "Needs you" box (#d-qask); reveal it directly (as `run` reveals d-sec-term) to
  // exercise the HANDLER, since the render's show-on-answerNote gate is pinned
  // statically by web.qask-trust-restart-2129.test.js and walked headed elsewhere.
  const runQask = async (sessionName, scenario) => {
    await page.evaluate(({ sessionName, scenario }) => {
      CURRENT = { sessionName, name: sessionName };
      const b = document.getElementById('d-qask-trust-restart');
      if (b) b.hidden = false;
      const msg = document.getElementById('d-qask-trust-restart-msg');
      if (msg) msg.textContent = '';
      window.__cap = null;
      const realFetch = window.fetch;
      window.fetch = (url, opts) => {
        if (String(url).indexOf('/trust-and-restart') !== -1) {
          window.__cap = { url: String(url), method: (opts && opts.method) || 'GET' };
          if (scenario === 'throw') return Promise.reject(new Error('offline'));
          return Promise.resolve({ ok: true, status: 200,
            json: () => Promise.resolve({ outcome: 'restarted', because: 'Trusted and restarting. It will look idle until you speak to it.' }) });
        }
        return realFetch(url, opts);
      };
    }, { sessionName, scenario });
    const present = await page.$('#d-qask-trust-restart');
    if (!present) return { noButton: true };
    await page.evaluate(() => document.getElementById('d-qask-trust-restart').click());
    try {
      await page.waitForFunction(() => {
        const m = document.getElementById('d-qask-trust-restart-msg');
        return m && m.textContent && m.textContent !== 'Trusting and restarting…';
      }, { timeout: 4000 });
    } catch { /* fall through; the read below reports the (possibly interim) state */ }
    return page.evaluate(() => ({
      cap: window.__cap,
      msg: (document.getElementById('d-qask-trust-restart-msg') || {}).textContent || '',
    }));
  };

  const problems = [];

  // Arm 1: the button exists.
  const exists = await page.$('#d-trust-restart');
  if (!exists) problems.push('the #d-trust-restart button does not exist in the page');

  if (exists) {
    // Arms 2, 3, 6: success path — POST to the encoded route, `because` shown.
    const ok = await run('a space name', 'success');
    if (ok.noButton) problems.push('the button vanished before the success click');
    else {
      if (!ok.cap) problems.push('success click did not call fetch on /trust-and-restart');
      else {
        if (ok.cap.method !== 'POST') problems.push('trust-and-restart used method ' + ok.cap.method + ', expected POST');
        if (ok.cap.url.indexOf('/api/agent/a%20space%20name/trust-and-restart') === -1)
          problems.push('the route/name is not URL-encoded as expected: ' + ok.cap.url);
      }
      if (!/trusted and restarting/i.test(ok.msg)) problems.push('the 200 `because` was not shown: ' + JSON.stringify(ok.msg));
    }

    // Arm 4: a 400 refusal shows its `because`.
    const refused = await run('test-agent', 'refused');
    if (!/not running/i.test(refused.msg)) problems.push('the 400 refusal `because` was not shown: ' + JSON.stringify(refused.msg));

    // Arm 5: a network throw shows the friendly fallback, not a blank or the interim text.
    const threw = await run('test-agent', 'throw');
    if (!/could not reach kosmos/i.test(threw.msg)) problems.push('a network failure did not show the fallback message: ' + JSON.stringify(threw.msg));
  }

  // Arm 7 (#2129): the chat-box twin exists and POSTs the same URL-encoded route.
  const qexists = await page.$('#d-qask-trust-restart');
  if (!qexists) problems.push('the #d-qask-trust-restart chat-box button does not exist in the page');
  else {
    const qok = await runQask('a space name', 'success');
    if (qok.noButton) problems.push('the chat-box button vanished before the success click');
    else {
      if (!qok.cap) problems.push('chat-box success click did not call fetch on /trust-and-restart');
      else {
        if (qok.cap.method !== 'POST') problems.push('chat-box trust-and-restart used method ' + qok.cap.method + ', expected POST');
        if (qok.cap.url.indexOf('/api/agent/a%20space%20name/trust-and-restart') === -1)
          problems.push('the chat-box route/name is not URL-encoded as expected: ' + qok.cap.url);
      }
      if (!/trusted and restarting/i.test(qok.msg)) problems.push('the chat-box 200 `because` was not shown: ' + JSON.stringify(qok.msg));
    }
  }

  await browser.close();

  if (problems.length) {
    console.error('render-trust-restart-0644: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-trust-restart-0644: the Trust & Restart button (Terminal tab AND the #2129 chat-box twin) POSTs to the URL-encoded /trust-and-restart route and surfaces the route\'s `because` on success and on a refusal, with a friendly fallback on a network failure.');
})();

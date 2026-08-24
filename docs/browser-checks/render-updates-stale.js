'use strict';

/**
 * Settings > Updates, pressed on a page that is older than the Kosmos running
 * it (#691).
 *
 * Josh, 2026-08-24 16:50, screenshot: the build line read "version 0.5.22 ·
 * reload for 0.5.23" and the verdict beside it read "Up to date." Both halves
 * true, together a contradiction. This presses the REAL button on the REAL
 * card and reads the REAL line, in both states, on one board:
 *
 *   stale    the page's version meta set behind the served version
 *   current  the meta set TO the served version (the control: the verdict
 *            must still say "Up to date.", or the stale assert proves nothing)
 *
 * A source checkout bakes no version (the meta is the untouched marker), so the
 * page can never be stale on its own; the meta is set the way the toast check
 * sets it. The update host is unreachable on a sandboxed board, so the check
 * route's ANSWER is stubbed (reached, readable, nothing newer); the press, the
 * fetch, the paint and the poll that repaints the build line are the page's
 * own.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/us PORT=17372 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17372 node docs/browser-checks/render-updates-stale.js /tmp/usshots
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17372';
const OUT = process.argv[2] || '/tmp/usshots';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const served = (await (await b.newPage()).request.get(URL + '/api/status').then((r) => r.json())).version;
  chk(typeof served === 'string' && served.length > 0, 'the board reports a served version', String(served));

  for (const state of ['stale', 'current']) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route('**/api/update/check', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ running: served, latest: served, reached: true, readable: true, offer: null }),
    }));
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
    await pg.click('.tab[data-tab="settings"]');
    await pg.waitForSelector('#panel-settings:not([hidden])');
    await pg.click('#s-nav button[data-go="updates"]');
    await pg.waitForSelector('#s-sec-updates:not([hidden])');

    /* The page's version, set the way the toast check sets it. */
    const baked = state === 'stale' ? '0.0.1' : served;
    await pg.evaluate(([v]) => {
      document.querySelector('meta[name="kosmos-version"]').setAttribute('content', v);
    }, [baked]);
    /* The build line is painted by the poll (every five seconds); wait for the
       poll to see the new meta, so the line and the verdict are read from the
       same world. */
    await pg.waitForFunction(([s, v]) => {
      const t = (document.getElementById('build') || {}).textContent || '';
      return s === 'stale' ? /reload for/.test(t) : (t.indexOf(v) > -1 && !/reload for/.test(t));
    }, [state, served], { timeout: 12000 }).catch(() => {});
    const build = await pg.$eval('#build', (el) => el.textContent);
    chk(state === 'stale' ? /reload for/.test(build) : !/reload for/.test(build),
      state + ': the build line says ' + (state === 'stale' ? '"reload for"' : 'no reload'), build);

    /* At rest, before the press, the verdict has not been given. On a sandboxed
       board the update host is unreachable, so the resting line is the poll's
       own "Could not reach" (correct, and not this check's subject); what it
       must not be is either answer to the question nobody has asked yet. */
    const before = await pg.$eval('#upd-line', (el) => el.textContent);
    chk(!/Up to date|Reload this page/.test(before), state + ': at rest the verdict has not been given', JSON.stringify(before));
    await pg.click('#upd-btn');
    await pg.waitForFunction(() => !/Checking\.$/.test(document.getElementById('upd-line').textContent), null, { timeout: 12000 });
    const line = await pg.$eval('#upd-line', (el) => el.textContent);
    if (state === 'stale') {
      chk(line === served + ' is installed. Reload this page to use it.',
        'stale: the press says reload, not "Up to date"', JSON.stringify(line));
      chk(!/Up to date/.test(line), 'stale: "Up to date" is not on the card', JSON.stringify(line));
      const toast = await pg.$eval('#utoast-slot', (el) => el.innerText).catch(() => '');
      chk(/Kosmos updated/.test(toast) && /Reload/.test(toast), 'stale: the top-left toast offers the reload', JSON.stringify(toast));
    } else {
      chk(line === 'Up to date.', 'CONTROL current: the press still says "Up to date."', JSON.stringify(line));
    }
    const box = await pg.$('#s-sec-updates');
    if (box) await box.screenshot({ path: path.join(OUT, 'updates-' + state + '.png') });
    chk(errs.length === 0, state + ': no console errors', errs.join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();

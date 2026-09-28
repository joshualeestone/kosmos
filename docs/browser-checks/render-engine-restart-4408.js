'use strict';

/**
 * #4408 (an external tester on prod, 2026-09-28): a board running older code than is on disk (a loaded file whose CONTENT
 * changed; the tester's was an agent's edit). The toast says "Kosmos needs a quick restart", names the file and
 * says it changed on this computer, with no Terminal command, and a board that can restart itself
 * offers ONE Restart Kosmos button; pressing it POSTs /api/engine/restart and, once a board with a
 * new start time answers, reloads the page onto it.
 *
 * The stale state is not reachable against a healthy board (its code IS the code on disk), so it
 * is driven the way the page drives it: ENGINE_STALE set, then the renderer called. Both routes are
 * answered at the browser, so nothing here restarts the board this runs against.
 *
 *   AGENT_WORKFORCE_DATA=/tmp/er PORT=17372 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17372 node docs/browser-checks/render-engine-restart-4408.js /tmp/ershots
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17372';
const OUT = process.argv[2] || '/tmp/ershots';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    let posts = 0;
    let restarted = false;
    let can = false;
    /* /api/status is answered at the browser for the whole run: stale (with or without canRestart)
       until the restart is asked for, then a board with a NEW start time. The page draws the toast
       from its own poll, the real flow. */
    await page.route('**/api/status', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.engine = restarted
        ? { startedAt: '2026-09-28T16:00:00Z', staleSince: null, canRestart: false }
        : { startedAt: '2026-09-28T14:59:00Z', staleSince: '2026-09-28T15:10:00Z', changed: ['engine/roles.js'], canRestart: can };
      return route.fulfill({ response: res, body: JSON.stringify(body) });
    });
    let refuse = true;   // the first press is refused, the second accepted
    await page.route('**/api/engine/restart', (route) => {
      posts += 1;
      if (refuse) return route.fulfill({ status: 409, contentType: 'application/json', body: '{"ok":false,"because":"refused for this check"}' });
      restarted = true;
      return route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true,"restarting":true}' });
    });
    /* A fresh board opens on first run, whose window would sit over the toast: finish it through the
       board's own route first (a board that already finished answers the same). */
    await page.request.post(URL + '/api/first-run/complete').catch(() => {});
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#firstrun', { state: 'hidden', timeout: 5000 }).catch(() => {});
    const read = () => page.evaluate(() => {
      const slot = document.getElementById('utoast-slot');
      const t = slot && slot.querySelector('.utoast');
      return { text: t ? t.innerText : '', html: slot ? slot.innerHTML : '', button: !!(slot && slot.querySelector('#ut-engine-restart')) };
    });

    await page.waitForFunction(() => /Kosmos needs a quick restart/.test((document.getElementById('utoast-slot') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    const no = await read();
    chk(/Kosmos needs a quick restart/.test(no.text), 'the stale toast says Kosmos needs a quick restart', no.text);
    chk(!/kosmos restart|Terminal|changed on disk/i.test(no.text) && !/<code>/.test(no.html), 'no Terminal wording (#996)', no.text);
    chk(!no.button, 'CONTROL: a board that cannot restart itself shows no button');
    chk(/A Kosmos file was changed on this computer \(engine\/roles\.js\)/.test(no.text), 'it names the file that changed and says it changed here', no.text);

    can = true;
    await page.waitForSelector('#ut-engine-restart', { timeout: 20000 }).catch(() => {});
    const yes = await read();
    chk(yes.button, 'a board that can restart itself shows one Restart Kosmos button');
    chk(/Your agents keep running/.test(yes.text), 'it says the agents keep running', yes.text);
    await page.screenshot({ path: path.join(OUT, 'engine-restart.png'), clip: { x: 0, y: 0, width: 1280, height: 160 } }).catch(() => {});

    /* REFUSED: the toast says so in its title (read even when narrow), and the button comes back. */
    await page.click('#ut-engine-restart');
    await page.waitForFunction(() => /could not restart itself/.test(((document.querySelector('#utoast-slot b') || {}).textContent) || ''), null, { timeout: 5000 }).catch(() => {});
    const ref = await page.evaluate(() => ({ title: (document.querySelector('#utoast-slot b') || {}).textContent || '',
      small: (document.querySelector('#utoast-slot small') || {}).textContent || '',
      btn: (() => { const b = document.getElementById('ut-engine-restart'); return b ? { on: !b.disabled, t: b.textContent } : null; })() }));
    chk(ref.title === 'Kosmos could not restart itself', 'a refused restart says so in the title', ref.title);
    chk(!/restart your computer|Kosmos\.exe|sign out/i.test(ref.small), 'and promises no remedy it cannot keep', ref.small);
    chk(!!ref.btn && ref.btn.on && ref.btn.t === 'Restart Kosmos', 'and the button is back to press again', JSON.stringify(ref.btn));
    refuse = false;
    posts = 0;
    const nav = page.waitForNavigation({ timeout: 20000 }).then(() => true).catch(() => false);
    await page.click('#ut-engine-restart');
    const label = await page.evaluate(() => { const b = document.getElementById('ut-engine-restart'); return b ? b.textContent : 'gone'; }).catch(() => 'gone');
    chk(label === 'Restarting…' || label === 'gone', 'the button says Restarting while it waits', label);
    chk(await nav, 'the page reloads once a board with a new start time answers');
    chk(posts === 1, 'exactly one restart was asked for', String(posts));
    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\nrender-engine-restart-4408: ' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nrender-engine-restart-4408: all passed');
})().catch((e) => { console.error(e); process.exit(1); });

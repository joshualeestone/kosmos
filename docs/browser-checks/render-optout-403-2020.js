'use strict';

/*
 * #2020 / #2047: the two telemetry OPT-OUT switches are 403-SAFE, end to end.
 *
 * On an enforcing board every /api/* is gated (server.js), so a GET of the setting
 * returns 403 and the page never learns the value. A naive paint - and the original
 * removed code - draws the switch OFF in that case. For a TELEMETRY opt-out that is
 * the worst bug: a switch that falsely reads OFF tells a person "nothing is sent"
 * while the engine may be sending. This proves the switch instead shows COULD-NOT-READ
 * (hidden, no position, a message) on a gated read, never a false Off.
 *
 * TWO ARMS, and the 200 control is what makes the 403 arm mean something (an
 * assertion that only ever saw a readable board cannot fail on this):
 *   200 CONTROL  a readable board: both switches RENDER with a real position.
 *   403 ARM      /api/ping-setting + /api/notify-setting forced to 403 via page.route
 *                (an enforcing board's gate, without needing an enforcing board): both
 *                switches HIDDEN, no aria-checked, and a "could not read" message.
 *
 * Runs HEADLESS-safe (DOM-state assertions only). Needs a board it can reach; a plain
 * sandboxed board is fine (this check never writes, it only reads the setting and, in
 * the 403 arm, intercepts that read at the browser).
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-optout-403-2020.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
const IDS = ['tell-toggle', 'notify-toggle'];
const MSG = { 'tell-toggle': 'tell-msg', 'notify-toggle': 'notify-msg' };

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

// Open Settings -> Updates, where both switches live. Escape the first-run overlay
// (read-only view, so Escape clears it) rather than completing first run, so this
// check writes nothing.
async function openUpdates(pg) {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(800);
  await pg.click('.tab[data-tab="settings"]');
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="updates"]');
  await pg.waitForTimeout(300);
}

function readSwitch(pg, id) {
  return pg.evaluate(([id, msgId]) => {
    const e = document.getElementById(id);
    const m = document.getElementById(msgId);
    return { hidden: e ? e.hidden : 'no-element', checked: e ? e.getAttribute('aria-checked') : 'no-element', msg: (m && m.textContent) || '' };
  }, [id, MSG[id]]);
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // ── 200 CONTROL: a readable board renders both switches with a real position ──
    const p1 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await openUpdates(p1);
    for (const id of IDS) {
      const s = await readSwitch(p1, id);
      check(id + ' [200 control]: renders when the setting reads', s.hidden === false, JSON.stringify(s));
      check(id + ' [200 control]: carries a real position', s.checked === 'true' || s.checked === 'false', String(s.checked));
    }
    await p1.close();

    // ── 403 ARM: a gated read draws COULD-NOT-READ, never a false Off ─────────────
    const p2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    // Route set BEFORE navigation so the boot-time refreshTell/refreshNotify hit the 403.
    const gated = (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'this board belongs to the account that started it' }) });
    await p2.route('**/api/ping-setting', gated);
    await p2.route('**/api/notify-setting', gated);
    await openUpdates(p2);
    for (const id of IDS) {
      const s = await readSwitch(p2, id);
      check(id + ' [403 arm]: HIDDEN on a gated read (could-not-read, not a false Off)', s.hidden === true, JSON.stringify(s));
      check(id + ' [403 arm]: keeps NO position (a hidden switch must not carry aria-checked)', s.checked === null, String(s.checked));
      check(id + ' [403 arm]: says it could not read the setting', /could not read/i.test(s.msg), JSON.stringify(s.msg));
    }
    await p2.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-optout-403-2020: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
}

run().catch((e) => { console.error('FAIL  render-optout-403-2020 threw: ' + (e && e.message || e)); process.exit(1); });

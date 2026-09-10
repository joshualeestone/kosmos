'use strict';

/*
 * #2047: the privacy OPT-OUT switch is 403-SAFE, end to end.
 *
 * 🛑 #2623: the two telemetry opt-outs (tell-toggle / notify-toggle) were DELETED
 * (Josh, 2026-09-09, "invasion of privacy"). The SendFeedback opt-out
 * (feedback-toggle, #2037) is the remaining privacy switch and carries the same
 * 403-safe treatment, so this check now covers it alone.
 *
 * On an enforcing board every /api/* is gated (server.js), so a GET of the setting
 * returns 403 and the page never learns the value. A naive paint - and the original
 * removed code - draws the switch OFF in that case. For a privacy opt-out that is
 * the worst bug: a switch that falsely reads OFF tells a person "nothing is sent"
 * while the engine may be sending. This proves the switch instead shows COULD-NOT-READ
 * (hidden, no position, a message) on a gated read, never a false Off.
 *
 * TWO ARMS, and the 200 control is what makes the 403 arm mean something (an
 * assertion that only ever saw a readable board cannot fail on this):
 *   200 CONTROL  a readable board: the switch RENDERS with a real position.
 *   403 ARM      /api/feedback-setting forced to 403 via page.route (an enforcing
 *                board's gate, without needing an enforcing board): the switch
 *                HIDDEN, no aria-checked, and a "could not read" message.
 *
 * Runs HEADLESS-safe (DOM-state assertions only). Needs a board it can reach; a plain
 * sandboxed board is fine (this check never writes, it only reads the setting and, in
 * the 403 arm, intercepts that read at the browser).
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-optout-403-2020.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
// #2037 PR-C1: feedback-toggle (the daily-report send switch, in Settings >
// Automation) carries the SAME 200/403 privacy treatment as the tell/notify
// opt-outs, and defaults ON (Josh: "baked in day one"), so it reads ON in the
// 200 control below (see the DEFAULT_ON map). It is painted by the same
// boot-time refresh block, so it reads by id from any Settings view.
const IDS = ['feedback-toggle'];
const MSG = { 'feedback-toggle': 'feedback-msg' };
// The descriptive-copy row each switch lives in, for the copy-vs-default
// consistency check below (a default-ON switch must not say "Off by default").
const ROW = { 'feedback-toggle': 'feedback-row' };

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

// Open Settings. feedback-toggle lives in Automation but is painted on boot and
// read by id, so the Updates view reaches it just the same. Escape the first-run
// overlay (read-only view, so Escape clears it) rather than completing first run,
// so this check writes nothing.
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

// The row's DESCRIPTIVE copy (the `.dhint` inside the setrow, not the status
// `-msg` line), for the copy-vs-default consistency check.
function readRowCopy(pg, id) {
  return pg.evaluate((rowId) => {
    const row = document.getElementById(rowId);
    const d = row && row.querySelector('.dhint');
    return (d && d.textContent) || '';
  }, ROW[id]);
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // ── 200 CONTROL: a readable board renders both switches with a real position ──
    const p1 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await openUpdates(p1);
    // feedback-toggle (the daily report, #2037 "baked in day one") ships ON, so
    // it reads ON here. An independent, browser-level catch on a wrong default.
    const DEFAULT_ON = { 'feedback-toggle': true };
    for (const id of IDS) {
      const s = await readSwitch(p1, id);
      check(id + ' [200 control]: renders when the setting reads', s.hidden === false, JSON.stringify(s));
      const want = DEFAULT_ON[id] ? 'true' : 'false';
      check(id + ' [200 control]: reads its ruled default (' + want + ')', s.checked === want, String(s.checked));
      // A switch that DEFAULTS ON must not carry descriptive copy claiming it is
      // "Off by default" (a stale-copy bug: the default flipped ON but the wording
      // was not swapped). feedback-toggle defaults ON, so the check runs for it.
      if (DEFAULT_ON[id]) {
        const copy = await readRowCopy(p1, id);
        check(id + ' [200 control]: default-ON copy does not claim "Off by default"',
          !/off by default/i.test(copy), copy.slice(0, 90));
      }
    }
    await p1.close();

    // ── 403 ARM: a gated read draws COULD-NOT-READ, never a false Off ─────────────
    const p2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    // Route set BEFORE navigation so the boot-time refreshFeedback hits the 403.
    const gated = (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'this board belongs to the account that started it' }) });
    await p2.route('**/api/feedback-setting', gated);
    await openUpdates(p2);
    for (const id of IDS) {
      const s = await readSwitch(p2, id);
      check(id + ' [403 arm]: HIDDEN on a gated read (could-not-read, not a false Off)', s.hidden === true, JSON.stringify(s));
      check(id + ' [403 arm]: keeps NO position (a hidden switch must not carry aria-checked)', s.checked === null, String(s.checked));
      check(id + ' [403 arm]: says it could not confirm the setting', /could not/i.test(s.msg), JSON.stringify(s.msg));
    }
    await p2.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-optout-403-2020: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
}

run().catch((e) => { console.error('FAIL  render-optout-403-2020 threw: ' + (e && e.message || e)); process.exit(1); });

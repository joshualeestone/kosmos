'use strict';

/*
 * #2047: three more Settings switches are 403-SAFE, end to end.
 *
 * On an enforcing board every /api/* is gated (server.js), so a GET of a setting
 * returns 403 and the page never learns the value. A naive reader -- one that
 * `.json()`s the response unconditionally -- parses the 403's JSON error body as a
 * real setting and draws the switch OFF: a confident position nobody set. That is
 * exactly the auto-update bug Josh hit (auto-update showed OFF on a 403 board, which
 * told him his machine could not self-heal). This proves the three readers that were
 * NOT yet 403-safe -- auto-update, engineering-mode and run-limits -- instead show
 * COULD-NOT-READ (hidden, no position, a message) on a gated read.
 *
 * Sibling checks: render-optout-403-2020.js does this for the tell/notify opt-outs and
 * render-switch-states.js pins paintSwitch's on/off/hidden rendering. This extends the
 * same guarantee to the last three Settings switches routing through paintSwitch.
 *
 * TWO ARMS, and the 200 control is what makes the 403 arm mean something (an assertion
 * that only ever saw a readable board cannot fail on this):
 *   200 CONTROL  a readable board: each switch RENDERS with a real position.
 *   403 ARM      /api/autoupdate + /api/engmode + /api/limits forced to 403 via
 *                page.route (an enforcing board's gate, without needing one): each
 *                switch HIDDEN, no aria-checked, and a "could not read" message.
 *
 * Runs HEADLESS-safe (DOM-state assertions only). Needs a board it can reach; a plain
 * sandboxed board is fine (this check never writes -- it reads the settings and, in the
 * 403 arm, intercepts those reads at the browser).
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-settings-403-2047.js http://127.0.0.1:PORT
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:17461';

// id -> { tab: the Settings sub-nav data-go it lives under, msg: its message element,
//         route: the /api/* read that feeds its position }.
const SWITCHES = [
  { id: 'auto-toggle', tab: 'updates', msg: 'auto-msg', route: '**/api/autoupdate' },
  { id: 'eng-toggle', tab: 'advanced', msg: 'eng-msg', route: '**/api/engmode' },
  { id: 'lim-toggle', tab: 'automation', msg: 'lim-msg', route: '**/api/limits' },
];

const fails = [];
function check(name, pass, detail) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
  if (!pass) fails.push(name);
}

// Open Settings and a given sub-nav tab. Escape the first-run overlay (read-only view,
// so Escape clears it) rather than completing first run, so this check writes nothing.
async function openSettingsTab(pg, tab) {
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(600);
  await pg.click('.tab[data-tab="settings"]');
  await pg.waitForTimeout(400);
  await pg.click('#s-nav button[data-go="' + tab + '"]');
  await pg.waitForTimeout(300);
}

function readSwitch(pg, id, msgId) {
  return pg.evaluate(([id, msgId]) => {
    const e = document.getElementById(id);
    const m = document.getElementById(msgId);
    return { hidden: e ? e.hidden : 'no-element', checked: e ? e.getAttribute('aria-checked') : 'no-element', msg: (m && m.textContent) || '' };
  }, [id, msgId]);
}

async function run() {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // ── 200 CONTROL: a readable board renders each switch with a real position ─────
    const p1 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await p1.goto(BASE, { waitUntil: 'networkidle' });
    for (const sw of SWITCHES) {
      await openSettingsTab(p1, sw.tab);
      const s = await readSwitch(p1, sw.id, sw.msg);
      check(sw.id + ' [200 control]: renders when the setting reads', s.hidden === false, JSON.stringify(s));
      // A real ON/OFF position, not null/undefined: proves the 403 arm's "hidden, no
      // position" is a change from a definite state, not a switch that never paints.
      check(sw.id + ' [200 control]: carries a definite position', s.checked === 'true' || s.checked === 'false', String(s.checked));
    }
    await p1.close();

    // ── 403 ARM: a gated read draws COULD-NOT-READ, never a false Off ──────────────
    const p2 = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    // Routes set BEFORE navigation so the boot-time refreshAutoUpdate/refreshEngMode and
    // the settings-open paintLimits all hit the 403.
    const gated = (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'this board belongs to the account that started it' }) });
    for (const sw of SWITCHES) await p2.route(sw.route, gated);
    await p2.goto(BASE, { waitUntil: 'networkidle' });
    for (const sw of SWITCHES) {
      await openSettingsTab(p2, sw.tab);
      const s = await readSwitch(p2, sw.id, sw.msg);
      check(sw.id + ' [403 arm]: HIDDEN on a gated read (could-not-read, not a false Off)', s.hidden === true, JSON.stringify(s));
      check(sw.id + ' [403 arm]: keeps NO position (a hidden switch must not carry aria-checked)', s.checked === null, String(s.checked));
      check(sw.id + ' [403 arm]: says it could not read the setting', /could not/i.test(s.msg), JSON.stringify(s.msg));
    }
    await p2.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-settings-403-2047: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
}

run().catch((e) => { console.error('FAIL  render-settings-403-2047 threw: ' + (e && e.message || e)); process.exit(1); });

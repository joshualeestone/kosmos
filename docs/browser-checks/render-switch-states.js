'use strict';

/**
 * The four Settings switches, on a machine where their settings CAN be read.
 *
 * 🔑 THE RISK THIS COVERS IS THE OPPOSITE OF THE ONE THE UNIT TESTS COVER. Those
 * prove the control disappears when the answer is unknown; this proves it comes
 * BACK when the answer arrives. A paint that hides and never un-hides passes
 * every honesty assertion and leaves Settings with no controls at all (#229).
 *
 *   AGENT_WORKFORCE_DATA=/tmp/sw PORT=17461 node server.js &
 *   NODE_PATH="/Users/agent1/work/pw-runtime/node_modules" node docs/browser-checks/render-switch-states.js
 *
 * ⚠️ HEADED by default.  on a machine with no console session.
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17461';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const pg = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(1000);
  await pg.click('.tab[data-tab="settings"]');
  await pg.waitForTimeout(1200);
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  /* The switches live in three sections (automation, updates, advanced) and only
     one is on screen at a time, so each is measured from inside its own section or
     its rect reads zero. */
  /* 📌 tell-toggle and notify-toggle are BACK (#2020, Josh 2026-09-03: "on, and
     they can turn it off" needs the opt-out controls he removed 08-26). They are in
     the updates section beside auto-toggle, and this "renders once read" check
     covers them on a readable board; the COULD-NOT-READ (403) arm they matter for
     is render-optout-403-2020.js. */
  /* #2054: lim-toggle moved into 'automation' (the Agents Talking tab was deleted),
     and ah-toggle/hb-toggle (Auto-save/Prompter, now sliders) joined it there -- so
     the "renders once read" invariant now covers all three automation switches. */
  const WHERE = { 'lim-toggle': 'automation', 'ah-toggle': 'automation', 'hb-toggle': 'automation', 'tell-toggle': 'updates', 'notify-toggle': 'updates', 'auto-toggle': 'updates', 'eng-toggle': 'advanced' };
  const seen = [];
  for (const id of Object.keys(WHERE)) {
    await pg.click('#s-nav button[data-go="' + WHERE[id] + '"]');
    await pg.waitForTimeout(150);
    seen.push(await pg.evaluate((id) => {
      const e = document.getElementById(id);
      const r = e.getBoundingClientRect();
      return { id, hidden: e.hidden, checked: e.getAttribute('aria-checked'), w: Math.round(r.width), h: Math.round(r.height) };
    }, id));
  }
  for (const s of seen) {
    say(s.hidden === false, s.id + ': is on screen once its setting is read', JSON.stringify(s));
    say(s.checked === 'true' || s.checked === 'false', s.id + ': carries a real position', String(s.checked));
    say(s.w > 20 && s.h > 10, s.id + ': has real size', s.w + 'x' + s.h);
  }
  await pg.screenshot({ path: '/tmp/swshots/settings-switches.png', clip: { x: 0, y: 60, width: 1500, height: 520 } });
  await pg.close();
  await b.close();
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();

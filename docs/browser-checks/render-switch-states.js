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
  /* Since settings-nav the five switches are in three sections (talking,
     updates, advanced) and only one is on screen at a time, so each is
     measured from inside its own section or its rect reads zero. */
  /* 📌 tell-toggle and notify-toggle went with the telemetry rows Josh
     removed on 2026-08-26 (item 3). Naming a switch that is not on the
     page made this check red on a product doing exactly what he asked. */
  const WHERE = { 'lim-toggle': 'talking', 'auto-toggle': 'updates', 'eng-toggle': 'advanced' };
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

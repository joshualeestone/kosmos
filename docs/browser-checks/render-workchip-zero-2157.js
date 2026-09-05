'use strict';

/**
 * #2157: the Agents-tab "Working" tile (the count chip AND its .act animation)
 * must NOT render at a KNOWN zero -- Josh: "if no agents are working, we don't
 * show the little tab thing at the top that says the number of agents working",
 * because an animated "0 Working" looks like something is running when nothing
 * is. It stays shown when the zero is a FLOOR (unknowns present -> "0+") or on a
 * failed poll ("?"), because hiding there would claim "none working" on a read
 * that cannot stand behind it (the honest-rendering rule this file's alert tile
 * and #2023 already follow).
 *
 * 🔑 WHY A BROWSER, not only the extracted-slice unit test in server.test.js.
 * Two things a fake-element unit test cannot see and that ARE the point here:
 *   1. the id `#st-working-tile` is on the RIGHT element -- the .stat wrapper
 *      that contains BOTH the .act animation and the #st-working count -- so
 *      hiding it hides the ANIMATION, which is the exact thing Josh saw moving
 *      at zero. A unit test that mocks getElementById passes even if the id sits
 *      on the wrong node or the animation lives outside the wrapper.
 *   2. `hidden` on that wrapper ACTUALLY removes the animation from layout in a
 *      real browser (CSS `[hidden]`), not just sets a property.
 * This drives the page's OWN tick() over file:// (hermetic -- no server; fetch
 * is stubbed with a fixture /api/status), so a change to what tick() computes for
 * the tile cannot pass here while breaking on screen.
 *
 * Reds against the pre-#2157 page: the tile has no id there, so getElementById
 * returns null and every arm reports the tile/animation could not be found.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-workchip-zero-2157.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-workchip-zero-2157: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('file://' + PAGE);

    // Drive the page's OWN tick() with a stubbed /api/status. Each case reports
    // the real tile's `hidden`, the count text, and whether the .act animation
    // is actually laid out (offsetParent !== null AND a non-zero client rect --
    // the two ways `[hidden]` on an ancestor removes it from the page).
    const seen = await page.evaluate(async () => {
      const tileEl = document.getElementById('st-working-tile');
      if (!tileEl || typeof tick !== 'function') {
        return { missing: true, hasTile: !!tileEl, hasTick: typeof tick === 'function' };
      }
      const act = tileEl.querySelector('.act');
      const countEl = tileEl.querySelector('#st-working');
      const wrapsAnim = !!act;
      const wrapsCount = !!countEl;
      const animLaidOut = () => {
        if (!act) return false;
        const r = act.getBoundingClientRect();
        return act.offsetParent !== null && r.width > 0 && r.height > 0;
      };
      const okFetch = (agents, counts) => {
        window.fetch = async () => ({ ok: true, json: async () => ({
          agents: agents.map((s, i) => ({ state: s, sessionName: 'a' + i, name: 'a' + i })),
          counts,
        }) });
      };
      const out = { wrapsAnim, wrapsCount };

      // 1) nonzero working -> shown, animation laid out.
      okFetch(['working', 'idle'], { total: 2, unreadableLines: 0 });
      await tick();
      out.nonzero = { hidden: tileEl.hidden, count: countEl.textContent, anim: animLaidOut() };

      // 2) KNOWN zero (no unknowns, no unreadable lines) -> hidden, animation gone.
      okFetch(['idle', 'idle'], { total: 2, unreadableLines: 0 });
      await tick();
      out.knownZero = { hidden: tileEl.hidden, count: countEl.textContent, anim: animLaidOut() };

      // 3) zero working WITH an unknown -> a FLOOR, stays shown, renders "0+".
      okFetch(['idle', 'unknown'], { total: 2, unreadableLines: 0 });
      await tick();
      out.floorZero = { hidden: tileEl.hidden, count: countEl.textContent, anim: animLaidOut() };

      // 4) failed poll -> the tile (left hidden by case 2/known-zero above if it
      //    persisted) must come BACK showing "?", never stay hidden claiming none
      //    work on the one poll that knows nothing. Re-hide first so the arm is a
      //    real transition, then fail the fetch.
      okFetch(['idle', 'idle'], { total: 2, unreadableLines: 0 });
      await tick(); // tile hidden again
      const hiddenBeforeFail = tileEl.hidden;
      window.fetch = async () => { throw new Error('simulated poll failure'); };
      await tick();
      out.failedPoll = { hiddenBeforeFail, hidden: tileEl.hidden, count: countEl.textContent };

      return out;
    });

    if (seen.missing) {
      check(`${engine}: #st-working-tile exists and tick() is reachable`, false,
        `hasTile=${seen.hasTile} hasTick=${seen.hasTick} (pre-#2157 page has no tile id)`);
      await browser.close();
      continue;
    }

    check(`${engine}: the tile wraps BOTH the .act animation and the #st-working count`,
      seen.wrapsAnim && seen.wrapsCount,
      `wrapsAnim=${seen.wrapsAnim} wrapsCount=${seen.wrapsCount}`);

    check(`${engine}: nonzero working -> tile shown and the animation is laid out`,
      seen.nonzero.hidden === false && seen.nonzero.anim === true,
      `hidden=${seen.nonzero.hidden} count=${JSON.stringify(seen.nonzero.count)} anim=${seen.nonzero.anim}`);

    check(`${engine}: KNOWN zero -> tile hidden AND the animation is removed from layout (Josh's ask)`,
      seen.knownZero.hidden === true && seen.knownZero.anim === false,
      `hidden=${seen.knownZero.hidden} count=${JSON.stringify(seen.knownZero.count)} anim=${seen.knownZero.anim}`);

    check(`${engine}: a FLOORED zero (unknown present) stays shown and renders "0+", not hidden`,
      seen.floorZero.hidden === false && seen.floorZero.count === '0+' && seen.floorZero.anim === true,
      `hidden=${seen.floorZero.hidden} count=${JSON.stringify(seen.floorZero.count)} anim=${seen.floorZero.anim}`);

    check(`${engine}: a failed poll brings the tile BACK showing "?" (was hidden), never leaves it hidden`,
      seen.failedPoll.hiddenBeforeFail === true && seen.failedPoll.hidden === false && seen.failedPoll.count === '?',
      `hiddenBeforeFail=${seen.failedPoll.hiddenBeforeFail} hidden=${seen.failedPoll.hidden} count=${JSON.stringify(seen.failedPoll.count)}`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

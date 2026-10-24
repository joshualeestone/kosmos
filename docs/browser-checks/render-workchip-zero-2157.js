'use strict';

/**
 * #2157: the Agents-tab "Working" tile (the count chip AND its .act animation)
 * must NOT render at zero ("0+" included since #4736) -- Josh: "if no agents are working, we don't
 * show the little tab thing at the top that says the number of agents working",
 * because an animated "0 Working" looks like something is running when nothing
 * is. Since #4736 (Josh, 2026-09-30) that includes a FLOORED zero (unknowns present -> "0+"):
 * "if there are 0 working, lets not show the tile". Since #6721 one missed poll keeps the board as it
 * was (the header says Reconnecting); the second missed poll in a row is the board not answering, and
 * then the count is "?", not a zero, and the tile is shown.
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

      // 3) zero working WITH an unknown -> a FLOOR: renders "0+" and the tile hides (#4736).
      okFetch(['idle', 'unknown'], { total: 2, unreadableLines: 0 });
      await tick();
      out.floorZero = { hidden: tileEl.hidden, count: countEl.textContent, anim: animLaidOut() };

      // 4) failed polls. Since kosmos#6721 one missed poll keeps the board as it was (the header says Reconnecting);
      //    the second in a row is the board not answering, and then the tile (hidden by the known zero above) must
      //    come BACK showing "?", never stay hidden claiming none work when nothing is known. Re-hide first so the
      //    arm is a real transition, then fail the fetch twice.
      okFetch(['idle', 'idle'], { total: 2, unreadableLines: 0 });
      await tick(); // tile hidden again
      const hiddenBeforeFail = tileEl.hidden;
      window.fetch = async () => { throw new Error('simulated poll failure'); };
      await tick();
      // The first miss counts only after a poll has answered (cases 1 to 3 above), so keep those first.
      // misses: the page's own count. The arm requires 1, so a race with the page's 5 s poll fails with misses=2 in
      // its detail, which names the cause.
      const afterOneMiss = { hidden: tileEl.hidden, count: countEl.textContent,
        reconnecting: (document.getElementById('hdr-reconnect') || {}).textContent,
        misses: typeof BOARD_MISSES === 'number' ? BOARD_MISSES : null };
      await tick();
      out.failedPoll = { hiddenBeforeFail, afterOneMiss, hidden: tileEl.hidden, count: countEl.textContent,
        reconnecting: (document.getElementById('hdr-reconnect') || {}).textContent };

      /* #6649 (Josh, 2026-10-19): no Idle or Waiting tile, on a fleet that has idle and blocked agents. Read by the
         row's labels, not by id, because the ids are gone (CONTROL: the Working label is still there). */
      okFetch(['working', 'blocked', 'blocked', 'idle'], { total: 4, unreadableLines: 0 });
      await tick();
      out.labels = [...document.querySelectorAll('.stat .slab')].map((e) => e.textContent.trim());
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

    /* #4736 (Josh, 2026-09-30 10:05: "if there are 0 working, lets not show the tile"): a FLOORED zero
       ("0+") hides the tile too now. The number underneath is still "0+". */
    check(`${engine}: a FLOORED zero (unknown present, "0+") hides the tile and its animation too (#4736)`,
      seen.floorZero.hidden === true && seen.floorZero.count === '0+' && seen.floorZero.anim === false,
      `hidden=${seen.floorZero.hidden} count=${JSON.stringify(seen.floorZero.count)} anim=${seen.floorZero.anim}`);

    // kosmos#6721: one missed poll keeps the board as it was, so the hidden zero tile stays hidden. The two arms are a
    // pair: this one passes for a tile that never moves, and only the arm below shows the tile does move.
    check(`${engine}: one missed poll keeps the tile as it was and the header says Reconnecting (#6721)`,
      seen.failedPoll.hiddenBeforeFail === true && seen.failedPoll.afterOneMiss.hidden === true
        && seen.failedPoll.afterOneMiss.count === '0' && seen.failedPoll.afterOneMiss.reconnecting === 'Reconnecting\u2026'
        && seen.failedPoll.afterOneMiss.misses === 1,
      `afterOneMiss=${JSON.stringify(seen.failedPoll.afterOneMiss)}`);
    check(`${engine}: a second missed poll brings the tile BACK showing "?" (was hidden) and clears Reconnecting`,
      seen.failedPoll.hiddenBeforeFail === true && seen.failedPoll.hidden === false && seen.failedPoll.count === '?'
        && seen.failedPoll.reconnecting === '',
      `hiddenBeforeFail=${seen.failedPoll.hiddenBeforeFail} hidden=${seen.failedPoll.hidden} count=${JSON.stringify(seen.failedPoll.count)} reconnecting=${JSON.stringify(seen.failedPoll.reconnecting)}`);

    check(`${engine}: #6649 the stats row has no Idle or Waiting tile (CONTROL: Working is there)`,
      seen.labels.includes('Working') && !seen.labels.includes('Idle') && !seen.labels.includes('Waiting'), JSON.stringify(seen.labels));

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

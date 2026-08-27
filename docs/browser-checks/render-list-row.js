'use strict';

/**
 * The not-running row in the LIST layout, measured against its neighbour.
 *
 * 🛑 IT SHIPPED IN THE WRONG COLUMNS. `.lrow` is a five-column grid and the
 * not-running row supplied four children, so every cell moved one column
 * right and the agent's ROLE landed in the STATE column: scanning that column
 * down a list read "Idle / Legal / Idle". Wrong in the way that reads as
 * information rather than as a glitch (Mona Lisa, rendered rather than
 * reasoned).
 *
 * 🔑 SO THE CLAIM IS A COMPARISON, cell by cell, against a running row in the
 * same list. A check that only read this row would pass on any geometry.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17431 node docs/browser-checks/render-list-row.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */
const { chromium } = require('playwright');
(async () => {
  const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17431';
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const fails = [];
  const pg = await b.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
  await pg.goto(URL, { waitUntil: 'networkidle' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.waitForTimeout(1200);
  /* The toggle lives in the board bar, which is hidden until the first poll
     lands; clicking it before then times out on an invisible element. */
  await pg.waitForSelector('[data-scope="agents"] .vt[data-layout="list"]', { state: 'visible', timeout: 15000 });
  await pg.click('[data-scope="agents"] .vt[data-layout="list"]');
  await pg.waitForTimeout(900);
  const seen = await pg.evaluate(() => {
    const cell = (row, sel) => { const e = row.querySelector(sel); const r = e && e.getBoundingClientRect(); return r ? { left: Math.round(r.left), width: Math.round(r.width) } : null; };
    const off = document.querySelector('.lrow.notrunning');
    const on = document.querySelector('.lrow:not(.notrunning)');
    return {
      offState: off && cell(off, '.lstate'), onState: on && cell(on, '.lstate'),
      offName: off && cell(off, '.lname'), onName: on && cell(on, '.lname'),
      offKids: off ? [...off.children].map((c) => c.className.split(' ')[0]) : [],
      /* The neighbour's cells, so the count below is a COMPARISON rather than
         a number somebody typed. */
      onKids: on ? [...on.children].map((c) => c.className.split(' ')[0]) : [],
      stateText: off ? off.querySelector('.lstate').innerText.trim() : '',
      taskText: off ? off.querySelector('.ltask').innerText.trim() : 'NO CELL',
      /* #986 emptied this cell for a running agent whose only status was its
         own reported sentence: the quote WAS the content. What follows the
         cell is what proves the row survived it. */
      onTaskCell: on ? !!on.querySelector('.ltask') : false,
      onTaskText: on ? on.querySelector('.ltask').innerText.trim() : 'NO CELL',
      offModel: off && cell(off, '.lmodel'), onModel: on && cell(on, '.lmodel'),
      offMem: off && cell(off, '.lmem'), onMem: on && cell(on, '.lmem'),
    };
  });
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  /* 🛑 THIS SAID `=== 5` AND THE GRID NOW HAS SEVEN COLUMNS (lmodel and lmem
     were added after it was written), so it failed on a row that is perfectly
     correct. Nobody saw it, because nothing runs this file.
     ⭐ AND THE HARDCODED NUMBER IS THE EXACT THING THIS FILE'S OWN HEADER WARNS
     AGAINST: "the claim is a COMPARISON, cell by cell, against a running row in
     the same list. A check that only read this row would pass on any geometry."
     The count arm read one row against a constant, which is the same mistake in
     the other direction — it FAILS on any geometry the author did not foresee.
     ⇒ Compared against the neighbour instead. That is immune to columns being
     added, and it still catches #278 exactly: a not-running row that supplies
     fewer cells than its neighbour shifts every later cell one column right,
     which is how the agent's ROLE landed in the STATE column. */
  say(seen.onKids.length > 0 && JSON.stringify(seen.offKids) === JSON.stringify(seen.onKids),
    'the same cells, in the same order, as a running row',
    seen.offKids.join(',') + '  vs  ' + seen.onKids.join(','));
  say(seen.offState && seen.onState && seen.offState.left === seen.onState.left, 'the state column lines up', JSON.stringify([seen.offState, seen.onState]));
  say(seen.offName && seen.onName && seen.offName.left === seen.onName.left, 'the name column lines up', JSON.stringify([seen.offName, seen.onName]));
  say(seen.stateText === 'Not running', 'the state cell says the state', JSON.stringify(seen.stateText));
  say(seen.taskText === '', 'the task cell is empty', JSON.stringify(seen.taskText));
  /* 🛑 THE CELL #986 EMPTIED MUST STILL HOLD ITS COLUMN. The quoted sentence was
     the only content a running agent's task cell had, so removing it left a cell
     that is routinely empty on a five-plus column grid -- and an empty cell that
     collapses moves every column after it, which is #278 all over again in the
     row that was supposed to be fine.
     🔑 THE CLAIM IS GEOMETRY, NOT TEXT, DELIBERATELY. What the cell SAYS is
     already pinned at the unit level (web.quoted-line-986.test.js calls
     stateReason at both real render sites and asserts a reported sentence goes
     silent while a usage limit and a broken sign-in still speak). Asserting the
     text again here would need a rate-limited agent on the board, and the agent
     COUNT is load-bearing -- org-chart passes in a band and a sixth agent takes
     it red. So the unit test owns the meaning and this owns the appearance.
     ⚠️ NOT YET PROVEN TO FAIL. Written during the 2026-08-27 demo freeze, when
     browser checks were not allowed to run. Before trusting a green here, break
     it on purpose: give `.ltask` `display:none` in the rendered page and confirm
     these two lines go red. A check whose failing direction has never been seen
     is a claim, not an instrument. */
  say(seen.onTaskCell, 'the running row still HAS a task cell', JSON.stringify(seen.onTaskText));
  say(seen.offModel && seen.onModel && seen.offModel.left === seen.onModel.left,
    'the model column lines up, so an empty task cell did not collapse',
    JSON.stringify([seen.offModel, seen.onModel]));
  say(seen.offMem && seen.onMem && seen.offMem.left === seen.onMem.left,
    'the memory column lines up, so nothing after the task cell shifted',
    JSON.stringify([seen.offMem, seen.onMem]));
  const el = await pg.$('.lrow.notrunning');
  let bx = await el.boundingBox();
  /* Scroll it into view first: the clip is in PAGE coordinates and a row below
     the fold produces an empty rectangle rather than a picture. */
  await pg.evaluate((y) => window.scrollTo(0, Math.max(0, y - 200)), bx.y);
  await pg.waitForTimeout(300);
  bx = await (await pg.$('.lrow.notrunning')).boundingBox();
  await pg.screenshot({ path: '/tmp/nrshots/lrow.png', clip: { x: Math.max(0, bx.x - 20), y: Math.max(0, bx.y - 90), width: Math.min(1360, bx.width + 40), height: bx.height + 180 } });
  await pg.close();
  await b.close();
  console.log(fails.length ? 'FAILED' : 'all good');
  process.exit(fails.length ? 1 : 0);
})();

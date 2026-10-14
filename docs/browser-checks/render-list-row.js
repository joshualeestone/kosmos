'use strict';

/**
 * The not-running row in the LIST layout, measured against its neighbour.
 * And (#6053) every row at phone width: the model whole and on its own line.
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
     ⚠️ AND MOST OF WHAT IT ASSERTS IS ALREADY GUARANTEED BY CONSTRUCTION, WHICH
     IS WORTH KNOWING BEFORE ANYONE TRUSTS A GREEN. `.lrow` declares seven
     explicit tracks, every one of them fixed or `minmax(...)` with a floor, so
     an empty cell CANNOT collapse its track at this width no matter what it
     contains. These lines therefore guard the TEMPLATE, not the content: they
     go red if somebody changes a track to `auto`, and they cannot go red from
     the emptying itself.
     🛑 SO THE CASE #986 ACTUALLY CHANGED IS NOT COVERED HERE, AND SAYING SO IS
     the point of this paragraph. Under 56rem `.lrow` collapses to `34px 1fr`
     and the cells after the name stack in column 2 as separate rows (a not-running
     row's empty `.lmodel` excepted, which takes none). An
     empty `.ltask` there is an empty ROW, and `row-gap: 8px` is still spent on
     it. The 1400x900 arm will never see that, and the phone arm below reads
     the model and memory cells, not the empty task row. It has been true
     of the not-running row since before #986 and nobody has reported it, which
     is a reason to keep it in proportion, not a reason to leave it unwritten.
     ⚠️ NOT YET PROVEN TO FAIL. Written during the 2026-08-27 demo freeze, when
     browser checks were not allowed to run. Before trusting a green here, break
     it on purpose: change a track to `auto` in the rendered page and confirm
     these lines go red. A check whose failing direction has never been seen is
     a claim, not an instrument. */
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
  /* #6053: AT PHONE WIDTH THE MODEL WAS CUT TO "Cla...". Under 56rem the row
     is `34px 1fr` and .lmodel was not sent to column 2, so it auto-placed into
     the avatar's 34px column beside the memory bar. Every model, whatever its
     name, read as three letters and an ellipsis.
     🔑 Per running row: the role starts where the name starts, below it (it
     too was in the avatar column); the model's text is present and its cell is
     at least 150px wide (the cut cell was 34 to 49px; column 2 at 360 is about
     230px; the model wraps at this width, so an overflow test would pass in any
     column), it starts where the name starts and sits below the name, and the
     memory bar starts there too, on a line below the model. Per not-running row (which has no model): the
     empty model cell takes no line. And the page has no sideways scroll. Read
     at 390 and 360, the two widths the card names. At least one row of each
     kind is required, so neither loop can pass by having nothing to measure. */
  for (const width of [390, 360]) {
    const ph = await b.newPage({ viewport: { width, height: 844 }, colorScheme: 'light' });
    await ph.goto(URL, { waitUntil: 'networkidle' });
    if (!(await ph.$('#firstrun[hidden]'))) { await ph.keyboard.press('Escape'); await ph.waitForTimeout(400); }
    await ph.waitForSelector('[data-scope="agents"] .vt[data-layout="list"]', { state: 'visible', timeout: 15000 });
    await ph.click('[data-scope="agents"] .vt[data-layout="list"]');
    await ph.waitForSelector('#alist .lrow', { state: 'visible', timeout: 15000 });
    await ph.waitForTimeout(600);
    const rows = await ph.evaluate(() => [...document.querySelectorAll('#alist .lrow')].map((row) => {
      const box = (sel) => { const e = row.querySelector(sel); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; };
      const m = row.querySelector('.lmodel');
      return { agent: row.dataset.agent, running: !row.classList.contains('notrunning'),
        text: m ? m.textContent.trim() : null,
        name: box('.lname'), title: box('.ltitle'), model: box('.lmodel'), mem: box('.lmem') };
    }));
    const sideways = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const on = rows.filter((r) => r.running);
    say(on.length > 0, 'at ' + width + 'px the list has running rows to read', rows.length + ' rows, ' + on.length + ' running');
    for (const r of on) {
      const at = 'at ' + width + 'px ' + r.agent;
      say(!!r.title && !!r.name && r.title.left === r.name.left && r.title.top >= r.name.bottom,
        at + "'s role sits under the name, not in the avatar column", JSON.stringify(r));
      say(!!r.text && !!r.model && r.model.width >= 150, at + "'s model has a full-width line of its own", JSON.stringify(r));
      say(!!r.model && !!r.name && r.model.left === r.name.left && r.model.top >= r.name.bottom,
        at + "'s model sits under the name, not in the avatar column", JSON.stringify(r));
      say(!!r.mem && !!r.model && r.mem.left === r.name.left && r.mem.top >= r.model.bottom,
        at + "'s memory bar has its own line below the model", JSON.stringify(r));
    }
    const off = rows.filter((x) => !x.running);
    say(off.length > 0, 'at ' + width + 'px the list has a not-running row to read', rows.length + ' rows, ' + off.length + ' not running');
    for (const r of off) {
      say(r.model === null, 'at ' + width + 'px ' + r.agent + "'s empty model cell takes no line", JSON.stringify(r));
    }
    say(sideways <= 0, 'at ' + width + 'px the page does not scroll sideways', String(sideways));
    await ph.close();
  }
  await b.close();
  console.log(fails.length ? 'FAILED' : 'all good');
  process.exit(fails.length ? 1 : 0);
})();

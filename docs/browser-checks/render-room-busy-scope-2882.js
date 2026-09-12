// Browser-check-surface: pj-busy
'use strict';

/**
 * #2882: the project chat-room "…are working" indicator (`paintRoomBusy`, #pj-busy)
 * must scope its working signal to THIS project.
 *
 * ⚠️ WHY A BROWSER. `node --test` reads this file as text: it can prove the filter
 * expression is present, and cannot prove that an agent working in project A stays
 * OFF project B's room line while it lights A's -- the exact over-claim #2882 fixes.
 * That is a show/hide decision on the rendered #pj-busy element, which only a render
 * settles. paintRoomBusy reads the page's own module state (LAST / LAST_AT /
 * ROOM_SPOKE_AT), set here rather than mocked, so this drives the shipped branch.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-room-busy-scope-2882.js
 *
 * ⚠️ HEADED by default, matching the other checks here. `HEADED=0` on a machine with
 * no console session; the verdicts are the same either way (this asserts computed
 * show/hide state, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-room-busy-scope-2882: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-room-busy-scope-2882: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const out = await page.evaluate(() => {
    // The page's own module state, set rather than mocked so we drive the shipped
    // filter. Two working agents: one attributed to projA, one unattributed (null).
    LAST = [
      { sessionName: 's-a', name: 'WorkerA', state: 'working', stateProject: 'projA' },
      { sessionName: 's-null', name: 'Unattributed', state: 'working', stateProject: null },
    ];
    LAST_AT = Date.now();
    ROOM_SPOKE_AT.clear();
    const el = document.getElementById('pj-busy');
    if (!el) return { missing: true };
    const look = (members, projectId) => {
      paintRoomBusy(members, projectId);
      const html = el.innerHTML;
      return { shown: !el.hidden && html.length > 0, hasWorkerA: html.indexOf('WorkerA') !== -1 };
    };
    return {
      ownRoom: look(['s-a'], 'projA'),        // A working in projA, viewed in projA's room -> SHOW
      otherRoom: look(['s-a'], 'projB'),      // same agent, viewed in projB's room -> the #2882 bug -> HIDE
      unattributed: look(['s-null'], 'projA'), // working but stateProject null -> under-claim -> HIDE
    };
  });

  await browser.close();

  const fails = [];
  if (out.missing) fails.push('#pj-busy element not found in the page');
  else {
    if (!(out.ownRoom.shown && out.ownRoom.hasWorkerA)) {
      fails.push('an agent working IN this project (stateProject===projectId) must light its own room: '
        + JSON.stringify(out.ownRoom));
    }
    if (out.otherRoom.shown) {
      fails.push('#2882 REGRESSION: an agent working in another project lit THIS room '
        + '(the unscoped-global over-claim): ' + JSON.stringify(out.otherRoom));
    }
    if (out.unattributed.shown) {
      fails.push('an unattributed working agent (stateProject===null) must NOT light a room '
        + '(the documented under-claim): ' + JSON.stringify(out.unattributed));
    }
  }

  if (fails.length) {
    console.error('FAIL  render-room-busy-scope-2882:');
    for (const f of fails) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('PASS  render-room-busy-scope-2882: the room working-line is scoped to its own project '
    + '(own room shows, other room hidden, unattributed hidden).');
  process.exit(0);
})();

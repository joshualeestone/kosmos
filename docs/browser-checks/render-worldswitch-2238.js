'use strict';

/**
 * kosmos#2238: the multiple-Kosmos SWITCH is wired and actionable. On 0.6.35 the
 * switcher rows were READ-ONLY (create worked, selecting a world did nothing) --
 * Josh's bug. This drives the real switcher UI against a stubbed board and asserts
 * the client flow:
 *
 *  - a NON-active row is a real, actionable menuitem and clicking it calls
 *    POST /api/worlds/active with that world's id (the switch the old rows never made);
 *  - on success the active marker + promoted name move to the chosen world, and an
 *    HONEST status banner appears saying the new world loads after the board restarts
 *    (a world's roots load only at board boot; the in-app auto-restart is a separate
 *    follow-up, see the #2238 plan, so this slice does not claim the switch is live).
 *
 * The CONTROL that proves the probe can see a real switch: the pre-fix page has no
 * click handler on .worldsw-row, so the POST-called and marker-moved assertions red on it.
 *
 * ⚠️ WHY A BROWSER. A source test can read that worldswSwitch posts; it cannot prove a
 * rendered row actually invokes it and moves the marker in a real DOM. Hermetic
 * (file://), no board. The server endpoint is stubbed.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-worldswitch-2238.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldswitch-2238: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldswitch-2238: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    // Stateful board stub: /api/worlds reflects the active id, which POST
    // /api/worlds/active flips (faithfully: the registry switch succeeds; the served
    // world "changes" on the next GET, as it would after a restart).
    const calls = [];
    let activeId = 'w1';
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      const method = (opts && opts.method) || 'GET';
      if (url.indexOf('/api/worlds/active') !== -1 && method === 'POST') {
        const id = JSON.parse((opts && opts.body) || '{}').id;
        calls.push({ url: '/api/worlds/active', id });
        activeId = id;
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world: { id, name: id === 'w2' ? 'Side Project' : 'Home' }, restartRequired: true }) });
      }
      if (url.indexOf('/api/worlds') !== -1 && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds: [{ id: 'w1', name: 'Home' }, { id: 'w2', name: 'Side Project' }], activeWorldId: activeId }) });
      }
      return realFetch(u, opts);
    };
    if (typeof worldsFetch !== 'function') return { error: 'worldsFetch is not a function' };

    await worldsFetch();
    await sleep(10);
    const rows = [...document.querySelectorAll('#worldsw-list .worldsw-row')];
    const before = {
      rowCount: rows.length,
      activeName: (document.getElementById('worldsw-name').textContent || '').trim(),
      // the non-active row (Side Project) must be an actionable menuitem
      sideIsActionable: rows.some((el) => el.getAttribute('role') === 'menuitem' && el.getAttribute('tabindex') === '0' && /Side Project/.test(el.textContent || '')),
      bannerHiddenInitially: document.getElementById('worldsw-restart').hidden,
    };

    // Click the non-active row (Side Project) -> should POST /api/worlds/active {id:w2}.
    const side = rows.find((el) => /Side Project/.test(el.textContent || ''));
    if (!side) return { error: 'no Side Project row rendered' };
    side.click();
    await sleep(30);
    const afterSwitch = {
      switchPosted: calls.some((c) => c.url === '/api/worlds/active' && c.id === 'w2'),
      activeName: (document.getElementById('worldsw-name').textContent || '').trim(),
      bannerShown: !document.getElementById('worldsw-restart').hidden,
      bannerMsg: (document.getElementById('worldsw-restart-msg').textContent || ''),
    };

    return { before, afterSwitch };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  if (!r.error) {
    if (r.before.rowCount !== 2) problems.push('expected 2 world rows, got ' + r.before.rowCount);
    if (!r.before.sideIsActionable) problems.push('the non-active row is not an actionable menuitem (role=menuitem, tabindex=0) -- this is the #2238 read-only-rows bug');
    if (r.before.bannerHiddenInitially !== true) problems.push('the status banner should be hidden before any switch');
    if (r.before.activeName !== 'Home') problems.push('expected the active name "Home" initially, got "' + r.before.activeName + '"');
    // The load-bearing assertions: the switch is actually POSTed and the marker moves.
    if (!r.afterSwitch.switchPosted) problems.push('clicking a world row did NOT POST /api/worlds/active {id:w2} -- the switch is not wired (the exact 0.6.35 bug)');
    if (r.afterSwitch.activeName !== 'Side Project') problems.push('after switching, the promoted name should be "Side Project", got "' + r.afterSwitch.activeName + '"');
    if (!r.afterSwitch.bannerShown) problems.push('after a successful switch the status banner should appear');
    if (!/Side Project/.test(r.afterSwitch.bannerMsg) || !/restart/i.test(r.afterSwitch.bannerMsg)) problems.push('the banner should name the world + say it loads after a board restart, got "' + r.afterSwitch.bannerMsg + '"');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-worldswitch-2238: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldswitch-2238: switcher rows switch the active Kosmos (POST /api/worlds/active), the marker + name move, and the honest banner says the new world loads after a board restart.');
})();

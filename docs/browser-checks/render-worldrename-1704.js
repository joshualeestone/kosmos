'use strict';

/**
 * kosmos#1704 item 14.1 (Josh, 2026-09-05): rename a Kosmos via a cog on its row in
 * the switcher. This pins the UI WIRING that the engine/route unit tests
 * (engine.worlds-rename-1704 + server.test.js #1704 14.1) cannot see: that the cog
 * appears on every NON-default world (and NOT on the default, whose name is the fixed
 * "Kosmos 1"), that tapping it opens the rename modal pre-filled with the world's
 * name, and that Save posts POST /api/worlds/rename with { id, name }.
 *
 * ⚠️ WHY A BROWSER. The rows + cogs are built in JS from the /api/worlds response,
 * and the modal is driven by DOM handlers -- none of it is visible to a source grep.
 * HERMETIC: loads web/index.html over file://, boots no server; it calls the page's
 * real worldswRender() with fixture worlds and stubs window.fetch to capture the POST.
 * Reds on a page without the cog / rename modal (the pre-14.1 switcher).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-worldrename-1704.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldrename-1704: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldrename-1704: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof worldswRender !== 'function') return { error: 'worldswRender is not a function (pre-#1704 page?)' };
    // Render the switcher from fixture worlds (default + one named), then open the menu.
    worldswRender({ worlds: [{ id: 'default', name: 'Kosmos 1' }, { id: 'clientwork', name: 'Client work' }], activeWorldId: 'default' });
    if (typeof worldswOpen === 'function') worldswOpen();

    const entries = document.querySelectorAll('#worldsw-list .worldsw-entry');
    // Find each world's entry by its row name.
    const entryFor = (name) => Array.from(entries).find((e) => {
      const nm = e.querySelector('.worldsw-rowname');
      return nm && nm.textContent === name;
    }) || null;
    const defEntry = entryFor('Kosmos 1');
    const namedEntry = entryFor('Client work');
    const defCog = defEntry ? defEntry.querySelector('.worldsw-cog') : null;
    const namedCog = namedEntry ? namedEntry.querySelector('.worldsw-cog') : null;

    const out = {
      entries: entries.length,
      defaultHasCog: !!defCog,
      namedHasCog: !!namedCog,
    };
    if (!namedCog) return out;   // nothing more to drive

    // Tap the named world's cog: the rename modal opens, pre-filled with its name.
    namedCog.click();
    await new Promise((res) => setTimeout(res, 0));
    const modal = document.getElementById('world-rename-modal');
    const input = document.getElementById('world-rename-name');
    out.modalOpen = !!(modal && !modal.hidden);
    out.prefilled = input ? input.value : '__no-input__';

    // Stub fetch, change the name, Save -> POST /api/worlds/rename { id, name }.
    const calls = [];
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: (opts && opts.body) || '' });
      // ok for the rename POST; the follow-up GET /api/worlds is left to fail (caught).
      const isRename = String(url).indexOf('/api/worlds/rename') !== -1;
      return Promise.resolve({ ok: isRename, json: async () => ({ ok: true, world: { id: 'clientwork', name: 'Renamed' } }) });
    };
    if (input) { input.value = 'Renamed'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    const go = document.getElementById('world-rename-go');
    if (go) go.click();
    await new Promise((res) => setTimeout(res, 0));
    window.fetch = realFetch;

    const posted = calls.find((c) => c.url.indexOf('/api/worlds/rename') !== -1 && c.method === 'POST');
    out.rename_posted = !!posted;
    try { out.rename_body = posted ? JSON.parse(posted.body) : null; } catch { out.rename_body = null; }
    return out;
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (r.entries !== 2) problems.push('expected 2 switcher entries, got ' + r.entries);
    if (r.defaultHasCog) problems.push('the DEFAULT world ("Kosmos 1") has a rename cog -- it should not (its name is fixed)');
    if (!r.namedHasCog) problems.push('a NAMED world has no rename cog (#1704 14.1)');
    if (r.namedHasCog) {
      if (!r.modalOpen) problems.push('tapping the cog did not open the rename modal');
      if (r.prefilled !== 'Client work') problems.push('the rename modal was not pre-filled with the world name, got ' + JSON.stringify(r.prefilled));
      if (!r.rename_posted) problems.push('Save did not POST to /api/worlds/rename');
      if (!r.rename_body || r.rename_body.id !== 'clientwork' || r.rename_body.name !== 'Renamed') {
        problems.push('the rename POST body is wrong: ' + JSON.stringify(r.rename_body) + ' (want {id:"clientwork",name:"Renamed"})');
      }
    }
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-worldrename-1704: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldrename-1704: OK (a rename cog on each non-default world opens a pre-filled modal that POSTs the rename)');
  process.exit(0);
})();

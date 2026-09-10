'use strict';

/**
 * kosmos#2563: "Add my agents from an existing Kosmos" on the create-a-new-Kosmos modal.
 *
 * The web slice adds an OPT-IN import selector to #world-add-modal: worldAddOpen() fetches
 * GET /api/worlds/list and worldImportRender() draws one checkbox per OTHER Kosmos (name +
 * agent count); worldAddSubmit() adds importAgentsFrom:[...] to the POST /api/worlds body
 * when boxes are checked. The engine endpoints are a SEPARATE lane and are not live yet, so
 * the load-bearing behaviour is: the control shows when the list HAS entries, HIDES when the
 * list endpoint is absent (the graceful-degrade that lets this ship before the engine), and
 * a checked selection reaches the create payload. The render/fetch/submit units are covered
 * by web.world-import-2563.test.js; this proves a real DOM does it end to end.
 *
 * Two scenarios, hermetic (file://), fetch stubbed:
 *  - A (list present): GET /api/worlds/list -> two Kosmoses. Opening the create modal shows
 *    the control with one labelled checkbox each ("Client work (2 agents)", "Side project
 *    (1 agent)"), the checkbox value is the world id, and checking both then submitting sends
 *    importAgentsFrom:['w1','w2'] on POST /api/worlds.
 *  - B (endpoint absent): GET /api/worlds/list -> 404 (the engine slice not live). Opening the
 *    modal leaves #world-add-import HIDDEN, so the create flow is exactly today's.
 *
 * CONTROL (red before #2563): on the pre-slice page #world-add-import / worldAddOpen's fetch
 * do not exist, so reading .hidden on the absent element throws and the check reds.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-world-import-2563.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-world-import-2563: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-world-import-2563: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const wrap = () => document.getElementById('world-add-import');
    const wrapHidden = () => wrap().hidden;
    const rows = () => [...document.querySelectorAll('#world-add-import-list .world-import-row')];
    const waitFor = async (pred, capMs) => {
      const end = Date.now() + capMs;
      while (Date.now() < end) { if (pred()) return true; await sleep(15); }
      return pred();
    };

    let listMode = 'two';   // 'two' | 'absent'
    let postBody = null;
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      const method = (opts && opts.method) || 'GET';
      if (url.indexOf('/api/worlds/list') !== -1 && method === 'GET') {
        if (listMode === 'absent') return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds: [
          { id: 'w1', name: 'Client work', agentCount: 2 },
          { id: 'w2', name: 'Side project', agentCount: 1 },
        ] }) });
      }
      if (/\/api\/worlds$/.test(url.split('?')[0]) && method === 'POST') {
        postBody = JSON.parse((opts && opts.body) || '{}');
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, world: { id: 'wnew', name: postBody.name } }) });
      }
      if (url.indexOf('/api/worlds') !== -1 && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds: [{ id: 'w1', name: 'Client work' }], activeWorldId: 'w1' }) });
      }
      return realFetch(u, opts);
    };
    if (typeof worldAddOpen !== 'function') return { error: 'worldAddOpen is not a function' };
    if (typeof worldAddSubmit !== 'function') return { error: 'worldAddSubmit is not a function' };
    // Stub the post-create side effects so a hermetic submit does not throw on the switcher.
    if (typeof worldswOpen !== 'function') window.worldswOpen = () => {};

    // ---- Scenario A: the list has other Kosmoses -> one labelled checkbox each ----
    listMode = 'two';
    worldAddOpen();
    const shown = await waitFor(() => !wrapHidden() && rows().length === 2, 2000);
    const rowInfo = rows().map((row) => ({
      label: (row.querySelector('.world-import-name') || {}).textContent || '',
      value: (row.querySelector('.world-import-cb') || {}).value || '',
      isCheckbox: (row.querySelector('.world-import-cb') || {}).type === 'checkbox',
    }));
    // Check both, name it, submit -> the create payload must carry both world ids.
    for (const cb of document.querySelectorAll('#world-add-import-list .world-import-cb')) cb.checked = true;
    document.getElementById('world-add-name').value = 'Imported';
    postBody = null;
    await worldAddSubmit();
    const submittedImport = postBody && postBody.importAgentsFrom ? postBody.importAgentsFrom.slice() : null;

    // ---- Scenario B: the endpoint is absent -> control stays hidden (graceful degrade) ----
    listMode = 'absent';
    worldAddOpen();
    await sleep(200);   // let the fetch reject + render run
    const hiddenWhenAbsent = wrapHidden();

    return { shown, rowInfo, submittedImport, hiddenWhenAbsent };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push('the check could not run: ' + r.error);
  if (!r.error) {
    if (!r.shown) problems.push('with GET /api/worlds/list returning two Kosmoses, opening the create modal must SHOW #world-add-import with one row each, but it did not');
    const info = r.rowInfo || [];
    if ((info[0] || {}).label !== 'Client work (2 agents)') problems.push('the first row label/count is wrong: got "' + ((info[0] || {}).label) + '", expected "Client work (2 agents)"');
    if ((info[1] || {}).label !== 'Side project (1 agent)') problems.push('the second row label/count is wrong (singular agent): got "' + ((info[1] || {}).label) + '", expected "Side project (1 agent)"');
    if ((info[0] || {}).value !== 'w1' || (info[1] || {}).value !== 'w2') problems.push('a checkbox value is not the world id (needed for importAgentsFrom): got ' + JSON.stringify(info.map((i) => i.value)));
    if (!info.every((i) => i.isCheckbox)) problems.push('the import rows must be real checkboxes');
    if (JSON.stringify(r.submittedImport) !== JSON.stringify(['w1', 'w2'])) problems.push('checking both Kosmoses and creating must POST importAgentsFrom:["w1","w2"], got ' + JSON.stringify(r.submittedImport));
    if (!r.hiddenWhenAbsent) problems.push('THE GRACEFUL DEGRADE: when GET /api/worlds/list is absent (404, the engine slice not live), #world-add-import must stay HIDDEN so the create flow is unchanged, but it was shown');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-world-import-2563: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('PASS  render-world-import-2563');
  process.exit(0);
})();

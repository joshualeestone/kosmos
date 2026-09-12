'use strict';

/**
 * kosmos#2563 + #1704 PR4: "Add my agents from" on the New Kosmos dialog, one agent at a time.
 *
 * Josh: "when I'm creating the new KOSMOS, I can add agents to it that are my existing agents
 * from another KOSMOS right there when I create it. Or I can just skip and not add any."
 *
 * worldAddOpen() fetches GET /api/worlds/list and worldImportRender() draws one GROUP per
 * Kosmos: a box labelled "<Kosmos> (N agents)" that ticks every agent in it, and beneath it one
 * box per agent. worldAddSubmit() sends importAgents:[{from, name}] ONLY when something is
 * ticked; Skip clears every tick. This proves a real DOM does it end to end (the render / fetch
 * / submit units are covered by web.world-import-2563.test.js).
 *
 * Three scenarios, hermetic (file://), fetch stubbed:
 *  - A (list present): two Kosmoses. The groups show with their labelled boxes; the first
 *    Kosmos's box ticks both its agents; one agent of the second is ticked by itself (its
 *    Kosmos box goes part-ticked); Create posts exactly those three picks. The answer says they
 *    start when the new Kosmos is opened (it is not the open one), so the dialog stays open
 *    with that sentence and Cancel reads Done.
 *  - S (Skip): reopened, an agent ticked, then the real Skip button: nothing is ticked and
 *    Create posts { name } with no importAgents.
 *  - B (endpoint unreachable): GET /api/worlds/list -> 404. #world-add-import stays HIDDEN.
 *
 * CONTROL: on the pre-PR4 page the rows are one checkbox per KOSMOS (value = world id, no
 * .world-import-all / per-agent boxes, no Skip), so the group and payload checks red.
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
    const groups = () => [...document.querySelectorAll('#world-add-import-list .world-import-group')];
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
          { id: 'w1', name: 'Client work', agentCount: 2, agents: [{ name: 'ava', displayName: 'Ava', because: null }, { name: 'bo', displayName: 'Bo', because: null }], waiting: [] },
          { id: 'w2', name: 'Side project', agentCount: 2, agents: [{ name: 'cy', displayName: 'Cy', because: null }, { name: 'dee', displayName: 'Dee', because: null }], waiting: [] },
        ] }) });
      }
      if (/\/api\/worlds$/.test(url.split('?')[0]) && method === 'POST') {
        postBody = JSON.parse((opts && opts.body) || '{}');
        const picks = Array.isArray(postBody.importAgents) ? postBody.importAgents : [];
        const imported = picks.length ? {
          copied: picks.map((p) => ({ from: p.from, name: p.name, displayName: p.name.charAt(0).toUpperCase() + p.name.slice(1) })),
          refused: [], started: [], waiting: [],
          later: picks.map((p) => p.name),   // a new Kosmos is not the open one: its agents start when it opens
        } : null;
        const world = { id: 'wnew', name: postBody.name };
        return Promise.resolve({ ok: true, status: 200, json: async () => (imported ? { ok: true, world, imported } : { ok: true, world }) });
      }
      if (url.indexOf('/api/worlds') !== -1 && method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ worlds: [{ id: 'w1', name: 'Client work' }], activeWorldId: 'w1' }) });
      }
      return realFetch(u, opts);
    };
    if (typeof worldAddOpen !== 'function') return { error: 'worldAddOpen is not a function' };
    if (typeof worldAddSubmit !== 'function') return { error: 'worldAddSubmit is not a function' };
    if (typeof worldswOpen !== 'function') window.worldswOpen = () => {};

    // ---- Scenario A: groups, the Kosmos box, one agent alone, Create, and the outcome said ----
    listMode = 'two';
    worldAddOpen();
    const shown = await waitFor(() => !wrap().hidden && groups().length === 2, 2000);
    const focusOnName = document.activeElement && document.activeElement.id === 'world-add-name';
    const groupInfo = groups().map((g) => ({
      head: (g.querySelector('.world-import-all + .world-import-name') || {}).textContent || '',
      headValue: (g.querySelector('.world-import-all') || {}).value || '',
      agents: [...g.querySelectorAll('.world-import-cb')].map((cb) => ({ value: cb.value, from: cb.dataset.from, label: (cb.nextElementSibling || {}).textContent || '', isCheckbox: cb.type === 'checkbox', labelled: !!cb.closest('label') })),
    }));
    const diskPanel = document.getElementById('import-found');
    const worldCbs = [...document.querySelectorAll('#world-add-import-list input[type="checkbox"]')];
    const distinctFromDisk = !!wrap() && wrap() !== diskPanel && worldCbs.length > 0
      && worldCbs.every((cb) => wrap().contains(cb) && !(diskPanel && diskPanel.contains(cb)));

    const [g1, g2] = groups();
    g1.querySelector('.world-import-all').click();
    const firstBoth = [...g1.querySelectorAll('.world-import-cb')].every((cb) => cb.checked);
    g2.querySelector('.world-import-cb[value="cy"]').click();
    const secondPartial = g2.querySelector('.world-import-all').indeterminate === true;
    document.getElementById('world-add-name').value = 'Imported';
    postBody = null;
    await worldAddSubmit();
    const submitted = postBody && postBody.importAgents ? postBody.importAgents.slice() : null;
    const modalStillOpen = !document.getElementById('world-add-modal').hidden;
    const outcome = document.getElementById('world-add-msg').textContent;
    const cancelText = document.getElementById('world-add-cancel').textContent;

    // ---- Scenario S: Skip clears, and Create sends { name } alone ----
    worldAddOpen();
    await waitFor(() => !wrap().hidden && groups().length === 2, 2000);
    const cancelReset = document.getElementById('world-add-cancel').textContent;
    groups()[0].querySelector('.world-import-cb[value="ava"]').click();
    document.getElementById('world-add-skip').click();
    const tickedAfterSkip = [...document.querySelectorAll('#world-add-import-list input[type="checkbox"]')].filter((cb) => cb.checked || cb.indeterminate).length;
    document.getElementById('world-add-name').value = 'Skipped';
    postBody = null;
    await worldAddSubmit();
    const skippedBody = postBody;

    // ---- Scenario B: the endpoint is absent -> control stays hidden (graceful degrade) ----
    listMode = 'absent';
    worldAddOpen();
    await sleep(200);
    const hiddenWhenAbsent = wrap().hidden;

    return { shown, focusOnName, groupInfo, distinctFromDisk, firstBoth, secondPartial, submitted, modalStillOpen, outcome, cancelText, cancelReset, tickedAfterSkip, skippedBody, hiddenWhenAbsent };
  });

  await browser.close();

  const problems = [];
  if (r.error) problems.push('the check could not run: ' + r.error);
  if (!r.error) {
    if (!r.shown) problems.push('with GET /api/worlds/list returning two Kosmoses, opening New Kosmos must SHOW #world-add-import with one group each, but it did not');
    if (!r.focusOnName) problems.push('opening New Kosmos must put focus in the name field');
    const g = r.groupInfo || [];
    if ((g[0] || {}).head !== 'Client work (2 agents)' || (g[1] || {}).head !== 'Side project (2 agents)') problems.push('each Kosmos box must read "<Kosmos> (N agents)", got ' + JSON.stringify(g.map((x) => x.head)));
    if ((g[0] || {}).headValue !== 'w1') problems.push('the Kosmos box value is not the world id');
    const a = (g[0] || {}).agents || [];
    if (JSON.stringify(a.map((x) => [x.value, x.from, x.label])) !== JSON.stringify([['ava', 'w1', 'Ava'], ['bo', 'w1', 'Bo']])) problems.push('the first Kosmos\'s agent boxes are wrong (value = name, data-from = Kosmos, label = display name): ' + JSON.stringify(a));
    if (!g.every((x) => x.agents.every((y) => y.isCheckbox && y.labelled))) problems.push('every agent must be a real checkbox inside its label');
    if (!r.distinctFromDisk) problems.push('THE WRONG-ASSET GUARD: the Kosmos picker must be distinct from the disk find-agents panel (#import-found), with its boxes scoped to it');
    if (!r.firstBoth) problems.push('ticking a Kosmos box must tick every agent in it');
    if (!r.secondPartial) problems.push('one of two agents ticked must show its Kosmos box part-ticked (indeterminate)');
    if (JSON.stringify(r.submitted) !== JSON.stringify([{ from: 'w1', name: 'ava' }, { from: 'w1', name: 'bo' }, { from: 'w2', name: 'cy' }])) problems.push('Create must POST importAgents for exactly the ticked agents, got ' + JSON.stringify(r.submitted));
    if (!r.modalStillOpen) problems.push('agents that WAIT were closed over as if they were running: the dialog must stay open and say so');
    if (r.outcome.indexOf('Ava, Bo, Cy start when you open Imported.') === -1) problems.push('the outcome must say the agents start when the new Kosmos is opened, got ' + JSON.stringify(r.outcome));
    if (r.cancelText !== 'Done') problems.push('once the Kosmos exists, Cancel must read Done, got ' + JSON.stringify(r.cancelText));
    if (r.cancelReset !== 'Cancel') problems.push('a reopened New Kosmos must read Cancel again, got ' + JSON.stringify(r.cancelReset));
    if (r.tickedAfterSkip !== 0) problems.push('Skip must clear every tick, ' + r.tickedAfterSkip + ' stayed');
    if (!r.skippedBody || JSON.stringify(r.skippedBody) !== JSON.stringify({ name: 'Skipped' })) problems.push('after Skip, Create must POST exactly { name }, got ' + JSON.stringify(r.skippedBody));
    if (!r.hiddenWhenAbsent) problems.push('THE GRACEFUL DEGRADE: when GET /api/worlds/list is unreachable, #world-add-import must stay HIDDEN');
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

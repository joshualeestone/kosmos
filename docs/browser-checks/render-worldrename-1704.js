'use strict';

/**
 * kosmos#1704 item 14.1 + PR4: the settings cog next to EVERY Kosmos in the switcher.
 *
 * Josh: "I can always get back to that pane if I go to the little settings cog next to that
 * particular KOSMOS and add agents from another KOSMOS." This pins the UI wiring the unit
 * suites cannot see:
 *  - the cog is on every row, Kosmos 1 included, labelled "Settings for <Kosmos>";
 *  - a NAMED Kosmos's cog opens its settings with the rename field pre-filled (Save posts
 *    POST /api/worlds/rename {id, name}), and says which agents are waiting to start there;
 *  - Kosmos 1's cog opens the same pane WITHOUT rename (its name is fixed), focus on Close,
 *    and the picker lists the OTHER Kosmoses' agents; Add agents is disabled until one is
 *    ticked, then posts POST /api/worlds/import {id, importAgents} and says what happened;
 *  - Tab stays inside the pane (a real keyboard, not a simulated event).
 *
 * ⚠️ WHY A BROWSER. The rows, cogs and picker are built in JS from fetched lists, and the
 * trap is a keydown handler -- none of it is visible to a source grep. HERMETIC: file://,
 * no server; window.fetch is stubbed. Reds on the pre-PR4 switcher (no cog on Kosmos 1, a
 * rename-only modal with no picker).
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
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const $ = (id) => document.getElementById(id);
    const calls = [];
    const LIST = { worlds: [
      { id: 'default', name: 'Kosmos 1', agentCount: 1, agents: [{ name: 'ava', displayName: 'Ava', because: null }], waiting: [] },
      { id: 'clientwork', name: 'Client work', agentCount: 2, agents: [{ name: 'bo', displayName: 'Bo', because: null }, { name: 'ava', displayName: 'Ava', because: null }], waiting: [{ name: 'cy', displayName: 'Cy', because: null }] },
    ] };
    window.fetch = (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      calls.push({ url: u, method, body: (opts && opts.body) || '' });
      if (u.indexOf('/api/worlds/list') !== -1) return Promise.resolve({ ok: true, json: async () => LIST });
      if (u.indexOf('/api/worlds/rename') !== -1) return Promise.resolve({ ok: true, json: async () => ({ ok: true, world: { id: 'clientwork', name: 'Renamed' } }) });
      if (u.indexOf('/api/worlds/import') !== -1) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, world: { id: 'default', name: 'Kosmos 1' },
          imported: { copied: [{ from: 'clientwork', name: 'bo', displayName: 'Bo' }], refused: [], started: ['bo'], waiting: [], later: [] } }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });   // GET /api/worlds: leave the rows as rendered
    };

    worldswRender({ worlds: [{ id: 'default', name: 'Kosmos 1' }, { id: 'clientwork', name: 'Client work' }], activeWorldId: 'default' });
    if (typeof worldswOpen === 'function') worldswOpen();
    const entries = [...document.querySelectorAll('#worldsw-list .worldsw-entry')];
    const cogOf = (name) => {
      const e = entries.find((x) => (x.querySelector('.worldsw-rowname') || {}).textContent === name);
      return e ? e.querySelector('.worldsw-cog') : null;
    };
    const out = {
      entries: entries.length,
      cogLabels: entries.map((e) => { const c = e.querySelector('.worldsw-cog'); return c ? c.getAttribute('aria-label') : null; }),
    };
    const namedCog = cogOf('Client work');
    const defCog = cogOf('Kosmos 1');
    if (!namedCog || !defCog) return out;

    // A NAMED Kosmos: settings with rename, pre-filled; the waiting line; Save posts the rename.
    namedCog.click();
    await sleep(80);
    out.named = {
      open: !$('world-rename-modal').hidden,
      title: $('world-rename-t').textContent,
      renameShown: !$('world-rename-section').hidden,
      prefilled: $('world-rename-name').value,
      focus: document.activeElement && document.activeElement.id,
      waiting: $('world-set-waiting').hidden ? '' : $('world-set-waiting').textContent,
    };
    $('world-rename-name').value = 'Renamed';
    $('world-rename-name').dispatchEvent(new Event('input', { bubbles: true }));
    $('world-rename-go').click();
    await sleep(80);
    const renamed = calls.find((c) => c.url.indexOf('/api/worlds/rename') !== -1 && c.method === 'POST');
    try { out.renameBody = renamed ? JSON.parse(renamed.body) : null; } catch { out.renameBody = null; }

    // Kosmos 1: no rename, focus on Close, the other Kosmos's agents to pick, Add posts the import.
    cogOf('Kosmos 1').click();
    await sleep(80);
    out.def = {
      open: !$('world-rename-modal').hidden,
      renameHidden: $('world-rename-section').hidden,
      focus: document.activeElement && document.activeElement.id,
      pickerShown: !$('world-set-import').hidden,
      heads: [...document.querySelectorAll('#world-set-import-list .world-import-all + .world-import-name')].map((s) => s.textContent),
      addDisabledBefore: $('world-set-add').disabled,
    };
    // Review round 1: Kosmos 1 already holds ava, so Client work's ava is "already here".
    const avaHere = document.querySelector('#world-set-import-list .world-import-cb[value="ava"]');
    out.def.avaAlreadyHere = !!avaHere && avaHere.disabled && ((avaHere.nextElementSibling || {}).textContent === 'Ava (already here)');
    const bo = document.querySelector('#world-set-import-list .world-import-cb[value="bo"]');
    if (bo) bo.click();
    out.def.addDisabledAfter = $('world-set-add').disabled;
    $('world-set-add').click();
    await sleep(80);
    const imported = calls.find((c) => c.url.indexOf('/api/worlds/import') !== -1 && c.method === 'POST');
    try { out.importBody = imported ? JSON.parse(imported.body) : null; } catch { out.importBody = null; }
    out.outcome = $('world-rename-msg').textContent;
    out.focusAfterAdd = document.activeElement && document.activeElement.id;
    $('world-rename-cancel').focus();
    return out;
  });

  // The Tab trap, with a real keyboard: the pane is still open (Kosmos 1's settings).
  let trappedEvery = true;
  if (!r.error && r.def && r.def.open) {
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      const inside = await page.evaluate(() => document.getElementById('world-rename-modal').contains(document.activeElement));
      if (!inside) { trappedEvery = false; break; }
    }
  }

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (r.entries !== 2) problems.push('expected 2 switcher entries, got ' + r.entries);
    if (JSON.stringify(r.cogLabels) !== JSON.stringify(['Settings for Kosmos 1', 'Settings for Client work'])) {
      problems.push('every Kosmos, Kosmos 1 included, needs a settings cog: ' + JSON.stringify(r.cogLabels));
    }
    const n = r.named || {};
    if (!n.open) problems.push('the named Kosmos\'s cog did not open its settings');
    if (n.title !== 'Client work settings') problems.push('the pane title is wrong: ' + JSON.stringify(n.title));
    if (!n.renameShown) problems.push('a named Kosmos\'s settings must offer rename');
    if (n.prefilled !== 'Client work') problems.push('rename was not pre-filled with the Kosmos name, got ' + JSON.stringify(n.prefilled));
    if (n.focus !== 'world-rename-name') problems.push('a named Kosmos\'s settings must open with focus in the name, got ' + JSON.stringify(n.focus));
    if (n.waiting !== 'Waiting to start here: Cy. They start when this Kosmos is opened.') problems.push('the waiting line must speak display names: ' + JSON.stringify(n.waiting));
    if (!r.renameBody || r.renameBody.id !== 'clientwork' || r.renameBody.name !== 'Renamed') problems.push('Save name did not POST {id:"clientwork",name:"Renamed"}: ' + JSON.stringify(r.renameBody));
    const d = r.def || {};
    if (!d.open) problems.push('Kosmos 1\'s cog did not open its settings');
    if (!d.renameHidden) problems.push('Kosmos 1\'s name is fixed, so its settings must not offer rename');
    if (d.focus !== 'world-rename-cancel') problems.push('Kosmos 1\'s settings must open with focus on Close, got ' + JSON.stringify(d.focus));
    if (!d.pickerShown) problems.push('the "add agents from another Kosmos" pane did not show');
    if (JSON.stringify(d.heads) !== JSON.stringify(['Client work (2 agents)'])) problems.push('the picker must list only the OTHER Kosmoses: ' + JSON.stringify(d.heads));
    if (!d.avaAlreadyHere) problems.push('a name Kosmos 1 already holds must show "(already here)", disabled');
    if (r.focusAfterAdd !== 'world-rename-cancel') problems.push('after Add agents, focus must move to Close, got ' + JSON.stringify(r.focusAfterAdd));
    if (!d.addDisabledBefore || d.addDisabledAfter) problems.push('Add agents must be disabled until an agent is ticked, then enabled');
    if (JSON.stringify(r.importBody) !== JSON.stringify({ id: 'default', importAgents: [{ from: 'clientwork', name: 'bo' }] })) problems.push('Add agents posted the wrong body: ' + JSON.stringify(r.importBody));
    if (r.outcome !== 'Added Bo to Kosmos 1. Bo is starting now.') problems.push('the outcome was not said: ' + JSON.stringify(r.outcome));
    if (!trappedEvery) problems.push('Tab left the settings pane: it needs a real focus trap');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-worldrename-1704: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldrename-1704: OK (a settings cog on every Kosmos; rename for named ones; add agents from another Kosmos; Tab stays inside)');
  process.exit(0);
})();

'use strict';

/**
 * kosmos#2935: hide (soft-delete) a Kosmos from the settings cog.
 *
 * Josh ruled soft-delete only: hiding drops a Kosmos off the Kosmoses list but the on-disk store
 * stays accessible, so the confirm copy must SAY the files remain and where, and Kosmos 1 is never
 * hideable. This pins the UI wiring the unit suites cannot see:
 *  - a NAMED Kosmos's settings show a "Hide this Kosmos" section whose copy states the files are
 *    not deleted and where they stay (the one required user-facing string);
 *  - hiding is a deliberate two step: "Hide from my Kosmoses list" reveals a confirm row, and only
 *    "Hide" there POSTs POST /api/worlds/hide {id}; on success the modal closes and the switcher
 *    refetches;
 *  - the route's refusal text surfaces (409 EACTIVE: switch away from the active Kosmos first);
 *  - Kosmos 1's settings have NO hide section (the default is never hideable).
 *
 * WHY A BROWSER. The section, the two-step confirm and the POST body are built/handled in JS off
 * fetched lists and click handlers, none of it visible to a source grep. HERMETIC: file://, no
 * server; window.fetch is stubbed. Reds on a page with no hide section or a one-step (no confirm)
 * hide.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-worldhide-2935.js
 * HEADED by default; HEADED=0 on a console-less machine.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldhide-2935: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldhide-2935: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof worldswRender !== 'function') return { error: 'worldswRender is not a function (pre-#1704 page?)' };
    if (typeof worldHideSubmit !== 'function') return { error: 'worldHideSubmit is not a function (pre-#2935 page?)' };
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const $ = (id) => document.getElementById(id);
    const calls = [];
    const LIST = { worlds: [
      { id: 'default', name: 'Kosmos 1', agentCount: 1, agents: [{ name: 'ava', displayName: 'Ava', because: null }], waiting: [] },
      { id: 'clientwork', name: 'Client work', agentCount: 1, agents: [{ name: 'bo', displayName: 'Bo', because: null }], waiting: [] },
      { id: 'booted', name: 'Booted world', agentCount: 0, agents: [], waiting: [] },
    ] };
    window.fetch = (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      const body = (opts && opts.body) || '';
      calls.push({ url: u, method, body });
      if (u.indexOf('/api/worlds/list') !== -1) return Promise.resolve({ ok: true, json: async () => LIST });
      if (u.indexOf('/api/worlds/hide') !== -1) {
        let id = '';
        try { id = JSON.parse(body).id; } catch { id = ''; }
        // The active/booted world is refused server-side; the client must surface the reason.
        if (id === 'booted') return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'world in use', because: 'Switch to another Kosmos before hiding this one.' }) });
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, world: { id, hiddenAt: '2026-09-12T00:00:00.000Z' } }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });   // GET /api/worlds: leave the rows as rendered
    };

    worldswRender({ worlds: LIST.worlds.map((w) => ({ id: w.id, name: w.name })), activeWorldId: 'booted' });
    if (typeof worldswOpen === 'function') worldswOpen();
    const entries = [...document.querySelectorAll('#worldsw-list .worldsw-entry')];
    const cogOf = (name) => {
      const e = entries.find((x) => (x.querySelector('.worldsw-rowname') || {}).textContent === name);
      return e ? e.querySelector('.worldsw-cog') : null;
    };
    const out = { entries: entries.length };
    const namedCog = cogOf('Client work');
    const bootedCog = cogOf('Booted world');
    const defCog = cogOf('Kosmos 1');
    if (!namedCog || !bootedCog || !defCog) return out;

    // Kosmos 1: no hide section (the default is never hideable).
    defCog.click();
    await sleep(80);
    out.def = {
      open: !$('world-rename-modal').hidden,
      hideHidden: $('world-hide-section').hidden,
    };
    $('world-rename-cancel').click();
    await sleep(40);

    // A NAMED Kosmos: the hide section shows, with files-stay-accessible copy and a two-step confirm.
    namedCog.click();
    await sleep(80);
    out.named = {
      open: !$('world-rename-modal').hidden,
      hideShown: !$('world-hide-section').hidden,
      hint: $('world-hide-hint').textContent,
      confirmSay: $('world-hide-confirm-say').textContent,
      step1Before: !$('world-hide-step1').hidden,
      confirmBefore: !$('world-hide-confirm').hidden,
    };
    // Step 1 reveals the confirm row; only "Hide" there fires the POST.
    $('world-hide-go').click();
    await sleep(40);
    out.named.step1AfterGo = !$('world-hide-step1').hidden;
    out.named.confirmAfterGo = !$('world-hide-confirm').hidden;
    // Cancel returns to step 1 without any POST.
    $('world-hide-cancel').click();
    await sleep(40);
    out.named.confirmAfterCancel = !$('world-hide-confirm').hidden;
    out.named.postsAfterCancel = calls.filter((c) => c.url.indexOf('/api/worlds/hide') !== -1).length;
    // Re-open confirm and actually hide.
    $('world-hide-go').click();
    await sleep(40);
    $('world-hide-really').click();
    await sleep(120);
    const hid = calls.find((c) => c.url.indexOf('/api/worlds/hide') !== -1 && c.method === 'POST');
    try { out.named.hideBody = hid ? JSON.parse(hid.body) : null; } catch { out.named.hideBody = null; }
    out.named.modalClosedAfterHide = $('world-rename-modal').hidden;
    out.named.refetchedAfterHide = calls.some((c) => c.url.indexOf('/api/worlds/list') !== -1);

    // The active/booted world: the route refuses, and the reason must surface (modal stays open).
    bootedCog.click();
    await sleep(80);
    $('world-hide-go').click();
    await sleep(40);
    $('world-hide-really').click();
    await sleep(120);
    out.booted = {
      msg: $('world-rename-msg').textContent,
      stillOpen: !$('world-rename-modal').hidden,
    };
    return out;
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (r.entries !== 3) problems.push('expected 3 switcher entries, got ' + r.entries);
    const d = r.def || {};
    if (!d.open) problems.push('Kosmos 1\'s cog did not open its settings');
    if (!d.hideHidden) problems.push('Kosmos 1 is never hideable, so its settings must have NO hide section');
    const n = r.named || {};
    if (!n.open) problems.push('the named Kosmos\'s cog did not open its settings');
    if (!n.hideShown) problems.push('a named Kosmos\'s settings must offer a hide section');
    if (!/not deleted/.test(n.hint || '') || !/stay in your Kosmos folder/.test(n.hint || '')) {
      problems.push('the hide copy must state the files are not deleted and where they stay: ' + JSON.stringify(n.hint));
    }
    if (!/remain accessible/.test(n.confirmSay || '')) problems.push('the confirm copy must restate that files remain accessible: ' + JSON.stringify(n.confirmSay));
    if (!n.step1Before || n.confirmBefore) problems.push('the hide section must open on step 1 (danger button), confirm hidden');
    if (n.step1AfterGo || !n.confirmAfterGo) problems.push('"Hide from my Kosmoses list" must reveal the confirm row and hide step 1');
    if (n.confirmAfterCancel) problems.push('Cancel must return to step 1 (confirm hidden)');
    if (n.postsAfterCancel !== 0) problems.push('Cancel must not POST a hide: ' + n.postsAfterCancel + ' call(s)');
    if (!n.hideBody || n.hideBody.id !== 'clientwork') problems.push('Hide did not POST {id:"clientwork"}: ' + JSON.stringify(n.hideBody));
    if (!n.modalClosedAfterHide) problems.push('after a successful hide the settings modal must close');
    if (!n.refetchedAfterHide) problems.push('after a successful hide the switcher must refetch the list');
    const b = r.booted || {};
    if (b.msg !== 'Switch to another Kosmos before hiding this one.') problems.push('the route\'s refusal reason must surface: ' + JSON.stringify(b.msg));
    if (!b.stillOpen) problems.push('a refused hide must leave the settings modal open so the reason is readable');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-worldhide-2935: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldhide-2935: OK (hide section on named Kosmoses with files-stay copy; two-step confirm POSTs {id}; refusal surfaces; Kosmos 1 not hideable)');
  process.exit(0);
})();

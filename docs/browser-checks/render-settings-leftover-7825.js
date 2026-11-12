'use strict';

/**
 * kosmos#7825 (PR 2): the removed list draws names with only settings left (no folder, no job), the one screen that
 * lists agents with no card, with the same "Delete" door as a removed row and no Restore.
 *
 * WHY A BROWSER CHECK: server.test.js proves /api/removed ships `leftovers`; it cannot prove paintRemoved draws them,
 * that the folder hint stays off rows it is false for, or that the section still hides when there is nothing at all.
 * This drives the real paintRemoved() against a stubbed /api/removed (no board) and reads the rendered rows.
 *
 * Arms: a first load whose leftovers read fails says so in the shared line (not on another screen), and a good read
 * takes it down; leftovers alone show the section with no Restore and no folder hint; mixed with a removed row the count is
 * both and the hint stays with the removed rows; a Windows task left with its settings says its startup job is left
 * too (kosmos#8471); the field absent (the board could not read it)
 * keeps the rows last drawn; nothing removed and nothing left over hides the section (NEGATIVE); the door fetches the
 * plan and paints a refusal under the list.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-settings-leftover-7825.js
 * HEADED by default like its siblings; HEADED=0 on a machine with no console session (computed DOM, not pixels).
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-settings-leftover-7825: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const say = (ok, label, extra) => console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    say(false, 'render-settings-leftover-7825: could not start a browser' + (process.env.HEADED === '0' ? '' : ' (headed; try HEADED=0)'),
      err && err.message ? err.message.split('\n')[0] : String(err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof paintRemoved !== 'function') return { error: 'paintRemoved is not a function' };
    let body = null;
    let planAsked = null;
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      if (url.indexOf('/api/removed') !== -1) return Promise.resolve({ ok: true, json: async () => body });
      if (url.indexOf('/leftover') !== -1 && opts && opts.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ outcome: 'deleted', said: 'Stray\'s settings are in the Trash. The name is free.' }) });
      }
      if (url.indexOf('/leftover') !== -1) {
        planAsked = url;
        return Promise.resolve({ ok: true, json: async () => ({ ok: false, because: 'stray-7825 is waiting to start on this computer, so its settings are not left over.' }) });
      }
      return realFetch(u, opts);
    };
    const wrap = document.getElementById('removed-wrap');
    const list = document.getElementById('removed-list');
    const toggle = document.getElementById('removed-toggle');
    const snap = () => {
      const rows = [...list.querySelectorAll('.removed-row')].map((row) => ({
        who: (row.querySelector('.who') || {}).textContent || '',
        when: (row.querySelector('.when') || {}).textContent || '',
        restore: !!row.querySelector('[data-restore], [data-restore-blocked]'),
        del: (row.querySelector('[data-delete-leftover]') || { dataset: {} }).dataset.deleteLeftover || null,
        delText: ((row.querySelector('[data-delete-leftover]') || {}).textContent || '').trim(),
      }));
      const hints = [...list.querySelectorAll('.removed-hint')].map((h) => h.textContent);
      return { wrapHidden: wrap.hidden, label: toggle.textContent, rows, hint: hints.some((t) => /^Nothing was deleted/.test(t)),
        stale: hints.some((t) => /has not been able to check for leftover settings in a while/.test(t)),
        hintAfterRemoved: (() => { const h = list.querySelector('.removed-hint'); const kids = [...list.children]; return h ? kids.indexOf(h) : -1; })() };
    };
    const out = {};
    // 0. first load while the leftovers read fails, nothing removed: the shared line says so; a good read takes it down
    body = { agents: [] };
    await paintRemoved();
    out.firstMsg = (document.getElementById('removed-msg') || {}).textContent || '';
    // 0b. the same failure painted from another screen (the agent page, Settings) writes nothing there
    document.getElementById('removed-msg').textContent = '';
    const bar = document.getElementById('boardbar');
    bar.hidden = true;
    await paintRemoved();
    out.offTabMsg = (document.getElementById('removed-msg') || {}).textContent || '';
    bar.hidden = false;
    await paintRemoved();
    // 1. leftovers alone
    body = { agents: [], leftovers: [{ name: 'stray-7825', shownAs: 'Stray' }] };
    await paintRemoved();
    if (list.hidden) toggle.click();
    await new Promise((res) => setTimeout(res, 30));
    out.alone = snap();
    out.aloneMsg = (document.getElementById('removed-msg') || {}).textContent || '';
    out.aloneListHidden = list.hidden;
    // 4. the door (from the leftovers-alone state, list open)
    const btn = list.querySelector('[data-delete-leftover="stray-7825"]');
    if (btn) { btn.click(); await new Promise((res) => setTimeout(res, 60)); }
    out.planAsked = planAsked;
    out.msg = (document.getElementById('removed-msg') || {}).textContent || '';
    out.modalOpen = !((document.getElementById('del-modal') || { hidden: true }).hidden);
    // 2. mixed with a removed row
    body = { agents: [{ name: 'gone-7825', shownAs: 'Gone', removedAt: '2026-11-02T00:00:00Z', stopped: true, accountFolderGone: false }],
      leftovers: [{ name: 'stray-7825', shownAs: 'Stray' }] };
    await paintRemoved();
    out.mixed = snap();
    // 2b. kosmos#8471: a Windows task left with its settings and no folder says its startup job is left too
    body = { agents: [], leftovers: [{ name: 'stray-7825', shownAs: 'Stray' }, { name: 'task-8471', shownAs: 'Tasked', startsAtLogin: true }] };
    await paintRemoved();
    out.task = snap();
    // 3. a failed leftovers read (field absent) keeps the rows last drawn
    body = { agents: [{ name: 'gone-7825', shownAs: 'Gone', removedAt: '2026-11-02T00:00:00Z', stopped: true, accountFolderGone: false }] };
    await paintRemoved();
    out.failed = snap();
    // 3b. a board that keeps answering without the field for over a minute: rows kept, and the list says so
    LEFTOVERS_AT = Date.now() - 61000;
    await paintRemoved();
    out.expired = snap();
    // 3c. a name just deleted is not drawn again from the kept rows
    body = { agents: [], leftovers: [{ name: 'stray-7825', shownAs: 'Stray' }] };
    await paintRemoved();
    openDeleteModal({ ok: true, name: 'stray-7825', shown: 'Stray', question: 'Delete what is left of Stray?', reassurance: '', loses: [], verb: 'Move its settings to the Trash', typeToConfirm: null });
    // After the delete the board's next leftovers read fails (field absent): the repaint the handler does, and the next.
    body = { agents: [{ name: 'gone-7825', shownAs: 'Gone', removedAt: '2026-11-02T00:00:00Z', stopped: true, accountFolderGone: false }] };
    document.getElementById('del-go').click();
    await new Promise((res) => setTimeout(res, 80));
    await paintRemoved();
    out.afterDelete = snap();
    // 4. NEGATIVE: nothing removed and nothing left over
    body = { agents: [], leftovers: [] };
    await paintRemoved();
    out.none = snap();
    return out;
  });

  let bad = 0;
  const check = (ok, label, extra) => { say(ok, label, extra); if (!ok) bad += 1; };
  if (r.error) { check(false, 'render-settings-leftover-7825: ' + r.error); await browser.close(); process.exit(1); }

  check(/could not check for agents with only their settings left/.test(r.firstMsg), 'first load with the leftovers read failing says so, never reads as none', r.firstMsg);
  check(r.offTabMsg === '', 'off the Agents tab the failure writes nothing into the shared line', r.offTabMsg);
  check(!/could not check for agents with only their settings left/.test(r.aloneMsg), 'a good read takes that sentence down', r.aloneMsg);
  const a = r.alone;
  check(!a.wrapHidden && !r.aloneListHidden, 'leftovers alone: the removed section shows and opens', JSON.stringify({ wrap: a.wrapHidden, list: r.aloneListHidden }));
  check(a.label === 'Show what is left of past agents (1)', 'leftovers alone: the label does not call it removed, and counts it', a.label);
  const row = a.rows[0] || {};
  check(a.rows.length === 1 && row.who === 'Stray', 'leftovers alone: one row, by its shown name', JSON.stringify(a.rows));
  check(row.when === 'Only its settings are left', 'leftovers alone: the row says only its settings are left', row.when);
  check(row.del === 'stray-7825' && row.delText === 'Delete what is left…', 'leftovers alone: the delete door acts on the name', JSON.stringify(row));
  check(row.restore === false, 'leftovers alone: no Restore (there is nothing to restore)');
  check(a.hint === false, 'leftovers alone: no folder hint (it is false for these rows)');

  check(typeof r.planAsked === 'string' && r.planAsked.indexOf('/api/agent/stray-7825/leftover') !== -1, 'the door fetches the plan for that name', String(r.planAsked));
  check(/waiting to start/.test(r.msg) && !r.modalOpen, 'a refused plan is painted as a sentence under the list, not a modal', JSON.stringify({ msg: r.msg, modal: r.modalOpen }));

  const m = r.mixed;
  check(m.label === 'Show removed agents and what is left of others (2)', 'mixed: the label names both and counts both', m.label);
  const gone = m.rows.find((x) => x.who === 'Gone') || {};
  const stray = m.rows.find((x) => x.who === 'Stray') || {};
  check(gone.restore === true && stray.restore === false, 'mixed: Restore on the removed row only', JSON.stringify(m.rows));
  check(m.hint === true && m.hintAfterRemoved === 1, 'mixed: the folder hint stays with the removed rows, before the leftovers', String(m.hintAfterRemoved));

  const tasked = r.task.rows.find((x) => x.who === 'Tasked') || {};
  const plain = r.task.rows.find((x) => x.who === 'Stray') || {};
  check(tasked.when === 'Its settings and its startup job are left' && tasked.del === 'task-8471', 'kosmos#8471: a task left with its settings says so and has the delete door', JSON.stringify(tasked));
  check(plain.when === 'Only its settings are left', 'kosmos#8471: beside it, a settings-only row still says only its settings', JSON.stringify(plain));

  check(r.failed.rows.some((x) => x.who === 'Stray') && r.failed.rows.some((x) => x.who === 'Gone'), 'a failed leftovers read keeps the leftover rows last drawn', JSON.stringify(r.failed.rows));
  check(r.failed.stale === false, 'a fresh failed read keeps the rows without a stale line');
  check(r.expired.rows.some((x) => x.who === 'Stray') && r.expired.stale === true, 'a minute without the field keeps the rows and says they may be out of date (never reads as none)', JSON.stringify(r.expired));
  check(!r.afterDelete.rows.some((x) => x.who === 'Stray'), 'a name just deleted is not drawn again from the kept rows', JSON.stringify(r.afterDelete.rows));
  check(r.none.wrapHidden === true, 'NEGATIVE: nothing removed and nothing left over hides the section', JSON.stringify(r.none));

  await browser.close();
  console.log(bad ? `render-settings-leftover-7825: ${bad} problem(s)` : 'render-settings-leftover-7825: all clear');
  process.exit(bad ? 1 : 0);
})();

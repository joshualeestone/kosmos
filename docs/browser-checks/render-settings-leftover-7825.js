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
 * both and the hint stays with the removed rows; a Windows task still registered with no folder says its startup job is
 * still set up and its folder is not found, never only its settings (kosmos#8475); the field absent (the board could not read it)
 * keeps the rows last drawn; nothing removed and nothing left over hides the section (NEGATIVE); the door fetches the
 * plan and paints a refusal under the list. kosmos#8477: the delete sends what the dialog on screen promised (its plan's
 * `confirm`, not a fresher plan read meanwhile), and a refusal because what is left changed repaints the dialog with
 * the new plan and the board's sentence, Delete on again only for that new plan.
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
    let pagePlan = null;
    let deleteSent = null;     // kosmos#8477: the last DELETE's body
    let deleteAnswer = null;   // kosmos#8477: a refusal to answer the next DELETE with
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      if (url.indexOf('/api/removed') !== -1) return Promise.resolve({ ok: true, json: async () => body });
      if (url.indexOf('/leftover') !== -1 && opts && opts.method === 'DELETE') {
        try { deleteSent = JSON.parse(opts.body); } catch { deleteSent = 'unreadable'; }
        if (deleteAnswer) { const a = deleteAnswer; deleteAnswer = null; return Promise.resolve({ ok: false, json: async () => a }); }
        return Promise.resolve({ ok: true, json: async () => ({ outcome: 'deleted', said: 'Stray\'s settings are in the Trash. The name is free.' }) });
      }
      if (url.indexOf('/leftover') !== -1 && pagePlan) return Promise.resolve({ ok: true, json: async () => pagePlan });   // kosmos#8475 arm 5
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
    // 2b. kosmos#8475: a Windows task still registered with no folder, beside a settings-only row
    body = { agents: [], leftovers: [{ name: 'stray-7825', shownAs: 'Stray' }, { name: 'task-8475', shownAs: 'Tasked', startsAtLogin: true }] };
    await paintRemoved();
    out.task = snap();
    // 2c. kosmos#8475: a task-only plan brings its own cancel words; the next plan without them gets the usual ones back
    openDeleteModal({ ok: true, name: 'task-8475', shown: 'Tasked', question: 'Remove Tasked\'s startup job?', reassurance: '', loses: [], verb: 'Remove its startup job', keep: 'Keep its startup job', typeToConfirm: null });
    out.keepTask = document.getElementById('del-keep').textContent;
    closeDeleteModal();
    openDeleteModal({ ok: true, name: 'stray-7825', shown: 'Stray', question: 'Delete what is left of Stray?', reassurance: '', loses: [], verb: 'Move its settings to the Trash', typeToConfirm: null });
    out.keepPlain = document.getElementById('del-keep').textContent;
    closeDeleteModal();
    // 3. a failed leftovers read (field absent) keeps the rows last drawn
    body = { agents: [{ name: 'gone-7825', shownAs: 'Gone', removedAt: '2026-11-02T00:00:00Z', stopped: true, accountFolderGone: false }] };
    await paintRemoved();
    out.failed = snap();
    // 3b. a board that keeps answering without the field for over a minute: rows kept, and the list says so
    LEFTOVERS_AT = Date.now() - 61000;
    await paintRemoved();
    out.expired = snap();
    // 3d. kosmos#8477: the startup job alone was shown; the board found the folder back, so it refuses and sends the new plan
    const changedPlan = { ok: true, name: 'task-8475', shown: 'Tasked', question: 'Delete what is left of Tasked?', reassurance: 'Its files go to the Recycle Bin.', loses: ['Its folder: 3 files'], verb: 'Move 3 files to the Recycle Bin', typeToConfirm: null, confirm: '1.after8477' };
    openDeleteModal({ ok: true, name: 'task-8475', shown: 'Tasked', taskOnly: true, question: 'Remove Tasked\'s startup job?', reassurance: '', loses: [], verb: 'Remove its startup job', keep: 'Keep its startup job', typeToConfirm: null, confirm: '1.before8477' });
    deleteAnswer = { outcome: 'refused', changed: true, because: 'What Kosmos would do here is different now, so nothing was deleted. Look at what it says now before deleting.', plan: changedPlan };
    document.getElementById('del-go').click();
    await new Promise((res) => setTimeout(res, 80));
    out.changed = {
      sent: deleteSent && deleteSent.confirmed,
      open: !document.getElementById('del-modal').hidden,
      title: document.getElementById('del-title').textContent,
      verb: document.getElementById('del-go').textContent,
      goOff: document.getElementById('del-go').disabled,
      msg: document.getElementById('del-msg').textContent,
    };
    // review 1: a click right after the repaint (the second of a double click) sends nothing; after the pause Delete is on.
    deleteSent = null;
    document.getElementById('del-go').click();
    await new Promise((res) => setTimeout(res, 80));
    out.changed.sentAtOnce = deleteSent;
    await new Promise((res) => setTimeout(res, 1100));
    out.changed.goOffAfterPause = document.getElementById('del-go').disabled;
    // A click now confirms the plan on screen: the new one.
    document.getElementById('del-go').click();
    await new Promise((res) => setTimeout(res, 80));
    out.changed.sentAgain = deleteSent && deleteSent.confirmed;
    closeDeleteModal();
    // 3e. kosmos#8477 review 1: the dialog asks for the name; a fresher read replaces DEL_PLAN with a plan asking none.
    // Typing the name the dialog shows still turns Delete on.
    openDeleteModal({ ok: true, name: 'stray-7825', shown: 'Stray', question: 'Delete what is left of Stray?', reassurance: '', loses: [], verb: 'Delete its settings for good', typeToConfirm: 'Stray', confirm: '2.typed8477' });
    DEL_PLAN = { ...DEL_PLAN, typeToConfirm: null };
    const typedBox = document.getElementById('del-typed');
    typedBox.value = 'Stray';
    typedBox.dispatchEvent(new Event('input', { bubbles: true }));
    out.typedOn = !document.getElementById('del-go').disabled;
    closeDeleteModal();
    // 3f. kosmos#8477 review 2: the dialog asks for no name; the poll stores the same plan now asking for one (its folder
    // went out of sight), and the board refuses for the name. The dialog shows the box to type it in.
    const noName = { ok: true, name: 'task-8475', shown: 'Tasked', taskOnly: true, question: 'Remove Tasked\'s startup job?', reassurance: '', loses: [], verb: 'Remove its startup job', keep: 'Keep its startup job', typeToConfirm: null, confirm: '2.same8477' };
    openDeleteModal(noName);
    DEL_PLAN = { ...noName, typeToConfirm: 'Tasked' };
    deleteAnswer = { outcome: 'refused', because: 'type Tasked to confirm; nothing was deleted', plan: { ...noName, typeToConfirm: 'Tasked' } };
    document.getElementById('del-go').click();
    await new Promise((res) => setTimeout(res, 80));
    out.nameAsked = { rowHidden: document.getElementById('del-type-row').hidden, goOff: document.getElementById('del-go').disabled, msg: document.getElementById('del-msg').textContent };
    closeDeleteModal();
    // 3g. kosmos#8477 review 3: the other two repaints (a delete with no answer, and a delete that was running ending)
    // also hold Delete off for the pause when what the plan promises changed, and only then.
    const goOff = () => document.getElementById('del-go').disabled;
    out.repaints = {};
    openDeleteModal({ ...noName, confirm: '3.a8477' });
    deleteNoAnswerShow({ ...noName, confirm: '3.a8477' }, 'task-8475', DEL_SHOWN);
    out.repaints.noAnswerSame = goOff();
    deleteNoAnswerShow({ ...noName, question: 'Delete what is left of Tasked?', confirm: '3.b8477' }, 'task-8475', DEL_SHOWN);
    out.repaints.noAnswerChanged = goOff();
    // review 4: a second repaint with the same plan inside the pause keeps Delete off.
    deleteNoAnswerShow({ ...noName, question: 'Delete what is left of Tasked?', confirm: '3.b8477' }, 'task-8475', DEL_SHOWN);
    out.repaints.secondInsidePause = goOff();
    await new Promise((res) => setTimeout(res, 1100));
    out.repaints.noAnswerAfter = goOff();
    // review 5: a pause running when another tab's delete of this agent starts: Delete stays off after the pause ends.
    deleteNoAnswerShow({ ...noName, question: 'Delete what is left of Tasked?', confirm: '3.d8477' }, 'task-8475', DEL_SHOWN);
    paintLeftoverRunning({ ok: false, running: true, because: 'a delete of what is left of this agent is running now; try again when it has finished' }, 'task-8475');
    await new Promise((res) => setTimeout(res, 1100));
    out.repaints.runningAfterPause = goOff();
    DEL_RUNNING_FOR = null;
    closeDeleteModal();
    openDeleteModal({ ...noName, confirm: '3.a8477' });
    DEL_RUNNING_FOR = 'task-8475';
    CURRENT = { sessionName: 'task-8475' };
    pagePlan = { ...noName, question: 'Delete what is left of Tasked?', confirm: '3.c8477' };
    await loadLeftover('task-8475');
    out.repaints.runningEnded = goOff();
    out.repaints.runningEndedTitle = document.getElementById('del-title').textContent;
    pagePlan = null;
    CURRENT = null;
    closeDeleteModal();
    // 3c. a name just deleted is not drawn again from the kept rows
    body = { agents: [], leftovers: [{ name: 'stray-7825', shownAs: 'Stray' }] };
    await paintRemoved();
    openDeleteModal({ ok: true, name: 'stray-7825', shown: 'Stray', question: 'Delete what is left of Stray?', reassurance: '', loses: [], verb: 'Move its settings to the Trash', typeToConfirm: null, confirm: '1.shown8477' });
    // kosmos#8477: a detail page's fresher read replaces DEL_PLAN while the dialog still shows the plan above.
    DEL_PLAN = { ...DEL_PLAN, confirm: '1.fresher8477' };
    // After the delete the board's next leftovers read fails (field absent): the repaint the handler does, and the next.
    body = { agents: [{ name: 'gone-7825', shownAs: 'Gone', removedAt: '2026-11-02T00:00:00Z', stopped: true, accountFolderGone: false }] };
    document.getElementById('del-go').click();
    await new Promise((res) => setTimeout(res, 80));
    await paintRemoved();
    out.afterDelete = snap();
    out.sentShown = deleteSent && deleteSent.confirmed;
    // 4. NEGATIVE: nothing removed and nothing left over
    body = { agents: [], leftovers: [] };
    await paintRemoved();
    out.none = snap();
    // 5. kosmos#8475: the agent page's delete block over a task-only plan names the startup job; over a files plan, files
    const pageButton = async (plan) => {
      pagePlan = plan;
      CURRENT = { sessionName: plan.name };
      await loadLeftover(plan.name);
      const b = document.getElementById('d-delete-start');
      return { text: b ? b.textContent : null, hint: (document.getElementById('d-delete-hint') || {}).textContent || '' };
    };
    out.pageTask = await pageButton({ ok: true, name: 'task-8475', shown: 'Tasked', taskOnly: true, hint: 'Something on this computer still starts Tasked when you log in.', verb: 'Remove its startup job' });
    out.pageFiles = await pageButton({ ok: true, name: 'files-8475', shown: 'Filed', hint: 'Filed\'s folder is still on this computer.', verb: 'Move 3 files to the Recycle Bin' });
    pagePlan = null;
    CURRENT = null;
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
  // kosmos#8475: a removed row's click can be its files, its settings or only its startup job, so its label claims none.
  check(gone.delText === 'Delete what is left…' && gone.del === 'gone-7825', 'kosmos#8475: a removed row\'s delete button does not promise files', JSON.stringify(gone));
  check(m.hint === true && m.hintAfterRemoved === 1, 'mixed: the folder hint stays with the removed rows, before the leftovers', String(m.hintAfterRemoved));

  const tasked = r.task.rows.find((x) => x.who === 'Tasked') || {};
  const plain = r.task.rows.find((x) => x.who === 'Stray') || {};
  check(tasked.when === 'Its startup job is still set up, but Kosmos cannot find its folder' && tasked.del === 'task-8475' && tasked.restore === false, 'kosmos#8475: a task left with no folder says its startup job is still set up and has the delete door', JSON.stringify(tasked));
  check(tasked.delText === 'Remove its startup job…', 'kosmos#8475: its button says it removes the startup job, not "what is left"', tasked.delText);
  check(r.pageTask.text === 'Remove its startup job…' && r.pageTask.hint === 'Something on this computer still starts Tasked when you log in.', 'kosmos#8475: the agent page names the startup job over a task-only plan', JSON.stringify(r.pageTask));
  check(r.pageFiles.text === 'Delete its files…', 'kosmos#8475: and its files again over a plan that moves files', JSON.stringify(r.pageFiles));
  check(r.keepTask === 'Keep its startup job' && r.keepPlain === 'Keep the files', 'kosmos#8475: the cancel button takes a task-only plan\'s words, and the usual ones come back after', JSON.stringify({ task: r.keepTask, plain: r.keepPlain }));
  check(plain.when === 'Only its settings are left', 'kosmos#8475: beside it, a settings-only row still says only its settings', JSON.stringify(plain));

  check(r.failed.rows.some((x) => x.who === 'Stray') && r.failed.rows.some((x) => x.who === 'Gone'), 'a failed leftovers read keeps the leftover rows last drawn', JSON.stringify(r.failed.rows));
  check(r.failed.stale === false, 'a fresh failed read keeps the rows without a stale line');
  check(r.expired.rows.some((x) => x.who === 'Stray') && r.expired.stale === true, 'a minute without the field keeps the rows and says they may be out of date (never reads as none)', JSON.stringify(r.expired));
  check(!r.afterDelete.rows.some((x) => x.who === 'Stray'), 'a name just deleted is not drawn again from the kept rows', JSON.stringify(r.afterDelete.rows));
  check(r.sentShown === '1.shown8477', 'kosmos#8477: the delete sends what the dialog on screen promised, not a fresher plan read meanwhile', String(r.sentShown));
  const ch = r.changed || {};
  check(ch.sent === '1.before8477', 'kosmos#8477: the delete sends the shown plan\'s confirm', String(ch.sent));
  check(ch.open && ch.title === 'Delete what is left of Tasked?' && ch.verb === 'Move 3 files to the Recycle Bin' && /different now/.test(ch.msg),
    'kosmos#8477: a refusal because what is left changed repaints the dialog with the new plan and says so', JSON.stringify(ch));
  check(ch.goOff === true && ch.sentAtOnce === null, 'kosmos#8477 review 1: right after the repaint Delete is off, so a double click\'s second click confirms nothing', JSON.stringify(ch));
  check(ch.goOffAfterPause === false && ch.sentAgain === '1.after8477', 'kosmos#8477: after the pause Delete is on, and now confirms the new plan', JSON.stringify(ch));
  check(r.nameAsked && r.nameAsked.rowHidden === false && r.nameAsked.goOff === true && /type Tasked/.test(r.nameAsked.msg),
    'kosmos#8477 review 2: a refusal asking for a name the dialog on screen did not ask for shows the box, whatever the poll stored meanwhile', JSON.stringify(r.nameAsked));
  const rp = r.repaints || {};
  check(rp.noAnswerSame === false && rp.noAnswerChanged === true && rp.noAnswerAfter === false,
    'kosmos#8477 review 3: a no-answer repaint holds Delete off for the pause only when what the plan promises changed', JSON.stringify(rp));
  check(rp.runningAfterPause === true, 'kosmos#8477 review 5: a delete of this agent started elsewhere during the pause keeps Delete off after it', JSON.stringify(rp));
  check(rp.secondInsidePause === true, 'kosmos#8477 review 4: a second repaint with the same plan inside the pause keeps Delete off', JSON.stringify(rp));
  check(rp.runningEnded === true && rp.runningEndedTitle === 'Delete what is left of Tasked?',
    'kosmos#8477 review 3: a running delete that ended repaints the dialog with Delete held off', JSON.stringify(rp));
  check(r.typedOn === true, 'kosmos#8477 review 1: typing the name the dialog shows turns Delete on, whatever a fresher plan read meanwhile asks', String(r.typedOn));
  check(r.none.wrapHidden === true, 'NEGATIVE: nothing removed and nothing left over hides the section', JSON.stringify(r.none));

  await browser.close();
  console.log(bad ? `render-settings-leftover-7825: ${bad} problem(s)` : 'render-settings-leftover-7825: all clear');
  process.exit(bad ? 1 : 0);
})();

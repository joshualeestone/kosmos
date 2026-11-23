'use strict';
/* kosmos#8938 item 4: an outside invite refused from a remote session for want of a fresh Kosmos+ sign-in leaves one
   note in this tab (the #8728 note, of its own kind); back from the fresh sign-in, the page opens that project's invite
   sheet with who it is for and person or agent filled in, and never makes the code by itself. Also Renet's nit on
   #8942: a company line's own closing full stop is not doubled into ".;". The functions are lifted from the page. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function page({ projects = ['p1'], loaded = true, fed = true, visible = [], storage = new Map(), stayOff = false, dialogs = [], covers = [], archived = [] } = {}) {
  const calls = [];
  const els = { 'fedinv-modal': { hidden: true }, 'fedinv-msg': { textContent: '' } };
  for (const id of ['acct-add-modal', 'firstrun', 'fr-choice']) els[id] = { hidden: !visible.includes(id) };
  const sessionStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
  };
  // .rm-back dialogs: the invite sheet itself plus any the arm puts on screen (dialogs: ids shown).
  const rmBack = () => [els['fedinv-modal'], ...dialogs.map((id) => ({ id, hidden: false }))];
  const listeners = [];
  const document = {
    getElementById: (id) => els[id] || null,
    // The page's one busy selector: its first part is the .rm-back test; `covers` stands for the rest (an update screen...).
    querySelector: (sel) => (sel.startsWith('.rm-back:not([hidden]):not([hidden] *), ') ? (rmBack().find((el) => !el.hidden) || (covers.length ? {} : null)) : null),
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i > -1) listeners.splice(i, 1); },
  };
  const performance = { timeOrigin: Date.now() };
  const state = { loaded, fed, current: null };
  const timers = [];
  const src = [
    SCRIPT.match(/const STEPUP_RETURN_KEY = [^;]*;/)[0],
    SCRIPT.match(/const STEPUP_RETURN_MS = [^;]*;/)[0],
    SCRIPT.match(/const STEPUP_RETURN_FOR = [^;]*;/)[0],
    SCRIPT.match(/const STEPUP_RETURN_FED_FOR = [^;]*;/)[0],
    SCRIPT.match(/const FEDINV_RETURN_LINE = [^;]*;/)[0],
    SCRIPT.match(/const FEDINV_RETURN_READ_MAX = [^;]*;/)[0],
    SCRIPT.match(/let FEDINV_RETURN_READS = [^;]*;/)[0],
    SCRIPT.match(/let FEDINV_RETURN_READING = [^;]*;/)[0],
    SCRIPT.match(/let FEDINV_RETURN_TOUCHED = [^;]*;/)[0],
    lift(SCRIPT, 'fedInviteReturnTouched'),
    lift(SCRIPT, 'noteFedInviteReturn'), lift(SCRIPT, 'noteStepUpReturn'), lift(SCRIPT, 'forgetStepUpReturn'), lift(SCRIPT, 'forgetStepUpReturnOfKind'), lift(SCRIPT, 'forgetFedInviteReturn'), lift(SCRIPT, 'forgetClaudeSignInReturn'),
    lift(SCRIPT, 'fedInviteReturnBusy'),
    lift(SCRIPT, 'stepUpNoteShaped'), lift(SCRIPT, 'markStepUpReturnGoing'), lift(SCRIPT, 'peekStepUpReturn'),
    lift(SCRIPT, 'stepUpReturnBusy'), lift(SCRIPT, 'resumeStepUpReturn'), lift(SCRIPT, 'resumeFedInviteReturn'),
    lift(SCRIPT, 'fedInviteReturnWait'), lift(SCRIPT, 'stepUpReturnBoot'),
    'return { forgetFedInviteReturn, forgetClaudeSignInReturn, noteFedInviteReturn, noteStepUpReturn, markStepUpReturnGoing, resumeFedInviteReturn, resumeStepUpReturn, fedInviteReturnWait, stepUpReturnBoot, KEY: STEPUP_RETURN_KEY, LINE: FEDINV_RETURN_LINE };',
  ].join('\n');
  // PJ_LOADED_ONCE and PJ_CURRENT are read as globals by the page: given here as getters on `with`-free parameters.
  const wrapped = 'return (function () { ' + src + ' })();';
  const fns = new Function('sessionStorage', 'document', 'performance', 'setTimeout', 'fetch', 'ACCOUNTS', 'openAcctReauth', 'fedShow', 'pjById',
    'openProject', 'fedInviteOpen', 'showTab', 'loadProjects', 'env',
    'with (env) { ' + wrapped + ' }')(
    sessionStorage, document, performance, (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    () => { calls.push(['fetch']); return Promise.resolve({ ok: false }); }, [], () => calls.push(['reauth']),
    () => state.fed, (id) => (projects.includes(id) ? { id, archived: archived.includes(id) } : null),
    (id) => { calls.push(['openProject', id]); if (!stayOff) state.current = id; },
    (opener, prefill) => { calls.push(['fedInviteOpen', opener, prefill]); els['fedinv-modal'].hidden = false; els['fedinv-msg'].textContent = ''; },
    (tab) => calls.push(['showTab', tab]),
    () => { calls.push(['loadProjects']); if (state.readLands) state.loaded = true; return Promise.resolve(true); },
    { get PJ_LOADED_ONCE() { return state.loaded; }, get PJ_CURRENT() { return state.current; } });
  return { ...fns, storage, calls, els, state, timers, performance, listeners };
}

// A note written, and its Sign in again pressed, before this page view began.
function earlier(p, extra = {}, ago = 60 * 1000) {
  const at = p.performance.timeOrigin - ago;
  p.storage.set(p.KEY, JSON.stringify({ kind: 'fed-invite', project: 'p1', label: 'Dana', invitedKind: 'agent', at, went: at + 1000, ...extra }));
}

test('#8938 item 4: back from Sign in again, the project and its invite sheet open with the name and kind filled in, once', () => {
  const p = page();
  earlier(p);
  assert.equal(p.resumeFedInviteReturn(), true);
  assert.deepEqual(p.calls, [['showTab', 'projects'], ['openProject', 'p1'], ['fedInviteOpen', null, { label: 'Dana', kind: 'agent' }]]);
  assert.equal(p.els['fedinv-msg'].textContent, 'Your invitation is filled in again. Press Make an invite code.');
  // As #8728 review 3: a log-out can fail and the person reload, so the words never claim a sign-in.
  assert.doesNotMatch(p.LINE, /signed in/i);
  assert.equal(p.storage.has(p.KEY), false, 'removed when acted on');
  p.resumeFedInviteReturn();
  assert.equal(p.calls.length, 3, 'a second try opens nothing more');
  assert.ok(!p.calls.some((c) => c[0] === 'fetch'), 'nothing is sent: the code is never made by itself');
});

test('#8938 item 4: the note holds only project, who it is for, the kind and when; no email, no code', () => {
  const p = page();
  p.noteFedInviteReturn('p1', 'x'.repeat(120), 'person');
  const n = JSON.parse(p.storage.get(p.KEY));
  assert.deepEqual(Object.keys(n).sort(), ['at', 'invitedKind', 'kind', 'label', 'project']);
  assert.equal(n.label.length, 80, 'the sheet\'s own limit');
  // Bad input writes nothing.
  for (const args of [['', 'Dana', 'person'], ['p1', '', 'person'], ['p1', 'Dana', 'robot'], [null, 'Dana', 'agent']]) {
    const q = page();
    q.noteFedInviteReturn(...args);
    assert.equal(q.storage.has(q.KEY), false, 'noted from ' + JSON.stringify(args));
  }
});

test('#8938 item 4: only Sign in again pressed for the invite marks the invite note; the Claude start does not, nor the reverse', () => {
  const p = page();
  p.noteFedInviteReturn('p1', 'Dana', 'person');
  for (const other of ['POST /api/connect/start', 'POST /api/agents', '', undefined]) p.markStepUpReturnGoing(other);
  assert.equal(JSON.parse(p.storage.get(p.KEY)).went, undefined, 'another refusal marked the invite note');
  // CONTROL: the invite's own refusal does mark it, and keeps every field.
  p.markStepUpReturnGoing('POST /api/federation/invite');
  const n = JSON.parse(p.storage.get(p.KEY));
  assert.equal(typeof n.went, 'number');
  assert.deepEqual([n.kind, n.project, n.label, n.invitedKind], ['fed-invite', 'p1', 'Dana', 'person']);
  // The reverse: a Claude note is not marked by the invite's press.
  const c = page();
  c.noteStepUpReturn('/Users/someone/.claude');
  c.markStepUpReturnGoing('POST /api/federation/invite');
  assert.equal(JSON.parse(c.storage.get(c.KEY)).went, undefined);
});

test('#8938 item 4: in the SAME page view, or never pressed, the note opens nothing and is kept', () => {
  const p = page();
  p.noteFedInviteReturn('p1', 'Dana', 'person');
  p.markStepUpReturnGoing('POST /api/federation/invite');   // pressed now: the sign-in has not navigated back yet
  p.resumeFedInviteReturn();
  assert.deepEqual(p.calls, []);
  assert.equal(p.storage.has(p.KEY), true);
  const q = page();
  earlier(q, { went: undefined });
  q.resumeFedInviteReturn();
  assert.deepEqual(q.calls, [], 'a reload with no press opened the sheet');
});

test('#8938 item 4: not ready yet (projects not read, inviting off, a dialog up) waits and keeps the note; then acts', () => {
  for (const setup of [{ loaded: false }, { fed: false }, { visible: ['acct-add-modal'] }, { visible: ['firstrun'] }, { dialogs: ['am-modal'] }, { dialogs: ['whatsnew'] }, { covers: ['.upd-back'] }]) {
    const p = page(setup);
    earlier(p);
    assert.equal(p.resumeFedInviteReturn(), false, 'did not wait for ' + JSON.stringify(setup));
    assert.deepEqual(p.calls.filter((c) => c[0] !== 'loadProjects'), [], 'acted before ready: ' + JSON.stringify(setup));
    assert.equal(p.storage.has(p.KEY), true, 'lost the note while ' + JSON.stringify(setup));
  }
  // The wait tries again on a timer, and acts once the page is ready.
  const p = page({ loaded: false });
  earlier(p);
  p.fedInviteReturnWait();
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, 500);
  p.state.loaded = true;
  p.timers[0].fn();
  assert.deepEqual(p.calls.map((c) => c[0]).filter((c) => c !== 'loadProjects'), ['showTab', 'openProject', 'fedInviteOpen']);
  assert.equal(p.timers.length, 1, 'no further try after it acted');
  // It gives up after 60 tries, keeping the note.
  const never = page({ fed: false });
  earlier(never);
  never.fedInviteReturnWait();
  let scheduled = 0;
  while (never.timers.length) { scheduled++; const t = never.timers.shift(); t.fn(); if (scheduled > 100) break; }
  assert.equal(scheduled, 59, '60 tries in all: one now and 59 on the timer');
  assert.equal(never.storage.has(never.KEY), true);
});

test('#8938 item 4: projects not read yet (the tab layout reads them only on Projects): the return asks for the read, one at a time, at most 3 times', async () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const p = page({ loaded: false });
  earlier(p);
  p.resumeFedInviteReturn();
  p.resumeFedInviteReturn();   // the first read is still being answered: no second one
  await flush();
  assert.deepEqual(p.calls, [['loadProjects']], 'asked again while a read was in flight, or opened before it landed');
  // Each read concludes without the list (a failed read): asked again, up to 3 in all, then no more.
  for (let i = 0; i < 5; i++) { p.resumeFedInviteReturn(); await flush(); }
  assert.equal(p.calls.filter((c) => c[0] === 'loadProjects').length, 3, 'a failed read was not retried, or retried without a cap');
  assert.equal(p.storage.has(p.KEY), true, 'the note was lost while waiting');
  // A read that lands: the next try opens the sheet.
  const q = page({ loaded: false });
  q.state.readLands = true;
  earlier(q);
  q.resumeFedInviteReturn();
  await flush();
  q.resumeFedInviteReturn();
  assert.deepEqual(q.calls.map((c) => c[0]), ['loadProjects', 'showTab', 'openProject', 'fedInviteOpen']);
  // CONTROL: a dialog up asks for nothing (it waits whole).
  const busy = page({ loaded: false, visible: ['firstrun'] });
  earlier(busy);
  busy.resumeFedInviteReturn();
  await flush();
  assert.deepEqual(busy.calls, []);
});

test('#8938 item 4 review: an invite attempt forgets only an invite note, never a Claude sign-in note', () => {
  const p = page();
  p.noteStepUpReturn('/Users/someone/.claude');
  p.forgetFedInviteReturn();
  assert.equal(JSON.parse(p.storage.get(p.KEY)).kind, 'claude-signin', 'an invite attempt erased the Claude note');
  // CONTROL: an invite note is forgotten.
  p.noteFedInviteReturn('p1', 'Dana', 'person');
  p.forgetFedInviteReturn();
  assert.equal(p.storage.has(p.KEY), false);
  p.storage.set(p.KEY, 'not json');
  p.forgetFedInviteReturn();   // unreadable: left to peekStepUpReturn, which removes it
  assert.equal(p.storage.get(p.KEY), 'not json');
  // review 3, the reverse: a Claude start forgets only a Claude note, never an invite's.
  const q = page();
  q.noteFedInviteReturn('p1', 'Dana', 'person');
  q.forgetClaudeSignInReturn();
  assert.equal(JSON.parse(q.storage.get(q.KEY)).kind, 'fed-invite', 'a Claude start erased the invite note');
  q.noteStepUpReturn('/Users/someone/.claude');
  q.forgetClaudeSignInReturn();
  assert.equal(q.storage.has(q.KEY), false, 'CONTROL: a Claude note is forgotten');
  // And the page wires both Claude starts to the kind-scoped forget.
  assert.doesNotMatch(SCRIPT.slice(SCRIPT.indexOf('async function acctAddStart('), SCRIPT.indexOf("await fetch('/api/connect/start'", SCRIPT.indexOf('async function acctAddStart('))), /forgetStepUpReturn\(\)/);
  assert.doesNotMatch(lift(SCRIPT, 'frConnectStartConfirmed'), /forgetStepUpReturn\(\)/);
});

test('#8938 item 4 review 2: the person pressed or typed after the page loaded: they moved on, so nothing opens and the note goes', () => {
  const p = page({ loaded: false });
  earlier(p);
  p.fedInviteReturnWait();
  assert.deepEqual(p.listeners.map((l) => [l.type, l.capture]), [['pointerdown', true], ['keydown', true]]);
  // A key inside first run, or a press inside an open dialog (closing it), is not a choice of where to go.
  const inside = { target: { closest: (sel) => (sel === '#firstrun, #fr-choice, .rm-back' ? {} : null) } };
  p.listeners[1].fn(inside);
  p.listeners[0].fn(inside);
  p.state.loaded = true;
  p.timers.shift().fn();
  assert.deepEqual(p.calls.map((c) => c[0]).filter((c) => c !== 'loadProjects'), ['showTab', 'openProject', 'fedInviteOpen'], 'a first-run key stopped the return');
  assert.deepEqual(p.listeners, [], 'the listeners stay after the wait ended');
  // review 4: a key while first run is up, with focus outside it (on the page), is about first run too.
  const r = page({ loaded: false, visible: ['firstrun'] });
  earlier(r);
  r.fedInviteReturnWait();
  r.listeners[1].fn({ target: { closest: () => null } });
  r.els.firstrun.hidden = true;
  r.state.loaded = true;
  r.timers.shift().fn();
  assert.deepEqual(r.calls.map((c) => c[0]).filter((c) => c !== 'loadProjects'), ['showTab', 'openProject', 'fedInviteOpen'], 'Escape from the page while first run was up dropped the return');
  // A press anywhere else: the return gives up and drops the note.
  const q = page({ loaded: false });
  earlier(q);
  q.fedInviteReturnWait();
  q.listeners[0].fn({ target: { closest: () => null } });
  q.state.loaded = true;
  q.timers.shift().fn();
  assert.deepEqual(q.calls.filter((c) => c[0] !== 'loadProjects'), [], 'opened over what the person had moved on to');
  assert.equal(q.storage.has(q.KEY), false, 'the note was kept for a later surprise');
  assert.deepEqual(q.listeners, []);
});

test('#8938 item 4: a project no longer listed, or one that did not open, opens no sheet; the note goes', () => {
  const gone = page({ projects: ['p2'] });
  earlier(gone);
  assert.equal(gone.resumeFedInviteReturn(), true);
  assert.deepEqual(gone.calls, []);
  assert.equal(gone.storage.has(gone.KEY), false);
  const arch = page({ archived: ['p1'] });
  earlier(arch);
  arch.resumeFedInviteReturn();
  assert.deepEqual(arch.calls, [], 'an archived project opened an invite sheet');
  assert.equal(arch.storage.has(arch.KEY), false);
  const stuck = page({ stayOff: true });
  earlier(stuck);
  stuck.resumeFedInviteReturn();
  assert.deepEqual(stuck.calls.map((c) => c[0]), ['showTab', 'openProject'], 'the sheet opened over another project');
});

test('#8938 item 4: an invite note is not an account note, and boot routes it to the wait (no account read)', () => {
  const p = page();
  earlier(p);
  p.resumeStepUpReturn([{ dir: 'p1' }]);
  assert.deepEqual(p.calls, [], 'the account return acted on an invite note');
  assert.equal(p.storage.has(p.KEY), true, 'and the note was lost');
  p.stepUpReturnBoot();
  assert.equal(p.timers.length, 1, 'the wait starts on a timer, after the whole script has run');
  p.timers.shift().fn();
  assert.ok(!p.calls.some((c) => c[0] === 'fetch'), 'boot read the account list for an invite note');
  assert.deepEqual(p.calls.map((c) => c[0]), ['showTab', 'openProject', 'fedInviteOpen']);
  // A note of the wrong invite shape is removed, as #8728's are.
  for (const bad of [{ invitedKind: 'robot' }, { project: '' }, { label: 'x'.repeat(81) }]) {
    const q = page();
    earlier(q, bad);
    q.resumeFedInviteReturn();
    assert.deepEqual(q.calls, []);
    assert.equal(q.storage.has(q.KEY), false, 'kept a bad note: ' + JSON.stringify(bad));
  }
});

test('#8938 item 4: the page wires it: the sheet notes only the refusal that offers Sign in again; Make and the create form clear older notes', () => {
  const make = lift(SCRIPT, 'fedInviteMake');
  assert.match(make, /res\.status === 403 && body && body\.code === 'remote_step_up' && body\.signInAgain === true && typeof noteFedInviteReturn === 'function'\) noteFedInviteReturn\(askedFor, label, kind\)/);
  assert.doesNotMatch(make, /forgetStepUpReturn\(/, 'Make erases any note, a Claude one too');
  const clear = make.indexOf('forgetFedInviteReturn();');
  assert.ok(clear > -1 && clear < make.indexOf("fetch('/api/federation/invite'"), 'Make does not clear an older note before its request');
  const mint = lift(SCRIPT, 'pjMintInvite');
  assert.doesNotMatch(mint, /forgetStepUpReturn\(/, 'the create form erases any note, a Claude one too');
  const mclear = mint.indexOf('forgetFedInviteReturn();');
  assert.ok(mclear > -1 && mclear < mint.indexOf("fetch('/api/federation/invite'"), 'the create form does not clear an older note');
  assert.doesNotMatch(mint, /noteFedInviteReturn/, 'the create form has no sheet to come back to');
  assert.equal(SCRIPT.match(/const STEPUP_RETURN_FED_FOR = '([^']*)';/)[1], 'POST /api/federation/invite');
  assert.equal((SCRIPT.match(/resumeFedInviteReturn\(/g) || []).length, 2, 'one definition and the one call in fedInviteReturnWait');
});

test('#8942 review nit: a company line ending in a full stop is not doubled into ".;"', () => {
  const fn = new Function(lift(SCRIPT, 'plusOrgSeesText') + '\nreturn plusOrgSeesText;')();
  const t = fn({ reports: ['Agent names.', 'Token use'], backsUp: ['Projects.'], never: ['Messages.', '  .  '] });
  assert.equal(t, 'Your company’s words for this computer. Reported: Agent names; Token use. May back up: Projects. Never sent: Messages.');
  assert.doesNotMatch(t, /\.;|\.\./);
  // Only ONE stop goes: an ellipsis keeps two.
  assert.match(fn({ reports: ['Usage...'] }), /Reported: Usage\.\.\.$/);
  assert.match(fn({ reports: ['Is usage sent?'] }), /Reported: Is usage sent\?$/, 'a "?" got a stop after it');
  assert.match(fn({ reports: ['Usage\u2026'] }), /Reported: Usage\u2026$/, 'a closing stop after an ellipsis character');
  assert.equal(fn({ reports: ['Usage...', 'Token use'] }), 'Your company\u2019s words for this computer. Reported: Usage...; Token use.', 'an ellipsis lost a dot mid-list');
  assert.equal(fn({ reports: ['Agent names .', 'Token use'] }), 'Your company\u2019s words for this computer. Reported: Agent names; Token use.', 'the space before a closing stop was left in front of the ";"');
});

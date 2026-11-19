'use strict';
/* kosmos#8728 slice 2: a Claude "Sign in again" refused from a remote session for want of a fresh Kosmos+ sign-in
   leaves one note in this tab; back from the fresh sign-in, the page reopens that account's dialog (and never starts a
   sign-in by itself). The functions are lifted from the page and run against a stand-in sessionStorage. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, lift } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function page({ accounts = [], storage = new Map(), throws = false, visible = [], fetchBody = null } = {}) {
  const opened = [];
  const fetched = [];
  const read = [];
  const els = { 'acct-add-note': { textContent: '' } };
  for (const id of ['acct-add-modal', 'firstrun', 'fr-choice']) els[id] = { hidden: !visible.includes(id) };
  const sessionStorage = {
    getItem: (k) => { if (throws) throw new Error('blocked'); return storage.has(k) ? storage.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error('blocked'); storage.set(k, String(v)); },
    removeItem: (k) => { if (throws) throw new Error('blocked'); storage.delete(k); },
  };
  const document = { getElementById: (id) => els[id] || null };
  const performance = { timeOrigin: Date.now() };   // this page view began now
  const fetch = (url) => { fetched.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve(fetchBody) }); };
  const src = [
    SCRIPT.match(/const STEPUP_RETURN_KEY = [^;]*;/)[0],
    SCRIPT.match(/const STEPUP_RETURN_MS = [^;]*;/)[0],
    'let ACCT_ADD_RETURN_FOCUS = "an older opener";',
    lift(SCRIPT, 'noteStepUpReturn'), lift(SCRIPT, 'forgetStepUpReturn'), lift(SCRIPT, 'markStepUpReturnGoing'), lift(SCRIPT, 'peekStepUpReturn'),
    lift(SCRIPT, 'stepUpReturnBusy'), lift(SCRIPT, 'resumeStepUpReturn'), lift(SCRIPT, 'stepUpReturnBoot'),
    'return { noteStepUpReturn, forgetStepUpReturn, markStepUpReturnGoing, peekStepUpReturn, resumeStepUpReturn, stepUpReturnBoot, KEY: STEPUP_RETURN_KEY, focus: () => ACCT_ADD_RETURN_FOCUS };',
  ].join('\n');
  const fns = new Function('sessionStorage', 'document', 'performance', 'fetch', 'ACCOUNTS', 'openAcctReauth', 'accountsRead', src)(
    sessionStorage, document, performance, fetch, accounts, (dir, email) => opened.push({ dir, email }), (list) => read.push(list));
  return { ...fns, storage, opened, els, fetched, read, performance };
}

const DIR = '/Users/someone/.claude-work';
const ACCOUNTS = [{ dir: DIR, email: 'someone@example.com' }, { dir: '/Users/someone/.claude', email: 'other@example.com' }];
// A note written, and its Sign in again pressed, before this page view began: the fresh sign-in navigated back here.
const earlier = (p, ago = 60 * 1000) => p.storage.set(p.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: p.performance.timeOrigin - ago, went: p.performance.timeOrigin - ago + 1000 }));

test('#8728 slice 2: after the page loads again, a remembered account reopens its own dialog once, then the note is gone', () => {
  const p = page({ accounts: ACCOUNTS });
  earlier(p);
  p.resumeStepUpReturn();
  assert.deepEqual(p.opened, [{ dir: DIR, email: 'someone@example.com' }]);
  assert.equal(p.els['acct-add-note'].textContent, 'Press Sign in again to sign this account in to Claude.');
  // review 3: a log-out can fail and the person reload, so the words never claim the Kosmos+ sign-in succeeded.
  assert.doesNotMatch(p.els['acct-add-note'].textContent, /signed in .*again|you signed in/i);
  assert.equal(p.focus(), null, 'focus has no older opener to return to');
  assert.equal(p.storage.has(p.KEY), false, 'removed when acted on');
  p.resumeStepUpReturn();
  assert.equal(p.opened.length, 1, 'a second account read does not reopen it');
});

test('#8728 slice 2 review 1: in the SAME page view the note never acts (no fresh sign-in has happened), and is kept', () => {
  const p = page({ accounts: ACCOUNTS });
  p.noteStepUpReturn(DIR);
  const kept = JSON.parse(p.storage.get(p.KEY));
  assert.deepEqual(Object.keys(kept).sort(), ['at', 'dir', 'kind'], 'the note holds only kind, dir and when: no code, no token');
  p.resumeStepUpReturn();   // a later account read in this view: Settings, an agent panel, a timer
  assert.deepEqual(p.opened, [], 'reopened the dialog with "you signed in again" before any sign-in');
  assert.equal(p.storage.has(p.KEY), true, 'kept for after the fresh sign-in');
});

test('#8728 slice 2 review 2: a reload WITHOUT pressing Sign in again opens nothing; a press in this same view opens nothing either', () => {
  const p = page({ accounts: ACCOUNTS });
  // Refused in an earlier view, never pressed, page reloaded: the note is older than the page but was never sent on.
  p.storage.set(p.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: p.performance.timeOrigin - 60 * 1000 }));
  p.resumeStepUpReturn();
  assert.deepEqual(p.opened, [], 'a reload alone said "you signed in again"');
  assert.equal(p.storage.has(p.KEY), true);
  // Pressed now, in this view: the sign-in has not navigated back yet.
  p.markStepUpReturnGoing();
  assert.equal(typeof JSON.parse(p.storage.get(p.KEY)).went, 'number', 'the press was not marked');
  p.resumeStepUpReturn();
  assert.deepEqual(p.opened, [], 'acted before the sign-in came back');
  // A press on a note past its window marks nothing.
  const late = page({ accounts: ACCOUNTS });
  late.storage.set(late.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: Date.now() - 11 * 60 * 1000 }));
  late.markStepUpReturnGoing();
  assert.equal(JSON.parse(late.storage.get(late.KEY)).went, undefined);
});

test('#8728 slice 2 review 1: another dialog or first run on screen: the return waits and keeps the note', () => {
  for (const id of ['acct-add-modal', 'firstrun', 'fr-choice']) {
    const p = page({ accounts: ACCOUNTS, visible: [id] });
    earlier(p);
    p.resumeStepUpReturn();
    assert.deepEqual(p.opened, [], 'opened over ' + id);
    assert.equal(p.storage.has(p.KEY), true, 'the note was lost while ' + id + ' was open');
  }
});

test('#8728 slice 2: a note older than 10 minutes, from the future, or for an account no longer listed opens nothing', () => {
  const old = page({ accounts: ACCOUNTS });
  earlier(old, 10 * 60 * 1000 + 1000);
  old.resumeStepUpReturn();
  assert.deepEqual(old.opened, [], 'a stale note acted');
  assert.equal(old.storage.has(old.KEY), false, 'and it is removed');
  // CONTROL: just inside the window does reopen.
  const fresh = page({ accounts: ACCOUNTS });
  earlier(fresh, 10 * 60 * 1000 - 5000);
  fresh.resumeStepUpReturn();
  assert.equal(fresh.opened.length, 1, 'CONTROL: a note inside the window did not reopen');
  const future = page({ accounts: ACCOUNTS });
  future.storage.set(future.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: Date.now() + 5 * 60 * 1000 }));
  future.resumeStepUpReturn();
  assert.deepEqual(future.opened, [], 'a note from the future acted');
  const gone = page({ accounts: [ACCOUNTS[1]] });
  earlier(gone);
  gone.resumeStepUpReturn();
  assert.deepEqual(gone.opened, [], 'an account no longer listed was reopened');
  const key = page({ accounts: [{ dir: DIR, email: 'k@example.com', apiKey: true }] });
  earlier(key);
  key.resumeStepUpReturn();
  assert.deepEqual(key.opened, [], 'an API-key account has no Sign in again dialog');
});

test('#8728 slice 2: a note of another shape is ignored and removed; Not now forgets it; blocked storage breaks nothing', () => {
  for (const bad of ['not json', JSON.stringify({ kind: 'other', dir: DIR, at: 1 }), JSON.stringify({ kind: 'claude-signin', dir: '', at: 1 }), JSON.stringify({ kind: 'claude-signin', dir: DIR })]) {
    const p = page({ accounts: ACCOUNTS });
    p.storage.set(p.KEY, bad);
    p.resumeStepUpReturn();
    assert.deepEqual(p.opened, [], 'acted on ' + bad);
  }
  const p = page({ accounts: ACCOUNTS });
  earlier(p);
  p.forgetStepUpReturn();
  p.resumeStepUpReturn();
  assert.deepEqual(p.opened, [], 'Not now did not forget the note');
  const blocked = page({ accounts: ACCOUNTS, throws: true });
  blocked.noteStepUpReturn(DIR);
  blocked.resumeStepUpReturn();
  assert.deepEqual(blocked.opened, []);
});

test('#8728 slice 2 review 1: on load, a note this page may act on makes it read the account list once; no note, no read', async () => {
  const p = page({ accounts: ACCOUNTS, fetchBody: { accounts: ACCOUNTS } });
  earlier(p);
  p.stepUpReturnBoot();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(p.fetched, ['/api/accounts']);
  assert.deepEqual(p.opened, [{ dir: DIR, email: 'someone@example.com' }], 'boot resumed from its own read');
  assert.deepEqual(p.read, [], 'review 2: the boot read does not replace the page list (accountsRead)');
  // CONTROL: no note, nothing is read.
  const none = page({ accounts: ACCOUNTS, fetchBody: { accounts: ACCOUNTS } });
  none.stepUpReturnBoot();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(none.fetched, []);
  // And a note written in this very page view does not trigger a read either.
  const same = page({ accounts: ACCOUNTS, fetchBody: { accounts: ACCOUNTS } });
  same.noteStepUpReturn(DIR);
  same.stepUpReturnBoot();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(same.fetched, []);
});

test('#8728 slice 2: the page wires it: only the refusal that offers Sign in again notes the account; the list read resumes; Not now forgets; boot runs', () => {
  const start = SCRIPT.indexOf('async function acctAddStart(');
  const body = SCRIPT.slice(start, SCRIPT.indexOf('\n}\n', start));
  // review 1: remote_step_up_unavailable ("still starting") and remote_step_up_clock are followed by no fresh sign-in.
  assert.match(body, /out\.code === 'remote_step_up' && out\.signInAgain === true && reauthDir\) noteStepUpReturn\(reauthDir\)/);
  // review 3: the folder is read before the request, and the note after the awaits uses that value, never the global.
  assert.match(body, /const reauthDir = ACCT_REAUTH_DIR;[\s\S]*await fetch\('\/api\/connect\/start'/);
  assert.doesNotMatch(body.slice(body.indexOf('const out = await res.json()')), /ACCT_REAUTH_DIR/, 'the global is read again after an await');
  assert.match(lift(SCRIPT, 'accountsRead'), /resumeStepUpReturn\(\)/);
  assert.match(SCRIPT, /closest\('#stepup-close'\)\) \{ hideStepUpAsk\(\); stepUpFocusAway\(\); if \(typeof forgetStepUpReturn === 'function'\) forgetStepUpReturn\(\); \}/);
  assert.match(SCRIPT, /document\.addEventListener\('DOMContentLoaded', stepUpReturnBoot\);\nelse stepUpReturnBoot\(\);/);
  // review 2: the ask's Sign in again (both ways it goes are a submit of #stepup-form) marks the note, in capture.
  assert.match(SCRIPT, /document\.addEventListener\('submit', \(e\) => \{ if \(e\.target && e\.target\.id === 'stepup-form'\) markStepUpReturnGoing\(\); \}, true\);/);
});

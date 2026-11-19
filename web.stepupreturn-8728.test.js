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
    lift(SCRIPT, 'noteStepUpReturn'), lift(SCRIPT, 'forgetStepUpReturn'), lift(SCRIPT, 'peekStepUpReturn'),
    lift(SCRIPT, 'stepUpReturnBusy'), lift(SCRIPT, 'resumeStepUpReturn'), lift(SCRIPT, 'stepUpReturnBoot'),
    'return { noteStepUpReturn, forgetStepUpReturn, peekStepUpReturn, resumeStepUpReturn, stepUpReturnBoot, KEY: STEPUP_RETURN_KEY };',
  ].join('\n');
  const fns = new Function('sessionStorage', 'document', 'performance', 'fetch', 'ACCOUNTS', 'openAcctReauth', 'accountsRead', src)(
    sessionStorage, document, performance, fetch, accounts, (dir, email) => opened.push({ dir, email }), (list) => read.push(list));
  return { ...fns, storage, opened, els, fetched, read, performance };
}

const DIR = '/Users/someone/.claude-work';
const ACCOUNTS = [{ dir: DIR, email: 'someone@example.com' }, { dir: '/Users/someone/.claude', email: 'other@example.com' }];
// A note written before this page view began: the fresh sign-in navigated, so the page loaded again since.
const earlier = (p, ago = 60 * 1000) => p.storage.set(p.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: p.performance.timeOrigin - ago }));

test('#8728 slice 2: after the page loads again, a remembered account reopens its own dialog once, then the note is gone', () => {
  const p = page({ accounts: ACCOUNTS });
  earlier(p);
  p.resumeStepUpReturn();
  assert.deepEqual(p.opened, [{ dir: DIR, email: 'someone@example.com' }]);
  assert.match(p.els['acct-add-note'].textContent, /signed in to Kosmos\+ again\. Press Sign in again/);
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
  assert.deepEqual(p.read, [ACCOUNTS], 'the read went through accountsRead (which resumes)');
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
  assert.match(body, /out\.code === 'remote_step_up' && out\.signInAgain === true && ACCT_REAUTH_DIR\) noteStepUpReturn\(ACCT_REAUTH_DIR\)/);
  assert.doesNotMatch(body, /\/\^remote_step_up\/\.test\(String\(out\.code[^)]*\)\) && ACCT_REAUTH_DIR\) noteStepUpReturn/);
  assert.match(lift(SCRIPT, 'accountsRead'), /resumeStepUpReturn\(\)/);
  assert.match(SCRIPT, /closest\('#stepup-close'\)\) \{ hideStepUpAsk\(\); stepUpFocusAway\(\); if \(typeof forgetStepUpReturn === 'function'\) forgetStepUpReturn\(\); \}/);
  assert.match(SCRIPT, /document\.addEventListener\('DOMContentLoaded', stepUpReturnBoot\);\nelse stepUpReturnBoot\(\);/);
});

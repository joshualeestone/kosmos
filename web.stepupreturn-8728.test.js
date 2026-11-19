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

function page({ accounts = [], storage = new Map(), throws = false } = {}) {
  const opened = [];
  const els = { 'acct-add-note': { textContent: '' } };
  const sessionStorage = {
    getItem: (k) => { if (throws) throw new Error('blocked'); return storage.has(k) ? storage.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error('blocked'); storage.set(k, String(v)); },
    removeItem: (k) => { if (throws) throw new Error('blocked'); storage.delete(k); },
  };
  const document = { getElementById: (id) => els[id] || null };
  const src = [
    SCRIPT.match(/const STEPUP_RETURN_KEY = [^;]*;/)[0],
    SCRIPT.match(/const STEPUP_RETURN_MS = [^;]*;/)[0],
    lift(SCRIPT, 'noteStepUpReturn'), lift(SCRIPT, 'forgetStepUpReturn'), lift(SCRIPT, 'takeStepUpReturn'),
    lift(SCRIPT, 'resumeStepUpReturn'),
    'return { noteStepUpReturn, forgetStepUpReturn, takeStepUpReturn, resumeStepUpReturn, KEY: STEPUP_RETURN_KEY };',
  ].join('\n');
  const fns = new Function('sessionStorage', 'document', 'ACCOUNTS', 'openAcctReauth', src)(
    sessionStorage, document, accounts, (dir, email) => opened.push({ dir, email }));
  return { ...fns, storage, opened, els };
}

const DIR = '/Users/someone/.claude-work';
const ACCOUNTS = [{ dir: DIR, email: 'someone@example.com' }, { dir: '/Users/someone/.claude', email: 'other@example.com' }];

test('#8728 slice 2: a remembered account reopens its own Sign in again dialog once, then the note is gone', () => {
  const p = page({ accounts: ACCOUNTS });
  p.noteStepUpReturn(DIR);
  const kept = JSON.parse(p.storage.get(p.KEY));
  assert.deepEqual(Object.keys(kept).sort(), ['at', 'dir', 'kind'], 'the note holds only kind, dir and when: no code, no token');
  p.resumeStepUpReturn();
  assert.deepEqual(p.opened, [{ dir: DIR, email: 'someone@example.com' }]);
  assert.match(p.els['acct-add-note'].textContent, /signed in to Kosmos\+ again\. Press Sign in again/);
  assert.equal(p.storage.has(p.KEY), false, 'read once');
  p.resumeStepUpReturn();
  assert.equal(p.opened.length, 1, 'a second account read does not reopen it');
});

test('#8728 slice 2: a note older than 10 minutes, from the future, or for an account no longer listed opens nothing', () => {
  const now = Date.now();
  const old = page({ accounts: ACCOUNTS });
  old.storage.set(old.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: now - 10 * 60 * 1000 - 1 }));
  old.resumeStepUpReturn();
  assert.deepEqual(old.opened, [], 'a stale note acted');
  assert.equal(old.storage.has(old.KEY), false, 'and it is removed anyway');
  // CONTROL: the same note just inside the window does reopen.
  const fresh = page({ accounts: ACCOUNTS });
  fresh.storage.set(fresh.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: now - 10 * 60 * 1000 + 5000 }));
  fresh.resumeStepUpReturn();
  assert.equal(fresh.opened.length, 1, 'CONTROL: a note inside the window did not reopen');
  const future = page({ accounts: ACCOUNTS });
  future.storage.set(future.KEY, JSON.stringify({ kind: 'claude-signin', dir: DIR, at: now + 5 * 60 * 1000 }));
  future.resumeStepUpReturn();
  assert.deepEqual(future.opened, [], 'a note from the future acted');
  const gone = page({ accounts: [ACCOUNTS[1]] });
  gone.noteStepUpReturn(DIR);
  gone.resumeStepUpReturn();
  assert.deepEqual(gone.opened, [], 'an account no longer listed was reopened');
  const key = page({ accounts: [{ dir: DIR, email: 'k@example.com', apiKey: true }] });
  key.noteStepUpReturn(DIR);
  key.resumeStepUpReturn();
  assert.deepEqual(key.opened, [], 'an API-key account has no Sign in again dialog');
});

test('#8728 slice 2: a note of another shape is ignored and removed; Not now forgets it; blocked storage breaks nothing', () => {
  for (const bad of ['not json', JSON.stringify({ kind: 'other', dir: DIR, at: Date.now() }), JSON.stringify({ kind: 'claude-signin', dir: '', at: Date.now() }), JSON.stringify({ kind: 'claude-signin', dir: DIR })]) {
    const p = page({ accounts: ACCOUNTS });
    p.storage.set(p.KEY, bad);
    p.resumeStepUpReturn();
    assert.deepEqual(p.opened, [], 'acted on ' + bad);
    assert.equal(p.storage.has(p.KEY), false);
  }
  const p = page({ accounts: ACCOUNTS });
  p.noteStepUpReturn(DIR);
  p.forgetStepUpReturn();
  p.resumeStepUpReturn();
  assert.deepEqual(p.opened, [], 'Not now did not forget the note');
  const blocked = page({ accounts: ACCOUNTS, throws: true });
  blocked.noteStepUpReturn(DIR);
  blocked.resumeStepUpReturn();
  assert.deepEqual(blocked.opened, []);
});

test('#8728 slice 2: the page wires it: a remote_step_up refusal of a re-auth notes the account, the list read resumes, Not now forgets', () => {
  const start = SCRIPT.indexOf('async function acctAddStart(');
  const body = SCRIPT.slice(start, SCRIPT.indexOf('\n}\n', start));
  assert.match(body, /\/\^remote_step_up\/\.test\(String\(out\.code \|\| ''\)\) && ACCT_REAUTH_DIR\) noteStepUpReturn\(ACCT_REAUTH_DIR\)/);
  assert.match(lift(SCRIPT, 'accountsRead'), /resumeStepUpReturn\(\)/);
  assert.match(SCRIPT, /closest\('#stepup-close'\)\) \{ hideStepUpAsk\(\); stepUpFocusAway\(\); if \(typeof forgetStepUpReturn === 'function'\) forgetStepUpReturn\(\); \}/);
});

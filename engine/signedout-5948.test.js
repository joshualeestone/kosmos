'use strict';

/**
 * #5948: an agent whose provider sign-in stopped working must say so. The seam is the automatic blocked line
 * "provider api (authentication_failed)" (Claude Code's StopFailure hook writes it; a Windows per-turn supervisor
 * writes the same line with the vendor's sentence in `because`). status.reconcileReport reads it as auth_failed, so
 * accountProblemOf, and through it chat.withAccountRow and the manager notice, fire from code that already exists.
 *
 *   node --test engine/signedout-5948.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-signedout-5948-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const status = require('./status');
const selfreport = require('./selfreport');
const { accountProblemOf } = require('./accountproblem');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const GROK_SAID = 'Not signed in. To authenticate without a browser, run: grok login --device-code';
const AUTH = { found: true, state: 'blocked', by: 'auto', auto: true, on: 'provider api (authentication_failed)', owner: 'provider', because: GROK_SAID };
const now = () => new Date().toISOString();
/* A Windows card's screen reads only idle or working (win32streamstate); a failed turn leaves it idle. */
const IDLE = { state: status.STATE.IDLE, confidence: status.CONFIDENCE.SCRAPED, because: 'idle' };

test('#5948: the automatic sign-in report reads auth_failed, with the vendor sentence as evidence', () => {
  const out = status.reconcileReport({ ...AUTH, at: now() }, IDLE, Date.now());
  assert.equal(out.state, status.STATE.AUTH_FAILED, JSON.stringify(out));
  assert.equal(out.evidence, GROK_SAID);
  assert.equal(out.reported, true);
  // No sentence: still auth_failed, with no evidence key rather than an empty one.
  const bare = status.reconcileReport({ ...AUTH, because: '', at: now() }, IDLE, Date.now());
  assert.equal(bare.state, status.STATE.AUTH_FAILED);
  assert.equal('evidence' in bare, false);
});

test('#5948 CONTROLS: only the automatic authentication_failed line maps; its neighbours stay blocked', () => {
  const cases = [
    ['an agent-written blocked naming the same thing', { ...AUTH, by: 'agent', auto: false }],
    ['the StopFailure limit line', { ...AUTH, on: 'provider api (rate_limit)' }],
    ['another provider error', { ...AUTH, on: 'provider api (server_error)' }],
    ['a lookalike with more words', { ...AUTH, on: 'provider api (authentication_failed) and more' }],
  ];
  for (const [why, rep] of cases) {
    const out = status.reconcileReport({ ...rep, at: now() }, IDLE, Date.now());
    assert.equal(out.state, status.STATE.BLOCKED, why + ': ' + JSON.stringify(out));
  }
});

test('#5948: on a grok card the account problem reads as a Grok sign-in, so the chat line and the manager notice fire', () => {
  const out = status.reconcileReport({ ...AUTH, at: now() }, IDLE, Date.now());
  const card = { sessionName: 'gk', name: 'Gk', runner: 'grok', state: out.state, stateEvidence: out.evidence };
  const p = accountProblemOf(card);
  assert.ok(p, 'no account problem on a signed-out card');
  assert.equal(p.kind, 'signin');
  assert.equal(p.provider, 'Grok');
  assert.equal(p.notify, true);
  // CONTROL: the same card before the report (idle) has no account problem, so the assertion above can fail.
  assert.equal(accountProblemOf({ ...card, state: status.STATE.IDLE }), null);
});

test('#5948: written through selfreport, the sign-in line replaces a standing question, and the agent clears it itself', () => {
  const name = 'gk-' + process.pid;
  assert.equal(selfreport.record(name, { state: 'needs_you', because: 'which colour?', by: 'agent' }).recorded, true);
  const asked = status.reconcileReport(selfreport.read(name), IDLE, Date.now());
  assert.equal(asked.state, status.STATE.NEEDS_YOU, 'CONTROL: the question did not stand');
  const rec = selfreport.record(name, { state: 'blocked', auto: true, on: AUTH.on, owner: 'provider', because: GROK_SAID });
  assert.equal(rec.recorded, true, JSON.stringify(rec));
  assert.equal(status.reconcileReport(selfreport.read(name), IDLE, Date.now()).state, status.STATE.AUTH_FAILED,
    'the stale question still outranks the sign-in problem');
  // An automatic heartbeat cannot clear it (a failed turn must not read healthy) ...
  const hb = selfreport.record(name, { state: 'working', auto: true });
  assert.equal(hb.recorded, false, JSON.stringify(hb));
  assert.equal(status.reconcileReport(selfreport.read(name), IDLE, Date.now()).state, status.STATE.AUTH_FAILED);
  // ... and a non-automatic report after a turn that worked does.
  assert.equal(selfreport.record(name, { state: 'working', because: 'answered' }).recorded, true);
  assert.notEqual(status.reconcileReport(selfreport.read(name), IDLE, Date.now()).state, status.STATE.AUTH_FAILED);
});

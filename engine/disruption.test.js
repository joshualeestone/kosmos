'use strict';
/**
 * Disruption: "we are deliberately restarting this agent right now" (#2019).
 * The three-answers discipline (no-record vs aged-out) and the window that
 * self-heals a restart that never came back.
 *
 *   node --test engine/disruption.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-disruption-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const disruption = require('./disruption');

test('begin records a cause and startedAt, read reads them back', () => {
  const r = disruption.begin('alpha', 'restart');
  assert.equal(r.ok, true);
  assert.equal(r.cause, 'restart');
  assert.ok(Number.isFinite(Date.parse(r.startedAt)));
  const back = disruption.read('alpha');
  assert.equal(back.found, true);
  assert.equal(back.cause, 'restart');
  assert.equal(back.startedAt, r.startedAt);
  assert.ok(back.ageMs >= 0);
});

test('THREE ANSWERS: no record at all is found:false, NOT aged-out', () => {
  const back = disruption.read('never-touched');
  assert.equal(back.found, false);
  // active on a name with no record is null, the same "we cannot tell",
  // and it must not be confused with a real disruption.
  assert.equal(disruption.active('never-touched'), null);
});

test('every named cause round-trips; an unknown cause is coerced to restart', () => {
  for (const c of disruption.CAUSES) {
    disruption.begin('beta', c);
    assert.equal(disruption.read('beta').cause, c);
  }
  // A caller cannot smuggle an unreadable token onto the board.
  const r = disruption.begin('beta', 'something-made-up');
  assert.equal(r.cause, 'restart');
  assert.equal(disruption.read('beta').cause, 'restart');
});

test('active returns the record while fresh and null once past the window', () => {
  // Backdate the startedAt so we control age without sleeping.
  const old = new Date(Date.now() - (disruption.WINDOW_MS + 60 * 1000)).toISOString();
  disruption.begin('gamma', 'model', old);
  // read still FINDS it (found:true, large ageMs) -- the raw record is there...
  const raw = disruption.read('gamma');
  assert.equal(raw.found, true);
  assert.ok(raw.ageMs > disruption.WINDOW_MS);
  // ...but active FOLDS THE WINDOW IN and returns null: the self-heal, so a
  // restart that never came back stops reading as RESTARTING with no cleanup.
  assert.equal(disruption.active('gamma'), null);

  // A fresh one is returned by active, carrying cause + startedAt.
  const fresh = new Date(Date.now() - 1000).toISOString();
  disruption.begin('gamma', 'provider', fresh);
  const a = disruption.active('gamma');
  assert.ok(a, 'a fresh disruption is active');
  assert.equal(a.cause, 'provider');
  assert.equal(a.startedAt, fresh);
});

test('active honors an explicit window argument', () => {
  const at = new Date(Date.now() - 5000).toISOString(); // 5s old
  disruption.begin('delta', 'restart', at);
  assert.ok(disruption.active('delta', 10 * 1000), 'within a 10s window');
  assert.equal(disruption.active('delta', 1000), null, 'outside a 1s window');
});

test('clear removes the record so active and read both go empty', () => {
  disruption.begin('epsilon', 'account');
  assert.ok(disruption.active('epsilon'));
  const c = disruption.clear('epsilon');
  assert.equal(c.ok, true);
  assert.equal(disruption.read('epsilon').found, false);
  assert.equal(disruption.active('epsilon'), null);
  // clear on a name with no record is a safe no-op, never a throw.
  assert.equal(disruption.clear('epsilon').ok, true);
});

test('a fresh begin overwrites a prior one for the same agent (at most one in flight)', () => {
  const first = new Date(Date.now() - 4000).toISOString();
  disruption.begin('zeta', 'restart', first);
  disruption.begin('zeta', 'model');
  const back = disruption.read('zeta');
  assert.equal(back.cause, 'model');
  assert.notEqual(back.startedAt, first);
});

test('begin refuses an unwritable name rather than throwing', () => {
  // store.safeKey rejects a name that cannot be keyed; begin must answer, not crash.
  const r = disruption.begin('', 'restart');
  // Either a refusal (unkeyable) or a write under a coerced key -- never a throw.
  assert.equal(typeof r.ok, 'boolean');
});

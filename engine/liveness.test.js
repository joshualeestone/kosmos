'use strict';
/**
 * Liveness: the pane's OTHER job, and the one arm that keeps it from becoming
 * a state report.
 *
 *   node --test engine/liveness.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-liveness-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const liveness = require('./liveness');

test('a beat is recorded and read back', () => {
  const r = liveness.seen('agent-one');
  assert.equal(r.seen, true, 'the beat was refused: ' + r.because);
  const back = liveness.read('agent-one');
  assert.equal(back.found, true, 'the beat did not read back');
  assert.ok(back.ageMs >= 0 && back.ageMs < 5000, 'age looks wrong: ' + back.ageMs);
});

/* 🔑 THREE ANSWERS, NEVER TWO. No record is NOT "seen long ago". Every Mac
   agent has no record, and a caller that reads that as dead drops the entire
   existing fleet. */
test('no record is CANNOT-TELL, not dead', () => {
  const r = liveness.read('never-beat');
  assert.equal(r.found, false);
  assert.match(r.because, /no heartbeat has ever been recorded/);
  assert.equal(liveness.alive('never-beat'), null,
    'alive() returned a boolean for an agent with no record; null is the only answer that cannot drop the Mac fleet');
});

test('alive is true inside the window and false outside it', () => {
  liveness.seen('agent-two');
  assert.equal(liveness.alive('agent-two'), true, 'a beat just now reads as not alive');
  /* Backdate the record rather than sleeping: the question is the comparison,
     not the clock. */
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  liveness.seen('agent-two', old);
  assert.equal(liveness.alive('agent-two'), false, 'a ten-minute-old beat still reads as alive');
});

test('a caller may set its own window, and the default is three beats of the supervisor loop', () => {
  liveness.seen('agent-three', new Date(Date.now() - 20 * 1000).toISOString());
  assert.equal(liveness.alive('agent-three'), true, '20s should be inside the 35s default');
  assert.equal(liveness.alive('agent-three', 5 * 1000), false, 'a caller-supplied 5s window was ignored');
  assert.equal(liveness.STALE_AFTER_MS, 35 * 1000,
    'the default moved; it is three beats of agent-supervisor.sh\'s 10s loop, so a single slow disk is not death');
});

test('a refusal is returned, never thrown -- the caller is a route', () => {
  const r = liveness.seen('../../etc/passwd');
  assert.equal(typeof r, 'object', 'seen() threw instead of refusing');
  if (r.seen === true) {
    const where = liveness.fileFor('../../etc/passwd');
    assert.ok(where.startsWith(liveness.DIR), 'a traversing name escaped the liveness dir: ' + where);
  }
});

/**
 * 🛑 THE ARM THIS FILE EXISTS FOR. A heartbeat that can write a STATE is
 * #900 and #1058 re-broken: a supervisor beating every ten seconds would
 * overwrite a deliberate `blocked` on a timer. The module must have no way to
 * express a state at all -- not "must not be called with one".
 */
test('liveness cannot touch state: no state vocabulary reaches this module', () => {
  const src = fs.readFileSync(path.join(__dirname, 'liveness.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/require\(['"]\.\/selfreport['"]\)/.test(code),
    'liveness requires selfreport; it must not be able to write a report at all');
  for (const word of ['needs_you', 'blocked', 'working', 'STATES']) {
    assert.ok(!code.includes(word),
      `the state word "${word}" appears in liveness code. This module records only that an agent was SEEN; the moment it can express a state it can overwrite a deliberate blocked, which is #900/#1058`);
  }
  assert.ok(!Object.keys(liveness).some((k) => /state|report/i.test(k)),
    'liveness exports something state-shaped: ' + Object.keys(liveness).join(', '));
});

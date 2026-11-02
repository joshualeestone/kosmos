'use strict';
require('../test-support/tmpscope');   // kosmos#5334: this process's temp folders, removed when it exits
/* #7786: an agent that launched and never took a turn read "Idle", the word of an agent resting after work, so a
   person (and the agent helping them) could not tell "never started" from "started and gone quiet". These pin the
   record reader (selfreport.turnTakenOf), the card field (status.neverTurnedOf) and the word on the page and the phone. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-neverturned-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');
const status = require('./status');
const cardlabel = require('./cardlabel');

const IDLE = { state: 'idle' };
const pane = (name, extra) => ({ name, session: name, claim: name, runner: 'claude', ...extra });
/* Each test uses its own agent names: turnTakenOf keeps a true per name and file, and rows() rewrites the file in
   place, so a name reused across tests could read a kept answer. */
function rows(name, list) {
  fs.mkdirSync(selfreport.DIR, { recursive: true });
  fs.writeFileSync(selfreport.fileFor(name), list.map((r, i) =>
    JSON.stringify({ v: 1, at: new Date(Date.parse('2026-11-02T10:00:00Z') + i * 1000).toISOString(), ...r })).join('\n') + '\n');
}

test('turnTakenOf: a record of starts (and stops) only is false; any turn row is true; no record is null', () => {
  rows('only-start', [{ state: 'started', by: 'auto' }]);
  assert.equal(selfreport.turnTakenOf('only-start'), false);
  rows('start-stop', [{ state: 'started', by: 'auto' }, { state: 'stopped', by: 'auto' }, { state: 'started', by: 'auto' }]);
  assert.equal(selfreport.turnTakenOf('start-stop'), false, 'relaunched twice, never a turn');
  for (const state of selfreport.TURN_STATES) {
    rows('turned-' + state, [{ state: 'started', by: 'auto' }, { state, by: 'auto', text: 'x', on: 'x', owner: 'x' }, { state: 'started', by: 'auto' }]);
    assert.equal(selfreport.turnTakenOf('turned-' + state), true, state + ' before a restart still counts');
  }
  assert.equal(selfreport.turnTakenOf('no-such-agent'), null, 'no record says nothing: its hook may never have been wired');
  rows('operator-only', [{ state: 'started', by: 'auto' }, { state: 'idle', by: 'operator' }]);
  assert.equal(selfreport.turnTakenOf('operator-only'), false, "a person's clear is not the agent's turn");
});

test('the turn states are pinned here, not read from the module: dropping one would make a worked agent read not started', () => {
  assert.deepEqual([...selfreport.TURN_STATES].sort(), ['blocked', 'idle', 'needs_you', 'working']);
  rows('stop-only', [{ state: 'started', by: 'auto' }, { state: 'idle', by: 'auto', text: 'finished responding' }]);
  assert.equal(selfreport.turnTakenOf('stop-only'), true, 'a Stop row alone is a turn');
});

test('turnTakenOf: a long record with a turn in its tail is true; once true it is not read again', () => {
  const many = [];
  for (let i = 0; i < 2000; i++) many.push({ state: 'started', by: 'auto', pad: 'p'.repeat(40) });
  many.push({ state: 'working', by: 'auto', text: 'answering a prompt' });
  rows('long-turned', many);
  assert.ok(fs.statSync(selfreport.fileFor('long-turned')).size > selfreport.TAIL_BYTES, 'CONTROL: the file is past the tail');
  assert.equal(selfreport.turnTakenOf('long-turned'), true);
  rows('cached', [{ state: 'started', by: 'auto' }, { state: 'working', by: 'auto' }]);
  assert.equal(selfreport.turnTakenOf('cached'), true);
  rows('cached', [{ state: 'started', by: 'auto' }]);   // rewritten in place: the same file, so the kept answer stands
  assert.equal(selfreport.turnTakenOf('cached'), true, 'kept, not read again');
  fs.unlinkSync(selfreport.fileFor('cached'));
  rows('cached', [{ state: 'started', by: 'auto' }]);   // a new file under the same name is read again
  assert.equal(selfreport.turnTakenOf('cached'), false, 'a replaced record is not answered from the old one');
});

test('turnTakenOf: a record longer than the tail is null (older rows were not read)', () => {
  const many = [];
  for (let i = 0; i < 2000; i++) many.push({ state: 'started', by: 'auto', pad: 'p'.repeat(40) });
  rows('long-starts', many);
  assert.ok(fs.statSync(selfreport.fileFor('long-starts')).size > selfreport.TAIL_BYTES, 'CONTROL: the file is past the tail');
  assert.equal(selfreport.turnTakenOf('long-starts'), null);
});

test('neverTurnedOf: idle, ours, Claude or Grok, and a record of starts only', () => {
  rows('fresh', [{ state: 'started', by: 'auto' }]);
  rows('worked', [{ state: 'started', by: 'auto' }, { state: 'working', by: 'auto' }, { state: 'idle', by: 'auto' }]);
  assert.equal(status.neverTurnedOf(pane('fresh'), IDLE), true);
  assert.equal(status.neverTurnedOf(pane('fresh', { runner: 'grok' }), IDLE), true);
  assert.equal(status.neverTurnedOf(pane('worked'), IDLE), false, 'CONTROL: an agent that worked reads Idle');
  assert.equal(status.neverTurnedOf(pane('fresh'), { state: 'working' }), false, 'only an idle card');
  assert.equal(status.neverTurnedOf(pane('fresh'), { state: 'needs_you' }), false, 'a prompt on screen keeps its own word');
  for (const runner of ['gemini', 'codex', 'antigravity', 'muse']) {
    assert.equal(status.neverTurnedOf(pane('fresh', { runner }), IDLE), false, runner + ': its turns may write no row');
  }
  assert.equal(status.neverTurnedOf({ name: 'fresh', session: 'stranger', claim: '' }, IDLE), false, 'not ours');
  assert.equal(status.neverTurnedOf(pane('never-launched'), IDLE), false, 'no record: the old word');
});

test('the word: "Not started yet" on the page and the phone, calm, only on an idle card', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const grab = (re, what) => { const m = PAGE.match(re); assert.ok(m, 'CONTROL: ' + what + ' was not found in the page'); return m[0]; };
  const { stateCopyOf } = new Function(
    grab(/\nconst STATE_COPY = \{[\s\S]*?\n\};\n/, 'STATE_COPY')
    + grab(/\nfunction restartingLabel\(a\) \{[\s\S]*?\n\}\n/, 'restartingLabel')
    + grab(/\nfunction stateCopyOf\(a\) \{[\s\S]*?\n\}\n/, 'stateCopyOf')
    + '\nreturn { stateCopyOf };')();
  assert.deepEqual(stateCopyOf({ state: 'idle', neverTurned: true }), { label: 'Not started yet', attn: false });
  assert.equal(cardlabel.labelOf({ state: 'idle', neverTurned: true }), 'Not started yet');
  assert.equal(cardlabel.toneOf({ state: 'idle', neverTurned: true }, false), 'quiet', 'the phone keeps Idle\'s tone');
  assert.equal(stateCopyOf({ state: 'idle', neverTurned: false }).label, 'Idle', 'CONTROL');
  assert.equal(cardlabel.labelOf({ state: 'idle' }), 'Idle', 'CONTROL');
  assert.equal(cardlabel.labelOf({ state: 'working', neverTurned: true }), 'Working', 'only idle');
  assert.equal(cardlabel.labelOf({ running: false, state: 'stopped', neverTurned: true }), 'Not running', 'a down pane says so first');
  assert.equal(cardlabel.labelOf({ state: 'idle', neverTurned: true, deliveryStall: { since: 'x' } }), 'Messages stuck', 'a stall outranks it');
});

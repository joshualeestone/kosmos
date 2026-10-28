'use strict';
/* kosmos#7406: the per-account cap on how many of our agents work at once, for every runner but Antigravity (whose own
 * cap is engine/agycap-gate-4588.test.js). Real cards from the real producer (fleet + status.snapshot()), never
 * hand-built (fixture-discipline.test.js); both settings are injected so no file is read, and each card's account is
 * set through the launch job the gate reads (create.readJob), stubbed here.
 *
 *   node --test engine/workcap-7406.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-workcap-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('./agyquota');
const create = require('./create');
const roomhold = require('./roomhold');
const workcap = require('./workcap-setting');
const fleet = require('../test-support/fleet');
const status = require('./status');

const ACCOUNT = { 'cl-a': '/acct/one', 'cl-b': '/acct/one', 'cl-c': '/acct/one', 'cl-d': '/acct/two', 'cx-e': '/acct/one' };
const realReadJob = create.readJob;
test.beforeEach(() => {
  q.ACCOUNT_MEMO.clear();
  q.CAP_STARTS.clear();
  create.readJob = (name) => (ACCOUNT[name] ? { configDir: ACCOUNT[name] } : null);
});
test.afterEach(() => { create.readJob = realReadJob; });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const AGY = { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' };
const CARDS = (() => {
  const board = fleet.install([
    fleet.agent('cl-a', { state: 'idle' }), fleet.agent('cl-b', { state: 'idle' }), fleet.agent('cl-c', { state: 'idle' }),
    fleet.agent('cl-d', { state: 'idle' }), fleet.agent('cx-e', { state: 'unknown', runner: 'codex', command: 'codex', screen: '' }),
    fleet.agent('agy-f', AGY),
  ]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
function world(states) {
  return Object.keys(states).map((s) => {
    const card = CARDS.find((c) => c.sessionName === s);
    assert.ok(card, 'fixture: no real card for ' + s);
    return { ...card, state: states[s], quotaUntil: null };
  });
}
const cap = (n) => () => ({ maxWorking: n, ok: true });
const NOCAP = cap(0);
const NOW = Date.parse('2026-10-28T03:00:00Z');
const NOENV = {};
const ALL_IDLE = { 'cl-a': 'idle', 'cl-b': 'idle', 'cl-c': 'idle', 'cl-d': 'idle', 'cx-e': 'idle', 'agy-f': 'idle' };

test('fixture: real cards; claude and codex ours, accounts from the stubbed job', () => {
  const r = world(ALL_IDLE);
  assert.deepEqual(r.map((c) => [c.sessionName, c.runner || 'claude']).slice(0, 5),
    [['cl-a', 'claude'], ['cl-b', 'claude'], ['cl-c', 'claude'], ['cl-d', 'claude'], ['cx-e', 'codex']]);
  assert.equal(q.accountOf(r[0], NOW), q.accountOf(r[1], NOW));
  assert.notEqual(q.accountOf(r[0], NOW), q.accountOf(r[3], NOW), 'two folders read as one account');
  assert.notEqual(q.accountOf(r[0], NOW), q.accountOf(r[4], NOW), 'two runners on one folder read as one account');
  assert.equal(q.accountOf(r[5], NOW), null, 'an Antigravity card is left to its own cap');
});

test('at the cap: another idle agent on the SAME account is held, until one minute ahead', () => {
  const r = world({ ...ALL_IDLE, 'cl-a': 'working', 'cl-b': 'working' });
  assert.equal(q.heldForCap('cl-c', r, NOW, NOCAP, NOENV, cap(2)), NOW + q.CAP_RECHECK_MS);
  assert.equal(q.heldForAgy('cl-c', r, NOW, q.POOL_MEMO, NOENV, NOCAP), null, 'CONTROL: the Gemini cap is not this one');
});

test('CONTROL: another account, another runner on the same folder, under the cap, or no limit: nothing is held', () => {
  const r = world({ ...ALL_IDLE, 'cl-a': 'working', 'cl-b': 'working' });
  assert.equal(q.heldForCap('cl-d', r, NOW, NOCAP, NOENV, cap(2)), null, 'another account');
  assert.equal(q.heldForCap('cx-e', r, NOW, NOCAP, NOENV, cap(2)), null, 'codex on the same folder');
  assert.equal(q.heldForCap('cl-c', r, NOW, NOCAP, NOENV, cap(4)), null, 'under the cap');
  assert.equal(q.heldForCap('cl-c', r, NOW, NOCAP, NOENV, cap(0)), null, 'no limit');
  assert.equal(q.heldForCap('cl-a', r, NOW, NOCAP, NOENV, cap(1)), null, 'already working: a line to it starts no new turn');
  assert.equal(q.heldForCap('cl-c', r, NOW, NOCAP, { AGENT_WORKFORCE_AGY_QUOTA_HOLD_OFF: '1' }, cap(2)), null, 'the brake lifts this cap too');
});

test('a fan-out from one roster: each reservation counts, so the third same-account agent is held', () => {
  const r = world(ALL_IDLE);   // everyone reads idle: only the reservations can say who was just started
  for (const name of ['cl-a', 'cl-b']) {
    assert.equal(q.heldForCap(name, r, NOW, NOCAP, NOENV, cap(2)), null, name + ' held before the cap was reached');
    assert.ok(q.noteCapStart(name, r, NOW, NOCAP, NOENV, cap(2)), name + ' was not reserved');
  }
  assert.equal(q.heldForCap('cl-c', r, NOW, NOCAP, NOENV, cap(2)), NOW + q.CAP_RECHECK_MS);
  assert.equal(q.heldForCap('cl-d', r, NOW, NOCAP, NOENV, cap(2)), null, 'CONTROL: another account is not counted');
  // A reservation lapses after CAP_START_MS, so the cap frees once the started agents stop reading as busy.
  assert.equal(q.heldForCap('cl-c', r, NOW + q.CAP_START_MS + 1, NOCAP, NOENV, cap(2)), null);
});

test('no reservation while the cap is off, and none for an Antigravity agent under this cap', () => {
  const r = world(ALL_IDLE);
  assert.equal(q.noteCapStart('cl-a', r, NOW, NOCAP, NOENV, NOCAP), null);
  assert.equal(q.CAP_STARTS.size, 0);
  assert.equal(q.noteCapStart('agy-f', r, NOW, NOCAP, NOENV, cap(2)), null, 'the work cap reserved a Gemini agent');
});

test('the held reason names the cap that holds it', () => {
  const r = world(ALL_IDLE);
  assert.equal(q.capWords('cl-a', r), 'the agents on its account are at the limit you set for working at once');
  assert.match(q.capWords('agy-f', r), /^the Gemini subscription agents on this computer/);
});

test('the setting: choices, no limit by default, a refused value writes nothing', () => {
  assert.deepEqual([...workcap.CHOICES], [0, 2, 4, 6, 8, 12, 16]);
  assert.deepEqual(workcap.read(), { maxWorking: 0, ok: true });
  assert.equal(workcap.set({ maxWorking: 3 }).ok, false);
  assert.equal(fs.existsSync(workcap.FILE), false);
  assert.equal(workcap.set({ maxWorking: 8 }).ok, true);
  assert.deepEqual(workcap.read(), { maxWorking: 8, ok: true });
  assert.notEqual(workcap.FILE, require('./agycap-setting').FILE, 'the two caps share one file');
  fs.rmSync(workcap.FILE, { force: true });
});

test('a cap-held post is noted, and only while it is still held', () => {
  roomhold.forget('cl-c');
  assert.ok(roomhold.hold('cl-c', 'proj', roomhold.addressedId('m1')));
  roomhold.noteCap('cl-c', 'proj', roomhold.addressedId('m1'));
  assert.deepEqual(roomhold.capProjects('cl-c'), ['proj']);
  roomhold.take('cl-c', 'proj');
  assert.deepEqual(roomhold.capProjects('cl-c'), [], 'a told post is still noted');
  roomhold.forget('cl-c');
});

test('review 1 (a blocker): a person\'s own message kept for a usage limit is typed with the cap off', () => {
  const chat = require('./chat');
  const limitqueue = require('./limitqueue');
  const real = chat.deliverAutomaticAsync;
  const seen = [];
  chat.deliverAutomaticAsync = (...args) => { seen.push(args); return Promise.resolve({ state: 'placed' }); };
  try {
    const hooks = limitqueue.sweepHooks({ chat, messages: require('./messages') });
    hooks.deliver('cl-a', 'env', [], { kind: 'dm', text: 'hi', envelope: '', trailer: '' });
    hooks.deliver('cl-a', 'an agent line', [], { kind: 'msg' });
  } finally { chat.deliverAutomaticAsync = real; }
  assert.deepEqual(seen[0][5], { cap: false }, 'a person\'s kept DM can be held by the cap');
  assert.equal(seen[1][5], undefined, 'CONTROL: an agent\'s kept line still goes through the cap');
});

test('review 1: an Enter for a line already in the box is not held by the per-account cap; a Gemini agent keeps its own rule', () => {
  const chat = require('./chat');
  const r = world(ALL_IDLE);
  assert.deepEqual(chat.typedLineCap('cl-a', r), { cap: false });
  assert.deepEqual(chat.typedLineCap('agy-f', r), {}, 'the Gemini cap\'s Enter rule changed');
});

test('review 1: with no limit set, the gate reads no launch job (the default costs no disk)', () => {
  const r = world({ ...ALL_IDLE, 'cl-a': 'working', 'cl-b': 'working' });
  let reads = 0;
  create.readJob = () => { reads += 1; return null; };
  assert.equal(q.heldForCap('cl-c', r, NOW, NOCAP, NOENV, NOCAP), null);
  assert.equal(q.noteCapStart('cl-c', r, NOW, NOCAP, NOENV, NOCAP), null);
  assert.equal(reads, 0, 'a launch job was read with the cap off');
  q.heldForCap('cl-c', r, NOW, NOCAP, NOENV, cap(2));
  assert.ok(reads > 0, 'CONTROL: with a limit the account is read');
});

test('review 1: a cap note is kept on disk, so a board restart does not lose it', () => {
  roomhold.forget('cl-d');
  assert.ok(roomhold.hold('cl-d', 'proj', roomhold.addressedId('m9')));
  assert.equal(roomhold.noteCap('cl-d', 'proj', roomhold.addressedId('m9')), true);
  // Nothing in memory carries it: a fresh read of the folder finds it.
  const files = fs.readdirSync(roomhold.dir()).filter((f) => f.endsWith('.cap'));
  assert.equal(files.length, 1, 'the cap note is not on disk');
  assert.deepEqual(roomhold.capProjects('cl-d'), ['proj']);
  roomhold.take('cl-d', 'proj');
  assert.deepEqual(roomhold.capProjects('cl-d'), []);
  assert.equal(fs.readdirSync(roomhold.dir()).filter((f) => f.endsWith('.cap')).length, 0, 'a told post\'s note stayed on disk');
  roomhold.forget('cl-d');
});

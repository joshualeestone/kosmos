'use strict';

/**
 * kosmos#9010: the board's wiring of the move's handoff step (server.js moveHandoffDeps, on accountMoveDeps). Built in
 * a sandboxed board, as server.automove-deps-7621.test.js builds the mover's: an agent that is not running, or is out
 * of usage, is not asked (it could not write one), and AGENT_WORKFORCE_MOVE_HANDOFF_OFF=1 turns the step off.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9010handoff-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
fs.writeFileSync(path.join(SANDBOX, 'panes.txt'), '');

const server = require('./server');
const fleet = require('./test-support/fleet');

test.after(() => { delete process.env.AGENT_WORKFORCE_MOVE_HANDOFF_OFF; fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('the move asks for a handoff by default, with every step the engine reads', () => {
  const d = server._accountMoveDepsForTest();
  assert.ok(d.handoffFirst, 'no handoff step on the move');
  for (const k of ['ask', 'isFresh', 'pickup']) assert.equal(typeof d.handoffFirst[k], 'function', k + ' missing');
});

test('an agent that is not running is not asked, with the reason', async () => {
  const d = server._accountMoveDepsForTest();
  assert.deepEqual(await d.handoffFirst.ask('nobody-here'), { asked: false, why: 'it was not running.' });
  assert.equal(d.handoffFirst.isFresh('nobody-here', { exists: false }), false);
});

test('an agent out of usage is not asked: it could not take a turn to write one', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'rate_limited' })]);
  t.after(() => board.restore());
  const d = server._accountMoveDepsForTest();
  assert.deepEqual(await d.handoffFirst.ask('mara'), { asked: false, why: 'it was out of usage, so it could not write one.' });
});

test('CONTROL: AGENT_WORKFORCE_MOVE_HANDOFF_OFF=1 turns the step off (the old move)', () => {
  process.env.AGENT_WORKFORCE_MOVE_HANDOFF_OFF = '1';
  try { assert.equal(server._accountMoveDepsForTest().handoffFirst, undefined); }
  finally { delete process.env.AGENT_WORKFORCE_MOVE_HANDOFF_OFF; }
});

// Review 1: the rest of the wiring, with chat's sends recorded and the session's start and roster given by the test.
const chat = require('./engine/chat');
function recordSends(t) {
  const sent = [];
  const real = { deliverAsync: chat.deliverAsync, deliverAutomaticAsync: chat.deliverAutomaticAsync };
  chat.deliverAsync = async (name, text, roster, a, b, opts) => { sent.push(['deliver', name, text, opts]); return { state: chat.DELIVERY.PLACED }; };
  chat.deliverAutomaticAsync = async (name, text) => { sent.push(['automatic', name, text]); return { state: chat.DELIVERY.PLACED }; };
  t.after(() => Object.assign(chat, real));
  return sent;
}

test('blocked by Claude Code\'s own usage-limit report, or signed out: not asked', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  const card = (extra) => [{ sessionName: 'mara', isNamedOurs: true, ...extra }];
  const asBlocked = server._moveHandoffDepsForTest({ roster: () => card({ state: 'blocked', limitReported: true }) });
  assert.deepEqual(await asBlocked.ask('mara'), { asked: false, why: 'it was out of usage, so it could not write one.' });
  const signedOut = server._moveHandoffDepsForTest({ roster: () => card({ state: 'auth_failed' }) });
  assert.deepEqual(await signedOut.ask('mara'), { asked: false, why: 'it was signed out, so it could not write one.' });
});

test('an idle agent is asked with #3492\'s prompt naming its handoff path, without the moved note', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  const sent = recordSends(t);
  const d = server._moveHandoffDepsForTest({ roster: () => [{ sessionName: 'mara', isNamedOurs: true, state: 'idle' }], startedAt: async () => 100 });
  const got = await d.ask('mara');
  assert.equal(got.asked, true);
  assert.match(got.path, /handoffs\/mara-discord\.md$/, 'the per-session path #3492 and auto-handoff use');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], 'mara');
  assert.ok(sent[0][2].includes('Write your handoff now to ' + got.path), 'the prompt names that path');
  assert.equal(sent[0][3].movedNote, false, 'the moved note rides the pickup, not the ask');
  // isFresh against the real file: not yet, then written.
  assert.equal(d.isFresh('mara', got.before), false);
  fs.mkdirSync(path.dirname(got.path), { recursive: true });
  fs.writeFileSync(got.path, '# handoff\n');
  assert.ok(Number.isFinite(d.isFresh('mara', got.before)), 'a written handoff answers its modification time');
});

test('the pickup waits for the NEW session to be up and idle, then types the pickup line', async (t) => {
  const sent = recordSends(t);
  let start = 100;
  let state = 'working';
  const d = server._moveHandoffDepsForTest({
    roster: () => [{ sessionName: 'mara', isNamedOurs: true, state }],
    startedAt: async () => start, readyWaitMs: 3000, pollMs: 5,
  });
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  await d.ask('mara');   // records the old session's start (100)
  sent.length = 0;
  const p = d.pickup('mara', '/h/mara.md');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, 0, 'typed while the old session was still the one up');
  start = 200;   // the new session is up
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, 0, 'typed before the new session read idle');
  state = 'idle';
  assert.deepEqual(await p, { ok: true });
  assert.deepEqual(sent.map((x) => [x[0], x[1]]), [['automatic', 'mara']]);
  assert.ok(sent[0][2].includes('Read your handoff at /h/mara.md'));
});

test('a pickup whose new session never comes up gives up, and says it did not land', async (t) => {
  const sent = recordSends(t);
  const d = server._moveHandoffDepsForTest({ roster: () => [], startedAt: async () => null, readyWaitMs: 40, pollMs: 5 });
  assert.deepEqual(await d.pickup('mara', '/h/mara.md'), { ok: false });
  assert.equal(sent.length, 0);
});

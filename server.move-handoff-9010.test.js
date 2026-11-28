'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

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

require('./test-support/faketmux-win').serveOnWindows();   // kosmos#8378: fake tmux's reads on Windows, where its script cannot run
const server = require('./server');
const fleet = require('./test-support/fleet');
/* fixture-discipline: the cards these deps read are the board's own, built once here by test-support/fleet for each
   state a test needs (before any test installs its own board, since install and restore swap the whole fake world).
   `limitReported` is not on any card a pane alone produces (it comes from the agent's own usage report), so the one
   test that needs it lays it over a real card. */
const CARDS = {};
for (const state of ['idle', 'working', 'needs_you', 'rate_limited', 'auth_failed']) {
  const b = fleet.install([fleet.agent('mara', { state })]);
  try { CARDS[state] = { ...b.card('mara') }; } finally { b.restore(); }
}
const cardIn = (state, over = {}) => [{ ...CARDS[state], ...over }];

test.after(() => { delete process.env.AGENT_WORKFORCE_MOVE_HANDOFF_OFF; fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('the move asks for a handoff by default, with every step the engine reads', () => {
  const d = server._accountMoveDepsForTest();
  assert.ok(d.handoffFirst, 'no handoff step on the move');
  for (const k of ['ask', 'isFresh', 'pickup']) assert.equal(typeof d.handoffFirst[k], 'function', k + ' missing');
});

test('an agent that is not running is not asked, with the reason', async () => {
  const d = server._accountMoveDepsForTest();
  assert.deepEqual(await d.handoffFirst.ask('nobody-here'), { asked: false, why: null }, 'not running: the move already says so');
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

test('signed out: not asked; a usage-limit report that may be stale IS asked (review 7: autobalance\'s own rule)', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  recordSends(t);
  const asBlocked = server._moveHandoffDepsForTest({ roster: () => cardIn('idle', { state: 'blocked', limitReported: true }), startedAt: async () => 1 });
  assert.equal((await asBlocked.ask('mara')).asked, true, 'a report that may be hours stale lost a handoff it could write');
  const signedOut = server._moveHandoffDepsForTest({ roster: () => cardIn('auth_failed') });
  assert.deepEqual(await signedOut.ask('mara'), { asked: false, why: 'it was signed out, so it could not write one.' });
});

test('an idle agent is asked with #3492\'s prompt naming its handoff path, without the moved note', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  const sent = recordSends(t);
  const d = server._moveHandoffDepsForTest({ roster: () => cardIn('idle'), startedAt: async () => 100 });
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
  const fresh = d.isFresh('mara', got.before);
  assert.ok(fresh && Number.isFinite(fresh.mtimeMs) && fresh.busy === false, 'a written handoff answers its time, and that the agent is idle');
});

test('the pickup waits for the NEW session to be up and idle, then types the pickup line', async (t) => {
  const sent = recordSends(t);
  let start = Date.now() - 60 * 60 * 1000;   // the old session, an hour old
  let state = 'working';
  const d = server._moveHandoffDepsForTest({
    roster: () => cardIn(state),
    startedAt: async () => start, readyWaitMs: 3000, pollMs: 5,
  });
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  await d.ask('mara');   // records the old session's start (100)
  sent.length = 0;
  const p = d.pickup('mara', '/h/mara.md');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, 0, 'typed while the old session was still the one up');
  start = Date.now();   // the new session is up, started after the ask
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, 0, 'typed before the new session read idle');
  state = 'idle';
  assert.deepEqual(await p, { ok: true });
  assert.deepEqual(sent.map((x) => [x[0], x[1]]), [['automatic', 'mara']]);
  assert.ok(sent[0][2].includes('Read your handoff at /h/mara.md'));
});

test('a pickup whose new session never comes up gives up, says it did not land, and writes that for the person', async (t) => {
  const sent = recordSends(t);
  const notes = [];
  const d = server._moveHandoffDepsForTest({ roster: () => [], startedAt: async () => null, readyWaitMs: 40, pollMs: 5,
    tell: (n, text) => notes.push([n, text]) });
  assert.deepEqual(await d.pickup('mara', '/h/mara.md'), { ok: false });
  assert.equal(sent.length, 0);
  assert.equal(notes.length, 1, 'the person is not told the pickup did not land');
  assert.match(notes[0][1], /could not point its new\s+session at it\. Ask it to read its handoff/);
});

test('a new session busy from the start is typed to at the deadline; no new session at all is not', async (t) => {
  const sent = recordSends(t);
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  let start = Date.now() - 60 * 60 * 1000;
  const d = server._moveHandoffDepsForTest({ roster: () => cardIn('working'),
    startedAt: async () => start, readyWaitMs: 60, pollMs: 5 });
  await d.ask('mara');
  sent.length = 0;
  start = Date.now();
  assert.deepEqual(await d.pickup('mara', '/h/mara.md'), { ok: true }, 'a busy new session still gets the line');
  // CONTROL: the old session never went away (its start never changed): nothing is typed.
  const d2 = server._moveHandoffDepsForTest({ roster: () => cardIn('idle'),
    startedAt: async () => 5000, readyWaitMs: 40, pollMs: 5 });
  await d2.ask('mara');
  sent.length = 0;
  assert.deepEqual(await d2.pickup('mara', '/h/mara.md'), { ok: false });
  assert.equal(sent.length, 0, 'typed into the old session');
});

test('a start unreadable at the ask cannot let the OLD session pass as new', async (t) => {
  const sent = recordSends(t);
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  let reads = 0;
  const old = Date.now() - 60 * 60 * 1000;
  const d = server._moveHandoffDepsForTest({ roster: () => cardIn('idle'),
    startedAt: async () => (reads++ === 0 ? null : old), readyWaitMs: 40, pollMs: 5 });
  await d.ask('mara');   // the start could not be read here
  sent.length = 0;
  assert.deepEqual(await d.pickup('mara', '/h/mara.md'), { ok: false }, 'the old, idle session took the pickup');
  assert.equal(sent.length, 0);
});

// Review 3: where no session start can be read (Windows reads it from tmux), the pickup waits as #3492's page does.
test('no readable start (Windows): a gap after the ask, then idle, is the new session', async (t) => {
  const sent = recordSends(t);
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  let state = 'idle';
  const d = server._moveHandoffDepsForTest({ roster: () => (state === 'gone' ? [] : cardIn(state)),
    startedAt: async () => null, readyWaitMs: 2000, pollMs: 5, minGapMs: 1500 });
  await d.ask('mara');
  sent.length = 0;
  state = 'gone';   // the old session went away
  const p = d.pickup('mara', '/h/mara.md');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sent.length, 0, 'typed during the gap');
  state = 'idle';   // the new one is up
  assert.deepEqual(await p, { ok: true });
  assert.equal(sent.length, 1);
});

test('no readable start and no gap seen: idle counts only after the minimum wait', async (t) => {
  const sent = recordSends(t);
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  const d = server._moveHandoffDepsForTest({ roster: () => cardIn('idle'),
    startedAt: async () => null, readyWaitMs: 2000, pollMs: 5, minGapMs: 80 });
  await d.ask('mara');
  sent.length = 0;
  const t0 = Date.now();
  assert.deepEqual(await d.pickup('mara', '/h/mara.md'), { ok: true });
  assert.ok(Date.now() - t0 >= 75, 'typed before the minimum wait, on a status that may not have caught up');
});

test('at the deadline a new session that cannot take a turn (out of usage) is not typed to', async (t) => {
  const sent = recordSends(t);
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  let state = 'idle';
  let start = Date.now() - 60 * 60 * 1000;
  const d = server._moveHandoffDepsForTest({ roster: () => cardIn(state),
    startedAt: async () => start, readyWaitMs: 40, pollMs: 5 });
  await d.ask('mara');
  sent.length = 0;
  start = Date.now();
  state = 'rate_limited';
  assert.deepEqual(await d.pickup('mara', '/h/mara.md'), { ok: false });
  assert.equal(sent.length, 0);
});

test('the board says whether the agent is still busy beside the fresh file', async (t) => {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  recordSends(t);
  let state = 'idle';
  const d = server._moveHandoffDepsForTest({ roster: () => cardIn(state), startedAt: async () => 1 });
  const got = await d.ask('mara');
  fs.mkdirSync(path.dirname(got.path), { recursive: true });
  fs.writeFileSync(got.path, '# half\n');
  state = 'working';
  assert.equal(d.isFresh('mara', got.before).busy, true, 'not said to be busy while its turn was still writing it');
  state = 'needs_you';
  assert.equal(d.isFresh('mara', got.before).busy, true, 'a permission prompt mid-write is busy too');
  state = 'idle';
  assert.equal(d.isFresh('mara', got.before).busy, false);
});

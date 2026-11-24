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

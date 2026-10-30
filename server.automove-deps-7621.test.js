'use strict';

/**
 * kosmos#7621 item 1: the live mover's REAL wiring is run, not only matched as source text. The board's own deps
 * (server.js automoveDeps, exported as _automoveDepsForTest) are built in a sandboxed board, each answers in the shape
 * engine/automove.js reads, and a real tick through them runs to its end with moves on.
 *
 *   node --test server.automove-deps-7621.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7621deps-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
fs.writeFileSync(path.join(SANDBOX, 'panes.txt'), '');

const server = require('./server');
const automove = require('./engine/automove');

test.after(() => { delete process.env.AGENT_WORKFORCE_AUTOMOVE; fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('kosmos#7621 item 1: every dep the mover reads is on the board\'s wiring, and answers in the shape it reads', async () => {
  const d = server._automoveDepsForTest();
  for (const k of ['list', 'readUsage', 'agentsOn', 'roster', 'records', 'readCommitment', 'settingOn', 'labelOf', 'movesOn', 'isDefaultDir',
    'freshRoster', 'freshRecords', 'accountBusy', 'boardRestarting', 'startMove', 'readMove', 'lastSeen', 'sessionStart', 'tell']) {
    assert.equal(typeof d[k], 'function', 'the board does not give the mover ' + k);
  }
  assert.ok(Array.isArray(d.list()), 'list is not the account list');
  assert.equal(d.movesOn(), false, 'CONTROL: moves are off with the switch unset');
  assert.equal(typeof d.accountBusy(), 'boolean');
  assert.equal(typeof d.boardRestarting(), 'boolean');
  assert.ok(Array.isArray(d.freshRoster()), 'freshRoster is not a roster');
  const on = d.agentsOn(path.join(SANDBOX, 'no-such-account'), false);
  assert.ok(on && Array.isArray(on.names) && typeof on.complete === 'boolean', 'agentsOn is not { names, complete }');
  assert.equal(d.lastSeen('nobody-7621'), null, 'lastSeen answered for an agent never seen');
  const s = await d.sessionStart('nobody-7621');
  assert.ok(s === null || Number.isFinite(s), 'sessionStart is not ms or null');
  /* A share of one tick's sweep deps (item 7): the mover's walk is the sweep's own. */
  const shared = server._automoveDepsForTest({ agentsOn: () => ({ names: ['x'], complete: true, moving: [] }), list: () => [], roster: () => [] });
  assert.deepEqual(shared.agentsOn('/a', false).names, ['x'], 'the mover did not use the tick\'s sweep deps');
});

test('kosmos#7621 item 1: a real tick through the board\'s wiring runs to its end, off and on', async () => {
  const file = path.join(SANDBOX, 'record.jsonl');
  const run = automove.create({ file });
  assert.equal((await run.tick(server._automoveDepsForTest())).did, 'off', 'a tick with moves off did something');
  process.env.AGENT_WORKFORCE_AUTOMOVE = '1';
  require('./engine/autobalance-setting').write({ on: true });   // the person's switch, so the tick reaches its reads
  try {
    assert.equal(server._automoveDepsForTest().settingOn(), true, 'CONTROL: the person switch reads on');
    const r = await run.tick(server._automoveDepsForTest());
    assert.equal(r.did, 'nothing', 'a tick on an empty board with moves on answered ' + JSON.stringify(r));
  } finally { delete process.env.AGENT_WORKFORCE_AUTOMOVE; }
});

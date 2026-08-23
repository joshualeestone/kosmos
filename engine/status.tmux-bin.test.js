'use strict';
/**
 * The board's READS go through AGENT_WORKFORCE_TMUX_BIN (#332).
 *
 * Every write in the engine honoured that variable; `engine/status` read bare
 * `tmux` off the PATH. A test that pointed the variable at /bin/echo stubbed
 * the writes and sent every read to the operator's live fleet, so about ten
 * server tests passed here for a reason that does not exist on any other
 * machine. This pins the reads on the variable, with a control on each side:
 * a fake that answers with a fixture pane is SEEN, and /bin/echo (the old
 * stub) is REFUSED rather than silently falling through to the PATH.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-tmuxbin-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'config');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const FAKE = path.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
const status = require('./status');
const fleet = require('../test-support/fleet');   // for `line`, the pane format's own writer; no install here

function withTmux(bin, env, fn) {
  const saved = { bin: process.env.AGENT_WORKFORCE_TMUX_BIN, ...Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])) };
  process.env.AGENT_WORKFORCE_TMUX_BIN = bin;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try { return fn(); } finally {
    if (saved.bin === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = saved.bin;
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('list-panes is read through AGENT_WORKFORCE_TMUX_BIN, so a fixture pane is seen and the PATH is never consulted', () => {
  const panes = path.join(SANDBOX, 'panes.txt');
  fs.writeFileSync(panes, fleet.line({ session: 'fixture-discord', title: 'working' }) + '\n');
  const board = withTmux(FAKE, { AGENT_WORKFORCE_FAKE_PANES: panes }, () => status.snapshot());
  assert.ok(Array.isArray(board.agents), 'no board came back');
  assert.ok(board.agents.some((a) => a.sessionName === 'fixture'),
    'the fixture pane was not seen, so the read went somewhere other than the variable: ' + JSON.stringify(board.agents.map((a) => a.sessionName)));
});

test('CONTROL: /bin/echo as the tmux is refused, not passed over to the real tmux', () => {
  /* The old stub. If this ever reads a real board, the fallthrough is back. */
  let threw = null;
  try { withTmux('/bin/echo', {}, () => status.snapshot()); } catch (e) { threw = e; }
  assert.ok(threw, 'echo as tmux produced a board, which means the read fell through to the PATH');
  assert.match(String(threw.message), /could not read it|make sense/, String(threw.message));
});

test('an empty fixture is an empty board, not a refusal (a Mac with no agents is a valid state)', () => {
  const board = withTmux(FAKE, {}, () => status.snapshot());
  assert.deepEqual(board.agents, [], JSON.stringify(board.agents));
});

test('no server test points the tmux variable at /bin/echo', () => {
  const root = path.join(__dirname, '..');
  for (const f of fs.readdirSync(root).filter((x) => /^server.*\.test\.js$/.test(x))) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/AGENT_WORKFORCE_TMUX_BIN = '\/bin\/echo'/.test(src), f + ' stubs the writes with echo and leaves the reads on the live fleet');
  }
});

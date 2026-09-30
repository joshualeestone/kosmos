'use strict';
/* #4588 PR B: chat.deliverAutomatic. Its own file because it replaces node:child_process's runners with a recording
 * spy BEFORE chat.js is required (chat.js destructures execFileSync at require time), which would break the fleet
 * fixture the sibling suite uses. With the spy in place nothing in this process can reach tmux, so "typed nothing"
 * is measured (zero spy calls), not assumed; the cards are also ones deliver() refuses before any keystroke
 * (no isNamedOurs), so even without the spy no pane could be typed into.
 *
 *   node --test engine/agyhold-deliver-4588.test.js
 */

require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-agyhold-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

/* Every process runner, replaced before any engine module is loaded. A call is recorded and refused. */
const cp = require('node:child_process');
const SPAWNED = [];
for (const k of ['execFileSync', 'execSync', 'spawnSync', 'execFile', 'exec', 'spawn', 'fork']) {
  cp[k] = (...args) => { SPAWNED.push([k, args[0], Array.isArray(args[1]) ? args[1].slice(0, 3) : null]); throw new Error('agyhold test: no process may be started (' + k + ')'); };
}

const test = require('node:test');
// agyquota remembers the latest pool reset it has seen (the release tail); each test starts with none.
test.beforeEach(() => { require('./agyquota').POOL_MEMO.bySession.clear(); require('./agyquota').POOL_MEMO.seen.clear(); });
const assert = require('node:assert/strict');
const store = require('./store');
const chat = require('./chat');
const { DELIVERY } = chat;

require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [store.ROOT]);
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

/* Real cards from the real producer (fleet + status.snapshot()), never hand-built (fixture-discipline.test.js), as
   engine/agyquota-4588.test.js builds them. They are built with the spy above already in place, so status.js and chat.js
   hold only the spy; the one refused tmux probe the snapshot makes while building them is cleared below, and every
   test resets SPAWNED before it measures. Each test spreads a real card and overrides only its scenario's fields.
   isNamedOurs is set back to undefined: the pool still counts the card (only isNamedOurs === false leaves it), and
   deliver() refuses a card that is not isNamedOurs === true before any keystroke, as it refused the rows this replaced.
   The targets point at panes that do not exist, so even past that refusal nothing real could be typed into. */
const fleet = require('../test-support/fleet');
const status = require('./status');
const AGY_SPEC = { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' };
const CARDS = (() => {
  const board = fleet.install([fleet.agent('agy-paused', AGY_SPEC), fleet.agent('agy-idle', AGY_SPEC), fleet.agent('claude-idle', { state: 'idle' }),
    fleet.agent('agy-stopped', { ...AGY_SPEC, state: 'stopped', command: '-zsh' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
SPAWNED.length = 0;
const realCard = (s) => { const c = CARDS.find((x) => x.sessionName === s); assert.ok(c, 'fixture: no real card for ' + s); return { ...c }; };
function roster(quotaUntil) {
  return [
    { ...realCard('agy-paused'), name: 'A', state: 'rate_limited', quotaUntil, isNamedOurs: undefined, target: 'kt-agyhold-none:9.9' },
    { ...realCard('agy-idle'), name: 'B', state: 'idle', quotaUntil: null, isNamedOurs: undefined, target: 'kt-agyhold-none:9.8' },
    { ...realCard('claude-idle'), name: 'C', state: 'idle', quotaUntil: null, isNamedOurs: undefined, target: 'kt-agyhold-none:9.7' },
  ];
}

/* Review round 6: the gate holds only a pane chat.addressable would type into, so the held arms need the agy cards as
   ours (isNamedOurs true, as the snapshot built them). A held verdict returns before deliver(), and the spy above still
   refuses any process, so nothing can be typed. */
function heldRoster(quotaUntil) {
  return roster(quotaUntil).map((c) => (c.runner === 'antigravity' ? { ...c, isNamedOurs: true } : c));
}

test('#4588 B fixture: the real cards carry the runners the tests assume, and none reads as ours', () => {
  const r = roster(null);
  assert.deepEqual(r.map((c) => [c.sessionName, c.runner]), [['agy-paused', 'antigravity'], ['agy-idle', 'antigravity'], ['claude-idle', 'claude']]);
  assert.equal(r.some((c) => c.isNamedOurs === true), false, 'fixture: a card reads as ours, so deliver() could reach the keystroke');
});

test('#4588 B deliverAutomatic: a held agy target (the paused one AND its idle colleague) is COULD_NOT, held, with the reset, and nothing is run', () => {
  const until = new Date(Date.now() + 30 * 60e3).toISOString();
  for (const target of ['agy-paused', 'agy-idle']) {
    SPAWNED.length = 0;
    const v = chat.deliverAutomatic(target, 'carry on', heldRoster(until));
    assert.equal(v.state, DELIVERY.COULD_NOT, target);
    assert.equal(v.held, true, target + ': only the new held branch sets held');
    assert.equal(v.heldUntil, until, target);
    assert.match(v.because, /quota/);
    assert.deepEqual(SPAWNED, [], target + ': a held line started a process');
  }
});

test('#4588 B deliverAutomatic CONTROL: the same target when the pool is not held carries no held field', () => {
  const past = new Date(Date.now() - 60e3).toISOString();
  for (const target of ['agy-paused', 'agy-idle']) {
    SPAWNED.length = 0;
    const v = chat.deliverAutomatic(target, 'carry on', roster(past));
    assert.equal(v.state, DELIVERY.COULD_NOT, 'fixture: deliver() must refuse this hand-built card before typing');
    assert.equal('held' in v, false, target + ': a reset in the past still held the line');
    assert.equal('heldUntil' in v, false);
    assert.deepEqual(SPAWNED, [], 'fixture: the refusal must come before any process');
  }
  // A claude target beside a HELD pool is not held either: it draws on no Google quota.
  const until = new Date(Date.now() + 30 * 60e3).toISOString();
  const claude = chat.deliverAutomatic('claude-idle', 'carry on', roster(until));
  assert.equal('held' in claude, false, 'a claude agent was held on the Google pool');
});

test('#4588 B deliverAutomatic vs deliver: the person\'s own path (deliver) is never held', () => {
  const until = new Date(Date.now() + 30 * 60e3).toISOString();
  SPAWNED.length = 0;
  const v = chat.deliver('agy-idle', 'a person wrote this', roster(until));
  assert.equal('held' in v, false, 'deliver() held a person\'s message');
  assert.deepEqual(SPAWNED, []);
});

test('#4588 B review 6: a STOPPED agy member (no Antigravity in its pane) is not held during a pool pause; it is refused with its real reason, and nothing is run. CONTROL: a reachable one is held', async () => {
  const until = new Date(Date.now() + 30 * 60e3).toISOString();
  const stopped = { ...realCard('agy-stopped'), name: 'S', state: 'stopped', quotaUntil: null, target: 'kt-agyhold-none:9.6' };
  assert.equal(stopped.isNamedOurs, true, 'fixture: the stopped card must be ours, so only its pane makes it untypeable');
  assert.equal(stopped.isAgentPane, false, 'fixture: the stopped card has an agent in its pane');
  const r = [...heldRoster(until), stopped];
  for (const [how, call] of [['sync', () => chat.deliverAutomatic('agy-stopped', 'carry on', r)], ['async', () => chat.deliverAutomaticAsync('agy-stopped', 'carry on', r)]]) {
    SPAWNED.length = 0;
    const v = await call();
    assert.equal(v.state, DELIVERY.COULD_NOT, how);
    assert.equal('held' in v, false, how + ': a stopped pane was held for the quota, as if it could be typed after the reset');
    assert.equal('heldUntil' in v, false, how);
    assert.match(v.because, /no Antigravity running/, how + ': not refused with its real reason');
    assert.deepEqual(SPAWNED, [], how + ': a refused line started a process');
  }
  SPAWNED.length = 0;
  const control = chat.deliverAutomatic('agy-idle', 'carry on', r);
  assert.equal(control.held, true, 'CONTROL: a reachable agy member in the same roster is held');
  assert.deepEqual(SPAWNED, []);
});

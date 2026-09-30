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

/* Hand-built rows in the shape the board card carries (sessionName, runner, quotaUntil, state), as
   engine/agyquota-4588.test.js builds them. No isNamedOurs: deliver() refuses them before any keystroke. */
function roster(quotaUntil) {
  return [
    { sessionName: 'agy-paused', name: 'A', runner: 'antigravity', state: 'rate_limited', quotaUntil, target: 'kt-agyhold-none:9.9' },
    { sessionName: 'agy-idle', name: 'B', runner: 'antigravity', state: 'idle', quotaUntil: null, target: 'kt-agyhold-none:9.8' },
    { sessionName: 'claude-idle', name: 'C', runner: 'claude', state: 'idle', quotaUntil: null, target: 'kt-agyhold-none:9.7' },
  ];
}

test('#4588 B deliverAutomatic: a held agy target (the paused one AND its idle colleague) is COULD_NOT, held, with the reset, and nothing is run', () => {
  const until = new Date(Date.now() + 30 * 60e3).toISOString();
  for (const target of ['agy-paused', 'agy-idle']) {
    SPAWNED.length = 0;
    const v = chat.deliverAutomatic(target, 'carry on', roster(until));
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

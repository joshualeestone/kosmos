'use strict';
/* #4588 part 3: the Direct Message account line for an agent held by a colleague's pause on the same Google account. */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
// Sandbox every root BEFORE requiring any engine module (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-agypoolcard-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const { accountProblemOf } = require('./accountproblem');

// A real agy card from the real producer (fixture-discipline.test.js: no hand-built cards), copied per case with only
// the fields the case is about.
const CARD = (() => {
  const board = fleet.install([fleet.agent('ada', { state: 'unknown', runner: 'antigravity', command: 'agy', screen: '' })]);
  try {
    const c = status.snapshot().agents.find((x) => x.sessionName === 'ada');
    assert.ok(c && c.runner === 'antigravity', 'fixture: no real antigravity card for ada');
    return { ...c };
  } finally { board.restore(); }
})();
const card = (over) => ({ ...CARD, state: 'rate_limited', stateEvidence: null, ...over });

test('#4588 part 3: a pool-held agy card gets its own line: no "add credits", no "send it a message", no promise, not typed into a manager; CONTROL: its own pause keeps PR A\'s line', () => {
  const until = new Date(Date.now() + 3600e3).toISOString();
  const held = accountProblemOf(card({ quotaUntil: null, poolUntil: until }));
  assert.ok(held, 'no account line for a pool-held card');
  assert.match(held.text, /waiting for its Google account's shared Antigravity quota/);
  assert.match(held.text, /It was reported paused until /);
  assert.doesNotMatch(held.text, /credits|send it a message|looks like|carries on|another/i, 'no advice to spend a turn, and no promise or claim it cannot keep');
  assert.equal(held.notify, false);
  const own = accountProblemOf(card({ quotaUntil: until, poolUntil: null }));
  assert.match(own.text, /has used up its Google account's Antigravity quota/, 'CONTROL');
  const stale = accountProblemOf(card({ quotaUntil: null, poolUntil: new Date(Date.now() - 60e3).toISOString() }));
  assert.ok(stale, 'a pool-held card with a past time got no line');
  assert.doesNotMatch(stale.text, /paused until/, 'a past poolUntil was said as "paused until"');
  assert.doesNotMatch(stale.text, /credits|send it a message|looks like/i, 'a stale pool-held card fell to the generic advice');
  assert.match(stale.text, /shared Antigravity quota/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const machine = require('./machine');

/**
 * #3182: the per-agent RunAtLoad loaded-check -- the agent analog of
 * boardAutostartCheck (#2397). These pin every branch of the aggregation on the
 * injected opts.disabled / opts.removed seams (a pure logic test, no launchctl),
 * plus one integration arm that threads a fake runner through
 * create.disabledJobsResult, and a never-mutates guard.
 *
 * The disabled shape mirrors create.disabledJobsResult(): { ok, jobs } where jobs
 * is a Set of world-scoped agent names (an Array is accepted too). removed mirrors
 * remove.removedNames(): { ok, names }.
 */

const DARWIN = { platform: 'darwin' };

test('#3182 off darwin the row is omitted (null), like the board arm', () => {
  assert.equal(machine.agentAutostartCheck(null, { platform: 'linux', disabled: { ok: true, jobs: [] } }), null);
  assert.equal(machine.agentAutostartCheck(null, { platform: 'win32', disabled: { ok: true, jobs: [] } }), null);
});

test('#3182 an unreadable disabled list is UNKNOWN, not a false OK', () => {
  const got = machine.agentAutostartCheck(null, { ...DARWIN, disabled: { ok: false } });
  assert.equal(got.key, 'agentautostart');
  assert.equal(got.state, machine.STATE.UNKNOWN);
  // could-not-look, said as such -- never "your agents are fine".
  assert.match(got.title, /could not check/i);
});

test('#3182 no disabled agents -> OK (they come back after a restart)', () => {
  const got = machine.agentAutostartCheck(null, { ...DARWIN, disabled: { ok: true, jobs: [] } });
  assert.equal(got.key, 'agentautostart');
  assert.equal(got.state, machine.STATE.OK);
  assert.match(got.title, /start themselves/i);
});

test('#3182 a Set of disabled jobs is accepted (the real disabledJobsResult shape)', () => {
  const got = machine.agentAutostartCheck(null, { ...DARWIN, disabled: { ok: true, jobs: new Set() } });
  assert.equal(got.state, machine.STATE.OK);
});

test('#3182 one disabled live agent -> ATTENTION, named, singular wording', () => {
  const got = machine.agentAutostartCheck(null, {
    ...DARWIN,
    disabled: { ok: true, jobs: ['casey'] },
    removed: { ok: true, names: [] },
  });
  assert.equal(got.state, machine.STATE.ATTENTION);
  assert.match(got.title, /^An agent is/);
  assert.match(got.detail, /casey/);
  assert.match(got.detail, /it will not come back on its own/);
  assert.match(got.detail, /Login Items/);
});

test('#3182 several disabled live agents -> ATTENTION, plural, count in the title, sorted', () => {
  const got = machine.agentAutostartCheck(null, {
    ...DARWIN,
    disabled: { ok: true, jobs: ['charlie', 'alice', 'bob'] },
    removed: { ok: true, names: [] },
  });
  assert.equal(got.state, machine.STATE.ATTENTION);
  assert.match(got.title, /^3 agents are/);
  // sorted, so the order is stable regardless of the set's iteration order.
  assert.match(got.detail, /alice, bob, charlie/);
  assert.match(got.detail, /they will not come back on their own/);
});

test('#3182 a disabled agent that has been REMOVED is not flagged (it is not expected to come back)', () => {
  const got = machine.agentAutostartCheck(null, {
    ...DARWIN,
    disabled: { ok: true, jobs: ['gone'] },
    removed: { ok: true, names: ['gone'] },
  });
  assert.equal(got.state, machine.STATE.OK);
});

test('#3182 mix: a live disabled agent surfaces, a removed disabled one does not', () => {
  const got = machine.agentAutostartCheck(null, {
    ...DARWIN,
    disabled: { ok: true, jobs: ['live', 'removedone'] },
    removed: { ok: true, names: ['removedone'] },
  });
  assert.equal(got.state, machine.STATE.ATTENTION);
  assert.match(got.title, /^An agent is/);   // only the one live agent
  assert.match(got.detail, /live/);
  assert.doesNotMatch(got.detail, /removedone/);
});

test('#3182 more than three concerning -> first three named plus an "and N more"', () => {
  const got = machine.agentAutostartCheck(null, {
    ...DARWIN,
    disabled: { ok: true, jobs: ['e', 'd', 'c', 'b', 'a'] },
    removed: { ok: true, names: [] },
  });
  assert.equal(got.state, machine.STATE.ATTENTION);
  assert.match(got.title, /^5 agents are/);
  assert.match(got.detail, /a, b, c, and 2 more/);
});

test('#3182 an unreadable removed list falls back to none-removed (surfaces the live disabled agent, the safe direction)', () => {
  const got = machine.agentAutostartCheck(null, {
    ...DARWIN,
    disabled: { ok: true, jobs: ['x'] },
    removed: { ok: false },
  });
  assert.equal(got.state, machine.STATE.ATTENTION);
  assert.match(got.detail, /x/);
});

test('#3182 integration: a fake launchctl print-disabled threads through create.disabledJobsResult', () => {
  // No opts.disabled, so the check reads through create.disabledJobsResult(runner);
  // the fake runner returns a print-disabled dump naming a disabled agent in the
  // (default) current world. This proves the seam threads to the real parser.
  const runner = (bin, args) => {
    if (bin === '/bin/launchctl' && args[0] === 'print-disabled') {
      return { ok: true, stdout: '\t"com.kosmos.agent.zeta" => disabled\n\t"com.kosmos.board" => enabled\n' };
    }
    return { ok: true, stdout: '' };
  };
  const got = machine.agentAutostartCheck(runner, { ...DARWIN, removed: { ok: true, names: [] } });
  assert.equal(got.state, machine.STATE.ATTENTION);
  assert.match(got.detail, /zeta/);
  // the board's own label is NOT an agent -> never counted here.
  assert.doesNotMatch(got.detail, /board/);
});

test('#3182 the check never runs a mutating launchctl verb (read-only, like the board arm)', () => {
  const seen = [];
  const spy = (bin, args) => { seen.push((args && args[0]) || ''); return { ok: true, stdout: '' }; };
  machine.agentAutostartCheck(spy, { ...DARWIN, removed: { ok: true, names: [] } });
  for (const verb of seen) {
    assert.ok(!/^(bootstrap|bootout|enable|disable|load|unload|kickstart|remove|kill)$/.test(verb),
      `a mutating launchctl verb reached the per-agent autostart check: ${verb}`);
  }
});

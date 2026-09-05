'use strict';
/* #1279: engine/team.js createTeam -- a PM agent builds a team for a stated
   purpose. These are hermetic: createAgent is INJECTED, so nothing here writes a
   real agent. They pin the two safety rails (a Kosmos-owned cap, and createdBy +
   purpose provenance on every member) and the whole-or-partial outcome. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTeam, DEFAULT_TEAM_CAP } = require('./team');

/* A fake createAgent that records every opts it was handed and answers per a
   per-name script, so a test can make some members succeed and others refuse. */
function fakeCreator(script) {
  const calls = [];
  const fn = (opts) => {
    calls.push(opts);
    const name = opts && opts.name;
    const verdict = (script && Object.prototype.hasOwnProperty.call(script, name)) ? script[name] : { outcome: 'created' };
    if (verdict.outcome === 'created') return { outcome: 'created', name, id: verdict.id || ('id-' + name) };
    return { outcome: 'refused', because: verdict.because || 'refused' };
  };
  fn.calls = calls;
  return fn;
}

const okDeps = (script, env) => ({ createAgent: fakeCreator(script), env: env || {} });

test('#1279: a full team is created; every member carries createdBy + purpose', () => {
  const deps = okDeps();
  const r = createTeam({
    creator: 'ProjectManagerPete',
    purpose: 'ship the Windows installer',
    members: [
      { name: 'BuildBot', role: 'engineer' },
      { name: 'TestBot', role: 'qa' },
    ],
  }, deps);

  assert.equal(r.outcome, 'created');
  assert.equal(r.created.length, 2);
  assert.equal(r.refused.length, 0);
  assert.equal(r.because, null);
  assert.deepEqual(r.created.map((c) => c.name).sort(), ['BuildBot', 'TestBot']);
  assert.ok(r.created.every((c) => typeof c.id === 'string'), 'each created agent reports its id');

  // The whole point: provenance rides onto EVERY member.
  for (const call of deps.createAgent.calls) {
    assert.equal(call.createdBy, 'ProjectManagerPete', 'member did not carry the creator');
    assert.equal(call.purpose, 'ship the Windows installer', 'member did not carry the purpose');
  }
  // ...and the member's own fields survive alongside it.
  assert.equal(deps.createAgent.calls[0].role, 'engineer');
});

test('#1279: a member cannot forge its own createdBy/purpose -- the team is the authority', () => {
  const deps = okDeps();
  createTeam({
    creator: 'RealCreator',
    purpose: 'the real purpose',
    members: [{ name: 'Sneaky', role: 'engineer', createdBy: 'SomeoneElse', purpose: 'a different story' }],
  }, deps);
  assert.equal(deps.createAgent.calls[0].createdBy, 'RealCreator', 'a member overwrote the recorded creator');
  assert.equal(deps.createAgent.calls[0].purpose, 'the real purpose', 'a member overwrote the recorded purpose');
});

test('#1279: some made, some refused -> PARTIAL, with the split named', () => {
  const deps = okDeps({ TestBot: { outcome: 'refused', because: 'pick what this agent is for' } });
  const r = createTeam({
    creator: 'PM',
    purpose: 'x',
    members: [{ name: 'BuildBot', role: 'engineer' }, { name: 'TestBot', role: '' }],
  }, deps);
  assert.equal(r.outcome, 'partial');
  assert.equal(r.created.length, 1);
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].name, 'TestBot');
  assert.match(r.refused[0].because, /pick what this agent is for/);
  assert.match(r.because, /1 of 2 agents were created/);
});

test('#1279: none made -> REFUSED (not partial)', () => {
  const deps = okDeps({ A: { outcome: 'refused' }, B: { outcome: 'refused' } });
  const r = createTeam({ creator: 'PM', purpose: 'x', members: [{ name: 'A', role: 'r' }, { name: 'B', role: 'r' }] }, deps);
  assert.equal(r.outcome, 'refused');
  assert.equal(r.created.length, 0);
  assert.equal(r.refused.length, 2);
});

test('#1279: a creator is required -- no provenance, no team', () => {
  const deps = okDeps();
  for (const bad of [undefined, '', '   ', 42]) {
    const r = createTeam({ creator: bad, purpose: 'x', members: [{ name: 'A', role: 'r' }] }, deps);
    assert.equal(r.outcome, 'refused', `creator ${JSON.stringify(bad)} was accepted`);
    assert.match(r.because, /a team needs a creator/);
  }
  assert.equal(deps.createAgent.calls.length, 0, 'createAgent was called despite a pre-flight refusal');
});

test('#1279: a purpose is required -- recording WHY is the drift guard', () => {
  const deps = okDeps();
  const r = createTeam({ creator: 'PM', purpose: '   ', members: [{ name: 'A', role: 'r' }] }, deps);
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, /a team needs a stated purpose/);
  assert.equal(deps.createAgent.calls.length, 0);
});

test('#1279: members must be a non-empty array', () => {
  const deps = okDeps();
  const notArray = createTeam({ creator: 'PM', purpose: 'x', members: { name: 'A' } }, deps);
  assert.equal(notArray.outcome, 'refused');
  assert.match(notArray.because, /give the team as a list of members/);
  const empty = createTeam({ creator: 'PM', purpose: 'x', members: [] }, deps);
  assert.equal(empty.outcome, 'refused');
  assert.match(empty.because, /no members is nothing to build/);
  assert.equal(deps.createAgent.calls.length, 0);
});

test('#1279: THE CAP -- Kosmos refuses a too-large team and creates NONE of it', () => {
  const deps = okDeps();
  const members = Array.from({ length: DEFAULT_TEAM_CAP + 1 }, (_, i) => ({ name: 'A' + i, role: 'r' }));
  const r = createTeam({ creator: 'PM', purpose: 'x', members }, deps);
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, new RegExp(String(DEFAULT_TEAM_CAP + 1) + ' agents in one request and the cap is ' + DEFAULT_TEAM_CAP));
  assert.equal(deps.createAgent.calls.length, 0, 'the cap must refuse BEFORE creating any agent, not trim');
});

test('#1279: exactly at the cap is allowed', () => {
  const deps = okDeps();
  const members = Array.from({ length: DEFAULT_TEAM_CAP }, (_, i) => ({ name: 'A' + i, role: 'r' }));
  const r = createTeam({ creator: 'PM', purpose: 'x', members }, deps);
  assert.equal(r.outcome, 'created');
  assert.equal(r.created.length, DEFAULT_TEAM_CAP);
});

test('#1279: the cap is overridable -- opts.cap, then env, then the default', () => {
  // opts.cap raises it
  let deps = okDeps();
  const members = Array.from({ length: DEFAULT_TEAM_CAP + 1 }, (_, i) => ({ name: 'A' + i, role: 'r' }));
  assert.equal(createTeam({ creator: 'PM', purpose: 'x', members, cap: DEFAULT_TEAM_CAP + 1 }, deps).outcome, 'created');
  // env raises it when opts.cap is absent
  deps = okDeps(null, { AGENT_WORKFORCE_TEAM_CAP: String(DEFAULT_TEAM_CAP + 1) });
  assert.equal(createTeam({ creator: 'PM', purpose: 'x', members }, deps).outcome, 'created');
  // opts.cap lowers it too, and refuses below the request
  deps = okDeps();
  const two = createTeam({ creator: 'PM', purpose: 'x', members: [{ name: 'A', role: 'r' }, { name: 'B', role: 'r' }], cap: 1 }, deps);
  assert.equal(two.outcome, 'refused');
  assert.match(two.because, /the cap is 1/);
  // an invalid cap falls through to the default rather than disabling the bound
  deps = okDeps(null, { AGENT_WORKFORCE_TEAM_CAP: 'not-a-number' });
  const over = createTeam({ creator: 'PM', purpose: 'x', members, cap: 0 }, deps);
  assert.equal(over.outcome, 'refused', 'cap:0 and a garbage env must not disable the cap');
  assert.match(over.because, new RegExp('the cap is ' + DEFAULT_TEAM_CAP));
});

test('#1279: a malformed member is refused by shape and never reaches createAgent', () => {
  const deps = okDeps();
  const r = createTeam({ creator: 'PM', purpose: 'x', members: [{ name: 'Good', role: 'r' }, 'not-an-object', null, ['array']] }, deps);
  assert.equal(r.outcome, 'partial');
  assert.equal(r.created.length, 1);
  assert.equal(r.refused.length, 3);
  assert.ok(r.refused.every((x) => /must be a create spec object/.test(x.because)));
  assert.equal(deps.createAgent.calls.length, 1, 'only the well-formed member reached createAgent');
});

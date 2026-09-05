'use strict';
/* #1279: engine/team.js createTeam -- a PM agent builds a team for a stated
   purpose. These are hermetic: createAgent is INJECTED, so nothing here writes a
   real agent. They pin the two safety rails (a Kosmos-owned cap, and createdBy +
   purpose provenance on every member) and the whole-or-partial outcome. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTeam, DEFAULT_TEAM_CAP, MAX_TEAM_CAP } = require('./team');

/* A fake createAgent that records every opts it was handed and answers per a
   per-name script (keyed on the INPUT name). It returns the REAL
   create.createAgent success shape: NO id (read back from the profile, never
   returned), a SLUGGED `name` (lowercased here, as createAgentInner returns
   slugFor(...)), and a separate `shownAs` display name. Modelling the slug/shown
   split is deliberate -- it is exactly where the team could silently drop the
   display name or read the id back by the wrong string. */
function fakeCreator(script) {
  const calls = [];
  const fn = (opts) => {
    calls.push(opts);
    const input = opts && opts.name;
    const verdict = (script && Object.prototype.hasOwnProperty.call(script, input)) ? script[input] : { outcome: 'created' };
    if (verdict.outcome === 'created') {
      return { outcome: 'created', name: String(input).toLowerCase() /* slug */, shownAs: String(input) };
    }
    return { outcome: 'refused', because: verdict.because || 'refused' };
  };
  fn.calls = calls;
  return fn;
}

/* The profile-id reader the real team reads back through, faked: an agent whose
   SLUG is x has id 'id-x'. Keyed on the slug because that is what createTeam
   reads back by (create.createAgent returns the slug). */
const fakeReadAgentId = (slug) => (slug ? 'id-' + slug : null);

const okDeps = (script, env) => ({ createAgent: fakeCreator(script), readAgentId: fakeReadAgentId, env: env || {} });

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
  /* The created entry carries the SLUG (name, canonical/addressable), the display
     name (shownAs), and the id READ BACK by the slug (create.createAgent returns
     no id) -- everything a caller needs to render and address each new agent. */
  assert.deepEqual(r.created.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: 'buildbot', shownAs: 'BuildBot', id: 'id-buildbot' },
      { name: 'testbot', shownAs: 'TestBot', id: 'id-testbot' },
    ],
    'the created entry dropped the display name or read the id back by the wrong string');

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

test('#1279: the cap is overridable ONLY through the trusted channel -- deps.cap, then env, then the default', () => {
  const members = Array.from({ length: DEFAULT_TEAM_CAP + 1 }, (_, i) => ({ name: 'A' + i, role: 'r' }));
  // deps.cap (the operator/seam channel) raises it
  let deps = { ...okDeps(), cap: DEFAULT_TEAM_CAP + 1 };
  assert.equal(createTeam({ creator: 'PM', purpose: 'x', members }, deps).outcome, 'created');
  // env raises it when deps.cap is absent
  deps = okDeps(null, { AGENT_WORKFORCE_TEAM_CAP: String(DEFAULT_TEAM_CAP + 1) });
  assert.equal(createTeam({ creator: 'PM', purpose: 'x', members }, deps).outcome, 'created');
  // deps.cap lowers it too, and refuses below the request
  deps = { ...okDeps(), cap: 1 };
  const two = createTeam({ creator: 'PM', purpose: 'x', members: [{ name: 'A', role: 'r' }, { name: 'B', role: 'r' }] }, deps);
  assert.equal(two.outcome, 'refused');
  assert.match(two.because, /the cap is 1/);
  // an invalid deps.cap and a garbage env both fall through to the default
  deps = { ...okDeps(null, { AGENT_WORKFORCE_TEAM_CAP: 'not-a-number' }), cap: 0 };
  const over = createTeam({ creator: 'PM', purpose: 'x', members }, deps);
  assert.equal(over.outcome, 'refused', 'cap:0 and a garbage env must not disable the cap');
  assert.match(over.because, new RegExp('the cap is ' + DEFAULT_TEAM_CAP));
});

test('#1279: opts.cap is IGNORED -- the request cannot raise its own bound (Kosmos owns it)', () => {
  // The security property behind "Kosmos owns the bound, not the prompt": a cap
  // set in opts (the same object that carries members, i.e. the model's request)
  // must have NO effect. A team over the default with a huge opts.cap is refused.
  const deps = okDeps();
  const members = Array.from({ length: DEFAULT_TEAM_CAP + 1 }, (_, i) => ({ name: 'A' + i, role: 'r' }));
  const r = createTeam({ creator: 'PM', purpose: 'x', members, cap: 9999 }, deps);
  assert.equal(r.outcome, 'refused', 'a cap in the request raised the bound -- the runaway guard is defeated');
  assert.match(r.because, new RegExp('the cap is ' + DEFAULT_TEAM_CAP));
  assert.equal(deps.createAgent.calls.length, 0);
});

test('#1279: MAX_TEAM_CAP ceiling -- even a trusted override cannot ask for a runaway', () => {
  // deps.cap above the ceiling is bounded to the ceiling, so a request larger
  // than the ceiling is refused and names the ceiling, not the requested cap.
  const deps = { ...okDeps(), cap: 100000 };
  const members = Array.from({ length: MAX_TEAM_CAP + 1 }, (_, i) => ({ name: 'A' + i, role: 'r' }));
  const r = createTeam({ creator: 'PM', purpose: 'x', members }, deps);
  assert.equal(r.outcome, 'refused');
  assert.match(r.because, new RegExp('the cap is ' + MAX_TEAM_CAP), 'the effective cap was not bounded to the ceiling');
  assert.equal(deps.createAgent.calls.length, 0, 'a 100000-cap override let the loop start');
  // ...and exactly at the ceiling is allowed with that override.
  const atCeiling = Array.from({ length: MAX_TEAM_CAP }, (_, i) => ({ name: 'A' + i, role: 'r' }));
  assert.equal(createTeam({ creator: 'PM', purpose: 'x', members: atCeiling }, { ...okDeps(), cap: 100000 }).outcome, 'created');
});

test('#1279: id is null when the profile cannot be read back (DRY_RUN / no profile), never invented', () => {
  // The real readAgentId returns null on a DRY_RUN create that wrote no profile.
  const deps = { createAgent: fakeCreator(), readAgentId: () => null, env: {} };
  const r = createTeam({ creator: 'PM', purpose: 'x', members: [{ name: 'A', role: 'r' }] }, deps);
  assert.equal(r.outcome, 'created');
  assert.equal(r.created[0].id, null, 'an unreadable id was invented rather than left null');
});

test('#1279: duplicate member names -> the second is refused (delegated to createAgent), team is PARTIAL', () => {
  // A stateful fake modelling real createAgent, which refuses a name that already
  // exists ("there is already an agent called X"). createTeam does no de-dup of
  // its own; it forwards both and buckets the refusal.
  const seen = new Set();
  const calls = [];
  const statefulCreate = (opts) => {
    calls.push(opts);
    if (seen.has(opts.name)) return { outcome: 'refused', because: 'there is already an agent called ' + opts.name };
    seen.add(opts.name);
    return { outcome: 'created', name: opts.name };
  };
  const r = createTeam(
    { creator: 'PM', purpose: 'x', members: [{ name: 'Dup', role: 'r' }, { name: 'Dup', role: 'r' }] },
    { createAgent: statefulCreate, readAgentId: fakeReadAgentId, env: {} });
  assert.equal(calls.length, 2, 'both same-named members were forwarded to createAgent');
  assert.equal(r.outcome, 'partial');
  assert.equal(r.created.length, 1);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].because, /already an agent called Dup/);
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

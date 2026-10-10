'use strict';
/**
 * kosmos#5532 (Enterprise E0.3): the rollup body. Pure: no file, no network.
 * The card's done-when includes "no rollup field can carry chat or file text": build() is handed only plain fields,
 * and these tests hand it hostile ones (a secret in every string, markup, bidi, oversize) and read every byte back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FLEET_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'orgrollup-5532-'));
process.on('exit', () => { try { fs.rmSync(FLEET_SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(FLEET_SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(FLEET_SANDBOX, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_SANDBOX, 'workers');
const fleet = require('../test-support/fleet');
const r = require('./orgrollup');

/* Real cards, never hand-built (fixture-discipline.test.js): test-support/fleet runs the real snapshot(). Only `model` is
   set on top (a fixture pane has no transcript to read it from; the rollup reads the RECORDED runner, never the
   card's, so the pane runner stays the default), and `plant` puts CONTENT in every other text field the
   real card carries and in its null content fields (task, waiting and the like), to prove none of it is sent. Sandboxed before anything reads its roots. */
function card(o) {
  // No `name`: no display name is recorded, so the real card carries the session name with nameDerived false.
  const b = fleet.install([o.ours === false ? fleet.stranger(o.key, { state: o.state || 'idle' }) : fleet.agent(o.key, o.name ? { displayName: o.name, state: o.state || 'idle' } : { state: o.state || 'idle' })], { strict: false });
  try {
    const c = Object.assign({}, b.agents[0], { model: o.model === undefined ? null : o.model });
    if (o.plant) {
      for (const k of Object.keys(c)) if (typeof c[k] === 'string' && !['name', 'sessionName', 'state', 'model', 'runner'].includes(k)) c[k] = o.plant;
      // And the content fields a real card leaves null here (review 26), so a future read of one is caught too.
      for (const k of ['task', 'stateEvidence', 'waiting', 'role', 'stateProject', 'modelName']) if (k in c) c[k] = o.plant;
    }
    return c;
  } finally { b.restore(); }
}

const SECRET = 'sk-ant-PLANTED-SECRET-0123456789';
const CONTENT = 'CHAT-AND-FILE-TEXT-MUST-NEVER-LEAVE-9876';   // planted only in fields that hold content, never a name
const DAY = (n) => new Date(Date.UTC(2026, 9, 7 - n)).toISOString().slice(0, 10);

test('#5532: the body has the contract shape, the three status words, and names only', () => {
  const b = r.build({
    world: 'a'.repeat(32), at: '2026-10-07T12:00:00Z', reason: 'daily', lastActive: '2026-10-07T11:00:00Z',
    agents: [
      { name: 'Leo', provider: 'anthropic', model: 'claude-opus-5-5', state: 'working' },
      { name: 'Raph', provider: 'openai', model: 'gpt-5.1', state: 'needs_trust' },
      { name: 'Mikey', provider: 'xai', model: 'grok-4', state: 'auth_failed' },
      { name: 'Donnie', provider: 'google', model: 'gemini-2.5-flash', state: 'unknown' },
      { name: 'April', provider: 'anthropic', model: 'claude-sonnet-5-5', state: 'stopped' },
    ],
    projects: [{ name: 'Launch', agents: ['Leo', 'Raph'] }],
    usageByDay: { [DAY(0)]: { 'claude-opus-5-5': { input_tokens: 1e6, output_tokens: 1e6 }, 'gpt-5.1-codex': { output_tokens: 5 } } },
  });
  assert.deepEqual(Object.keys(b).sort(), ['agents', 'at', 'backup', 'lastActive', 'projects', 'reason', 'truncated', 'usage', 'usageWithheld', 'v', 'world'].sort());
  assert.equal(b.v, 1); assert.equal(b.reason, 'daily'); assert.equal(b.truncated, false);
  assert.deepEqual(b.agents.map((a) => a.status), ['working', 'waiting', 'waiting', 'waiting', 'stopped'], 'the consent names three words: working, waiting, stopped');
  for (const a of b.agents) assert.deepEqual(Object.keys(a).sort(), ['model', 'name', 'provider', 'status']);
  assert.deepEqual(b.projects, [{ name: 'Launch', agents: ['Leo', 'Raph'] }]);
  const opus = b.usage.find((u) => u.model === 'claude-opus-5-5');
  assert.equal(opus.costUsd, 24, 'opus 5.5: $4 in + $20 out per million');
  assert.equal(opus.provider, 'anthropic');
  const codex = b.usage.find((u) => u.model === 'gpt-5.1-codex');
  assert.equal(codex.costUsd, null, 'an unpriced model must say null, never 0');
  assert.equal(codex.provider, 'openai');
  for (const s of Object.values(r.STATUS)) assert.ok(['working', 'waiting', 'stopped'].includes(s), 'a status word the consent does not name: ' + s);
  assert.equal(r.statusWord('something new'), 'waiting');
});

test('#5532 done-when: a planted secret in every free field never reaches the body as more than a cleaned, bounded name', () => {
  const hostile = SECRET + '‮<script>x</script>' + 'y'.repeat(500);
  const b = r.build({
    world: 'a'.repeat(32),
    agents: [{ name: hostile, provider: hostile, model: 'claude-' + hostile, state: hostile, task: CONTENT, transcript: CONTENT, because: CONTENT, folder: '/Users/x/' + CONTENT }],
    projects: [{ name: hostile, agents: [hostile], folder: CONTENT, description: CONTENT, tasks: [CONTENT] }],
    usageByDay: { [DAY(0)]: { [hostile]: { input_tokens: 5 } } },
    policyVersion: hostile,
  });
  const text = JSON.stringify(b);
  assert.equal(text.includes('/Users/'), false, 'a path reached the body');
  assert.equal(text.includes('‮'), false, 'a bidi override reached the body');
  assert.equal(b.policyVersion, null, '#5534: a policy version that is not a whole number was sent');
  for (const s of [b.agents[0].name, b.projects[0].name, b.projects[0].agents[0]]) {
    assert.ok(s.length <= r.NAME_MAX, 'a string over the bound: ' + s.length);
  }
  assert.equal(b.agents[0].provider, null, 'a provider outside the known list was sent');
  assert.equal(b.agents[0].status, 'waiting');
  assert.equal(text.includes(CONTENT), false, 'content (a task, a transcript, a folder, a description) reached the body: ' + text);
  // A name the person chose is sent as a name, cleaned and bounded: three name fields here, and nothing else (#5534: the
  // policy version is a number now, never a string). A model is
  // not one: a string with spaces or markup is not a model id, sent as null for an agent (review 4) and dropped as a
  // usage row (review 8).
  assert.deepEqual(b.usage, [], 'a usage key that is not a model id was sent');
  assert.equal(text.split(SECRET).length - 1, 3, 'the planted name appears in a field that is not a name: ' + text);
  assert.equal(b.agents[0].model, null);
});

test('#5532: bounds (agents, projects, names per project, days, rows per day) set truncated, never refuse', () => {
  const many = (n, f) => Array.from({ length: n }, (_, k) => f(k));
  const usageByDay = {};
  for (let d = 0; d < 10; d += 1) usageByDay[DAY(d)] = Object.fromEntries(many(60, (k) => ['claude-opus-5-' + k, { input_tokens: 1000 + k }]));
  const b = r.build({
    world: 'a'.repeat(32),
    agents: many(250, (k) => ({ name: 'agent ' + k, provider: 'anthropic', model: 'claude-opus-5-5', state: 'idle' })),
    projects: many(250, (k) => ({ name: 'project ' + k, agents: many(80, (j) => 'agent ' + j) })),
    usageByDay,
  });
  assert.equal(b.truncated, true);
  assert.ok(b.agents.length <= r.AGENTS_MAX);
  assert.ok(b.projects.length <= r.PROJECTS_MAX);
  for (const p of b.projects) assert.ok(p.agents.length <= r.NAMES_MAX);
  assert.ok(new Set(b.usage.map((u) => u.day)).size <= r.USAGE_DAYS);
  for (const d of new Set(b.usage.map((u) => u.day))) assert.ok(b.usage.filter((u) => u.day === d).length <= r.USAGE_ROWS_PER_DAY);
  assert.ok(Buffer.byteLength(JSON.stringify(b)) <= r.BODY_MAX, 'over the size cap: ' + Buffer.byteLength(JSON.stringify(b)));
  if (b.usage.length) assert.equal(b.usage[0].day, DAY(0), 'the newest day must survive a trim');
});

test('#5532: a full body at every bound is trimmed to the byte cap, newest usage kept, oldest dropped first', () => {
  const long = (k) => ('n' + k + '-').repeat(40).slice(0, 120);
  const usageByDay = {};
  for (let d = 0; d < 7; d += 1) usageByDay[DAY(d)] = Object.fromEntries(Array.from({ length: 40 }, (_, k) => [long(k), { input_tokens: 10 + k }]));
  const b = r.build({
    world: 'a'.repeat(32),
    agents: Array.from({ length: 200 }, (_, k) => ({ name: long(k), provider: 'anthropic', model: long(k), state: 'idle' })),
    projects: Array.from({ length: 200 }, (_, k) => ({ name: long(k), agents: Array.from({ length: 50 }, (_, j) => long(j)) })),
    usageByDay,
  });
  const size = Buffer.byteLength(JSON.stringify(b));
  assert.ok(size <= r.BODY_MAX, 'over the cap: ' + size);
  assert.equal(b.truncated, true);
  assert.ok(b.agents.length > 0, 'trimmed past usage and projects into nothing');
});

/* Sources as the board would hand them, with content planted wherever a record carries any. */
function sources(over) {
  return Object.assign({
    snapshot: () => ({ counts: { unreadableLines: 0 }, agents: [
      card({ key: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'working', plant: CONTENT }),
      card({ key: 'raph', name: 'Raph', runner: 'codex', model: 'gpt-5.1', state: 'needs_you', plant: CONTENT }),
      card({ key: 'stranger', name: 'Stranger', runner: 'claude', model: 'x', state: 'working', ours: false }),
      card({ key: 'gone1', name: 'Gone', runner: 'claude', model: 'x', state: 'working' }),
    ] }),
    survey: () => ({ ok: true, agents: [
      { name: 'april', shownAs: 'April', folder: '/Users/x/' + CONTENT, job: null, profile: true },
      { name: 'leo', folder: '/f', job: 'j', profile: true },            // running: not listed twice
      { name: 'old', folder: '/f', removed: true, profile: true },       // removed record
      { name: 'gone1', folder: '/f', profile: true },                    // its removal hides the card
      { name: 'empty', profile: true },                   // no folder and no job: not a leftover
      { name: 'client-acme-secret', shownAs: 'Client Acme Secret', folder: true, job: null, profile: false },   // a stray: another world's agent, or any folder
    ] }),
    removed: () => ['gone1'],
    projects: () => [{ id: 'p1', name: 'Launch', folder: '/Users/x/' + CONTENT, description: CONTENT, agents: ['leo', 'april', 'nobody'] }],
    usageByDay: async () => ({ [DAY(0)]: { 'claude-opus-5-5': { input_tokens: 10 } } }),
    lastActiveOf: (n) => ({ leo: '2026-10-07T10:00:00Z', april: '2026-10-06T10:00:00Z' }[n] || null),
    providerOf: (runner) => ({ codex: 'openai', gemini: 'google', grok: 'xai' }[runner] || 'anthropic'),
    recordedRunner: (n) => ({ leo: 'claude', raph: 'codex' }[n] || 'gemini'),   // the recorded runner, for running and stopped alike (review 16)
  }, over || {});
}

test('#5532 gather: the agents the board shows (running, then offline as stopped with no model), names only', async () => {
  const g = await r.gather(sources());
  assert.deepEqual(g.agents, [
    { name: 'Leo', provider: 'anthropic', model: 'claude-opus-5-5', state: 'working' },
    { name: 'Raph', provider: 'openai', model: 'gpt-5.1', state: 'needs_you' },
    { name: 'April', provider: 'google', model: null, state: 'stopped' },
  ]);
  assert.deepEqual(g.projects, [{ name: 'Launch', agents: ['Leo', 'April'] }], 'a project member was not mapped to its shown name');
  assert.equal(JSON.stringify(g).includes('Client Acme'), false, 'a stray folder (no profile in this world) was sent as an agent');
  assert.equal(g.lastActive, '2026-10-07T10:00:00Z');
  assert.equal(g.partial, false);
  const body = r.build(Object.assign({ world: 'a'.repeat(32) }, g));
  assert.equal(JSON.stringify(body).includes(CONTENT), false, 'content reached the rollup through gather');
  assert.equal(JSON.stringify(body).includes('/Users/'), false, 'a path reached the rollup');
});

test('#5532 rollup review 2: a model string from a pane is sent only when it names a known family', () => {
  const b = r.build({ world: 'a'.repeat(32), agents: [
    { name: 'A', provider: 'anthropic', model: 'claude-opus-5-5', state: 'idle' },
    { name: 'B', provider: 'anthropic', model: 'Acme Q3 board deck (draft)', state: 'idle' },
  ] });
  assert.equal(b.agents[0].model, 'claude-opus-5-5');
  assert.equal(b.agents[1].model, null, 'a pane string that is not a model id was sent as the model');
  for (const ok of ['claude-opus-5-5', 'gpt-5.1-codex', 'gemini-2.5-flash', 'claude-haiku-4-5-20251001', 'grok-4']) assert.ok(r.build({ world: 'w', agents: [{ name: 'Z', model: ok, state: 'idle' }] }).agents[0].model === ok, ok + ' should pass');
  const long = 'claude-' + 'abcdefgh-'.repeat(12) + 'x';
  assert.equal(r.build({ world: 'w', agents: [{ name: 'Z', model: long, state: 'idle' }] }).agents[0].model, null, 'a long tail after a known family was sent (review 6)');
  const tail = r.build({ world: 'a'.repeat(32), agents: [{ name: 'C', provider: 'anthropic', model: 'claude-opus-5-5 /Users/me/secret.txt', state: 'idle' }] });
  assert.equal(tail.agents[0].model, null, 'a model id with text after it was sent (review 4)');
});

test('#5532 gather: a partial pane read withholds the offline list (as /api/status does) and the body says truncated', async () => {
  const g = await r.gather(sources({ snapshot: () => ({ counts: { unreadableLines: 1 }, agents: [card({ key: 'leo', name: 'Leo', runner: 'claude', model: 'm', state: 'working' })] }) }));
  assert.deepEqual(g.agents.map((a) => a.name), ['Leo']);
  assert.equal(g.partial, true);
  assert.equal(r.build(Object.assign({ world: 'a'.repeat(32) }, g)).truncated, true);
  const unreadableProjects = await r.gather(sources({ projects: () => { throw new Error('UNREADABLE'); } }));
  assert.equal(unreadableProjects.partial, true, 'unreadable projects were sent as "no projects"');
});

const oe = require('./orgenroll');

/* What an accepted join leaves on disk: the company's served hash on the enrollment record, and the words shown,
   remembered by that hash (engine/orgenroll.js rememberConsent; the real enroll path is pinned in the consent tests). */
const HASH = 'ab'.repeat(32);
function accept(root, reports, usageConsented) {
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.consentHash = HASH;
  fs.writeFileSync(f, JSON.stringify(rec));
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: {
    reports: reports || ['agent names, the AI provider and model each uses, and whether each is working, waiting or stopped'], usageConsented: usageConsented === true } } }));
}
function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orgrollup-5532-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
/* A coordinator: enrolls this world, answers status, and takes or refuses rollups. */
function coordinator(answer) {
  const sent = [];
  let w = null;
  return {
    sent,
    macRequest: async (m, route, body) => {
      sent.push({ route, body });
      if (route === oe.ROUTES.enroll) { w = body.world; return { ok: true, data: { ok: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } }; }
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      if (route === r.ROUTE) return answer ? answer(body) : { ok: true, data: { ok: true } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
}

test('#5532 sender: a Kosmos that is not the enrolled one sends nothing at all', async (t) => {
  const root = world(t);
  const c = coordinator();
  const res = await r.tick({ root, remote: c, sources: sources(), now: Date.UTC(2026, 9, 7, 12) });
  assert.equal(res.sent, false);
  assert.deepEqual(c.sent, [], 'a rollup (or anything) left a Kosmos that never joined');
});

test('#5532 sender: daily, then on change at most every 10 minutes, and an hour of quiet after a failure', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  const T0 = Date.UTC(2026, 9, 7, 12);
  const unaccepted = await r.tick({ root, remote: c, sources: sources(), now: T0 });
  assert.equal(unaccepted.sent, false, 'sent under an enrollment that records no accepted report lines');
  assert.equal(c.sent.some((x) => x.route === r.ROUTE), false);
  accept(root);
  const rollups = () => c.sent.filter((x) => x.route === r.ROUTE);
  let res = await r.tick({ root, remote: c, sources: sources(), now: T0 });
  assert.equal(res.sent, true); assert.equal(res.reason, 'daily');
  assert.equal(rollups()[0].body.world, oe.readEnrollment({ root }).world, 'the rollup did not name this world');
  assert.equal(JSON.stringify(rollups()[0].body).includes(CONTENT), false);
  res = await r.tick({ root, remote: c, sources: sources(), now: T0 + 60e3 });
  assert.equal(res.sent, false, 'sent again with nothing due');
  // A status word flipping is NOT a change (review 3): no ten-minute activity timeline.
  const busy = sources({ snapshot: () => ({ counts: { unreadableLines: 0 }, agents: [
    card({ key: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'idle' }),
    card({ key: 'raph', name: 'Raph', runner: 'codex', model: 'gpt-5.1', state: 'working' }),
  ] }) });
  res = await r.tick({ root, remote: c, sources: busy, now: T0 + 30 * 60e3 });
  assert.equal(res.sent, false, 'a status flip alone was sent as a change');
  const changed = sources({ snapshot: () => ({ counts: {}, agents: [card({ key: 'leo', name: 'Leo', runner: 'claude', model: 'm', state: 'idle' })] }) });
  res = await r.tick({ root, remote: c, sources: changed, now: T0 + 5 * 60e3 });
  assert.equal(res.sent, false, 'a change inside 10 minutes was sent');
  res = await r.tick({ root, remote: c, sources: changed, now: T0 + 11 * 60e3 });
  assert.equal(res.sent, true); assert.equal(res.reason, 'change');
  assert.equal(rollups().length, 2);

  const down = coordinator(() => ({ ok: false, because: 'the tunnel program did not answer in time' }));
  down.macRequest = ((inner, real) => async (m, route, body) => (route === r.ROUTE ? inner(m, route, body) : real(m, route, body)))(down.macRequest, c.macRequest);
  res = await r.tick({ root, remote: down, sources: sources(), now: T0 + 2 * r.DAILY_MS });
  assert.equal(res.sent, false);
  const before = down.sent.length;
  res = await r.tick({ root, remote: down, sources: sources(), now: T0 + 2 * r.DAILY_MS + 30 * 60e3 });
  assert.equal(down.sent.length, before, 'asked again within an hour of a failure');
  res = await r.tick({ root, remote: c, sources: sources(), now: T0 + 2 * r.DAILY_MS + 61 * 60e3 });
  assert.equal(res.sent, true, 'never retried after the hour');
});

test('#5532 sender: refused as not enrolled, the Kosmos asks the company at once and stops on a clear answer', async (t) => {
  const root = world(t);
  const c = coordinator(() => ({ ok: false, because: '403 {"because":"org_not_enrolled"}' }));
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status ? (c.sent.push({ route, body }), { ok: true, data: { member: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c2', world: 'f'.repeat(32), thisComputer: true } } }) : real(m, route, body));
  await r.tick({ root, remote: c, sources: sources(), now: Date.UTC(2026, 9, 7, 12) });
  assert.ok(c.sent.some((x) => x.route === oe.ROUTES.status), 'a refusal did not make the Kosmos ask');
  assert.equal(oe.isEnrolledHere({ root }), false, 'still sending after the company named another world');
});

test('#5532 rollup review 3: a leave that lands while the board is read stops the send', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const leaving = sources({ snapshot: () => {
    fs.rmSync(path.join(root, oe.ENROLLMENT_FILE));   // the person pressed Leave meanwhile (leave clears the record first)
    return { counts: {}, agents: [] };
  } });
  const res = await r.tick({ root, remote: c, sources: leaving, now: Date.UTC(2026, 9, 7, 12) });
  assert.equal(res.sent, false);
  assert.equal(c.sent.some((x) => x.route === r.ROUTE), false, 'a rollup left after the person was told this Kosmos stopped');
});

test('#5532 rollup review 3: a paneless card takes its recorded runner; an archived project is not reported', async () => {
  const g = await r.gather(sources({
    snapshot: () => ({ counts: {}, agents: [card({ key: 'gem', name: 'Gem', model: 'gemini-2.5-flash', state: 'idle' })] }),
    survey: () => ({ ok: true, agents: [] }),
    projects: () => [{ name: 'Live', agents: ['gem'] }, { name: 'Old client work', agents: ['gem'], archived: true }],
  }));
  assert.equal(g.agents[0].provider, 'google', 'a paneless Gemini agent was reported as anthropic');
  assert.deepEqual(g.projects.map((p) => p.name), ['Live'], 'an archived project was reported');
  assert.equal(r.providerOfModel('my-codex-notes'), null, 'codex matched mid-string');
});

test('#5532 rollup review 4 and 27: a new enrollment starts its timing fresh; an agent with no display name is sent once, by the name the board shows', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const T0 = Date.UTC(2026, 9, 7, 12);
  assert.equal((await r.tick({ root, remote: c, sources: sources(), now: T0 })).sent, true);
  // Leave, then join again (a new enrollment): the first rollup goes at once, not a day later.
  const rec = JSON.parse(fs.readFileSync(path.join(root, oe.ENROLLMENT_FILE), 'utf8'));
  rec.enrolledAt = new Date(T0 + 60e3).toISOString();
  fs.writeFileSync(path.join(root, oe.ENROLLMENT_FILE), JSON.stringify(rec));
  const again = await r.tick({ root, remote: c, sources: sources(), now: T0 + 2 * 60e3 });
  assert.equal(again.sent, true, 'a new enrollment inherited the old one\'s timing');
  // Review 27: a real card for an agent with no recorded display name carries its own name (nameDerived false). It is
  // the name the board shows and the one the offline list sends for it stopped, so it is sent, once, as running, and
  // the send is not partial. Its survey row is present (as it is for every agent with a folder): never listed again.
  const unnamed = card({ key: 'nameless', model: 'm', state: 'idle' });   // a key no other test gives a name
  assert.equal(unnamed.nameDerived, false, 'CONTROL: the fixture is an agent with no recorded display name');
  const g = await r.gather(sources({ snapshot: () => ({ counts: {}, agents: [unnamed] }),
    survey: () => ({ ok: true, agents: [{ name: 'nameless', folder: true, job: true, profile: true }] }) }));
  const rows = g.agents.filter((a) => a.name === 'nameless');
  assert.equal(rows.length, 1, 'a running agent was also listed as stopped: ' + JSON.stringify(g.agents));
  assert.equal(rows[0].state, 'idle');
  assert.equal(g.partial, false, 'an agent with no display name made the send partial');
});

test('#5532 rollup review 5: an agent starting and stopping is not a change (no record of when this person runs agents)', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const running = sources({ snapshot: () => ({ counts: {}, agents: [card({ key: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'working' })] }),
    survey: () => ({ ok: true, agents: [{ name: 'leo', folder: true, job: true, profile: true }] }), recordedRunner: () => 'claude' });
  const stopped = sources({ snapshot: () => ({ counts: {}, agents: [] }),
    survey: () => ({ ok: true, agents: [{ name: 'leo', shownAs: 'Leo', folder: true, job: true, profile: true }] }), recordedRunner: () => 'claude' });
  const T0 = Date.UTC(2026, 9, 7, 12);
  for (const [k, src] of [[0, running], [11, stopped], [22, running], [33, stopped], [44, running]].map(([m, x]) => [m, x])) {
    await r.tick({ root, remote: c, sources: src, now: T0 + k * 60e3 });
  }
  const reasons = c.sent.filter((x) => x.route === r.ROUTE).map((x) => x.body.reason);
  assert.deepEqual(reasons, ['daily'], 'starting and stopping one agent produced change sends: ' + JSON.stringify(reasons));
});

test('#5532 rollup review 5: a partial read is never a change; a Kosmos that cannot record its timing sends nothing', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const T0 = Date.UTC(2026, 9, 7, 12);
  await r.tick({ root, remote: c, sources: sources(), now: T0 });
  const flaky = sources({ snapshot: () => { throw new Error('pane read failed'); } });
  await r.tick({ root, remote: c, sources: flaky, now: T0 + 11 * 60e3 });
  await r.tick({ root, remote: c, sources: sources(), now: T0 + 22 * 60e3 });
  assert.equal(c.sent.filter((x) => x.route === r.ROUTE).length, 1, 'a flaky read (and its recovery) was sent as a change');

  const stuck = world(t);
  const c2 = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: stuck, remote: c2 });
  accept(stuck);
  fs.mkdirSync(path.join(stuck, r.STATE_FILE));   // the timing cannot be written
  for (let k = 0; k < 3; k += 1) await r.tick({ root: stuck, remote: c2, sources: sources(), now: T0 + k * 5 * 60e3 });
  assert.equal(c2.sent.filter((x) => x.route === r.ROUTE).length, 0, 'sent with no way to record when, so every tick would send');
});

test('#5532 rollup review 5: last active is the day only; an agent whose runner cannot be read has provider null', async () => {
  const b = r.build({ world: 'a'.repeat(32), lastActive: '2026-10-07T13:47:12.345Z' });
  assert.equal(b.lastActive, '2026-10-07T00:00:00.000Z');
  const g = await r.gather(sources({
    snapshot: () => ({ counts: {}, agents: [card({ key: 'x', name: 'X', model: 'm', state: 'idle' })] }),
    survey: () => ({ ok: true, agents: [] }),
    recordedRunner: () => null,
  }));
  assert.equal(g.agents[0].provider, null, 'an unreadable runner was reported as a provider');
});

test('#5532 rollup review 8: usage needs its own consent, and a usage key that is not a model id is dropped', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const withUsage = sources({ usageByDay: async () => ({ [DAY(0)]: { 'claude-opus-5-5': { input_tokens: 77 }, '/Users/me/acme-client': { input_tokens: 5 } } }) });
  await r.tick({ root, remote: c, sources: withUsage, now: Date.UTC(2026, 9, 7, 12) });
  const body = c.sent.find((x) => x.route === r.ROUTE).body;
  assert.deepEqual(body.usage, [], 'usage left under a consent that did not name it');
  assert.equal(body.usageWithheld, true);
  // With usage consented, the real model row goes and the path-shaped key does not.
  const b = r.build({ world: 'w', usageByDay: { [DAY(0)]: { 'claude-opus-5-5': { input_tokens: 77 }, '/Users/me/acme-client': { input_tokens: 5 }, 'acmecorp-pilot': { input_tokens: 3 } } } });
  assert.deepEqual(b.usage.map((u) => u.model), ['claude-opus-5-5'], 'a usage key that is not a model id was sent');
});

// Field coverage (rollup reviews 5 and 6): DECIDED, not built: the coordinator's hash binding is the guard (see the plan's "Field coverage").
// The per-computer print (rollup review 6) is wired and pinned in engine/orgenroll-print-5532.test.js.

test('#5532 rollup review 7: a project linked from another Kosmos is never reported; an alias named after a client is not a model', async () => {
  const g = await r.gather(sources({
    projects: () => [{ id: 'p1', name: 'Launch', agents: ['leo'] }, { id: 'p2', name: 'Someone Else Co Secret Project', agents: ['leo'] }],
    linkedProject: (id) => id === 'p2',
  }));
  assert.deepEqual(g.projects.map((p) => p.name), ['Launch'], 'a federated project (another Kosmos\'s) was reported');
  // CONTROL: with no link, both are reported, so the skip above is the link, not the name.
  const both = await r.gather(sources({ projects: () => [{ id: 'p1', name: 'Launch', agents: [] }, { id: 'p2', name: 'Other', agents: [] }], linkedProject: () => false }));
  assert.equal(both.projects.length, 2);
  for (const alias of ['gpt-4o-acmecorp-pilot', 'claude-internal-legal']) {
    assert.equal(r.build({ world: 'w', agents: [{ name: 'Z', model: alias, state: 'idle' }] }).agents[0].model, null, alias + ' was sent as a model');
  }
});

test('#5532 rollup review 7: a refresh keeps the accepted words (found by the hash it keeps on the record)', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root, ['agent names'], true);
  await oe.refresh({ root, remote: c });
  assert.deepEqual(oe.acceptedConsent({ root }), { reports: ['agent names'], usageConsented: true, policyConsented: false, everyKosmosConsented: false }, 'a refresh lost the accepted words, so the rollup would stop with no reason given');
});

test('#5532 wiring: the words are found only for the hash on the record, and only while it may report', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  assert.equal(oe.acceptedConsent({ root }), null, 'CONTROL: no accepted words before the person accepted any');
  accept(root);
  assert.ok(oe.acceptedConsent({ root }), 'CONTROL: found for the hash on the record');
  // Remembered words for another hash (a newer join's, say) are not this record's words: nothing is sent under them.
  const other = 'cd'.repeat(32);
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [other], byHash: { [other]: { reports: ['agent names'], usageConsented: false } } }));
  assert.equal(oe.acceptedConsent({ root }), null, 'words for another hash were taken as this record\'s');
  const sent = await r.tick({ root, remote: c, sources: sources(), now: Date.UTC(2026, 9, 7, 12) });
  assert.equal(sent.sent, false, 'a rollup went out under words remembered for another hash');
});

test('#5532 wiring: the real enroll path remembers the words shown, and usage is consented only by words naming it', async (t) => {
  for (const [lines, usage] of [[['agent names', 'an update when your agents change'], false], [['agent names', 'token usage from sessions launched in your agents\' folders'], true]]) {
    const root = world(t);
    const c = coordinator();
    const r0 = await oe.enroll('ACME-JOIN-1234', true, { root, remote: c, consentHash: HASH, consent: { reports: lines, backsUp: [], readers: ['you'], never: [] } });
    assert.equal(r0.ok, true, JSON.stringify(r0));
    assert.deepEqual(oe.acceptedConsent({ root }), { reports: lines, usageConsented: usage, policyConsented: false, everyKosmosConsented: false }, JSON.stringify(lines));
  }
});

test('#5532 wiring: a rollup refused because the company\'s words changed stops reporting until they are accepted here', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const refusing = { sent: [], macRequest: async (m, route, body) => (route === r.ROUTE ? { ok: false, because: '409 {"because":"org_consent_changed"}' } : c.macRequest(m, route, body)) };
  const t1 = await r.tick({ root, remote: refusing, sources: sources(), now: Date.UTC(2026, 9, 7, 12) });
  assert.equal(t1.sent, false);
  assert.equal(oe.mayReport({ root }), false, 'the Kosmos kept reporting on words the company no longer holds');
  assert.equal(oe.isEnrolledHere({ root }), true, 'the membership was touched');
  const t2 = await r.tick({ root, remote: c, sources: sources(), now: Date.UTC(2026, 9, 9, 12) });
  assert.equal(t2.sent, false, 'a rollup went out after the words changed and before they were accepted again');
});

test('#5532 rollup review 9: an agent whose provider is known only while it runs is still not a change on start or stop', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const running = sources({ snapshot: () => ({ counts: {}, agents: [card({ key: 'adopted', name: 'Adopted', runner: 'claude', model: 'claude-opus-5-5', state: 'working' })] }),
    survey: () => ({ ok: true, agents: [{ name: 'adopted', folder: true, job: null, profile: true }] }), recordedRunner: () => null });
  const stopped = sources({ snapshot: () => ({ counts: {}, agents: [] }),
    survey: () => ({ ok: true, agents: [{ name: 'adopted', shownAs: 'Adopted', folder: true, job: null, profile: true }] }), recordedRunner: () => null });
  const T0 = Date.UTC(2026, 9, 7, 12);
  for (const [m, src] of [[0, running], [11, stopped], [22, running], [33, stopped]]) await r.tick({ root, remote: c, sources: src, now: T0 + m * 60e3 });
  assert.deepEqual(c.sent.filter((x) => x.route === r.ROUTE).map((x) => x.body.reason), ['daily'], 'start/stop moved the signature through the provider');
});

test('#5532 (Pete, E0.3 review 7): a project lists each agent once, and a lastActive after tomorrow is not sent', () => {
  const b = r.build({ world: 'a'.repeat(32), agents: [], projects: [{ name: 'Atlas', agents: ['Leo', 'Leo', ' Leo ', 'Mona'] }] });
  assert.deepEqual(b.projects[0].agents, ['Leo', 'Mona'], 'a project listing an agent twice is refused by the coordinator, and the whole rollup with it');
  const at = (days) => new Date(Date.now() + days * 86400e3).toISOString();
  assert.equal(r.build({ world: 'w', agents: [], lastActive: at(3) }).lastActive, null, 'a day after tomorrow (a wrong clock) was sent, and the coordinator refuses the rollup');
  // CONTROL: today and tomorrow are sent, so the null above is the limit, not a broken day.
  assert.equal(r.build({ world: 'w', agents: [], lastActive: at(0) }).lastActive, at(0).slice(0, 10) + 'T00:00:00.000Z');
  assert.equal(r.build({ world: 'w', agents: [], lastActive: at(1) }).lastActive, at(1).slice(0, 10) + 'T00:00:00.000Z');
});

test('#5532 (Pete, E0.3): no character the coordinator refuses reaches a name, a provider or a model, so one name never loses the whole rollup', () => {
  // The coordinator refuses the WHOLE rollup (org_rollup_bad) on any of these in a name, provider or model.
  const REFUSED = ['\u0001', '\u001f', '\u007f', '\u0085', '‪', '‮', '⁦', '⁩', ' ', ' ', '‎', '‏', '؜', '﻿', '​', '⁠', '­', '\u{e0001}', '\u{e0041}', '\u{e007f}'];
  const bad = (t) => [...t].filter((c) => { const n = c.codePointAt(0); return n < 0x20 || (n >= 0x7f && n <= 0x9f) || REFUSED.includes(c) || (n >= 0xe0000 && n <= 0xe007f); });
  const dirty = 'Le' + REFUSED.join('') + 'o';
  const b = r.build({ world: 'a'.repeat(32), agents: [{ name: dirty, provider: 'anthropic', model: 'claude-opus-5-5' + '‮', state: 'idle' }],
    projects: [{ name: 'At' + REFUSED.join('') + 'las', agents: [dirty] }] });
  // CONTROL: the agent and the project are still sent (a name is cleaned, not dropped).
  assert.equal(b.agents.length, 1); assert.equal(b.projects.length, 1);
  for (const v of [b.agents[0].name, b.agents[0].provider, b.agents[0].model, b.projects[0].name, ...b.projects[0].agents]) {
    if (v == null) continue;
    assert.deepEqual(bad(v).map((c) => c.codePointAt(0).toString(16)), [], 'a refused character reached the rollup in ' + JSON.stringify(v));
  }
  // U+200C/200D are allowed by the coordinator; whether they survive here does not matter, only that nothing refused does.
});

/* Rollup review 10: the coordinator's own refusals, as the oracle (kosmos-relay coordinator/src/org.rs check_rollup):
   one row per agent name, one per project name, and no agent twice in a project. A body breaking any is refused whole. */
function coordinatorRefuses(b) {
  const dup = (xs) => new Set(xs).size !== xs.length;
  if (dup(b.agents.map((a) => a.name))) return 'an agent is listed twice';
  if (dup(b.projects.map((p) => p.name))) return 'a project is listed twice';
  if (b.projects.some((p) => dup(p.agents))) return 'a project lists an agent twice';
  return null;
}
test('#5532 rollup review 10: names that clash on the board, or after cleaning, never make the company refuse the rollup', () => {
  const long = 'A'.repeat(130);
  const b = r.build({ world: 'w', reason: 'daily',
    agents: [{ name: 'Scout', state: 'working' }, { name: 'Scout', state: 'stopped' }, { name: long + 'x', state: 'working' }, { name: long + 'y', state: 'working' }],
    projects: [{ name: 'Docs', agents: ['Scout'] }, { name: 'Docs', agents: ['Leo', 'Scout'] }, { name: 'Plan', agents: ['Leo', 'Leo'] }] });
  assert.equal(coordinatorRefuses(b), null, 'the company would refuse this rollup: ' + coordinatorRefuses(b) + ' ' + JSON.stringify(b));
  assert.equal(b.agents.filter((a) => a.name === 'Scout').length, 1);
  assert.equal(b.agents[0].status, 'working', 'the first of two same-named agents was not the one kept');
  assert.deepEqual(b.projects.find((p) => p.name === 'Docs').agents, ['Scout', 'Leo'], 'same-named projects were not sent as one, with their agents together');
  assert.equal(b.truncated, true, 'a dropped agent was not said');
  // CONTROL: the oracle can refuse.
  assert.equal(coordinatorRefuses({ agents: [{ name: 'a' }, { name: 'a' }], projects: [] }), 'an agent is listed twice');
});
test('#5532 rollup review 10: a change send carries no status and no model (they ride on the daily send only)', () => {
  const input = { world: 'w', agents: [{ name: 'Leo', provider: 'anthropic', model: 'claude-opus-5-5', state: 'working' }] };
  const change = r.build(Object.assign({ reason: 'change' }, input)).agents[0];
  assert.equal(change.status, null); assert.equal(change.model, null);
  const daily = r.build(Object.assign({ reason: 'daily' }, input)).agents[0];
  assert.equal(daily.status, 'working', 'CONTROL: the daily send carries the status'); assert.equal(daily.model, 'claude-opus-5-5');
});


test('#5532 rollup review 10: a join attempt that fails never takes away the words an existing record reports on', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  // A second attempt (a stale page, or one while a leave is pending) under OTHER words, refused by the company.
  const refused = { macRequest: async (m, route) => (route === oe.ROUTES.enroll ? { ok: false, because: '409 {"because":"org_already_member"}' } : { ok: false, because: 'offline' }) };
  const other = 'ef'.repeat(32);
  const r2 = await oe.enroll('BETA-JOIN-5678', true, { root, remote: refused, consentHash: other, consent: { reports: ['something else'], backsUp: [], readers: ['you'], never: [] } });
  assert.equal(r2.ok, false, 'CONTROL: the attempt failed');
  assert.ok(oe.acceptedConsent({ root }), 'the failed attempt overwrote the words the record reports on, so the rollup stopped silently');
});

test('#5532 rollup review 11: change sends never push the daily send (the only one with status and model) further out', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const H = 3600e3;
  const T0 = Date.UTC(2026, 9, 7, 0, 30);   // early in a UTC day, so every change below falls on the same day
  let projects = [{ id: 'p1', name: 'Launch', agents: ['leo'] }];
  const src = () => sources({ projects: () => projects });
  assert.equal((await r.tick({ root, remote: c, sources: src(), now: T0 })).reason, 'daily', 'CONTROL: the first send is daily');
  // Every few hours a project is added: change sends.
  for (const [i, h] of [[1, 6], [2, 12], [3, 18], [4, 23]]) {
    projects = projects.concat([{ id: 'p' + (i + 1), name: 'Project ' + i, agents: ['leo'] }]);
    assert.equal((await r.tick({ root, remote: c, sources: src(), now: T0 + h * H })).reason, 'change');
  }
  // A day after the last DAILY send, the next one is due, whatever changed in between.
  const next = await r.tick({ root, remote: c, sources: src(), now: T0 + 24 * H });
  assert.equal(next.sent, true, 'the daily send was pushed out by change sends: ' + JSON.stringify(next));
  assert.equal(next.reason, 'daily');
});

test('#5532 rollup review 11: a "words changed" refusal only drops the words the refused report was sent under', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const now = oe.readEnrollment({ root }).consentHash;
  assert.equal(await oe.consentWithdrawn({ root }, 'ff'.repeat(32)), false, 'words were dropped for a report sent under other words');
  assert.equal(oe.readEnrollment({ root }).consentHash, now);
  assert.equal(await oe.consentWithdrawn({ root }, now), true, 'CONTROL: the words the report was sent under are dropped');
  assert.equal(oe.mayReport({ root }), false);
});

test('#5532 rollup review 13: usage with a model id the board cannot vouch for is dropped AND said, never an undercount that looks whole', () => {
  const b = r.build({ world: 'w', usageByDay: { [DAY(0)]: { 'claude-opus-5-5': { input_tokens: 10 }, 'gpt-5.1-codex-max-preview-x': { input_tokens: 5 } } } });
  assert.deepEqual(b.usage.map((u) => u.model), ['claude-opus-5-5']);
  assert.equal(b.truncated, true, 'a dropped usage row was not said');
  const ok = r.build({ world: 'w', usageByDay: { [DAY(0)]: { 'claude-opus-5-5': { input_tokens: 10 }, 'claude-sonnet-5-5': { input_tokens: 0 } } } });
  assert.equal(ok.truncated, false, 'CONTROL: a row with no tokens is not a trim');
});

test('#5532 rollup review 16: every send carries the provider (the company keeps none across sends), read from the record whether the agent runs or not', async () => {
  const change = r.build({ world: 'w', reason: 'change', agents: [{ name: 'Leo', provider: 'anthropic', model: 'claude-opus-5-5', state: 'working' }] }).agents[0];
  assert.equal(change.provider, 'anthropic', 'a change send blanked the provider the company keeps from it');
  assert.equal(change.model, null); assert.equal(change.status, null);
  // The provider of a running card is the RECORDED one, never the pane's: it cannot move on start or stop.
  const g = await r.gather(sources({
    snapshot: () => ({ counts: { unreadableLines: 0 }, agents: [card({ key: 'leo', name: 'Leo', runner: 'codex', model: 'gpt-5.1', state: 'working' })] }),
    survey: () => ({ ok: true, agents: [] }), removed: () => [],
    recordedRunner: (n) => (n === 'leo' ? 'claude' : null), providerOf: (runner) => ({ claude: 'anthropic', codex: 'openai' }[runner] || null) }));
  assert.equal(g.agents.find((a) => a.name === 'Leo').provider, 'anthropic', 'the running card\'s provider came from its pane, so it moves on start and stop');
});

test('#5532 rollup review 15: a clock that was ahead once never silences the rollup; a new UTC day makes the daily due', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const now = Date.UTC(2026, 9, 7, 12);
  // State written while the clock was two days ahead.
  fs.writeFileSync(path.join(root, r.STATE_FILE), JSON.stringify({ enrolledAs: undefined, failAt: now + 2 * 86400e3, lastAt: now + 2 * 86400e3, dailyAt: now + 2 * 86400e3 }));
  const rec = oe.readEnrollment({ root });
  const st = JSON.parse(fs.readFileSync(path.join(root, r.STATE_FILE), 'utf8'));
  st.enrolledAs = rec.world + '|' + rec.org.id + '|' + rec.enrolledAt;
  fs.writeFileSync(path.join(root, r.STATE_FILE), JSON.stringify(st));
  const a = await r.tick({ root, remote: c, sources: sources(), now });
  assert.equal(a.sent, true, 'times from a clock that was ahead silenced the rollup: ' + JSON.stringify(a));
  // Sent at 23:50 UTC; ten minutes later is a new UTC day: the daily is due again, not 24 hours later.
  const late = Date.UTC(2026, 9, 9, 23, 50);
  assert.equal((await r.tick({ root, remote: c, sources: sources(), now: late })).reason, 'daily');
  const next = await r.tick({ root, remote: c, sources: sources(), now: late + 75 * 60e3 });   // past every world's offset (at most an hour)
  assert.equal(next.reason, 'daily', 'a new UTC day did not make the daily due: ' + JSON.stringify(next));
});


test('#5532 rollup review 15: when nothing can go, the board is not read at all', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  let reads = 0;
  const counted = () => sources({ snapshot: () => { reads += 1; return { counts: { unreadableLines: 0 }, agents: [] }; } });
  const T0 = Date.UTC(2026, 9, 7, 1);
  assert.equal((await r.tick({ root, remote: c, sources: counted(), now: T0 })).sent, true);
  const before = reads;
  const r2 = await r.tick({ root, remote: c, sources: counted(), now: T0 + 3 * 60e3 });
  assert.equal(r2.sent, false);
  assert.equal(reads, before, 'the board was read on a tick where nothing could be sent');
  await r.tick({ root, remote: c, sources: counted(), now: T0 + 20 * 60e3 });
  assert.ok(reads > before, 'CONTROL: once a change could go, the board is read');
});

test('#5532 rollup review 18: a refused rollup logs its code once; usage days must be real days not after tomorrow', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const lines = [];
  const orig = console.error; console.error = (...a) => lines.push(a.join(' ')); t.after(() => { console.error = orig; });
  const refusing = { macRequest: async (m, route, body) => (route === r.ROUTE ? { ok: false, because: '400 {"because":"org_rollup_bad"}' } : c.macRequest(m, route, body)) };
  await r.tick({ root, remote: refusing, sources: sources(), now: Date.UTC(2026, 9, 7, 12) });
  assert.ok(lines.some((l) => /did not take the rollup \(org_rollup_bad\)/.test(l)), 'a refusal left no trace: ' + JSON.stringify(lines));
  const b = r.build({ world: 'w', usageByDay: { '2026-02-30': { 'claude-opus-5-5': { input_tokens: 1 } }, '2999-01-01': { 'claude-opus-5-5': { input_tokens: 1 } }, [DAY(0)]: { 'claude-opus-5-5': { input_tokens: 1 } } } });
  assert.deepEqual([...new Set(b.usage.map((u) => u.day))], [DAY(0)], 'a day the company refuses reached the body');
});

test('#5532 rollup review 19: a state file with times that are not times never stops the rollup', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const rec = oe.readEnrollment({ root });
  const enrolledAs = rec.world + '|' + rec.org.id + '|' + rec.enrolledAt;
  for (const bad of ['yesterday', -9e15, Number.MAX_VALUE]) {
    fs.writeFileSync(path.join(root, r.STATE_FILE), JSON.stringify({ enrolledAs, lastAt: bad, dailyAt: bad, failAt: bad }));
    const res = await r.tick({ root, remote: c, sources: sources(), now: Date.UTC(2026, 9, 7, 12) });
    assert.equal(res.sent, true, 'a state file holding ' + JSON.stringify(bad) + ' stopped the rollup: ' + JSON.stringify(res));
  }
});

test('#5532 rollup review 20: each world turns its day over at its own minute in the first hour, never the whole fleet at once', async (t) => {
  const crypto = require('node:crypto');
  const offsetOf = (w) => parseInt(crypto.createHash('sha256').update(w).digest('hex').slice(0, 8), 16) % 3600e3;
  // A world id chosen so its minute is past the ten-minute change window (review 21): both arms always run.
  let pick = null;
  for (let i = 0; i < 256 && !pick; i += 1) { const id = i.toString(16).padStart(2, '0').repeat(16); if (offsetOf(id) > 12 * 60e3) pick = id; }
  assert.ok(pick, 'CONTROL: a world id with a late minute exists');
  const root = world(t);
  fs.writeFileSync(path.join(root, oe.WORLD_ID_FILE), pick + '\n');
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const w = oe.readEnrollment({ root }).world;
  assert.equal(w, pick, 'CONTROL: the chosen world id is the one enrolled');
  const off = offsetOf(w);
  const late = Date.UTC(2026, 9, 9, 23, 50);
  assert.equal((await r.tick({ root, remote: c, sources: sources(), now: late })).reason, 'daily');
  const midnight = Date.UTC(2026, 9, 10);
  // Before its minute (and past the ten-minute change window): not due yet.
  const early = await r.tick({ root, remote: c, sources: sources(), now: midnight + 11 * 60e3 });
  assert.notEqual(early.reason, 'daily', 'the daily went before this world\'s minute: ' + JSON.stringify(early));
  const at = await r.tick({ root, remote: c, sources: sources(), now: midnight + Math.max(off, 11 * 60e3) + 1 });
  assert.equal(at.reason, 'daily', 'the daily did not go at this world\'s minute');
  assert.notEqual(offsetOf('a'.repeat(32)), offsetOf('b'.repeat(32)), 'two worlds share one minute');
});


test('#5532 rollup review 22: a failed pane read never lists running agents as stopped; a partial daily waits up to an hour', async (t) => {
  // A snapshot that FAILS: the offline list is withheld, so a running agent is not sent as stopped.
  const g = await r.gather(sources({ snapshot: () => { throw new Error('tmux gone'); }, survey: () => ({ ok: true, agents: [{ name: 'leo', shownAs: 'Leo', folder: true, job: true, profile: true }] }) }));
  assert.equal(g.partial, true);
  assert.equal(g.agents.some((a) => a.state === 'stopped'), false, 'a running agent went out as stopped after a failed pane read: ' + JSON.stringify(g.agents));
  // CONTROL: with a whole read, an offline agent IS listed as stopped.
  const ok = await r.gather(sources({ snapshot: () => ({ counts: { unreadableLines: 0 }, agents: [] }), survey: () => ({ ok: true, agents: [{ name: 'leo', shownAs: 'Leo', folder: true, job: true, profile: true }] }) }));
  assert.equal(ok.agents.find((a) => a.name === 'Leo').state, 'stopped');
  // A partial read when the daily is due: held, not sent; sent partial only after an hour of partial reads.
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const broken = sources({ snapshot: () => { throw new Error('tmux gone'); } });
  const T0 = Date.UTC(2026, 9, 7, 12);
  assert.equal((await r.tick({ root, remote: c, sources: broken, now: T0 })).sent, false, 'a partial daily went at once');
  assert.equal((await r.tick({ root, remote: c, sources: broken, now: T0 + 30 * 60e3 })).sent, false);
  assert.equal((await r.tick({ root, remote: c, sources: sources(), now: T0 + 35 * 60e3 })).sent, true, 'CONTROL: a whole read sends the daily');
  const root2 = world(t);
  await oe.enroll('ACME-JOIN-1234', true, { root: root2, remote: c });
  accept(root2);
  await r.tick({ root: root2, remote: c, sources: broken, now: T0 });
  const late = await r.tick({ root: root2, remote: c, sources: broken, now: T0 + 61 * 60e3 });
  assert.equal(late.sent, true, 'a board unreadable for an hour never sent its daily: ' + JSON.stringify(late));
});

test('#5532 rollup review 22: an unknown runner or provider is sent as no provider, never as a guess', () => {
  const src = r.defaultSources();
  assert.equal(src.providerOf('some-future-runner'), null);
  assert.equal(src.providerOf('codex'), 'openai', 'CONTROL');
  assert.equal(r.KNOWN_PROVIDERS.has('anthropic'), true);
});

test('#5532 rollup review 24: on a board over the size cap, agents starting and stopping still make no change send', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const names = Array.from({ length: 120 }, (_, i) => 'agent-' + String(i).padStart(3, '0') + '-' + 'x'.repeat(100));
  const sessions = names.map((n, i) => 's' + i);
  const projects = Array.from({ length: 40 }, (_, p) => ({ id: 'p' + p, name: 'Project ' + p + ' ' + 'y'.repeat(100), agents: sessions.slice((p * 3) % 108, (p * 3) % 108 + 12) }));
  const running = (on) => sources({
    snapshot: () => ({ counts: { unreadableLines: 0 }, agents: on ? sessions.map((s, i) => (card({ key: s, name: names[i], runner: 'claude', model: 'claude-opus-5-5', state: 'working' }))) : [] }),
    survey: () => ({ ok: true, agents: sessions.map((s, i) => ({ name: s, shownAs: names[i], folder: true, job: true, profile: true })) }),
    removed: () => [], projects: () => projects, lastActiveOf: () => null,
  });
  const T0 = Date.UTC(2026, 9, 7, 1);
  assert.equal((await r.tick({ root, remote: c, sources: running(false), now: T0 })).sent, true, 'CONTROL: the first daily goes');
  const body0 = c.sent.filter((x) => x.route === r.ROUTE)[0].body;
  assert.equal(body0.truncated, true, 'CONTROL: the board is over the cap, so the body was trimmed');
  const t2 = await r.tick({ root, remote: c, sources: running(true), now: T0 + 15 * 60e3 });
  assert.equal(t2.sent, false, 'agents starting made a change send on a trimmed board: ' + JSON.stringify(t2));
  const t3 = await r.tick({ root, remote: c, sources: running(false), now: T0 + 30 * 60e3 });
  assert.equal(t3.sent, false, 'agents stopping made a change send on a trimmed board');
});

test('#5532 rollup review 24: a tag-block character the company refuses never reaches a name', () => {
  const b = r.build({ world: 'w', agents: [{ name: 'Leo\u{E0001}\u{E0010}', state: 'working' }], projects: [{ name: 'P\u{E007F}', agents: ['Leo\u{E0005}'] }] });
  assert.equal(b.agents[0].name, 'Leo');
  assert.equal(b.projects[0].name, 'P');
  assert.deepEqual(b.projects[0].agents, ['Leo']);
});

test('#5532 rollup review 31: a failure\'s wait belongs to the words it was sent under; new words accepted end it', async (t) => {
  const root = world(t);
  let refuse = true;
  const c = coordinator(() => (refuse ? { ok: false, because: 'org_unavailable' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const T0 = Date.UTC(2026, 9, 7, 12);
  assert.equal((await r.tick({ root, remote: c, sources: sources(), now: T0 })).sent, false, 'CONTROL: the first send was refused');
  refuse = false;
  // Same words: the hour's wait holds.
  assert.equal((await r.tick({ root, remote: c, sources: sources(), now: T0 + 10 * 60e3 })).because, 'waiting after a failure');
  // New words accepted (as a review's Accept records them, keeping the enrollment): the wait no longer applies.
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const H2 = 'cd'.repeat(32);
  fs.writeFileSync(f, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(f, 'utf8')), { consentHash: H2 })));
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [H2], byHash: { [H2]: { reports: ['agent names, the AI provider and model each uses, and whether each is working, waiting or stopped'], usageConsented: false } } }));
  assert.equal((await r.tick({ root, remote: c, sources: sources(), now: T0 + 11 * 60e3 })).sent, true, 'new words accepted still waited out the old words\' failure');
});

test('#5534 slice 2: the policy version and a refusal leave only under accepted words that name the policy', async (t) => {
  const NAMED = ['agent names', "which version of your company's policy this Kosmos has applied, and whether it refused one your company sent"];
  const send = async (lines, fakePolicy) => {
    const root = world(t);
    const c = coordinator();
    await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
    accept(root, lines);
    const orgId = oe.readEnrollment({ root }).org.id;
    await r.tick({ root, remote: c, sources: sources(), orgpolicy: fakePolicy(orgId), now: Date.UTC(2026, 9, 7, 12) });
    const sent = c.sent.find((x) => x.route === r.ROUTE);
    assert.ok(sent, 'premise: a rollup was sent');
    return sent.body;
  };
  const refusedNew = (org) => ({ refresh: () => ({ applied: { org, version: 4 }, refused: 'the signature does not match' })});
  const without = await send(['agent names, the AI provider and model each uses', "an update when your agents, their providers, your projects, or your company's policy on this Kosmos change"], refusedNew);
  assert.equal('policyVersion' in without || 'policyRefused' in without, false, 'the policy left under words that do not name it');
  const named = await send(NAMED, refusedNew);
  assert.deepEqual([named.policyVersion, named.policyRefused], [4, true], 'CONTROL: under words naming the policy, the version and the refusal are sent');
  // An expired copy of the policy in force is not a refusal of something new.
  const expired = await send(NAMED, (org) => ({ refresh: () => ({ applied: { org, version: 4 }, refused: 'the token has expired', stale: true }) }));
  assert.deepEqual([expired.policyVersion, expired.policyRefused], [4, false], 'an expired copy of the applied policy was reported as a refusal');
  // This Kosmos failing to save is not the company's bundle refused.
  const local = await send(NAMED, (org) => ({ refresh: () => ({ applied: { org, version: 4 }, refused: 'the policy could not be saved: EACCES', local: true }) }));
  assert.equal(local.policyRefused, false, 'a local save failure was reported as a refusal');
  // A policy another company left behind is not reported as this company's.
  const foreign = await send(NAMED, () => ({ refresh: () => ({ applied: { org: 'org_other', version: 9 }, refused: null }) }));
  assert.equal(foreign.policyVersion, null, 'another company\'s version was reported to this one');
  // A read that throws, with nothing sent before, leaves both out, so the company keeps what it had.
  const broken = await send(NAMED, () => ({ refresh: () => { throw new Error('disk'); } }));
  assert.equal('policyVersion' in broken || 'policyRefused' in broken, false, 'a failed read was sent as none applied');
  // A version the company could not have saved is not sent as one.
  for (const bad of [0, -1, 1.5, '4', 2 ** 53]) assert.equal(r.build({ world: 'w', policyVersion: bad }).policyVersion, null, String(bad));
});

test('#5534 slice 2: a newly applied policy is a change, and a board without it keeps its signature', () => {
  const base = { world: 'w', agents: [{ name: 'Leo', state: 'idle' }], projects: [] };
  const sig = (x) => r.signature(r.build(Object.assign({ reason: 'change' }, base, x)));
  assert.notEqual(sig({ policyVersion: 3, policyRefused: false }), sig({ policyVersion: 4, policyRefused: false }), 'a new policy version was not a change');
  assert.notEqual(sig({ policyVersion: 4, policyRefused: false }), sig({ policyVersion: 4, policyRefused: true }), 'a refusal was not a change');
  // Without the fields the signature is the one every board had before (names and projects only).
  const crypto = require('node:crypto');
  const before = crypto.createHash('sha256').update(JSON.stringify([['Leo'], []])).digest('hex');
  assert.equal(sig({}), before, 'a board whose words do not name the policy got a new signature');
});

test('#5534 slice 2 review 3: a read that fails after a send repeats what was sent, so a passing fault is not a change', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root, ['agent names', "which version of your company's policy this Kosmos has applied, and whether it refused one your company sent"]);
  const orgId = oe.readEnrollment({ root }).org.id;
  let fail = false;
  const op = { refresh: () => { if (fail) throw new Error('disk'); return { applied: { org: orgId, version: 6 }, refused: null }; } };
  const t0 = Date.UTC(2026, 9, 7, 12);
  await r.tick({ root, remote: c, sources: sources(), orgpolicy: op, now: t0 });
  assert.equal(c.sent.filter((x) => x.route === r.ROUTE).length, 1, 'premise: the daily went');
  fail = true;
  await r.tick({ root, remote: c, sources: sources(), orgpolicy: op, now: t0 + r.CHANGE_MIN_MS + 1000 });
  assert.equal(c.sent.filter((x) => x.route === r.ROUTE).length, 1, 'a failed policy read made a change send');
});

test('#5534 slice 2 review 3: end to end with the real policy module, an expired copy of the one in force is not a refusal', async (t) => {
  const crypto = require('node:crypto');
  const orgpolicy = require('./orgpolicy');
  const kp = crypto.generateKeyPairSync('ed25519');
  const at = Math.floor(Date.now() / 1000);
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root, ['agent names', "which version of your company's policy this Kosmos has applied, and whether it refused one your company sent"]);
  const orgId = oe.readEnrollment({ root }).org.id;
  const sign = (p) => { const b = 'KST1.' + Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.sign(null, Buffer.from(b, 'ascii'), kp.privateKey).toString('base64url'); };
  const pol = { providers_allowed: ['anthropic'] };
  const files = [orgpolicy.BUNDLE(), orgpolicy.APPLIED(), orgpolicy.PINNED()];
  t.after(() => { for (const f of files) fs.rmSync(f, { force: true }); });
  fs.mkdirSync(path.dirname(orgpolicy.PINNED()), { recursive: true });
  fs.writeFileSync(orgpolicy.PINNED(), kp.publicKey.export({ format: 'jwk' }).x);
  fs.writeFileSync(orgpolicy.BUNDLE(), sign({ typ: 'org_policy', v: 1, org: orgId, version: 2, iat: at - 100, exp: at + 3600, policy: pol }));
  assert.equal(orgpolicy.refresh().applied.version, 2, 'premise: applied');
  fs.writeFileSync(orgpolicy.BUNDLE(), sign({ typ: 'org_policy', v: 1, org: orgId, version: 2, iat: at - 100, exp: at - 5, policy: pol }));
  await r.tick({ root, remote: c, sources: sources(), now: Date.UTC(2026, 9, 7, 12) });
  const body = c.sent.find((x) => x.route === r.ROUTE).body;
  assert.deepEqual([body.policyVersion, body.policyRefused], [2, false], 'the real module reported an expired copy of the policy in force as a refusal');
});

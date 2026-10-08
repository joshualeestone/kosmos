'use strict';
/**
 * kosmos#5532 (Enterprise E0.3): the rollup body. Pure: no file, no network.
 * The card's done-when includes "no rollup field can carry chat or file text": build() is handed only plain fields,
 * and these tests hand it hostile ones (a secret in every string, markup, bidi, oversize) and read every byte back.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./orgrollup');

const SECRET = 'sk-ant-PLANTED-SECRET-0123456789';
const CONTENT = 'CHAT-AND-FILE-TEXT-MUST-NEVER-LEAVE-9876';   // planted only in fields that hold content, never a name
const DAY = (n) => new Date(Date.UTC(2026, 9, 7 - n)).toISOString().slice(0, 10);

test('#5532: the body has the contract shape, the three status words, and names only', () => {
  const b = r.build({
    world: 'a'.repeat(32), at: '2026-10-07T12:00:00Z', reason: 'change', lastActive: '2026-10-07T11:00:00Z',
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
  assert.deepEqual(Object.keys(b).sort(), ['agents', 'at', 'backup', 'lastActive', 'policyVersion', 'projects', 'reason', 'truncated', 'usage', 'usageWithheld', 'v', 'world'].sort());
  assert.equal(b.v, 1); assert.equal(b.reason, 'change'); assert.equal(b.truncated, false);
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
  for (const s of [b.agents[0].name, b.projects[0].name, b.projects[0].agents[0], b.policyVersion]) {
    assert.ok(s.length <= r.NAME_MAX, 'a string over the bound: ' + s.length);
  }
  assert.equal(b.agents[0].provider, null, 'a provider outside the known list was sent');
  assert.equal(b.agents[0].status, 'waiting');
  assert.equal(text.includes(CONTENT), false, 'content (a task, a transcript, a folder, a description) reached the body: ' + text);
  // A name the person chose is sent as a name, cleaned and bounded: four name fields here, and nothing else. A model is
  // not one: a string with spaces or markup is not a model id, sent as null for an agent (review 4) and dropped as a
  // usage row (review 8).
  assert.deepEqual(b.usage, [], 'a usage key that is not a model id was sent');
  assert.equal(text.split(SECRET).length - 1, 4, 'the planted name appears in a field that is not a name: ' + text);
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
      { sessionName: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'working', isNamedOurs: true, task: CONTENT, because: CONTENT, target: CONTENT },
      { sessionName: 'raph', name: 'Raph', runner: 'codex', model: 'gpt-5.1', state: 'needs_you', isNamedOurs: true, task: CONTENT },
      { sessionName: 'stranger', name: 'Stranger', runner: 'claude', model: 'x', state: 'working', isNamedOurs: false },
      { sessionName: 'gone1', name: 'Gone', runner: 'claude', model: 'x', state: 'working', isNamedOurs: true },
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
    recordedRunner: () => 'gemini',
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
  const g = await r.gather(sources({ snapshot: () => ({ counts: { unreadableLines: 1 }, agents: [{ sessionName: 'leo', name: 'Leo', runner: 'claude', model: 'm', state: 'working', isNamedOurs: true }] }) }));
  assert.deepEqual(g.agents.map((a) => a.name), ['Leo']);
  assert.equal(g.partial, true);
  assert.equal(r.build(Object.assign({ world: 'a'.repeat(32) }, g)).truncated, true);
  const unreadableProjects = await r.gather(sources({ projects: () => { throw new Error('UNREADABLE'); } }));
  assert.equal(unreadableProjects.partial, true, 'unreadable projects were sent as "no projects"');
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const oe = require('./orgenroll');

/* What the coming follow-up will do at enroll: keep the report lines the person accepted with the enrollment. */
function accept(root, reports) {
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.reports = reports || ['agent names, the AI provider and model each uses, and whether each is working, waiting or stopped'];
  fs.writeFileSync(f, JSON.stringify(rec));
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
    { sessionName: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'idle', isNamedOurs: true },
    { sessionName: 'raph', name: 'Raph', runner: 'codex', model: 'gpt-5.1', state: 'working', isNamedOurs: true },
  ] }) });
  res = await r.tick({ root, remote: c, sources: busy, now: T0 + 30 * 60e3 });
  assert.equal(res.sent, false, 'a status flip alone was sent as a change');
  const changed = sources({ snapshot: () => ({ counts: {}, agents: [{ sessionName: 'leo', name: 'Leo', runner: 'claude', model: 'm', state: 'idle', isNamedOurs: true }] }) });
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
    snapshot: () => ({ counts: {}, agents: [{ sessionName: 'gem', name: 'Gem', model: 'gemini-2.5-flash', state: 'idle', isNamedOurs: true }] }),
    survey: () => ({ ok: true, agents: [] }),
    projects: () => [{ name: 'Live', agents: ['gem'] }, { name: 'Old client work', agents: ['gem'], archived: true }],
  }));
  assert.equal(g.agents[0].provider, 'google', 'a paneless Gemini agent was reported as anthropic');
  assert.deepEqual(g.projects.map((p) => p.name), ['Live'], 'an archived project was reported');
  assert.equal(r.providerOfModel('my-codex-notes'), null, 'codex matched mid-string');
});

test('#5532 rollup review 4: a new enrollment starts its timing fresh; a card with no shown name is not sent by session name', async (t) => {
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
  const g = await r.gather(sources({ snapshot: () => ({ counts: {}, agents: [{ sessionName: 'kosmos-w-leo', runner: 'claude', model: 'm', state: 'idle', isNamedOurs: true }] }), survey: () => ({ ok: true, agents: [] }) }));
  assert.equal(JSON.stringify(g).includes('kosmos-w-leo'), false, 'an internal session name was sent');
  assert.equal(g.partial, true);
});

test('#5532 rollup review 5: an agent starting and stopping is not a change (no record of when this person runs agents)', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const running = sources({ snapshot: () => ({ counts: {}, agents: [{ sessionName: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'working', isNamedOurs: true }] }),
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
    snapshot: () => ({ counts: {}, agents: [{ sessionName: 'x', name: 'X', model: 'm', state: 'idle', isNamedOurs: true }] }),
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

test.todo('#5532 consent follow-up: tick() must refuse unless the accepted report lines cover EVERY field build() sends (rollup reviews 5 and 6), bound to the served consentHash (v1.4); a non-empty list is not enough');
test.todo('#5532 before any send is enabled: the per-computer fingerprint (contract v1.5), so a copied data folder on another computer cannot report as the work Kosmos (rollup review 6)');

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

test('#5532 rollup review 7: a refresh keeps the accepted report lines on the enrollment', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root, ['agent names']);
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec0 = JSON.parse(fs.readFileSync(f, 'utf8')); rec0.usageConsented = true; fs.writeFileSync(f, JSON.stringify(rec0));
  await oe.refresh({ root, remote: c });
  assert.deepEqual(oe.readEnrollment({ root }).reports, ['agent names'], 'a refresh dropped the accepted lines, so the rollup would stop with no reason given');
  assert.equal(oe.readEnrollment({ root }).usageConsented, true, 'a refresh dropped usageConsented (review 9)');
});

test('#5532 rollup review 9: an agent whose provider is known only while it runs is still not a change on start or stop', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const running = sources({ snapshot: () => ({ counts: {}, agents: [{ sessionName: 'adopted', name: 'Adopted', runner: 'claude', model: 'claude-opus-5-5', state: 'working', isNamedOurs: true }] }),
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

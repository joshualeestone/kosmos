'use strict';
/**
 * kosmos#6842 slice 3: per-project token use in the company rollup (engine/orgrollup.js projectUsageByDay,
 * readProjectUsage, build's projectUsage, and the daily-only, consent-only read in tick).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'orgrollup-6842-'));
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
const r = require('./orgrollup');
const oe = require('./orgenroll');

const W = 'a'.repeat(32);
const NOW = Date.UTC(2026, 9, 7, 12);
const DAY = (n) => new Date(Date.UTC(2026, 9, 7 - n)).toISOString().slice(0, 10);
const b = (i, o = 0) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
const LINE = 'how many tokens each project\'s finished tasks used, by AI model, and their estimated cost';

/* ---- build ---- */
test('build: rows per project, day and model, with cost; only for projects the body names', () => {
  const body = r.build({ world: W, nowMs: NOW, projects: [{ name: 'Launch', agents: [] }, { name: 'Docs', agents: [] }],
    projectUsage: {
      Launch: { [DAY(0)]: { 'claude-opus-5-5': b(1e6) }, [DAY(1)]: { 'claude-sonnet-5-5': b(10, 5) } },
      Docs: { [DAY(0)]: { 'claude-sonnet-5-5': b(3) } },
    } });
  assert.deepEqual(body.projectUsage.map((x) => [x.project, x.day, x.model, x.input, x.output]), [
    ['Launch', DAY(0), 'claude-opus-5-5', 1e6, 0],
    ['Launch', DAY(1), 'claude-sonnet-5-5', 10, 5],
    ['Docs', DAY(0), 'claude-sonnet-5-5', 3, 0],
  ], 'costliest first');
  assert.ok(body.projectUsage[0].costUsd > 0, 'the opus row is priced');
  assert.equal(body.projectUsage[0].provider, 'anthropic');
  assert.equal(body.truncated, false);
});

test('build: no projectUsage key unless one was read; an empty read is [] (none), not absent (not reported)', () => {
  assert.equal('projectUsage' in r.build({ world: W, nowMs: NOW, projects: [] }), false);
  assert.deepEqual(r.build({ world: W, nowMs: NOW, projects: [], projectUsage: {} }).projectUsage, []);
});

test('build: a project not in the body, a model that is not an id, and a bad day are dropped, and the body says truncated', () => {
  for (const projectUsage of [
    { Secret: { [DAY(0)]: { 'claude-opus-5-5': b(5) } } },
    { Launch: { [DAY(0)]: { 'Acme Q3 deck': b(5) } } },
    { Launch: { '2026-13-40': { 'claude-opus-5-5': b(5) } } },
    { Launch: { [DAY(-3)]: { 'claude-opus-5-5': b(5) } } },   // after tomorrow: a wrong clock
  ]) {
    const body = r.build({ world: W, nowMs: NOW, projects: [{ name: 'Launch', agents: [] }], projectUsage });
    assert.deepEqual(body.projectUsage, [], JSON.stringify(projectUsage));
    assert.equal(body.truncated, true, JSON.stringify(projectUsage));
  }
  const control = r.build({ world: W, nowMs: NOW, projects: [{ name: 'Launch', agents: [] }], projectUsage: { Launch: { [DAY(0)]: { 'claude-opus-5-5': b(5) } } } });
  assert.deepEqual([control.projectUsage.length, control.truncated], [1, false], 'the control');
});

test('build: two names that clean to one are added together; an incomplete read marks the body truncated', () => {
  const body = r.build({ world: W, nowMs: NOW, projects: [{ name: 'Launch', agents: [] }],
    projectUsage: { Launch: { [DAY(0)]: { 'claude-opus-5-5': b(5) } }, 'Launch\u202e': { [DAY(0)]: { 'claude-opus-5-5': b(7) } } } });
  assert.deepEqual(body.projectUsage.map((x) => x.input), [12]);
  assert.equal(r.build({ world: W, nowMs: NOW, projects: [{ name: 'Launch', agents: [] }], projectUsage: {}, projectUsageIncomplete: true }).truncated, true);
  assert.equal(r.build({ world: W, nowMs: NOW, projects: [], projectUsageIncomplete: true }).truncated, false, 'not read, nothing claimed');
});

test('build: at most PROJECT_USAGE_ROWS rows, the cheapest dropped, and the size trim takes project rows first', () => {
  const many = {};
  // 41 projects x 5 days = 205 rows (within the 200-project cap, so every project is in the body).
  let n = 0;
  for (let p = 0; p < 41; p += 1) { many['P' + p] = {}; for (let d = 0; d < 5; d += 1) many['P' + p][DAY(d)] = { 'claude-opus-5-5': b(1000 + (n++)) }; }
  assert.equal(n, r.PROJECT_USAGE_ROWS + 5, 'fixture: five rows over the cap');
  const projects = Object.keys(many).map((name) => ({ name, agents: [] }));
  const body = r.build({ world: W, nowMs: NOW, projects, projectUsage: many });
  assert.equal(body.projectUsage.length, r.PROJECT_USAGE_ROWS);
  assert.equal(body.truncated, true);
  assert.equal(body.projectUsage.some((x) => x.project === 'P0' && x.day === DAY(0)), false, 'the cheapest row went');
  assert.equal(body.projectUsage[0].input, 1204, 'the costliest is first');
  const usage = { [DAY(0)]: { 'claude-opus-5-5': b(1) } };
  const big = r.build({ world: W, nowMs: NOW, projects: Object.keys(many).map((name) => ({ name: name + 'x'.repeat(115), agents: [] })), usageByDay: usage,
    projectUsage: Object.fromEntries(Object.entries(many).map(([k, v]) => [k + 'x'.repeat(115), v])) });
  assert.ok(Buffer.byteLength(JSON.stringify(big)) <= r.BODY_MAX);
  assert.ok(big.projectUsage.length < r.PROJECT_USAGE_ROWS, 'fixture: the size trim must actually fire, ' + big.projectUsage.length);
  assert.equal(big.usage.length, 1, 'per-day usage was trimmed before project rows were');
});

test('build: a size trim that takes every project row leaves projectUsage out (not reported), never [] (none)', () => {
  // [] would replace the company's stored week with none; a body too big for any row says nothing about projects.
  const long = (x) => x + 'x'.repeat(115);
  const projects = Array.from({ length: 200 }, (_, i) => ({ name: long('P' + i), agents: Array.from({ length: 20 }, (_, j) => long('A' + j)) }));
  const body = r.build({ world: W, nowMs: NOW, projects, projectUsage: { [projects[0].name]: { [DAY(0)]: { 'claude-opus-5-5': b(5) } } } });
  assert.ok(body.projects.length < 200, 'fixture: the size trim must reach the projects list, ' + body.projects.length);
  assert.equal('projectUsage' in body, false);
  assert.equal(body.truncated, true);
});

test('build: an unnamed model with no tokens drops nothing, so it does not mark the body truncated', () => {
  const zero = r.build({ world: W, nowMs: NOW, projects: [{ name: 'Launch', agents: [] }],
    projectUsage: { Launch: { [DAY(0)]: { unknown: b(0), 'claude-opus-5-5': b(5) } } } });
  assert.deepEqual([zero.projectUsage.length, zero.truncated], [1, false]);
  const some = r.build({ world: W, nowMs: NOW, projects: [{ name: 'Launch', agents: [] }],
    projectUsage: { Launch: { [DAY(0)]: { unknown: b(3), 'claude-opus-5-5': b(5) } } } });
  assert.equal(some.truncated, true, 'the control: an unnamed model WITH tokens is a real trim');
});

/* ---- projectUsageByDay ---- */
test('projectUsageByDay: at most PROJECT_USAGE_TASKS tasks are read, newest first, and more marks it incomplete', async () => {
  const n = r.PROJECT_USAGE_TASKS + 2;
  const tasks = Array.from({ length: n }, (_, i) => ({ number: i + 1, closedAt: new Date(NOW - (i + 1) * 60e3).toISOString() }));
  const asked = [];
  const receiptOf = async (pid, task) => { asked.push(task.number); return { agents: [] }; };
  const u = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, receiptOf, readAll: () => [{ id: 'p1', name: 'Launch', tasks }] });
  assert.equal(asked.length, r.PROJECT_USAGE_TASKS);
  assert.equal(asked.includes(n), false, 'the oldest task was read instead of a newer one');
  assert.equal(u.complete, false);
  const few = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, receiptOf, readAll: () => [{ id: 'p1', name: 'Launch', tasks: tasks.slice(0, 3) }] });
  assert.equal(few.complete, true, 'the control: under the cap is complete');
});

test('projectUsageByDay: tasks closed in the last 7 days, summed per project, close day and model', async () => {
  const at = (n, h = 10) => new Date(Date.UTC(2026, 9, 7 - n, h)).toISOString();
  const all = [
    { id: 'p1', name: 'Launch', tasks: [{ number: 1, closedAt: at(0) }, { number: 2, closedAt: at(0, 9) }, { number: 3, closedAt: at(7) }, { number: 4, closedAt: null }] },
    { id: 'p2', name: 'Other', tasks: [{ number: 1, closedAt: at(0) }] },
  ];
  const asked = [];
  const receiptOf = async (pid, task) => {
    asked.push(pid + '#' + task.number);
    return { agents: [{ who: 'a', available: true, models: { 'claude-opus-5-5': b(task.number * 10) } }, { who: 'b', available: true, models: { 'claude-opus-5-5': b(1) } }] };
  };
  const u = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, receiptOf, readAll: () => all });
  assert.deepEqual(asked.sort(), ['p1#1', 'p1#2'], 'not the task closed 7 UTC days ago (the window is today and the 6 before), the open one, or a project gather did not keep');
  assert.deepEqual(u, { byProject: { Launch: { [DAY(0)]: { 'claude-opus-5-5': b(32) } } }, complete: true });
});

test('projectUsageByDay: a receipt that fails, an agent that could not be read, or a part read makes it incomplete', async (t) => {
  const all = [{ id: 'p1', name: 'Launch', tasks: [{ number: 1, closedAt: new Date(NOW - 3600e3).toISOString() }] }];
  for (const receiptOf of [
    async () => { throw new Error('x'); },
    async () => ({ agents: [{ who: 'a', available: false, because: 'no-folder' }] }),
    async () => ({ agents: [{ who: 'a', available: true, complete: false, models: {} }] }),
  ]) {
    const u = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, receiptOf, readAll: () => all });
    assert.equal(u.complete, false);
  }
  const ok = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, receiptOf: async () => ({ agents: [] }), readAll: () => all });
  assert.equal(ok.complete, true, 'the control');
});

test('projectUsageByDay: an agent on a provider with no receipt is not counted and does not make the read incomplete', async () => {
  const all = [{ id: 'p1', name: 'Launch', tasks: [{ number: 1, closedAt: new Date(NOW - 3600e3).toISOString() }] }];
  const receiptOf = async () => ({ agents: [
    { who: 'a', available: true, models: { 'claude-opus-5-5': b(4) } },
    { who: 'g', available: false, because: 'provider', provider: 'grok' },
  ] });
  const u = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, receiptOf, readAll: () => all });
  assert.equal(u.complete, true, 'a provider with no receipt is by design, not a short read');
  assert.deepEqual(u.byProject, { Launch: { [DAY(0)]: { 'claude-opus-5-5': b(4) } } });
  const missing = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, readAll: () => all,
    receiptOf: async () => ({ agents: [{ who: 'x', available: false, because: 'no-folder' }] }) });
  assert.equal(missing.complete, false, 'the control: an agent whose folder is gone IS a short read');
});

test('projectUsageByDay: a task whose close cannot be read is left out and marks the read incomplete', async () => {
  const bad = { number: 2 };
  Object.defineProperty(bad, 'closedAt', { get() { throw new Error('malformed'); } });
  const all = [{ id: 'p1', name: 'Launch', tasks: [{ number: 1, closedAt: new Date(NOW - 3600e3).toISOString() }, bad] }];
  const u = await r.projectUsageByDay([{ id: 'p1', name: 'Launch' }], { now: NOW, readAll: () => all,
    receiptOf: async () => ({ agents: [{ who: 'a', available: true, models: { 'claude-opus-5-5': b(2) } }] }) });
  assert.equal(u.complete, false);
  assert.deepEqual(u.byProject, { Launch: { [DAY(0)]: { 'claude-opus-5-5': b(2) } } }, 'the readable task still counts');
});

test('readProjectUsage: projects that could not be listed are not reported, never sent as none', async () => {
  let asked = 0;
  const out = { projectRecords: [], projectsUnreadable: true };
  await r.readProjectUsage({ projectUsage: async () => { asked += 1; return { byProject: {}, complete: true }; } }, out, 1000);
  assert.equal(asked, 0);
  assert.equal('projectUsage' in out, false);
  const ok = { projectRecords: [] };
  await r.readProjectUsage({ projectUsage: async () => ({ byProject: {}, complete: true }) }, ok, 1000);
  assert.deepEqual(ok.projectUsage, {}, 'the control: a listed, empty read is none');
});

/* ---- readProjectUsage ---- */
test('readProjectUsage: a good read is kept; a slow, throwing, wrong-shaped or missing reader leaves it out', async () => {
  const good = { projectRecords: [{ id: 'p1', name: 'L' }] };
  let given = null;
  await r.readProjectUsage({ projectUsage: async (recs) => { given = recs; return { byProject: { L: {} }, complete: false }; } }, good, 1000);
  assert.deepEqual([good.projectUsage, good.projectUsageIncomplete, given], [{ L: {} }, true, [{ id: 'p1', name: 'L' }]]);
  for (const s of [
    { projectUsage: () => new Promise(() => {}) },
    { projectUsage: async () => { throw new Error('x'); } },
    { projectUsage: async () => ({ byProject: [], complete: true }) },
    {},
  ]) {
    const out = { projectUsage: { stale: {} }, projectRecords: [] };
    await r.readProjectUsage(s, out, 20);
    assert.equal('projectUsage' in out, false);
  }
});

/* ---- tick: daily only, words only ---- */
function sources(reader) {
  return {
    snapshot: () => ({ counts: { unreadableLines: 0 }, agents: [] }),
    survey: () => ({ ok: true, agents: [] }),
    removed: () => [],
    projects: () => [{ id: 'p1', name: 'Launch', agents: [] }],
    lastActiveOf: () => null,
    providerOf: () => null,
    recordedRunner: () => null,
    projectUsage: reader,
  };
}
function world(t) {
  const root = fs.mkdtempSync(path.join(SB, 'w-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function coordinator() {
  const sent = [];
  let w = null;
  return {
    sent,
    macRequest: async (m, route, body) => {
      sent.push({ route, body });
      if (route === oe.ROUTES.enroll) { w = body.world; return { ok: true, data: { ok: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } }; }
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      if (route === r.ROUTE) return { ok: true, data: { ok: true } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
}
const HASH = 'ab'.repeat(32);
function accept(root, reports) {
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.consentHash = HASH;
  fs.writeFileSync(f, JSON.stringify(rec));
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: { reports, usageConsented: false } } }));
}

test('tick: per-project use goes only under words naming it, and only in the daily send', async (t) => {
  for (const [lines, named] of [[['agent names', 'token usage from sessions launched in your agents\' folders'], false], [['agent names', LINE], true]]) {
    const root = world(t);
    const c = coordinator();
    await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
    accept(root, lines);
    let reads = 0;
    const reader = async () => { reads += 1; return { byProject: { Launch: { [DAY(0)]: { 'claude-opus-5-5': b(5) } } }, complete: true }; };
    const res = await r.tick({ root, remote: c, sources: sources(reader), now: NOW });
    assert.equal(res.sent, true, JSON.stringify(res));
    const body = c.sent.filter((x) => x.route === r.ROUTE).pop().body;
    if (named) assert.deepEqual(body.projectUsage.map((x) => [x.project, x.input]), [['Launch', 5]]);
    else assert.equal('projectUsage' in body, false, 'sent under words that do not name it');
    assert.equal(reads, named ? 1 : 0, 'read without the words');
    if (!named) continue;
    // A change send (a project renamed, past the 10-minute floor) carries none and reads none.
    const renamed = Object.assign(sources(reader), { projects: () => [{ id: 'p1', name: 'Launch 2', agents: [] }] });
    const ch = await r.tick({ root, remote: c, sources: renamed, now: NOW + 11 * 60e3 });
    assert.equal(ch.sent, true, JSON.stringify(ch));
    assert.equal(ch.reason, 'change');
    assert.equal('projectUsage' in c.sent.filter((x) => x.route === r.ROUTE).pop().body, false, 'a change send carried project use');
    assert.equal(reads, 1, 'a change send read it');
  }
});

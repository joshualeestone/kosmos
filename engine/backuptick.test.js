'use strict';
/**
 * kosmos#5535 E0.6 slice (d): engine/backuptick.js, what a company backup covers (rootsFor, on real folders in a
 * sandbox, checked by the real snapshot's own root rules) and the tick (startTick, with a stand-in run and clock).
 *   node --test engine/backuptick.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tick = require('./backuptick');
const snap = require('./backupsnapshot');

function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-backuptick-')));
  const mk = (...p) => { const d = path.join(base, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
  return { base, mk, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('rootsFor: the workers folder is the one required root; projects, outside folders and transcripts are optional', () => {
  const s = sandbox();
  try {
    const workers = s.mk('work', 'workers');
    const a = s.mk('work', 'workers', 'ann');
    const outsideAgent = s.mk('elsewhere', 'bob');
    const projects = s.mk('Kosmos', 'Projects');
    const inProjects = s.mk('Kosmos', 'Projects', 'alpha');
    const farProject = s.mk('far', 'beta');
    const sessions = (dir, id) => [{ name: `sessions/${id}/claude`, path: s.mk('claude', id), optional: true, only: ['x.jsonl'] }];
    const { roots, left } = tick.rootsFor({
      workersDir: workers, projectsDir: projects, sessions,
      agents: [{ id: 'ann', dir: a }, { id: 'bob', dir: outsideAgent }],
      projects: [{ slug: 'alpha', folder: inProjects }, { slug: 'beta', folder: farProject }],
    });
    assert.deepEqual(roots.map((r) => [r.name, r.optional === true]), [
      ['workers', false], ['projects', true], ['elsewhere/beta', true],
      ['sessions/ann/claude', true], ['agents/bob', true], ['sessions/bob/claude', true],
    ]);
    assert.deepEqual(left, []);
    // Every name is one the snapshot itself accepts.
    for (const r of roots) assert.equal(snap.rootNameProblem(r.name), null, r.name);
  } finally { s.done(); }
});

test('rootsFor: nothing is added twice, and names a root cannot carry are left out and said, never a path', () => {
  const s = sandbox();
  try {
    const workers = s.mk('w');
    const projectsInsideWorkers = s.mk('w', 'projects');
    const far = s.mk('far');
    const { roots, left } = tick.rootsFor({
      workersDir: workers, projectsDir: projectsInsideWorkers,
      agents: [{ id: 'Bad_Name', dir: s.mk('w', 'Bad_Name') }, { id: 'Also Bad', dir: s.mk('out', 'x') }],
      projects: [{ slug: 'inside', folder: s.mk('w', 'p') }, { slug: 'Not OK', folder: far }, { slug: 'missing', folder: path.join(s.base, 'nope') }],
      sessions: () => { throw new Error('never asked for a bad id'); },
    });
    assert.deepEqual(roots.map((r) => r.name), ['workers'], 'a folder inside workers was added again');
    // Bad_Name (inside workers): its transcripts. Also Bad (outside): its folder AND its transcripts. Not OK: a project.
    assert.deepEqual(left.map((l) => l.what).sort(), ['a project', 'an agent folder', 'an agent\'s transcripts', 'an agent\'s transcripts'].sort());
    assert.doesNotMatch(JSON.stringify(left), new RegExp(s.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { s.done(); }
});

test('rootsFor: no workers folder, no roots; a sessions step that throws costs only that agent\'s transcripts', () => {
  const s = sandbox();
  try {
    const none = tick.rootsFor({ workersDir: path.join(s.base, 'absent'), agents: [], projects: [] });
    assert.deepEqual([none.roots.length, none.left.length], [0, 1]);
    const w = s.mk('w');
    const r = tick.rootsFor({ workersDir: w, agents: [{ id: 'ann', dir: s.mk('w', 'ann') }], projects: [], sessions: () => { throw new Error('x'); } });
    assert.deepEqual(r.roots.map((x) => x.name), ['workers']);
  } finally { s.done(); }
});

/* A tick driven by hand: no real timer, a clock we move, a run that answers from a list. */
function driven(answers, { enrolled = () => true } = {}) {
  let t = Date.parse('2026-10-08T12:00:00Z');
  const runs = [], said = [];
  const runBackup = async (input) => { runs.push(input); const a = answers.length > 1 ? answers.shift() : answers[0]; return typeof a === 'function' ? a() : a; };
  const stop = tick.startTick({ runBackup, roots: () => [{ name: 'workers', path: '/w' }], enrolled, say: (x) => said.push(x), now: () => t,
    setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  return { stop, runs, said, advance: (ms) => { t += ms; }, now: () => t };
}

test('the tick runs only on an enrolled Kosmos, with the roots it is given', async () => {
  let on = false;
  const d = driven([{ ok: true }], { enrolled: () => on });
  await d.stop.tick();
  assert.equal(d.runs.length, 0, 'ran while not enrolled');
  on = true;
  await d.stop.tick();
  assert.deepEqual(d.runs, [{ roots: [{ name: 'workers', path: '/w' }] }]);
});

test('backup_off pauses a day without asking; overAllowance pauses until the next week starts', async () => {
  const d = driven([{ ok: false, refusal: { code: 'backup_off' }, because: 'off' }, { ok: true }]);
  await d.stop.tick();
  d.advance(23 * 3600 * 1000); await d.stop.tick();
  assert.equal(d.runs.length, 1, 'asked again inside the day');
  d.advance(3600 * 1000); await d.stop.tick();
  assert.equal(d.runs.length, 2);
  // Thursday 2026-10-08: the week's allowance is new on Monday 2026-10-12 00:00 UTC.
  const w = driven([{ ok: false, overAllowance: true, because: 'used up' }, { ok: true }]);
  await w.stop.tick();
  assert.equal(tick.nextWeekStart(w.now()), Date.parse('2026-10-12T00:00:00Z'));
  w.advance(Date.parse('2026-10-11T23:59:00Z') - w.now()); await w.stop.tick();
  assert.equal(w.runs.length, 1, 'ran before the new week');
  w.advance(60 * 1000); await w.stop.tick();
  assert.equal(w.runs.length, 2);
  // A Monday itself: the NEXT Monday, never the same instant.
  assert.equal(tick.nextWeekStart(Date.parse('2026-10-12T00:00:00Z')), Date.parse('2026-10-19T00:00:00Z'));
});

test('a reason a person must act on is said once, again only when it changes or after a success', async () => {
  // Real shapes: runBackup names the pair on every result once it knew one (refusedState always does).
  const P = { org: 'o1', member: 'm1' };
  const refused = { ok: false, refusedState: true, because: 'the backup state file is not one this computer wrote', pair: P };
  const missing = { ok: false, missing: true, because: 'remote access is not set up' };
  const d = driven([refused, refused, missing, { ok: true, pair: P }, missing, { ok: false, retry: true, because: 'busy', pair: P }]);
  for (let i = 0; i < 6; i++) await d.stop.tick();
  assert.deepEqual(d.said, [`company backup: ${refused.because}`, `company backup: ${missing.because}`, `company backup: ${missing.because}`]);
});

test('a tick while a run is going is skipped, not queued; a run that throws or answers nothing never stops the tick', async () => {
  let release;
  const d = driven([() => new Promise((r) => { release = () => r({ ok: true }); }), async () => { throw new Error('x'); }, null, { ok: true }]);
  const first = d.stop.tick();
  await d.stop.tick();
  assert.equal(d.runs.length, 1, 'a second run started while the first was going');
  release(); await first;
  await d.stop.tick(); await d.stop.tick(); await d.stop.tick();
  assert.equal(d.runs.length, 4);
  assert.equal(d.stop.state.running, false);
});

test('review 1: nesting both ways. An outer folder replaces the inner roots it holds; one that would hold workers is refused', () => {
  const s = sandbox();
  try {
    const workers = s.mk('work', 'workers');
    const app = s.mk('code', 'app');
    const docs = s.mk('code', 'app', 'docs');
    const kosmos = s.mk('Kosmos');
    const projects = s.mk('Kosmos', 'Projects');
    const { roots, left } = tick.rootsFor({
      workersDir: workers, projectsDir: projects,
      projects: [{ slug: 'docs', folder: docs }],
      agents: [{ id: 'ann', dir: app }, { id: 'kos', dir: kosmos }, { id: 'big', dir: s.mk('work') }],
    });
    // docs (added first) is inside ann's folder: ann's replaces it. projects is inside kos's: kos's replaces it.
    assert.deepEqual(roots.map((r) => r.name), ['workers', 'agents/ann', 'agents/kos']);
    assert.deepEqual(left, [{ what: 'an agent folder', why: 'it holds the workers folder' }]);
    // No two roots nest, by real path: what the snapshot would otherwise drop both of.
    for (const a of roots) for (const b of roots) if (a !== b) assert.ok(!(b.path + path.sep).startsWith(a.path + path.sep), `${b.name} inside ${a.name}`);
  } finally { s.done(); }
});

test('review 1: a root that holds, or is inside, the data root or a provider config home is refused', () => {
  const s = sandbox();
  try {
    const workers = s.mk('work', 'workers');
    const data = s.mk('Library', 'kosmos-data');
    const claude = s.mk('home', '.claude');
    const { roots, left } = tick.rootsFor({
      workersDir: workers, protect: [data, claude],
      projects: [{ slug: 'lib', folder: s.mk('Library') }, { slug: 'inside', folder: s.mk('Library', 'kosmos-data', 'p') }],
      agents: [{ id: 'home', dir: s.mk('home') }],
    });
    assert.deepEqual(roots.map((r) => r.name), ['workers']);
    assert.equal(left.length, 3);
    assert.ok(left.every((l) => /Kosmos's own data or a provider's sign-in folder/.test(l.why)), JSON.stringify(left));
    // The workers folder itself inside protected data: nothing at all, said.
    const none = tick.rootsFor({ workersDir: s.mk('Library', 'kosmos-data', 'workers'), protect: [data] });
    assert.deepEqual([none.roots.length, none.left[0].what], [0, 'workers']);
  } finally { s.done(); }
});

test('review 1: no workers root, no request; what was left out is said once per change', async () => {
  const said = [], runs = [];
  let plan = { roots: [], left: [{ what: 'workers', why: 'the workers folder could not be found' }] };
  const stop = tick.startTick({ runBackup: async (i) => { runs.push(i); return { ok: true }; }, roots: () => plan, enrolled: () => true,
    say: (x) => said.push(x), now: () => 0, setInterval: () => ({ unref() {} }), clearInterval: () => {} });
  await stop.tick(); await stop.tick();
  assert.deepEqual([runs.length, said.length], [0, 1], JSON.stringify(said));
  plan = { roots: [{ name: 'workers', path: '/w' }], left: [{ what: 'a project', why: 'x' }] };
  await stop.tick(); await stop.tick();
  assert.deepEqual([runs.length, said.length], [2, 2]);
});

test('review 1: refused before Kosmos+ named the company (an old connector gives no code): backs off, doubling to a day', async () => {
  const blind = { ok: false, because: 'mac-request does not sign' };
  const d = driven([blind]);
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    const before = d.runs.length;
    await d.stop.tick();
    assert.equal(d.runs.length, before + 1);
    const until = d.stop.state.pausedUntil;
    gaps.push((until - d.now()) / 3600000);
    d.advance(until - d.now() - 1); await d.stop.tick();
    assert.equal(d.runs.length, before + 1, 'asked during the pause');
    d.advance(1);
  }
  assert.deepEqual(gaps, [1, 2, 4, 8, 16, 24, 24, 24]);
  // A result naming the pair resets it.
  const r = driven([blind, { ok: false, because: 'quota', pair: { org: 'o', member: 'm' } }, blind]);
  await r.stop.tick(); r.advance(3600000); await r.stop.tick(); await r.stop.tick();
  assert.equal(r.stop.state.blind, 1);
});

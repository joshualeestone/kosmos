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
    assert.deepEqual(left.map((l) => l.what).sort(), ['a project', 'an agent folder', 'an agent\'s transcripts'].sort());
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
  const refused = { ok: false, refusedState: true, because: 'the backup state file is not one this computer wrote' };
  const missing = { ok: false, missing: true, because: 'remote access is not set up' };
  const d = driven([refused, refused, missing, { ok: true }, missing, { ok: false, retry: true, because: 'busy' }]);
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

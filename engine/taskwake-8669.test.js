'use strict';
/**
 * kosmos#8669: a task's wake (engine/taskwake.js): what a person writes is read whole, the condition is read once when it
 * is set, the board's look finds it happened (and never before), the store keeps it once per wake, and one holder is
 * told once. GitHub is a fake gh runner (devicedoor.runBounded's shape) answering by its arguments; files are real
 * files in a temp folder.
 *
 *   node --test engine/taskwake-8669.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-taskwake-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-taskwake-data-'));
const FILES = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-taskwake-files-'));
const IN_HOME = { home: FILES };   // the file wakes' home folder, for prepare (taskwake watches files only under home)
process.on('exit', () => {
  for (const d of [process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_DATA, FILES]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
const projects = require('./projects');
const tasks = require('./tasks');
const taskchat = require('./taskchat');
const taskwake = require('./taskwake');
const fleet = require('../test-support/fleet');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/* A fake gh: `answers` maps an API path to { code, out }; every call is kept in `calls`. */
function fakeGh(answers) {
  const calls = [];
  const run = (args, done) => {
    calls.push(args.slice());
    const a = answers[args[1]];
    setImmediate(() => (a ? done(a.code, a.out) : done(1, 'gh: Not Found (HTTP 404)')));
  };
  run.calls = calls;
  return run;
}
const prOpen = { code: 0, out: 'open\tfalse\n' };
const prMerged = { code: 0, out: 'closed\ttrue\n' };
const prClosed = { code: 0, out: 'closed\tfalse\n' };

test('#8669: what a person writes is read whole, and anything else is refused with a sentence', () => {
  assert.deepEqual(taskwake.parsePr('octo/hello#123'), { repo: 'octo/hello', number: 123 });
  assert.deepEqual(taskwake.parsePr('https://github.com/octo/hello/pull/7'), { repo: 'octo/hello', number: 7 });
  assert.deepEqual(taskwake.parsePr('https://github.com/octo/hello/pull/7/files'), { repo: 'octo/hello', number: 7 }, 'a pasted tab address');
  assert.deepEqual(taskwake.parsePr('https://github.com/octo/hello/pull/7/commits'), { repo: 'octo/hello', number: 7 });
  assert.ok(taskwake.parsePr('https://github.com/octo/hello/pull/7/blob').problem);
  for (const bad of ['octo#1', 'octo/hello', 'octo/hello#0', '-x/hello#1', 'octo/..#1', 'a/b/c#1', 'octo/hel lo#1', '']) {
    assert.ok(taskwake.parsePr(bad).problem, bad + ' is refused');
  }
  assert.deepEqual(taskwake.parseBranch('octo/hello:feature/x'), { repo: 'octo/hello', branch: 'feature/x' });
  for (const bad of ['octo/hello', 'octo/hello:', 'octo/hello:-x', 'octo/hello:a..b', 'octo/hello:a//b', 'octo/hello:x.lock', 'octo/hello:.hidden', 'octo/hello:a b', 'octo/hello:a?b']) {
    assert.ok(taskwake.parseBranch(bad).problem, bad + ' is refused');
  }
  const now = new Date(2026, 10, 17, 10, 30).getTime();
  assert.equal(taskwake.parseAt('30m', now).at, now + 30 * 60 * 1000);
  assert.equal(taskwake.parseAt('2h', now).at, now + 2 * 3600 * 1000);
  assert.equal(taskwake.parseAt('11:00', now).at, new Date(2026, 10, 17, 11, 0).getTime(), 'later today');
  assert.equal(taskwake.parseAt('09:00', now).at, new Date(2026, 10, 18, 9, 0).getTime(), 'a time already past today is tomorrow');
  assert.equal(taskwake.parseAt('2026-11-20 08:15', now).at, new Date(2026, 10, 20, 8, 15).getTime());
  assert.equal(taskwake.parseAt('2026-02-30 08:15', now).problem, 'there is no such date');
  assert.equal(taskwake.parseAt('2026-11-16 08:15', now).problem, 'that time has already passed');
  assert.equal(taskwake.parseAt('400d', now).problem, 'a wake can be set at most a year ahead');
  assert.match(taskwake.parseAt('soon', now).problem, /30m, 2h or 1d/);
  assert.equal(taskwake.wakeProblem({ kind: 'mail' }), 'a task can wake on a pull request, a branch, a file or a time');
  assert.equal(taskwake.wakeProblem({ kind: 'file', path: 'relative.txt', from: 'stat:1:2' }), 'say the file as its full path');
  assert.equal(taskwake.wakeProblem({ kind: 'branch', repo: 'octo/hello', branch: 'main', from: 'nope' }), 'the branch\'s commit could not be read');
});

test('#8669: prepare reads the condition once, so a wake starts from what is true now', async () => {
  const gh = fakeGh({ 'repos/octo/hello/pulls/5': prOpen, 'repos/octo/hello/pulls/6': prMerged, 'repos/octo/hello/pulls/8': prClosed,
    'repos/octo/hello/branches/main': { code: 0, out: SHA_A + '\n' } });
  assert.deepEqual(await taskwake.prepare({ pr: 'octo/hello#5' }, { gh }), { wake: { kind: 'pr', repo: 'octo/hello', number: 5 } });
  assert.deepEqual(gh.calls[0], ['api', 'repos/octo/hello/pulls/5', '--jq', '[.state, (.merged|tostring)] | @tsv'], 'one read, its arguments as an array (no shell)');
  assert.equal((await taskwake.prepare({ pr: 'octo/hello#6' }, { gh })).problem, 'that pull request is already merged');
  assert.equal((await taskwake.prepare({ pr: 'octo/hello#8' }, { gh })).problem, 'that pull request is already closed');
  assert.match((await taskwake.prepare({ pr: 'octo/hello#9' }, { gh })).problem, /GitHub has no pull request #9 in octo\/hello/);
  assert.match((await taskwake.prepare({ pr: 'octo/hello#5' }, { gh: null })).problem, /GitHub is not connected/);
  assert.deepEqual(await taskwake.prepare({ branch: 'octo/hello:main' }, { gh }), { wake: { kind: 'branch', repo: 'octo/hello', branch: 'main', from: SHA_A } });
  const f = nodePath.join(FILES, 'notes.md');
  fs.writeFileSync(f, 'first');
  const fw = (await taskwake.prepare({ file: f }, IN_HOME)).wake;
  assert.equal(fw.kind, 'file');
  assert.equal(fw.name, 'notes.md');
  assert.match(fw.from, /^sha256:[0-9a-f]{64}$/);
  // One sentence for every file it will not watch, so a refusal does not say whether a path exists.
  const CANNOT = 'Kosmos can watch an ordinary file in your home folder, outside hidden folders and Library; it cannot watch that one';
  assert.equal((await taskwake.prepare({ file: nodePath.join(FILES, 'nope.md') }, IN_HOME)).problem, CANNOT);
  assert.equal((await taskwake.prepare({ file: FILES }, IN_HOME)).problem, CANNOT);
  assert.equal((await taskwake.prepare({ file: f }, { home: nodePath.join(FILES, 'elsewhere') })).problem, CANNOT, 'outside the home folder');
  for (const inside of [['.ssh', 'config'], ['Library', 'prefs.plist'], ['library', 'Keychains', 'login.db'], ['LIBRARY', 'x.plist'], ['work', '.git', 'HEAD']]) {
    const hp = nodePath.join(FILES, ...inside);
    fs.mkdirSync(nodePath.dirname(hp), { recursive: true });
    fs.writeFileSync(hp, 'x');
    assert.equal((await taskwake.prepare({ file: hp }, IN_HOME)).problem, CANNOT, inside.join('/'));
  }
  // A link inside the home folder that points out of it is followed, and refused.
  const outside = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-taskwake-out-'));
  fs.writeFileSync(nodePath.join(outside, 'target.txt'), 'x');
  fs.symlinkSync(nodePath.join(outside, 'target.txt'), nodePath.join(FILES, 'link.txt'));
  assert.equal((await taskwake.prepare({ file: nodePath.join(FILES, 'link.txt') }, IN_HOME)).problem, CANNOT);
  fs.rmSync(outside, { recursive: true, force: true });
  assert.equal((await taskwake.prepare({ file: 'notes.md' })).problem, 'say the file as its full path');
  assert.equal((await taskwake.prepare({ pr: 'octo/hello#5', at: '2h' }, { gh })).problem, 'say one thing to wake on: --pr, --branch, --file or --at');
  assert.equal((await taskwake.prepare({}, { gh })).problem, 'say one thing to wake on: --pr, --branch, --file or --at');
});

test('#8669: the look says met only once the thing happened, and says why it could not look', async () => {
  const answers = { 'repos/octo/hello/pulls/5': prOpen, 'repos/octo/hello/branches/main': { code: 0, out: SHA_A } };
  const gh = fakeGh(answers);
  const pr = { kind: 'pr', repo: 'octo/hello', number: 5 };
  assert.deepEqual(await taskwake.probe(pr, { gh }), { met: false }, 'an open pull request has not merged');
  answers['repos/octo/hello/pulls/5'] = prMerged;
  assert.deepEqual(await taskwake.probe(pr, { gh }), { met: true, words: 'it was merged' });
  answers['repos/octo/hello/pulls/5'] = prClosed;
  assert.deepEqual(await taskwake.probe(pr, { gh }), { met: true, words: 'it was closed without being merged' });
  answers['repos/octo/hello/pulls/5'] = { code: 1, out: 'error connecting to api.github.com' };
  assert.deepEqual(await taskwake.probe(pr, { gh }), { met: false, problem: 'GitHub could not be reached just now' }, 'an unreachable GitHub is never a merge');
  answers['repos/octo/hello/pulls/5'] = { code: 4, out: 'To get started with GitHub CLI, please run:  gh auth login' };
  assert.deepEqual(await taskwake.probe(pr, { gh }), { met: false, problem: 'GitHub is not signed in on this computer (Connections)' });
  assert.equal((await taskwake.probe(pr, { gh: null })).met, false);

  const br = { kind: 'branch', repo: 'octo/hello', branch: 'main', from: SHA_A };
  assert.deepEqual(await taskwake.probe(br, { gh }), { met: false });
  answers['repos/octo/hello/branches/main'] = { code: 0, out: SHA_B };
  assert.deepEqual(await taskwake.probe(br, { gh }), { met: true, words: 'it has a new commit (' + SHA_B.slice(0, 10) + ')' });
  delete answers['repos/octo/hello/branches/main'];
  // A 404 for the branch is also what a repository this sign-in can no longer see answers: not met.
  assert.deepEqual(await taskwake.probe(br, { gh }), { met: false, problem: 'GitHub does not show octo/hello to this computer\'s GitHub sign-in just now' });
  answers['repos/octo/hello'] = { code: 0, out: 'octo/hello\n' };
  assert.deepEqual(await taskwake.probe(br, { gh }), { met: true, words: 'the branch is no longer on GitHub' }, 'the repository answers and the branch does not');
  // gh's answer is stdout then stderr in one string; a notice after it does not change the reading.
  answers['repos/octo/hello/pulls/5'] = { code: 0, out: 'closed\ttrue\nA new release of gh is available\n' };
  assert.deepEqual(await taskwake.probe(pr, { gh }), { met: true, words: 'it was merged' });

  const now = Date.now();
  assert.deepEqual(await taskwake.probe({ kind: 'at', at: now + 1000 }, { now }), { met: false });
  assert.deepEqual(await taskwake.probe({ kind: 'at', at: now }, { now }), { met: true, words: 'the time came' });
});

test('#8669: a file wakes on a changed fingerprint, not on a touch, and on being removed', async () => {
  const f = nodePath.join(FILES, 'report.txt');
  fs.writeFileSync(f, 'version 1');
  const w = (await taskwake.prepare({ file: f }, IN_HOME)).wake;
  const seen = new Map();
  assert.deepEqual(await taskwake.probe(w, IN_HOME, 'k', seen), { met: false }, 'unchanged');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(f, later, later);
  assert.deepEqual(await taskwake.probe(w, IN_HOME, 'k', seen), { met: false }, 'touched, same bytes: not a change');
  assert.ok(seen.has('k'), 'the touch is remembered, so the file is not read again each minute');
  let reads = 0;
  const counting = { plain: (p) => { reads += 1; return require('./fileprint').plain(p); } };
  assert.deepEqual(await taskwake.probe(w, { ...IN_HOME, fileprint: counting }, 'k', seen), { met: false });
  assert.equal(reads, 0, 'same size and time: not fingerprinted again');
  fs.writeFileSync(f, 'version 2');
  assert.deepEqual(await taskwake.probe(w, IN_HOME, 'k', seen), { met: true, words: 'it changed' });
  fs.rmSync(f);
  assert.deepEqual(await taskwake.probe(w, IN_HOME, 'k', seen), { met: true, words: 'it was removed' });
  // A path made into a link after the wake was set is checked again on every look, and never read.
  const watched = nodePath.join(FILES, 'swap.txt');
  fs.writeFileSync(watched, 'one');
  const sw = (await taskwake.prepare({ file: watched }, IN_HOME)).wake;
  const hidden = nodePath.join(FILES, '.private', 'key.txt');
  fs.mkdirSync(nodePath.dirname(hidden), { recursive: true });
  fs.writeFileSync(hidden, 'secret');
  fs.rmSync(watched);
  fs.symlinkSync(hidden, watched);
  let readAgain = 0;
  const spy = { plain: (q) => { readAgain += 1; return require('./fileprint').plain(q); } };
  assert.deepEqual(await taskwake.probe(sw, { ...IN_HOME, fileprint: spy }, 's', new Map()), { met: false, problem: 'Kosmos cannot watch that file any more' });
  assert.equal(readAgain, 0, 'the linked file was not read');
  // A file too big to fingerprint here is watched by its size and time.
  const big = { statSync: () => ({ isFile: () => true, size: taskwake.FILE_HASH_MAX + 1, mtimeMs: 5 }) };
  const bw = (await taskwake.prepare({ file: '/big/file.bin' }, { fs: big, home: '/big' })).wake;
  assert.equal(bw.from, 'stat:' + (taskwake.FILE_HASH_MAX + 1) + ':5');
  assert.deepEqual(await taskwake.probe(bw, { fs: big, home: '/big' }, 'b', new Map()), { met: false });
  const bigger = { statSync: () => ({ isFile: () => true, size: taskwake.FILE_HASH_MAX + 1, mtimeMs: 6 }) };
  assert.deepEqual(await taskwake.probe(bw, { fs: bigger, home: '/big' }, 'b', new Map()), { met: true, words: 'it changed' });
});

function setupProject(name, agents = ['ann', 'bo']) {
  const p = projects.create({ name });
  for (const a of agents) projects.addAgent(p.id, a);
  return p;
}
const only = (p) => projects.readAll().filter((x) => x.id === p.id);
const stored = (pid, n) => tasks.byNumber(projects.readAll().find((x) => x.id === pid), n);

test('#8669: the store keeps one wake, met once for the wake it checked, and a new wake starts afresh', async () => {
  const p = setupProject('Store');
  const t = tasks.create(p.id, { sentence: 'Re-check after the refresh', who: 'ann' });
  const wake = { kind: 'pr', repo: 'octo/hello', number: 5 };
  const r = tasks.setWake(p.id, t.number, wake, { by: 'ann', now: Date.parse('2026-11-17T10:00:00Z') });
  assert.equal(r.changed, true);
  assert.deepEqual(stored(p.id, t.number).wake, { kind: 'pr', repo: 'octo/hello', number: 5, setAt: '2026-11-17T10:00:00.000Z', setBy: 'ann' });
  assert.equal(tasks.saveWakeMet(p.id, t.number, 'another-set', { at: '2026-11-17T10:05:00Z', words: 'it was merged' }), false, 'not the wake it checked');
  assert.equal(tasks.saveWakeMet(p.id, t.number, '2026-11-17T10:00:00.000Z', { at: '2026-11-17T10:05:00Z', words: 'it was merged' }), true);
  assert.equal(tasks.saveWakeMet(p.id, t.number, '2026-11-17T10:00:00.000Z', { at: '2026-11-17T10:06:00Z', words: 'again' }), false, 'once');
  assert.deepEqual(stored(p.id, t.number).wakeMet, { at: '2026-11-17T10:05:00Z', words: 'it was merged' });
  const kinds = taskchat.read(p.id, t.number).map((e) => e.kind);
  assert.ok(kinds.includes('wake-set') && kinds.includes('wake-met'), 'the history says it: ' + kinds.join(','));
  // Set again: what the last one found goes.
  tasks.setWake(p.id, t.number, { kind: 'at', at: Date.now() + 3600e3 }, { by: 'ann' });
  const s = stored(p.id, t.number);
  assert.equal(s.wake.kind, 'at');
  assert.equal('wakeMet' in s, false);
  // Cleared.
  assert.equal(tasks.setWake(p.id, t.number, null, {}).changed, true);
  assert.equal('wake' in stored(p.id, t.number), false);
  assert.equal(tasks.setWake(p.id, t.number, null, {}).changed, false, 'clearing nothing changes nothing');
  // A bad shape never reaches the store.
  assert.throws(() => tasks.setWake(p.id, t.number, { kind: 'pr', repo: 'nope', number: 1 }, {}), /owner\/name/);
});

test('#8669: the person\'s wake is theirs, and a closed task takes none', () => {
  const p = setupProject('Owner');
  const t = tasks.create(p.id, { sentence: 'Theirs', who: 'ann' });
  tasks.setWake(p.id, t.number, { kind: 'at', at: Date.now() + 3600e3 }, { person: true });
  assert.equal(stored(p.id, t.number).wake.byPerson, true);
  assert.throws(() => tasks.setWake(p.id, t.number, null, { by: 'ann' }), /only they can change it/);
  assert.throws(() => tasks.setWake(p.id, t.number, { kind: 'at', at: Date.now() + 7200e3 }, { by: 'ann' }), /only they can change it/);
  assert.equal(tasks.setWake(p.id, t.number, null, { person: true }).changed, true);
  const c = tasks.create(p.id, { sentence: 'Closed', who: 'ann' });
  tasks.close(p.id, c.number);
  assert.throws(() => tasks.setWake(p.id, c.number, { kind: 'at', at: Date.now() + 3600e3 }, {}), /closed/);
});

test('#8669: a file wake\'s path stays on this computer; the rows still name the file', async () => {
  const p = setupProject('Paths');
  const f = nodePath.join(FILES, 'secret-folder-name', 'plan.md');
  fs.mkdirSync(nodePath.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  const t = tasks.create(p.id, { sentence: 'Watch the plan', who: 'ann' });
  tasks.setWake(p.id, t.number, (await taskwake.prepare({ file: f }, IN_HOME)).wake, { by: 'ann' });
  const row = tasks.withoutLocalPaths(stored(p.id, t.number));
  assert.equal('path' in row.wake, false);
  assert.equal('from' in row.wake, false, 'nor the fingerprint');
  assert.equal(JSON.stringify(row).includes('secret-folder-name'), false, 'no part of the path');
  assert.equal(taskwake.fieldsOf(row).wakeWords, 'waits for plan.md to change');
  const joined = projects.joinTaskClaims([stored(p.id, t.number)], projects.readAll(), ['ann'], [], { name: p.name, id: p.id })[0];
  assert.equal(joined.wakeWords, 'waits for plan.md to change');
  assert.equal(JSON.stringify(joined).includes('secret-folder-name'), false, 'the project page row leaves the path out too');
});

test('#8669: the board\'s look stores what happened, spaces its looks, and caps its GitHub reads oldest first', async () => {
  const p = setupProject('Look');
  const answers = {};
  const made = [];
  for (let i = 1; i <= taskwake.NET_PER_TICK + 3; i += 1) {
    const t = tasks.create(p.id, { sentence: 'PR ' + i, who: 'ann' });
    answers['repos/octo/hello/pulls/' + i] = prOpen;
    tasks.setWake(p.id, t.number, { kind: 'pr', repo: 'octo/hello', number: i }, { by: 'ann' });
    made.push(t.number);
  }
  const gh = fakeGh(answers);
  const state = new Map();
  const saved = [];
  const save = (pid, n, setAt, met) => { saved.push(n); return tasks.saveWakeMet(pid, n, setAt, met); };
  let now = Date.now();
  let done = await taskwake.checkTick({ projects: projects.readAll(), now, gh, state, seen: new Map(), save });
  assert.equal(gh.calls.length, taskwake.NET_PER_TICK, 'no more than the cap in one tick');
  assert.equal(done.filter((x) => x.act === 'waiting' && x.projectId === p.id).length, taskwake.NET_PER_TICK);
  // Inside the minute: nothing is read again.
  await taskwake.checkTick({ projects: projects.readAll(), now: now + 10e3, gh, state, seen: new Map(), save });
  assert.equal(gh.calls.length, taskwake.NET_PER_TICK + 3, 'only the three never looked at are read');
  // The pull request merges: the next look finds it, and only then.
  answers['repos/octo/hello/pulls/2'] = prMerged;
  assert.equal(saved.length, 0, 'nothing met before the merge');
  now += taskwake.CHECK_EVERY_MS + 1;
  done = await taskwake.checkTick({ projects: projects.readAll(), now, gh, state, seen: new Map(), save });
  const met = done.filter((x) => x.act === 'met');
  assert.deepEqual(met.map((x) => x.n), [made[1]]);
  assert.equal(met[0].saved, true);
  assert.equal(stored(p.id, made[1]).wakeMet.words, 'it was merged');
  // A met wake is not looked at again.
  const before = gh.calls.filter((c) => c[1] === 'repos/octo/hello/pulls/2').length;
  now += taskwake.CHECK_EVERY_MS + 1;
  await taskwake.checkTick({ projects: projects.readAll(), now, gh, state, seen: new Map(), save });
  await taskwake.checkTick({ projects: projects.readAll(), now: now + taskwake.CHECK_EVERY_MS + 1, gh, state, seen: new Map(), save });
  assert.equal(gh.calls.filter((c) => c[1] === 'repos/octo/hello/pulls/2').length, before);
  // A look that could not read GitHub says so on the row.
  answers['repos/octo/hello/pulls/3'] = { code: 1, out: 'timeout' };
  now += 3 * (taskwake.CHECK_EVERY_MS + 1);
  await taskwake.checkTick({ projects: projects.readAll(), now, gh, state, seen: new Map(), save });
  await taskwake.checkTick({ projects: projects.readAll(), now: now + taskwake.CHECK_EVERY_MS + 1, gh, state, seen: new Map(), save });
  const t3 = stored(p.id, made[2]);
  assert.equal(taskwake.problemFor(p.id, t3, state), 'GitHub could not be reached just now');
  assert.equal(taskwake.fieldsOf(t3, Date.now(), taskwake.problemFor(p.id, t3, state)).wakeProblem, 'GitHub could not be reached just now');
});

/* The sweep's world: real idle fleet cards (test-support/fleet), copied out so a state can be set as a real agent's is,
   and a deliver that records what it typed. */
function world(names) {
  const board = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle' })), { strict: false });
  let roster;
  try { roster = names.map((n) => ({ ...board.card(n) })); } finally { board.restore(); }
  const typed = [];
  return {
    roster, typed,
    o: (projs, extra = {}) => ({
      projects: projs, roster, now: Date.now(), allowed: true, limit: { on: false }, sent: [], book: extra.book || new Map(), idleSeen: new Map(),
      idleSince: () => Date.now() - 120e3, deliver: (s, text) => { typed.push({ s, text }); return { state: 'placed' }; }, DELIVERY: { PLACED: 'placed', UNCONFIRMED: 'unconfirmed' },
      ...extra,
    }),
  };
}

test('#8669: one holder is told once after the wake happens, and never before', () => {
  {
    const p = setupProject('Tell', ['ann', 'bo']);
    const t = tasks.create(p.id, { sentence: 'Re-check the listings', who: 'bo' });
    tasks.addPart(p.id, t.number, { sentence: 'Second part', who: 'ann' });
    tasks.setWake(p.id, t.number, { kind: 'pr', repo: 'octo/hello', number: 12 }, { by: 'ann' });
    const w = world(['ann', 'bo']);
    let r = taskwake.sweep(w.o(only(p)));
    assert.equal(w.typed.length, 0, 'not met: nobody is told');
    assert.equal(r.results.length, 0);
    tasks.saveWakeMet(p.id, t.number, stored(p.id, t.number).wake.setAt, { at: new Date().toISOString(), words: 'it was merged' });
    const book = new Map();
    r = taskwake.sweep(w.o(only(p), { book }));
    assert.equal(w.typed.length, 1, 'one holder');
    assert.equal(w.typed[0].s, 'ann', 'the agent that set the wake is told first');
    assert.match(w.typed[0].text, /^Kosmos: your task #\d+ in Tell, "Re-check the listings", was waiting for PR #12 in octo\/hello to merge, and it was merged\. Pick it up now\./);
    assert.match(w.typed[0].text, /kosmos task wake [^ ]+ \d+\.$/);
    const s = stored(p.id, t.number);
    assert.ok(s.wakeToldAt, 'told is stored');
    assert.deepEqual(s.wakeTold, { who: 'ann', reached: true });
    taskwake.sweep(w.o(only(p), { book }));
    taskwake.sweep(w.o(only(p)));
    assert.equal(w.typed.length, 1, 'once, even with a fresh board memory (a restart)');
    const f = taskwake.fieldsOf(s);
    assert.equal(f.wakeMetWords, 'PR #12 in octo/hello: it was merged');
    assert.equal(f.wakeReached, true);
    assert.equal(f.wakeWords, undefined, 'no longer waiting');
  }
});

test('#8669: a held task, a busy holder and a holder off the project are not told now', () => {
  {
    const p = setupProject('Gates', ['ann']);
    const t = tasks.create(p.id, { sentence: 'Gated', who: 'ann' });
    tasks.setWake(p.id, t.number, { kind: 'at', at: Date.now() + 1000 }, { by: 'ann' });
    tasks.saveWakeMet(p.id, t.number, stored(p.id, t.number).wake.setAt, { at: new Date().toISOString(), words: 'the time came' });
    const w = world(['ann']);
    w.roster[0].state = 'working';
    let r = taskwake.sweep(w.o(only(p)));
    assert.equal(w.typed.length, 0);
    assert.equal(r.results[0].because, 'the holder is not idle, or cannot be typed into');
    w.roster[0].state = 'idle';
    r = taskwake.sweep(w.o(only(p), { idleSince: () => Date.now() - 5e3 }));
    assert.equal(r.results[0].because, 'the holder has only just gone idle');
    r = taskwake.sweep(w.o(only(p), { allowed: false }));
    assert.equal(r.results[0].because, 'Kosmos does not type into agents yet');
    tasks.setOnHold(p.id, t.number, true);
    assert.equal(taskwake.owed(projects.readAll()).filter((x) => x.projectId === p.id).length, 0, 'a held task waits');
    tasks.setOnHold(p.id, t.number, false);
    r = taskwake.sweep(w.o(only(p)));
    assert.equal(w.typed.length, 1);
    assert.match(w.typed[0].text, /was set to wake you .*, and that time has come\./);
  }
});

test('#8669: the history says the wake in words, and the board\'s own wake rows are not activity', () => {
  const { phrase } = require('./taskactphrase');
  const names = (sn) => ({ ann: 'Ann' }[sn] || null);
  assert.equal(phrase({ kind: 'wake-set', words: 'waits for PR #12 in octo/hello to merge' }, names), 'Set to wake: waits for PR #12 in octo/hello to merge');
  assert.equal(phrase({ kind: 'wake-met', words: 'it was merged' }, names), 'Woke: it was merged');
  assert.equal(phrase({ kind: 'wake-told', told: 'ann', reached: true }, names), 'Woke; Ann was told');
  assert.equal(phrase({ kind: 'wake-told', told: 'ann', reached: false }, names), 'Woke; Kosmos could not reach Ann');
  const p = setupProject('Quiet', ['ann']);
  const t = tasks.create(p.id, { sentence: 'Quiet one', who: 'ann' });
  tasks.setWake(p.id, t.number, { kind: 'at', at: Date.now() + 1000 }, { by: 'ann' });
  const before = tasks.lastActivityOf(p.id, stored(p.id, t.number));
  tasks.saveWakeMet(p.id, t.number, stored(p.id, t.number).wake.setAt, { at: new Date(Date.now() + 60e3).toISOString(), words: 'the time came' });
  taskchat.record(p.id, t.number, { kind: 'wake-told', told: 'ann', reached: true });
  assert.equal(tasks.lastActivityOf(p.id, stored(p.id, t.number)), before, 'unchanged by the wake-met and wake-told rows');
});

test('#8669: a woken branch says it plainly, and a holder off the project is told once they are back, not spent', () => {
  const f = taskwake.fieldsOf({ wake: { kind: 'branch', repo: 'octo/hello', branch: 'main', from: SHA_A, setAt: 'x' }, wakeMet: { at: 'x', words: 'it has a new commit (bbbbbbbbbb)' } });
  assert.equal(f.wakeMetWords, 'main in octo/hello: it has a new commit (bbbbbbbbbb)');
  const p = setupProject('Away', ['ann']);
  const t = tasks.create(p.id, { sentence: 'Away one', who: 'ann' });
  tasks.setWake(p.id, t.number, { kind: 'at', at: Date.now() + 1000 }, { by: 'ann' });
  tasks.saveWakeMet(p.id, t.number, stored(p.id, t.number).wake.setAt, { at: new Date().toISOString(), words: 'the time came' });
  projects.removeAgent(p.id, 'ann');
  const w = world(['ann']);
  const r = taskwake.sweep(w.o(only(p)));
  assert.equal(r.results[0].because, 'no holder is on the project');
  assert.equal(stored(p.id, t.number).wakeToldAt, undefined, 'the wake is not spent');
  projects.addAgent(p.id, 'ann');
  taskwake.sweep(w.o(only(p)));
  assert.equal(w.typed.length, 1, 'told once back on the project');
});

test('#8669: a wake on a task nobody holds tells the agent that set it', () => {
  const p = setupProject('Nobody', ['ann']);
  const t = tasks.create(p.id, { sentence: 'Unassigned one' });
  tasks.setWake(p.id, t.number, { kind: 'at', at: Date.now() + 1000 }, { by: 'ann' });
  tasks.saveWakeMet(p.id, t.number, stored(p.id, t.number).wake.setAt, { at: new Date().toISOString(), words: 'the time came' });
  const w = world(['ann']);
  taskwake.sweep(w.o(only(p)));
  assert.equal(w.typed.length, 1);
  assert.equal(w.typed[0].s, 'ann');
  // CONTROL: set by the person, nobody holds it: there is no agent to tell.
  const t2 = tasks.create(p.id, { sentence: 'Unassigned, the person\'s' });
  tasks.setWake(p.id, t2.number, { kind: 'at', at: Date.now() + 1000 }, { person: true });
  tasks.saveWakeMet(p.id, t2.number, stored(p.id, t2.number).wake.setAt, { at: new Date().toISOString(), words: 'the time came' });
  assert.equal(taskwake.owed(only(p)).filter((x) => x.n === t2.number).length, 0);
});

test('#8669: a file this Mac will not let the board read says so, at set time and on a look', async () => {
  const denied = () => { const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e; };
  const real = (x) => x;
  real.native = (x) => { if (x.startsWith('/home/Documents')) denied(); return x; };
  const tcc = { realpathSync: real, statSync: denied, lstatSync: () => ({}) };
  const set = await taskwake.prepare({ file: '/home/Documents/plan.md' }, { fs: tcc, home: '/home' });
  assert.match(set.problem, /^this Mac has not let Kosmos read that file: allow it under System Settings, Privacy & Security, Files and Folders/);
  const w = { kind: 'file', path: '/home/Documents/plan.md', from: 'stat:1:2', size: 1, mtimeMs: 2 };
  assert.deepEqual(await taskwake.probe(w, { fs: tcc, home: '/home' }, 'd', new Map()), { met: false, problem: 'this Mac has not let Kosmos read that file' }, 'never read as removed');
  // CONTROL: the realpath allows it but the read itself is refused.
  const real2 = (x) => x; real2.native = (x) => x;
  const tcc2 = { realpathSync: real2, statSync: denied, lstatSync: () => ({}) };
  assert.match((await taskwake.prepare({ file: '/home/notes/plan.md' }, { fs: tcc2, home: '/home' })).problem, /^this Mac has not let Kosmos read that file/);
  assert.equal(taskwake.wakeProblem({ kind: 'branch', repo: 'octo/hello', branch: 'main', from: 'c'.repeat(64) }), null, 'a SHA-256 commit id');
});

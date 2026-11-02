'use strict';
/**
 * kosmos#7404: a personal-backup restore runs in a child process, and the board signs only the restore's own routes.
 *
 *   node --test engine/personalrestorejob-7404.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prjob-7404-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.HOME = SANDBOX;
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
const job = require('./personalrestorejob');

/* A stand-in child: records what the board sends, and lets the test speak for the child. */
function fakeFork() {
  const made = [];
  const fork = (file, args, opts) => {
    const c = new EventEmitter();
    c.file = file; c.opts = opts; c.sent = []; c.killed = false;
    c.send = (m) => { c.sent.push(m); c.emit('sent', m); };
    c.kill = () => { c.killed = true; };
    made.push(c);
    return c;
  };
  return { fork, made };
}
const tick = () => new Promise((r) => setImmediate(r));
const nextSent = (c) => new Promise((r) => c.once('sent', r));

test.beforeEach(() => job._resetForTests());

test('a list asks the child for a list, and answers only named fields', async () => {
  const { fork, made } = fakeFork();
  const p = job.list({ fork, macRequest: async () => assert.fail('nothing to sign') });
  await tick();
  assert.equal(made.length, 1);
  assert.equal(path.basename(made[0].file), 'personalrestore-child.js');
  assert.deepEqual(made[0].opts.execArgv, []);
  assert.deepEqual(made[0].sent[0], { run: { op: 'list' } });
  made[0].emit('message', { done: { ok: true, more: false, keyMissing: false, extra: 'secret', backups: [{ key: 'k1', epoch: 1, takenAt: 5, problem: null, record: { sk: 'x' } }] } });
  const r = await p;
  assert.deepEqual(r, { ok: true, more: false, keyMissing: false, backups: [{ key: 'k1', epoch: 1, takenAt: 5, problem: null }] });
  assert.equal(made[0].killed, true);
});

test('two lists at once share one child', async () => {
  const { fork, made } = fakeFork();
  const a = job.list({ fork });
  const b = job.list({ fork });
  assert.equal(a, b);
  await tick();
  assert.equal(made.length, 1);
  made[0].emit('message', { done: { ok: false, because: 'Turn on personal backup on this computer first.', code: 'not_on' } });
  assert.deepEqual(await a, { ok: false, because: 'Turn on personal backup on this computer first.', code: 'not_on' });
});

test('the board signs a restore route for the child, and answers it back by id', async () => {
  const { fork, made } = fakeFork();
  const signed = [];
  const macRequest = async (m, r, b) => { signed.push([m, r, b]); return { ok: true, data: { manifests: [] } }; };
  const p = job.list({ fork, macRequest });
  await tick();
  const c = made[0];
  const answered = nextSent(c);
  c.emit('message', { mac: { id: 7, method: 'POST', route: '/v1/org/backup/mine/manifests', body: { epoch: 1 } } });
  assert.deepEqual(await answered, { macAnswer: { id: 7, got: { ok: true, data: { manifests: [] } } } });
  assert.deepEqual(signed, [['POST', '/v1/org/backup/mine/manifests', { epoch: 1 }]]);
  c.emit('message', { done: { ok: true, backups: [] } });
  await p;
});

test('any other route is refused and never signed', async () => {
  const { fork, made } = fakeFork();
  let signedAny = false;
  const p = job.list({ fork, macRequest: async () => { signedAny = true; return { ok: true, data: {} }; } });
  await tick();
  const c = made[0];
  const asks = [
    { id: 1, method: 'POST', route: '/v1/org/backup/member-key', body: {} },          // a key change, not a restore
    { id: 2, method: 'GET', route: '/v1/org/backup/mine/read', body: {} },            // right path, wrong method
    { id: 3, method: 'POST', route: '/v1/org/backup/mine/read/../../enroll', body: {} },
    { id: 4, method: 'POST', route: '/v1/org/backup/mine/read', body: [] },          // not an object body
    { id: 5, method: 'POST', route: '/v1/org/backup/mine/read' },                     // no body at all
  ];
  for (const q of asks) {
    const answered = nextSent(c);
    c.emit('message', { mac: q });
    const a = await answered;
    assert.equal(a.macAnswer.id, q.id);
    assert.equal(a.macAnswer.got.ok, false);
    assert.equal(a.macAnswer.got.notSent, true);
  }
  assert.equal(signedAny, false);
  // Control: the same shape on a route the restore does make IS signed, so the refusals above are the route check.
  const answered = nextSent(c);
  c.emit('message', { mac: { id: 6, method: 'POST', route: '/v1/org/backup/mine/read', body: {} } });
  await answered;
  assert.equal(signedAny, true);
  c.emit('message', { done: { ok: true, backups: [] } });
  await p;
});

test('a child that exits without answering reads as a refusal, not a hang', async () => {
  const { fork, made } = fakeFork();
  const p = job.list({ fork });
  await tick();
  made[0].emit('close', 1);
  const r = await p;
  assert.equal(r.ok, false);
  assert.match(r.because, /could not be listed/);
});

test('one restore at a time, and status says where it is', async () => {
  const { fork, made } = fakeFork();
  const first = job.start('k1', { fork });
  assert.equal(first.ok, true);
  assert.equal(job.status().running, true);
  const second = job.start('k2', { fork });
  assert.deepEqual(second, { ok: false, because: 'A restore is already running on this computer.', code: 'restore_running' });
  await tick();
  assert.equal(made.length, 1);
  // The worlds' base is the board's own (worldenv/worlds here), never the page's.
  const sent = made[0].sent[0].run;
  assert.equal(sent.op, 'restore'); assert.equal(sent.key, 'k1');
  const worlds = require('./worlds');
  assert.equal(sent.base, require('./worldenv').bootedBaseDir() || worlds.baseRoot(worlds.preWorldEnv(process.env)));
  assert.ok(path.isAbsolute(sent.base));
  made[0].emit('message', { done: { ok: true, world: { id: 'w1', name: 'Personal backup, Nov 2', dir: '/secret/path' }, restored: 3, failed: 0,
    moved: ['a'], kept: [], heldBack: [], fetchProblems: [], details: { failed: [], leftOutAtBackup: 2, fetchProblems: [] } } });
  await tick(); await tick();
  const s = job.status();
  assert.equal(s.running, false);
  assert.equal(s.last.ok, true);
  assert.deepEqual(s.last.world, { id: 'w1', name: 'Personal backup, Nov 2' });
  assert.equal(s.last.restored, 3);
  assert.equal(s.last.details.leftOutAtBackup, 2);
  assert.ok(!('dir' in s.last.world));
  // Finished: the next one may start.
  assert.equal(job.start('k2', { fork }).ok, true);
});

test('a restore cut off part way is recorded as stopped, and the next may start', async () => {
  const { fork, made } = fakeFork();
  job.start('k1', { fork });
  await tick();
  made[0].emit('close', null);
  await tick(); await tick();
  const s = job.status();
  assert.equal(s.running, false);
  assert.equal(s.last.ok, false);
  assert.match(s.last.because, /stopped on this computer before it finished/);
});

test('a key that is not a string never starts a child', () => {
  const { fork, made } = fakeFork();
  for (const k of [null, undefined, 3, '', 'x'.repeat(1025)]) assert.equal(job.start(k, { fork }).code, 'no_such_backup');
  assert.equal(made.length, 0);
});

/* The real child, forked: it starts, answers one ask, and exits. Personal backup is off in this sandbox, so the list
   is refused before anything is signed, and any signing ask would fail the test. */
test('the real child lists, refuses with personal backup off, and signs nothing', async () => {
  const r = await job.list({ macRequest: async () => assert.fail('a list with personal backup off signs nothing') });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_on');
});

test('the real child restoring with personal backup off refuses, and frees the slot', async () => {
  const started = job.start('k1', { macRequest: async () => assert.fail('nothing to sign') });
  assert.equal(started.ok, true);
  for (let i = 0; i < 200 && job.status().running; i++) await new Promise((r) => setTimeout(r, 50));
  const s = job.status();
  assert.equal(s.running, false);
  assert.equal(s.last.ok, false);
  assert.equal(s.last.code, 'not_on');
});

/* The child's half of the channel, in this process: a request goes out by id, and only its own answer resolves it. */
test('the child sends each request to the board and resolves it with that id\'s answer only', async () => {
  const child = require('./personalrestore-child');
  const sent = [];
  const had = process.send;
  process.send = (m) => { sent.push(m); };
  try {
    const a = child.macRequest('POST', '/v1/org/backup/mine/manifests', { epoch: 1 });
    const b = child.macRequest('POST', '/v1/org/backup/mine/read', { keys: ['x'] });
    assert.equal(sent.length, 2);
    const [qa, qb] = sent.map((m) => m.mac);
    assert.notEqual(qa.id, qb.id);
    assert.deepEqual([qa.method, qa.route, qa.body], ['POST', '/v1/org/backup/mine/manifests', { epoch: 1 }]);
    child.onMessage({ macAnswer: { id: qb.id, got: { ok: true, data: 'b' } } });
    child.onMessage({ macAnswer: { id: 999999, got: { ok: true, data: 'stray' } } });   // no such request: ignored
    child.onMessage({ macAnswer: { id: qa.id, got: 'not an object' } });
    assert.deepEqual(await b, { ok: true, data: 'b' });
    const ra = await a;
    assert.equal(ra.ok, false);
    assert.equal(ra.notSent, true);
  } finally { if (had) process.send = had; else delete process.send; }
});

test('a restore\'s reasons and failed files reach the screen capped, the cleaned list kept', async () => {
  const many = Array.from({ length: 30 }, (_, i) => 'why ' + i + ' ' + 'x'.repeat(400));
  const r = job.shapeRestore({ ok: true, fetchProblems: ['cleaned'], details: { fetchProblems: many,
    failed: Array.from({ length: 250 }, (_, i) => ({ path: 'p' + i + 'y'.repeat(2000), why: 'w'.repeat(500) })), leftOutAtBackup: 0 } });
  assert.deepEqual(r.fetchProblems, ['cleaned']);
  assert.equal(r.details.fetchProblems.length, 21);
  assert.equal(r.details.fetchProblems[20], '(more not listed)');
  assert.ok(r.details.fetchProblems.slice(0, 20).every((x) => x.length <= 300));
  assert.equal(r.details.failed.length, 200);
  assert.ok(r.details.failed.every((f) => f.path.length <= 1024 && f.why.length <= 300));
});

test('a list that never answers is ended at its time limit, and the child killed', async () => {
  const { fork, made } = fakeFork();
  const r = await job.list({ fork, timeoutMs: 30 });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not be listed/);
  assert.equal(made[0].killed, true);
});

test('an answer read after the child\'s exit event is still read', async () => {
  const { fork, made } = fakeFork();
  const p = job.list({ fork });
  await tick();
  made[0].emit('exit', 0);   // exit can come before the last message is read; only close settles a silent child
  made[0].emit('message', { done: { ok: true, backups: [] } });
  made[0].emit('close', 0);
  assert.equal((await p).ok, true);
});

/* The real child, under a parent that goes away: the child must exit when its channel closes. It is kept busy, as a
   restore in flight is (a timer stands in for its sockets): an idle child would exit on its own and prove nothing. */
test('the real child exits when the board that forked it goes away, even while busy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prjob-parent-'));
  const parent = path.join(dir, 'parent.js');
  const busy = path.join(dir, 'busy.js');
  fs.writeFileSync(busy, 'setInterval(() => {}, 1000);\n');
  fs.writeFileSync(parent, `const c = require('node:child_process').fork(${JSON.stringify(path.join(__dirname, 'personalrestore-child.js'))}, [], { execArgv: ['--require', ${JSON.stringify(busy)}], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
c.on('spawn', () => { process.stdout.write(String(c.pid) + '\\n'); setTimeout(() => process.exit(0), 200); });
`);
  const { execFileSync } = require('node:child_process');
  const pid = Number(String(execFileSync(process.execPath, [parent], { timeout: 10000 })).trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'the parent named its child');
  const alive = () => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  let gone = false;
  for (let i = 0; i < 100 && !gone; i++) { if (!alive()) gone = true; else await new Promise((r) => setTimeout(r, 50)); }
  if (!gone) { try { process.kill(pid); } catch { /* gone */ } }
  assert.equal(gone, true, 'the child outlived its parent');
});

test('the child restores into the base the board names', async () => {
  const child = require('./personalrestore-child');
  const pr = require('./personalrestore');
  const was = pr.restoreFiles;
  let got = null;
  pr.restoreFiles = async (pick, opts) => { got = { pick, base: opts.base }; return { ok: true }; };
  const sent = [];
  const had = process.send;
  process.send = (m, cb) => { sent.push(m); if (cb) cb(); };
  const exit = process.exit;
  process.exit = () => {};
  try {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prjob-base-'));
    child.onMessage({ run: { op: 'restore', key: 'k9', base } });
    for (let i = 0; i < 50 && !sent.some((m) => 'done' in m); i++) await tick();
    assert.deepEqual(got, { pick: { key: 'k9' }, base });
  } finally { pr.restoreFiles = was; process.exit = exit; if (had) process.send = had; else delete process.send; }
});

test('stop ends the running restore, records that the person stopped it, and frees the slot', async () => {
  assert.equal(job.stop().code, 'not_running');
  const { fork, made } = fakeFork();
  assert.equal(job.start('k1', { fork, base: SANDBOX }).ok, true);
  await tick();
  assert.deepEqual(job.stop(), { ok: true });
  assert.equal(made[0].killed, true);
  made[0].emit('close', null, 'SIGTERM');
  await tick(); await tick();
  const s = job.status();
  assert.equal(s.running, false);
  assert.equal(s.last.code, 'stopped');
  assert.match(s.last.because, /You stopped this restore/);
  assert.equal(job.start('k2', { fork, base: SANDBOX }).ok, true);
});

test('with names hidden, status gives counts and not the person\'s file names', async () => {
  const { fork, made } = fakeFork();
  job.start('k1', { fork, base: SANDBOX });
  await tick();
  made[0].emit('message', { done: { ok: true, world: { id: 'w1', name: 'Personal backup, Nov 2' }, restored: 2, failed: 1,
    moved: ['taxes-2025', 'diary'], kept: ['k'], heldBack: [], details: { failed: [{ path: 'secret/plans.txt', why: 'x' }], leftOutAtBackup: 3, fetchProblems: [] } } });
  await tick(); await tick();
  const hidden = job.status({ namesHidden: true });
  const text = JSON.stringify(hidden);
  for (const name of ['taxes-2025', 'diary', 'secret/plans.txt']) assert.ok(!text.includes(name), name + ' shown with names hidden');
  assert.equal(hidden.last.movedCount, 2);
  assert.equal(hidden.last.keptCount, 1);
  assert.equal(hidden.last.details.failedCount, 1);
  assert.equal(hidden.last.world.name, 'Personal backup, Nov 2');
  // Control: at the computer, the names are there, so the check above is what hides them.
  assert.ok(JSON.stringify(job.status()).includes('taxes-2025'));
});

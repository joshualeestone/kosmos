'use strict';
/* kosmos#7508 slice 2: engine/landedcheck.js against real repositories made here. A commit a branch contains is kept
   (the control) and says whether a remote-tracking ref has it; the same commit once its branch is deleted, and an
   object the repository never had, are missing; a repository that is gone, or a git that fails or runs out of time,
   is unknown and never missing. Answers are cached, and each request starts at most its budget of new checks. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const landedcheck = require('./landedcheck');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-landedcheck-')));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
test.beforeEach(() => landedcheck.resetForTests());

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function repoWithFix(name) {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'base\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'checkout', '-q', '-b', 'fix');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'fixed\n');
  git(dir, 'commit', '-q', '-am', 'the fix');
  const sha = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'checkout', '-q', 'main');
  return { dir, sha, repo: git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir') };
}
const task = (r, sha = r.sha) => ({ landedCommit: sha, landedRepo: r.repo });
/* A git that answers every call as the real one would, except the call that names `which`, which fails as `err`. */
const failingAt = (which, err) => (args) => {
  if (args.includes(which)) return Promise.reject(err);
  return new Promise((resolve, reject) => require('node:child_process').execFile('git', args, { encoding: 'utf8' }, (e, out) => (e ? reject(e) : resolve(out))));
};

test('#7508: a commit the repository has is kept, and says whether a remote has it, even once no ref contains it', async () => {
  const r = repoWithFix('kept');
  assert.deepEqual(await landedcheck.checkTask(task(r)), { state: 'kept', onRemote: false }, 'CONTROL: a local branch commit');
  const bare = path.join(SANDBOX, 'kept-remote.git');
  git(SANDBOX, 'init', '-q', '--bare', bare);
  git(r.dir, 'remote', 'add', 'origin', bare);
  git(r.dir, 'push', '-q', 'origin', 'fix');
  git(r.dir, 'fetch', '-q', 'origin');
  landedcheck.resetForTests();
  assert.deepEqual(await landedcheck.checkTask(task(r)), { state: 'kept', onRemote: true }, 'a pushed commit still read as only on this computer');
  // Review 3: merged by rebase, then its branch deleted here and the remote-tracking ref pruned: the object is still
  // there, so it was committed. That is kept, never missing (it only no longer says a remote has it).
  git(r.dir, 'branch', '-q', '-D', 'fix');
  git(r.dir, 'branch', '-q', '-r', '-D', 'origin/fix');
  landedcheck.resetForTests();
  assert.deepEqual(await landedcheck.checkTask(task(r)), { state: 'kept', onRemote: false }, 'a merged fix whose branch was cleaned up read as missing');
});

test('#7508: an object the repository never had is missing; a repository that is gone is unknown', async () => {
  const r = repoWithFix('never');
  assert.deepEqual(await landedcheck.checkTask(task(r, 'c'.repeat(40))), { state: 'missing' });
  assert.deepEqual(await landedcheck.checkTask({ landedCommit: r.sha, landedRepo: path.join(SANDBOX, 'gone', '.git') }), { state: 'unknown' },
    'a repository that is gone read as a missing change');
});

test('#7508 review 1: a git that times out, is killed or fails another way is unknown, never missing', async () => {
  const r = repoWithFix('slow');
  const timedOut = Object.assign(new Error('timed out'), { code: null, signal: 'SIGTERM', killed: true });
  assert.deepEqual(await landedcheck.checkTask(task(r), { git: failingAt('cat-file', timedOut) }), { state: 'unknown' },
    'a cat-file that ran out of time read as missing');
  landedcheck.resetForTests();
  const other = Object.assign(new Error('fatal'), { code: 128 });
  assert.deepEqual(await landedcheck.checkTask(task(r), { git: failingAt('cat-file', other) }), { state: 'unknown' });
  landedcheck.resetForTests();
  const absent = Object.assign(new Error('no such object'), { code: 1 });
  assert.deepEqual(await landedcheck.checkTask(task(r), { git: failingAt('cat-file', absent) }), { state: 'missing' },
    'CONTROL: cat-file exiting 1 is a missing object');
  landedcheck.resetForTests();
  // The object is there, so it was committed; only whether a remote has it is unknown (null, never false).
  assert.deepEqual(await landedcheck.checkTask(task(r), { git: failingAt('for-each-ref', timedOut) }), { state: 'kept', onRemote: null });
});

test('#7508: no commit means nothing to check; answers are cached; a request starts at most its budget of new checks', async () => {
  assert.equal(await landedcheck.checkTask({}), null);
  assert.equal(await landedcheck.checkTask({ landedCommit: 'e'.repeat(40) }), null, 'a commit with no repository was checked');
  let calls = 0;
  const counting = async (args) => { calls += 1; return args.includes('for-each-ref') ? 'refs/heads/main\n' : ''; };
  const t = { landedCommit: 'f'.repeat(40), landedRepo: SANDBOX };
  assert.equal((await landedcheck.checkTask(t, { git: counting })).state, 'kept');
  const after = calls;
  assert.equal((await landedcheck.checkTask(t, { git: counting })).state, 'kept');
  assert.equal(calls, after, 'a cached answer ran git again');
  assert.equal((await landedcheck.checkTask(t, { git: counting, now: () => Date.now() + landedcheck.TTL_MS + 1 })).state, 'kept');
  assert.ok(calls > after, 'CONTROL: an expired answer was not checked again');
  const budget = { left: 1 };
  const one = await landedcheck.checkTask({ landedCommit: '1'.repeat(40), landedRepo: SANDBOX }, { git: counting, budget });
  const two = await landedcheck.checkTask({ landedCommit: '2'.repeat(40), landedRepo: SANDBOX }, { git: counting, budget });
  assert.equal(one.state, 'kept');
  assert.equal(two, null, 'a check past the budget ran, or said something');
});

test('#7508 review 2: a could-not-check answer is tried again sooner than a kept one', async () => {
  let calls = 0;
  const slow = async () => { calls += 1; throw Object.assign(new Error('timed out'), { code: null, signal: 'SIGTERM', killed: true }); };
  const t = { landedCommit: '3'.repeat(40), landedRepo: SANDBOX };
  const t0 = Date.now();
  assert.equal((await landedcheck.checkTask(t, { git: slow, now: () => t0 })).state, 'unknown');
  const after = calls;
  await landedcheck.checkTask(t, { git: slow, now: () => t0 + landedcheck.UNKNOWN_TTL_MS - 1 });
  assert.equal(calls, after, 'CONTROL: within its short time it is cached');
  await landedcheck.checkTask(t, { git: slow, now: () => t0 + landedcheck.UNKNOWN_TTL_MS + 1 });
  assert.ok(calls > after, 'an unknown answer was kept as long as a kept one');
});

test('#7508 review 4: two reads at once share one check of the same commit', async () => {
  let calls = 0;
  const slow = (args) => new Promise((resolve) => { calls += 1; setTimeout(() => resolve(args.includes('for-each-ref') ? 'refs/heads/main\n' : ''), 20); });
  const t = { landedCommit: '4'.repeat(40), landedRepo: SANDBOX };
  const [a, b] = await Promise.all([landedcheck.checkTask(t, { git: slow }), landedcheck.checkTask(t, { git: slow, budget: { left: 10 } })]);
  assert.deepEqual(a, b);
  assert.equal(a.state, 'kept');
  assert.equal(calls, 3, 'two reads at once ran the check twice (' + calls + ' git calls)');
});

test('#7508 review 6: at most MAX_RUNNING checks run at once, whatever request started them', async () => {
  const gates = [];
  const hold = () => new Promise((resolve) => gates.push(() => resolve('refs/heads/main\n')));
  const started = [];
  for (let i = 0; i < landedcheck.MAX_RUNNING + 2; i += 1) {
    started.push(landedcheck.checkTask({ landedCommit: String(i % 10).repeat(39) + 'a', landedRepo: SANDBOX }, { git: hold, budget: { left: 10 } }));
  }
  const over = await Promise.race([started[landedcheck.MAX_RUNNING], new Promise((r) => setTimeout(() => r('still waiting'), 50))]);
  assert.equal(over, null, 'a check past the limit started anyway');
  while (gates.length) gates.shift()();
  await new Promise((r) => setTimeout(r, 20));
  while (gates.length) gates.shift()();
  await new Promise((r) => setTimeout(r, 20));
  while (gates.length) gates.shift()();
  const results = await Promise.all(started);
  assert.equal(results.filter((x) => x && x.state === 'kept').length, landedcheck.MAX_RUNNING, 'CONTROL: the ones under the limit ran');
});

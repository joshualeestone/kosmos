'use strict';
/* kosmos#7508 slice 2: engine/landedcheck.js against real repositories made here. A commit a branch contains is kept
   (the control); the same commit once its branch is deleted, and a commit the repository never had, are missing; a
   repository that is gone, or a git that fails, is unknown and never missing. Answers are cached, and each request
   runs at most its budget of new checks. */
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

test('#7508: a commit a branch contains is kept; once no ref contains it, it is missing', () => {
  const r = repoWithFix('kept');
  assert.equal(landedcheck.checkTask(task(r)), 'kept', 'CONTROL: a commit on a branch did not read as kept');
  git(r.dir, 'branch', '-q', '-D', 'fix');
  landedcheck.resetForTests();
  assert.equal(landedcheck.checkTask(task(r)), 'missing', 'a commit no ref contains read as kept');
});

test('#7508: a commit the repository never had is missing; a repository that is gone, or a failing git, is unknown', () => {
  const r = repoWithFix('never');
  assert.equal(landedcheck.checkTask(task(r, 'c'.repeat(40))), 'missing');
  assert.equal(landedcheck.checkTask({ landedCommit: r.sha, landedRepo: path.join(SANDBOX, 'gone', '.git') }), 'unknown',
    'a repository that is gone read as a missing change');
  const failing = landedcheck.checkTask({ landedCommit: 'd'.repeat(40), landedRepo: r.repo }, { git: () => { throw new Error('git broke'); } });
  assert.equal(failing, 'unknown', 'a git that could not answer read as a missing change');
});

test('#7508: no commit means nothing to check; answers are cached; a request runs at most its budget of new checks', () => {
  assert.equal(landedcheck.checkTask({}), null);
  assert.equal(landedcheck.checkTask({ landedCommit: 'e'.repeat(40) }), null, 'a commit with no repository was checked');
  let calls = 0;
  const counting = (args) => { calls += 1; return args.includes('for-each-ref') ? 'refs/heads/main\n' : ''; };
  const t = { landedCommit: 'f'.repeat(40), landedRepo: SANDBOX };
  assert.equal(landedcheck.checkTask(t, { git: counting }), 'kept');
  const after = calls;
  assert.equal(landedcheck.checkTask(t, { git: counting }), 'kept');
  assert.equal(calls, after, 'a cached answer ran git again');
  assert.equal(landedcheck.checkTask(t, { git: counting, now: () => Date.now() + landedcheck.TTL_MS + 1 }), 'kept');
  assert.ok(calls > after, 'CONTROL: an expired answer was not checked again');
  const budget = { left: 1 };
  const one = landedcheck.checkTask({ landedCommit: '1'.repeat(40), landedRepo: SANDBOX }, { git: counting, budget });
  const two = landedcheck.checkTask({ landedCommit: '2'.repeat(40), landedRepo: SANDBOX }, { git: counting, budget });
  assert.equal(one, 'kept');
  assert.equal(two, null, 'a check past the budget ran, or said something');
});

'use strict';
/* kosmos#7508 slice 2: is the commit a code-fix task names still kept, and does a remote have it? Read when the Tasks
 * view is read, not once at close, because the loss this card is about can happen after the task closes, and a fix
 * pushed after its mark should stop saying it is only on this computer.
 *
 * The answer, for the commit's repository (its shared git directory, as `kosmos task built --commit` recorded it):
 *   { state: 'kept', onRemote }   some ref contains it; onRemote says whether a remote-tracking ref does
 *   { state: 'missing' }          the repository answers, and either has no such object (cat-file -e exits 1) or no ref
 *                                 contains it
 *   { state: 'unknown' }          the repository is gone, or git could not answer (a timeout, a signal, any other exit):
 *                                 never shown as missing
 * A squash or rebase merge whose branch was then deleted everywhere also reads 'missing' (the card's weakest premise),
 * which is why the person-facing words say it "may not have been saved".
 *
 * The repository is a path an agent's own mark recorded. These git commands only read: rev-parse, cat-file and
 * for-each-ref run no hooks, and only a token-holding agent can set the field.
 *
 * Bounded and never blocking: git runs asynchronously with a time limit per call (at most four calls per check),
 * answers are kept for TTL_MS, and a request starts at most `budget.left` new checks; past that a row gets no answer
 * (null), which the page reads as "not checked this time".
 */
const fs = require('node:fs');
const childProcess = require('node:child_process');

const TTL_MS = 5 * 60 * 1000;
const GIT_TIMEOUT_MS = 3000;
const cache = new Map();

/** git, resolving its standard output, or rejecting with the child's status, signal and code. */
function runGit(args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile('git', args, { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout);
    });
  });
}
/* Only a plain exit status of 1 means "no such object"; a time limit, a signal or a spawn failure is no answer. */
const exitedOne = (err) => !!err && err.code === 1 && !err.signal && !err.killed;

async function answer({ repo, sha }, git, exists) {
  if (!exists(repo)) return { state: 'unknown' };
  try { await git(['--git-dir', repo, 'rev-parse', '--git-dir']); } catch { return { state: 'unknown' }; }
  try { await git(['--git-dir', repo, 'cat-file', '-e', sha]); } catch (err) { return { state: exitedOne(err) ? 'missing' : 'unknown' }; }
  let any;
  let remote;
  try {
    any = String(await git(['--git-dir', repo, 'for-each-ref', '--contains', sha, '--count=1', '--format=%(refname)'])).trim();
    remote = any ? String(await git(['--git-dir', repo, 'for-each-ref', '--contains', sha, '--count=1', '--format=%(refname)', 'refs/remotes'])).trim() : '';
  } catch { return { state: 'unknown' }; }
  return any ? { state: 'kept', onRemote: !!remote } : { state: 'missing' };
}

function prune(now) {
  for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
}

/**
 * The check for one task that names a commit, or null when it names none or the request's budget is spent. `budget`
 * is { left: n }, shared by one request's rows; `git` (resolving stdout, rejecting as execFile does), `exists` and `now`
 * are test seams.
 */
async function checkTask(t, { budget = { left: 10 }, git = runGit, exists = fs.existsSync, now = Date.now } = {}) {
  if (!t || typeof t.landedCommit !== 'string' || typeof t.landedRepo !== 'string') return null;
  const key = t.landedRepo + '\u0000' + t.landedCommit;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.result;
  if (!(budget.left > 0)) return null;
  budget.left -= 1;
  let result;
  try { result = await answer({ repo: t.landedRepo, sha: t.landedCommit }, git, exists); } catch { result = { state: 'unknown' }; }
  prune(now());
  cache.set(key, { result, at: now() });
  return result;
}

function resetForTests() { cache.clear(); }

module.exports = { checkTask, resetForTests, TTL_MS };

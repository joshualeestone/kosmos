'use strict';
/* kosmos#7508 slice 2: is the commit a code-fix task names still kept, and does a remote have it? Read when the Tasks
 * view is read, not once at close, because the loss this card is about can happen after the task closes, and a fix
 * pushed after its mark should stop saying it is only on this computer.
 *
 * The answer, for the commit's repository (its shared git directory, as `kosmos task built --commit` recorded it):
 *   { state: 'kept', onRemote }   the repository has the commit object: it was committed. onRemote says whether a
 *                                 remote-tracking ref contains it (null when the walk could not answer)
 *   { state: 'missing' }          the repository answers and has no such object (cat-file -e exits 1)
 *   { state: 'unknown' }          the repository is gone, or git could not answer (a timeout, a signal, any other exit):
 *                                 never shown as missing
 * Review 3: "no ref contains it" is NOT missing. This repo merges by rebase, so main carries another sha, and cleanup
 * then deletes the branch: a fix merged as it should be has its object and no ref. The object is what proves it was
 * committed, which is the failure the card is about. Git prunes unreachable objects after two weeks by default, so the
 * route checks only tasks closed in the last CHECK_WINDOW_MS (a later object loss is git's cleanup, not a lost fix).
 *
 * The repository is a path an agent's own mark recorded, and only a token-holding agent can set the field. These git
 * commands only read (rev-parse, cat-file, for-each-ref). Each runs with fsmonitor and the hooks path off, no optional
 * locks, no lazy fetch of a missing object (a partial clone would otherwise go to its remote) and every transport
 * refused, so the check never reaches the network.
 *
 * Bounded and never blocking: git runs asynchronously with a time limit per call (at most four calls per check),
 * answers are kept for TTL_MS, and a request starts at most `budget.left` new checks; past that a row gets no answer
 * (null), which the page reads as "not checked this time".
 */
const fs = require('node:fs');
const childProcess = require('node:child_process');

const TTL_MS = 5 * 60 * 1000;
/* review 2: an 'unknown' (often a slow history walk on a big repository) is tried again sooner. */
const UNKNOWN_TTL_MS = 30 * 1000;
/* Git's default gc.pruneExpire: past it an unreachable object may be cleaned away, so an older closed task is not checked. */
const CHECK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const GIT_TIMEOUT_MS = 3000;
const cache = new Map();
/* Review 4: a check already running is shared, so two reads at once (a poll and a second tab) start it once. */
const pending = new Map();

/** git, resolving its standard output, or rejecting with the child's status, signal and code. */
function runGit(args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'protocol.allow=never', ...args],
      { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_CONFIG_NOSYSTEM: '1' } }, (err, stdout) => {
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
  let onRemote = null;
  try { onRemote = String(await git(['--git-dir', repo, 'for-each-ref', '--contains', sha, '--count=1', '--format=%(refname)', 'refs/remotes'])).trim() !== ''; } catch { onRemote = null; }
  return { state: 'kept', onRemote };
}

function prune(now) {
  for (const [k, v] of cache) if (now - v.at >= (v.result.state === 'unknown' ? UNKNOWN_TTL_MS : TTL_MS)) cache.delete(k);
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
  if (hit && now() - hit.at < (hit.result.state === 'unknown' ? UNKNOWN_TTL_MS : TTL_MS)) return hit.result;
  if (pending.has(key)) return pending.get(key);
  if (!(budget.left > 0)) return null;
  budget.left -= 1;
  const run = (async () => {
    let result;
    try { result = await answer({ repo: t.landedRepo, sha: t.landedCommit }, git, exists); } catch { result = { state: 'unknown' }; }
    prune(now());
    cache.set(key, { result, at: now() });
    return result;
  })();
  pending.set(key, run);
  try { return await run; } finally { pending.delete(key); }
}

function resetForTests() { cache.clear(); pending.clear(); }

module.exports = { checkTask, resetForTests, TTL_MS, UNKNOWN_TTL_MS, CHECK_WINDOW_MS };

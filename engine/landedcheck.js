'use strict';
/* kosmos#7508 slice 2: is the commit a closed code-fix task names still kept? Read when the Tasks view is read, not once
 * at close, because the loss this card is about can happen after the task closes.
 *
 * The answer, for the commit's repository (its shared git directory, as `kosmos task built --commit` recorded it):
 *   'kept'    some branch or tag, local or remote-tracking, contains it
 *   'missing' the repository answers, and either has no such commit or no ref contains it
 *   'unknown' the repository is gone or git could not answer: never shown as missing
 * A squash or rebase merge whose branch was then deleted everywhere also reads 'missing' (the card's weakest premise),
 * which is why the person-facing words say it "may not have been saved".
 *
 * Bounded: one git process per call with a time limit, answers kept for TTL_MS, and at most `budget.left` new checks
 * per request; past that the row gets no answer at all (null), which the page reads as "not checked".
 */
const fs = require('node:fs');
const childProcess = require('node:child_process');

const TTL_MS = 5 * 60 * 1000;
const GIT_TIMEOUT_MS = 3000;
const cache = new Map();

function runGit(args) {
  return childProcess.execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS, windowsHide: true });
}

function answer({ repo, sha }, git, exists) {
  if (!exists(repo)) return 'unknown';
  try { git(['--git-dir', repo, 'rev-parse', '--git-dir']); } catch { return 'unknown'; }
  try { git(['--git-dir', repo, 'cat-file', '-e', sha + '^{commit}']); } catch { return 'missing'; }
  let refs;
  try { refs = String(git(['--git-dir', repo, 'for-each-ref', '--contains', sha, '--count=1', '--format=%(refname)'])).trim(); } catch { return 'unknown'; }
  return refs ? 'kept' : 'missing';
}

/**
 * The check for one closed task (the caller decides it is closed), or null when it names no commit or the request's
 * budget is spent.
 * `budget` is { left: n }, shared by one request's rows; `git`, `exists` and `now` are test seams.
 */
function checkTask(t, { budget = { left: 20 }, git = runGit, exists = fs.existsSync, now = Date.now } = {}) {
  if (!t || typeof t.landedCommit !== 'string' || typeof t.landedRepo !== 'string') return null;
  const key = t.landedRepo + '\u0000' + t.landedCommit;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.state;
  if (!(budget.left > 0)) return null;
  budget.left -= 1;
  let state;
  try { state = answer({ repo: t.landedRepo, sha: t.landedCommit }, git, exists); } catch { state = 'unknown'; }
  cache.set(key, { state, at: now() });
  return state;
}

function resetForTests() { cache.clear(); }

module.exports = { checkTask, resetForTests, TTL_MS };

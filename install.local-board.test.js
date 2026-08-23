'use strict';
/**
 * The local-board restart step (#360) says which of its cases it found, and
 * from a worktree it declines: the job runs main's code, not the worktree's.
 * The restart itself is not exercised here (it would restart the operator's
 * board); `--check` runs the same gate and reports instead.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('restart-local-board --check names one of its three cases and never restarts', () => {
  const out = execFileSync('bash', [path.join(__dirname, 'tools', 'restart-local-board.sh'), '--check'], { encoding: 'utf8', timeout: 20000 });
  assert.match(out, /no launchctl on this machine|no com\.kosmos\.board job on this Mac|runs from .* not from this repo|runs from this repo on port \d+/, out);
  assert.doesNotMatch(out, /restarting it/, 'a --check restarted the board');
});

test('the release runs the restart step after the served check, and the step is on the syntax line', () => {
  const fs = require('node:fs');
  const rel = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
  const served = rel.indexOf('tools/verify-served.sh');
  const restart = rel.indexOf('tools/restart-local-board.sh');
  assert.ok(served > 0 && restart > served, 'the restart does not follow the served check');
  assert.ok(!/if bash "\$REPO\/tools\/verify-served\.sh"; then exit 0; fi/.test(rel), 'the served check still exits the release before the restart can run');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.match(pkg.scripts["test:shell"], /bash -n tools\/restart-local-board\.sh/, 'the step is not syntax-checked by yarn test');
});

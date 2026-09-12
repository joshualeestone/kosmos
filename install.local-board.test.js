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
const fs = require('node:fs');
const path = require('node:path');

test('restart-local-board --check names one of its deployment cases and never restarts', () => {
  const out = execFileSync('bash', [path.join(__dirname, 'tools', 'restart-local-board.sh'), '--check'], { encoding: 'utf8', timeout: 20000 });
  assert.match(out, /no launchctl on this machine|no com\.kosmos\.board job on this Mac|runs from this repo on port \d+|runs from the libexec deploy .* on port \d+|neither this repo .* nor the libexec deploy .* leaving it alone/, out);
  assert.doesNotMatch(out, /restarting it/, 'a --check restarted the board');
});

test('the release refreshes an adopted libexec board from the frozen tree before restarting it', () => {
  const rel = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
  const served = rel.indexOf('REPO="$REPO" bash "$REPO/tools/verify-served.sh"');
  const deploy = rel.indexOf('bash "$REPO/deploy/install-board.sh" --refresh-only');
  // Anchor on the actual restart INVOCATION, not a bare `tools/restart-local-board.sh`
  // mention: #2860 added a comment naming that path earlier in the file, and indexOf
  // returns the first hit, which would put `restart` before `deploy` and false-fail.
  const restart = rel.indexOf('$MAIN_REPO/tools/restart-local-board.sh');
  assert.ok(served > 0 && deploy > served && restart > deploy, 'served check, libexec deploy, and restart are not ordered safely');
  // #2860: the inline `[ -n "$_board_wd" ] && [ "$_board_wd" = "$_board_libexec" ]` gate
  // moved into the shared classifier tools/lib/board-shape.sh. release.sh acts on shape
  // (b) only, so it passes an empty repo arg and the deploy is gated on the classifier
  // returning `libexec` -- the same positive-libexec-working-directory match as before.
  assert.match(rel, /\[ "\$\(board_shape_of "\$_board_wd" "" "\$_board_libexec"\)" = libexec \]/, 'the release deploy is not gated on a positive libexec working-directory match');
  assert.doesNotMatch(rel, /bash "\$MAIN_REPO\/deploy\/install-board\.sh" --refresh-only/, 'the deploy came from the moving shared checkout instead of the frozen tree');
  assert.ok(!/if bash "\$REPO\/tools\/verify-served\.sh"; then exit 0; fi/.test(rel), 'the served check still exits the release before the restart can run');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.match(pkg.scripts["test:shell"], /bash -n tools\/restart-local-board\.sh/, 'the step is not syntax-checked by yarn test');
});

test('restart version read passes the deployed package path through argv', () => {
  const restart = fs.readFileSync(path.join(__dirname, 'tools', 'restart-local-board.sh'), 'utf8');
  assert.match(restart, /readFileSync\(process\.argv\[1\]/, 'the deployed path is interpolated into JavaScript source');
  assert.match(restart, /"\$_srcdir\/package\.json"/, 'the package path is not passed as an argv value');
});

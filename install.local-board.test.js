'use strict';
/**
 * The local-board restart step (#360) says which of its cases it found, and
 * from a worktree it declines: the job runs main's code, not the worktree's.
 * The restart itself is not exercised here (it would restart the operator's
 * board); `--check` runs the same gate and reports instead.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('restart-local-board --check names one of its deployment cases and never restarts', () => {
  const out = execFileSync('bash', [path.join(__dirname, 'tools', 'restart-local-board.sh'), '--check'], { encoding: 'utf8', timeout: 20000 });
  assert.match(out, /no launchctl on this machine|no com\.kosmos\.board job on this Mac|runs from this repo on port \d+|runs from the libexec deploy .* on port \d+|neither this repo .* nor the libexec deploy .* leaving it alone/, out);
  assert.doesNotMatch(out, /restarting it/, 'a --check restarted the board');
});

test('the release refreshes an adopted libexec board from the frozen tree before restarting it', () => {
  const rel = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
  const served = rel.indexOf('REPO="$REPO" bash "$REPO/tools/verify-served.sh"');
  const deploy = rel.indexOf('bash "$REPO/deploy/install-board.sh" --apply');
  const restart = rel.indexOf('tools/restart-local-board.sh');
  assert.ok(served > 0 && deploy > served && restart > deploy, 'served check, libexec deploy, and restart are not ordered safely');
  assert.match(rel, /\[ -n "\$_board_wd" \] && \[ "\$_board_wd" = "\$_board_libexec" \]/, 'the release deploy is not gated on a positive libexec working-directory match');
  assert.doesNotMatch(rel, /bash "\$MAIN_REPO\/deploy\/install-board\.sh" --apply/, 'the deploy came from the moving shared checkout instead of the frozen tree');
  assert.ok(!/if bash "\$REPO\/tools\/verify-served\.sh"; then exit 0; fi/.test(rel), 'the served check still exits the release before the restart can run');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.match(pkg.scripts["test:shell"], /bash -n tools\/restart-local-board\.sh/, 'the step is not syntax-checked by yarn test');
});

test('board deploy refuses a destination inside a git work tree before replacing anything', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-board-dest-'));
  const repo = path.join(fixture, 'repo');
  fs.mkdirSync(path.join(repo, 'deploy'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'deploy', 'install-board.sh'), path.join(repo, 'deploy', 'install-board.sh'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"1.2.3"}\n');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);

  const run = spawnSync('bash', [path.join(repo, 'deploy', 'install-board.sh'), '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, KOSMOS_BOARD_LIBEXEC: repo, KOSMOS_BOARD_PLIST: path.join(fixture, 'board.plist') },
  });
  assert.equal(run.status, 1, `expected refusal, stdout: ${run.stdout}, stderr: ${run.stderr}`);
  assert.match(run.stderr, /destination is inside a git work tree/, run.stderr);
  assert.ok(fs.existsSync(path.join(repo, '.git')), 'the apply replaced the fixture repository');
});

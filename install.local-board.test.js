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
  const deploy = rel.indexOf('bash "$REPO/deploy/install-board.sh" --refresh-only');
  const restart = rel.indexOf('tools/restart-local-board.sh');
  const gate = rel.indexOf('if [ -n "$_board_wd" ] && [ "$_board_wd" = "$_board_libexec" ]; then');
  const gateEnd = rel.indexOf('\nfi', gate);
  assert.ok(served > 0 && deploy > served && restart > deploy, 'served check, libexec deploy, and restart are not ordered safely');
  assert.ok(gate > served && deploy > gate && deploy < gateEnd && gateEnd < restart, 'the frozen-tree deploy is not inside the positive libexec working-directory gate');
  assert.doesNotMatch(rel, /bash "\$MAIN_REPO\/deploy\/install-board\.sh" --refresh-only/, 'the deploy came from the moving shared checkout instead of the frozen tree');
  assert.ok(!/if bash "\$REPO\/tools\/verify-served\.sh"; then exit 0; fi/.test(rel), 'the served check still exits the release before the restart can run');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.match(pkg.scripts["test:shell"], /bash -n tools\/restart-local-board\.sh/, 'the step is not syntax-checked by yarn test');
});

test('the real release block refreshes only libexec, fails closed, then restarts once', () => {
  const rel = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
  const start = rel.indexOf('_board_libexec="${KOSMOS_BOARD_LIBEXEC:-');
  const restartLine = 'KOSMOS_BOARD_WAIT_SECS="${KOSMOS_BOARD_WAIT_SECS:-120}" bash "$MAIN_REPO/tools/restart-local-board.sh"';
  const end = rel.indexOf(restartLine, start) + restartLine.length;
  assert.ok(start > 0 && end > start, 'could not extract the production release refresh block');
  const block = rel.slice(start, end);

  function run(wd, deployStatus = 0, libexec = '/deployed') {
    const prelude = `set -e\nLOG="$1"\nBOARD_WD="$2"\nREPO=/frozen\nMAIN_REPO=/moving\nKOSMOS_BOARD_LIBEXEC=${libexec}\nKOSMOS_BOARD_WAIT_SECS=1\nstep(){ :; }\nid(){ echo 501; }\nlaunchctl(){ printf 'working directory = %s\\n' "$BOARD_WD"; }\nbash(){ printf '%s\\n' "$*" >> "$LOG"; case "$*" in *install-board.sh*) return ${deployStatus};; esac; }\n`;
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-release-refresh-')), 'calls');
    const result = spawnSync('bash', ['-c', prelude + block, 'fixture', log, wd], { encoding: 'utf8' });
    return { result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] };
  }

  const adopted = run('/deployed');
  assert.equal(adopted.result.status, 0, adopted.result.stderr);
  assert.deepEqual(adopted.calls, ['/frozen/deploy/install-board.sh --refresh-only', '/moving/tools/restart-local-board.sh']);
  const trailing = run('/deployed', 0, '/deployed/');
  assert.equal(trailing.result.status, 0, trailing.result.stderr);
  assert.deepEqual(trailing.calls, adopted.calls, 'a trailing-slash override hid the adopted board');
  for (const wd of ['/moving', '/foreign', '']) {
    const other = run(wd);
    assert.equal(other.result.status, 0, other.result.stderr);
    assert.deepEqual(other.calls, ['/moving/tools/restart-local-board.sh'], `unexpected refresh for WD ${wd || '(absent)'}`);
  }
  const failed = run('/deployed', 9);
  assert.notEqual(failed.result.status, 0, 'a failed refresh did not fail the release block');
  assert.deepEqual(failed.calls, ['/frozen/deploy/install-board.sh --refresh-only'], 'restart ran after a failed refresh');
});

test('board deploy refuses existing and not-yet-created destinations inside a git work tree', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-board-dest-'));
  const repo = path.join(fixture, 'repo');
  fs.mkdirSync(path.join(repo, 'deploy'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'deploy', 'install-board.sh'), path.join(repo, 'deploy', 'install-board.sh'));
  fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"1.2.3"}\n');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);

  for (const destination of [repo, `${repo}/`, path.join(repo, 'not-created', 'board')]) {
    const run = spawnSync('bash', [path.join(repo, 'deploy', 'install-board.sh'), '--apply'], {
      encoding: 'utf8',
      env: { ...process.env, KOSMOS_BOARD_LIBEXEC: destination, KOSMOS_BOARD_PLIST: path.join(fixture, 'board.plist') },
    });
    assert.equal(run.status, 1, `expected refusal for ${destination}, stdout: ${run.stdout}, stderr: ${run.stderr}`);
    assert.match(run.stderr, /destination (?:is inside a git work tree|contains the source repository)/, run.stderr);
    assert.ok(!fs.existsSync(path.join(repo, 'not-created')), 'the apply created a nested destination inside the fixture repository');
  }
  assert.ok(fs.existsSync(path.join(repo, '.git')), 'the apply replaced the fixture repository');

  const ancestor = spawnSync('bash', [path.join(repo, 'deploy', 'install-board.sh'), '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, KOSMOS_BOARD_LIBEXEC: fixture, KOSMOS_BOARD_PLIST: path.join(fixture, 'board.plist') },
  });
  assert.equal(ancestor.status, 1, `expected ancestor refusal, stdout: ${ancestor.stdout}, stderr: ${ancestor.stderr}`);
  assert.match(ancestor.stderr, /destination contains the source repository/, ancestor.stderr);
  assert.ok(fs.existsSync(path.join(repo, '.git')), 'the ancestor apply removed the fixture repository');

  const dotEscape = spawnSync('bash', [path.join(repo, 'deploy', 'install-board.sh'), '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, KOSMOS_BOARD_LIBEXEC: `${fixture}/missing/../repo`, KOSMOS_BOARD_PLIST: path.join(fixture, 'board.plist') },
  });
  assert.equal(dotEscape.status, 1, `expected dot-component refusal, stdout: ${dotEscape.stdout}, stderr: ${dotEscape.stderr}`);
  assert.match(dotEscape.stderr, /must not contain dot path components/, dotEscape.stderr);

  const fileAncestor = path.join(fixture, 'ordinary-file');
  fs.writeFileSync(fileAncestor, 'not a directory');
  const throughFile = spawnSync('bash', [path.join(repo, 'deploy', 'install-board.sh'), '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, KOSMOS_BOARD_LIBEXEC: `${fileAncestor}/board`, KOSMOS_BOARD_PLIST: path.join(fixture, 'board.plist') },
  });
  assert.equal(throughFile.status, 1, `expected file-ancestor refusal, stdout: ${throughFile.stdout}, stderr: ${throughFile.stderr}`);
  assert.match(throughFile.stderr, /nearest existing destination ancestor is not a directory/, throughFile.stderr);
});

test('refresh-only swaps a trailing-slash destination without plist or launchd changes', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-board-refresh-'));
  const source = path.join(fixture, 'source');
  const destination = path.join(fixture, 'deployed');
  fs.mkdirSync(path.join(source, 'deploy'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'deploy', 'install-board.sh'), path.join(source, 'deploy', 'install-board.sh'));
  for (const name of ['server.js', 'package.json']) fs.copyFileSync(path.join(__dirname, name), path.join(source, name));
  fs.cpSync(path.join(__dirname, 'engine'), path.join(source, 'engine'), { recursive: true });
  fs.cpSync(path.join(__dirname, 'web'), path.join(source, 'web'), { recursive: true });
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  for (const name of ['agent-supervisor.sh', 'codex-report-bridge.js']) fs.copyFileSync(path.join(__dirname, 'bin', name), path.join(source, 'bin', name));
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'stale'), 'old');
  const plist = path.join(fixture, 'board.plist');
  fs.writeFileSync(plist, 'unchanged');
  const launchctl = path.join(fixture, 'launchctl');
  fs.writeFileSync(launchctl, '#!/bin/sh\nprintf called > "$KOSMOS_LAUNCHCTL_MARKER"\nexit 91\n', { mode: 0o755 });
  const marker = path.join(fixture, 'launchctl-called');
  const run = spawnSync('bash', [path.join(source, 'deploy', 'install-board.sh'), '--refresh-only'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fixture}:${process.env.PATH}`, KOSMOS_LAUNCHCTL_MARKER: marker, KOSMOS_BOARD_LIBEXEC: `${destination}/`, KOSMOS_BOARD_PLIST: plist },
  });
  assert.equal(run.status, 0, `refresh failed, stdout: ${run.stdout}, stderr: ${run.stderr}`);
  assert.ok(fs.existsSync(path.join(destination, 'server.js')), 'the refreshed app was not installed');
  assert.ok(!fs.existsSync(path.join(destination, 'stale')), 'the stale deployed tree was not replaced');
  assert.equal(fs.readFileSync(plist, 'utf8'), 'unchanged', 'refresh-only rewrote the plist');
  assert.ok(!fs.existsSync(marker), 'refresh-only invoked launchctl');
});

test('restart version read accepts an apostrophe in the deployed path', () => {
  const restart = fs.readFileSync(path.join(__dirname, 'tools', 'restart-local-board.sh'), 'utf8');
  const command = restart.split('\n').find((line) => line.trimStart().startsWith("node -e 'console.log(JSON.parse"));
  assert.ok(command, 'could not find the production deployed-version read');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "kosmos-board-o'clock-"));
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"version":"9.8.7"}\n');
  const run = spawnSync('bash', ['-c', `_srcdir="$1"\n${command}`, 'fixture', fixture], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '9.8.7');
});

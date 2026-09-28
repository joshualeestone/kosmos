'use strict';
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits

/* kosmos#1050: tools/gap-alarm.js, the scheduled read-only check that tells the release owner when
 * main has run too far past staging, or staging past prod. The verdict and the post rule are pure;
 * the end-to-end cases run the real script against a throwaway git repo with dated commits, pointers
 * served from a local HTTP server, and stub commands in place of claude-msg and gh.
 *
 *   node --test tools.gap-alarm.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const alarm = require('./tools/gap-alarm');

const SCRIPT = path.join(__dirname, 'tools', 'gap-alarm.js');
const H = 3600;
const NOW = 1_800_000_000;
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

test('verdict: each limit on its own side, at the limit is not past it, and nothing waiting is never an alarm', () => {
  const v = (main, staging) => alarm.verdict({ main, staging, now: NOW });
  assert.deepEqual(v({ ahead: 50, oldestAt: NOW - 24 * H }, { ahead: 3, builtAt: NOW - 48 * H }).reasons, [], 'exactly at the limits is not past them');
  assert.deepEqual(v({ ahead: 51, oldestAt: NOW - H }, { ahead: 0, builtAt: null }).reasons, ['main-commits']);
  assert.deepEqual(v({ ahead: 2, oldestAt: NOW - 24 * H - 1 }, { ahead: 0, builtAt: null }).reasons, ['main-hours']);
  assert.deepEqual(v({ ahead: 0, oldestAt: null }, { ahead: 1, builtAt: NOW - 48 * H - 1 }).reasons, ['staging-hours']);
  assert.deepEqual(v({ ahead: 0, oldestAt: NOW - 999 * H }, { ahead: 0, builtAt: NOW - 999 * H }).reasons, [], 'an old stamp with nothing waiting is not a gap');
  const all = v({ ahead: 60, oldestAt: NOW - 30 * H }, { ahead: 9, builtAt: NOW - 50 * H });
  assert.deepEqual(all.reasons, ['main-commits', 'main-hours', 'staging-hours']);
  assert.equal(all.alarm, true);
  assert.deepEqual(all.main, { ahead: 60, hours: 30 });
  assert.deepEqual(all.staging, { ahead: 9, hours: 50 });
});

test('decidePost: an alarm posts once, again when its reasons change or a day passes, and once more when it clears', () => {
  const a = { alarm: true, reasons: ['main-hours'] };
  const b = { alarm: true, reasons: ['main-hours', 'staging-hours'] };
  const clear = { alarm: false, reasons: [] };
  const unknown = { unknown: true, alarm: false, reasons: [] };
  assert.equal(alarm.decidePost(a, null, NOW).post, 'alarm', 'a first alarm is not posted');
  const last = { key: 'alarm:main-hours', at: NOW };
  assert.equal(alarm.decidePost(a, last, NOW + H).post, null, 'the same alarm was re-posted inside a day');
  assert.equal(alarm.decidePost(b, last, NOW + H).post, 'alarm', 'a change of reasons was not posted');
  assert.equal(alarm.decidePost(a, last, NOW + 24 * H).post, 'alarm', 'a standing alarm was not re-posted after a day');
  assert.equal(alarm.decidePost(clear, last, NOW + H).post, 'cleared', 'the all-clear after an alarm was not posted');
  assert.equal(alarm.decidePost(clear, { key: 'clear', at: NOW }, NOW + 99 * H).post, null, 'a quiet gap posted');
  assert.equal(alarm.decidePost(clear, null, NOW).post, null, 'a first run with no gap posted');
  assert.equal(alarm.decidePost(unknown, null, NOW).post, 'unknown', 'could-not-tell was silent');
  assert.equal(alarm.decidePost(unknown, { key: 'unknown', at: NOW }, NOW + H).post, null, 'could-not-tell repeated inside a day');
  assert.equal(alarm.decidePost(unknown, { key: 'unknown', at: NOW }, NOW + 24 * H).post, 'unknown', 'a standing could-not-tell was not repeated after a day');
});

test('the all-clear says "measurable again" after a could-not-tell spell, not "back under"', () => {
  const v = { alarm: false, reasons: [], main: { ahead: 1, hours: 1 }, staging: { ahead: 0, hours: 0 }, stagingVersion: 'b', prodVersion: 'a' };
  assert.match(alarm.message('cleared', Object.assign({ after: 'unknown' }, v)), /measurable again, and under the limits/);
  assert.match(alarm.message('cleared', Object.assign({ after: 'alarm:main-hours' }, v)), /back under the limits/);
});

/* A throwaway repo: commits at chosen committer times, with origin/main at the last one. */
function repoWith(commits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-'));
  const g = (args, extra = {}) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: Object.assign({}, process.env, extra) }).trim();
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@example.com']); g(['config', 'user.name', 't']); g(['config', 'commit.gpgsign', 'false']);
  const shas = {};
  for (const [name, at] of commits) {
    fs.writeFileSync(path.join(dir, 'f'), name);
    g(['add', 'f']);
    const date = '@' + at + ' +0000';
    g(['commit', '-q', '-m', name], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    shas[name] = g(['rev-parse', 'HEAD']);
  }
  g(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return { dir, shas, g };
}

function run(args, extra) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, { GAP_ALARM_NO_FETCH: '1', GAP_ALARM_NOW: String(NOW) }, extra),
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/* Stubs that log their arguments, $TMUX and stdin; `fail` makes one exit 3 with a message. */
function stubs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-stub-'));
  const mk = (name, fail) => {
    const log = path.join(dir, name + '.log');
    const bin = path.join(dir, name);
    fs.writeFileSync(bin, '#!/bin/sh\n{ printf "%s\\n" "$*"; printf "TMUX=%s\\n" "$TMUX"; cat 2>/dev/null; printf "\\n--\\n"; } >> "' + log + '"\n'
      + (fail === 8 ? 'exit 8\n' : fail === 7 ? 'exit 7\n' : fail ? 'echo "claude-msg: no tmux here" >&2\nexit 3\n' : ''), { mode: 0o755 });
    return { bin, read: () => { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } } };
  };
  return { msg: mk('msg'), failMsg: mk('failmsg', true), busyMsg: mk('busymsg', 8), unpaintedMsg: mk('unpaintedmsg', 7), gh: mk('gh'), failGh: mk('failgh', true), state: path.join(dir, 'state.json') };
}

const ptrs = (prodSha, stagingSha, builtAt, pv = '0.6.99', sv = '0.7.05') => JSON.stringify({
  prod: { version: pv, sha: prodSha, builtAt: NOW - 200 * H }, staging: { version: sv, sha: stagingSha, builtAt },
});

test('end to end: an alarm reaches both channels once, repeats after a day, and clears once', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 60 * H], ['m1', NOW - 30 * H], ['m2', NOW - H]]);
  const s = stubs();
  const base = {
    KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: s.msg.bin, GAP_ALARM_GH_CMD: s.gh.bin, GAP_ALARM_TO: 'test-pane:0.0',
    GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - 50 * H), TMUX: '',
  };
  const check = run(['--check'], base);
  assert.equal(check.code, 1, check.err);
  const v = JSON.parse(check.out);
  assert.deepEqual(v.reasons, ['main-hours', 'staging-hours']);
  assert.deepEqual(v.main, { ahead: 2, hours: 30 }, 'the oldest commit waiting for a cut sets main\'s hours');
  assert.deepEqual(v.staging, { ahead: 1, hours: 50 }, 'the staging build\'s cut time sets staging\'s hours, not its oldest commit');
  assert.equal(s.msg.read(), '', '--check posted');

  assert.equal(run([], base).code, 1);
  assert.match(s.msg.read(), /^test-pane:0\.0 -/m, 'the release owner pane was not the target');
  assert.match(s.msg.read(), /^TMUX=\/.+\/tmux-\d+\/default,0,0$/m, 'claude-msg was given no $TMUX, which it refuses without (launchd has none)');
  assert.match(s.msg.read(), /main is 2 commits past staging 0\.7\.05 \(oldest waiting 30 h\); staging 0\.7\.05 is 1 commits past prod 0\.6\.99 \(cut 50 h ago\)/);
  assert.match(s.gh.read(), /issue comment 1050 --repo joshualeestone\/kosmos --body gap alarm \(kosmos#1050\): main-hours, staging-hours/);

  const once = s.msg.read();
  run([], Object.assign({}, base, { GAP_ALARM_NOW: String(NOW + H) }));
  assert.equal(s.msg.read(), once, 'the same alarm was posted again inside a day');
  run([], Object.assign({}, base, { GAP_ALARM_NOW: String(NOW + 25 * H) }));
  assert.ok(s.msg.read().length > once.length, 'a standing alarm was not repeated after a day');

  // Staging catches up with main and prod with staging: the all-clear, once.
  const caught = Object.assign({}, base, { GAP_ALARM_NOW: String(NOW + 26 * H), GAP_ALARM_POINTERS: ptrs(shas.m2, shas.m2, NOW, '0.7.07', '0.7.07') });
  const before = s.gh.read();
  assert.equal(run([], caught).code, 0);
  assert.match(s.gh.read().slice(before.length), /back under the limits/);
  const after = s.gh.read();
  run([], Object.assign({}, caught, { GAP_ALARM_NOW: String(NOW + 50 * H) }));
  assert.equal(s.gh.read(), after, 'the all-clear was repeated');
});

test('a pane message that does not go is said on the card; a post that goes nowhere does not count as told', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 90 * H]]);
  const s = stubs();
  const base = { KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - 90 * H), GAP_ALARM_TO: 'test-pane:0.0' };
  // The pane fails, the card does not: the card says the pane did not get it.
  assert.equal(run([], Object.assign({}, base, { GAP_ALARM_MSG_CMD: s.failMsg.bin, GAP_ALARM_GH_CMD: s.gh.bin })).code, 1);
  assert.match(s.gh.read(), /\(The pane message to test-pane:0\.0 did not go: claude-msg: no tmux here\)/, 'a failed pane message was not said on the card');
  // Both fail: nothing went, so no channel's clock advances (the failure is recorded for the backoff).
  const s2 = stubs();
  const base2 = Object.assign({}, base, { GAP_ALARM_STATE: s2.state });
  assert.equal(run([], Object.assign({}, base2, { GAP_ALARM_MSG_CMD: '/nonexistent/claude-msg', GAP_ALARM_GH_CMD: '/nonexistent/gh' })).code, 1);
  const failed = JSON.parse(fs.readFileSync(s2.state, 'utf8'));
  for (const ch of ['pane', 'card']) {
    assert.equal(failed[ch].key, undefined, 'a failed post advanced the ' + ch + ' clock');
    assert.equal(failed[ch].failedKey, 'alarm:staging-hours');
  }
  // An hour later the same message is NOT retried (a failure can have landed; review 5)...
  run([], Object.assign({}, base2, { GAP_ALARM_MSG_CMD: s2.msg.bin, GAP_ALARM_GH_CMD: '/nonexistent/gh', GAP_ALARM_NOW: String(NOW + H) }));
  assert.equal(s2.msg.read(), '', 'a failed post was retried within the backoff');
  // ...and three hours later it is.
  run([], Object.assign({}, base2, { GAP_ALARM_MSG_CMD: s2.msg.bin, GAP_ALARM_GH_CMD: '/nonexistent/gh', GAP_ALARM_NOW: String(NOW + 3 * H) }));
  assert.match(s2.msg.read(), /staging-hours/, 'the retry after a failed post did not go');
});

test('could not tell: a build not in the checkout exits 2 and says so, and is not a pass', () => {
  const { dir } = repoWith([['a', NOW - H]]);
  const s = stubs();
  const r = run([], {
    KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: s.msg.bin, GAP_ALARM_GH_CMD: s.gh.bin,
    GAP_ALARM_POINTERS: ptrs('deadbeefdeadbeef', 'deadbeefdeadbeef', NOW),
  });
  assert.equal(r.code, 2);
  assert.match(s.msg.read(), /could not tell \(the prod build deadbeef is not in .*\)\. This is not a pass/);
});

test('main\'s hours run from when work LANDED on main: a merge commit\'s older side-branch commits do not alarm', () => {
  const { dir, shas, g } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 50 * H]]);
  // A side branch with commits 40 h old, merged into main an hour ago with a merge commit.
  g(['checkout', '-q', '-b', 'side']);
  for (const [name, at] of [['s1', NOW - 40 * H], ['s2', NOW - 39 * H]]) {
    fs.writeFileSync(path.join(dir, name), name); g(['add', name]);
    g(['commit', '-q', '-m', name], { GIT_AUTHOR_DATE: '@' + at + ' +0000', GIT_COMMITTER_DATE: '@' + at + ' +0000' });
  }
  g(['checkout', '-q', 'main']);
  g(['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], { GIT_AUTHOR_DATE: '@' + (NOW - H) + ' +0000', GIT_COMMITTER_DATE: '@' + (NOW - H) + ' +0000' });
  g(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const v = JSON.parse(run(['--check'], { KOSMOS_REPO_DIR: dir, GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - H) }).out);
  assert.equal(v.main.ahead, 3, 'fixture: the count is every commit, as shipped-gap.sh counts');
  assert.equal(v.main.hours, 1, 'main\'s waiting time must run from the merge landing, not a side-branch commit');
  assert.ok(!v.reasons.includes('main-hours'), 'a merge that landed an hour ago alarmed on its side branch\'s age: ' + JSON.stringify(v));
});

test('claude-msg exit 8 (#1909) is told-but-uncertain: it counts as posted and the card says "may not have gone", never "did not go"', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 90 * H]]);
  const s = stubs();
  const env = { KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: s.busyMsg.bin, GAP_ALARM_GH_CMD: s.failGh.bin,
    GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - 60 * H) };
  const r = run([], env);
  assert.match(r.err, /may not have gone: claude-msg exit 8/);
  assert.doesNotMatch(r.err, /pane message .* did not go/);
  assert.match(r.err, /the #1050 comment did not go: claude-msg: no tmux here/, 'gh\'s own stderr line is what the log says');
  // Counted as told FOR THE PANE: the next hour does not message the pane again...
  const before = s.busyMsg.read();
  const ghBefore = s.failGh.read();
  run([], Object.assign({}, env, { GAP_ALARM_NOW: String(NOW + H) }));
  assert.equal(s.busyMsg.read(), before, 'an exit-8 post was treated as not told and repeated an hour later');
  // ...but the card keeps its own clock: its failed comment is retried once its backoff has passed
  // (review 4, per-channel clocks; review 5, the 3 h backoff).
  run([], Object.assign({}, env, { GAP_ALARM_NOW: String(NOW + 3 * H) }));
  assert.equal(s.busyMsg.read(), before, 'the told pane was messaged again');
  assert.ok(s.failGh.read().length > ghBefore.length, 'the pane\'s exit 8 suppressed the retry of a card comment that really failed');
  // With a working gh, the card carries the uncertainty.
  const s2 = stubs();
  run([], Object.assign({}, env, { GAP_ALARM_STATE: s2.state, GAP_ALARM_GH_CMD: s2.gh.bin }));
  assert.match(s2.gh.read(), /may not have gone: claude-msg exit 8/);
  // Exit 7 (delivered, pane did not repaint) is the same class (review 5).
  const s3 = stubs();
  const r7 = run([], Object.assign({}, env, { GAP_ALARM_STATE: s3.state, GAP_ALARM_MSG_CMD: s3.unpaintedMsg.bin, GAP_ALARM_GH_CMD: s3.gh.bin }));
  assert.match(r7.err, /may not have gone: claude-msg exit 7/);
  assert.match(s3.gh.read(), /may not have gone: claude-msg exit 7/);
  assert.equal(JSON.parse(fs.readFileSync(s3.state, 'utf8')).pane.key, 'alarm:staging-hours', 'exit 7 did not count as told for the pane');
});

test('a state file from before per-channel clocks is read as both channels: no repost on the first run after an upgrade', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 90 * H]]);
  const s = stubs();
  fs.writeFileSync(s.state, JSON.stringify({ key: 'alarm:staging-hours', at: NOW - H }) + '\n');
  const env = { KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: s.msg.bin, GAP_ALARM_GH_CMD: s.gh.bin,
    GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - 60 * H) };
  assert.equal(run([], env).code, 1, 'fixture: the alarm is standing');
  assert.equal(s.msg.read() + s.gh.read(), '', 'an old-format state was not honoured and the standing alarm reposted');
  // A day later both channels repost, and the file is now per channel.
  run([], Object.assign({}, env, { GAP_ALARM_NOW: String(NOW + 24 * H) }));
  assert.match(s.msg.read(), /staging-hours/); assert.match(s.gh.read(), /staging-hours/);
  const st = JSON.parse(fs.readFileSync(s.state, 'utf8'));
  assert.deepEqual(Object.keys(st).sort(), ['card', 'lastRunAt', 'pane']);
});

test('a state that cannot be recorded is said, is not fatal, and leaves no temp file behind', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 90 * H]]);
  const s = stubs();
  // The state path is an existing non-empty directory, so the rename onto it fails.
  const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-norecord-'));
  const statePathDir = path.join(holder, 'state.json');
  fs.mkdirSync(statePathDir); fs.writeFileSync(path.join(statePathDir, 'x'), 'x');
  const r = run([], { KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: statePathDir, GAP_ALARM_MSG_CMD: s.busyMsg.bin, GAP_ALARM_GH_CMD: s.gh.bin,
    GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - 60 * H) });
  assert.equal(r.code, 1, 'an unrecordable state crashed the run: ' + r.err);
  assert.match(r.err, /posted, but could not record it/);
  assert.match(s.gh.read(), /staging-hours/, 'fixture: the card post went');
  assert.deepEqual(fs.readdirSync(holder).filter((f) => f.endsWith('.tmp')), [], 'a failed rename left its temp file behind');
  assert.match(r.out, /posted to pane \(unconfirmed\) and card: /, 'the log line hides that the pane post is unconfirmed');
});

test('review 7: a clear gap proves life on the card once a week (never the pane); a run records lastRunAt; no cut time is claimed with nothing in staging', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H]]);
  const s = stubs();
  // staging == prod, nothing waiting on main: clear.
  const env = { KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: s.msg.bin, GAP_ALARM_GH_CMD: s.gh.bin,
    GAP_ALARM_POINTERS: ptrs(shas.prod, shas.prod, NOW - 100 * H) };
  assert.equal(run([], env).code, 0);
  assert.equal(s.msg.read() + s.gh.read(), '', 'a first clear run posted');
  assert.equal(JSON.parse(fs.readFileSync(s.state, 'utf8')).lastRunAt, NOW);
  run([], Object.assign({}, env, { GAP_ALARM_NOW: String(NOW + 6 * 24 * H) }));
  assert.equal(s.gh.read(), '', 'proof of life came before a week');
  run([], Object.assign({}, env, { GAP_ALARM_NOW: String(NOW + 7 * 24 * H) }));
  assert.match(s.gh.read(), /still watching, and under the limits\. main is 0 commits past staging 0\.7\.05 \(oldest waiting 0 h\); staging 0\.7\.05 is 0 commits past prod 0\.6\.99\.\n/,
    'no weekly proof of life on the card, or it claimed a cut time with nothing in staging');
  assert.equal(s.msg.read(), '', 'proof of life went to the pane');
  const after = s.gh.read();
  run([], Object.assign({}, env, { GAP_ALARM_NOW: String(NOW + 7 * 24 * H + H) }));
  assert.equal(s.gh.read(), after, 'proof of life repeated within the week');
});

test('review 7: an all-clear never follows an alarm this channel failed to announce', () => {
  assert.deepEqual(alarm.decidePost({ alarm: false, reasons: [] }, { failedKey: 'alarm:main-hours', failedAt: NOW - H }, NOW), { post: null, key: 'clear' });
  assert.deepEqual(alarm.decidePost({ alarm: false, reasons: [] }, { key: 'alarm:main-hours', at: NOW - H }, NOW), { post: 'cleared', key: 'clear' }, 'CONTROL');
});

test('a git failure is could-not-tell with GIT\'s own first stderr line, not the command line', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 50 * H]]);
  // A git on PATH whose fetch fails with multi-line stderr, and is the real git otherwise.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-gitfail-'));
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\n[ "$5" = fetch ] && { printf "fatal: could not read Username for https://github.com: terminal prompts disabled\\nsecond line\\n" >&2; exit 128; }\nexec "' + REAL_GIT + '" "$@"\n', { mode: 0o755 });
  const r = run(['--check'], { KOSMOS_REPO_DIR: dir, GAP_ALARM_NO_FETCH: '', PATH: bin + ':' + process.env.PATH,
    GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - H) });
  assert.equal(r.code, 2, r.out + r.err);
  assert.equal(JSON.parse(r.out).why, 'git fetch: fatal: could not read Username for https://github.com: terminal prompts disabled');
});

test('a fetch that hangs is could-not-tell with the reason, not a run that never ends', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 50 * H]]);
  // A git on PATH that hangs on fetch and is the real git for everything else.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-hang-'));
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\n# git -c gc.auto=0 -C <repo> fetch ...: the subcommand is the 5th argument\n[ "$5" = fetch ] && exec sleep 30\nexec "' + REAL_GIT + '" "$@"\n', { mode: 0o755 });
  const started = Date.now();
  const r = run(['--check'], {
    KOSMOS_REPO_DIR: dir, GAP_ALARM_NO_FETCH: '', GAP_ALARM_GIT_TIMEOUT_MS: '1500',
    PATH: bin + ':' + process.env.PATH, GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - H),
  });
  assert.ok(Date.now() - started < 20000, 'the run waited out the hung fetch instead of bounding it');
  assert.equal(r.code, 2, 'a hung fetch must exit 2 (could not tell): ' + r.out + r.err);
  assert.match(JSON.parse(r.out).why, /git fetch did not finish in \d+s/);
});

test('each run fetches origin main, so a moved origin is counted, not a stale local ref', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 50 * H]]);
  // A bare "origin" that has one more commit on main than the checkout has seen.
  const origin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-origin-')), 'o.git');
  execFileSync('git', ['clone', '-q', '--bare', dir, origin]);
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-other-')), 'c');
  execFileSync('git', ['clone', '-q', origin, other]);
  fs.writeFileSync(path.join(other, 'g'), 'new');
  execFileSync('git', ['-C', other, 'add', 'g']);
  execFileSync('git', ['-C', other, '-c', 'user.email=t@e', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'moved']);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:main']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', origin]);
  const env = { KOSMOS_REPO_DIR: dir, GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - H) };
  const stale = JSON.parse(run(['--check'], env).out);
  assert.equal(stale.main.ahead, 0, 'fixture: without a fetch the checkout sees nothing past staging');
  const fresh = JSON.parse(run(['--check'], Object.assign({}, env, { GAP_ALARM_NO_FETCH: '' })).out);
  assert.equal(fresh.main.ahead, 1, 'the run did not fetch: the moved origin was not counted');
});

test('the pointers are read from the served files: app.commit and built.at, and a missing field is could-not-tell for that reason', async () => {
  const { dir, shas } = repoWith([['prod', NOW - 10 * H], ['staging', NOW - 5 * H]]);
  const built = (at) => ({ at: new Date(at * 1000).toISOString() });
  const files = {
    '/latest.json': { version: '0.6.99', manifest: 'kosmos-0.6.99-arm64.manifest.json' },
    '/latest-staging.json': { version: '0.7.05', manifest: 'kosmos-0.7.05-arm64.manifest.json' },
    '/kosmos-0.6.99-arm64.manifest.json': { app: { commit: shas.prod }, built: built(NOW - 10 * H) },
    '/kosmos-0.7.05-arm64.manifest.json': { app: { commit: shas.staging }, built: built(NOW - 3 * H) },
  };
  const server = http.createServer((req, res) => {
    const body = files[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(body ? JSON.stringify(body) : '{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  // Asynchronously: this process serves the files, so a spawnSync would block the server and the
  // child would time out, which reads as could-not-tell for the wrong reason.
  const check = () => new Promise((resolve) => {
    const c = spawn(process.execPath, [SCRIPT, '--check'], { env: Object.assign({}, process.env, {
      GAP_ALARM_NO_FETCH: '1', GAP_ALARM_NOW: String(NOW), KOSMOS_REPO_DIR: dir,
      KOSMOS_DIST_BASE: 'http://127.0.0.1:' + server.address().port,
    }) });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(JSON.parse(out)));
  });
  try {
    const v = await check();
    assert.equal(v.unknown, undefined, 'the served pointers could not be read: ' + JSON.stringify(v));
    assert.equal(v.prodVersion, '0.6.99');
    assert.equal(v.stagingVersion, '0.7.05');
    assert.deepEqual(v.staging, { ahead: 1, hours: 3 }, 'staging\'s hours are not from its manifest\'s built.at');
    files['/kosmos-0.7.05-arm64.manifest.json'] = { app: {}, built: built(NOW) };
    const noCommit = await check();
    assert.equal(noCommit.unknown, true);
    assert.match(noCommit.why, /the 0\.7\.05 manifest has no app\.commit/, 'could-not-tell for another reason than the missing commit');
    files['/kosmos-0.7.05-arm64.manifest.json'] = { app: { commit: shas.staging } };
    const noBuilt = await check();
    assert.match(noBuilt.why, /the 0\.7\.05 manifest has no built\.at/);
  } finally { server.close(); }
});

test('under the test runner with no seams, the real claude-msg and gh are never called', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 90 * H]]);
  // Stubs where the DEFAULTS resolve (HOME/.claude/scripts/claude-msg, and gh on PATH), and a PATH
  // with no real gh on it at all, so not even the control can reach the real card. So a guard
  // that let the defaults through would be seen calling them, not merely failing.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-home-'));
  const called = path.join(home, 'called.log');
  const stub = '#!/bin/sh\necho "$0 $*" >> "' + called + '"\n';
  fs.mkdirSync(path.join(home, '.claude', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'scripts', 'claude-msg'), stub, { mode: 0o755 });
  fs.mkdirSync(path.join(home, 'bin'));
  fs.writeFileSync(path.join(home, 'bin', 'gh'), stub, { mode: 0o755 });
  // Only the real git joins it: the macOS /usr/bin/git shim is ~30 s with a fresh HOME, and adding
  // git's own directory to PATH would put the real gh (Homebrew keeps both) in reach.
  fs.symlinkSync(REAL_GIT, path.join(home, 'bin', 'git'));
  const state = path.join(home, 'state.json');
  const envFor = (extra) => Object.assign({ HOME: home, PATH: path.join(home, 'bin') + ':/usr/bin:/bin', KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: state,
    GAP_ALARM_MSG_CMD: '', GAP_ALARM_GH_CMD: '', GAP_ALARM_POINTERS: ptrs(shas.prod, shas.staging, NOW - 90 * H) }, extra);
  const r = run([], envFor({ NODE_TEST_CONTEXT: 'child-v8' }));
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(called), false, 'the real channels were called under the test runner: ' + (fs.existsSync(called) ? fs.readFileSync(called, 'utf8') : ''));
  // Every run records lastRunAt (review 7), but with nothing posted no channel has a clock.
  const st = JSON.parse(fs.readFileSync(state, 'utf8'));
  assert.equal(st.pane, null, 'the pane clock advanced with nothing posted');
  assert.equal(st.card, null, 'the card clock advanced with nothing posted');
  assert.equal(st.lastRunAt, NOW);
  // Control: the same run OUTSIDE the test runner does reach the default channels.
  const outside = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
  const r2 = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: Object.assign(outside, { GAP_ALARM_NO_FETCH: '1', GAP_ALARM_NOW: String(NOW) }, envFor({})) });
  assert.equal(r2.status, 1, r2.stderr);
  assert.match(fs.readFileSync(called, 'utf8'), /claude-msg/, 'control: the default pane channel was not reached outside the test runner');
});

/* A copy of the script in a throwaway repo, as a main checkout and as a linked worktree of it. */
function installCopies() {
  const { dir, g } = repoWith([['a', NOW]]);
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'tools', 'gap-alarm.js'));
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-wt-')), 'wt');
  g(['add', 'tools']); g(['commit', '-q', '-m', 'tools']);
  g(['worktree', 'add', '-q', wt]);
  return { main: path.join(dir, 'tools', 'gap-alarm.js'), worktree: path.join(wt, 'tools', 'gap-alarm.js') };
}

test('the LaunchAgent: hourly, a stable node path, escaped; installs from the main checkout into a sandbox, and refuses a linked worktree', () => {
  const p = alarm.plist({ node: '/opt/node & co/bin/node', script: '/x/tools/gap-alarm.js', home: '/Users/somebody' });
  assert.match(p, /<key>Label<\/key><string>com\.kosmos\.gap-alarm<\/string>/);
  assert.match(p, /<string>\/opt\/node &amp; co\/bin\/node<\/string><string>\/x\/tools\/gap-alarm\.js<\/string>/, 'the node path was not escaped');
  assert.match(p, /<key>StartInterval<\/key><integer>3600<\/integer>/);
  assert.match(p, /\/Users\/somebody\/Library\/Logs\/kosmos\/gap-alarm\.log/);
  assert.doesNotMatch(alarm.plist(), /\/Cellar\//, 'the default node path is a Cellar path, which an upgrade deletes');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-plist-'));
  if (process.platform === 'darwin') {
    fs.writeFileSync(path.join(tmp, 'p.plist'), p);
    execFileSync('plutil', ['-lint', path.join(tmp, 'p.plist')], { stdio: 'ignore' });   // throws if not a valid plist
  }
  const copies = installCopies();
  const launch = path.join(tmp, 'LaunchAgents');
  const ok = spawnSync(process.execPath, [copies.main, '--install'], { encoding: 'utf8', env: Object.assign({}, process.env, { AGENT_WORKFORCE_LAUNCH: launch }) });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(launch, 'com.kosmos.gap-alarm.plist')), 'the sandbox install wrote nothing');
  const launch2 = path.join(tmp, 'LaunchAgents2');
  const refused = spawnSync(process.execPath, [copies.worktree, '--install'], { encoding: 'utf8', env: Object.assign({}, process.env, { AGENT_WORKFORCE_LAUNCH: launch2 }) });
  assert.notEqual(refused.status, 0, 'an install from a linked worktree was not refused');
  assert.match(refused.stderr, /refusing to install from a linked worktree/);
  assert.equal(fs.existsSync(launch2), false, 'the refused install wrote a plist');
});

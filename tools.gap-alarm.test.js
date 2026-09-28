'use strict';

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
const { execFileSync, spawnSync } = require('node:child_process');
const alarm = require('./tools/gap-alarm');

const SCRIPT = path.join(__dirname, 'tools', 'gap-alarm.js');
const H = 3600;
const NOW = 1_800_000_000;

test('verdict: each limit on its own side, and nothing waiting is never an alarm', () => {
  const v = (main, staging) => alarm.verdict({ main, staging, now: NOW });
  assert.deepEqual(v({ ahead: 50, oldestAt: NOW - 23 * H }, { ahead: 3, oldestAt: NOW - 47 * H }).reasons, [], 'at the limits is not past them');
  assert.deepEqual(v({ ahead: 51, oldestAt: NOW - H }, { ahead: 0, oldestAt: null }).reasons, ['main-commits']);
  assert.deepEqual(v({ ahead: 2, oldestAt: NOW - 25 * H }, { ahead: 0, oldestAt: null }).reasons, ['main-hours']);
  assert.deepEqual(v({ ahead: 0, oldestAt: null }, { ahead: 1, oldestAt: NOW - 49 * H }).reasons, ['staging-hours']);
  assert.deepEqual(v({ ahead: 0, oldestAt: NOW - 999 * H }, { ahead: 0, oldestAt: NOW - 999 * H }).reasons, [], 'an old stamp with nothing waiting is not a gap');
  const all = v({ ahead: 60, oldestAt: NOW - 30 * H }, { ahead: 9, oldestAt: NOW - 50 * H });
  assert.deepEqual(all.reasons, ['main-commits', 'main-hours', 'staging-hours']);
  assert.equal(all.alarm, true);
  assert.deepEqual(all.main, { ahead: 60, hours: 30 });
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
});

/* A throwaway repo: prod, then staging, then main, each commit at a chosen committer time. */
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
  return { dir, shas };
}

function run(args, extra) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', timeout: 30000,
    env: Object.assign({}, process.env, { GAP_ALARM_NO_FETCH: '1', GAP_ALARM_NOW: String(NOW) }, extra),
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function stubs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-stub-'));
  const mk = (name) => {
    const log = path.join(dir, name + '.log');
    const bin = path.join(dir, name);
    fs.writeFileSync(bin, '#!/bin/sh\n{ printf "%s\\n" "$*"; cat 2>/dev/null; printf "\\n--\\n"; } >> "' + log + '"\n', { mode: 0o755 });
    return { bin, read: () => { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } } };
  };
  return { msg: mk('msg'), gh: mk('gh'), state: path.join(dir, 'state.json') };
}

test('end to end: an alarm reaches both channels once, repeats after a day, and clears once', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 60 * H], ['m1', NOW - 30 * H], ['m2', NOW - H]]);
  const s = stubs();
  const base = {
    KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: s.msg.bin, GAP_ALARM_GH_CMD: s.gh.bin, GAP_ALARM_TO: 'test-pane:0.0',
    GAP_ALARM_POINTERS: JSON.stringify({ prod: { version: '0.6.99', sha: shas.prod }, staging: { version: '0.7.05', sha: shas.staging } }),
  };
  const check = run(['--check'], base);
  assert.equal(check.code, 1, check.err);
  const v = JSON.parse(check.out);
  assert.deepEqual(v.reasons, ['main-hours', 'staging-hours']);
  assert.deepEqual(v.main, { ahead: 2, hours: 30 }, 'the oldest waiting commit sets the hours');
  assert.deepEqual(v.staging, { ahead: 1, hours: 60 });
  assert.equal(s.msg.read(), '', '--check posted');

  assert.equal(run([], base).code, 1);
  assert.match(s.msg.read(), /^test-pane:0\.0 -/m, 'the release owner pane was not the target');
  assert.match(s.msg.read(), /main is 2 commits past staging 0\.7\.05 \(oldest waiting 30 h\); staging 0\.7\.05 is 1 commits past prod 0\.6\.99 \(oldest waiting 60 h\)/);
  assert.match(s.gh.read(), /issue comment 1050 --repo joshualeestone\/kosmos --body gap alarm \(kosmos#1050\): main-hours, staging-hours/);

  const once = s.msg.read();
  run([], Object.assign({}, base, { GAP_ALARM_NOW: String(NOW + H) }));
  assert.equal(s.msg.read(), once, 'the same alarm was posted again inside a day');
  run([], Object.assign({}, base, { GAP_ALARM_NOW: String(NOW + 25 * H) }));
  assert.ok(s.msg.read().length > once.length, 'a standing alarm was not repeated after a day');

  // Staging catches up with main and prod with staging: the all-clear, once.
  const caught = Object.assign({}, base, { GAP_ALARM_NOW: String(NOW + 26 * H), GAP_ALARM_POINTERS: JSON.stringify({ prod: { version: '0.7.07', sha: shas.m2 }, staging: { version: '0.7.07', sha: shas.m2 } }) });
  const before = s.gh.read();
  assert.equal(run([], caught).code, 0);
  assert.match(s.gh.read().slice(before.length), /back under the limits/);
  const after = s.gh.read();
  run([], Object.assign({}, caught, { GAP_ALARM_NOW: String(NOW + 50 * H) }));
  assert.equal(s.gh.read(), after, 'the all-clear was repeated');
});

test('a post that goes nowhere does not count as told: the next run tries again', () => {
  const { dir, shas } = repoWith([['prod', NOW - 100 * H], ['staging', NOW - 90 * H]]);
  const s = stubs();
  const base = {
    KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: '/nonexistent/claude-msg', GAP_ALARM_GH_CMD: '/nonexistent/gh',
    GAP_ALARM_POINTERS: JSON.stringify({ prod: { version: '0.6.99', sha: shas.prod }, staging: { version: '0.7.05', sha: shas.staging } }),
  };
  assert.equal(run([], base).code, 1);
  assert.equal(fs.existsSync(s.state), false, 'a failed post advanced the clock');
  assert.equal(run([], Object.assign({}, base, { GAP_ALARM_MSG_CMD: s.msg.bin })).code, 1);
  assert.match(s.msg.read(), /staging-hours/, 'the retry after a failed post did not go');
});

test('could not tell: a build not in the checkout exits 2 and says so, and is not a pass', () => {
  const { dir } = repoWith([['a', NOW - H]]);
  const s = stubs();
  const r = run([], {
    KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: s.state, GAP_ALARM_MSG_CMD: s.msg.bin, GAP_ALARM_GH_CMD: s.gh.bin,
    GAP_ALARM_POINTERS: JSON.stringify({ prod: { version: '0.6.99', sha: 'deadbeefdeadbeef' }, staging: { version: '0.7.05', sha: 'deadbeefdeadbeef' } }),
  });
  assert.equal(r.code, 2);
  assert.match(s.msg.read(), /could not tell \(the prod build deadbeef is not in .*\)\. This is not a pass/);
});

test('the pointers are read from the served files and their manifests app.commit', async () => {
  const { dir, shas } = repoWith([['prod', NOW - 10 * H], ['staging', NOW - 5 * H]]);
  const files = {
    '/latest.json': { version: '0.6.99', manifest: 'kosmos-0.6.99-arm64.manifest.json' },
    '/latest-staging.json': { version: '0.7.05', manifest: 'kosmos-0.7.05-arm64.manifest.json' },
    '/kosmos-0.6.99-arm64.manifest.json': { app: { commit: shas.prod } },
    '/kosmos-0.7.05-arm64.manifest.json': { app: { commit: shas.staging } },
  };
  const server = http.createServer((req, res) => {
    const body = files[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(body ? JSON.stringify(body) : '{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    // Asynchronously: this process serves the files, so a spawnSync would block the server and the
    // child would time out, which reads as could-not-tell for the wrong reason.
    const check = () => new Promise((resolve) => {
      const c = require('node:child_process').spawn(process.execPath, [SCRIPT, '--check'], { env: Object.assign({}, process.env, {
        GAP_ALARM_NO_FETCH: '1', GAP_ALARM_NOW: String(NOW), KOSMOS_REPO_DIR: dir,
        KOSMOS_DIST_BASE: 'http://127.0.0.1:' + server.address().port,
      }) });
      let out = ''; c.stdout.on('data', (d) => { out += d; });
      c.on('close', (code) => resolve({ code, out }));
    });
    const r = await check();
    const v = JSON.parse(r.out);
    assert.equal(v.unknown, undefined, 'the served pointers could not be read: ' + r.out);
    assert.equal(v.prodVersion, '0.6.99');
    assert.equal(v.stagingVersion, '0.7.05');
    assert.deepEqual(v.staging, { ahead: 1, hours: 5 });
    // Control: a manifest without app.commit is could-not-tell, not a guess.
    files['/kosmos-0.7.05-arm64.manifest.json'] = { app: {} };
    const bad = JSON.parse((await check()).out);
    assert.equal(bad.unknown, true);
    assert.match(bad.why, /the 0\.7\.05 manifest has no app\.commit/, 'could-not-tell for another reason than the missing commit');
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
  fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), path.join(home, 'bin', 'git'));
  const state = path.join(home, 'state.json');
  const r = run([], {
    HOME: home, PATH: path.join(home, 'bin') + ':/usr/bin:/bin',
    KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: state, NODE_TEST_CONTEXT: 'child-v8', GAP_ALARM_MSG_CMD: '', GAP_ALARM_GH_CMD: '',
    GAP_ALARM_POINTERS: JSON.stringify({ prod: { version: '0.6.99', sha: shas.prod }, staging: { version: '0.7.05', sha: shas.staging } }),
  });
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(called), false, 'the real channels were called under the test runner: ' + (fs.existsSync(called) ? fs.readFileSync(called, 'utf8') : ''));
  assert.equal(fs.existsSync(state), false, 'the clock advanced with nothing posted');
  // Control: the same run OUTSIDE the test runner does reach the default channels.
  const env2 = { HOME: home, PATH: path.join(home, 'bin') + ':/usr/bin:/bin', KOSMOS_REPO_DIR: dir, GAP_ALARM_STATE: state,
    GAP_ALARM_MSG_CMD: '', GAP_ALARM_GH_CMD: '', GAP_ALARM_POINTERS: JSON.stringify({ prod: { version: '0.6.99', sha: shas.prod }, staging: { version: '0.7.05', sha: shas.staging } }) };
  const r2 = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: Object.assign({}, Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), { GAP_ALARM_NO_FETCH: '1', GAP_ALARM_NOW: String(NOW) }, env2) });
  assert.equal(r2.status, 1, r2.stderr);
  assert.match(fs.readFileSync(called, 'utf8'), /claude-msg/, 'control: the default pane channel was not reached outside the test runner');
});

test('the LaunchAgent: hourly, an explicit node path, escaped, and it installs into a sandbox without loading', () => {
  const p = alarm.plist({ node: '/opt/node & co/bin/node', script: '/x/tools/gap-alarm.js', home: '/Users/somebody' });
  assert.match(p, /<key>Label<\/key><string>com\.kosmos\.gap-alarm<\/string>/);
  assert.match(p, /<string>\/opt\/node &amp; co\/bin\/node<\/string><string>\/x\/tools\/gap-alarm\.js<\/string>/, 'the node path was not escaped');
  assert.match(p, /<key>StartInterval<\/key><integer>3600<\/integer>/);
  assert.match(p, /\/Users\/somebody\/Library\/Logs\/kosmos\/gap-alarm\.log/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gapalarm-plist-'));
  if (process.platform === 'darwin') {
    fs.writeFileSync(path.join(tmp, 'p.plist'), p);
    execFileSync('plutil', ['-lint', path.join(tmp, 'p.plist')], { stdio: 'ignore' });   // throws if not a valid plist
  }
  const launch = path.join(tmp, 'LaunchAgents');
  const r = run(['--install'], { AGENT_WORKFORCE_LAUNCH: launch });
  assert.equal(r.code, 0, r.err);
  assert.ok(fs.existsSync(path.join(launch, 'com.kosmos.gap-alarm.plist')), 'the sandbox install wrote nothing');
});

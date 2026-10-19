'use strict';

// Both sandbox knobs BEFORE any require, travelling together per #527
// (accounts resolves HOME at module load, store its root).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-allowance-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const allowance = require('./allowance');
const statusline = require('./kosmos-statusline');
const accounts = require('./accounts');

const SCRIPT = allowance.scriptPath();
const NODE = allowance.stableNode();

let n = 0;
const freshDir = () => fs.mkdtempSync(path.join(SANDBOX, 'acct-' + (n++) + '-'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* The payload shape measured on Claude Code 2.1.283 (2026-09-26), trimmed to
   what matters plus neighbours, so the script is exercised on the real shape. */
const payload = (usedPct, resetsAt) => JSON.stringify({
  session_id: 's', model: { display_name: 'Opus' },
  context_window: { total_input_tokens: 63544, used_percentage: 32 },
  rate_limits: { five_hour: { used_percentage: 37, resets_at: resetsAt - 500000 }, seven_day: { used_percentage: usedPct, resets_at: resetsAt } },
});
const FUTURE = Math.floor(Date.now() / 1000) + 3 * 86400;

/* Run the script the way Claude Code does: its command, the payload on stdin. */
function runStatusline(dir, input) {
  return spawnSync(NODE, [SCRIPT, dir], { input, encoding: 'utf8' });
}

test('the script ships where the bundle takes engine files from', () => {
  assert.ok(SCRIPT, 'kosmos-statusline.js is not beside allowance.js');
  assert.match(path.basename(SCRIPT), /\.js$/, 'only engine/*.js ships (build-kosmos-bundle.sh)');
  assert.ok(!/\.test\.js$/.test(SCRIPT));
});

test('a fresh account gets our statusline, with its own dir baked into the command', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  const got = allowance.ensureStatusLine(p);
  assert.deepEqual(got, { wired: true, changed: true });
  const sl = readJson(p).statusLine;
  assert.equal(sl.type, 'command');
  assert.equal(sl.command, allowance.commandFor(NODE, SCRIPT, dir));
  assert.ok(allowance.isOurs(sl));
});

test('merge, never clobber: the rest of settings.json survives, and a second run changes nothing', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ model: 'opus', hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'mine' }] }] } }), { mode: 0o600 });
  allowance.ensureStatusLine(p);
  const data = readJson(p);
  assert.equal(data.model, 'opus');
  assert.equal(data.hooks.Stop[0].hooks[0].command, 'mine');
  assert.equal(fs.statSync(p).mode & 0o777, 0o600, 'the file mode changed');
  const before = fs.readFileSync(p, 'utf8');
  assert.deepEqual(allowance.ensureStatusLine(p), { wired: true, changed: false });
  assert.equal(fs.readFileSync(p, 'utf8'), before);
});

test('somebody else\'s statusline is left exactly as it is, and says why', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  const theirs = { statusLine: { type: 'command', command: 'bash ~/.claude/scripts/statusline.sh' } };
  fs.writeFileSync(p, JSON.stringify(theirs));
  const before = fs.readFileSync(p, 'utf8');
  const got = allowance.ensureStatusLine(p);
  assert.equal(got.wired, false);
  assert.match(got.because, /its own status line/);
  assert.equal(fs.readFileSync(p, 'utf8'), before);
});

test('ours, aimed at another copy, is repointed and keeps the person\'s other fields', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ statusLine: { type: 'command', command: '"/old/node" "/old/app/engine/kosmos-statusline.js" "/old"', padding: 2 } }));
  const got = allowance.ensureStatusLine(p);
  assert.deepEqual(got, { wired: true, changed: true });
  const sl = readJson(p).statusLine;
  assert.equal(sl.command, allowance.commandFor(NODE, SCRIPT, dir));
  assert.equal(sl.padding, 2);
});

test('the refusals: no script, an unsafe path, an ephemeral path into a durable file, a dangling link', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  assert.match(allowance.ensureStatusLine(p, { script: null }).because, /not on this machine/);
  assert.match(allowance.ensureStatusLine(p, { accountDir: '/a"b' }).because, /will not embed/);
  assert.match(allowance.ensureStatusLine(p, { node: '/x/$(boom)/node' }).because, /will not embed/);
  const durable = path.join(path.sep, 'nonexistent-durable-3946', 'settings.json');
  assert.match(allowance.ensureStatusLine(durable, { script: path.join(os.tmpdir(), 'cut', 'kosmos-statusline.js') }).because, /ephemeral/);
  const link = path.join(freshDir(), 'settings.json');
  fs.symlinkSync(path.join(SANDBOX, 'nowhere-3946.json'), link);
  assert.match(allowance.ensureStatusLine(link).because, /link pointing at nothing/);
  const odd = path.join(freshDir(), 'settings.json');
  fs.writeFileSync(odd, JSON.stringify({ statusLine: 'text' }));
  assert.match(allowance.ensureStatusLine(odd).because, /not the shape we expect/);
  const durableSettings = path.join(path.sep, 'nonexistent-durable-3946b', 'settings.json');
  assert.match(allowance.ensureStatusLine(durableSettings, { accountDir: path.join(os.tmpdir(), 'cut', 'acct') }).because, /ephemeral/,
    'an ephemeral account dir was allowed into a durable settings file');
  assert.equal(fs.existsSync(p), false, 'a refusal wrote a file');
});

test('the script records the weekly reading, prints nothing, and exits 0', () => {
  const dir = freshDir();
  const r = runStatusline(dir, payload(42, FUTURE));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'the statusline printed something into the pane');
  const w = allowance.readWeekly(dir);
  assert.equal(w.usedPct, 42);
  assert.equal(w.resetsAt, FUTURE);
  assert.equal(w.history.length, 1);
  assert.equal(w.history[0][1], 42);
});

test('an unchanged reading is not rewritten; a changed one appends to history', () => {
  const dir = freshDir();
  const file = path.join(dir, statusline.FILE);
  runStatusline(dir, payload(42, FUTURE));
  const m1 = fs.readFileSync(file, 'utf8');
  runStatusline(dir, payload(42, FUTURE));
  assert.equal(fs.readFileSync(file, 'utf8'), m1, 'a repaint with the same reading rewrote the file');
  runStatusline(dir, payload(43.5, FUTURE));
  const w = allowance.readWeekly(dir);
  assert.equal(w.usedPct, 43.5);
  assert.deepEqual(w.history.map((h) => h[1]), [42, 43.5]);
});

test('the figure only moves forward: a lagging session cannot step it back, a new week can', () => {
  const dir = freshDir();
  const f = () => allowance.readWeekly(dir);
  runStatusline(dir, payload(43, FUTURE));
  runStatusline(dir, payload(42, FUTURE));
  assert.equal(f().usedPct, 43, 'a lower figure in the same week replaced a higher one');
  runStatusline(dir, payload(42, FUTURE + 30));
  assert.equal(f().usedPct, 43, 'a reset stamp seconds apart read as a new week');
  runStatusline(dir, payload(90, FUTURE - 7 * 86400));
  assert.equal(f().usedPct, 43, 'a reading for an earlier week was recorded');
  assert.deepEqual(f().history.map((h) => h[1]), [43]);
  runStatusline(dir, payload(2, FUTURE + 7 * 86400));
  assert.equal(f().usedPct, 2, 'the next week did not start fresh');
  assert.deepEqual(f().history.map((h) => [h[1], h[2]]), [[43, FUTURE], [2, FUTURE + 7 * 86400]]);
});

test('the node in the command is a path that survives an upgrade', () => {
  const real = fs.realpathSync(process.execPath);
  assert.equal(fs.realpathSync(allowance.stableNode()), real, 'stableNode names a different node binary');
  assert.equal(allowance.stableNode(path.join(SANDBOX, 'no-such-node')), path.join(SANDBOX, 'no-such-node'), 'an unresolvable path should come back unchanged');
  if (/\/Cellar\//.test(real)) assert.doesNotMatch(allowance.stableNode(), /\/Cellar\//, 'a versioned Homebrew path was baked in');
});

test('history is capped', () => {
  const dir = freshDir();
  for (let i = 0; i < statusline.HISTORY_MAX + 5; i++) statusline.record(dir, { usedPct: i, resetsAt: FUTURE }, 1000 + i);
  const w = allowance.readWeekly(dir);
  assert.equal(w.history.length, statusline.HISTORY_MAX);
  assert.equal(w.history[w.history.length - 1][1], statusline.HISTORY_MAX + 4);
});

test('no weekly figure (an API key, before the first request, a wrong shape) writes nothing and never errors', () => {
  const dir = freshDir();
  const cases = [
    JSON.stringify({ session_id: 's' }),
    JSON.stringify({ rate_limits: {} }),
    JSON.stringify({ rate_limits: [] }),
    JSON.stringify({ rate_limits: { seven_day: { used_percentage: '42', resets_at: FUTURE } } }),
    JSON.stringify({ rate_limits: { seven_day: { used_percentage: -1, resets_at: FUTURE } } }),
    JSON.stringify({ rate_limits: { seven_day: { used_percentage: 42 } } }),
    'not json',
    '',
  ];
  for (const input of cases) {
    const r = runStatusline(dir, input);
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '', input);
    assert.equal(r.stderr, '', input);
  }
  assert.equal(fs.existsSync(path.join(dir, statusline.FILE)), false);
  const bad = spawnSync(NODE, [SCRIPT, 'relative/dir'], { input: payload(42, FUTURE), encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stderr, '');
});

test('readWeekly trusts nothing stale or malformed: last week, a missing file, a broken one', () => {
  const dir = freshDir();
  assert.equal(allowance.readWeekly(dir), null);
  const past = Math.floor(Date.now() / 1000) - 60;
  statusline.record(dir, { usedPct: 90, resetsAt: past }, Date.now() - 3600e3);
  assert.equal(allowance.readWeekly(dir), null, 'a reading from a week that already reset was trusted');
  fs.writeFileSync(path.join(dir, statusline.FILE), '{"usedPct":"x"');
  assert.equal(allowance.readWeekly(dir), null);
  fs.writeFileSync(path.join(dir, statusline.FILE), JSON.stringify({ usedPct: 5, resetsAt: FUTURE, at: 1, history: [[1, 5, FUTURE], 'junk', [1, 'x', 2]] }));
  assert.deepEqual(allowance.readWeekly(dir).history, [[1, 5, FUTURE]]);
  assert.equal(allowance.readWeekly(42), null);
});

test('an account Kosmos prepares is born with the statusline, and prepare says so', () => {
  const got = accounts.prepare('Weekly 3946');
  assert.equal(got.ok, true, JSON.stringify(got));
  assert.equal(got.weeklyWired, true, JSON.stringify(got));
  const sl = readJson(path.join(got.dir, 'settings.json')).statusLine;
  assert.equal(sl.command, allowance.commandFor(NODE, SCRIPT, got.dir));
});

/* setup.sh's hook block, run for real (#3946 review): its node program is extracted
   from setup.sh and run against a sandbox home, so the wiring an install does is
   tested, not only the functions it calls. */
function setupHookProgram() {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const start = sh.indexOf("<<'HOOKSEOF'");
  assert.ok(start > 0, 'the hook block moved in setup.sh');
  const body = sh.slice(sh.indexOf('\n', start) + 1);
  return body.slice(0, body.indexOf('\nHOOKSEOF\n'));
}
function runSetupBlock({ withAllowance }) {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'setup-'));
  const kh = path.join(root, 'kosmos');
  const eng = path.join(kh, 'app', 'engine');
  fs.mkdirSync(eng, { recursive: true });
  /* COPIES in the installed layout, not symlinks: node resolves a symlinked module
     to its real path, so a symlinked fixture would find allowance.js in the repo
     even when this "bundle" leaves it out, and the missing-module arm would pass
     without testing anything. */
  for (const f of fs.readdirSync(__dirname)) {
    if (!f.endsWith('.js') || f.endsWith('.test.js')) continue;
    if (!withAllowance && f === 'allowance.js') continue;
    fs.copyFileSync(path.join(__dirname, f), path.join(eng, f));
  }
  /* The installed runtime, where an installed bundle keeps it, so stableNode takes the
     branch real machines take. A copy of this node, so it runs. */
  fs.mkdirSync(path.join(kh, 'runtime', 'bin'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(kh, 'runtime', 'bin', 'node'));
  fs.chmodSync(path.join(kh, 'runtime', 'bin', 'node'), 0o755);
  fs.mkdirSync(path.join(kh, 'app', 'bin'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'install', 'kosmos-report-hook.sh'), path.join(kh, 'app', 'bin', 'kosmos-report-hook.sh'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const r = spawnSync(NODE, ['-', kh], { input: setupHookProgram(), encoding: 'utf8',
    env: { ...process.env, AGENT_WORKFORCE_HOME: home, AGENT_WORKFORCE_DATA: path.join(root, 'data') } });
  const settings = path.join(home, '.claude', 'settings.json');
  r.kh = kh;
  return { r, data: fs.existsSync(settings) ? readJson(settings) : null };
}

test('setup.sh wires the default account with the report hooks AND the statusline', () => {
  const { r, data } = runSetupBlock({ withAllowance: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(data && data.hooks && Array.isArray(data.hooks.Stop), 'the report hooks were not wired');
  assert.ok(allowance.isOurs(data.statusLine), 'the statusline was not wired: ' + JSON.stringify(data && data.statusLine));
  assert.match(data.statusLine.command, /app\/engine\/kosmos-statusline\.js/, 'the command does not name the bundle copy');
  assert.ok(data.statusLine.command.startsWith('"' + path.join(fs.realpathSync(r.kh), 'runtime', 'bin', 'node') + '"'),
    'an installed bundle did not bake its own runtime node: ' + data.statusLine.command);
});

test('accounts.prepare still makes an account when the allowance module is missing', () => {
  const { kh } = runSetupBlock({ withAllowance: false }).r;
  const home = fs.mkdtempSync(path.join(SANDBOX, 'prep-'));
  const prog = "const a = require(process.argv[1]); process.stdout.write(JSON.stringify(a.prepare('No allowance 3946')));";
  const r = spawnSync(NODE, ['-e', prog, path.join(kh, 'app', 'engine', 'accounts.js')], { encoding: 'utf8',
    env: { ...process.env, AGENT_WORKFORCE_HOME: home, AGENT_WORKFORCE_DATA: path.join(home, 'data') } });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.ok, true, r.stdout);
  assert.equal(got.weeklyWired, false, r.stdout);
  assert.match(got.weeklyBecause, /could not be set up/, r.stdout);
  assert.equal(got.hooksWired, true, 'the report hooks were lost with the allowance module: ' + r.stdout);
});

test('setup.sh: a statusline that cannot be wired does not change the hooks\' answer', () => {
  const { r, data } = runSetupBlock({ withAllowance: false });
  assert.equal(r.status, 0, 'a missing allowance module changed the exit code: ' + r.stderr);
  assert.ok(data && data.hooks && Array.isArray(data.hooks.Stop), 'the report hooks were not wired');
  assert.equal(data.statusLine, undefined);
});

/* Uninstall NAMES the status line it cannot remove (setup.sh's rule: anything not
   removed is left alone and named). The block is extracted from setup.sh and run
   under bash, both arms: ours is named, somebody else's is not. */
test('uninstall names our status line, and only ours', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const start = sh.indexOf('  # #3946: the status line Kosmos adds to record weekly usage');
  assert.ok(start > 0, 'the uninstall naming block moved in setup.sh');
  const from = sh.indexOf('  _sl_left=""', start);
  const ifAt = sh.indexOf('  if [ -n "$_sl_left" ]', from);
  assert.ok(from > 0 && ifAt > from, 'the uninstall naming block changed shape');
  const block = sh.slice(from, sh.indexOf('\n  fi\n', ifAt) + '\n  fi\n'.length);
  assert.ok(block.includes(allowance.MARKER.replace('.', '\\.')), 'the uninstall grep does not name allowance.MARKER');
  const run = (dirs) => {
    const home = fs.mkdtempSync(path.join(SANDBOX, 'uninst with space-'));
    for (const [dir, statusLine] of Object.entries(dirs)) {
      fs.mkdirSync(path.join(home, dir));
      fs.writeFileSync(path.join(home, dir, 'settings.json'), JSON.stringify({ statusLine }));
    }
    const r = spawnSync('sh', ['-c', block], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    return { ...r, home };
  };
  const ours = { type: 'command', command: allowance.commandFor(NODE, SCRIPT, '/x') };
  const theirs = { type: 'command', command: 'bash ~/.claude/scripts/statusline.sh' };
  const both = run({ '.claude': ours, '.claude-work1': ours, '.claude-work2': theirs });
  assert.equal(both.status, 0, both.stderr);
  assert.match(both.stdout, /A Kosmos status line is still in these settings files/);
  // #5998: the uninstall removes this install's own first, so one still here may be another install's: never called dead outright.
  assert.match(both.stdout, /If no other Kosmos on this computer uses it/);
  assert.ok(both.stdout.includes(path.join(both.home, '.claude', 'settings.json')), 'the default account was not named');
  assert.ok(both.stdout.includes(path.join(both.home, '.claude-work1', 'settings.json')), 'a Kosmos account folder was not named');
  assert.ok(!both.stdout.includes('.claude-work2'), 'an account with somebody else\'s status line was named as ours');
  const none = run({ '.claude': theirs });
  assert.equal(none.stdout, '', 'somebody else\'s status line was named as ours');
});

/* Setup says it added a status line only when a settings file really carries ours:
   the block is extracted from setup.sh and run under sh with a stand-in info(). */
test('setup tells the person about the status line only when one was really added', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  const from = sh.indexOf('_sl_home="${AGENT_WORKFORCE_HOME:-$HOME}"');
  const ifAt = sh.indexOf('if [ -n "$_sl_added" ]', from);
  assert.ok(from > 0 && ifAt > from, 'the setup status-line message block changed shape');
  const block = 'info() { printf "%s\\n" "$*"; }\n' + sh.slice(from, sh.indexOf('\nfi\n', ifAt) + '\nfi\n'.length);
  const run = (statusLine) => {
    const home = fs.mkdtempSync(path.join(SANDBOX, 'setupmsg-'));
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(statusLine ? { statusLine } : {}));
    return spawnSync('sh', ['-c', block], { encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_HOME: home } });
  };
  const added = run({ type: 'command', command: allowance.commandFor(NODE, SCRIPT, '/x') });
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /carry Kosmos's/);
  assert.equal(run(null).stdout, '', 'setup claimed a status line it did not add');
  assert.equal(run({ type: 'command', command: 'bash mine.sh' }).stdout, '', 'setup claimed somebody else\'s status line as ours');
});

/* #3946 part 2: the calibration, tokens per point of the weekly figure. */
function weeklyFile(dir, usedPct, resetsAt, history) {
  fs.writeFileSync(path.join(dir, statusline.FILE), JSON.stringify({ usedPct, resetsAt, at: history[history.length - 1][0], history }));
}
const DAY = 24 * 3600 * 1000;

test('calibration: tokens today over (points moved + 1) since a reading from before today, stored for later', () => {
  const dir = freshDir();
  const now = Date.now();
  const dayStart = now - 6 * 3600 * 1000;
  weeklyFile(dir, 44, FUTURE, [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 44, FUTURE]]);
  const got = allowance.calibrate(dir, 4e6, { now, dayStart });
  // 4 points measured can be just under 5 real ones (the figure is a whole number): 4e6 / 5.
  assert.equal(got.tokensPerPoint, 8e5);
  assert.deepEqual(allowance.readCalibration(dir, now), { tokensPerPoint: 8e5, points: 4, tokens: 4e6, day: dayStart, at: now });
});

test('calibration: no reading from before today is no calibration, not a guess', () => {
  const dir = freshDir();
  const now = Date.now();
  const dayStart = now - 6 * 3600 * 1000;
  weeklyFile(dir, 44, FUTURE, [[dayStart + 60e3, 40, FUTURE], [now - 60e3, 44, FUTURE]]);
  assert.equal(allowance.pointsSince(allowance.readWeekly(dir, now), dayStart), null);
  assert.equal(allowance.calibrate(dir, 4e6, { now, dayStart }), null);
});

test('calibration: a day that moved too little keeps the stored one; last week\'s baseline is never used', () => {
  const dir = freshDir();
  const now = Date.now();
  const dayStart = now - 6 * 3600 * 1000;
  weeklyFile(dir, 44, FUTURE, [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 44, FUTURE]]);
  allowance.calibrate(dir, 4e6, { now, dayStart });
  weeklyFile(dir, 41, FUTURE, [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 41, FUTURE]]);
  assert.equal(allowance.calibrate(dir, 9e9, { now, dayStart }).tokensPerPoint, 8e5, 'one point replaced the stored calibration');
  const other = freshDir();
  weeklyFile(other, 5, FUTURE, [[dayStart - 3600e3, 90, FUTURE - 7 * 86400], [now - 60e3, 5, FUTURE]]);
  assert.equal(allowance.pointsSince(allowance.readWeekly(other, now), dayStart), null, 'a reading from the previous week was a baseline');
});

test('calibration: a new day\'s estimate on fewer points than the stored one keeps the stored one; on as many, replaces it', () => {
  const dir = freshDir();
  const now = Date.now();
  const dayStart = now - 6 * 3600 * 1000;
  fs.writeFileSync(path.join(dir, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: 1e6, points: 8, at: now - DAY }));
  weeklyFile(dir, 43, FUTURE, [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 43, FUTURE]]);
  assert.equal(allowance.calibrate(dir, 9e9, { now, dayStart }).tokensPerPoint, 1e6, 'a 3-point morning replaced an 8-point day');
  weeklyFile(dir, 48, FUTURE, [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 48, FUTURE]]);
  assert.equal(allowance.calibrate(dir, 18e6, { now, dayStart }).tokensPerPoint, 2e6, 'CONTROL: an 8-point day did not replace it');
  assert.equal(allowance.readCalibration(dir, now).at, now, 'the replacement was not stored');
});

test('calibration: a stored one older than CALIBRATION_REPLACE_AGE_MS is replaced by any qualifying day, even on fewer points', () => {
  const dir = freshDir();
  const now = Date.now();
  const dayStart = now - 6 * 3600 * 1000;
  weeklyFile(dir, 43, FUTURE, [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 43, FUTURE]]);
  fs.writeFileSync(path.join(dir, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: 1e6, points: 15, at: now - allowance.CALIBRATION_REPLACE_AGE_MS + 3600e3 }));
  assert.equal(allowance.calibrate(dir, 8e6, { now, dayStart }).tokensPerPoint, 1e6, 'CONTROL: a young 15-point one was replaced by 3 points');
  fs.writeFileSync(path.join(dir, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: 1e6, points: 15, at: now - allowance.CALIBRATION_REPLACE_AGE_MS - 3600e3 }));
  assert.equal(allowance.calibrate(dir, 8e6, { now, dayStart }).tokensPerPoint, 2e6, 'an old 15-point one held off a qualifying day');
});

test('calibration: the day\'s token count only grows (an agent stopped mid-day does not lower it); an unread count changes nothing', () => {
  const dir = freshDir();
  const now = Date.now();
  const dayStart = now - 6 * 3600 * 1000;
  weeklyFile(dir, 44, FUTURE, [[dayStart - 3600e3, 40, FUTURE], [now - 60e3, 44, FUTURE]]);
  assert.equal(allowance.calibrate(dir, 10e6, { now, dayStart }).tokensPerPoint, 2e6);
  // An agent left the roster: the same day's count reads lower, the points have not moved.
  assert.equal(allowance.calibrate(dir, 5e6, { now: now + 60e3, dayStart }).tokensPerPoint, 2e6, 'a smaller count the same day lowered it');
  // CONTROL: a larger count is taken.
  assert.equal(allowance.calibrate(dir, 15e6, { now: now + 120e3, dayStart }).tokensPerPoint, 3e6, 'CONTROL: a larger count was not taken');
  // A count not read in full (NaN) keeps the stored one and writes nothing.
  const before = fs.statSync(path.join(dir, allowance.CALIBRATION_FILE)).mtimeMs;
  assert.equal(allowance.calibrate(dir, NaN, { now: now + 180e3, dayStart }).tokensPerPoint, 3e6);
  assert.equal(allowance.readCalibration(dir, now + 180e3).at, now + 120e3, 'an unread count rewrote the calibration');
  assert.equal(fs.statSync(path.join(dir, allowance.CALIBRATION_FILE)).mtimeMs, before);
  // Yesterday's count is not carried into a new day.
  const nextDay = dayStart + DAY;
  weeklyFile(dir, 50, FUTURE, [[nextDay - 3600e3, 44, FUTURE], [nextDay + 3600e3, 50, FUTURE]]);
  assert.equal(allowance.calibrate(dir, 7e6, { now: nextDay + 3600e3, dayStart: nextDay }).tokensPerPoint, 1e6, 'yesterday\'s count was carried into today');
});

test('calibration: a stored one older than a week, or from the future, is not used', () => {
  const dir = freshDir();
  const now = Date.now();
  fs.writeFileSync(path.join(dir, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: 1e6, at: now - allowance.CALIBRATION_MAX_AGE_MS - 1 }));
  assert.equal(allowance.readCalibration(dir, now), null);
  fs.writeFileSync(path.join(dir, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: 1e6, at: now + DAY }));
  assert.equal(allowance.readCalibration(dir, now), null);
  fs.writeFileSync(path.join(dir, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: -5, at: now }));
  assert.equal(allowance.readCalibration(dir, now), null);
});

/* kosmos#5325: the sandbox is removed when the file ends. Every run used to leave it in the temp folder (about 20 MB
   each here; 128 of them filled 2.6 GB on one Mac). Only a folder this file made under the temp folder is removed. */
test.after(() => {
  const tmp = fs.realpathSync(os.tmpdir());
  const mine = fs.realpathSync(SANDBOX);
  if (!mine.startsWith(tmp + path.sep) || !path.basename(mine).startsWith('kosmos-allowance-')) return;
  fs.rmSync(mine, { recursive: true, force: true });
});

/* kosmos#6213: on Windows the command runs in Git Bash or PowerShell, so it is unquoted, with forward slashes, and a
   folder with a space is replaced by its short name. shortPath stands in for Windows' 8.3 lookup. */
test('#6213 the Windows command: unquoted forward slashes, a spaced folder by its short name, the script name kept', () => {
  const short = (d) => ({ 'C:\\Users\\John Smith\\AppData\\Local\\Kosmos\\runtime': 'C:\\Users\\JOHNSM~1\\AppData\\Local\\Kosmos\\runtime',
    'C:\\Users\\John Smith\\AppData\\Local\\Kosmos\\app\\engine': 'C:\\Users\\JOHNSM~1\\AppData\\Local\\Kosmos\\app\\engine',
    'C:\\Users\\John Smith\\.claude': 'C:\\Users\\JOHNSM~1\\.claude',
    'C:\\Users\\John Smith\\AppData\\Local\\Kosmos\\runtime\\node.exe': 'C:\\Users\\JOHNSM~1\\AppData\\Local\\Kosmos\\runtime\\node.exe' })[d] || null;
  const cmd = allowance.winCommandFor('C:\\Users\\John Smith\\AppData\\Local\\Kosmos\\runtime\\node.exe',
    'C:\\Users\\John Smith\\AppData\\Local\\Kosmos\\app\\engine\\kosmos-statusline.js', 'C:\\Users\\John Smith\\.claude', short);
  assert.equal(cmd, 'C:/Users/JOHNSM~1/AppData/Local/Kosmos/runtime/node.exe C:/Users/JOHNSM~1/AppData/Local/Kosmos/app/engine/kosmos-statusline.js C:/Users/JOHNSM~1/.claude');
  assert.ok(cmd.includes(allowance.MARKER), 'the script name was shortened, so the command is no longer recognised as Kosmos\'s');
  assert.ok(!/["\\]/.test(cmd), 'a quote or a backslash went into the command');
  const plain = allowance.winCommandFor('C:\\K\\node.exe', 'C:\\K\\kosmos-statusline.js', 'C:\\Users\\p\\.claude', () => null);
  assert.equal(plain, 'C:/K/node.exe C:/K/kosmos-statusline.js C:/Users/p/.claude', 'CONTROL: a path with no space needs no short name');
  assert.equal(allowance.winCommandFor('C:\\a b\\node.exe', 'C:\\K\\kosmos-statusline.js', 'C:\\p', () => null), null, 'a spaced folder with no short name went in unquoted');
  assert.equal(allowance.winCommandFor('C:\\K\\node.exe', 'C:\\K\\kosmos-statusline.js', 'C:\\p&q', () => null), null, 'a character a shell reads went in');
  assert.equal(allowance.winCommandFor('C:\\K\\node.exe', 'C:\\K\\my script.js', 'C:\\p', () => 'C:\\K'), null, 'a spaced file name was shortened');
});

test('#6213 ensureStatusLine on Windows writes that command, and refuses (writing nothing) when it cannot be made', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  const got = allowance.ensureStatusLine(p, { platform: 'win32', node: 'C:\\K\\node.exe', script: 'C:\\K\\kosmos-statusline.js', accountDir: 'C:\\Users\\p\\.claude', shortPath: () => null });
  assert.deepEqual(got, { wired: true, changed: true });
  const sl = readJson(p).statusLine;
  assert.deepEqual(sl, { type: 'command', command: 'C:/K/node.exe C:/K/kosmos-statusline.js C:/Users/p/.claude' });
  assert.ok(allowance.isOurs(sl), 'the written status line is not recognised as Kosmos\'s');
  assert.deepEqual(allowance.ensureStatusLine(p, { platform: 'win32', node: 'C:\\K\\node.exe', script: 'C:\\K\\kosmos-statusline.js', accountDir: 'C:\\Users\\p\\.claude', shortPath: () => null }),
    { wired: true, changed: false }, 'CONTROL: a second wiring changed a file that was already right');
  const q = path.join(freshDir(), 'settings.json');
  const no = allowance.ensureStatusLine(q, { platform: 'win32', node: 'C:\\a b\\node.exe', script: 'C:\\K\\kosmos-statusline.js', accountDir: 'C:\\p', shortPath: () => null });
  assert.equal(no.wired, false);
  assert.match(no.because, /Windows has no short name for it/);
  assert.equal(fs.existsSync(q), false, 'a refused wiring wrote a settings file');
  const slow = allowance.ensureStatusLine(q, { platform: 'win32', node: 'C:\\a b\\node.exe', script: 'C:\\K\\kosmos-statusline.js', accountDir: 'C:\\p', shortPath: () => undefined });
  assert.equal(slow.wired, false);
  assert.match(slow.because, /could not ask Windows .* retry/, 'a lookup that timed out was reported as a folder with no short name');
  assert.equal(fs.existsSync(q), false, 'a refused wiring wrote a settings file');
});

test('#6213 a folder with a non-ASCII letter is tried by its short name; one whose short name keeps an apostrophe is refused', () => {
  // Windows keeps an apostrophe in an 8.3 name (it is a legal 8.3 character), so O'Brien stays O'Brien: refused, not wired.
  const short = (d) => ({ 'C:\\Users\\Jos\u00e9\\.claude': 'C:\\Users\\JOSE~1\\.claude', "C:\\Users\\O'Brien\\K": "C:\\Users\\O'Brien\\K" })[d] || null;
  assert.equal(allowance.winCommandFor('C:\\K\\node.exe', 'C:\\K\\kosmos-statusline.js', 'C:\\Users\\Jos\u00e9\\.claude', short),
    'C:/K/node.exe C:/K/kosmos-statusline.js C:/Users/JOSE~1/.claude');
  assert.equal(allowance.winCommandFor('C:\\K\\node.exe', "C:\\Users\\O'Brien\\K\\kosmos-statusline.js", 'C:\\p', short), null,
    'a short name that keeps an apostrophe went into the command');
});

test('#6213 the Windows uninstall takes out Kosmos\'s status line when it points inside the install, by either spelling', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  const put = (command) => fs.writeFileSync(p, JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command } }));
  const roots = ['C:\\Users\\John Smith\\AppData\\Local\\Kosmos'];
  const short = (r) => (r === roots[0] ? 'C:\\Users\\JOHNSM~1\\AppData\\Local\\Kosmos' : null);
  put('C:/Users/JOHNSM~1/AppData/Local/Kosmos/runtime/node.exe C:/Users/JOHNSM~1/AppData/Local/Kosmos/app/engine/kosmos-statusline.js C:/Users/JOHNSM~1/.claude');
  assert.deepEqual(allowance.unwireStatusLine(p, roots, { shortPath: short, dryRun: true }), { ours: true, changed: false }, 'a dry run is not read-only');
  assert.ok(readJson(p).statusLine, 'CONTROL: the dry run changed the file');
  assert.deepEqual(allowance.unwireStatusLine(p, roots, { shortPath: short }), { ours: true, changed: true });
  assert.deepEqual(readJson(p), { theme: 'dark' }, 'the status line stayed, or another setting went');
  put('C:/Other/Kosmos/runtime/node.exe C:/Other/Kosmos/app/engine/kosmos-statusline.js C:/Users/p/.claude');
  assert.equal(allowance.unwireStatusLine(p, roots, { shortPath: short, gone: () => false }).changed, false, 'another install\'s (live) status line was taken out');
  put('bash ~/.claude/my-status.sh');
  assert.equal(allowance.unwireStatusLine(p, roots, { shortPath: short, gone: () => true }).changed, false, 'the person\'s own status line was taken out');
});

test('#6213 the uninstall also takes out a Kosmos status line whose script is already gone', () => {
  const p = path.join(freshDir(), 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ statusLine: { type: 'command', command: 'C:/Old/runtime/node.exe C:/Old/app/engine/kosmos-statusline.js C:/Users/p/.claude' } }));
  const roots = ['C:\\New\\Kosmos'];
  assert.equal(allowance.unwireStatusLine(p, roots, { shortPath: () => null, gone: () => false }).changed, false, 'CONTROL: a live script from another install was taken out');
  assert.deepEqual(allowance.unwireStatusLine(p, roots, { shortPath: () => null, gone: () => true }), { ours: true, changed: true }, 'a status line naming a deleted script was left to fail on every refresh');
});

test('#6213 a gone-script check claims only a token that IS kosmos-statusline.js, not a name ending in it', () => {
  const p = path.join(freshDir(), 'settings.json');
  const roots = ['C:\\New\\Kosmos'];
  fs.writeFileSync(p, JSON.stringify({ statusLine: { type: 'command', command: 'node C:/me/my-kosmos-statusline.js C:/Users/p/.claude' } }));
  assert.equal(allowance.unwireStatusLine(p, roots, { shortPath: () => null, gone: () => true }).changed, false, 'the person\'s own my-kosmos-statusline.js was taken out');
  assert.ok(readJson(p).statusLine, 'the person\'s status line is gone from the file');
  for (const command of ['node ~/.claude/kosmos-statusline.js', 'node kosmos-statusline.js']) {
    fs.writeFileSync(p, JSON.stringify({ statusLine: { type: 'command', command } }));
    assert.equal(allowance.unwireStatusLine(p, roots, { shortPath: () => null, gone: () => true }).changed, false, 'a status line naming ' + command + ' (not a path Kosmos writes) was taken out');
  }
  fs.writeFileSync(p, JSON.stringify({ statusLine: { type: 'command', command: 'node C:/Old/app/engine/kosmos-statusline.js C:/Users/p/.claude' } }));
  assert.equal(allowance.unwireStatusLine(p, roots, { shortPath: () => null, gone: () => true }).changed, true, 'CONTROL: Kosmos\'s own gone script was left in');
});

test('#6213 winShortPathCached keeps a clean "no short name" for a folder that exists, and never a failed ask', () => {
  const dir = freshDir();
  let asks = 0;
  const none = () => { asks++; return { answered: true, short: null }; };
  assert.equal(allowance.winShortPathCached(dir, none), null);
  assert.equal(allowance.winShortPathCached(dir, none), null);
  assert.equal(asks, 1, '8.3 switched off started cmd.exe again for the same folder');
  const failing = path.join(dir, 'failing');
  fs.mkdirSync(failing);
  asks = 0;
  const fail = () => { asks++; return { answered: false }; };
  allowance.winShortPathCached(failing, fail);
  allowance.winShortPathCached(failing, fail);
  assert.equal(asks, 2, 'a timeout or failed spawn was kept as the answer');
  const later = path.join(dir, 'not-yet');
  asks = 0;
  allowance.winShortPathCached(later, none);
  allowance.winShortPathCached(later, none);
  assert.equal(asks, 2, 'a "none" for a folder that does not exist yet was kept');
  const missing = path.join(dir, 'missing yet');
  let longAsks = 0;
  const long = () => { longAsks++; return { answered: true, short: 'C:/LONGNAME' }; };
  allowance.winShortPathCached(missing, long);
  allowance.winShortPathCached(missing, long);
  assert.equal(longAsks, 2, 'an answer for a folder that does not exist yet was kept (cmd.exe echoes a missing folder back)');
  assert.equal(allowance.winShortPathCached(failing, fail), undefined, 'a failed ask reads as "no short name", which is a different answer');
  const sp = path.join(dir, 'spaced');
  fs.mkdirSync(sp);
  assert.equal(allowance.winShortPathCached(sp, () => ({ answered: true, short: 'C:/SPACED~1' })), 'C:/SPACED~1');
  assert.equal(allowance.winShortPathCached(sp, () => { throw new Error('asked again'); }), 'C:/SPACED~1', 'an answer was not kept');
});


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

test('the refusals: Windows, no script, an unsafe path, an ephemeral path into a durable file, a dangling link', () => {
  const dir = freshDir();
  const p = path.join(dir, 'settings.json');
  assert.match(allowance.ensureStatusLine(p, { platform: 'win32' }).because, /Windows/);
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
  assert.match(both.stdout, /Kosmos's status line was left in these settings files/);
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

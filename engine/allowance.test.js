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
const NODE = process.execPath;

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

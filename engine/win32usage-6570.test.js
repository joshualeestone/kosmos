'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits
/**
 * kosmos#6570: a Windows Claude account row shows its usage.
 *
 * A Windows agent runs Claude Code headless (stream-json), so Claude Code never runs its status line there, and the
 * status line was the only thing that recorded the account's weekly and five-hour readings. Measured on the Windows box
 * 10-21: the row showed 1% from 10-19 while the account was at 96%. Every turn's rate_limit_event carries the readings,
 * so the agent's own stream now records them into the same files the status line writes.
 *
 * These feed a REAL rate_limit_event line (captured on the Windows box, 10-21) through the REAL supervisor's stream
 * reader into the REAL publisher, which records into a sandbox account folder through the REAL status line writer, and
 * read it back through accountsweekly.weeklyOf / fiveHourOf, the helpers GET /api/accounts calls for each Claude row.
 *
 *   node --test engine/win32usage-6570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win32usage-6570-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = path.join(SANDBOX, 'settings.json');

const sup = require('./win32supervisor');
const streamstate = require('./win32streamstate');
const statusline = require('./kosmos-statusline');
const accountsweekly = require('./accountsweekly');

/* Verbatim, as Claude Code wrote it on the Windows box at 14:02 on 10-21 (one line of its stream-json output). */
const CAPTURED = '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1792965600,"rateLimitType":"seven_day","utilization":0.96,"overageStatus":"rejected","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.25,"resetsAt":1792611600},"seven_day":{"utilization":0.96,"resetsAt":1792965600}},"overageEnabled":false}}';
const CAPTURED_AT_MS = Date.UTC(2026, 9, 21, 19, 2, 0);   // 14:02 Central, when it was captured: both windows still ahead

let seq = 0;
function accountDir() {
  const d = path.join(SANDBOX, 'acct-' + (++seq));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** The same captured line with its reset times moved to just ahead of now, so the supervisor-path tests do not expire. */
function capturedShiftedToNow() {
  const j = JSON.parse(CAPTURED);
  const nowS = Math.floor(Date.now() / 1000);
  const five = nowS + 2 * 3600, week = nowS + 3 * 86400;
  j.rate_limit_info.resetsAt = week;
  j.rate_limit_info.unifiedWindows.five_hour.resetsAt = five;
  j.rate_limit_info.unifiedWindows.seven_day.resetsAt = week;
  return { line: JSON.stringify(j), five, week };
}

function streamingChild(pid) {
  const c = new EventEmitter();
  c.pid = pid;
  c.written = [];
  c.stdin = { destroyed: false, write: (s, cb) => { c.written.push(s); if (typeof cb === 'function') cb(null); }, end() { this.destroyed = true; } };
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.die = (code) => c.emit('exit', code === undefined ? 0 : code);
  return c;
}

/** The real supervisor loop with the real publisher recording into `dir`; returns a function that types a stdout chunk. */
function supervisedAgent(name, dir) {
  const kids = [];
  const stream = streamstate.publisher(name, { usageDir: dir });
  const h = sup.superviseStreaming({ name, cwd: 'C:\\w', runner: 'claude' }, {
    liveReader: () => [], throttleMs: 0, now: () => 0, setTimer: () => {},
    stream,
    launch: () => { const c = streamingChild(8100 + kids.length); kids.push(c); return { ok: true, sessionId: 'sess-' + name, resumed: false, child: c }; },
  });
  return { h, out: (text) => kids[0].stdout.emit('data', Buffer.from(text)) };
}

test('#6570 the captured event reads as five-hour 25% and weekly 96%, in the status line\'s units', () => {
  const u = streamstate.usageOfEvent(JSON.parse(CAPTURED));
  assert.deepEqual(u, { fiveHour: { usedPct: 25, resetsAt: 1792611600 }, weekly: { usedPct: 96, resetsAt: 1792965600 } });
});

test('#6570 without unifiedWindows (marked @internal) the top-level figure answers for the window rateLimitType names', () => {
  const j = JSON.parse(CAPTURED);
  delete j.rate_limit_info.unifiedWindows;
  assert.deepEqual(streamstate.usageOfEvent(j), { fiveHour: null, weekly: { usedPct: 96, resetsAt: 1792965600 } });
  j.rate_limit_info.rateLimitType = 'five_hour';
  j.rate_limit_info.utilization = 0.4;
  j.rate_limit_info.resetsAt = 1792611600;
  assert.deepEqual(streamstate.usageOfEvent(j), { fiveHour: { usedPct: 40, resetsAt: 1792611600 }, weekly: null });
  // A window unifiedWindows leaves out still falls back to the top level when that names it.
  const k = JSON.parse(CAPTURED);
  delete k.rate_limit_info.unifiedWindows.seven_day;
  assert.deepEqual(streamstate.usageOfEvent(k), { fiveHour: { usedPct: 25, resetsAt: 1792611600 }, weekly: { usedPct: 96, resetsAt: 1792965600 } });
});

test('#6570 nothing is guessed: no figure, a bad figure or another event type reads as no reading', () => {
  const base = () => JSON.parse(CAPTURED);
  assert.equal(streamstate.usageOfEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', isUsingOverage: false } }), null);
  assert.equal(streamstate.usageOfEvent({ type: 'result' }), null);
  assert.equal(streamstate.usageOfEvent(null), null);
  assert.equal(streamstate.usageOfEvent({ type: 'rate_limit_event', rate_limit_info: [] }), null);
  const pct = base(); pct.rate_limit_info.unifiedWindows.five_hour.utilization = 25; delete pct.rate_limit_info.utilization;
  delete pct.rate_limit_info.unifiedWindows.seven_day;
  assert.equal(streamstate.usageOfEvent(pct), null, 'a figure past 2 (a percentage, not a fraction) is refused, not drawn as 2500%');
  const neg = base(); neg.rate_limit_info.unifiedWindows.five_hour.utilization = -0.1;
  assert.equal(streamstate.usageOfEvent(neg).fiveHour, null);
  const noReset = base(); delete noReset.rate_limit_info.unifiedWindows.five_hour.resetsAt;
  assert.equal(streamstate.usageOfEvent(noReset).fiveHour, null);
  const ms = base(); ms.rate_limit_info.unifiedWindows.five_hour.resetsAt = 1792611600 * 1000;
  assert.equal(streamstate.usageOfEvent(ms).fiveHour.resetsAt, 1792611600, 'a reset in milliseconds is taken as such');
});

test('#6570 the captured reading lands in the status line\'s files and reads back through /api/accounts\' helpers', () => {
  const dir = accountDir();
  statusline.recordReadings(dir, streamstate.usageOfEvent(JSON.parse(CAPTURED)), CAPTURED_AT_MS);
  const row = { dir, apiKey: false };
  assert.deepEqual(accountsweekly.weeklyOf(row, CAPTURED_AT_MS), { usedPct: 96, resetsAt: 1792965600 * 1000, at: CAPTURED_AT_MS });
  assert.deepEqual(accountsweekly.fiveHourOf(row, CAPTURED_AT_MS), { usedPct: 25, resetsAt: 1792611600 * 1000, at: CAPTURED_AT_MS });
  // Once each window has reset, the row shows no reading rather than last window's figure as current.
  assert.equal(accountsweekly.fiveHourOf(row, 1792611600 * 1000 + 1), null);
  assert.equal(accountsweekly.weeklyOf(row, 1792965600 * 1000 + 1), null);
});

test('#6570 end to end: a real stream line through the supervisor\'s reader and the publisher reaches the account row', () => {
  const dir = accountDir();
  const { line, five, week } = capturedShiftedToNow();
  const row = { dir, apiKey: false };
  assert.equal(accountsweekly.weeklyOf(row), null, 'no reading before the event');
  const a = supervisedAgent('usage-e2e', dir);
  try {
    // Split mid-line, as a pipe can deliver it, between a turn's other events.
    const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-usage-e2e' }) + '\n';
    const text = init + line + '\n' + JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok' }) + '\n';
    a.out(text.slice(0, init.length + 40));
    a.out(text.slice(init.length + 40));
    const w = accountsweekly.weeklyOf(row);
    const f = accountsweekly.fiveHourOf(row);
    assert.ok(w && f, 'both readings are on the row: ' + JSON.stringify({ w, f }));
    assert.equal(w.usedPct, 96);
    assert.equal(w.resetsAt, week * 1000);
    assert.equal(f.usedPct, 25);
    assert.equal(f.resetsAt, five * 1000);
    assert.ok(Math.abs(Date.now() - w.at) < 60e3, 'at is when it was recorded, in ms');
    assert.equal(accountsweekly.weeklyBlockedOf({ dir }, 'win32'), null, 'on Windows no status line setting stands between the row and its readings');
    assert.equal(accountsweekly.weeklyBlockedOf({ dir }, 'darwin'), 'not-wired', 'CONTROL: the Mac still names the reason');
  } finally { a.h.stop(); }
});

test('#6570 the stream latest figure wins in its window (it is the answer now, not a lagging session figure); unchanged is not rewritten', () => {
  /* Measured on the Windows box 10-22: the default account's file held 96% for this week while a live turn's event said
     3%, same reset, after the folder's sign-in changed. The status line's forward-only rule would have kept 96%. */
  const dir = accountDir();
  const row = { dir, apiKey: false };
  const nowS = Math.floor(Date.now() / 1000);
  const ev = (u, reset) => ({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { seven_day: { utilization: u, resetsAt: reset } } } });
  const p = streamstate.publisher('usage-order', { usageDir: dir, write: () => ({ ok: true }), clear: () => true });
  p.started(9001, 'sess-order');
  p.event(ev(0.96, nowS + 86400));
  p.event(ev(0.03, nowS + 86400));
  assert.equal(accountsweekly.weeklyOf(row).usedPct, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, statusline.FILE), 'utf8')).history.map((r) => r[1]), [3],
    'review 2: a lower figure in the same week is another account (or a reset): its history starts again, so the calibration never reads 96 as its baseline');
  const at = JSON.parse(fs.readFileSync(path.join(dir, statusline.FILE), 'utf8')).at;
  const rows = JSON.parse(fs.readFileSync(path.join(dir, statusline.FILE), 'utf8')).history.length;
  p.event(ev(0.03, nowS + 86400));
  const again = JSON.parse(fs.readFileSync(path.join(dir, statusline.FILE), 'utf8'));
  assert.equal(again.at, at, 'an unchanged figure keeps the time it last changed');
  assert.equal(again.history.length, rows, 'and adds no history row');
  p.event(ev(0.5, nowS - 3 * 86400));
  assert.equal(accountsweekly.weeklyOf(row).usedPct, 3, 'a reading whose week has already reset is refused');
  p.event(ev(0.05, nowS + 8 * 86400));
  assert.equal(accountsweekly.weeklyOf(row).usedPct, 5, 'a new week replaces it');
  p.stopped();
});

test('#6570 a folder signed in to another account: its live reading with an EARLIER reset still replaces the stored one', () => {
  /* Review 1: two accounts rarely share a reset. The folder held account A's 96% resetting in five days; it is now
     account B, whose week resets in two. B's live reading must show at once, not after A's reset. */
  const dir = accountDir();
  const row = { dir, apiKey: false };
  const nowS = Math.floor(Date.now() / 1000);
  const p = streamstate.publisher('usage-swap', { usageDir: dir, write: () => ({ ok: true }), clear: () => true });
  p.started(9004, 'sess-swap');
  p.event({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { seven_day: { utilization: 0.96, resetsAt: nowS + 5 * 86400 }, five_hour: { utilization: 0.6, resetsAt: nowS + 4 * 3600 } } } });
  assert.equal(accountsweekly.weeklyOf(row).usedPct, 96);
  p.event({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { seven_day: { utilization: 0.03, resetsAt: nowS + 2 * 86400 }, five_hour: { utilization: 0.1, resetsAt: nowS + 2 * 3600 } } } });
  assert.equal(accountsweekly.weeklyOf(row).usedPct, 3);
  assert.equal(accountsweekly.weeklyOf(row).resetsAt, (nowS + 2 * 86400) * 1000);
  assert.equal(accountsweekly.fiveHourOf(row).usedPct, 10, 'the five-hour reading follows the same rule');
  p.stopped();
});

test('#6570 review 3: a HIGHER figure under another reset time (another account) also starts the history again', () => {
  const dir = accountDir();
  const nowS = Math.floor(Date.now() / 1000);
  const hist = () => JSON.parse(fs.readFileSync(path.join(dir, statusline.FILE), 'utf8')).history.map((r) => [r[1], r[2]]);
  const ev = (u, reset) => ({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { seven_day: { utilization: u, resetsAt: reset } } } });
  const p = streamstate.publisher('usage-higher', { usageDir: dir, write: () => ({ ok: true }), clear: () => true });
  p.started(9005, 'sess-higher');
  p.event(ev(0.4, nowS + 3 * 86400));
  p.event(ev(0.45, nowS + 3 * 86400));
  assert.deepEqual(hist(), [[40, nowS + 3 * 86400], [45, nowS + 3 * 86400]], 'one account moving up keeps its history');
  p.event(ev(0.6, nowS + 3 * 86400 - 3600));   // another account, its reset an hour earlier: inside the status line's one-day tolerance
  assert.deepEqual(hist(), [[60, nowS + 3 * 86400 - 3600]], 'the rows of the other account were kept as the baseline of this one');
  assert.equal(accountsweekly.weeklyOf({ dir, apiKey: false }).usedPct, 60);
  // Review 4: the same figure under a moved reset is recorded too (the reset is part of the reading).
  p.event(ev(0.6, nowS + 2 * 86400));
  assert.equal(accountsweekly.weeklyOf({ dir, apiKey: false }).resetsAt, (nowS + 2 * 86400) * 1000);
  assert.deepEqual(hist(), [[60, nowS + 2 * 86400]]);
  p.stopped();
});

test('#6570 review 3: the account folder may be named by a function, asked at each reading', () => {
  const dir = path.join(SANDBOX, 'made-later');
  const { line } = capturedShiftedToNow();
  const p = streamstate.publisher('usage-later', { usageDir: () => streamstate.claudeAccountDirFor(dir, { env: {}, homedir: SANDBOX }), write: () => ({ ok: true }), clear: () => true });
  p.started(9006, 'sess-later');
  p.event(JSON.parse(line));
  assert.equal(fs.existsSync(dir), false, 'a folder that is not there yet is not made');
  fs.mkdirSync(dir);
  p.event(JSON.parse(line));
  assert.equal(accountsweekly.weeklyOf({ dir, apiKey: false }).usedPct, 96, 'a folder made after the start is found at the next reading');
  p.stopped();
});

test('#6570 the status line itself keeps its forward-only rule (a session carries a lagging figure there)', () => {
  const dir = accountDir();
  const nowMs = Date.now();
  const reset = Math.floor(nowMs / 1000) + 86400;
  statusline.main(['node', 'kosmos-statusline.js', dir], JSON.stringify({ rate_limits: { seven_day: { used_percentage: 50, resets_at: reset } } }), nowMs);
  statusline.main(['node', 'kosmos-statusline.js', dir], JSON.stringify({ rate_limits: { seven_day: { used_percentage: 30, resets_at: reset } } }), nowMs + 1000);
  assert.equal(accountsweekly.weeklyOf({ dir, apiKey: false }, nowMs + 2000).usedPct, 50);
});

test('#6570 a reading that cannot be recorded never costs the card its state', () => {
  const writes = [];
  const p = streamstate.publisher('usage-throws', { usageDir: SANDBOX, recordUsage: () => { throw new Error('disk gone'); }, write: (rec) => { writes.push(rec.state); return { ok: true }; }, clear: () => true });
  p.started(9002, 'sess-throws');
  p.wrote();
  assert.doesNotThrow(() => p.event(JSON.parse(CAPTURED)));
  p.event({ type: 'result', subtype: 'success', is_error: false });
  assert.deepEqual(writes, ['idle', 'busy', 'idle']);
  p.stopped();
});

test('#6570 with no account folder, or no process, nothing is recorded', () => {
  const calls = [];
  const none = streamstate.publisher('usage-none', { recordUsage: (...a) => calls.push(a), write: () => ({ ok: true }), clear: () => true });
  none.started(9003, 'sess-none');
  none.event(JSON.parse(CAPTURED));
  none.stopped();
  const idle = streamstate.publisher('usage-idle', { usageDir: SANDBOX, recordUsage: (...a) => calls.push(a), write: () => ({ ok: true }), clear: () => true });
  idle.event(JSON.parse(CAPTURED));   // never started: no process to speak for
  assert.equal(calls.length, 0);
});

test('#6570 the account folder: the agent\'s CLAUDE_CONFIG_DIR, or the default only when the board lists the same one', () => {
  const home = path.join(SANDBOX, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const named = accountDir();
  assert.equal(streamstate.claudeAccountDirFor(named, { env: {}, homedir: home }), named);
  assert.equal(streamstate.claudeAccountDirFor(undefined, { env: {}, homedir: home }), path.join(home, '.claude'));
  assert.equal(streamstate.claudeAccountDirFor(null, { env: { AGENT_WORKFORCE_HOME: home }, homedir: home }), path.join(home, '.claude'));
  assert.equal(streamstate.claudeAccountDirFor(null, { env: { AGENT_WORKFORCE_HOME: path.join(SANDBOX, 'elsewhere') }, homedir: home }), null,
    'a board on another home lists another default account: the agent\'s is not one it shows, so nothing is written');
  assert.equal(streamstate.claudeAccountDirFor(path.join(SANDBOX, 'missing'), { env: {}, homedir: home }), null, 'a folder that is not there is not made');
  assert.equal(streamstate.claudeAccountDirFor('relative\\dir', { env: {}, homedir: home }), null);
  const file = path.join(SANDBOX, 'a-file'); fs.writeFileSync(file, 'x');
  assert.equal(streamstate.claudeAccountDirFor(file, { env: {}, homedir: home }), null);
});

test('#6570 only a Claude agent records into a Claude account folder', () => {
  const named = accountDir();
  assert.equal(sup.usageDirFor({ runner: 'claude', configDir: named }), named);
  assert.equal(sup.usageDirFor({ configDir: named }), named, 'an omitted runner means Claude');
  for (const runner of ['codex', 'gemini', 'grok', 'antigravity']) {
    assert.equal(sup.usageDirFor({ runner, configDir: named }), null, runner + ': its configDir is the home of its own provider');
  }
});

test('#6570 main(), the one production wiring: a Claude agent stream records into its account folder', () => {
  const launcher = require('./win32launch');
  const named = accountDir();
  const cwd = path.join(SANDBOX, 'cwd-main'); fs.mkdirSync(cwd, { recursive: true });
  const spawned = [];
  launcher.setSpawn((bin, argv) => { const c = streamingChild(4343); spawned.push(c); return c; });
  sup.setLiveReader(() => []);
  const { line, week } = capturedShiftedToNow();
  const handle = sup.main(['usage-main', cwd, '-', named, 'claude'], {
    watchHost: () => ({ stop() {} }), exitLater: () => {}, hostAlive: () => true,
    agentBrowser: () => 'browser-config.json', agentPermission: () => 'perm.json',
  });
  try {
    assert.equal(spawned.length, 1, 'main() started its agent');
    spawned[0].stdout.emit('data', Buffer.from(line + '\n'));
    const w = accountsweekly.weeklyOf({ dir: named, apiKey: false });
    assert.ok(w, 'main() did not record the agent reading into its account folder');
    assert.equal(w.usedPct, 96);
    assert.equal(w.resetsAt, week * 1000);
  } finally {
    handle.stop();
    launcher.setSpawn(null);
    sup.setLiveReader(null);
  }
});

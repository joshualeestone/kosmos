'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9038: a sign-in line from before the account's last sign-in stops recording refusals on the account check's
 * re-check ticks, and nothing else changes. Drives the real snapshot() through test-support/fleet, with the account
 * check, the login date and the clock injected. No Keychain, no real claude.
 *
 *   node --test engine/oldsigninline-9038.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-oldline-9038-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const create = require('./create');
const authprobe = require('./authprobe');
const observed = require('./observed');
const subscription = require('./subscription');
const loginlive = require('./claudeloginlive');
const loginexpiry = require('./loginexpiry');
const oldline = require('./oldsigninline');

const { HEALTHY, UNCHECKED } = authprobe;
const CONNECTED = subscription.STATE.CONNECTED;
const NONE = subscription.STATE.NONE;
/* Built from two pieces, so an agent reading this file does not show the line the screen reader looks for. */
const LINE = '● OAuth access token has been revoked' + ' · Please run ' + '/login';
const RULE = '─'.repeat(60);
const FOOT = ['', RULE, '❯ ', RULE, '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'];
const screenOf = (...rows) => [...rows, ...FOOT].join('\n') + '\n';
const ONE = screenOf('> do the thing', LINE);

const DAY = 24 * 3600000;
const T0 = Date.parse('2026-11-25T10:00:00Z');
const D1 = T0 + 10 * DAY;
const D2 = T0 + 30 * DAY;

const realNow = Date.now;
const realReadJob = create.readJob;
let clock = T0;
let screen = ONE;
let live = CONNECTED;
let until = D1;
let job = { configDir: null };
let run = 'a1';
let up = true;
let pane = '0.0';
const ROOT = path.join(SANDBOX, 'cfg');
const PID = '4242';
let proc = null;   // what the agent's process is and reads
const transcript = (id) => path.join(ROOT, 'projects', '-w', `${id}.jsonl`);
const session = (id, pid = PID, own = pid) => {
  fs.mkdirSync(path.join(ROOT, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'sessions', `${pid}.json`), JSON.stringify({ pid: Number(own), sessionId: id }));
};
const stamp = () => new Date(clock).toISOString();
const asked = () => ({ type: 'user', timestamp: stamp(), message: { role: 'user', content: 'go' } });
const refused = () => ({ type: 'assistant', isApiErrorMessage: true, error: 'authentication_failed', timestamp: stamp(), message: { content: [] } });
const answered = () => ({ type: 'assistant', timestamp: stamp(), message: { content: [] } });
const say = (id, ...rows) => {
  fs.mkdirSync(path.dirname(transcript(id)), { recursive: true });
  fs.appendFileSync(transcript(id), [...rows, { type: 'last-prompt' }, { type: 'mode' }].map((r) => JSON.stringify(r) + '\n').join(''));
};
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';

test.beforeEach(() => {
  clock = T0; screen = ONE; live = CONNECTED; until = D1; run = 'a1'; up = true; pane = '0.0';
  Date.now = () => clock;
  proc = { pid: PID, ccd: ROOT };
  job = { configDir: ROOT };
  fs.rmSync(ROOT, { recursive: true, force: true });
  session(S1); say(S1, asked(), refused());
  status.setPaneLoginReaderForTests(async () => proc);
  create.readJob = () => job;
  authprobe.resetForTest();
  authprobe.setChecker(async () => ({ state: live }));
  loginlive._clearForTest();
  loginlive.setReaderForTests(async () => until);
  observed._clearForTest();
});
test.afterEach(() => {
  Date.now = realNow;
  create.readJob = realReadJob;
  authprobe.resetForTest();
  loginlive.setReaderForTests(null);
  status.setPaneLoginReaderForTests(null);
  loginlive._clearForTest();
  observed._clearForTest();
  fleet.restore();
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
/* One board tick, 5 s after the last: the card's state, and whether a refusal was recorded ON this tick. */
async function tick(ms = 5000) {
  clock += ms;
  status.setPaneSource(() => !up ? '' : fleet.line({ session: 'worker-discord', pane, command: fleet.CLAUDE_COMMAND, tokenInstance: run }));
  status.setPaneCapture(() => screen);
  const card = status.snapshot().agents.find((a) => a.sessionName === 'worker');
  const o = observed.read(observed.PROVIDER.ANTHROPIC, 'worker');
  await settle();
  return { state: card && card.state, refused: !!o && o.outcome === observed.OUTCOME.REJECTED && o.at === clock };
}
async function ticks(n) { const out = []; for (let i = 0; i < n; i++) out.push(await tick()); return out; }
const refusals = (list) => list.filter((t) => t.refused).length;
const MIN = 12;   // ticks

test('#9038: after a sign-in, 20 minutes over the old line record no refusal and the card never flickers', async () => {
  const before = await ticks(3 * MIN);
  assert.ok(refusals(before) >= 3, 'CONTROL: before the sign-in the re-check ticks record refusals: ' + refusals(before));
  until = D2;   // the person signs in again
  await ticks(2 * MIN);   // the login date is read once a minute
  const after = await ticks(20 * MIN);
  assert.equal(refusals(after), 0, 'a repaired account recorded a refusal off its old line');
  assert.deepEqual([...new Set(after.map((t) => t.state))].length, 1, 'the card changed state while nothing happened');
  assert.notEqual(after[0].state, status.STATE.AUTH_FAILED);
});

test('#9038 CONTROL: a revoked token (check says connected, date unchanged) keeps recording its refusal for 20 minutes', async () => {
  const list = await ticks(20 * MIN);
  assert.ok(refusals(list) >= 20, 'a revoked account went quiet: ' + refusals(list));
  const longest = list.reduce((m, t) => (t.refused ? { run: 0, max: m.max } : { run: m.run + 1, max: Math.max(m.max, m.run + 1) }), { run: 0, max: 0 }).max;
  assert.ok(longest <= 8, 'more than 40 s between two refusals: ' + longest + ' ticks');
});

test('#9038: a check that says signed out, or cannot tell, stands over an old line', async () => {
  await ticks(3 * MIN);
  until = D2;
  await ticks(2 * MIN);
  assert.equal(refusals(await ticks(2 * MIN)), 0, 'CONTROL: the old line had stopped');
  for (const answer of [NONE, 'something else']) {
    live = answer;
    await ticks(MIN);
    const list = await ticks(5 * MIN);
    assert.equal(refusals(list), list.length, `a check answering ${answer} did not stand on every tick`);
  }
});

test('#9038: an account never checked HEALTHY is not cleared by its old line alone', async () => {
  live = NONE;
  await ticks(3 * MIN);
  until = D2;
  await ticks(2 * MIN);
  authprobe.resetForTest();   // nothing settled: UNCHECKED
  assert.equal((await tick()).refused, true, 'cleared with no HEALTHY ever seen');
});

const repaired = async () => {
  await ticks(3 * MIN);
  until = D2;
  await ticks(2 * MIN);
  assert.equal(refusals(await ticks(2 * MIN)), 0, 'CONTROL: the old line had stopped');
};
const stands = async (why) => assert.ok(refusals(await ticks(10 * MIN)) >= 10, why);

test('#9038: a refusal since the sign-in counts, on a screen that did not change by one character', async () => {
  await repaired();
  say(S1, asked(), refused());
  await stands('a refusal after the sign-in was taken as old');
});

test('#9038: nor is a turn under way, or an answer, or a row not yet whole, an old refusal', async () => {
  for (const more of [() => say(S1, asked()), () => say(S1, asked(), answered()), () => fs.appendFileSync(transcript(S1), '{"type":"user","mess'),
    () => fs.appendFileSync(transcript(S1), 'not json\n'), () => fs.rmSync(transcript(S1))]) {
    await repaired();
    more();
    await stands('cleared over: ' + more);
    until = D1; fs.rmSync(transcript(S1), { force: true }); say(S1, asked(), refused());
    loginlive._clearForTest(); authprobe.resetForTest();
  }
});

test('#9038: a /clear or a restart (another session, another process) is asked about itself', async () => {
  await repaired();
  session(S2);   // /clear: the same process, a new session with nothing in it yet
  await stands('the cleared session inherited the old one');
  say(S2, asked(), refused());
  await stands('its own new refusal was taken as old');
  proc = { pid: '4343', ccd: ROOT }; run = 'b2';   // a restart
  session(S1, '4343'); say(S1, asked(), refused());
  await stands('the restarted agent inherited it');
});

test('#9038: one look that could not read the screen changes nothing', async () => {
  await repaired();
  screen = null;
  await tick();
  screen = ONE;
  assert.equal(refusals(await ticks(10 * MIN)), 0, 'an unread screen brought the old line back');
});

test('#9038: a repaired agent whose screen shows the old line again after the board looked away stays calm', async () => {
  await repaired();
  up = false;
  await tick(10 * 60000);
  up = true;
  await ticks(2);   // the HEALTHY is ten minutes old: a first re-check settles
  assert.equal(refusals(await ticks(10 * MIN)), 0);
});

test('#9038: an agent with no run instance, or whose process reads another login or could not be read, is never cleared', async () => {
  for (const arm of [() => { run = ''; }, () => { proc = { pid: PID, ccd: '/Users/someone/.claude' }; }, () => { proc = { pid: PID, ccd: undefined }; },
    () => { proc = null; }, () => status.setPaneLoginReaderForTests(async () => { throw new Error('no'); })]) {
    loginlive._clearForTest(); authprobe.resetForTest();
    run = 'a1'; until = D1; status.setPaneLoginReaderForTests(async () => proc);
    arm();
    await ticks(3 * MIN);
    until = D2;
    await ticks(2 * MIN);
    await stands('cleared: ' + arm);
  }
});

test('#9038: the date is the one of the account the check probes, not another account\'s', async () => {
  const dates = { mine: D1, other: D1 };
  loginlive.setReaderForTests(async (ccd) => (ccd === ROOT ? dates.mine : dates.other));
  await ticks(3 * MIN);
  dates.other = D2;   // someone signs in to the default account
  await ticks(2 * MIN);
  await stands('another account\'s sign-in cleared it');
  dates.mine = D2;
  await ticks(2 * MIN);
  assert.equal(refusals(await ticks(5 * MIN)), 0, 'CONTROL: its own sign-in does');
});

test('#9038: the process is asked about once per run, one ask at a time, and once a minute while it cannot be told', async () => {
  let asks = 0;
  status.setPaneLoginReaderForTests(async () => { asks += 1; return proc; });
  await ticks(5 * MIN);
  assert.equal(asks, 1, 'known, and asked again');
  run = 'b2';
  await ticks(MIN);
  assert.equal(asks, 2, 'a new run was not asked about');
  proc = null; run = 'c3'; asks = 0;
  await ticks(5 * MIN);
  assert.ok(asks >= 4 && asks <= 6, 'asks while unknown, in five minutes: ' + asks);
  asks = 0; run = 'd4';
  status.setPaneLoginReaderForTests(() => { asks += 1; return new Promise(() => {}); });
  await ticks(5 * MIN);
  assert.equal(asks, 1, 'a second ask while one was open');
});

test('#9038: an error in it never reaches the tick, and the check\'s own answer stands', async () => {
  await repaired();
  const real = loginlive.signedInAfter;
  loginlive.signedInAfter = () => { throw new Error('no'); };
  try { await stands('an error cleared it'); } finally { loginlive.signedInAfter = real; }
});

test('#9038: another pane under the same name and run is asked about, and a read that failed is asked again', async () => {
  const targets = [];
  let fail = false;
  status.setPaneLoginReaderForTests(async (t) => { targets.push(t); if (fail) throw new Error('no'); return proc; });
  await ticks(2);
  pane = '0.1';
  await ticks(2);
  assert.equal(new Set(targets).size, 2, 'the second pane inherited the first one\'s process: ' + targets);
  fail = true; run = 'b2'; targets.length = 0;
  await ticks(3 * MIN);
  assert.ok(targets.length >= 3, 'a read that failed was never asked again');
});

test('#9038: the default account: its own bare login, and its own folder', async () => {
  job = { configDir: null };
  const home = os.homedir;
  os.homedir = () => SANDBOX;
  const def = path.join(SANDBOX, '.claude');
  try {
    fs.rmSync(def, { recursive: true, force: true });
    fs.renameSync(ROOT, def);
    proc = { pid: PID, ccd: undefined };
    await repaired();
    proc = { pid: PID, ccd: def }; run = 'b2';   // the same folder, another Keychain entry (#2129)
    await ticks(2);
    await stands('an explicit folder read as the bare login');
  } finally { os.homedir = home; fs.rmSync(def, { recursive: true, force: true }); }
});

test('#9038: a re-check that never settles does not stay calm', async () => {
  await repaired();
  authprobe.setChecker(() => new Promise(() => {}));
  await ticks(3 * MIN);
  const list = await ticks(5 * MIN);
  assert.equal(refusals(list), list.length, 'a hung check read healthy');
});

test('#9038: a login date that cannot be read, or moves earlier, leaves the board as it was', async () => {
  for (const [first, then] of [[null, D2], [D1, null], [D2, D1]]) {
    loginlive._clearForTest(); authprobe.resetForTest();
    until = first;
    await ticks(3 * MIN);
    until = then;
    await ticks(2 * MIN);
    assert.ok(refusals(await ticks(5 * MIN)) >= 5, `${first} then ${then} read as a new sign-in`);
  }
});

test('#9038: a refusal between the last read of the earlier date and the sign-in counts as new (it may be)', async () => {
  await ticks(3 * MIN + 6);
  say(S1, asked(), refused());   // after the last read of D1
  until = D2;
  await ticks(2 * MIN);
  await stands('a refusal that may follow the sign-in was taken as old');
});

test('#9038: a refusal at the very moment that read began is not before it', async () => {
  await ticks(1);
  fs.rmSync(transcript(S1)); say(S1, asked(), refused());   // at the tick whose read was the last of the earlier date
  until = D2;
  await ticks(2 * MIN);
  await stands('a refusal at that moment read as before it');
});

test('#9038: signedInAfter: the start of the last read of the earlier date; an unread date or an earlier one is no sign-in', async () => {
  const row = { isDefault: true };
  const read = async (at, date) => { until = date; loginlive.signedInAfter(row, at); await settle(); return loginlive.signedInAfter(row, at); };
  const step = loginlive.MISS_CACHE_MS + 1;
  assert.equal(loginlive.signedInAfter(row, 1000), null, 'it waited');
  assert.equal(await read(1000, D1), null);
  assert.equal(await read(1000 + step, D1), null, 'the same date');
  assert.equal(await read(1000 + 2 * step, null), null, 'an unread date');
  assert.equal(await read(1000 + 3 * step, D2), 1000 + step, 'the last read that gave the earlier date');
  assert.equal(await read(1000 + 4 * step, D1), 1000 + step, 'an earlier date is no sign-in');
  assert.equal(await read(1000 + 5 * step, D1 + 1), 1000 + 4 * step, 'later than the earlier one is');
  for (const none of [null, { apiKey: true, isDefault: true }, { isDefault: false, dir: '' }]) assert.equal(loginlive.signedInAfter(none, 1000), null);
});

test('#9038: an older read that finishes late changes nothing', async () => {
  const row = { isDefault: true };
  const open = [];
  loginlive.setReaderForTests(() => new Promise((r) => open.push(r)));
  loginlive.signedInAfter(row, 1000);
  loginexpiry.loginChanged();   // a sign-in through Kosmos: the next read does not join the first
  loginlive.signedInAfter(row, 2000);
  await settle();
  open[1](D1); await settle();
  open[0](D2); await settle();
  assert.equal(loginlive.signedInAfter(row, 2000), null, 'the late read was taken as a sign-in');
});

test('#9038: a clock set back: a sign-in read on it is never believed, not even once the clock has caught up', async () => {
  clock = T0 + 60 * 60000;   // an hour fast
  await repaired();
  clock -= 60 * 60000;       // put right
  await tick();
  say(S1, asked(), refused());   // revoked since; its time is before the sign-in the fast clock saw
  await ticks(70 * MIN);
  await stands('a refusal after the clock was set back read as old');
  until = D2 + DAY;          // and reading has started over: a sign-in on the right clock is seen
  await ticks(2 * MIN);
  assert.equal(refusals(await ticks(5 * MIN)), 0, 'CONTROL');
});

test('#9038: nor when the first thing asked on the right clock is a read', async () => {
  const row = { isDefault: true };
  const read = async (date) => { until = date; loginexpiry.loginChanged(); loginlive.signedInAfter(row, clock); await settle(); };
  clock = T0 + 60 * 60000;
  await read(D1);
  clock = T0;
  until = D2; loginexpiry.loginChanged();
  await loginlive.validUntil(row, clock);   // AI Models, not a tick
  clock = T0 + 61 * 60000;
  await read(D2);
  assert.equal(loginlive.signedInAfter(row, clock), null, 'a date from the fast clock was taken as the earlier one');
});

test('#9038: readPaneLogin: the pane\'s own process, its arguments apart from its environment', async () => {
  const bin = path.join(SANDBOX, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const put = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
  const saved = { PATH: process.env.PATH, TMUXBIN: process.env.AGENT_WORKFORCE_TMUX_BIN };
  process.env.PATH = bin + ':' + saved.PATH;
  process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(bin, 'tmux');
  put('tmux', '[ "$4" = "=worker:" ] && echo 777');
  put('ps', 'printf "claude -x"; [ "$1" = eww ] && printf " PATH=/bin CLAUDE_CONFIG_DIR=/u/$5"; echo');
  try {
    status.setPaneSource(null);
    assert.deepEqual(await status.readPaneLogin('=worker:'), { pid: '777', ccd: '/u/777' });
    assert.equal(await status.readPaneLogin('=other:'), null, 'no such pane');
    put('ps', 'exit 1');
    assert.equal(await status.readPaneLogin('=worker:'), null, 'ps refused');
    status.setPaneSource(() => '');
    put('ps', 'printf "claude -x"; [ "$1" = eww ] && printf " PATH=/bin"; echo');
    assert.equal(await status.readPaneLogin('=worker:'), null, 'an injected roster has no real pane');
  } finally {
    status.setPaneSource(null);
    process.env.PATH = saved.PATH;
    if (saved.TMUXBIN === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = saved.TMUXBIN;
  }
});

test('#9038: refusedAt: the session the process names, in this folder, once', () => {
  assert.equal(oldline.refusedAt({ pid: PID, ccd: ROOT }), T0);
  assert.equal(oldline.refusedAt({ pid: '1', ccd: ROOT }), null, 'no session file');
  session(S1, '77', '78');
  assert.equal(oldline.refusedAt({ pid: '77', ccd: ROOT }), null, 'a session file that names another process');
  session('../../../x', '79');
  fs.copyFileSync(transcript(S1), path.join(SANDBOX, 'x.jsonl'));
  assert.equal(oldline.refusedAt({ pid: '79', ccd: ROOT }), null, 'a session id that is a path');
  fs.mkdirSync(path.join(ROOT, 'projects', '-other'));
  fs.copyFileSync(transcript(S1), path.join(ROOT, 'projects', '-other', `${S1}.jsonl`));
  assert.equal(oldline.refusedAt({ pid: PID, ccd: ROOT }), null, 'the same session in two folders');
});

test('#9038: refusalAtEnd: only Claude Code\'s own sign-in refusal, as the last thing said', () => {
  const file = path.join(SANDBOX, 't.jsonl');
  const at = (...rows) => { fs.writeFileSync(file, rows.map((r) => JSON.stringify(r) + '\n').join('')); return oldline.refusalAtEnd(file); };
  assert.equal(at(asked(), refused()), clock, 'CONTROL');
  assert.equal(at(asked(), refused(), { type: 'system', subtype: 'turn_duration' }, { type: 'mode' }), clock, 'bookkeeping after it');
  assert.equal(at(refused(), asked()), null);
  assert.equal(at(refused(), { type: 'system', subtype: 'local_command' }), null, 'a command since');
  assert.equal(at({ ...refused(), error: 'rate_limit' }), null);
  assert.equal(at({ ...refused(), isApiErrorMessage: false }), null);
  assert.equal(at({ ...refused(), type: 'user' }), null);
  assert.equal(at({ ...refused(), timestamp: 'soon' }), null);
  assert.equal(at({ type: 'mode' }), null);
  assert.equal(oldline.refusalAtEnd(path.join(SANDBOX, 'none')), null);
  const big = { type: 'mode', pad: 'x'.repeat(oldline.TAIL_BYTES) };
  assert.equal(at(asked(), refused(), big), null, 'nothing said within the tail');
  assert.equal(at(big, asked(), refused()), clock, 'a cut first line is not a row');
});

test('#9038: loginOfPs: the environment only, never what an argument says, and no other credential', () => {
  const args = 'claude --model x';
  const env = (e) => oldline.loginOfPs(args + '\n', `${args} ${e}\n`);
  assert.deepEqual(env('PATH=/bin CLAUDE_CONFIG_DIR=/u/two HOME=/u'), { ccd: '/u/two' });
  assert.deepEqual(env('PATH=/bin HOME=/u'), { ccd: undefined });
  assert.equal(env(''), null, 'no environment shown');
  assert.equal(env('HOME=/u'), null, 'no PATH shown');
  assert.equal(env('PATH=/bin CLAUDE_CONFIG_DIR= HOME=/u'), null, 'set but empty');
  assert.equal(env('PATH=/bin CLAUDE_CONFIG_DIR=/a CLAUDE_CONFIG_DIR=/b'), null, 'two values');
  for (const k of ['MAX_THINKING_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_ENTRYPOINT']) {
    assert.deepEqual(env(`PATH=/bin ${k}=x HOME=/u`), { ccd: undefined }, 'CONTROL: not a credential: ' + k);
  }
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
    'CLAUDE_CODE_SESSION_ACCESS_TOKEN', 'CLAUDE_CODE_GATEWAY_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL',
    'ANTHROPIC_UNIX_SOCKET', 'ANTHROPIC_PROFILE', 'ANTHROPIC_IDENTITY_TOKEN_FILE']) {
    assert.equal(env(`PATH=/bin ${k}=x HOME=/u`), null, k);
  }
  const said = 'claude use PATH=/x and CLAUDE_CONFIG_DIR=/u/two';
  assert.equal(oldline.loginOfPs(said, said), null, 'an argument read as environment');
  assert.deepEqual(oldline.loginOfPs(said, said + ' PATH=/bin'), { ccd: undefined });
  for (const none of [[null, null], ['', 'claude PATH=/bin'], ['claude', 'another PATH=/bin']]) assert.equal(oldline.loginOfPs(...none), null);
});

test('#9038: lastSettledHealthy is the last settled answer, for one re-check past its age', async () => {
  assert.equal(authprobe.lastSettledHealthy(null), false);
  authprobe.verdict(null, clock); await settle();
  assert.equal(authprobe.verdict(null, clock), HEALTHY);
  clock += authprobe.TTL_MS + 1;
  assert.equal(authprobe.verdict(null, clock), UNCHECKED, 'CONTROL: the verdict itself still goes stale');
  assert.equal(authprobe.lastSettledHealthy(null, clock), true);
  clock += authprobe.RECHECK_MS;
  assert.equal(authprobe.lastSettledHealthy(null, clock), false, 'a HEALTHY of any age counted');
  live = NONE; await settle(); clock += authprobe.TTL_MS + 1;
  authprobe.verdict(null, clock); await settle();
  assert.equal(authprobe.lastSettledHealthy(null), false);
});

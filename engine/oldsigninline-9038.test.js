'use strict';
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
const TWO = screenOf('> do the thing', LINE, '', '> and again', LINE);

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
let service = null;   // the login the agent's process reads

test.beforeEach(() => {
  clock = T0; screen = ONE; live = CONNECTED; until = D1; job = { configDir: null }; run = 'a1'; up = true; service = loginexpiry.DEFAULT_SERVICE;
  status.setPaneLoginReaderForTests(async () => service);
  Date.now = () => clock;
  create.readJob = () => job;
  authprobe.resetForTest();
  authprobe.setChecker(async () => ({ state: live }));
  loginlive._clearForTest();
  loginlive.setReaderForTests(async () => until);
  observed._clearForTest();
  oldline._clearForTest();
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
  status.setPaneSource(() => !up ? '' : fleet.line({ session: 'worker-discord', command: fleet.CLAUDE_COMMAND, tokenInstance: run }));
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

test('#9038: a refusal printed again after the sign-in is a new line, refused again', async () => {
  await ticks(3 * MIN);
  until = D2;
  await ticks(2 * MIN);
  assert.equal(refusals(await ticks(2 * MIN)), 0, 'CONTROL: the old line had stopped');
  screen = TWO;   // the same sentence, under a new prompt
  assert.ok(refusals(await ticks(10 * MIN)) >= 10, 'a refusal printed after the sign-in was taken as old');
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
  assert.equal(authprobe.lastSettledHealthy(null), false);
  assert.equal((await tick()).refused, true, 'cleared with no HEALTHY ever seen');
});

test('#9038: a login date that cannot be read, or moves earlier, leaves the board as it was', async () => {
  for (const [first, then] of [[null, D2], [D1, null], [D2, D1]]) {
    loginlive._clearForTest(); oldline._clearForTest(); authprobe.resetForTest();
    until = first;
    await ticks(3 * MIN);
    until = then;
    await ticks(2 * MIN);
    assert.ok(refusals(await ticks(5 * MIN)) >= 5, `${first} then ${then} read as a new sign-in`);
  }
});

const WORKING = fleet.SCREEN.working;
const repaired = async () => {
  await ticks(3 * MIN);
  until = D2;
  await ticks(2 * MIN);
  assert.equal(refusals(await ticks(2 * MIN)), 0, 'CONTROL: the old line had stopped');
};
const revokedAgain = async (why) => assert.ok(refusals(await ticks(10 * MIN)) >= 10, why);

test('#9038: a line that left the screen and came back the same is a new refusal', async () => {
  await repaired();
  screen = WORKING;
  await tick();
  screen = ONE;   // revoked since: the same prompt, the same sentence
  await revokedAgain('a refusal after a working turn was taken as old');
});

test('#9038: nor when the sign-in happened while the line was off the screen', async () => {
  await ticks(3 * MIN);
  screen = WORKING;
  await tick();
  until = D2;
  await ticks(3 * MIN);
  screen = ONE;
  await revokedAgain('the first date outlived the line');
});

test('#9038: a restart that prints the same screen again inside one tick is a new refusal', async () => {
  await repaired();
  run = 'b2';
  await revokedAgain('another run inherited the old line');
});

test('#9038: no run instance on the session: never old', async () => {
  run = '';
  await ticks(3 * MIN);
  until = D2;
  await ticks(2 * MIN);
  await revokedAgain('cleared with no run known');
});

test('#9038: an agent gone from the pass for longer than the gap starts over', async () => {
  await repaired();
  up = false;
  await tick(oldline.GAP_MS + 1000);
  up = true;
  await revokedAgain('an entry survived the gap');
});

test('#9038: an agent whose process reads another login, or one that could not be read, is never cleared', async () => {
  for (const read of [loginexpiry.serviceNameFor('/Users/someone/.claude'), null, new Error('no')]) {
    loginlive._clearForTest(); oldline._clearForTest(); authprobe.resetForTest();
    until = D1;
    status.setPaneLoginReaderForTests(async () => { if (read instanceof Error) throw read; return read; });
    await ticks(3 * MIN);
    until = D2;
    await ticks(2 * MIN);
    await revokedAgain(`cleared over ${read}`);
  }
});

test('#9038: an agent on its own account folder is cleared by that account\'s own sign-in', async () => {
  const dir = path.join(SANDBOX, '.claude-two');
  job = { configDir: dir };
  service = loginexpiry.serviceNameFor(dir);
  const asked = new Set();
  loginlive.setReaderForTests(async (ccd) => { asked.add(ccd); return until; });
  await repaired();
  assert.deepEqual([...asked], [dir], 'the date was read for another account');
});

test('#9038: a re-check that never settles does not stay calm', async () => {
  await repaired();
  authprobe.setChecker(() => new Promise(() => {}));
  await ticks(3 * MIN);
  const list = await ticks(5 * MIN);
  assert.equal(refusals(list), list.length, 'a hung check read healthy');
});

test('#9038: an identical exchange repeated on the screen is never old, however the sign-in went', async () => {
  const same = [];
  for (let i = 0; i < 5; i++) same.push('> nudge', '', LINE, '');
  screen = screenOf(...same);
  await ticks(3 * MIN);
  until = D2;
  await ticks(2 * MIN);
  await revokedAgain('a screen of identical refusals was taken as old');
});

/* One call straight to the module; reads are answered by the next microtasks. */
const base = { run: 'r', service: 's', reads: async () => 's', text: ONE, date: { at: 0, until: D1 }, now: 0 };
const ask = async (o) => { const got = oldline.isOld('a', { ...base, ...o }); await settle(); return got; };

test('#9038: the first date counts only when it was read after the line was first seen', async () => {
  await ask({ now: 100, date: { at: 50, until: D1 } });
  assert.equal(await ask({ now: 110, date: { at: 50, until: D1 } }), false);
  /* A sign-in between that read and the line: the line is newer than it, and must not read old. */
  assert.equal(await ask({ now: 170, date: { at: 160, until: D2 } }), false, 'a date from before the line was taken as its first');
  assert.equal(await ask({ now: 230, date: { at: 220, until: D2 } }), false);
  assert.equal(await ask({ now: 290, date: { at: 280, until: D2 + DAY } }), true, 'CONTROL: a later sign-in makes it old');
});

test('#9038: once old it stays old through an unread date; another login, run or line, a gap, or a forget starts over', async () => {
  const make = async () => { oldline._clearForTest(); await ask({}); await ask({}); return ask({ date: { at: 9, until: D2 } }); };
  const later = { date: { at: 9, until: D2 } };
  assert.equal(await make(), true, 'CONTROL');
  assert.equal(await ask({ date: null }), true, 'one unread date brought it back');
  assert.equal(await ask({ date: { at: 10, until: D1 } }), true, 'an earlier date read since brought it back');
  for (const [what, o] of [['login', { service: 't' }], ['run', { run: 'q' }], ['line', { text: TWO }], ['gap', { now: oldline.GAP_MS + 1 }]]) {
    assert.equal(await make(), true);
    assert.equal(await ask({ ...later, ...o }), false, `another ${what} inherited it`);
  }
  for (const [what, o] of [['no line', { text: screenOf('> hi', 'Done.') }], ['no run', { run: '' }]]) {
    assert.equal(await make(), true);
    assert.equal(await ask({ ...later, ...o }), false, what);
    assert.equal(await ask(later), false, `inherited across ${what}`);
  }
  assert.equal(await make(), true);
  oldline.forget('a');
  assert.equal(await ask(later), false, 'forget kept it');
});

test('#9038: an unread first date is not taken as the first', async () => {
  for (const unread of [null, NaN, undefined]) {
    oldline._clearForTest();
    await ask({}); await ask({ date: { at: 1, until: unread } }); await ask({ date: { at: 2, until: D1 } });
    assert.equal(await ask({ date: { at: 3, until: D2 } }), true, String(unread));
  }
});

test('#9038: agents do not share a line', async () => {
  await ask({}); await ask({}); assert.equal(await ask({ date: { at: 9, until: D2 } }), true);
  assert.equal(oldline.isOld('b', { ...base, date: { at: 9, until: D2 } }), false);
});

test('#9038: the login a process reads: its CLAUDE_CONFIG_DIR, the default when unset, unknown when ps shows no environment', () => {
  const head = '  PID   TT  STAT      TIME COMMAND\n 123 s001  S+  0:01 claude --model x';
  assert.equal(status.loginServiceOfPs(head + ' PATH=/bin CLAUDE_CONFIG_DIR=/u/two HOME=/u'), loginexpiry.serviceNameFor('/u/two'));
  assert.equal(status.loginServiceOfPs(head + ' PATH=/bin HOME=/u'), loginexpiry.DEFAULT_SERVICE);
  assert.equal(status.loginServiceOfPs(head), null);
});

test('#9038: the fingerprint: steady under what comes after the line, changed by a second refusal, null with none', () => {
  assert.equal(oldline.fingerprint(ONE), oldline.fingerprint(ONE.replace('❯ ', '❯ half a draft')), 'the composer moved it');
  assert.notEqual(oldline.fingerprint(ONE), oldline.fingerprint(TWO));
  /* Two identical exchanges, more rows apart than the context: only the count tells them apart. */
  const pad = Array.from({ length: oldline.CONTEXT_ROWS + 2 }, (_, i) => 'row ' + i);
  const once = screenOf(...pad, '> go', LINE);
  const twice = screenOf(...pad, '> go', LINE, ...pad, '> go', LINE);
  assert.notEqual(oldline.fingerprint(once), null, 'CONTROL');
  assert.equal(oldline.fingerprint(twice), null, 'a block that stands twice could be a later copy of itself');
  assert.notEqual(oldline.fingerprint(once), oldline.fingerprint(screenOf(LINE, ...pad, '> go', LINE)), 'the count is not in it');
  /* An old line scrolled off as a new one was printed: the count is the same, the prompt above it is not. */
  assert.notEqual(oldline.fingerprint(ONE), oldline.fingerprint(screenOf('> a later thing', LINE)), 'the rows above are not in it');
  assert.equal(oldline.fingerprint(ONE), oldline.fingerprint(ONE.replace(LINE, LINE + '   ')), 'trailing blanks moved it');
  const envelope = 'API Error: 401 {"type":"error","error":{"type":"authentication' + '_error"}}';
  assert.notEqual(oldline.fingerprint(screenOf('> hi', envelope)), null, 'the JSON form is not seen');
  for (const none of ['', null, undefined, 'all good\n']) assert.equal(oldline.fingerprint(none), null);
});

test('#9038: lastRead never waits, reads again when old, and drops an answer from before a sign-in', async () => {
  const row = { isDefault: true };
  assert.equal(loginlive.lastRead(row, clock), null, 'nothing read yet');
  await settle();
  assert.deepEqual(loginlive.lastRead(row, clock + 1000), { at: T0, until: D1 }, 'at is when the read began, not when it was asked for');
  for (const none of [null, { apiKey: true, isDefault: true }, { isDefault: false, dir: '' }]) assert.equal(loginlive.lastRead(none, clock), null);
  until = D2;
  const later = clock + loginlive.CACHE_MS + 1;
  assert.equal(loginlive.lastRead(row, later).until, D1, 'the last answer while the next is read');
  await settle();
  assert.deepEqual(loginlive.lastRead(row, later), { at: later, until: D2 });
  loginexpiry.loginChanged();
  assert.equal(loginlive.lastRead(row, later), null, 'an answer from before a sign-in was kept');
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

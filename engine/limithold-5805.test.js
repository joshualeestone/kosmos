'use strict';

/**
 * #5805 slice 1: a Claude agent paused on a usage limit whose screen names a DATED reset still ahead is not typed into
 * by a timer or a colleague. chat.deliverAutomatic(Async) returns the #4588 hold shape with heldBy 'limit' and
 * heldUntil the reset, so every automatic sender keeps its try, and after the reset while the card still reads capped
 * (its limit menu on screen). A room post held this way keeps its mark, its reset is recorded beside the held file,
 * and roomhold.flushReleased tells a project's surviving asks once the member's card reads idle again. A limit line
 * with no date (the 5-hour form) is typed as before, and a person's own message is never held here.
 *
 * Cards come from test-support/fleet with real limit screens (the shape status.test.js pins for #5029); every "was it
 * typed" assertion reads the scripted tmux runner's recorded pastes.
 *
 *   node --test engine/limithold-5805.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-limithold-5805-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const status = require('./status');
const roomhold = require('./roomhold');
const store = require('./store');
const fleet = require('../test-support/fleet');
const selfreport = require('./selfreport');

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

/* The month and day of `ms` in America/Chicago, as Claude Code prints a dated reset ("Oct 5"). */
function chicagoDay(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day}`;
}
/* "Oct 5 at 2:35pm" for `ms` in America/Chicago, the dated reset Claude Code prints, to the minute. */
function resetAt(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day} at ${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`;
}
/* "4:35pm" for `ms` in America/Chicago: a dateless reset as Claude Code prints it (slice 3b). */
function clockAt(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`;
}
const RULE = '─'.repeat(80) + '\n';
const STATUS_LINE = RULE + '❯ \n' + RULE + '  casey · Opus 4.8 · 7d 100%\n' + '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents\n';
const limitScreen = (resets) => '> hello\n'
  + `  ⎿  You've hit your weekly limit · resets ${resets} (America/Chicago)\n`
  + '✻ Sautéed for 0s · done 10:35 PM\n' + STATUS_LINE;
const DAY = 24 * 3600 * 1000;
const AHEAD = () => limitScreen(`${chicagoDay(Date.now() + 3 * DAY)} at 3pm`);
const PAST = () => limitScreen(`${chicagoDay(Date.now() - 3 * DAY)} at 3pm`);
const DATELESS = () => limitScreen('3pm');

function fakeTmux(screen) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen || '', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  };
  fn.typed = () => calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys');
  fn.pastedTo = (session) => {
    const out = [];
    let cur = '', target = null, has = false;
    for (const a of calls) {
      if (a[0] === 'set-buffer') { cur += a[a.length - 1]; has = true; }
      else if (a[0] === 'paste-buffer') target = a[a.length - 1];
      else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && has) { out.push({ text: cur, target }); cur = ''; target = null; has = false; }
    }
    return out.filter((s) => String(s.target || '').startsWith('=' + session)).map((s) => s.text);
  };
  return fn;
}
function arm(screen) {
  const t = fakeTmux(screen);
  chat.setRunner(t);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return t;
}
async function onScreen(screen, fn, state = 'rate_limited') {
  const board = fleet.install([fleet.agent('casey', { state, runner: 'claude', command: 'claude', screen })]);
  try { return await fn(board, arm(screen)); } finally { chat.resetForTests(); board.restore(); }
}

test.beforeEach(() => {
  status.resetLimitFirstSeenForTests();   // slice 3b: first-seen times are per test
  chat.resetForTests();
  messages.resetForTests();
  for (const d of [messages.LOG, roomhold.dir(), selfreport.DIR]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#5805 a dated reset ahead: a timer\'s line is HELD until the reset, sync and async, with nothing typed', async () => {
  await onScreen(AHEAD(), async (board, tmux) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.RATE_LIMITED, 'the fixture is not a capped card: ' + card.state);
    const want = new Date(status.limitResetAt(card.stateEvidence, Date.now())).toISOString();
    for (const v of [chat.deliverAutomatic('casey', 'A colleague line.', board.agents), await chat.deliverAutomaticAsync('casey', 'A colleague line.', board.agents)]) {
      assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
      assert.equal(v.held, true);
      assert.equal(v.heldBy, 'limit');
      assert.equal(v.heldUntil, want);
      assert.match(v.because, /paused on a usage limit until/);
    }
    assert.deepEqual(tmux.typed(), [], 'a held line was typed');
  });
});

test('#5805 not held: a dateless line the board saw too late to read, a reset already past, and a person\'s own message', async () => {
  /* Slice 3b: a dateless line is held on its first-seen reset (limitretire-5805.test.js). One the board cannot read a
     reset for is typed as before: a session limit printing a time more than five hours on (the board saw it late). */
  const late = '> hello\n' + `  ⎿  You've hit your session limit · resets ${clockAt(Date.now() + 6 * 3600e3)} (America/Chicago)\n`
    + '✻ Sautéed for 0s · done 10:35 PM\n' + STATUS_LINE;
  // kosmos#7264: a session limit cannot reset more than its span after it printed, and this line was on screen before
  // the board saw it, so a reset six hours on can only be yesterday's: the line is retired and the card reads idle
  // (before #7264 it read capped for good). Either way nothing is held.
  await onScreen(late, async (board, tmux) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.IDLE, 'a late session line whose reset can only have passed still reads capped');
    assert.equal(card.limitUntil, null, 'CONTROL: no reset read for it');
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.ok(tmux.typed().length > 0, 'a dateless line with no reset read held a timer\'s line');
  }, 'idle');
  // A reset already past: status retires the line, so the card reads idle again and the line is typed.
  await onScreen(PAST(), async (board, tmux) => {
    assert.equal(board.agents.find((c) => c.sessionName === 'casey').state, status.STATE.IDLE, 'the screen did not read idle once its reset passed');
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.ok(tmux.typed().length > 0, 'a past reset held a timer\'s line');
  }, 'idle');   // fleet.install checks the engine read this screen as idle
  await onScreen(AHEAD(), async (board) => {
    const v = await chat.deliverAsync('casey', 'From the person.', board.agents);
    assert.notEqual(v.held, true, 'a person\'s message was held: ' + JSON.stringify(v));
  });
});

test('#5805 a passed dated reset on a card that still reads capped (its limit menu on screen) is held, looking again in a minute', async () => {
  await onScreen(AHEAD(), async (board, tmux) => {
    const past = `You've hit your weekly limit · resets ${resetAt(Date.now() - 15 * 60e3)} (America/Chicago)`;
    const r = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, state: status.STATE.RATE_LIMITED, stateEvidence: past } : c));
    const before = Date.now();
    const v = chat.deliverAutomatic('casey', 'A colleague line.', r);
    assert.equal(v.held, true, JSON.stringify(v));
    assert.equal(v.heldBy, 'limit');
    assert.match(v.because, /still shows its usage limit on screen/);
    const until = Date.parse(v.heldUntil);
    assert.ok(until >= before + 50e3 && until <= Date.now() + 70e3, 'not a minute on: ' + v.heldUntil);
    assert.equal(Date.parse(v.limitReset), status.limitResetAt(past, Date.now()), 'limitReset is not the printed reset');
    assert.deepEqual(tmux.typed(), []);
    // More than an hour past the reset, a card still reading capped (a line status never retires) is typed as before.
    const long = (h) => board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, state: status.STATE.RATE_LIMITED, stateEvidence: `You've reached your weekly limit · resets ${resetAt(Date.now() - h * 3600e3)} (America/Chicago)` } : c));
    assert.equal(chat.limitHeldVerdict('casey', long(30)), null, 'held thirty hours after its reset');
    assert.notEqual(chat.limitHeldVerdict('casey', long(0.25)), null, 'CONTROL: fifteen minutes after its reset is still held');
  });
});

test('#5805 only a Claude card: a capped card of another runner is not held by the limit gate', async () => {
  await onScreen(AHEAD(), async (board) => {
    const codex = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, runner: 'codex' } : c));
    assert.equal(chat.limitHeldVerdict('casey', codex), null);
    assert.notEqual(chat.limitHeldVerdict('casey', board.agents), null, 'CONTROL: the Claude card is held');
  });
});

/* leo posts; april is a Claude member whose card is capped (a dated reset ahead) or idle again. */
const PROJECT = 'henderson-lease';
const MEMBERS = ['leo', 'april'];
function roomRoster(board, capped) {
  return board.agents.map((c) => {
    if (c.sessionName !== 'april') return { ...c };
    return capped
      ? { ...c, state: status.STATE.RATE_LIMITED, stateEvidence: `You've hit your weekly limit · resets ${chicagoDay(Date.now() + 3 * DAY)} at 3pm (America/Chicago)` }
      : { ...c, state: 'idle', stateEvidence: null };
  });
}
function flushDeps(r, extra = {}) {
  return {
    isAgy: (c) => c.runner === 'antigravity', isLimitable: chat.limitReleased,
    readReport: () => null, now: Date.now(), decayMs: status.REPORT_WORKING_DECAY_MS,
    deliver: chat.deliverAutomaticAsync, DELIVERY: chat.DELIVERY, roster: r,
    shownOf: () => 'Henderson lease', stale: (p, ids, who2) => messages.staleHeld(p, ids, undefined, undefined, who2), ...extra,
  };
}

test('#5805 room: a post naming a capped Claude member is held (its "names you" mark kept), not retried while capped or without the predicate, told once when idle', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    let tmux = arm('');
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@april please' }, roomRoster(board, true), MEMBERS);
    assert.deepEqual(tmux.pastedTo('april'), [], 'typed into a capped member');
    assert.deepEqual(roomhold.heldIn('april', PROJECT), [roomhold.addressedId(sent.id)], 'not kept as addressed');
    assert.equal(roomhold.limitKept('april', PROJECT, sent.id), true, 'the limit hold was not recorded for withoutStale');

    tmux = arm('');
    const still = roomRoster(board, true);
    assert.deepEqual(await roomhold.flushReleased(still, flushDeps(still)), [], 'retried while still capped');
    assert.deepEqual(tmux.pastedTo('april'), []);

    // CONTROL: without the Claude predicate (the old server), the retry never looks at her.
    const idle = roomRoster(board, false);
    assert.deepEqual(await roomhold.flushReleased(idle, flushDeps(idle, { isLimitable: undefined })), []);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), [roomhold.addressedId(sent.id)]);

    tmux = arm('');
    const done = await roomhold.flushReleased(idle, flushDeps(idle));
    assert.deepEqual(done.map((d) => [d.name, d.state]), [['april', chat.DELIVERY.PLACED]]);
    const told = tmux.pastedTo('april');
    assert.equal(told.length, 1, 'not told exactly once');
    assert.match(told[0], new RegExp('names you and asks for your answer \\(' + sent.id + '\\)'));
    assert.doesNotMatch(told[0], /Nothing is asked of you/);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), []);
    tmux = arm('');
    assert.deepEqual(await roomhold.flushReleased(idle, flushDeps(idle)), [], 'told twice');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5805 room CONTROL: a post that does not name an idle Claude member waits for its next wake, limit-held or not', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm('');
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'an update for the room' }, roomRoster(board, true), MEMBERS);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), [sent.id], 'a plain post took a mark');
    roomhold.hold('april', PROJECT, 'plain-post-1');
    const tmux = arm('');
    const idle = roomRoster(board, false);
    assert.deepEqual(await roomhold.flushReleased(idle, flushDeps(idle)), []);
    assert.deepEqual(tmux.pastedTo('april'), []);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5805 withoutStale: an ask a usage limit kept is not dropped as a day old until a day after the reset; answered or past its grace, it is', () => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const post = { kind: 'post', id: 'm1', project: PROJECT, from: 'leo', text: '@april please', at: iso(now - 3 * DAY) };
  const judge = (log) => (p, ids, who) => messages.staleHeld(p, ids, log, now, who);
  const ids = [roomhold.addressedId('m1')];
  // CONTROL: no limit recorded: a three-day-old ask is dropped, as #4926 R2 decided.
  assert.deepEqual(roomhold.withoutStale(PROJECT, ids, judge([post]), 'april'), []);
  roomhold.noteLimit('april', PROJECT, ['m1'], iso(now - 3600e3), now);
  assert.deepEqual(roomhold.withoutStale(PROJECT, ids, judge([post]), 'april'), ids, 'a limit-held ask, reset an hour ago, was dropped');
  assert.deepEqual(roomhold.withoutStale(PROJECT, ids, judge([post]), 'mara'), [], 'april\'s limit kept mara\'s ask');
  // Answered in the room: dropped even though the limit kept it.
  const reply = { kind: 'post', id: 'm2', project: PROJECT, from: 'april', replyTo: 'm1', text: 'done', at: iso(now - 600e3) };
  assert.deepEqual(roomhold.withoutStale(PROJECT, ids, judge([post, reply]), 'april'), []);
  // A plain (unaddressed) limit-held post is not kept back: it asks nothing.
  assert.deepEqual(roomhold.withoutStale(PROJECT, ['m1'], judge([post]), 'april'), []);
  // A day after the reset the grace is over.
  roomhold.forget('april');
  roomhold.noteLimit('april', PROJECT, ['m1'], iso(now - 25 * 3600e3), now - 25 * 3600e3 + 1);
  assert.deepEqual(roomhold.withoutStale(PROJECT, ids, judge([post]), 'april'), []);
});

test('#5805 flush: a #4624 hold the limit holds at the idle flush keeps its marks and records the reset', async () => {
  roomhold.hold('april', PROJECT, roomhold.addressedId('m9'));
  /* A re-look after the reset: heldUntil is a minute on, the reset was 50 minutes ago. The day counts from the reset. */
  const now = Date.now();
  const held = async () => ({ state: chat.DELIVERY.COULD_NOT, held: true, heldBy: 'limit', heldUntil: new Date(now + 60e3).toISOString(), limitReset: new Date(now - 50 * 60e3).toISOString(), because: 'held: limit' });
  const done = await roomhold.flushOnIdle('april', { deliver: held, roster: [], shownOf: () => 'Henderson lease', DELIVERY: chat.DELIVERY });
  assert.equal(done[0].state, chat.DELIVERY.COULD_NOT);
  assert.deepEqual(roomhold.heldIn('april', PROJECT), [roomhold.addressedId('m9')], 'the mark was lost on the put-back');
  assert.equal(roomhold.limitKept('april', PROJECT, 'm9'), true, 'the flush did not record the limit');
  assert.equal(roomhold.limitKept('april', PROJECT, 'm9', now + DAY - 40 * 60e3), false, 'the day counted from the next look, not the reset');
});

test('#5805 retry: only a project whose ask survives is told; a project holding only plain posts waits untouched', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    roomhold.hold('april', PROJECT, roomhold.addressedId('m51'));
    roomhold.noteLimit('april', PROJECT, ['m51'], new Date(Date.now() - 600e3).toISOString());
    roomhold.hold('april', 'other-room', 'm52');
    const tmux = arm('');
    const idle = roomRoster(board, false);
    const done = await roomhold.flushReleased(idle, flushDeps(idle, { stale: undefined }));
    assert.deepEqual(done.map((d) => [d.name, d.projectId]), [['april', PROJECT]]);
    assert.equal(tmux.pastedTo('april').length, 1);
    assert.deepEqual(roomhold.heldIn('april', 'other-room'), ['m52'], 'the plain-only project was told or lost');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5805 noteLimit: a later reset wins, entries a day past their reset are pruned, forgetProject clears its room', () => {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  roomhold.noteLimit('april', PROJECT, ['m1'], iso(now + 3600e3), now);
  roomhold.noteLimit('april', PROJECT, ['m1'], iso(now - 3600e3), now);   // an earlier reset does not shorten it
  assert.equal(roomhold.limitKept('april', PROJECT, 'm1', now + 24 * 3600e3 + 1800e3), true, 'the earlier reset replaced the later');
  roomhold.noteLimit('april', 'old-room', ['m7'], iso(now - 26 * 3600e3), now - 26 * 3600e3);
  roomhold.noteLimit('april', PROJECT, ['m2'], iso(now + 60e3), now);      // this write prunes old-room
  assert.equal(roomhold.limitKept('april', 'old-room', 'm7', now), false);
  roomhold.forgetProject('april', PROJECT);
  assert.equal(roomhold.limitKept('april', PROJECT, 'm1', now), false, 'forgetProject kept the left room\'s asks back');
});

test('#5805 server.js wires the Claude retry with the hold\'s own test', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('roomhold.flushReleased(r, {');
  assert.notEqual(at, -1);
  assert.match(src.slice(at, at + 1200), /isLimitable: chat\.limitReleased,/);
});

test('#5805 retry CONTROL: an ask held for any other reason (no limit record) does not wake an idle Claude member', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    roomhold.hold('april', PROJECT, roomhold.addressedId('m61'));
    const tmux = arm('');
    const idle = roomRoster(board, false);
    assert.deepEqual(await roomhold.flushReleased(idle, flushDeps(idle, { stale: undefined })), []);
    assert.deepEqual(tmux.pastedTo('april'), []);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), [roomhold.addressedId('m61')]);
  } finally { chat.resetForTests(); board.restore(); }
});

/* Review 5: Claude Code's StopFailure hook reports the limit as an automatic blocked "provider api (rate_limit)"
   (kosmos-report-hook.js). Each card below is the real one: the report through selfreport.record, the screen through
   the real snapshot. */
const LIMIT_REPORT = { state: 'blocked', auto: true, on: 'provider api (rate_limit)', owner: 'provider', because: '' };
async function withReport(entry, screen, fn) {
  const board0 = fleet.install([fleet.agent('casey', { state: null, runner: 'claude', command: 'claude', screen })]);
  const name = board0.agents.find((c) => c.sessionName === 'casey').name;
  board0.restore();
  const rec = selfreport.record(name, entry);
  assert.equal(rec.recorded, true, JSON.stringify(rec));
  return onScreen(screen, fn, null);   // the state is the report's and the screen's; each test asserts it
}

test('#5805 review 5: the fresh StopFailure limit report does not outrank the limit screen, so the hold applies at once', async () => {
  await withReport(LIMIT_REPORT, AHEAD(), async (board, tmux) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.RATE_LIMITED, 'the fresh auto blocked won over the dated limit line: ' + card.state);
    assert.notEqual(status.limitResetAt(card.stateEvidence, Date.now()), null, 'the dated line was lost');
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.equal(v.heldBy, 'limit', JSON.stringify(v));
    assert.deepEqual(tmux.typed(), []);
  });
  // CONTROL: a blocked the agent itself reported still wins over the screen (#966), so the test can see the difference.
  await withReport({ ...LIMIT_REPORT, auto: false, because: 'waiting on the deploy' }, AHEAD(), async (board) => {
    assert.equal(board.agents.find((c) => c.sessionName === 'casey').state, status.STATE.BLOCKED);
  });
});

test('#5805 review 5 BLOCKER: after the reset the card reads blocked under the StopFailure report, and is released once its screen reads idle', async () => {
  await withReport(LIMIT_REPORT, PAST(), async (board) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.BLOCKED, 'CONTROL: the standing report no longer leaves the card blocked: ' + card.state);
    assert.equal(card.screenState, status.STATE.IDLE);
    assert.equal(chat.limitReleased(card), true, 'the hold never releases');
  });
  // Not released while the screen still shows the limit, nor for a blocked the agent reported, nor another runner.
  await withReport(LIMIT_REPORT, AHEAD(), async (board) => {
    assert.equal(chat.limitReleased(board.agents.find((c) => c.sessionName === 'casey')), false);
  });
  await withReport({ ...LIMIT_REPORT, auto: false, because: 'waiting on the deploy' }, PAST(), async (board) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.BLOCKED);
    assert.equal(card.screenState, null);
    assert.equal(chat.limitReleased(card), false, 'released an agent that said it is blocked');
  });
  await withReport(LIMIT_REPORT, PAST(), async (board) => {
    assert.equal(chat.limitReleased({ ...board.agents.find((c) => c.sessionName === 'casey'), runner: 'codex' }), false);
  });
});

test('#5805 review 5: past the hour cap, the hold stays while the limit menu is on screen', async () => {
  const MENU = PAST().replace('✻ Sautéed', '   What do you want to do?\n   ❯ 1. Stop and wait for limit to reset\n✻ Sautéed');
  for (const [screen, held] of [[MENU, true], [PAST(), false]]) {
    await onScreen(screen, async (board) => {
      const r = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, state: status.STATE.RATE_LIMITED, stateEvidence: `You've hit your weekly limit · resets ${resetAt(Date.now() - 30 * 3600e3)} (America/Chicago)` } : c));
      assert.equal(chat.limitHeldVerdict('casey', r) !== null, held, held ? 'typed into the limit menu past the cap' : 'CONTROL: held past the cap with no menu');
    }, null);   // the card is pinned to capped below; only the screen differs
  }
});

test('#5805 review 11: the sweep does not record an ask already a day old (the day rule is kept), and records a fresh one', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    const now = Date.now();
    const log = [
      { kind: 'post', id: 'm91', project: PROJECT, from: 'leo', text: '@april old', at: new Date(now - 3 * DAY).toISOString() },
      { kind: 'post', id: 'm92', project: PROJECT, from: 'leo', text: '@april new', at: new Date(now - 600e3).toISOString() },
    ];
    roomhold.hold('april', PROJECT, roomhold.addressedId('m91'));
    roomhold.hold('april', PROJECT, roomhold.addressedId('m92'));
    arm('');
    const capped = roomRoster(board, true);
    const stale = (p, ids, who) => messages.staleHeld(p, ids, log, now, who);
    assert.deepEqual(await roomhold.flushReleased(capped, flushDeps(capped, { stale })), []);
    assert.equal(roomhold.limitKept('april', PROJECT, 'm91'), false, 'a three-day-old ask was revived by the limit record');
    assert.equal(roomhold.limitKept('april', PROJECT, 'm92'), true, 'CONTROL: a fresh ask was not recorded');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5805 review 7: an ask held before the limit (no arrival during it) is recorded while capped, then told once idle', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    // Held while april worked (#4624); her turn then failed on the limit, so no idle flush ran for them.
    roomhold.hold('april', PROJECT, roomhold.addressedId('m81'));
    roomhold.hold('april', PROJECT, 'm82');
    let tmux = arm('');
    const capped = roomRoster(board, true);
    assert.deepEqual(await roomhold.flushReleased(capped, flushDeps(capped, { stale: undefined })), [], 'told while capped');
    assert.deepEqual(tmux.typed(), []);
    assert.equal(roomhold.limitKept('april', PROJECT, 'm81'), true, 'the earlier ask got no limit record');
    assert.equal(roomhold.limitKept('april', PROJECT, 'm82'), false, 'a plain post was recorded');
    tmux = arm('');
    const idle = roomRoster(board, false);
    const done = await roomhold.flushReleased(idle, flushDeps(idle, { stale: undefined }));
    assert.deepEqual(done.map((d) => [d.name, d.projectId]), [['april', PROJECT]]);
    assert.equal(tmux.pastedTo('april').length, 1);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5805 review 9: the restart pickup ({ cap: false }) is held by the limit, as by the shared quota; only the Gemini cap lets it through', async () => {
  await onScreen(AHEAD(), async (board, tmux) => {
    const v = await chat.deliverAutomaticAsync('casey', 'Pick up your handoff.', board.agents, undefined, undefined, { cap: false });
    assert.equal(v.heldBy, 'limit', JSON.stringify(v));
    assert.deepEqual(tmux.typed(), []);
  });
});

test('#5805 review 17: on a dateless limit line too, the fresh StopFailure report does not outrank the screen (decided), and (slice 3b) it is held on its first-seen reset', async () => {
  status.noteLimitRows('casey', '', Date.now());   // captured before, so the line is seen arriving (3b: not late)
  await withReport(LIMIT_REPORT, DATELESS(), async (board, tmux) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.RATE_LIMITED, 'the card reads ' + card.state + ' (before this slice: blocked)');
    assert.equal(typeof card.limitUntil, 'string', 'CONTROL: the dateless reset was read from when it was first seen');
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.equal(v.held, true, JSON.stringify(v));
    assert.equal(v.heldBy, 'limit');
    assert.equal(tmux.typed().length, 0, 'a line was typed into a dateless limit screen ahead of its reset');
  });
});

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

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

/* The month and day of `ms` in America/Chicago, as Claude Code prints a dated reset ("Oct 5"). */
function chicagoDay(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day}`;
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
  chat.resetForTests();
  messages.resetForTests();
  for (const d of [messages.LOG, roomhold.dir()]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
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

test('#5805 not held: a limit line with no date, a reset already past, and a person\'s own message', async () => {
  await onScreen(DATELESS(), async (board, tmux) => {
    assert.equal(board.agents.find((c) => c.sessionName === 'casey').state, status.STATE.RATE_LIMITED, 'CONTROL: the dateless line still reads capped');
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.ok(tmux.typed().length > 0, 'the dateless line held a timer\'s line');
  });
  // A reset already past: status retires the line, so the card reads idle again and the line is typed.
  await onScreen(PAST(), async (board, tmux) => {
    const v = chat.deliverAutomatic('casey', 'A colleague line.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.ok(tmux.typed().length > 0, 'a past reset held a timer\'s line');
  }, 'idle');
  await onScreen(AHEAD(), async (board) => {
    const v = await chat.deliverAsync('casey', 'From the person.', board.agents);
    assert.notEqual(v.held, true, 'a person\'s message was held: ' + JSON.stringify(v));
  });
});

test('#5805 a passed dated reset on a card that still reads capped (its limit menu on screen) is held, looking again in a minute', async () => {
  await onScreen(AHEAD(), async (board, tmux) => {
    const past = `You've hit your weekly limit · resets ${chicagoDay(Date.now() - 3 * DAY)} at 3pm (America/Chicago)`;
    const r = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, state: status.STATE.RATE_LIMITED, stateEvidence: past } : c));
    const before = Date.now();
    const v = chat.deliverAutomatic('casey', 'A colleague line.', r);
    assert.equal(v.held, true, JSON.stringify(v));
    assert.equal(v.heldBy, 'limit');
    assert.match(v.because, /still shows its usage limit on screen/);
    const until = Date.parse(v.heldUntil);
    assert.ok(until >= before + 50e3 && until <= Date.now() + 70e3, 'not a minute on: ' + v.heldUntil);
    assert.deepEqual(tmux.typed(), []);
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
    isAgy: (c) => c.runner === 'antigravity', isLimitable: (c) => chat.limitable(c) && c.state === 'idle',
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
  const until = new Date(Date.now() + 2 * DAY).toISOString();
  const held = async () => ({ state: chat.DELIVERY.COULD_NOT, held: true, heldBy: 'limit', heldUntil: until, because: 'held: limit' });
  const done = await roomhold.flushOnIdle('april', { deliver: held, roster: [], shownOf: () => 'Henderson lease', DELIVERY: chat.DELIVERY });
  assert.equal(done[0].state, chat.DELIVERY.COULD_NOT);
  assert.deepEqual(roomhold.heldIn('april', PROJECT), [roomhold.addressedId('m9')], 'the mark was lost on the put-back');
  assert.equal(roomhold.limitKept('april', PROJECT, 'm9'), true, 'the flush did not record the limit');
});

test('#5805 retry: only a project whose ask survives is told; a project holding only plain posts waits untouched', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    roomhold.hold('april', PROJECT, roomhold.addressedId('m51'));
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
  assert.match(src.slice(at, at + 1200), /isLimitable: \(c\) => chat\.limitable\(c\) && c\.state === 'idle'/);
});

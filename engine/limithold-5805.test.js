'use strict';

/**
 * #5805 slice 1: a Claude agent paused on a usage limit whose screen names a DATED reset still ahead is not typed into
 * by a timer or a colleague. chat.deliverAutomatic(Async) returns the #4588 hold shape with heldBy 'limit' and
 * heldUntil the reset, so every automatic sender keeps its try. A room post held this way is kept with the cap's mark
 * and roomhold.flushReleased tells it once the member's card reads idle again. A limit line with no date (the 5-hour
 * form) or a reset already past is typed as before, and a person's own message is never held here.
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
    isAgy: (c) => c.runner === 'antigravity', isLimitable: (c) => String(c.runner || 'claude') === 'claude' && c.isNamedOurs !== false && c.state === 'idle',
    readReport: () => null, now: Date.now(), decayMs: status.REPORT_WORKING_DECAY_MS,
    deliver: chat.deliverAutomaticAsync, DELIVERY: chat.DELIVERY, roster: r,
    shownOf: () => 'Henderson lease', stale: (p, ids) => ids, ...extra,
  };
}

test('#5805 room: a colleague\'s post to a capped Claude member is held with the cap\'s mark (even when it names her), retried only once her card reads idle, told once', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    let tmux = arm('');
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@april please' }, roomRoster(board, true), MEMBERS);
    assert.deepEqual(tmux.pastedTo('april'), [], 'typed into a capped member');
    assert.deepEqual(roomhold.heldIn('april', PROJECT), [roomhold.cappedId(sent.id)], 'not kept with the cap\'s mark');

    tmux = arm('');
    const still = roomRoster(board, true);
    assert.deepEqual(await roomhold.flushReleased(still, flushDeps(still)), [], 'retried while still capped');
    assert.deepEqual(tmux.pastedTo('april'), []);

    // CONTROL: without the Claude predicate (the old server), the retry never looks at her.
    const idle = roomRoster(board, false);
    assert.deepEqual(await roomhold.flushReleased(idle, flushDeps(idle, { isLimitable: undefined })), []);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), [roomhold.cappedId(sent.id)]);

    tmux = arm('');
    const done = await roomhold.flushReleased(idle, flushDeps(idle));
    assert.deepEqual(done.map((d) => [d.name, d.state]), [['april', chat.DELIVERY.PLACED]]);
    assert.equal(tmux.pastedTo('april').length, 1, 'not told exactly once');
    assert.deepEqual(roomhold.heldIn('april', PROJECT), []);
    tmux = arm('');
    assert.deepEqual(await roomhold.flushReleased(idle, flushDeps(idle)), [], 'told twice');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5805 room CONTROL: a plain #4624 hold on an idle Claude member (no cap mark) is not woken by the retry', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    roomhold.hold('april', PROJECT, 'plain-post-1');
    const tmux = arm('');
    const idle = roomRoster(board, false);
    assert.deepEqual(await roomhold.flushReleased(idle, flushDeps(idle)), []);
    assert.deepEqual(tmux.pastedTo('april'), []);
    assert.deepEqual(roomhold.heldIn('april', PROJECT), ['plain-post-1']);
  } finally { chat.resetForTests(); board.restore(); }
});

'use strict';

/**
 * #5805: a task message (`kosmos task message`, or the person's from the screen) to a Claude agent out of usage is
 * kept, not typed, like a `kosmos msg`; the minute sweep types it after the reset; one still kept a day past its reset
 * is dropped and its sending agent told which task it was in. Cards come from test-support/fleet with real limit
 * screens; "was it typed" reads the scripted tmux runner's recorded pastes.
 *
 *   node --test engine/limittask-5805.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-limittask-5805-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const status = require('./status');
const limitqueue = require('./limitqueue');
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
/* "Oct 5 at 2:35pm" for `ms` in America/Chicago, the dated reset Claude Code prints, to the minute. */
function resetAt(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day} at ${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase()}`;
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

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  limitqueue.resetForTests();
  for (const d of [messages.LOG, limitqueue.dir(), require('./taskchat').taskChatsDir()]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* leo sends; casey is the recipient, capped (a dated reset ahead) or idle. */
async function withFleet(caseyScreen, caseyState, fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('casey', { state: caseyState, runner: 'claude', command: 'claude', screen: caseyScreen })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  try { return await fn(board, arm(caseyScreen)); } finally { chat.resetForTests(); board.restore(); }
}
const rows = () => messages.list('casey');
/* A typed kept message without the sweep's "kept for you" note (asserted on its own below). */
const LINE = '[Kosmos task 7 - Launch] leo said: "ship it" - reply in the task: kosmos task message launch 7 "..."';
const ABOUT = 'task 7 in Launch';
const kept = () => limitqueue.list('casey');
/* What the board writes to its log (stdout) while `fn` runs, and a bounded wait for a fire-and-forget step. */
function captureStdout() {
  const lines = [];
  const real = process.stdout.write;
  process.stdout.write = function (chunk, ...rest) { if (String(chunk).startsWith('limit-queue: ')) { lines.push(String(chunk)); return true; } return real.call(this, chunk, ...rest); };
  return { lines, restore: () => { process.stdout.write = real; } };
}
async function until(ok, ms = 3000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ok(), 'timed out waiting');
}

test('#5805 task: a task line to an agent out of usage is kept, not typed; the route is told held and until when', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board, tmux) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.RATE_LIMITED, 'the fixture is not a capped card');
    const v = messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT);
    assert.ok(v, 'not held');
    assert.equal(v.state, messages.HELD_STATE);
    assert.equal(Date.parse(v.heldUntil), status.limitResetAt(card.stateEvidence, Date.now()));
    assert.match(v.because, /^held: casey is out of usage until .*; Kosmos types it after the reset$/, v.because);
    assert.deepEqual(tmux.pastedTo('casey'), [], 'a held task line was typed');
    const e = kept();
    assert.equal(e.length, 1);
    assert.deepEqual([e[0].kind, e[0].from, e[0].envelope, e[0].about], ['task', 'leo', LINE, ABOUT]);
  });
});

test('#5805 task CONTROL: a task line to an idle agent with nothing kept is not held (the route types it as before)', async () => {
  await withFleet(undefined, 'idle', async (board) => {
    assert.equal(messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT), null);
    assert.deepEqual(kept(), []);
  });
});

test('#5805 task: an agent that cannot be reached is not held, so the route refuses it as before', async () => {
  await withFleet(undefined, 'idle', async (board) => {
    assert.equal(messages.keepTaskLine('nobody-here', LINE, board.agents, 'leo', ABOUT), null);
  });
});

test('#5805 task: a released agent with messages still kept gets the task line behind them, never ahead', async () => {
  const t = new Date().toISOString();
  limitqueue.add('casey', { id: 'm950', from: 'mara', envelope: '[message from your colleague mara · m950] earlier', at: t, reset: t });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const v = messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT);
    assert.ok(v, 'typed ahead of a backlog');
    assert.equal(v.state, messages.HELD_STATE);
    assert.equal(v.heldUntil, null, 'behind a backlog no time is promised');
    assert.match(v.because, /still has messages kept from while it was out of usage/);
    assert.deepEqual(kept().map((e) => e.id[0]), ['m', 'k']);
    assert.deepEqual(tmux.pastedTo('casey'), []);
  });
});

test('#5805 task: the board\'s sweep types the kept task line after the reset, with the kept note, and logs no message row', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    messages.keepTaskLine('casey', LINE, board.agents, '', ABOUT);   // the person's, from the screen
    assert.deepEqual(await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages })), [], 'typed while still capped');
  });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const done = await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));
    assert.equal(done.length, 1);
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1);
    assert.ok(typed[0].startsWith(LINE + ' [kept for you while you were out of usage; sent '), typed[0]);
    assert.deepEqual(kept(), []);
    assert.deepEqual(messages.list('casey').filter((r) => r.kind === 'held-delivered'), [], 'a task line has no message row to point at');
  });
});

test('#5805 task: one still kept a day past its reset is dropped, untyped, and the sending agent is told which task', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'k1', kind: 'task', from: 'leo', envelope: LINE, about: ABOUT, at: old, reset: old });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const out = captureStdout();
    try {
      await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));
      await until(() => out.lines.some((l) => l.includes('task line k1')));   // the tell is fire-and-forget
    } finally { out.restore(); }
    assert.ok(out.lines.some((l) => /^limit-queue: task line k1 for casey was dropped a day past its reset, never typed; told leo, delivery=placed$/.test(l.trim())), out.lines.join('|'));
    assert.deepEqual(tmux.pastedTo('casey'), [], 'the dropped line was typed');
    const told = tmux.pastedTo('leo');
    assert.equal(told.length, 1, 'the sender was not told');
    assert.match(told[0], /Your message in task 7 in Launch never reached casey: Kosmos kept it for a day while casey was out of usage/);
    assert.deepEqual(kept(), []);
    assert.deepEqual(messages.list('casey').filter((r) => r.kind === 'held-dropped'), [], 'a task drop wrote a message row');
  });
});

test('#5805 task: a dropped line the person sent is told to no pane (the task conversation holds it)', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'k2', kind: 'task', from: '', envelope: LINE, about: ABOUT, at: old, reset: old, person: true });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const out = captureStdout();
    try {
      await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));
      await until(() => out.lines.some((l) => l.includes('task line k2')));
    } finally { out.restore(); }
    assert.ok(out.lines.some((l) => l.trim() === 'limit-queue: task line k2 for casey was dropped a day past its reset, never typed; told nobody (the person sent it)'), out.lines.join('|'));
    assert.deepEqual(tmux.typed(), [], 'something was typed for a dropped line from the person');
    assert.deepEqual(kept(), []);
  });
});

test('#5805 task: a full queue is said, not held: nothing kept, nothing typed', async () => {
  const t = new Date(Date.now() + 3600e3).toISOString();
  for (let i = 0; i < limitqueue.MAX_PER_SENDER; i += 1) limitqueue.add('casey', { id: 'k' + i, kind: 'task', from: 'leo', envelope: 'x' + i, at: t, reset: t });
  await withFleet(AHEAD(), 'rate_limited', async (board, tmux) => {
    const v = messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
    assert.match(v.because, /could not keep this one for it \(20 messages from this sender are kept for it already\), so it was not told/);
    assert.equal(kept().length, limitqueue.MAX_PER_SENDER);
    assert.deepEqual(tmux.pastedTo('casey'), []);
  });
});

test('#5805 task: a failure after a hold is found refuses the line, untyped; one before it types as before', async () => {
  const realAdd = limitqueue.addOrWhy;
  limitqueue.addOrWhy = () => { throw new Error('disk gone'); };
  try {
    await withFleet(AHEAD(), 'rate_limited', async (board, tmux) => {
      const v = messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT);
      assert.equal(v && v.state, chat.DELIVERY.COULD_NOT, 'a throw while keeping fell through to typing: ' + JSON.stringify(v));
      assert.match(v.because, /^casey is out of usage, and Kosmos could not keep this one for it/);
      assert.deepEqual(tmux.pastedTo('casey'), []);
    });
    // Behind a backlog (released, a kept message still waiting): the refusal says so, not "out of usage".
    const t = new Date().toISOString();
    limitqueue.addOrWhy = realAdd;
    limitqueue.add('casey', { id: 'm951', from: 'mara', envelope: 'earlier', at: t, reset: t });
    limitqueue.addOrWhy = () => { throw new Error('disk gone'); };
    await withFleet(undefined, 'idle', async (board, tmux) => {
      const v = messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT);
      assert.equal(v && v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
      assert.match(v.because, /^casey still has messages kept from while it was out of usage, and Kosmos could not keep this one/);
      assert.deepEqual(tmux.pastedTo('casey'), []);
    });
  } finally { limitqueue.addOrWhy = realAdd; }
  const realVerdict = chat.limitHeldVerdict;
  const realAddr = chat.addressable;
  chat.limitHeldVerdict = () => null;
  chat.addressable = () => { throw new Error('roster gone'); };
  try {
    await withFleet(undefined, 'idle', async (board) => {
      assert.equal(messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT), null, 'CONTROL: a throw before any hold is found must not refuse');
    });
  } finally { chat.limitHeldVerdict = realVerdict; chat.addressable = realAddr; }
});

test('#5805 task: a line the delivery refuses anyway (swarm paused, or not sendable) is not kept, so its true reason is said now', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board, tmux) => {
    const paused = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, swarm: { active: false } } : c));
    assert.ok(chat.limitHeldVerdict('casey', paused), 'CONTROL: the paused card is still limit-held, so a keep was possible');
    assert.equal(messages.keepTaskLine('casey', LINE, paused, 'leo', ABOUT), null, 'a paused agent\'s line was kept');
    const v = await chat.deliverAsync('casey', LINE, paused);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, 'the delivery no longer refuses a paused swarm: ' + JSON.stringify(v));
    assert.equal(messages.keepTaskLine('casey', 'x'.repeat(100000), board.agents, 'leo', ABOUT), null, 'an unsendable line was kept');
    assert.deepEqual(kept(), []);
    assert.deepEqual(tmux.pastedTo('casey'), []);
  });
});

/* #5842 slice 2: a kept task line carries its task (project id and number), so the task's own conversation records it
   sent after the reset or dropped a day later: the person, who has no pane, sees the outcome where the message is. */
const taskchat = require('./taskchat');
const WHERE = (task) => ({ projectId: 'launch-5842', task });
const outcomes = (task) => taskchat.read('launch-5842', task).filter((e) => e.kind === 'kept-sent' || e.kind === 'kept-dropped');

test('#5842: a kept task line carries its task; one kept without it (an older caller) carries none', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    messages.keepTaskLine('casey', LINE, board.agents, 'leo', ABOUT, WHERE(11));
    messages.keepTaskLine('casey', LINE + ' again', board.agents, 'leo', ABOUT);
    const [withTask, without] = kept();
    assert.deepEqual([withTask.projectId, withTask.task], ['launch-5842', 11]);
    assert.ok(!('projectId' in without) && !('task' in without), 'CONTROL: a line kept with no task gained one');
  });
});

test('#5842: the sweep typing a kept task line records it sent on its task, with the delivery state', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    messages.keepTaskLine('casey', LINE, board.agents, '', ABOUT, { ...WHERE(12), person: true });   // the person's, from the screen
  });
  assert.deepEqual(outcomes(12), [], 'recorded before it was typed');
  await withFleet(undefined, 'idle', async (board) => {
    assert.equal((await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }))).length, 1);
  });
  const ev = outcomes(12);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].kind, ev[0].to, ev[0].from, ev[0].state, ev[0].person], ['kept-sent', 'casey', '', chat.DELIVERY.PLACED, true]);
});

test('#5842: a kept task line dropped a day past its reset is recorded dropped on its task, whoever sent it', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'k5842a', kind: 'task', from: '', envelope: LINE, about: ABOUT, at: old, reset: old, ...WHERE(13), person: true });
  limitqueue.add('casey', { id: 'k5842b', kind: 'task', from: 'leo', envelope: LINE + ' b', about: ABOUT, at: old, reset: old, ...WHERE(14) });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const out = captureStdout();
    try {
      await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));
      await until(() => out.lines.some((l) => l.includes('task line k5842b')));
    } finally { out.restore(); }
    assert.deepEqual(tmux.pastedTo('casey'), [], 'a dropped line was typed');
  });
  assert.deepEqual(outcomes(13).map((e) => [e.kind, e.to, e.from, e.person]), [['kept-dropped', 'casey', '', true]]);
  assert.deepEqual(outcomes(14).map((e) => [e.kind, e.to, e.from, e.person]), [['kept-dropped', 'casey', 'leo', undefined]]);
  assert.ok(outcomes(13).every((e) => !('behind' in e)), 'a line kept for a reset was recorded as kept behind others');
});

test('#5842: a line kept behind earlier messages is recorded as such, so the page speaks of no reset', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'k5842d', kind: 'task', from: '', envelope: LINE, about: ABOUT, at: old, reset: old, behind: true, ...WHERE(15) });
  await withFleet(undefined, 'idle', async (board) => {
    const out = captureStdout();
    try {
      await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));
      await until(() => out.lines.some((l) => l.includes('task line k5842d')));
    } finally { out.restore(); }
  });
  assert.deepEqual(outcomes(15).map((e) => [e.kind, e.behind]), [['kept-dropped', true]]);
});

test('#5842 CONTROL: a kept task line with no task (kept before this change) is dropped as before and records nothing', async () => {
  /* Every kept-* row in every task's conversation: this line, with no task, must add none anywhere. */
  const keptRows = () => {
    const dir = taskchat.taskChatsDir();
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).reduce((n, f) => n + fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => /"kind":"kept-(sent|dropped)"/.test(l)).length, 0);
  };
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'k5842c', kind: 'task', from: '', envelope: LINE, about: ABOUT, at: old, reset: old });
  assert.ok(!('projectId' in kept()[0]), 'the fixture carries a task');
  const before = keptRows();
  await withFleet(undefined, 'idle', async (board) => {
    const out = captureStdout();
    try {
      await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));
      await until(() => out.lines.some((l) => l.includes('task line k5842c')));
    } finally { out.restore(); }
  });
  assert.deepEqual(kept(), [], 'not dropped as before');
  assert.equal(keptRows(), before, 'a line with no task was recorded on some task');
});

test('#5842: a dropped line with no sender named and no person mark is not logged as the person\'s', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'k5842e', kind: 'task', from: '', envelope: LINE, about: ABOUT, at: old, reset: old });
  await withFleet(undefined, 'idle', async (board) => {
    const out = captureStdout();
    try {
      await limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));
      await until(() => out.lines.some((l) => l.includes('task line k5842e')));
    } finally { out.restore(); }
    const line = out.lines.find((l) => l.includes('task line k5842e')).trim();
    assert.match(line, /told nobody \(no sender named\)$/, line);
  });
});

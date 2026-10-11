'use strict';

/**
 * #5805 slice 2a: `kosmos msg` to a Claude agent out of usage (a dated reset still ahead) is kept, not typed; the
 * sender is told it is held and when; the board's minute sweep types it after the reset, in order, and drops one a day
 * past its reset. Cards come from test-support/fleet with real limit screens; "was it typed" reads the scripted tmux
 * runner's recorded pastes.
 *
 *   node --test engine/limitmsg-5805.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-limitmsg-5805-' + process.pid);
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
  for (const d of [messages.LOG, limitqueue.dir()]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* leo sends; casey is the recipient, capped (a dated reset ahead) or idle. */
async function withFleet(caseyScreen, caseyState, fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('casey', { state: caseyState, runner: 'claude', command: 'claude', screen: caseyScreen })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  try { return await fn(board, arm(caseyScreen)); } finally { chat.resetForTests(); board.restore(); }
}
const rows = () => messages.list('casey');

test('#5805 2a: a message to an agent out of usage is kept, not typed; the sender is told it is held and until when', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board, tmux) => {
    const card = board.agents.find((c) => c.sessionName === 'casey');
    assert.equal(card.state, status.STATE.RATE_LIMITED, 'the fixture is not a capped card');
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'go ahead with the release' }, board.agents);
    assert.equal(v.held, true, JSON.stringify(v));
    assert.equal(v.heldBy, 'limit');
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, 'held must not read as delivered');
    assert.equal(Date.parse(v.heldUntil), status.limitResetAt(card.stateEvidence, Date.now()));
    assert.match(v.id, /^m\d+$/);
    assert.deepEqual(tmux.pastedTo('casey'), [], 'a held message was typed');
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), [v.id]);
    const row = rows().find((r) => r.id === v.id);
    assert.equal(row.state, messages.HELD_STATE);
    // The same send again is the same held message, not a second copy.
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'go ahead with the release' }, board.agents);
    assert.deepEqual([again.held, again.id, again.duplicate], [true, v.id, true]);
    assert.equal(limitqueue.list('casey').length, 1, 'kept twice');
  });
});

test('#5805 2a CONTROL: a message to an idle agent is typed as before, nothing kept', async () => {
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'hello' }, board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.equal(tmux.pastedTo('casey').length, 1);
    assert.deepEqual(limitqueue.list('casey'), []);
  });
});

test('#5805 2a: the sweep types kept messages in order once the card reads released, and logs each', async () => {
  let ids;
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    ids = [];
    for (const t of ['first', 'second']) ids.push((await messages.sendAsync({ fromPane: '%7', to: 'casey', text: t }, board.agents)).id);
    // Still capped: the sweep types nothing.
    const none = await limitqueue.flush(board.agents, { deliver: chat.deliverAutomaticAsync, isReleased: chat.limitReleased, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDelivered: messages.logHeldDelivered, onDropped: messages.logHeldDropped });
    assert.deepEqual(none, []);
  });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const done = await limitqueue.flush(board.agents, { deliver: chat.deliverAutomaticAsync, isReleased: chat.limitReleased, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDelivered: messages.logHeldDelivered, onDropped: messages.logHeldDropped });
    assert.deepEqual(done.map((d) => d.id), ids);
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 2);
    assert.match(typed[0], /first/);
    assert.match(typed[1], /second/);
    assert.deepEqual(limitqueue.list('casey'), []);
    assert.deepEqual(rows().filter((r) => r.kind === 'held-delivered').map((r) => r.of), ids);
  });
});

test('#5805 2a: a kept message whose try comes back could-not stays, and so does every one after it (order kept)', async () => {
  limitqueue.add('casey', { id: 'm901', from: 'leo', envelope: '[message from your colleague leo · m901] a', at: new Date().toISOString(), reset: new Date().toISOString() });
  limitqueue.add('casey', { id: 'm902', from: 'leo', envelope: '[message from your colleague leo · m902] b', at: new Date().toISOString(), reset: new Date().toISOString() });
  const done = await limitqueue.flush([{ sessionName: 'casey' }], {
    deliver: async () => ({ state: chat.DELIVERY.COULD_NOT }), isReleased: () => true, resolveCard: (r, n) => r.find((c) => c.sessionName === n), DELIVERY: chat.DELIVERY,
  });
  assert.deepEqual(done, []);
  assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m901', 'm902']);
});

test('#5805 2a: a message still kept a day past its reset is dropped and logged, without being typed', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'm903', from: 'leo', envelope: 'x', at: old, reset: old });
  let typed = 0;
  const dropped = [];
  await limitqueue.flush([{ sessionName: 'casey' }], {
    deliver: async () => { typed += 1; return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true,
    resolveCard: (r, n) => r.find((c) => c.sessionName === n), DELIVERY: chat.DELIVERY, onDropped: (e) => dropped.push(e.id),
  });
  assert.equal(typed, 0);
  assert.deepEqual(dropped, ['m903']);
  assert.deepEqual(limitqueue.list('casey'), []);
});

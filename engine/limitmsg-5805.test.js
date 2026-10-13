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
  limitqueue.resetForTests();
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
/* A typed kept message without the sweep's "kept for you" note (asserted on its own below). */
const bare = (env) => String(env).replace(/ \[kept (?:for you while you were out of usage|behind earlier messages); sent [^\]]*\]$/, '');
/* A real card for casey (fixture discipline: never a hand-built roster row), for the sweep tests that stub everything
   but who the agent is. */
function caseyRoster() {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try { return board.agents; } finally { board.restore(); }
}

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
  const tried = [];
  // The first one cannot be typed this minute; the second could be, and must still wait behind it.
  const done = await limitqueue.flush(caseyRoster(), {
    deliver: async (n, env) => { tried.push(bare(env)); return { state: /m901/.test(env) ? chat.DELIVERY.COULD_NOT : chat.DELIVERY.PLACED }; },
    isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY,
  });
  assert.deepEqual(done, []);
  assert.equal(tried.length, 1, 'a later message was typed ahead of an earlier one');
  assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m901', 'm902']);
});

test('#5805 2a: a message still kept a day past its reset is dropped and logged, without being typed', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'm903', from: 'leo', envelope: 'x', at: old, reset: old });
  let typed = 0;
  const dropped = [];
  await limitqueue.flush(caseyRoster(), {
    deliver: async () => { typed += 1; return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true,
    resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDropped: (e) => dropped.push(e.id),
  });
  assert.equal(typed, 0);
  assert.deepEqual(dropped, ['m903']);
  assert.deepEqual(limitqueue.list('casey'), []);
});

const opts = (extra = {}) => ({ deliver: chat.deliverAutomaticAsync, isReleased: chat.limitQueueReleased, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDelivered: messages.logHeldDelivered, onDropped: messages.logHeldDropped, ...extra });

test('#5805 2a review 1/5: two names with one store key keep separate queues; an entry for another agent in a file is never typed', async () => {
  // Review 5: two names with one store key each keep their own messages (the file name carries a hash of the name).
  assert.equal(store.safeKey('Casey.2'), store.safeKey('casey2'), 'CONTROL: these two names share a store key');
  const t = new Date().toISOString();
  assert.equal(limitqueue.add('Casey.2', { id: 'm950', from: 'leo', envelope: 'for Casey.2', at: t, reset: t }), true);
  assert.equal(limitqueue.add('casey2', { id: 'm953', from: 'leo', envelope: 'for casey2', at: t, reset: t }), true);
  assert.deepEqual(limitqueue.list('Casey.2').map((e) => e.envelope), ['for Casey.2']);
  assert.deepEqual(limitqueue.list('casey2').map((e) => e.envelope), ['for casey2']);
  assert.deepEqual(limitqueue.names().sort(), ['Casey.2', 'casey2']);
  limitqueue.remove('Casey.2', 'm950');
  limitqueue.remove('casey2', 'm953');
  fs.mkdirSync(limitqueue.dir(), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(limitqueue.fileFor('casey'), JSON.stringify([{ id: 'm951', from: 'leo', to: 'casey', envelope: 'mine', at: now, reset: now }, { id: 'm952', from: 'leo', to: 'mallory', envelope: 'not hers', at: now, reset: now }]));
  const typed = [];
  await limitqueue.flush(caseyRoster(), { deliver: async (n, env) => { typed.push(bare(env)); return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY });
  assert.deepEqual(typed, ['mine'], 'another agent\'s message was typed into this one');
});

test('#5805 2a review 1: two sweeps at once type each kept message once', async () => {
  const now = new Date().toISOString();
  for (const id of ['m961', 'm962']) limitqueue.add('casey', { id, from: 'leo', envelope: id, at: now, reset: now });
  const typed = [];
  const o = { deliver: async (n, env) => { typed.push(bare(env)); await new Promise((r) => setTimeout(r, 30)); return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY };
  await Promise.all([limitqueue.flush(caseyRoster(), o), limitqueue.flush(caseyRoster(), o)]);
  assert.deepEqual(typed, ['m961', 'm962']);
});

test('#5805 2a review 1: the same send again after the held copy was typed is that delivery, never "held" and never a second copy', async () => {
  let id;
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    id = (await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'ship it' }, board.agents)).id;
  });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    await limitqueue.flush(board.agents, opts());
    assert.equal(tmux.pastedTo('casey').length, 1);
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'ship it' }, board.agents);
    assert.deepEqual([again.state, again.id, again.duplicate], [chat.DELIVERY.PLACED, id, true], JSON.stringify(again));
    assert.equal(tmux.pastedTo('casey').length, 1, 'typed twice');
  });
});

test('#5805 2a review 1: held past the printed reset (the card still reads capped), no time is promised', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    const past = `You've hit your weekly limit · resets ${resetAt(Date.now() - 15 * 60e3)} (America/Chicago)`;
    const r = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, state: status.STATE.RATE_LIMITED, stateEvidence: past } : c));
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'later' }, r);
    assert.equal(v.held, true, JSON.stringify(v));
    assert.equal(v.heldUntil, null, 'a time already past was promised');
    assert.doesNotMatch(v.because, / until /);
  });
});

test('#5805 2a review 1: a message dropped a day past its reset is told to its sender, in its own pane', async () => {
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
    limitqueue.add('casey', { id: 'm970', from: 'leo', envelope: 'x', at: old, reset: old });
    const told = [];
    await limitqueue.flush(board.agents, opts({ onDropped: (e, r) => { told.push(messages.tellHeldDropped(e, r)); } }));
    await Promise.all(told);
    const lines = tmux.pastedTo('leo');
    assert.equal(lines.length, 1, 'the sender was not told');
    assert.match(lines[0], /Your message m970 to casey was never delivered: Kosmos kept it for a day and could not type it\./);
    assert.deepEqual(tmux.pastedTo('casey'), [], 'the dropped message was typed');
    assert.ok(rows().some((r) => r.kind === 'held-dropped' && r.of === 'm970'));
  });
});

test('#5805 2a review 2: the same send again long after (no recent row left) is still the kept copy, not a second one', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    const first = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'the go-ahead' }, board.agents);
    fs.rmSync(messages.LOG, { recursive: true, force: true });   // past the repeat-send window: no row to fold on
    messages.resetForTests();
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));   // resetForTests clears the sender lookup too
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'the go-ahead' }, board.agents);
    assert.deepEqual([again.held, again.id, again.duplicate], [true, first.id, true], JSON.stringify(again));
    assert.equal(limitqueue.list('casey').length, 1, 'kept twice');
  });
});

test('#5805 2a review 2: a dropped long message\'s spilled file is removed; at most MAX_KEPT are kept per agent', async () => {
  const spill = path.join(SANDBOX, 'spilled-m980.txt');
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.writeFileSync(spill, 'a long body');
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'm980', from: 'leo', envelope: 'x', at: old, reset: old, spill });
  const told = [];
  await limitqueue.flush([], { deliver: async () => ({ state: chat.DELIVERY.PLACED }), isReleased: () => true, resolveCard: () => null, DELIVERY: chat.DELIVERY, onDropped: (e, r) => told.push(messages.tellHeldDropped(e, r)) });
  await Promise.all(told);
  assert.equal(fs.existsSync(spill), false, 'the spilled file was left behind');
  const now = new Date().toISOString();
  for (let i = 0; i < limitqueue.MAX_KEPT; i += 1) assert.equal(limitqueue.add('casey', { id: 'mc' + i, from: 'agent' + Math.floor(i / limitqueue.MAX_PER_SENDER), envelope: 'e', at: now, reset: now }), true);
  assert.equal(limitqueue.add('casey', { id: 'mc-over', from: 'someone-new', envelope: 'e', at: now, reset: now }), false, 'kept past the cap');
});

test('#5805 2a review 2: after an unconfirmed delivery the next kept message waits for the next minute', async () => {
  const now = new Date().toISOString();
  for (const id of ['m991', 'm992']) limitqueue.add('casey', { id, from: 'leo', envelope: id, at: now, reset: now });
  const typed = [];
  await limitqueue.flush(caseyRoster(), { deliver: async (n, env) => { typed.push(bare(env)); return { state: chat.DELIVERY.UNCONFIRMED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY });
  assert.deepEqual(typed, ['m991'], 'typed on top of a message that may still be in the composer');
  assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m992'], 'the unconfirmed one was kept (it would be typed twice)');
});

test('#5805 2a review 3: once a fresh send would no longer be held, kept messages are released too (never stricter)', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    const long = board.agents.map((c) => (c.sessionName === 'casey' ? { ...c, state: status.STATE.RATE_LIMITED, stateEvidence: `You've hit your weekly limit · resets ${resetAt(Date.now() - 3 * 3600e3)} (America/Chicago)` } : c));
    const card = long.find((c) => c.sessionName === 'casey');
    assert.equal(chat.limitReleased(card), false, 'CONTROL: slice 1 does not read this card released');
    assert.equal(chat.limitHeldVerdict('casey', long), null, 'CONTROL: a fresh send is no longer held');
    assert.equal(chat.limitQueueReleased(card, long), true, 'kept messages stricter than a fresh one');
    assert.equal(chat.limitQueueReleased(board.agents.find((c) => c.sessionName === 'casey'), board.agents), false, 'released while the reset is still ahead');
  });
});

test('#5805 2a review 3: a send to a released agent with kept messages still waiting goes behind them, in order', async () => {
  let first;
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    first = (await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'one' }, board.agents)).id;
  });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'two' }, board.agents);
    assert.equal(v.held, true, 'jumped ahead of a kept message: ' + JSON.stringify(v));
    assert.match(v.because, /after them/);
    assert.deepEqual(tmux.pastedTo('casey'), []);
    await limitqueue.flush(board.agents, opts());
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 2);
    assert.match(typed[0], new RegExp(first + '\\]'));
    assert.match(bare(typed[1]), /\] two$/);
  });
});

test('#5805 2a review 3: one sender cannot fill an agent\'s queue for everyone else', () => {
  const now = new Date().toISOString();
  for (let i = 0; i < limitqueue.MAX_PER_SENDER; i += 1) assert.equal(limitqueue.add('casey', { id: 'ml' + i, from: 'loop', envelope: 'e' + i, at: now, reset: now }), true);
  assert.equal(limitqueue.add('casey', { id: 'ml-over', from: 'loop', envelope: 'x', at: now, reset: now }), false, 'past the per-sender cap');
  assert.equal(limitqueue.add('casey', { id: 'mg', from: 'leo', envelope: 'go ahead', at: now, reset: now }), true, 'another sender was crowded out');
});

test('#5805 2a review 4: reads see only entries for that exact agent; an entry whose reset cannot be read is dropped a day after it arrived', async () => {
  fs.mkdirSync(limitqueue.dir(), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(limitqueue.fileFor('casey'), JSON.stringify([{ id: 'm1001', from: 'leo', to: 'mallory', envelope: 'not hers', at: now, reset: now, key: 'k' }]));
  assert.deepEqual(limitqueue.list('casey'), [], 'another agent\'s entry was read as this one\'s');
  assert.equal(limitqueue.keptByKey('casey', 'k'), null);
  assert.equal(limitqueue.has('casey', 'm1001'), false);
  fs.rmSync(limitqueue.fileFor('casey'), { force: true });
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
  limitqueue.add('casey', { id: 'm1002', from: 'leo', envelope: 'x', at: old, reset: 'never' });
  const dropped = [];
  await limitqueue.flush([], { deliver: async () => ({ state: chat.DELIVERY.PLACED }), isReleased: () => false, resolveCard: () => null, DELIVERY: chat.DELIVERY, onDropped: (e) => dropped.push(e.id) });
  assert.deepEqual(dropped, ['m1002'], 'an entry with no readable reset was kept for ever');
});

test('#5805 2a review 5: an agent that cannot be reached is refused as before, kept messages or not', async () => {
  const t = new Date().toISOString();
  limitqueue.add('ghost', { id: 'm1010', from: 'leo', envelope: 'x', at: t, reset: t });
  await withFleet(undefined, 'idle', async (board) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'ghost', text: 'hello?' }, board.agents);
    assert.notEqual(v.held, true, 'a send to an agent not on the board was held: ' + JSON.stringify(v));
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
  });
});

test('#5805 2a review 5: after the held copy was typed and the two have spoken since, the same words are a new message', async () => {
  let id;
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    id = (await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'ready?' }, board.agents)).id;
  });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    await limitqueue.flush(board.agents, opts());
    messages.setRunner(() => ({ ok: true, session: 'casey-discord' }));
    await messages.sendAsync({ fromPane: '%8', to: 'leo', text: 'yes' }, board.agents);   // casey answers
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'ready?' }, board.agents);
    assert.notEqual(again.id, id, 'folded into a message the two have talked past');
    assert.equal(tmux.pastedTo('casey').length, 2);
  });
});

test('#5805 2a review 6: a typed message whose removal from the file fails is not typed again next minute', async () => {
  const t = new Date().toISOString();
  limitqueue.add('casey', { id: 'm1020', from: 'leo', envelope: 'once', at: t, reset: t });
  const file = limitqueue.fileFor('casey');
  const typed = [];
  const o = { deliver: async (n, env) => { typed.push(bare(env)); fs.chmodSync(path.dirname(file), 0o500); return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY };
  try {
    await limitqueue.flush(caseyRoster(), o);
    assert.equal(limitqueue.list('casey').length, 1, 'CONTROL: the removal did fail (the file still holds it)');
    await limitqueue.flush(caseyRoster(), o);
    assert.deepEqual(typed, ['once'], 'typed twice after a failed removal');
  } finally { fs.chmodSync(path.dirname(file), 0o700); }
  await limitqueue.flush(caseyRoster(), o);
  assert.deepEqual(limitqueue.list('casey'), [], 'the removal was not tried again once it could succeed');
  assert.deepEqual(typed, ['once']);
});

test('#5805 2a review 7: a message queued behind an old backlog has its own day, not the backlog\'s', async () => {
  const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS + 10 * 60e3).toISOString();   // a day old in 10 minutes
  limitqueue.add('casey', { id: 'm1030', from: 'mona', envelope: 'old', at: old, reset: old });
  let v;
  await withFleet(undefined, 'idle', async (board) => {
    v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'new' }, board.agents);
  });
  assert.equal(v.held, true, JSON.stringify(v));
  assert.doesNotMatch(v.because, /minute/, 'promised a time the sweep cannot keep');
  const dropped = [];
  // Fifteen minutes on, the sweep still cannot type (a menu on screen): the old one is a day old, the new one is not.
  await limitqueue.flush(caseyRoster(), { now: Date.now() + 15 * 60e3, deliver: async () => ({ state: chat.DELIVERY.COULD_NOT }), isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDropped: (e) => dropped.push(e.id) });
  assert.deepEqual(dropped, ['m1030']);
  assert.deepEqual(limitqueue.list('casey').map((e) => e.id), [v.id], 'the new message was dropped on the backlog\'s clock');
});

test('#5805 2a review 9: held long past its printed reset (limit menu still up), the message gets its own day', async () => {
  const realV = chat.limitHeldVerdict;
  const longAgo = new Date(Date.now() - 30 * 3600e3).toISOString();
  chat.limitHeldVerdict = () => ({ state: chat.DELIVERY.COULD_NOT, held: true, heldBy: 'limit', limitReset: longAgo, heldUntil: new Date(Date.now() + 60e3).toISOString() });
  let v;
  try {
    await withFleet(undefined, 'idle', async (board) => { v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'overnight' }, board.agents); });
  } finally { chat.limitHeldVerdict = realV; }
  assert.equal(v.held, true, JSON.stringify(v));
  const dropped = [];
  await limitqueue.flush(caseyRoster(), { deliver: async () => ({ state: chat.DELIVERY.PLACED }), isReleased: () => false, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDropped: (e) => dropped.push(e.id) });
  assert.deepEqual(dropped, [], 'dropped a minute after it was held, on a reset a day old');
  assert.deepEqual(limitqueue.list('casey').map((e) => e.id), [v.id]);
});

test('#5805 2a review 9: the same send again, queued behind a backlog, keeps the behind wording', async () => {
  const t = new Date().toISOString();
  limitqueue.add('casey', { id: 'm1040', from: 'mona', envelope: 'earlier', at: t, reset: t });
  await withFleet(undefined, 'idle', async (board) => {
    const first = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'after that' }, board.agents);
    fs.rmSync(messages.LOG, { recursive: true, force: true });   // past the recent-send window: the kept copy answers
    messages.resetForTests();
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'after that' }, board.agents);
    assert.deepEqual([first.behind, again.behind, again.id, again.duplicate], [true, true, first.id, true], JSON.stringify(again));
    assert.doesNotMatch(again.because, /is out of usage/);
  });
});

test('#5805 2a review 9: a message being typed is claimed (isTyping), and a second sweep at the same time types nothing', async () => {
  const t = new Date().toISOString();
  limitqueue.add('casey', { id: 'm1050', from: 'leo', envelope: 'one', at: t, reset: t });
  let release;
  const gate = new Promise((r) => { release = r; });
  const typed = [];
  const o = { deliver: async (n, env) => { typed.push(bare(env)); await gate; return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY };
  const run1 = limitqueue.flush(caseyRoster(), o);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(limitqueue.isTyping('m1050'), true, 'not claimed while being typed');
  assert.deepEqual(await limitqueue.flush(caseyRoster(), o), []);
  release();
  await run1;
  assert.equal(limitqueue.isTyping('m1050'), false);
  assert.deepEqual(typed, ['one']);
});

test('#5805 2a review 11: a run that outlived the guard holds this agent: a newer run types nothing ahead of it', async () => {
  const t = new Date().toISOString();
  for (const id of ['m1060', 'm1061']) limitqueue.add('casey', { id, from: 'leo', envelope: id, at: t, reset: t });
  let release;
  const gate = new Promise((r) => { release = r; });
  const typed = [];
  const o = { deliver: async (n, env) => { typed.push(bare(env)); if (bare(env) === 'm1060') await gate; return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY };
  const run1 = limitqueue.flush(caseyRoster(), o);
  await new Promise((r) => setTimeout(r, 20));
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60e3;   // the first run has outlived the one-run guard
  let run2;
  try { run2 = await limitqueue.flush(caseyRoster(), o); } finally { Date.now = realNow; }
  assert.deepEqual(run2, []);
  assert.deepEqual(typed, ['m1060'], 'a later message was typed ahead of one still being typed');
  release();
  await run1;
});

test('#5805 2a review 11: at most PER_RUN messages per agent each minute, the rest next minute', async () => {
  const t = new Date().toISOString();
  for (let i = 0; i < limitqueue.PER_RUN + 2; i += 1) limitqueue.add('casey', { id: 'mr' + i, from: 'agent' + i, envelope: 'e' + i, at: t, reset: t });
  const typed = [];
  const o = { deliver: async (n, env) => { typed.push(bare(env)); return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY };
  await limitqueue.flush(caseyRoster(), o);
  assert.equal(typed.length, limitqueue.PER_RUN);
  assert.equal(limitqueue.list('casey').length, 2);
  await limitqueue.flush(caseyRoster(), o);
  assert.equal(typed.length, limitqueue.PER_RUN + 2);
});

test('#5805 2a review 13: a kept message is typed with a note that it was kept and when it was sent', async () => {
  const t = new Date(Date.now() - 20 * 3600e3).toISOString();
  limitqueue.add('casey', { id: 'm1070', from: 'leo', envelope: '[message from your colleague leo · m1070] go ahead', at: t, reset: t });
  const typed = [];
  await limitqueue.flush(caseyRoster(), { deliver: async (n, env) => { typed.push(env); return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY });
  assert.equal(typed.length, 1);
  assert.equal(typed[0], '[message from your colleague leo · m1070] go ahead [kept for you while you were out of usage; sent ' + t + ']');
});

test('#5805 2a review 13: a late retry of a kept message is that copy even with the pair at its valve', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    const first = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'the one that matters' }, board.agents);
    // Fill the pair's hour with other messages (as the log counts them), then retry past the recent-send window.
    for (let i = 0; i < 25; i += 1) await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'filler ' + i }, board.agents);
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'the one that matters' }, board.agents);
    assert.deepEqual([again.held, again.id, again.duplicate], [true, first.id, true], 'refused at the valve: ' + JSON.stringify(again));
  });
});

test('#5805 2a review 13: two spellings the router folds together share one queue', async () => {
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    const a = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'lower' }, board.agents);
    const b = await messages.sendAsync({ fromPane: '%7', to: 'Casey', text: 'upper' }, board.agents);
    assert.equal(a.held && b.held, true, JSON.stringify([a, b]));
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), [a.id, b.id], 'a second queue was made for the other spelling');
    assert.deepEqual(limitqueue.list('Casey'), []);
  });
});

test('#5805 2a review 14: a queue file that cannot be read is never overwritten or deleted; a missing one starts empty', async () => {
  const t = new Date().toISOString();
  fs.mkdirSync(limitqueue.dir(), { recursive: true });
  const file = limitqueue.fileFor('casey');
  fs.writeFileSync(file, '[{"id":"m1080","from":"leo","to":"casey","envelope":"kept"');   // cut off mid-write
  assert.equal(limitqueue.add('casey', { id: 'm1081', from: 'leo', envelope: 'new', at: t, reset: t }), false, 'a send overwrote an unreadable backlog');
  assert.equal(limitqueue.remove('casey', 'm1080'), false);
  assert.deepEqual(limitqueue.names(), [], 'CONTROL: nothing listed from it');
  assert.equal(fs.readFileSync(file, 'utf8'), '[{"id":"m1080","from":"leo","to":"casey","envelope":"kept"', 'the unreadable file was changed or deleted');
  fs.writeFileSync(file, JSON.stringify([{ id: 'm1082', from: 'leo', to: 'casey', envelope: 'kept', at: t, reset: t }]));
  fs.chmodSync(file, 0o000);
  try {
    if (process.getuid && process.getuid() !== 0) {
      assert.equal(limitqueue.add('casey', { id: 'm1083', from: 'leo', envelope: 'new', at: t, reset: t }), false, 'a send overwrote a file it could not read');
      limitqueue.names();
      assert.equal(fs.existsSync(file), true, 'the listing deleted a file it could not read');
    }
  } finally { fs.chmodSync(file, 0o600); }
  assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m1082']);
  fs.rmSync(file, { force: true });
  assert.equal(limitqueue.add('casey', { id: 'm1084', from: 'leo', envelope: 'new', at: t, reset: t }), true, 'CONTROL: a missing file did not start empty');
});

test('#5805 2a review 15: a refusal says why: the per-sender cap is named, not "out of usage, could not keep"', async () => {
  const t = new Date().toISOString();
  for (let i = 0; i < limitqueue.MAX_PER_SENDER; i += 1) limitqueue.add('casey', { id: 'mq' + i, from: 'leo', envelope: 'e' + i, at: t, reset: t });
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'one more' }, board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
    assert.match(v.because, /already keeping 20 messages from you/, v.because);
  });
});

test('#5805 2a review 15: a message being typed by a run that outlived the guard is not dropped under it', async () => {
  const t = new Date().toISOString();
  limitqueue.add('casey', { id: 'm1090', from: 'leo', envelope: 'slow', at: t, reset: t });
  let release;
  const gate = new Promise((r) => { release = r; });
  const dropped = [];
  const o = (extra) => ({ deliver: async () => { await gate; return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDropped: (e) => dropped.push(e.id), ...extra });
  const run1 = limitqueue.flush(caseyRoster(), o());
  await new Promise((r) => setTimeout(r, 20));
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60e3;
  try { await limitqueue.flush(caseyRoster(), o({ now: realNow() + limitqueue.DROP_AFTER_MS + 60e3 })); } finally { Date.now = realNow; }
  assert.deepEqual(dropped, [], 'dropped (and its sender told "never delivered") while it was being typed');
  release();
  await run1;
});

test('#5805 2a review 15: the board wires the sweep to the automatic gate, the release test and both outcome rows', () => {
  // Slice 2b moved the hooks into limitqueue.sweepHooks; the board passes them, and they carry the same wiring.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /limitqueue\.flush\(roster, limitqueue\.sweepHooks\(\{ chat, messages \}\)\)/, 'the sweep is not wired to sweepHooks');
  const lq = fs.readFileSync(path.join(__dirname, 'limitqueue.js'), 'utf8');
  const at = lq.indexOf('function sweepHooks(');
  const body = lq.slice(at, lq.indexOf('\nfunction ', at + 1));   // the whole function, however long it grows
  for (const want of [/chat\.deliverAutomaticAsync\(n, env, r\)/, /isReleased: chat\.limitQueueReleased/, /messages\.logHeldDelivered\(e, v\)/, /messages\.tellHeldDropped\(e, r\)/]) {
    assert.match(body, want);
  }
});

test('#5805 2a review 15: a repeat of a message typed but not removed from the file answers as that delivery, not held', async () => {
  let first;
  await withFleet(AHEAD(), 'rate_limited', async (board) => { first = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'typed once' }, board.agents); });
  await withFleet(undefined, 'idle', async (board) => {
    const folder = path.dirname(limitqueue.fileFor('casey'));
    const o = { ...opts(), deliver: async () => { fs.chmodSync(folder, 0o500); return { state: chat.DELIVERY.PLACED }; } };
    try { await limitqueue.flush(board.agents, o); } finally { fs.chmodSync(folder, 0o700); }
    assert.equal(limitqueue.isDone(first.id), true, 'CONTROL: the removal did fail');
    fs.rmSync(messages.LOG, { recursive: true, force: true });   // past the recent-send window
    messages.resetForTests();
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    // The held-delivered row went with the log; put the record back as the board would have it.
    messages.logHeldDelivered({ id: first.id, from: 'leo', to: 'casey' }, { state: chat.DELIVERY.PLACED });
    const again = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'typed once' }, board.agents);
    assert.notEqual(again.held, true, 'told held for a message already typed: ' + JSON.stringify(again));
    assert.deepEqual([again.state, again.id, again.duplicate], [chat.DELIVERY.PLACED, first.id, true]);
  });
});

test('#5805 2a review 16: a paste that never settles does not hold its agent for good: a claim older than CLAIM_STALE_MS is stale', async () => {
  const t = new Date().toISOString();
  limitqueue.add('casey', { id: 'm1100', from: 'leo', envelope: 'hangs', at: t, reset: t });
  const typed = [];
  limitqueue.flush(caseyRoster(), { deliver: async (n, env) => { typed.push(bare(env)); return new Promise(() => {}); }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(limitqueue.isTyping('m1100'), true, 'CONTROL: claimed while the paste hangs');
  const realNow = Date.now;
  Date.now = () => realNow() + limitqueue.CLAIM_STALE_MS + 60e3;
  try {
    assert.equal(limitqueue.isTyping('m1100'), false, 'a claim older than CLAIM_STALE_MS still holds the queue');
    await limitqueue.flush(caseyRoster(), { deliver: async (n, env) => { typed.push(bare(env)); return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY });
  } finally { Date.now = realNow; }
  assert.deepEqual(typed, ['hangs', 'hangs'], 'the hung message was not tried again');
  assert.deepEqual(limitqueue.list('casey'), []);
});

test('#5805 2a review 17: a queue file unreadable mid-run stops that agent, so nothing is typed ahead of a skipped message', async () => {
  const t = new Date().toISOString();
  for (const id of ['m1110', 'm1111']) limitqueue.add('casey', { id, from: 'leo', envelope: id, at: t, reset: t });
  const file = limitqueue.fileFor('casey');
  const good = fs.readFileSync(file, 'utf8');
  const typed = [];
  let reads = 0;
  // The file reads garbage exactly once, on its third read (after names() and the sweep's own list): the check just
  // before typing the first message.
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { if (p === file && ++reads === 3) return '[{"cut'; return realRead.call(fs, p, ...rest); };
  try {
    await limitqueue.flush(caseyRoster(), { deliver: async (n, env) => { typed.push(bare(env)); return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY });
  } finally { fs.readFileSync = realRead; }
  assert.deepEqual(typed, [], 'a later message was typed after one was skipped on a bad read');
  assert.equal(fs.readFileSync(file, 'utf8'), good, 'CONTROL: the backlog is intact');
});

test('#5805 2a review 17: a message queued behind a backlog is noted as kept behind, not as kept while out of usage', () => {
  assert.equal(limitqueue.keptNote({ at: 'T', behind: true }), ' [kept behind earlier messages; sent T]');
  assert.equal(limitqueue.keptNote({ at: 'T' }), ' [kept for you while you were out of usage; sent T]');
});

test('#5805 2a review 18: a send to a released agent whose queue cannot be read is refused, never typed ahead of a backlog', async () => {
  fs.mkdirSync(limitqueue.dir(), { recursive: true });
  fs.writeFileSync(limitqueue.fileFor('casey'), '[{"cut');
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text: 'not ahead' }, board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.match(v.because, /could not be read or written\); try again in a minute/);
    assert.deepEqual(tmux.pastedTo('casey'), [], 'typed ahead of a queue it could not read');
  });
});

test('#6065 review 1: a message that fits now but not with the kept note is spilled, so a held copy is still typed later', async () => {
  // About 60 short of chat's limit: with its envelope it fits now, but not with the note a held message is typed with.
  const text = 'w'.repeat(chat.MAX_TEXT - 60);
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'casey'), { recursive: true });   // its own folder, for the spill
  let id;
  await withFleet(AHEAD(), 'rate_limited', async (board) => {
    const v = await messages.sendAsync({ fromPane: '%7', to: 'casey', text }, board.agents);
    assert.equal(v.held, true, JSON.stringify(v));
    id = v.id;
  });
  await withFleet(undefined, 'idle', async (board, tmux) => {
    const done = await limitqueue.flush(board.agents, { deliver: chat.deliverAutomaticAsync, isReleased: chat.limitReleased, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY, onDelivered: messages.logHeldDelivered, onDropped: messages.logHeldDropped });
    assert.deepEqual(done.map((d) => d.id), [id], 'the held message was refused when typed with its kept note');
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1);
    assert.match(typed[0], /long message, 1 word; the full text is in your own folder at /, 'it was not spilled');
    assert.match(typed[0], /kept for you while you were out of usage/);
    assert.deepEqual(limitqueue.list('casey'), []);
  });
});

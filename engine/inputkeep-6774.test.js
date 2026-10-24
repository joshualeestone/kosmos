'use strict';

/**
 * kosmos#6774: a `kosmos msg` refused because the recipient's input box holds text not yet sent (#6249) is kept, and the
 * board's minute sweep types it once the box reads empty: in order, once each. The same send again while it is kept is
 * that copy, never a second one. Screens are the #6249 composer captures; cards come from test-support/fleet; "was it
 * typed" reads the scripted tmux runner's pastes.
 *
 *   node --test engine/inputkeep-6774.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-inputkeep-6774-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const messages = require('./messages');
const limitqueue = require('./limitqueue');
const store = require('./store');
const fleet = require('../test-support/fleet');

const SCREENS = path.join(__dirname, '..', 'test-support', 'composer-6249');
const EMPTY = fs.readFileSync(path.join(SCREENS, 'empty-after-turn.ansi'), 'utf8');
// A real capture of the box holding words nobody sent ("hello there unsent words").
const STUCK = fs.readFileSync(path.join(SCREENS, 'typed-short.ansi'), 'utf8');

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
/* A tmux runner whose `capture-pane -e` answers whatever `screen.now` is, so a test can clear the box between steps. */
function arm(screen) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return ok('2.1.300\t\t0\n');
    if (args[0] === 'capture-pane' && args.includes('-e')) return ok(screen.now);
    return ok();
  };
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
  chat.setRunner(fn);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return fn;
}
async function withFleet(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('casey', { state: 'idle', runner: 'claude', command: 'claude' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  const screen = { now: STUCK };
  try { return await fn(board, arm(screen), screen); } finally { chat.resetForTests(); board.restore(); }
}
const send = (board, text) => messages.sendAsync({ fromPane: '%7', to: 'casey', text }, board.agents);
const flush = (board) => limitqueue.flush(board.agents, limitqueue.sweepHooks({ chat, messages }));

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  limitqueue.resetForTests();
  for (const d of [messages.LOG, limitqueue.dir()]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { chat.setRunner(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

test('#6774: two messages refused by a stuck box are kept, then typed in order, once each, when the box clears', async () => {
  await withFleet(async (board, tmux, screen) => {
    const a = await send(board, 'first, the plan for tonight');
    assert.equal(a.held, true, JSON.stringify(a));
    assert.equal(a.heldFor, 'input');
    assert.equal(a.state, chat.DELIVERY.COULD_NOT, 'held must not read as delivered');
    assert.match(a.because, /input box holds text not yet sent; Kosmos types it once the box is clear/);
    const b = await send(board, 'second, and then the release');
    assert.equal(b.held, true, JSON.stringify(b));
    assert.equal(b.behind, true);
    assert.equal(b.behindFor, 'input', 'the CLIs word it from this field');
    assert.match(b.because, /still has messages kept while its input box held text not yet sent/);
    assert.deepEqual(tmux.pastedTo('casey'), [], 'a held message was typed behind the stuck text');
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), [a.id, b.id]);
    assert.equal(limitqueue.list('casey')[0].input, true);

    // Still stuck: the sweep types nothing.
    assert.deepEqual(await flush(board), []);
    assert.deepEqual(tmux.pastedTo('casey'), []);

    screen.now = EMPTY;
    const done = await flush(board);
    assert.deepEqual(done.map((d) => d.id), [a.id, b.id]);
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 2, JSON.stringify(typed));
    assert.match(typed[0], /first, the plan for tonight/);
    assert.match(typed[0], /\[kept for you while your input box held text not yet sent; sent /);
    assert.match(typed[1], /second, and then the release/);
    assert.deepEqual(limitqueue.list('casey'), []);
    // Once each: a later sweep has nothing left to type.
    assert.deepEqual(await flush(board), []);
    assert.equal(tmux.pastedTo('casey').length, 2);
    assert.deepEqual(messages.list('casey').filter((r) => r.kind === 'held-delivered').map((r) => r.of), [a.id, b.id]);
  });
});

test('#6774 CONTROL: the sender sending the same message again by hand while it is kept gets that copy; it goes once', async () => {
  await withFleet(async (board, tmux, screen) => {
    const a = await send(board, 'please pick up the card');
    const again = await send(board, 'please pick up the card');
    assert.deepEqual([again.held, again.id, again.duplicate, again.heldFor], [true, a.id, true, 'input']);
    assert.equal(limitqueue.list('casey').length, 1, 'kept twice');
    screen.now = EMPTY;
    await flush(board);
    assert.equal(tmux.pastedTo('casey').filter((t) => /please pick up the card/.test(t)).length, 1, 'typed twice');
  });
});

test('#6774 CONTROL: with the box empty, a message is typed at once and nothing is kept', async () => {
  await withFleet(async (board, tmux, screen) => {
    screen.now = EMPTY;
    const v = await send(board, 'hello');
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.equal(tmux.pastedTo('casey').length, 1);
    assert.deepEqual(limitqueue.list('casey'), []);
  });
});

test('#6774: a queue holding a message kept for the box waits while the box cannot be read', async () => {
  await withFleet(async (board, tmux, screen) => {
    await send(board, 'kept for the box');
    screen.now = null;   // capture answers nothing readable
    const hooks = limitqueue.sweepHooks({ chat, messages });
    const card = chat.resolveCard(board.agents, 'casey');
    assert.equal(hooks.isReleased(card, board.agents, limitqueue.list('casey')), false, 'an unreadable box released the queue');
    // Through the sweep itself: the delivery gate types into a box it cannot read, so this check is what holds it.
    assert.deepEqual(await flush(board), []);
    assert.deepEqual(tmux.pastedTo('casey'), [], 'typed into a box that could not be read');
    // CONTROL: the same card with only an out-of-usage entry (no input flag) is released by the limit rule alone.
    assert.equal(hooks.isReleased(card, board.agents, [{ id: 'x', envelope: 'y' }]), true);
  });
});

test('#6774: a kosmos msg kept behind the box backlog carries the flag, so a third is still told the box is the reason', async () => {
  await withFleet(async (board) => {
    await send(board, 'one');
    await send(board, 'two');
    assert.deepEqual(limitqueue.list('casey').map((e) => e.input === true), [true, true]);
    const c = await send(board, 'three');
    assert.equal(c.behindFor, 'input', JSON.stringify(c));
  });
});

test('#6774: a mixed queue (one kept for a usage limit, one for the box) waits for both rules', async () => {
  const hooks = limitqueue.sweepHooks({ chat, messages });
  const real = { e: chat.inputBoxEmpty, r: chat.limitQueueReleased };
  const live = [{ id: 'a', envelope: 'x' }, { id: 'b', envelope: 'y', input: true }];
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);   // a real card, never a hand-built one
  const card = board.agents.find((c) => c.sessionName === 'casey');
  try {
    for (const [limitOk, boxEmpty, want] of [[true, true, true], [false, true, false], [true, false, false]]) {
      chat.limitQueueReleased = () => limitOk;
      chat.inputBoxEmpty = () => boxEmpty;
      assert.equal(hooks.isReleased(card, [], live), want, `limit ${limitOk}, box empty ${boxEmpty}`);
    }
  } finally { chat.inputBoxEmpty = real.e; chat.limitQueueReleased = real.r; board.restore(); }
});

test('#6774: a kosmos msg re-sent while kept BEHIND the box backlog is told the box is the reason', async () => {
  await withFleet(async (board) => {
    await send(board, 'one');
    const two = await send(board, 'two');
    const again = await send(board, 'two');
    assert.deepEqual([again.duplicate, again.id, again.behindFor], [true, two.id, 'input'], JSON.stringify(again));
  });
});

test('#6774: past the fold window, a kosmos msg re-sent behind the backlog is answered by its kept copy with the box reason', async () => {
  await withFleet(async (board) => {
    await send(board, 'one');
    const two = await send(board, 'two');
    // The first copy's log rows an hour old: the recent-send fold no longer sees it, so the kept-copy key answers.
    const old = new Date(Date.now() - 3600e3).toISOString();
    const rows = fs.readFileSync(messages.LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    fs.writeFileSync(messages.LOG, rows.map((r) => JSON.stringify({ ...r, at: old })).join('\n') + '\n');
    messages.resetForTests();
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));   // reset drops the sender stub
    const again = await send(board, 'two');
    assert.deepEqual([again.duplicate, again.id, again.behindFor], [true, two.id, 'input'], JSON.stringify(again));
  });
});

test('#6774: behind a mixed backlog (one kept for a limit, one for the box), the flag and the reason follow one rule', async () => {
  await withFleet(async (board, tmux, screen) => {
    const at = new Date().toISOString();
    limitqueue.add('casey', { id: 'm-limit', from: 'leo', envelope: 'a', at, reset: at });
    limitqueue.add('casey', { id: 'm-box', from: 'leo', envelope: 'b', at, reset: at, input: true });
    screen.now = EMPTY;
    const c = await send(board, 'three');
    assert.equal(c.behind, true, JSON.stringify(c));
    assert.equal(c.behindFor, 'input');
    assert.equal(limitqueue.list('casey').find((e) => e.id === c.id).input, true, 'the flag and the words disagree');
  });
});

test('#6774: a task line kept behind messages kept for the box is flagged and told that reason, not a usage limit', async () => {
  await withFleet(async (board, tmux, screen) => {
    await send(board, 'kept for the box');
    screen.now = EMPTY;
    const v = messages.keepTaskLine('casey', 'task line', board.agents, 'leo', 'task 1');
    assert.ok(v, 'the line was typed ahead of the kept message');
    assert.equal(v.behindFor, 'input', JSON.stringify(v));
    assert.match(v.because, /kept while its input box held text not yet sent/);
    assert.equal(limitqueue.list('casey').find((e) => e.id === v.id).input, true);
  });
});

test('#6774: a kosmos msg re-sent AFTER the recipient answered is a new message, not folded; CONTROL: before, it folds', async () => {
  await withFleet(async (board) => {
    const a = await send(board, 'yes');
    const again = await send(board, 'yes');
    assert.equal(again.duplicate, true, 'CONTROL: with no answer between, the re-send folds');
    // casey answers leo (its row, as the board logs a delivered message), then leo says yes again.
    fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'message', id: 'm900', from: 'casey', to: 'leo', text: 'ship it too?', at: new Date(Date.now() + 5).toISOString(), state: 'placed' }) + '\n');
    messages.resetForTests();
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    await new Promise((r) => setTimeout(r, 10));
    const after = await send(board, 'yes');
    assert.notEqual(after.duplicate, true, 'folded an answer given after the recipient spoke: ' + JSON.stringify(after));
    assert.notEqual(after.id, a.id);
    assert.equal(after.held, true);
    assert.equal(limitqueue.list('casey').length, 2);
  });
});

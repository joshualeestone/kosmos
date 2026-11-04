'use strict';

/**
 * kosmos#7936: a `kosmos msg` kept because its recipient's input box held text not yet sent was kept for a day, and
 * its sender learned only at the drop, after the round it belonged to had closed. Now its sender is told once, ten
 * minutes in, that it is still held and when it drops, and it drops after two hours. A usage-limit hold keeps its day.
 * Cards come from test-support/fleet; "who was told" reads the scripted tmux runner's recorded pastes.
 *
 *   node --test engine/heldnote-7936.test.js
 */

const os = require('node:os');
const path = require('node:path');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-heldnote-7936-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const limitqueue = require('./limitqueue');
const store = require('./store');
const fleet = require('../test-support/fleet');

test('sandbox: the store root is inside this process\'s temp dir', () => {
  assert.ok(path.resolve(store.ROOT).startsWith(path.resolve(os.tmpdir()) + path.sep), store.ROOT);
});

function fakeTmux() {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
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
  return fn;
}
async function withFleet(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('casey', { state: 'idle', runner: 'claude', command: 'claude' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  const t = fakeTmux();
  chat.setRunner(t); chat.setDryRun(false); chat.setPauser(() => {});
  try { return await fn(board, t); } finally { chat.resetForTests(); board.restore(); }
}
test.beforeEach(() => {
  chat.resetForTests(); messages.resetForTests(); limitqueue.resetForTests();
  for (const d of [messages.LOG, limitqueue.dir()]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* The board's own hooks (limitqueue.sweepHooks, as server.js passes them), with the box never clearing (isReleased
   false: nothing is typed), the box taken as the reason (boxIsReason true) unless a test says otherwise, and, where
   a test says so, the messages module swapped. The tellers type
   asynchronously, so the sweep waits a turn for their pastes. */
async function sweep(board, now, extra = {}, msgs = messages) {
  await limitqueue.flush(board.agents, { ...limitqueue.sweepHooks({ chat, messages: msgs }), isReleased: () => false, boxIsReason: () => true, now, ...extra });
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}
const MIN = 60e3;

test('#7936: an input-held message: its sender is told once, ten minutes in, that it is still held and when it drops', async () => {
  await withFleet(async (board, tmux) => {
    const at = Date.now() - 9 * MIN;
    limitqueue.add('casey', { id: 'm7936', from: 'leo', envelope: 'x', at: new Date(at).toISOString(), reset: new Date(at).toISOString(), input: true });
    await sweep(board, at);   // the board was running when it arrived: its first sweep for casey starts the clock
    await sweep(board, Date.now());
    assert.deepEqual(tmux.pastedTo('leo'), [], 'CONTROL: nine minutes in, nothing is said yet');
    await sweep(board, at + limitqueue.STILL_HELD_TELL_MS + 1000);
    const lines = tmux.pastedTo('leo');
    assert.equal(lines.length, 1, 'the sender was not told it is still held');
    const dropAt = new Date(at + limitqueue.INPUT_DROP_AFTER_MS).toISOString();
    assert.match(lines[0], /Your message m7936 to casey is still held: casey's input box holds text not yet sent\./);
    assert.ok(lines[0].includes('drops it at ' + dropAt + ' if the box is still full then, and tells you.'), lines[0]);
    await sweep(board, at + limitqueue.STILL_HELD_TELL_MS + 5 * MIN);
    assert.equal(tmux.pastedTo('leo').length, 1, 'told twice');
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m7936'], 'still kept after the notice');
  });
});

test('#7936: an input-held message drops after two hours and says so; a usage-limit hold of the same age is kept', async () => {
  await withFleet(async (board, tmux) => {
    const at = Date.now() - limitqueue.INPUT_DROP_AFTER_MS - MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7937', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    limitqueue.add('casey', { id: 'm7938', from: 'leo', envelope: 'y', at: iso, reset: iso });   // CONTROL: a usage-limit hold
    await sweep(board, at);   // the board's first sweep for casey, when they arrived
    await sweep(board, Date.now());
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m7938'], 'the input-held one was not dropped, or the limit one was');
    const lines = tmux.pastedTo('leo');
    assert.ok(lines.some((l) => /Your message m7937 to casey was never delivered: Kosmos kept it for two hours while its input box held text not yet sent and could not type it\./.test(l)), lines.join('\n'));
    assert.ok(!lines.some((l) => /m7938/.test(l)), 'the usage-limit hold was told about');
  });
});

test('#7936: a task line kept behind an input box keeps the day (its own notices); only a `kosmos msg` is shortened', () => {
  assert.equal(limitqueue.dropAfter({ input: true }), limitqueue.INPUT_DROP_AFTER_MS);
  assert.equal(limitqueue.dropAfter({ input: true, kind: limitqueue.TASK_KIND }), limitqueue.DROP_AFTER_MS);
  assert.equal(limitqueue.dropAfter({ input: true, kind: 'dm' }), limitqueue.DROP_AFTER_MS);
  assert.equal(limitqueue.dropAfter({}), limitqueue.DROP_AFTER_MS);
  assert.equal(typeof messages.HELD_TELL_MAX_MS, 'number', 'CONTROL: the room figure is exported, so the next line compares something');
  assert.equal(limitqueue.INPUT_DROP_AFTER_MS, messages.HELD_TELL_MAX_MS, 'the two-hour figures drifted apart');
});

test('#7936: the send receipt for an input-held message names the two-hour drop', () => {
  const src = fs.readFileSync(path.join(__dirname, 'messages.js'), 'utf8');
  assert.ok(src.includes("Kosmos types it once the box is clear, or, after 2 hours with the box still full, drops it and tells you"), 'receipt wording');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos'), 'utf8');
  assert.ok(cli.includes('Kosmos types it once the box is clear, or, after 2 hours with the box still full, drops it and tells you; do not re-send.'), 'CLI wording');
});

test('#7936 item 2: the unanswered list names the flag kosmos post takes (--in-reply-to), never --reply-to', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos'), 'utf8');
  assert.ok(/kosmos post \[--no-reply\] \[--in-reply-to <id>\]/.test(cli), 'CONTROL: post takes --in-reply-to');
  assert.ok(src.includes("no post of yours cites it by id with --in-reply-to)"), 'the header names --in-reply-to');
  assert.ok(!src.includes("cites it by id with --reply-to)"), 'the header still names --reply-to');
});

test('#7936 reviews 1-3, 7: while the box is not the only reason (a limit, a box read empty or unread), the day applies and no notice goes', async () => {
  await withFleet(async (board, tmux) => {
    const at = Date.now() - limitqueue.INPUT_DROP_AFTER_MS - 10 * MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7940', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    await sweep(board, at, { boxIsReason: () => true });   // the clock starts at arrival, the box the reason then
    // From then on something else holds casey. Past 2 hours from arrival, the day applies and nobody is told.
    await sweep(board, at + limitqueue.STILL_HELD_TELL_MS + MIN, { boxIsReason: () => false });
    await sweep(board, Date.now(), { boxIsReason: () => false });
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m7940'], 'dropped at 2 hours while the box was not the only reason');
    assert.deepEqual(tmux.pastedTo('leo'), [], 'told about the input box while the box was not the only reason');
  });
});

test('#7936 review 7: CONTROL for the test above: the box the reason throughout, the same message drops', async () => {
  await withFleet(async (board) => {
    const at = Date.now() - limitqueue.INPUT_DROP_AFTER_MS - 10 * MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7947', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    await sweep(board, at, { boxIsReason: () => true });
    await sweep(board, Date.now(), { boxIsReason: () => true });
    assert.deepEqual(limitqueue.list('casey'), [], 'not dropped though the box was the reason for over 2 hours');
  });
});

test('#7936 review 3: the board passes boxIsReason as "released on usage and sign-in, and the box reads text"', () => {
  const hooks = limitqueue.sweepHooks({ chat, messages });
  const rel = chat.limitQueueReleased, reads = chat.inputBoxReads;
  try {
    const cases = [[true, 'text', true], [true, 'empty', false], [true, 'unread', false], [false, 'text', false]];
    for (const [released, box, want] of cases) {
      chat.limitQueueReleased = () => released; chat.inputBoxReads = () => box;
      assert.equal(hooks.boxIsReason({ sessionName: 'casey' }, []), want, JSON.stringify({ released, box }));
    }
  } finally { chat.limitQueueReleased = rel; chat.inputBoxReads = reads; }
});

test('#7936 review 3: a caller that passes no boxIsReason keeps the day', async () => {
  await withFleet(async (board) => {
    const at = Date.now() - limitqueue.INPUT_DROP_AFTER_MS - 10 * MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7945', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    const hooks = limitqueue.sweepHooks({ chat, messages }); delete hooks.boxIsReason;
    await limitqueue.flush(board.agents, { ...hooks, isReleased: () => false, now: at });   // the board's first sweep, at arrival
    await limitqueue.flush(board.agents, { ...hooks, isReleased: () => false, now: Date.now() });
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m7945'], 'dropped at 2 hours with no box verdict');
  });
});

test('#7936: a still-held notice that does not land is tried again after STILL_RETRY_MS, not sooner, and not after it lands', async () => {
  await withFleet(async (board) => {
    const at = Date.now() - limitqueue.STILL_HELD_TELL_MS - MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7941', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    await sweep(board, at, {}, { ...messages, tellHeldStill: async () => ({ state: chat.DELIVERY.PLACED }) });   // first sweep, at arrival
    const tries = [];
    let answer = { state: chat.DELIVERY.COULD_NOT, because: 'held: a menu is up' };
    const fake = { ...messages, tellHeldStill: async (e) => { tries.push(e.id); const v = answer; answer = { state: chat.DELIVERY.PLACED }; return v; } };
    await sweep(board, Date.now(), {}, fake);
    assert.deepEqual(tries, ['m7941'], 'not tried');
    await sweep(board, Date.now() + MIN, {}, fake);
    assert.deepEqual(tries, ['m7941'], 'tried again within STILL_RETRY_MS (a stall streak of Kosmos\'s own retries)');
    await sweep(board, Date.now() + limitqueue.STILL_RETRY_MS + MIN, {}, fake);
    assert.deepEqual(tries, ['m7941', 'm7941'], 'a notice that did not land was not tried again');   // this one lands
    await sweep(board, Date.now() + 2 * limitqueue.STILL_RETRY_MS + 2 * MIN, {}, fake);
    await sweep(board, Date.now() + 3 * limitqueue.STILL_RETRY_MS + 3 * MIN, {}, fake);
    assert.equal(tries.length, 2, 'tried again after it landed');
  });
});

test('#7936 review 2: a card that cannot be read counts as limited, so a doubt keeps the day', async () => {
  for (const [id, doubt] of [['m7942', { resolveCard: () => null, boxIsReason: () => true }], ['m7948', { boxIsReason: () => { throw new Error('no verdict'); } }]]) {
    await withFleet(async (board, tmux) => {
      limitqueue.resetForTests();
      const at = Date.now() - limitqueue.INPUT_DROP_AFTER_MS - 10 * MIN;
      const iso = new Date(at).toISOString();
      limitqueue.add('casey', { id, from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
      await sweep(board, at, { boxIsReason: () => true });   // clock started at arrival, the box the reason
      await sweep(board, Date.now(), doubt);
      assert.deepEqual(limitqueue.list('casey').map((e) => e.id), [id], 'dropped at 2 hours on a doubt: ' + id);
      assert.deepEqual(tmux.pastedTo('leo'), [], 'a notice went out on a doubt: ' + id);
      limitqueue.remove('casey', id);
    });
  }
});

test('#7936 review 2: after a limit ends, the 2 hours count from when the box became the only reason', async () => {
  await withFleet(async (board, tmux) => {
    const t0 = Date.now() - 5 * 60 * MIN;   // kept 5 hours ago
    const iso = new Date(t0).toISOString();
    limitqueue.add('casey', { id: 'm7943', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    await sweep(board, t0, { boxIsReason: () => true });   // review 7: the clock first starts at arrival
    const limitEnd = Date.now() - 30 * MIN;
    await sweep(board, limitEnd, { boxIsReason: () => false });   // the last sweep that saw casey limited
    await sweep(board, Date.now(), { boxIsReason: () => true });
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m7943'], 'dropped though the box has been the only reason for 30 minutes');
    const lines = tmux.pastedTo('leo');
    assert.equal(lines.length, 1, 'the sender was not told once the box was the only reason for 10 minutes');
    assert.ok(lines[0].includes('drops it at ' + new Date(limitEnd + limitqueue.INPUT_DROP_AFTER_MS).toISOString()), lines[0]);
    await sweep(board, limitEnd + limitqueue.INPUT_DROP_AFTER_MS + MIN, { boxIsReason: () => true });
    assert.deepEqual(limitqueue.list('casey'), [], 'CONTROL: 2 hours after the limit ended it drops');
  });
});

test('#7936 reviews 7-8: no still-held notice while one more failure could make the sender\'s stall alert; a delivery that lands lifts it', async () => {
  const ds = require('./deliverystreak');
  await withFleet(async (board) => {
    ds.reset('leo');
    const at = Date.now() - limitqueue.STILL_HELD_TELL_MS - MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7950', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    await sweep(board, at, { boxIsReason: () => true });
    const tries = [];
    const fake = { ...messages, tellHeldStill: async (e) => { tries.push(e.id); return { state: chat.DELIVERY.PLACED }; } };
    for (let k = 0; k < ds.STALL_MIN_FAILS - 1; k++) ds.note('leo', { state: 'could_not', because: 'held: a menu is up' });
    assert.equal(ds.failCount('leo'), ds.STALL_MIN_FAILS - 1, 'CONTROL: the streak holds the failures the test noted');
    await sweep(board, Date.now(), {}, fake);
    assert.deepEqual(tries, [], 'a notice went out that could make the stall alert');
    ds.note('leo', { state: 'placed' });   // a delivery to leo lands: its streak ends
    await sweep(board, Date.now() + MIN, {}, fake);
    assert.deepEqual(tries, ['m7950'], 'no notice once the streak ended');
    ds.reset('leo');
  });
});

test('#7936 review 7: one still-held notice per sender per sweep, across every recipient', async () => {
  await withFleet(async (board) => {
    const at = Date.now() - limitqueue.STILL_HELD_TELL_MS - MIN;
    const iso = new Date(at).toISOString();
    for (const id of ['m7951', 'm7952']) limitqueue.add('casey', { id, from: 'leo', envelope: id, at: iso, reset: iso, input: true });
    await sweep(board, at, { boxIsReason: () => true });
    const tries = [];
    const fake = { ...messages, tellHeldStill: async (e) => { tries.push(e.id); return { state: chat.DELIVERY.PLACED }; } };
    await sweep(board, Date.now(), {}, fake);
    assert.equal(tries.length, 1, 'more than one notice to one sender in a sweep: ' + tries.join(','));
    await sweep(board, Date.now() + MIN, {}, fake);
    assert.equal(tries.length, 2, 'CONTROL: the second message is told at the next sweep');
  });
});

test('#7936 review 2: a message typed in the same sweep gets no still-held notice', async () => {
  await withFleet(async (board) => {
    const iso = new Date(Date.now() - limitqueue.STILL_HELD_TELL_MS - MIN).toISOString();
    limitqueue.add('casey', { id: 'm7944', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    const tries = [];
    const fake = { ...messages, tellHeldStill: async (e) => { tries.push(e.id); return { state: chat.DELIVERY.PLACED }; } };
    await sweep(board, Date.now(), { isReleased: () => true, deliver: async () => ({ state: chat.DELIVERY.PLACED }) }, fake);
    assert.deepEqual(limitqueue.list('casey'), [], 'CONTROL: the message was typed in this sweep');
    assert.deepEqual(tries, [], 'a still-held notice followed a message just typed');
  });
});

test('#7936 review 4: after a board restart the first sweep starts the clock: an old message is not dropped on sight', async () => {
  await withFleet(async (board, tmux) => {
    const iso = new Date(Date.now() - 5 * 60 * MIN).toISOString();   // kept 5 hours ago, while the agent was limited
    limitqueue.add('casey', { id: 'm7946', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    const first = Date.now();
    await sweep(board, first);   // the restarted board's first sweep, the box now the only reason
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m7946'], 'dropped on the first sweep after a restart');
    await sweep(board, first + limitqueue.STILL_HELD_TELL_MS + MIN);
    assert.equal(tmux.pastedTo('leo').length, 1, 'the sender was not told ten minutes after the restart');
    await sweep(board, first + limitqueue.INPUT_DROP_AFTER_MS + MIN);
    assert.deepEqual(limitqueue.list('casey'), [], 'CONTROL: 2 hours after the restart it drops');
  });
});

test('#7936 review 6: a task line kept behind an input-held message is not promised the 2-hour drop (it keeps the day)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'messages.js'), 'utf8');
  assert.ok(src.includes("{ behindInput, task: true }), state: HELD_STATE };"), 'the task route marks its receipt as a task line');
  assert.ok(src.includes("more.behindInput === true && more.task !== true ? ', or, after 2 hours with the box still full, drops it and tells you' : ''"), 'the clause is not for task lines');
});

test('#7936 review 9: one failure in the sender\'s streak still leaves room for a notice (the boundary is two short)', async () => {
  const ds = require('./deliverystreak');
  await withFleet(async (board) => {
    ds.reset('leo');
    const at = Date.now() - limitqueue.STILL_HELD_TELL_MS - MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7953', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    await sweep(board, at, { boxIsReason: () => true });
    ds.note('leo', { state: 'could_not', because: 'held: a menu is up' });
    assert.equal(ds.failCount('leo'), 1, 'CONTROL: one failure noted');
    const tries = [];
    const fake = { ...messages, tellHeldStill: async (e) => { tries.push(e.id); return { state: chat.DELIVERY.PLACED }; } };
    await sweep(board, Date.now(), {}, fake);
    assert.deepEqual(tries, ['m7953'], 'no notice with only one failure in the streak');
    ds.reset('leo');
  });
});

test('#7936 review 9: a notice still in flight counts against the sender, so the next sweep sends no second one', async () => {
  const ds = require('./deliverystreak');
  await withFleet(async (board) => {
    ds.reset('leo');
    const at = Date.now() - limitqueue.STILL_HELD_TELL_MS - MIN;
    const iso = new Date(at).toISOString();
    for (const id of ['m7954', 'm7955']) limitqueue.add('casey', { id, from: 'leo', envelope: id, at: iso, reset: iso, input: true });
    await sweep(board, at, { boxIsReason: () => true });
    ds.note('leo', { state: 'could_not', because: 'held: a menu is up' });   // one failure: room for exactly one more
    const tries = [];
    let release;
    const pending = new Promise((r) => { release = r; });
    const fake = { ...messages, tellHeldStill: async (e) => { tries.push(e.id); await pending; return { state: chat.DELIVERY.COULD_NOT }; } };
    await sweep(board, Date.now(), {}, fake);
    await sweep(board, Date.now() + MIN, {}, fake);
    assert.equal(tries.length, 1, 'a second notice went out while the first was still in flight: ' + tries.join(','));
    release();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    ds.reset('leo');
  });
});

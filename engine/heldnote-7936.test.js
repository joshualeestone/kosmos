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

/* The sweep's hooks with the box never clearing (nothing is typed), and the real tellers. */
const told = [];
const opts = (now) => ({
  now, deliver: chat.deliverAutomaticAsync, isReleased: () => false, resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY,
  onDelivered: messages.logHeldDelivered,
  onDropped: (e, r) => { told.push(messages.tellHeldDropped(e, r)); },
  onStillHeld: (e, r, dropAt) => { told.push(messages.tellHeldStill(e, r, dropAt)); },
});
async function sweep(board, now) { told.length = 0; await limitqueue.flush(board.agents, opts(now)); await Promise.all(told); }
const MIN = 60e3;

test('#7936: an input-held message: its sender is told once, ten minutes in, that it is still held and when it drops', async () => {
  await withFleet(async (board, tmux) => {
    const at = Date.now() - 9 * MIN;
    limitqueue.add('casey', { id: 'm7936', from: 'leo', envelope: 'x', at: new Date(at).toISOString(), reset: new Date(at).toISOString(), input: true });
    await sweep(board, Date.now());
    assert.deepEqual(tmux.pastedTo('leo'), [], 'CONTROL: nine minutes in, nothing is said yet');
    await sweep(board, at + limitqueue.STILL_HELD_TELL_MS + 1000);
    const lines = tmux.pastedTo('leo');
    assert.equal(lines.length, 1, 'the sender was not told it is still held');
    const dropAt = new Date(at + limitqueue.INPUT_DROP_AFTER_MS).toISOString();
    assert.match(lines[0], /Your message m7936 to casey is still held: casey's input box holds text not yet sent\./);
    assert.ok(lines[0].includes('drops it at ' + dropAt), lines[0]);
    await sweep(board, at + limitqueue.STILL_HELD_TELL_MS + 5 * MIN);
    assert.equal(tmux.pastedTo('leo').length, 1, 'told twice');
    assert.deepEqual(limitqueue.list('casey').map((e) => e.id), ['m7936'], 'still kept after the notice');
    assert.deepEqual(tmux.pastedTo('casey'), [], 'typed into a box holding text');
  });
});

test('#7936: an input-held message drops after two hours and says so; a usage-limit hold of the same age is kept', async () => {
  await withFleet(async (board, tmux) => {
    const at = Date.now() - limitqueue.INPUT_DROP_AFTER_MS - MIN;
    const iso = new Date(at).toISOString();
    limitqueue.add('casey', { id: 'm7937', from: 'leo', envelope: 'x', at: iso, reset: iso, input: true });
    limitqueue.add('casey', { id: 'm7938', from: 'leo', envelope: 'y', at: iso, reset: iso });   // CONTROL: a usage-limit hold
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
  assert.ok(src.includes("Kosmos types it once the box is clear, or drops it after 2 hours and tells you"), 'receipt wording');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos'), 'utf8');
  assert.ok(cli.includes('Kosmos types it once the box is clear, or drops it after 2 hours and tells you; do not re-send.'), 'CLI wording');
});

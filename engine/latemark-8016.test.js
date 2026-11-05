'use strict';

/**
 * kosmos#8016: a `kosmos msg` the board kept (here behind a stuck input box, #6774) and typed later says so, as it
 * always did ("kept for you while ...; sent <time>"), and now also says when its recipient has written to that sender
 * since it was sent, so a late copy of something already answered does not read as a fresh ask. Controls: no reply,
 * a reply from before it was sent, a reply to someone else, and an on-time message (no mark at all). The length room
 * for the longest note now counts the input-box note and the wrote-back clause. Same harness as inputkeep-6774.
 *
 *   node --test engine/latemark-8016.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-latemark-8016-'));
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
const STUCK = fs.readFileSync(path.join(SCREENS, 'typed-short.ansi'), 'utf8');

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
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
/* A `kosmos msg` row in the board's message log, as the send path writes it: `from` wrote to `to` at `at`. */
function logged(from, to, at) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'message', id: 'm9' + Math.floor(Math.random() * 1e6), from, to, at, text: 'on it', state: 'placed' }) + '\n');
}
const WROTE = /; you have written to leo since\]/;

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

test('#8016: a kept message typed after its recipient wrote back to the sender says so, after when it was sent', async () => {
  await withFleet(async (board, tmux, screen) => {
    const a = await send(board, 'can you take card 12');
    assert.equal(a.held, true, JSON.stringify(a));
    logged('casey', 'leo', new Date(Date.parse(limitqueue.list('casey')[0].at) + 1000).toISOString());
    screen.now = EMPTY;
    await flush(board);
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1, JSON.stringify(typed));
    assert.match(typed[0], /can you take card 12/);
    assert.match(typed[0], /\[kept for you while your input box held text not yet sent; sent \S+; you have written to leo since\]/);
  });
});

test('#8016 review 1: a reply that names the sender in another case (kosmos msg Leo) still counts', async () => {
  await withFleet(async (board, tmux, screen) => {
    await send(board, 'can you take card 12');
    logged('casey', 'Leo', new Date(Date.parse(limitqueue.list('casey')[0].at) + 1000).toISOString());
    screen.now = EMPTY;
    await flush(board);
    assert.match(tmux.pastedTo('casey')[0] || '', WROTE);
  });
});

test('#8016 CONTROL: no reply since: the kept note is as before, with no wrote-back clause', async () => {
  await withFleet(async (board, tmux, screen) => {
    await send(board, 'can you take card 12');
    screen.now = EMPTY;
    await flush(board);
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1);
    assert.match(typed[0], /\[kept for you while your input box held text not yet sent; sent [^;\]]+\]/);
    assert.doesNotMatch(typed[0], WROTE);
  });
});

test('#8016 CONTROL: a reply from BEFORE the message was sent, or to another agent, is not a reply to it', async () => {
  await withFleet(async (board, tmux, screen) => {
    logged('casey', 'leo', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    await send(board, 'can you take card 12');
    logged('casey', 'someoneelse', new Date(Date.parse(limitqueue.list('casey')[0].at) + 1000).toISOString());
    logged('leo', 'casey', new Date(Date.parse(limitqueue.list('casey')[0].at) + 1000).toISOString());   // the other way round
    screen.now = EMPTY;
    await flush(board);
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1);
    assert.doesNotMatch(typed[0], WROTE);
  });
});

test('#8016 CONTROL: an on-time message (box empty) is typed at once and carries no kept mark at all', async () => {
  await withFleet(async (board, tmux, screen) => {
    screen.now = EMPTY;
    const a = await send(board, 'can you take card 12');
    assert.notEqual(a.held, true, JSON.stringify(a));
    const typed = tmux.pastedTo('casey');
    assert.equal(typed.length, 1, JSON.stringify(typed));
    assert.doesNotMatch(typed[0], /\[kept /);
  });
});

test('#8016: wroteBackSince counts only a later `kosmos msg` from the recipient to the sender of an agent\'s kept message', () => {
  const e = { id: 'k1', from: 'leo', to: 'casey', at: '2026-11-05T07:00:00.000Z' };
  const row = (from, to, at, kind = 'message') => ({ kind, from, to, at });
  assert.equal(limitqueue.wroteBackSince([row('casey', 'leo', '2026-11-05T07:00:01.000Z')], e), true);
  assert.equal(limitqueue.wroteBackSince([row('casey', 'leo', '2026-11-05T06:59:59.000Z')], e), false, 'before');
  assert.equal(limitqueue.wroteBackSince([row('casey', 'leo', '2026-11-05T07:00:00.000Z')], e), false, 'the same moment is not after');
  assert.equal(limitqueue.wroteBackSince([row('casey', 'leo', '2026-11-05T07:00:01.000Z', 'post')], e), false, 'a room post');
  assert.equal(limitqueue.wroteBackSince([row('casey', 'leo', 'not a time')], e), false, 'no readable time');
  assert.equal(limitqueue.wroteBackSince([row('casey', 'leo', '2026-11-05T07:00:01.000Z')], { ...e, kind: 'dm' }), false, 'a person\'s own message');
  assert.equal(limitqueue.wroteBackSince([row('casey', '', '2026-11-05T07:00:01.000Z')], { ...e, from: '' }), false, 'no named sender');
  assert.equal(limitqueue.wroteBackSince(null, e), false, 'no rows');
  assert.equal(limitqueue.wroteBackSince([row('casey', 'leo', '2026-11-05T07:00:01.000Z')], { ...e, at: 'bad' }), false, 'no readable send time');
  // Review 1: the name as typed (`kosmos msg Leo`) is the same agent; a refused send reached nobody; an answer by id counts.
  assert.equal(limitqueue.wroteBackSince([row('casey', 'Leo', '2026-11-05T07:00:01.000Z')], e), true, 'the sender named in another case');
  assert.equal(limitqueue.wroteBackSince([{ ...row('casey', 'leo', '2026-11-05T07:00:01.000Z'), state: 'could_not' }], e), false, 'a refused send');
  assert.equal(limitqueue.wroteBackSince([{ ...row('casey', 'leo', '2026-11-05T07:00:01.000Z'), state: 'held' }], e), true, 'a held send is still written');
  assert.equal(limitqueue.wroteBackSince([{ ...row('casey', 'leo', '2026-11-05T06:00:00.000Z'), in_reply_to: 'k1' }], e), true, 'an answer to it by id');
  assert.equal(limitqueue.wroteBackSince([{ ...row('casey', 'leo', '2026-11-05T06:00:00.000Z'), in_reply_to: 'k2' }], e), false, 'CONTROL: an answer to another message, from before');
  assert.equal(limitqueue.wroteBackSince([{ ...row('leo', 'casey', '2026-11-05T07:00:01.000Z'), in_reply_to: 'k1' }], e), false, 'CONTROL: by id, but from the sender');
});

test('#8016 review 1: the clause is added only when the line still fits the limit, and never on a doubt', () => {
  const e = { id: 'k1', from: 'leo', to: 'casey', at: '2026-11-05T07:00:00.000Z', envelope: 'x'.repeat(100) };
  const yes = () => true;
  const plain = 100 + limitqueue.keptNote(e).length, marked = 100 + limitqueue.keptNote({ ...e, wroteBack: true }).length;
  assert.equal(limitqueue.asTyped(e, yes, marked).wroteBack, true, 'fits exactly');
  assert.equal(limitqueue.asTyped(e, yes, marked - 1), e, 'one over: typed as it was, not refused on every sweep');
  assert.ok(plain <= marked - 1, 'premise: the plain line still fits there');
  assert.equal(limitqueue.asTyped(e, yes, undefined), e, 'no limit given');
  assert.equal(limitqueue.asTyped(e, () => { throw new Error('x'); }, 10000), e, 'a lookup that throws');
  assert.equal(limitqueue.asTyped(e, () => false, 10000), e, 'no reply');
  assert.equal(limitqueue.asTyped({ ...e, kind: 'dm' }, yes, 10000).wroteBack, undefined, 'a person\'s own message');
});

test('#8016: the room left for the later note covers the longest one: the input-box note with a 32-character sender', () => {
  const at = new Date(8.64e15).toISOString();
  const longest = limitqueue.keptNote({ input: true, at, from: 'x'.repeat(32), wroteBack: true }).length;
  assert.ok(longest > limitqueue.keptNote({ at, from: 'x'.repeat(32), wroteBack: true }).length, 'premise: the input-box note is the longest reason');
  assert.ok(messages.spillLimit() <= chat.MAX_TEXT - longest, 'a line that fits now would not fit when typed later with its note');
});

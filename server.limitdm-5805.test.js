'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #5805 slice 2b, through the REAL DM thread route: a person's own message to an agent out of usage is kept (not
 * typed) and recorded held; `anyway: true` types it at once; Send now anyway (POST .../thread/held) types the kept
 * message and updates its row, once; the minute sweep's hooks type a kept message as the route would and update the
 * row, or mark it not delivered when dropped.
 *
 * The deliver functions are recorders and chat.limitHeldVerdict is stubbed (slice 1's own tests drive the real one on
 * real limit screens), so which path the route took is measured and nothing reaches a pane.
 *
 *   node --test server.limitdm-5805.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-limitdm-5805-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const chat = require('./engine/chat');
const messages = require('./engine/messages');
const limitqueue = require('./engine/limitqueue');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

const NAME = 'cap5805';
assertSandboxedDataRoot(SANDBOX, [store.ROOT, chat.threadFile(chat.DIRECT, NAME)]);

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const RESET = new Date(Date.now() + 3 * 3600e3).toISOString();
const PLACED = () => ({ state: chat.DELIVERY.PLACED, at: new Date().toISOString(), because: null, paneState: null, paneNote: null });

/** One request with the deliver paths recorded and the limit verdict as given (null: not held). */
async function call(pathSuffix, body, { held = true, headers = {} } = {}) {
  const calls = [];
  const real = { a: chat.deliverAutomaticAsync, p: chat.deliverAsync, v: chat.limitHeldVerdict };
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  try {
    chat.deliverAutomaticAsync = async (...a) => { calls.push(['automatic', a[1]]); return PLACED(); };
    chat.deliverAsync = async (...a) => { calls.push(['plain', a[1]]); return PLACED(); };
    chat.limitHeldVerdict = () => (held ? { state: chat.DELIVERY.COULD_NOT, held: true, heldBy: 'limit', heldUntil: RESET, limitReset: RESET } : null);
    const res = await fetch(`${base}/api/agent/${NAME}${pathSuffix}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status, out: await res.json().catch(() => null), calls };
  } finally {
    chat.deliverAutomaticAsync = real.a; chat.deliverAsync = real.p; chat.limitHeldVerdict = real.v;
    board.restore();
  }
}
const rows = () => { try { return chat.readThread(chat.DIRECT, NAME).messages || []; } catch { return []; } };
const rowAt = (at) => rows().find((m) => m.at === at);

test.beforeEach(() => { limitqueue.resetForTests(); try { fs.rmSync(limitqueue.dir(), { recursive: true, force: true }); } catch { /* fresh */ } });

test('#5805 2b: a person\'s message to an agent out of usage is kept, not typed, and recorded held with its time', async () => {
  const r = await call('/thread', { text: 'please ship 0.7.39' });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.calls, [], 'a held message was typed');
  assert.equal(r.out.delivery.state, 'held');
  assert.equal(r.out.delivery.heldUntil, RESET);
  assert.equal(r.out.recorded, true);
  const row = rowAt(r.out.delivery.at);
  assert.equal(row.delivery.state, 'held');
  assert.equal(row.delivery.heldUntil, RESET);
  assert.deepEqual(limitqueue.list(NAME).map((e) => [e.kind, e.text]), [['dm', 'please ship 0.7.39']]);
});

test('#5805 2b CONTROLS: anyway types it at once; an automatic hello and an agent not held are unchanged', async () => {
  const any = await call('/thread', { text: 'type it now', anyway: true });
  assert.deepEqual(any.calls, [['plain', 'type it now']]);
  assert.equal(any.out.delivery.state, chat.DELIVERY.PLACED);
  const auto = await call('/thread', { text: 'hello', automatic: true });
  assert.deepEqual(auto.calls, [['automatic', 'hello']], 'the automatic hello was not left on its own gate');
  const free = await call('/thread', { text: 'hi' }, { held: false });
  assert.deepEqual(free.calls, [['plain', 'hi']]);
  assert.deepEqual(limitqueue.list(NAME), []);
});

test('#5805 2b: Send now anyway types the kept message and updates its row, once; an agent token is refused', async () => {
  const held = await call('/thread', { text: 'the go-ahead' });
  const at = held.out.delivery.at;
  const asAgent = await call('/thread/held', { at }, { headers: { 'x-kosmos-agent-token': 'a'.repeat(64) } });
  assert.equal(asAgent.status, 403);
  const sent = await call('/thread/held', { at });
  assert.equal(sent.status, 200, JSON.stringify(sent.out));
  assert.deepEqual(sent.calls, [['plain', 'the go-ahead']]);
  assert.equal(rowAt(at).delivery.state, chat.DELIVERY.PLACED);
  assert.deepEqual(limitqueue.list(NAME), []);
  const again = await call('/thread/held', { at });
  assert.equal(again.status, 409, 'a message no longer held was sent twice');
  assert.deepEqual(again.calls, []);
});

test('#5805 2b: the sweep types a kept message as the route would and updates its row; a dropped one reads not delivered', async () => {
  const one = await call('/thread', { text: 'first' });
  const two = await call('/thread', { text: 'second' });
  const typed = [];
  const hooks = limitqueue.sweepHooks({ chat, messages });
  const realA = chat.deliverAutomaticAsync;
  chat.deliverAutomaticAsync = async (n, text, r, envelope, trailer) => { typed.push([text, typeof envelope, typeof trailer]); return PLACED(); };
  try {
    // The second is a day past its reset; the first is typed.
    const entries = limitqueue.list(NAME);
    const old = new Date(Date.now() - limitqueue.DROP_AFTER_MS - 60e3).toISOString();
    limitqueue.remove(NAME, entries[1].id);
    limitqueue.add(NAME, { ...entries[1], reset: old, at: entries[1].at });
    const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);   // a real card (fixture discipline)
    try { await limitqueue.flush(board.agents, { ...hooks, isReleased: () => true }); } finally { board.restore(); }
  } finally { chat.deliverAutomaticAsync = realA; }
  assert.deepEqual(typed, [['first', 'string', 'string']], 'not typed as the route types a person\'s message');
  assert.equal(rowAt(one.out.delivery.at).delivery.state, chat.DELIVERY.PLACED);
  const dropped = rowAt(two.out.delivery.at).delivery;
  assert.equal(dropped.state, chat.DELIVERY.COULD_NOT);
  assert.match(dropped.because, /kept it for a day/);
});

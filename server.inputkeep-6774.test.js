'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#6774, through the REAL DM thread route: a person's own message refused because the agent's input box holds
 * text not yet sent (#6249) is kept and recorded held, and the minute sweep (limitqueue) types it once the box is
 * clear; the same words sent again by hand while a copy is kept replace that copy, so they go once.
 *
 * As server.limitdm-5805.test.js: the deliver functions are recorders (the plain one answers the #6249 refusal while
 * `stuck`), so which path the route took is measured and nothing reaches a pane.
 *
 *   node --test server.inputkeep-6774.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-inputkeep-6774-')));
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
const limitqueue = require('./engine/limitqueue');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

const NAME = 'box6774';
assertSandboxedDataRoot(SANDBOX, [store.ROOT, chat.threadFile(chat.DIRECT, NAME)]);

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const PLACED = () => ({ state: chat.DELIVERY.PLACED, at: new Date().toISOString(), because: null, paneState: null, paneNote: null });
// The #6249 refusal, as engine/chat.js answers it: nothing typed, inputHeld.
const BOX_REFUSED = () => ({ state: chat.DELIVERY.COULD_NOT, because: 'its input box already holds text that was not sent, so this was not typed behind it', inputHeld: true, busy: true, at: new Date().toISOString() });
const OTHER_REFUSED = () => ({ state: chat.DELIVERY.COULD_NOT, because: 'it is not running', at: new Date().toISOString() });

/** One request with the deliver paths recorded; the plain deliver answers `answer()`. Nothing is held for a limit. */
async function call(body, answer = BOX_REFUSED) {
  const calls = [];
  const real = { a: chat.deliverAutomaticAsync, p: chat.deliverAsync, v: chat.limitHeldVerdict };
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  try {
    chat.deliverAutomaticAsync = async (...a) => { calls.push(['automatic', a[1]]); return PLACED(); };
    chat.deliverAsync = async (...a) => { calls.push(['plain', a[1]]); return answer(); };
    chat.limitHeldVerdict = () => null;
    const res = await fetch(`${base}/api/agent/${NAME}/thread`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, out: await res.json().catch(() => null), calls };
  } finally {
    chat.deliverAutomaticAsync = real.a; chat.deliverAsync = real.p; chat.limitHeldVerdict = real.v;
    board.restore();
  }
}
const rows = () => { try { return chat.readThread(chat.DIRECT, NAME).messages || []; } catch { return []; } };
const rowAt = (at) => rows().find((m) => m.at === at);
const kept = () => limitqueue.list(NAME).map((e) => [e.kind, e.text, e.input === true]);

test.beforeEach(() => {
  limitqueue.resetForTests();
  try { fs.rmSync(limitqueue.dir(), { recursive: true, force: true }); } catch { /* fresh */ }
  try { fs.rmSync(chat.threadFile(chat.DIRECT, NAME), { force: true }); } catch { /* fresh */ }
});

test('#6774: a person\'s message refused by a stuck input box is kept and recorded held, saying why', async () => {
  const r = await call({ text: 'please ship it' });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.calls, [['plain', 'please ship it']], 'PRECONDITION: the route tried to type it');
  assert.equal(r.out.delivery.state, 'held');
  assert.equal(r.out.delivery.heldFor, 'input');
  assert.match(r.out.delivery.because, /input box holds text not yet sent; Kosmos sends it once the box is clear/);
  assert.equal(r.out.recorded, true);
  assert.equal(rowAt(r.out.delivery.at).delivery.heldFor, 'input');
  assert.deepEqual(kept(), [['dm', 'please ship it', true]]);
});

test('#6774: a second message goes behind the first, without being tried, and says what it waits behind', async () => {
  await call({ text: 'first' });
  const r = await call({ text: 'second' });
  assert.deepEqual(r.calls, [], 'a message was typed ahead of one kept before it');
  assert.equal(r.out.delivery.behind, true);
  assert.equal(r.out.delivery.behindFor, 'input');
  assert.match(r.out.delivery.because, /kept while its input box held text not yet sent/);
  assert.equal(rowAt(r.out.delivery.at).delivery.behindFor, 'input', 'the row lost behindFor: a reload words it as a usage limit');
  assert.deepEqual(kept().map((k) => k[1]), ['first', 'second']);
});

test('#6774: the same words sent again by hand are not sent twice: the kept copy stays, the new row says why', async () => {
  const one = await call({ text: 'the go-ahead' });
  const two = await call({ text: 'the go-ahead' });
  assert.deepEqual(two.calls, [], 'the re-send was tried');
  assert.equal(two.out.delivery.state, chat.DELIVERY.COULD_NOT, JSON.stringify(two.out));
  assert.equal(two.out.delivery.duplicateOf, one.out.delivery.at);
  assert.match(two.out.delivery.because, /was already kept above, to be sent once box6774's input box was clear, so this copy was not sent/);
  assert.equal(two.out.recorded, true);
  assert.deepEqual(kept(), [['dm', 'the go-ahead', true]], 'kept twice');
  assert.equal(limitqueue.list(NAME)[0].at, one.out.delivery.at, 'the kept copy moved');
  assert.equal(rowAt(one.out.delivery.at).delivery.state, 'held', 'the kept copy\'s row changed');
});

test('#6774: the same words with different spacing are the same message (matched as typed)', async () => {
  const one = await call({ text: 'ship  it ' });
  const two = await call({ text: 'ship it' });
  assert.equal(two.out.delivery.duplicateOf, one.out.delivery.at, JSON.stringify(two.out));
  assert.equal(kept().length, 1);
});

test('#6774: a message kept BEHIND the box backlog carries the flag, so its re-send is caught too and the wording holds', async () => {
  await call({ text: 'A' });
  const b = await call({ text: 'B' });
  assert.equal(b.out.delivery.behindFor, 'input');
  assert.deepEqual(kept(), [['dm', 'A', true], ['dm', 'B', true]]);
  const again = await call({ text: 'B' });
  assert.equal(again.out.delivery.duplicateOf, b.out.delivery.at, JSON.stringify(again.out));
  assert.equal(kept().length, 2, 'B kept twice');
  const c = await call({ text: 'C' });
  assert.equal(c.out.delivery.behindFor, 'input', 'C behind A and B was told it waits on a usage limit');
});

test('#6774: Send now anyway while the box still holds text keeps the message and its row held', async () => {
  const r = await call({ text: 'still kept' });
  const real = chat.deliverAsync;
  chat.deliverAsync = async () => BOX_REFUSED();
  try {
    const res = await fetch(`${base}/api/agent/${NAME}/thread/held`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at: r.out.delivery.at }) });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).inputHeld, true, 'the page cannot tell this 409 from "sent meanwhile"');
  } finally { chat.deliverAsync = real; }
  assert.deepEqual(kept(), [['dm', 'still kept', true]], 'the press lost the kept message');
  assert.equal(rowAt(r.out.delivery.at).delivery.state, 'held');
});

test('#6774: route to sweep: two refused messages are typed in order, once each, only once the box reads empty', async () => {
  const a = await call({ text: 'one' });
  const b = await call({ text: 'two' });
  const typed = [];
  const real = { a: chat.deliverAutomaticAsync, e: chat.inputBoxEmpty, r: chat.limitQueueReleased };
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  let empty = false;
  try {
    chat.deliverAutomaticAsync = async (n, text) => { typed.push(text); return PLACED(); };
    chat.inputBoxEmpty = () => empty;
    chat.limitQueueReleased = () => true;
    const hooks = limitqueue.sweepHooks({ chat, messages: require('./engine/messages') });
    await limitqueue.flush(board.agents, hooks);
    assert.deepEqual(typed, [], 'typed while the box still held text');
    empty = true;
    await limitqueue.flush(board.agents, hooks);
    await limitqueue.flush(board.agents, hooks);
    assert.deepEqual(typed, ['one', 'two']);
  } finally { chat.deliverAutomaticAsync = real.a; chat.inputBoxEmpty = real.e; chat.limitQueueReleased = real.r; board.restore(); }
  assert.deepEqual(kept(), []);
  assert.equal(rowAt(a.out.delivery.at).delivery.state, chat.DELIVERY.PLACED);
  assert.equal(rowAt(b.out.delivery.at).delivery.state, chat.DELIVERY.PLACED);
});

test('#6774 CONTROLS: a refusal for another reason is not kept; anyway is not kept; different words are not merged', async () => {
  const other = await call({ text: 'hello' }, OTHER_REFUSED);
  assert.equal(other.out.delivery.state, chat.DELIVERY.COULD_NOT);
  assert.deepEqual(kept(), []);
  const any = await call({ text: 'type it now', anyway: true });
  assert.equal(any.out.delivery.state, chat.DELIVERY.COULD_NOT, 'anyway is the person choosing now; it is not kept');
  assert.deepEqual(kept(), []);
  await call({ text: 'one thing' });
  await call({ text: 'another thing' });
  assert.deepEqual(kept().map((k) => k[1]), ['one thing', 'another thing']);
});

test('#6774: the sweep types a kept message as the route would and marks its row', async () => {
  const r = await call({ text: 'kept for the box' });
  const hooks = limitqueue.sweepHooks({ chat, messages: require('./engine/messages') });
  const e = limitqueue.list(NAME)[0];
  hooks.onDelivered(e, PLACED());
  assert.equal(rowAt(r.out.delivery.at).delivery.state, chat.DELIVERY.PLACED);
});

test('#6774: kept for the box but its row cannot be written, it is taken back out and the refusal stands', async () => {
  const real = chat.appendMessage;
  chat.appendMessage = () => ({ recorded: false, because: 'the thread is busy' });
  let r;
  try { r = await call({ text: 'unrecorded' }); } finally { chat.appendMessage = real; }
  assert.equal(r.out.delivery.state, chat.DELIVERY.COULD_NOT, JSON.stringify(r.out));
  assert.equal(r.out.delivery.inputHeld, true);
  assert.equal(r.out.recorded, false);
  assert.deepEqual(kept(), [], 'kept where the person cannot see it');
});

test('#6774: a re-send is folded only into a plain kept copy (no attachment, not a reply)', async () => {
  const at = new Date().toISOString();
  limitqueue.add(NAME, { id: 'dm-x', from: '', kind: 'dm', text: 'see attached', envelope: 'e', trailer: ' [file]', at, reset: at, input: true });
  const r = await call({ text: 'see attached' });
  assert.notEqual(r.out.delivery.duplicateOf, at, 'folded into a copy that carried an attachment');
  assert.equal(kept().length, 2);
});

test('#6774: the same words sent twice at once (both in flight) are kept once; the second is that copy, saved so on its row', async () => {
  const real = { a: chat.deliverAutomaticAsync, p: chat.deliverAsync, v: chat.limitHeldVerdict };
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  try {
    chat.deliverAsync = async () => { await new Promise((r) => setTimeout(r, 50)); return BOX_REFUSED(); };
    chat.limitHeldVerdict = () => null;
    const post = () => fetch(`${base}/api/agent/${NAME}/thread`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'twice at once' }) }).then((r) => r.json());
    const [a, b] = await Promise.all([post(), post()]);
    assert.deepEqual(kept().map((k) => k[1]), ['twice at once'], 'kept twice: ' + JSON.stringify([a, b]));
    const dup = [a, b].find((x) => x.delivery.duplicateOf);
    assert.ok(dup, 'neither answer was the kept copy: ' + JSON.stringify([a, b]));
    assert.equal(rowAt(dup.delivery.at).delivery.duplicateOf, dup.delivery.duplicateOf, 'the row lost what it duplicates');
  } finally { chat.deliverAutomaticAsync = real.a; chat.deliverAsync = real.p; chat.limitHeldVerdict = real.v; board.restore(); }
});

test('#6774: the same words after the agent has spoken since are a new message (kept behind), not folded; CONTROL: before, they fold', async () => {
  const one = await call({ text: 'yes' });
  const again = await call({ text: 'yes' });
  assert.equal(again.out.delivery.duplicateOf, one.out.delivery.at, 'CONTROL: with no reply between, the re-send folds');
  chat.appendMessage(chat.DIRECT, NAME, { from: NAME, text: 'one more question: ship it too?', at: new Date(Date.now() + 5).toISOString() });
  await new Promise((r) => setTimeout(r, 10));
  const after = await call({ text: 'yes' });
  assert.equal(after.out.delivery.duplicateOf, undefined, 'folded an answer given after the agent spoke: ' + JSON.stringify(after.out));
  assert.equal(after.out.delivery.state, 'held');
  assert.deepEqual(kept().map((k) => k[1]), ['yes', 'yes']);
});

test('#6774: "yes", "no", "yes" keeps all three: the person\'s own other words since the kept copy stop the fold', async () => {
  await call({ text: 'yes' });
  await new Promise((r) => setTimeout(r, 5));
  await call({ text: 'no' });
  await new Promise((r) => setTimeout(r, 5));
  const third = await call({ text: 'yes' });
  assert.equal(third.out.delivery.duplicateOf, undefined, 'the final "yes" was folded into the first: ' + JSON.stringify(third.out));
  assert.deepEqual(kept().map((k) => k[1]), ['yes', 'no', 'yes']);
});

test('#6774: Send now anyway on a row kept for a usage limit, refused by the box, says it waits for the reset too', async () => {
  const at = new Date().toISOString();
  limitqueue.add(NAME, { id: 'dm-limit-1', from: '', kind: 'dm', text: 'after the reset', envelope: 'e', trailer: '', at, reset: at });
  const real = chat.deliverAsync;
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  chat.deliverAsync = async () => BOX_REFUSED();
  try {
    const res = await fetch(`${base}/api/agent/${NAME}/thread/held`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at }) });
    const out = await res.json();
    assert.equal(res.status, 409);
    assert.match(out.error, /on its own after the reset, once the box is clear$/, JSON.stringify(out));
  } finally { chat.deliverAsync = real; board.restore(); }
  assert.deepEqual(kept(), [['dm', 'after the reset', false]], 'the press lost the kept message');
});

test('#6774: the box 409 names what a signed-out row and a row kept behind still wait for', async () => {
  const real = chat.deliverAsync;
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  chat.deliverAsync = async () => BOX_REFUSED();
  const press = async (at) => {
    const res = await fetch(`${base}/api/agent/${NAME}/thread/held`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at }) });
    return { status: res.status, out: await res.json() };
  };
  try {
    const a1 = new Date().toISOString();
    limitqueue.add(NAME, { id: 'dm-signin-1', from: '', kind: 'dm', text: 'signed out one', envelope: 'e', trailer: '', at: a1, reset: a1, signin: true });
    const r1 = await press(a1);
    assert.match(r1.out.error, /once it is signed in again and the box is clear$/, JSON.stringify(r1));
    await new Promise((r) => setTimeout(r, 5));
    const a2 = new Date().toISOString();
    limitqueue.add(NAME, { id: 'dm-behind-1', from: '', kind: 'dm', text: 'behind one', envelope: 'e', trailer: '', at: a2, reset: a2, behind: true });
    const r2 = await press(a2);
    assert.match(r2.out.error, /after the messages ahead of it, once the box is clear$/, JSON.stringify(r2));
  } finally { chat.deliverAsync = real; board.restore(); }
});

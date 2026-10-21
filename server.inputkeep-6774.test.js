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
  assert.deepEqual(kept().map((k) => k[1]), ['first', 'second']);
});

test('#6774: the same words sent again by hand replace the kept copy, whose row says so; they go once', async () => {
  const one = await call({ text: 'the go-ahead' });
  const two = await call({ text: 'the go-ahead' });
  assert.equal(two.out.delivery.state, 'held', JSON.stringify(two.out));
  assert.notEqual(two.out.delivery.at, one.out.delivery.at);
  assert.deepEqual(kept(), [['dm', 'the go-ahead', true]], 'kept twice');
  assert.equal(limitqueue.list(NAME)[0].at, two.out.delivery.at, 'the newer copy is the one kept');
  const old = rowAt(one.out.delivery.at).delivery;
  assert.equal(old.state, chat.DELIVERY.COULD_NOT);
  assert.match(old.because, /you sent it again, so Kosmos sends the newer copy instead of this one/);
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

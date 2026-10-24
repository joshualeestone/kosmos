'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#6720, through the REAL DM thread route: Try again on a person's message that did not go (`retry_of`) types
 * the same words once and rewrites THAT row's verdict, never adding a second message; it is refused, with nothing
 * typed, for a row that is not failed (any more), for other words, for a reply, a menu answer or a file, while the
 * same row is already being sent again, and while the agent cannot take messages (which would otherwise make a second,
 * held row).
 *
 * The deliver function is a recorder and the account hold is stubbed, so which path the route took is measured and
 * nothing reaches a pane.
 *
 *   node --test server.dmretry-6720.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dmretry-6720-')));
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

const NAME = 'retry6720';
assertSandboxedDataRoot(SANDBOX, [store.ROOT, chat.threadFile(chat.DIRECT, NAME)]);

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const PLACED = () => ({ state: chat.DELIVERY.PLACED, at: new Date().toISOString(), because: null, paneState: null, paneNote: null });
const FAILED = (because) => ({ state: chat.DELIVERY.COULD_NOT, at: new Date().toISOString(), because, paneState: null, paneNote: null });

/** One POST to the thread route with deliverAsync recorded (answering `verdict()`), and the account hold as given. */
async function post(body, { verdict = PLACED, hold = null, gate = null, agent = { state: 'idle' }, during = null, calls = [], screen = null } = {}) {
  const real = { p: chat.deliverAsync, h: chat.accountHeldVerdict, v: chat.viewport };
  const board = fleet.install([fleet.agent(NAME, agent)]);
  try {
    chat.deliverAsync = async (...a) => { calls.push(a[1]); if (during) during(); if (gate) await gate; return verdict(); };
    chat.accountHeldVerdict = () => hold;
    if (screen !== null) chat.viewport = () => ({ text: screen });   // the route's own read of the agent's screen
    const res = await fetch(`${base}/api/agent/${NAME}/thread`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, out: await res.json().catch(() => null), calls };
  } finally {
    chat.deliverAsync = real.p; chat.accountHeldVerdict = real.h; chat.viewport = real.v;
    board.restore();
  }
}
const rows = () => { try { return chat.readThread(chat.DIRECT, NAME).messages || []; } catch { return []; } };
const rowAt = (at) => rows().find((m) => m.at === at);
let seq = 0;
/** A kept row of the person's, written as the route writes one. */
function keep(fields) {
  const at = new Date(Date.UTC(2026, 9, 20, 8, 49, 0, seq++)).toISOString();
  const kept = chat.appendMessage(chat.DIRECT, NAME, { text: 'ship it', wire: null, at, delivery: { ...FAILED('its input box already holds text that was not sent, so this was not typed behind it'), retryable: true }, ...fields });
  assert.equal(kept.recorded, true, 'the fixture row was not kept');
  return at;
}

test.beforeEach(() => { limitqueue.resetForTests(); try { fs.rmSync(limitqueue.dir(), { recursive: true, force: true }); } catch { /* fresh */ } });

test('#6720: Try again types the same words once and rewrites that row, so the conversation still holds one message', async () => {
  const at = keep({});
  const before = rows().length;
  const r = await post({ text: 'ship it', retry_of: at });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.calls, ['ship it'], 'not typed exactly once with its own words');
  assert.equal(r.out.retried, true);
  assert.equal(r.out.recorded, true);
  assert.equal(rows().length, before, 'a second message was added');
  const row = rowAt(at);
  assert.equal(row.delivery.state, 'placed');
  assert.equal(row.text, 'ship it');
  assert.match(row.delivery.retriedAt, /^\d{4}-\d\d-\d\dT/);
  // And once it went, the same press again is refused with nothing typed (the row is no longer failed).
  const again = await post({ text: 'ship it', retry_of: at });
  assert.equal(again.status, 409, JSON.stringify(again.out));
  assert.deepEqual(again.calls, [], 'a message that went was typed again');
});

test('#6720: a Try again that fails again leaves the one row failed, with the new reason', async () => {
  const at = keep({});
  const before = rows().length;
  const r = await post({ text: 'ship it', retry_of: at }, { verdict: () => FAILED('we could not get to its window, so we did not type anything') });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(r.calls.length, 1);
  assert.equal(rows().length, before);
  assert.equal(rowAt(at).delivery.state, 'could_not');
  assert.match(rowAt(at).delivery.because, /could not get to its window/);
});

test('#6720: two presses at once type it once; the second is refused while the first is in flight', async () => {
  const at = keep({});
  let open;
  const gate = new Promise((r) => { open = r; });
  const firstCalls = [];
  const first = post({ text: 'ship it', retry_of: at }, { gate, calls: firstCalls });
  for (let i = 0; i < 200 && !firstCalls.length; i++) await new Promise((r) => setTimeout(r, 25));   // until the first is typing
  assert.equal(firstCalls.length, 1, 'the first press never reached the typing');
  const second = await post({ text: 'ship it', retry_of: at });
  open();
  const one = await first;
  assert.equal(second.status, 409, JSON.stringify(second.out));
  assert.match(second.out.error, /being sent again now/);
  assert.deepEqual(second.calls, []);
  assert.equal(one.status, 200, JSON.stringify(one.out));
  assert.equal(one.calls.length, 1);
  // CONTROL: the in-memory mark is released afterwards (the row went, so a later press is refused for THAT reason).
  const later = await post({ text: 'ship it', retry_of: at });
  assert.equal(later.status, 409);
  assert.doesNotMatch(later.out.error, /being sent again now/, 'the in-flight mark outlived its request');
});

test('#6720: refused with nothing typed: other words, an unknown row, an agent\'s row, a reply, a menu answer, a file', async () => {
  const plain = keep({});
  const reply = keep({ replyTo: '2026-10-19T10:00:00.000Z' });
  const menu = keep({ text: 'Yes', wire: '1' });
  const filed = keep({ attachments: [{ id: 'a1', name: 'x.txt' }] });
  const theirs = new Date(Date.UTC(2026, 9, 20, 9, 0, 0, 0)).toISOString();
  chat.appendMessage(chat.DIRECT, NAME, { from: NAME, text: 'ship it', at: theirs });
  const cases = [
    [{ text: 'ship it now', retry_of: plain }, 409],
    [{ text: 'ship it', retry_of: '2020-01-01T00:00:00.000Z' }, 409],
    [{ text: 'ship it', retry_of: theirs }, 409],
    [{ text: 'ship it', retry_of: reply }, 409],
    [{ text: 'Yes', retry_of: menu }, 409],
    [{ text: 'ship it', retry_of: filed }, 409],
    [{ text: 'ship it', retry_of: plain, reply_to: theirs }, 400, /its own words only/],
    [{ text: 'ship it', retry_of: plain, attachments: ['a1'] }, 400, /its own words only/],
    [{ text: 'ship it', retry_of: plain, anyway: true }, 400, /its own words only/],
    [{ text: 'ship it', retry_of: 7 }, 400, /retry_of names a message/],
  ];
  for (const [body, want, words] of cases) {
    const r = await post(body);
    assert.equal(r.status, want, JSON.stringify(body) + ' -> ' + JSON.stringify(r.out));
    if (words) assert.match(r.out.error, words, 'refused by another rule: ' + JSON.stringify(body));   // review 2
    assert.deepEqual(r.calls, [], 'typed for ' + JSON.stringify(body));
  }
  assert.equal(rowAt(plain).delivery.state, 'could_not', 'a refused retry changed the row');
});

test('#6720: while the agent cannot take messages, Try again is refused rather than kept as a second, held row', async () => {
  const at = keep({});
  const before = rows().length;
  const reset = new Date(Date.now() + 3600e3).toISOString();
  const r = await post({ text: 'ship it', retry_of: at }, { hold: { state: chat.DELIVERY.COULD_NOT, held: true, heldBy: 'limit', heldUntil: reset, limitReset: reset } });
  assert.equal(r.status, 409, JSON.stringify(r.out));
  assert.match(r.out.error, /out of usage/);
  assert.deepEqual(r.calls, []);
  assert.equal(rows().length, before, 'a held row was added');
  assert.equal(limitqueue.list(NAME).length, 0, 'it was queued to be typed later');
  // CONTROL: the same hold on an ordinary send keeps it held (so the arm above is the retry's own rule).
  const plain = await post({ text: 'a new one' }, { hold: { state: chat.DELIVERY.COULD_NOT, held: true, heldBy: 'limit', heldUntil: reset, limitReset: reset } });
  assert.equal(plain.out.delivery.state, 'held');
});

test('#6720 review 1: the row reads "being sent again" in the RECORD before any key, and a failed final write leaves it there', async () => {
  const at = keep({});
  let seen = null;
  const r = await post({ text: 'ship it', retry_of: at }, { during: () => { seen = rowAt(at).delivery; } });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(seen && seen.state, 'unconfirmed', 'the row still read failed while it was being typed');
  assert.equal(seen.retrying, true);
  // The final write fails (the thread lock busy past its wait): the row stays "may have gone", and is never retried.
  const at2 = keep({ text: 'ship it again' });
  const real = chat.retryDmFinish;
  chat.retryDmFinish = () => false;
  let r2;
  try { r2 = await post({ text: 'ship it again', retry_of: at2 }); } finally { chat.retryDmFinish = real; }
  assert.equal(r2.status, 200);
  assert.equal(r2.out.recorded, false);
  assert.match(r2.out.recordedBecause, /possibly sent/);
  assert.equal(rowAt(at2).delivery.state, 'unconfirmed');
  const again = await post({ text: 'ship it again', retry_of: at2 });
  assert.equal(again.status, 409, 'a row that may have been typed was offered again');
  assert.deepEqual(again.calls, []);
});

test('#6720 review 1: only a row kept as retryable, and only the person\'s newest message', async () => {
  const old = keep({ text: 'from before', delivery: FAILED('we could not reach them') });   // failed before #6720: no mark
  const r1 = await post({ text: 'from before', retry_of: old });
  assert.equal(r1.status, 409, JSON.stringify(r1.out));
  // The route's own rule, by its words: retryDmBegin refuses an unmarked row too, which would pass this arm alone.
  assert.match(r1.out.error, /it is not one that failed/);
  assert.deepEqual(r1.calls, []);
  const older = keep({ text: 'first' });
  keep({ text: 'second' });
  const r2 = await post({ text: 'first', retry_of: older });
  assert.equal(r2.status, 409, JSON.stringify(r2.out));
  assert.match(r2.out.error, /sent a message since/);
  assert.deepEqual(r2.calls, []);
  // CONTROL: the newest one is taken.
  const newest = keep({ text: 'third' });
  const r3 = await post({ text: 'third', retry_of: newest });
  assert.equal(r3.status, 200, JSON.stringify(r3.out));
});

test('#6720: a plain send that fails is kept retryable; a reply that fails is not', async () => {
  const r = await post({ text: 'brand new' }, { verdict: () => FAILED('we could not reach them') });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.equal(rowAt(r.out.delivery.at).delivery.retryable, true);
  const theirs = new Date(Date.UTC(2026, 9, 20, 9, 30, 0, 0)).toISOString();
  chat.appendMessage(chat.DIRECT, NAME, { from: NAME, text: 'a question', at: theirs });
  const rr = await post({ text: 'my answer', reply_to: theirs }, { verdict: () => FAILED('we could not reach them') });
  assert.equal(rr.status, 200, JSON.stringify(rr.out));
  assert.notEqual(rowAt(rr.out.delivery.at).delivery.retryable, true, 'a failed reply was marked retryable');
});

test('#6720: with a question menu on its screen, Try again is refused with nothing typed', async () => {
  const MENU = fs.readFileSync(path.join(__dirname, 'test-support', 'claude-screens', 'question-menu-2.1.29x.txt'), 'utf8');
  const at = keep({});
  const r = await post({ text: 'ship it', retry_of: at }, { agent: { state: 'needs_you', runner: 'claude', command: 'claude' }, screen: MENU });
  // CONTROL: the premise, that this screen is one the route reads as a question menu.
  assert.ok(require('./engine/status').claudeAnswerableMenu(MENU), 'the fixture is not an answerable menu');
  assert.equal(r.status, 409, JSON.stringify(r.out));
  assert.match(r.out.error, /asking a question now/);
  assert.deepEqual(r.calls, []);
  assert.equal(rowAt(at).delivery.state, 'could_not', 'the refused retry marked the row');
});

test('#6720: retryDmBegin takes only a retryable failed row with these words; retryDmFinish only a row it began', () => {
  const at = keep({});
  assert.equal(chat.retryDmFinish(NAME, at, 'ship it', PLACED()), false, 'finished a row nobody began');
  assert.equal(chat.retryDmBegin(NAME, at, 'other words'), false);
  assert.equal(chat.retryDmBegin(NAME, at, 'ship it'), true);
  assert.equal(chat.retryDmBegin(NAME, at, 'ship it'), false, 'began twice');
  assert.equal(chat.retryDmFinish(NAME, at, 'ship it', FAILED('again')), true);
  assert.equal(rowAt(at).delivery.state, 'could_not');
  assert.equal(rowAt(at).delivery.retryable, true, 'a retry that typed nothing lost its retryable mark');
  assert.equal(chat.retryDmBegin(NAME, at, 'ship it'), true);
  assert.equal(chat.retryDmFinish(NAME, at, 'ship it', PLACED()), true);
  assert.equal(rowAt(at).delivery.state, 'placed');
  assert.equal(chat.retryDmBegin(NAME, at, 'ship it'), false, 'a row that went was begun again');
});

test('#6720 review 2: a retry that throws after its row was marked says it may or may not have arrived, and is not offered again', async () => {
  const at = keep({ text: 'throws' });
  const real = chat.deliverAsync;
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  const realHold = chat.accountHeldVerdict;
  try {
    chat.accountHeldVerdict = () => null;
    chat.deliverAsync = async () => { throw new Error('the pane went away'); };
    const res = await fetch(`${base}/api/agent/${NAME}/thread`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'throws', retry_of: at }) });
    assert.equal(res.status, 400);
  } finally { chat.deliverAsync = real; chat.accountHeldVerdict = realHold; board.restore(); }
  assert.equal(rowAt(at).delivery.state, 'unconfirmed');
  assert.match(rowAt(at).delivery.because, /may or may not have arrived/);
  assert.equal(rowAt(at).delivery.retrying, undefined, 'still marked as being sent again');
});

test('#6720 review 2: "newest" is decided under the lock: a message kept after the press stops the retry before any key', () => {
  const at = keep({ text: 'pressed' });
  keep({ text: 'sent from another tab meanwhile' });
  assert.equal(chat.retryDmBegin(NAME, at, 'pressed'), false);
  assert.equal(rowAt(at).delivery.state, 'could_not', 'the row was marked anyway');
});

test('#6720 review 2: the answer to a failed plain send says its row is retryable; a failed reply\'s does not', async () => {
  const r = await post({ text: 'answer flag' }, { verdict: () => FAILED('we could not reach them') });
  assert.equal(r.out.retryable, true);
  const theirs = new Date(Date.UTC(2026, 9, 20, 9, 40, 0, 0)).toISOString();
  chat.appendMessage(chat.DIRECT, NAME, { from: NAME, text: 'q', at: theirs });
  const rr = await post({ text: 'reply flag', reply_to: theirs }, { verdict: () => FAILED('we could not reach them') });
  assert.equal(rr.out.retryable, undefined);
});

/* Merged with #6774 (a message refused for a stuck input box is kept and sent once the box clears). A retry keeps its
   one row: it is never also kept for the box, and never answered with a second, "already kept" copy. */
const BOX_REFUSED = () => ({ ...FAILED('its input box already holds text that was not sent, so this was not typed behind it'), inputHeld: true, busy: true });

test('#6720 with #6774: a Try again that meets a stuck input box stays the one failed row, and nothing is kept for the box', async () => {
  const at = keep({});
  const before = rows().length;
  const r = await post({ text: 'ship it', retry_of: at }, { verdict: BOX_REFUSED });
  assert.equal(r.status, 200, JSON.stringify(r.out));
  assert.deepEqual(r.calls, ['ship it']);
  assert.equal(rows().length, before, 'a second row was added');
  assert.equal(rowAt(at).delivery.state, 'could_not', 'the row was not left failed');
  assert.notEqual(r.out.delivery.state, 'held', 'the retry was kept for the box');
  assert.deepEqual(limitqueue.list(NAME), [], 'a copy was kept for the box, so it would be typed later as well');
  // Control: the same refusal on a NEW message is kept for the box (#6774), so the arm above can fail.
  const fresh = await post({ text: 'a new message' }, { verdict: BOX_REFUSED });
  assert.equal(fresh.out.delivery.state, 'held', JSON.stringify(fresh.out));
  assert.equal(limitqueue.list(NAME).length, 1, 'control: the new message was not kept for the box');
});

test('#6720 with #6774: a Try again whose words are already kept for the box is refused, with nothing typed and no new row', async () => {
  const at = keep({});
  const keptAt = new Date().toISOString();
  limitqueue.add(NAME, { id: 'dm-kept-6720', from: '', kind: 'dm', text: 'ship it', envelope: 'e', trailer: '', at: keptAt, reset: keptAt, input: true, plain: true });
  const before = rows().length;
  const r = await post({ text: 'ship it', retry_of: at });
  assert.equal(r.status, 409, JSON.stringify(r.out));
  assert.match(r.out.error, /already kept/);
  assert.deepEqual(r.calls, [], 'typed although a copy waits for the box');
  assert.equal(rows().length, before, 'a duplicate row was added');
  assert.equal(rowAt(at).delivery.state, 'could_not');
});

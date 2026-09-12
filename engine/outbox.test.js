'use strict';
/**
 * #1704 PR2 (plan §5): the outbox a kept-running agent's reply / msg / post lands
 * in when the board answering is serving another Kosmos, and the drain that
 * delivers it once the right board serves again. The drain is driven here with
 * injected deliverers; server.world-outbox-1704.test.js drives it through the
 * board's real reply / msg / post paths.
 *
 *   node --test engine/outbox.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root BEFORE any store-using require (repo convention 2):
// sendertoken freezes its directory at require, and the outbox writes under
// store.ROOT.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-outbox-1704-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const outbox = require('./outbox');
const sendertoken = require('./sendertoken');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const POSIX = process.platform !== 'win32';
function clear() { fs.rmSync(outbox.outboxDir(), { recursive: true, force: true }); }
function names() { try { return fs.readdirSync(outbox.outboxDir()).sort(); } catch { return []; } }
const quiet = () => {};

test('keep writes one owner-only entry under store.ROOT/outbox, and list and remove round-trip it', () => {
  clear();
  assert.equal(outbox.outboxDir(), path.join(store.ROOT, 'outbox'), 'the outbox lives in this world\'s own store');
  const kept = outbox.keep({ verb: 'reply', body: { text: 'hello', from_pane: '' }, from: 'ava', at: '2026-01-02T03:04:05.000Z' });
  assert.equal(kept.ok, true, JSON.stringify(kept));
  assert.deepEqual(names(), [kept.id + '.json'], 'one file, and no temp left behind by the atomic write');
  if (POSIX) {
    assert.equal(fs.statSync(path.join(outbox.outboxDir(), kept.id + '.json')).mode & 0o777, 0o600, 'an entry holds the agent\'s words: owner-only');
    assert.equal(fs.statSync(outbox.outboxDir()).mode & 0o777, 0o700);
  }
  assert.deepEqual(outbox.list(), [{ id: kept.id, entry: { verb: 'reply', body: { text: 'hello', from_pane: '' }, from: 'ava', at: '2026-01-02T03:04:05.000Z' } }]);
  assert.deepEqual(outbox.remove(kept.id), { ok: true });
  assert.deepEqual(outbox.list(), []);
  assert.deepEqual(outbox.remove(kept.id), { ok: true }, 'already gone is success');
  assert.equal(outbox.remove('../../board.token').ok, false, 'only an entry id is ever removed');
});

test('list is oldest first, ignores what is not an entry, and reports a damaged entry instead of throwing', () => {
  clear();
  const first = outbox.keep({ verb: 'msg', body: { to: 'bo', text: 'one' }, from: 'ava' });
  const second = outbox.keep({ verb: 'post', body: { project: 'p', text: 'two' }, from: 'ava' });
  fs.writeFileSync(path.join(outbox.outboxDir(), 'notes.txt'), 'not an entry');
  fs.writeFileSync(path.join(outbox.outboxDir(), second.id + '.json.kosmos-1-t0-1-1.tmp'), '{}');
  fs.writeFileSync(path.join(outbox.outboxDir(), '0000000000001-deadbeef.json'), 'not json');
  const listed = outbox.list();
  assert.deepEqual(listed.map((x) => x.id), ['0000000000001-deadbeef', first.id, second.id]);
  assert.equal(listed[0].entry, null);
  assert.match(listed[0].because, /not JSON/);
});

test('keep refuses what it must not keep, and writes nothing when it does', () => {
  clear();
  assert.equal(outbox.keep({ verb: 'report', body: { state: 'idle' }, from: 'ava' }).ok, false, 'a report is stale by the time its Kosmos opens');
  assert.equal(outbox.keep({ verb: 'react', body: {}, from: 'ava' }).ok, false);
  assert.match(outbox.keep({ verb: 'reply', body: { text: 'x' }, from: '' }).because, /could not tell which agent/);
  assert.equal(outbox.keep({ verb: 'reply', body: { text: 'x' }, from: '../evil' }).ok, false, 'a sender name is a session name, nothing else');
  assert.equal(outbox.keep({ verb: 'reply', body: 'x', from: 'ava' }).ok, false);
  const big = outbox.keep({ verb: 'msg', body: { to: 'bo', text: 'x'.repeat(outbox.MAX_ENTRY_BYTES) }, from: 'ava' });
  assert.equal(big.ok, false);
  assert.match(big.because, /too long/);
  assert.deepEqual(names(), []);
});

test('a full outbox refuses the next keep with a sentence and keeps everything it already had', () => {
  clear();
  fs.mkdirSync(outbox.outboxDir(), { recursive: true });
  const base = Date.now() - 10000;
  for (let i = 0; i < outbox.MAX_ENTRIES; i += 1) {
    fs.writeFileSync(path.join(outbox.outboxDir(), String(base + i) + '-0000beef.json'), '{}');
  }
  const refused = outbox.keep({ verb: 'reply', body: { text: 'one more' }, from: 'ava' });
  assert.equal(refused.ok, false);
  assert.match(refused.because, /as much as it can keep/);
  assert.equal(names().length, outbox.MAX_ENTRIES, 'nothing older was dropped to make room');

  clear();
  fs.mkdirSync(outbox.outboxDir(), { recursive: true });
  fs.writeFileSync(path.join(outbox.outboxDir(), String(base) + '-0000beef.json'), Buffer.alloc(outbox.MAX_TOTAL_BYTES));
  const bytes = outbox.keep({ verb: 'reply', body: { text: 'one more' }, from: 'ava' });
  assert.equal(bytes.ok, false, 'the byte cap refuses too');
  clear();
});

test('from: the launch token wins, the pane is the fallback, and neither is a refusal', () => {
  const minted = sendertoken.mint('ava');
  assert.equal(minted.ok, true);
  assert.deepEqual(outbox.resolveKeepSender({ KOSMOS_AGENT_TOKEN: minted.token }), { ok: true, name: 'ava' });

  const asked = [];
  const viaPane = outbox.resolveKeepSender({ TMUX_PANE: '%3' }, { paneSession: (p) => { asked.push(p); return { ok: true, session: 'bo' }; } });
  assert.deepEqual(viaPane, { ok: true, name: 'bo' });
  assert.deepEqual(asked, ['%3'], 'the pane asked is the one the agent runs in');

  const unknown = outbox.resolveKeepSender({ KOSMOS_AGENT_TOKEN: 'ab'.repeat(32), TMUX_PANE: '%3' }, { paneSession: () => ({ ok: true, session: 'bo' }) });
  assert.equal(unknown.ok, false, 'a token that does not resolve is refused, never swapped for the weaker pane');

  assert.equal(outbox.resolveKeepSender({}).ok, false);
  assert.match(outbox.resolveKeepSender({}).because, /could not tell which agent/);

  clear();
  const kept = outbox.keepFromClient({ verb: 'reply', body: { text: 'hi', from_pane: '' }, env: { KOSMOS_AGENT_TOKEN: minted.token } });
  assert.equal(kept.ok, true);
  assert.equal(outbox.list()[0].entry.from, 'ava', 'the sender is decided at keep time, from the agent\'s own credential');
  clear();
});

test('runKeepCommand (install/kosmos\'s way in): the body comes from a file, the file is deleted, and the kept sentence is printed', () => {
  clear();
  const minted = sendertoken.mint('ava');
  const bodyFile = path.join(SANDBOX, 'body.json');
  fs.writeFileSync(bodyFile, JSON.stringify({ text: 'from the shell', from_pane: '%1' }));
  const said = [];
  const code = outbox.runKeepCommand(['keep', 'reply', bodyFile], { env: { KOSMOS_AGENT_TOKEN: minted.token }, out: (s) => said.push(s) });
  assert.equal(code, 0);
  assert.deepEqual(said, [outbox.WRONG_WORLD_SENTENCES.kept]);
  assert.equal(fs.existsSync(bodyFile), false, 'the agent\'s words do not outlive the keep in a temp file');
  assert.equal(outbox.list()[0].entry.body.text, 'from the shell');

  assert.equal(outbox.runKeepCommand(['keep'], { out: quiet }), 2);
  fs.writeFileSync(bodyFile, '{}');
  const nobody = [];
  assert.equal(outbox.runKeepCommand(['keep', 'reply', bodyFile], { env: {}, out: (s) => nobody.push(s) }), 1);
  assert.match(nobody[0], /could not tell which agent/);
  clear();
});

test('drain: delivered is removed, a retry stays, and a msg is retried until it is placed', () => {
  clear();
  outbox.keep({ verb: 'msg', body: { to: 'bo', text: 'later' }, from: 'ava' });
  let tries = 0;
  const handlers = {
    knownAgent: (n) => n === 'ava',
    deliverMsg: () => { tries += 1; return tries === 1 ? { outcome: 'retry', because: 'bo is not running' } : { outcome: 'delivered' }; },
    log: quiet,
  };
  assert.deepEqual(outbox.drain(handlers), { delivered: 0, dropped: 0, waiting: 1 });
  assert.equal(outbox.list().length, 1, 'a message that could not be placed yet is kept for the next drain');
  assert.deepEqual(outbox.drain(handlers), { delivered: 1, dropped: 0, waiting: 0 });
  assert.deepEqual(outbox.list(), []);
});

test('drain: a sender that is not an agent here is dropped without delivering, and the log carries no text', () => {
  clear();
  outbox.keep({ verb: 'reply', body: { text: 'SECRET-WORDS' }, from: 'mallory' });
  const lines = [];
  let delivered = 0;
  const summary = outbox.drain({ knownAgent: (n) => n === 'ava', deliverReply: () => { delivered += 1; return { outcome: 'delivered' }; }, log: (l) => lines.push(l) });
  assert.equal(delivered, 0);
  assert.equal(summary.dropped, 1);
  assert.deepEqual(outbox.list(), []);
  assert.match(lines.join('\n'), /mallory is not an agent in this Kosmos/);
  assert.doesNotMatch(lines.join('\n'), /SECRET-WORDS/);
});

test('drain: a dropped verdict removes, a damaged file is dropped, a throw is retried, and an old retry is given up', () => {
  clear();
  outbox.keep({ verb: 'reply', body: { text: 'bad' }, from: 'ava' });
  fs.writeFileSync(path.join(outbox.outboxDir(), '0000000000001-deadbeef.json'), 'not json');
  const dropped = outbox.drain({ knownAgent: () => true, deliverReply: () => ({ outcome: 'dropped', because: 'refused' }), log: quiet });
  assert.equal(dropped.dropped, 2);
  assert.deepEqual(outbox.list(), []);

  outbox.keep({ verb: 'post', body: { project: 'p', text: 'x' }, from: 'ava' });
  const threw = outbox.drain({ knownAgent: () => true, deliverPost: () => { throw new Error('boom'); }, log: quiet });
  assert.equal(threw.waiting, 1, 'a delivery that throws is kept for another try');
  clear();

  const old = new Date(Date.now() - outbox.OUTBOX_RETRY_MAX_AGE_MS - 60000).toISOString();
  outbox.keep({ verb: 'msg', body: { to: 'bo', text: 'x' }, from: 'ava', at: old });
  const expired = [];
  const given = outbox.drain({ knownAgent: () => true, deliverMsg: () => ({ outcome: 'retry', because: 'bo is not running' }), onExpired: (e, why) => expired.push([e.body.to, why]), log: quiet });
  assert.equal(given.dropped, 1);
  assert.deepEqual(expired, [['bo', 'bo is not running']]);
  assert.deepEqual(outbox.list(), []);
});

'use strict';
/**
 * #1704 PR2 (plan §5), the board's half of "keep running: nothing sent is lost".
 *
 * 1. THE 421. A loopback POST to one of the five agent routes whose
 *    `x-kosmos-world` header names a Kosmos this board is not serving is refused
 *    with 421 {wrongWorld, serving, because}, BEFORE the board-token gate. An
 *    absent header is today's behaviour; a same-world header is let through to
 *    every check it met before.
 * 2. THE DRAIN. Sends an agent kept in its own Kosmos's outbox are delivered by
 *    the board serving that Kosmos, through the same functions the routes use.
 *
 * Driven through the real routes on a sandboxed board. `worldenv.bootedWorld()`
 * is stubbed per test (the server reads it on each request), the same way
 * server.named-world-spawn-2827.test.js does. The roster comes from
 * test-support/fleet.js, so the drain sees real snapshot() cards.
 *
 *   node --test server.world-outbox-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-world-outbox-1704-'));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server, boardAuthState, drainOutboxNow } = require('./server');
const worldenv = require('./engine/worldenv');
const chat = require('./engine/chat');
const messages = require('./engine/messages');
const outbox = require('./engine/outbox');
const store = require('./engine/store');
const fleet = require('./test-support/fleet');
const { WORLD_HEADER } = require('./engine/launchidentity');

const TOK = 'BOARDTOKEN_1704_0123456789abcdef';
const AGENT_ROUTES = ['/api/report', '/api/reply', '/api/msg', '/api/post', '/api/react'];

let base;
const realBooted = worldenv.bootedWorld;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  worldenv.bootedWorld = realBooted;
  boardAuthState.on = false;
  boardAuthState.token = null;
  fleet.restore();
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const stubBooted = (id) => { worldenv.bootedWorld = () => id; };
const post = (route, headers, body) => fetch(base + route, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(body || {}),
});

// ── the 421 ─────────────────────────────────────────────────────────────────

test('a board serving a named Kosmos refuses every agent route with 421 when the header names another Kosmos', async () => {
  stubBooted('mars');
  for (const route of AGENT_ROUTES) {
    const res = await post(route, { [WORLD_HEADER]: 'default' }, {});
    assert.equal(res.status, 421, route);
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['wrongWorld', 'serving', 'because'],
      'wrongWorld leads: install/kosmos recognises the answer by its first key');
    assert.equal(body.wrongWorld, true);
    assert.equal(body.serving, 'mars');
    assert.match(body.because, /different Kosmos/);
  }
});

test('CONTROL: an absent header is today\'s behaviour, and a same-world header is let through', async () => {
  stubBooted('mars');
  for (const route of AGENT_ROUTES) {
    const absent = await post(route, {}, {});
    await absent.text();
    assert.notEqual(absent.status, 421, route + ': a caller that names no Kosmos (the page, an older client) must not be refused for it');
    const same = await post(route, { [WORLD_HEADER]: 'mars' }, {});
    await same.text();
    assert.notEqual(same.status, 421, route + ': the Kosmos this board serves is the right one');
  }
});

test('the default world: "default" or an empty header passes, a named Kosmos is refused', async () => {
  stubBooted('default');
  for (const named of ['default', '']) {
    const r = await post('/api/reply', { [WORLD_HEADER]: named }, {});
    await r.text();
    assert.notEqual(r.status, 421, JSON.stringify(named) + ' is the default world, exactly as KOSMOS_WORLD="" is');
  }
  const other = await post('/api/reply', { [WORLD_HEADER]: 'mars' }, {});
  assert.equal(other.status, 421);
  assert.equal((await other.json()).serving, 'default');
});

test('a never-booted board (bootedWorld null) is "unknown", worldenv\'s own rule, so it refuses nothing (review round 1)', async () => {
  stubBooted(null);
  for (const named of ['default', '', 'mars']) {
    const r = await post('/api/reply', { [WORLD_HEADER]: named }, {});
    await r.text();
    assert.notEqual(r.status, 421, 'an unknown booted world cannot be a mismatch (' + JSON.stringify(named) + ')');
  }
});

test('a route that is not an agent send ignores the header (kosmos open\'s board-nonce carries it too)', async () => {
  stubBooted('mars');
  const status = await fetch(base + '/api/status', { headers: { [WORLD_HEADER]: 'default' } });
  await status.text();
  assert.notEqual(status.status, 421);
  const nonce = await post('/api/board-nonce', { [WORLD_HEADER]: 'default' }, {});
  await nonce.text();
  assert.notEqual(nonce.status, 421, 'a person\'s `kosmos open` from a terminal with no KOSMOS_WORLD must still work');
});

test('on an enforcing board the 421 comes BEFORE the token check, and a same-world send still meets the token check', async () => {
  stubBooted('mars');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  try {
    const wrong = await post('/api/msg', { [WORLD_HEADER]: 'default', 'x-kosmos-board-token': 'the-other-kosmos-token' }, { to: 'bo', text: 'hi' });
    await wrong.text();
    assert.equal(wrong.status, 421, 'another Kosmos\'s agent presents its own board token; "wrong world" is what lets it keep the send');
    const same = await post('/api/msg', { [WORLD_HEADER]: 'mars' }, { to: 'bo', text: 'hi' });
    await same.text();
    assert.equal(same.status, 403, 'the world check never replaces the token check');
  } finally {
    boardAuthState.on = false;
    boardAuthState.token = null;
  }
});

// ── the drain ───────────────────────────────────────────────────────────────

function clearOutbox() { fs.rmSync(outbox.outboxDir(), { recursive: true, force: true }); }
function withFleet(fn) {
  const board = fleet.install([fleet.agent('ava', { state: 'idle' }), fleet.agent('bo', { state: 'idle' })]);
  return Promise.resolve().then(() => fn(board)).finally(() => board.restore());
}
function capturingStderr(fn) {
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return true; };
  try { return { value: fn(), log: lines.join('') }; } finally { process.stderr.write = original; }
}

test('drain: a kept reply lands in the agent\'s thread with its ORIGINAL time, and leaves the outbox', () => withFleet(() => {
  clearOutbox();
  const at = '2026-03-04T05:06:07.000Z';
  assert.equal(outbox.keep({ verb: 'reply', body: { text: 'kept while you were away', from_pane: '' }, from: 'ava', at }).ok, true);
  const summary = drainOutboxNow();
  assert.equal(summary.delivered, 1);
  const row = chat.readThread(chat.DIRECT, 'ava').messages.find((m) => m.text === 'kept while you were away');
  assert.ok(row, 'the reply is in the agent\'s thread with the person');
  assert.equal(row.at, at, 'the time it was sent, not the time the board caught up');
  assert.equal(row.from, 'ava', 'written as the agent\'s own reply');
  assert.deepEqual(outbox.list(), []);
}));

test('drain: an agent with a profile here counts even when it is not running', () => withFleet(() => {
  clearOutbox();
  store.writeProfile('cy', { displayName: 'Cy' });
  outbox.keep({ verb: 'reply', body: { text: 'from a stopped agent' }, from: 'cy' });
  assert.equal(drainOutboxNow().delivered, 1);
  assert.ok(chat.readThread(chat.DIRECT, 'cy').messages.some((m) => m.text === 'from a stopped agent'));
}));

test('drain: a kept send from a name that is no agent in this Kosmos is dropped, and nothing is written for it', () => withFleet(() => {
  clearOutbox();
  outbox.keep({ verb: 'reply', body: { text: 'forged' }, from: 'mallory' });
  const { value, log } = capturingStderr(() => drainOutboxNow());
  assert.equal(value.dropped, 1);
  assert.deepEqual(outbox.list(), []);
  assert.equal(fs.existsSync(chat.threadFile(chat.DIRECT, 'mallory')), false, 'no thread was made for a name that is not ours');
  assert.match(log, /mallory is not an agent in this Kosmos/);
  assert.doesNotMatch(log, /forged/, 'the log names the sender, never the words');
}));

test('drain: a kept msg to a name not in this Kosmos is dropped, and the sender gets a refused row saying so', () => withFleet(() => {
  clearOutbox();
  outbox.keep({ verb: 'msg', body: { to: 'zed', text: 'hello zed' }, from: 'ava' });
  const { value } = capturingStderr(() => drainOutboxNow());
  assert.equal(value.dropped, 1);
  assert.deepEqual(outbox.list(), []);
  const row = messages.readLog().find((m) => m && m.kind === 'refused' && m.from === 'ava' && m.to === 'zed');
  assert.ok(row, 'the sender\'s refused row is where a send that did not land is shown');
  assert.match(row.because, /your message to zed was not delivered: zed is not in this Kosmos/);
}));

test('drain: a kept msg to a colleague here that cannot be placed yet stays for the next drain', () => withFleet(() => {
  clearOutbox();
  outbox.keep({ verb: 'msg', body: { to: 'bo', text: 'later' }, from: 'ava' });
  // This board runs dry (AGENT_WORKFORCE_DRY_RUN), so nothing can be typed into bo's pane.
  const { value } = capturingStderr(() => drainOutboxNow());
  assert.equal(value.waiting, 1);
  assert.equal(outbox.list().length, 1, 'kept for retry, not dropped');
  clearOutbox();
}));

test('drain: a kept post goes through the same function as /api/post (the same answer for a room that does not exist)', () => withFleet(async () => {
  clearOutbox();
  const live = await (await post('/api/post', {}, { project: 'no-such-room', text: 'hi', from_pane: '' })).json();
  assert.equal(live.delivery.state, 'could_not');
  outbox.keep({ verb: 'post', body: { project: 'no-such-room', text: 'hi', from_pane: '' }, from: 'ava' });
  const { value, log } = capturingStderr(() => drainOutboxNow());
  assert.equal(value.waiting, 1);
  assert.ok(log.includes(live.delivery.because), 'the drain met the route\'s own refusal: ' + log);
  clearOutbox();
}));

test('drain: a pass stops at its cap, and the next pass carries on where it stopped (review round 1)', () => withFleet(() => {
  clearOutbox();
  outbox.keep({ verb: 'reply', body: { text: 'first of two' }, from: 'ava' });
  outbox.keep({ verb: 'reply', body: { text: 'second of two' }, from: 'ava' });
  const first = drainOutboxNow({ maxDeliveries: 1 });
  assert.equal(first.delivered, 1);
  assert.ok(first.next, 'the board hears where to carry on');
  assert.equal(outbox.list().length, 1, 'the rest waits for the next pass');
  const second = drainOutboxNow({ after: first.next, maxDeliveries: 1 });
  assert.equal(second.delivered, 1);
  assert.equal(second.next, null);
  assert.deepEqual(outbox.list(), []);
  const texts = chat.readThread(chat.DIRECT, 'ava').messages.map((m) => m.text);
  assert.ok(texts.includes('first of two') && texts.includes('second of two'));
}));

test('drain: a Discord-bridged agent\'s reply, kept from its own window, reaches its bare name\'s thread (review round 2)', () => withFleet(() => {
  clearOutbox();
  /* fleet.agent('ava') runs in the session `ava-discord`, as a real Discord-bridged
     agent does, and its card is filed under `ava`. */
  store.writeProfile('ava', { displayName: 'Ava' });
  const kept = outbox.keepFromClient({
    verb: 'reply', body: { text: 'from the discord window', from_pane: '%2' },
    env: { TMUX_PANE: '%2', KOSMOS_WORLD: '' },
    seams: { paneSession: () => ({ ok: true, session: 'ava-discord' }) },
  });
  assert.equal(kept.ok, true, JSON.stringify(kept));
  assert.equal(outbox.list()[0].entry.from, 'ava');
  assert.equal(drainOutboxNow().delivered, 1, 'the drain\'s agent check sees the same name the keep stored');
  assert.ok(chat.readThread(chat.DIRECT, 'ava').messages.some((m) => m.text === 'from the discord window'));
  assert.deepEqual(outbox.list(), []);
}));

test('drain: a live legacy Discord agent with no profile and no token is kept from its window and delivered (review round 3)', () => withFleet(() => {
  clearOutbox();
  /* fleet.agent('bo') runs in `bo-discord` with no claim and, in this sandbox, no
     profile: the board ties it by the -discord rule alone, as a never-adopted
     legacy bot running from its own launch script is tied. */
  assert.equal(Object.keys(store.readProfile('bo')).length, 0, 'the scenario: no profile');
  const kept = outbox.keepFromClient({
    verb: 'reply', body: { text: 'from a legacy bot', from_pane: '%3' },
    env: { TMUX_PANE: '%3', KOSMOS_WORLD: '' },
    seams: { paneSession: () => ({ ok: true, session: 'bo-discord' }), paneClaim: () => '' },
  });
  assert.equal(kept.ok, true, JSON.stringify(kept));
  assert.equal(outbox.list()[0].entry.from, 'bo');
  assert.equal(drainOutboxNow().delivered, 1, 'the drain accepts it by its tied card, as the keep now does');
  assert.ok(chat.readThread(chat.DIRECT, 'bo').messages.some((m) => m.text === 'from a legacy bot'));
  assert.deepEqual(outbox.list(), []);
}));

'use strict';
/**
 * #1704 PR2 (plan §5): the Windows agent's `kosmos` against a board that is
 * serving ANOTHER Kosmos (421 wrongWorld). A reply, a msg or a post is kept in
 * this agent's own Kosmos and the command exits 0 with the kept sentence; a
 * report is dropped as stale (exit 0, nothing kept); a react exits 1 (nothing
 * kept). Every request names the agent's Kosmos.
 *
 * Driven through the real CLI, the real report hook (url, tokens) and the real
 * outbox, against a local HTTP stub that answers 421 the way server.js does.
 *
 *   node --test tools.windows-kosmos-cli-outbox-1704.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Sandbox the data root BEFORE any store-using require (repo convention 2): the
// outbox writes under store.ROOT, and sendertoken freezes its directory.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-outbox-1704-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('./tools/windows/kosmos-cli');
const outbox = require('./engine/outbox');
const sendertoken = require('./engine/sendertoken');
const { WORLD_HEADER } = require('./engine/launchidentity');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const minted = sendertoken.mint('ava');
function clear() { fs.rmSync(outbox.outboxDir(), { recursive: true, force: true }); }

/* A board that is serving another Kosmos: every request gets server.js's 421. */
function withWrongWorldBoard(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(421, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ wrongWorld: true, serving: 'default', because: 'That came from an agent in a different Kosmos from the one open right now, so this board did not take it.' }));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

async function run(argv, env) {
  const out = [];
  const err = [];
  const code = await cli.main(argv, { env, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('reply, msg and post on a 421 are kept in this agent\'s Kosmos: exit 0, the kept sentence, the words intact', () => withWrongWorldBoard(async (port, seen) => {
  clear();
  const env = { KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: minted.token, KOSMOS_WORLD: 'test' };
  for (const [argv, verb, body] of [
    [['reply', 'the', 'answer'], 'reply', { text: 'the answer', from_pane: '' }],
    [['msg', 'bo', 'see', 'you'], 'msg', { to: 'bo', text: 'see you', from_pane: '' }],
    [['post', 'proj-1', 'room', 'news'], 'post', { project: 'proj-1', text: 'room news', from_pane: '' }],
  ]) {
    const r = await run(argv, env);
    assert.equal(r.code, 0, verb + ': ' + r.err);
    assert.equal(r.out, outbox.WRONG_WORLD_SENTENCES.kept);
    const last = outbox.list().pop();
    assert.equal(last.entry.verb, verb);
    assert.equal(last.entry.from, 'ava', 'the sender is the agent whose token this is');
    assert.deepEqual(last.entry.body, body, 'what is kept is exactly what the board was sent');
  }
  assert.equal(outbox.list().length, 3, 'one entry per send');
  /* Node's fetch (undici) retries a 421 once on a fresh connection, which RFC 9110
     allows, so the stub may see each send twice; the board's refusal has no side
     effect, so that is harmless. What matters is that every request names the
     agent's Kosmos. */
  assert.ok(seen.length >= 3);
  for (const s of seen) assert.equal(s.headers[WORLD_HEADER], 'test', 'every request names the agent\'s Kosmos');
}));

test('a report on a 421 is dropped as stale: exit 0, one line, nothing kept', () => withWrongWorldBoard(async (port) => {
  clear();
  const r = await run(['report', 'working', 'on', 'it'], { KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: minted.token });
  assert.equal(r.code, 0);
  assert.equal(r.out, outbox.WRONG_WORLD_SENTENCES.staleReport);
  assert.deepEqual(outbox.list(), []);
}));

test('react and whoami on a 421 exit 1 with a sentence and keep nothing', () => withWrongWorldBoard(async (port) => {
  clear();
  const env = { KOSMOS_PORT: String(port), KOSMOS_AGENT_TOKEN: minted.token };
  const react = await run(['react', 'proj-1', 'm3', '🔥'], env);
  assert.equal(react.code, 1);
  assert.equal(react.err, outbox.WRONG_WORLD_SENTENCES.notOpen);
  const whoami = await run(['whoami'], env);
  assert.equal(whoami.code, 1);
  assert.deepEqual(outbox.list(), []);
}));

test('a reply on a 421 with no way to tell who is sending is not kept, and says so (exit 1)', () => withWrongWorldBoard(async (port) => {
  clear();
  const r = await run(['reply', 'orphan'], { KOSMOS_PORT: String(port) });
  assert.equal(r.code, 1);
  assert.match(r.err, /could not tell which agent/);
  assert.deepEqual(outbox.list(), []);
}));

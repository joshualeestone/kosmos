'use strict';
/*
 * kosmos#7861: through the route the agent page polls, GET /api/agent/<name>/thread. A person's message naming a bare
 * address (no http) gets a preview on a later read, fetched over https first and over http when https is not reached; the same post with http:// in
 * front is the control that already worked. Nothing touches the network: engine/unfurl's own fetch seam answers.
 *
 *   node --test server.unfurl-bare-7861.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bareprev-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bareprev-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bareprev-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bareprev-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bareprev-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const messages = require('./engine/messages');
const unfurl = require('./engine/unfurl');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');

const base = () => `http://127.0.0.1:${server.address().port}`;
const page = (title) => ({ status: 200, ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html' : null) },
  arrayBuffer: async () => Buffer.from('<title>' + title + '</title>'), body: null });
let calls = [];
/* The record keeps every earlier test's message, and each read re-fetches their links after a cache reset, so a test
   reads only the fetches for its own host. */
const callsFor = (host) => calls.filter((u) => new URL(u).hostname === host);
let seq = 0;

let AGENT = null;
test.before(async () => {
  await start(0);
  AGENT = fleet.install([fleet.agent('ava', { state: 'idle' })]).agents[0].name;
});
test.after(() => {
  unfurl.resetForTests();
  try { fleet.restore(); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});
test.beforeEach(() => {
  unfurl.resetForTests();
  calls = [];
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(String(url));
    if (url === 'https://bare7861.com/') throw new TypeError('fetch failed');   // this site has no https
    if (url === 'http://bare7861.com/') return page('Bare over http');
    if (url === 'https://tls7861.com/') return page('Bare over https');
    if (url === 'http://typed7861.com/') return page('Typed with http');
    throw new Error('no such page in the fixture: ' + url);
  });
});

/* A message the person sent an agent, written to its direct thread the way the board records one; then read back through
   the route until a read carries a preview (the first read starts the fetch), for up to two seconds, so a loaded
   machine is not a red. A row that never gets one is read once more and returned as it is. */
async function postAndRead(text, extra) {
  seq += 1;
  const kept = chat.appendMessage(chat.DIRECT, AGENT, { text, at: new Date(Date.now() + seq).toISOString(), delivery: { state: chat.DELIVERY.PLACED }, ...(extra || {}) });
  assert.notEqual(kept && kept.recorded, false, 'CONTROL: the thread took the message: ' + JSON.stringify(kept));
  const read = async () => (await (await fetch(base() + '/api/agent/' + encodeURIComponent(AGENT) + '/thread')).json()).messages.find((x) => x.text === text);
  const first = await read();
  assert.ok(first, 'CONTROL: the message is in the thread the route serves');
  for (let i = 0; i < 100; i += 1) {
    const r = await read();
    if (r && r.preview) return r;
    await new Promise((res) => setTimeout(res, 20));
  }
  return read();
}

test('#7861 a bare address in a message from the person gets a preview on the next read, over http when https is not reached', async () => {
  const row = await postAndRead('see bare7861.com for it');
  assert.ok(row.preview, 'no preview on the row: ' + JSON.stringify(row));
  assert.equal(row.preview.title, 'Bare over http');
  assert.deepEqual(callsFor('bare7861.com'), ['https://bare7861.com/', 'http://bare7861.com/']);
});

test('#7861 a bare address whose https answers is previewed over https, and http is never asked', async () => {
  const row = await postAndRead('try tls7861.com.');
  assert.equal(row.preview && row.preview.title, 'Bare over https', JSON.stringify(row));
  assert.deepEqual(callsFor('tls7861.com'), ['https://tls7861.com/']);
});

test('#7861 CONTROL: the same kind of post with http:// typed in front previewed before and still does', async () => {
  const row = await postAndRead('see http://typed7861.com today');
  assert.equal(row.preview && row.preview.title, 'Typed with http', JSON.stringify(row));
  assert.deepEqual(callsFor('typed7861.com'), ['http://typed7861.com/']);
});

test('#7861 a message carrying a file named like a host (its text is the file name, which the page hides) is not fetched', async () => {
  const row = await postAndRead('files7861.com', { attachment: { id: 'a7861', name: 'files7861.com', size: 3, type: 'text/plain' } });
  assert.equal(row.preview, undefined);
  assert.deepEqual(callsFor('files7861.com'), []);
});

test('#7861 CONTROL: a file name and a code span are not fetched', async () => {
  const row = await postAndRead('notes.md and `curl code7861.com`');
  assert.equal(row.preview, undefined);
  assert.deepEqual(callsFor('code7861.com'), []);
  assert.deepEqual(callsFor('notes.md'), []);
});

test('#7861 GET /api/messages (read by no screen, serving every agent\'s record) previews no bare address, only a typed link', async () => {
  seq += 1;
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const text = 'old record unread7861.com';
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'message', id: 'm7861-' + seq, from: 'you', to: AGENT, text, at: new Date().toISOString(), state: 'delivered' }) + '\n');
  for (let i = 0; i < 5; i += 1) { await (await fetch(base() + '/api/messages')).json(); await new Promise((res) => setTimeout(res, 20)); }
  assert.deepEqual(callsFor('unread7861.com'), [], 'the unread record fetched a bare address');
  // CONTROL: the same route still previews a link typed with http.
  const typed = 'old record http://typed7861.com';
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'message', id: 'm7861-x' + seq, from: 'you', to: AGENT, text: typed, at: new Date().toISOString(), state: 'delivered' }) + '\n');
  for (let i = 0; i < 5; i += 1) { await (await fetch(base() + '/api/messages')).json(); await new Promise((res) => setTimeout(res, 20)); }
  assert.ok(callsFor('typed7861.com').length >= 1, 'CONTROL: a typed link on that route was not fetched');
});

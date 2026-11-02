'use strict';

/**
 * kosmos#7810: a long direct conversation sat on "Loading the conversation" over a weak signal. The thread read sent
 * the newest 200 messages (about 100 KB) on every open and again every 5 s. GET /api/agent/<name>/thread?tail=N now
 * answers only the newest N, with positions that agree with the older-pages route, and every thread read carries an
 * ETag, so a repeat read naming it (If-None-Match) is a bodyless 304 until something changes.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.dmtail-7810.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dmtail-7810-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');

const AGENT = 'mona';
const SHORT = 'helperbot';
let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  fleet.install([fleet.agent(AGENT, { state: 'idle' }), fleet.agent(SHORT, { state: 'idle' })]);
  for (let i = 0; i < 450; i += 1) {
    const r = chat.appendMessage(chat.DIRECT, AGENT, { text: 'message ' + i, at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() });
    assert.equal(r.recorded, true, r.because);
  }
  for (let i = 0; i < 12; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, SHORT, { text: 'short ' + i }).recorded, true);
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const get = async (p, headers = {}) => {
  const res = await fetch(base + p, { headers });
  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  return { status: res.status, etag: res.headers.get('etag'), raw, json };
};
const texts = (j) => j.messages.filter((m) => m && typeof m.text === 'string' && /^(message|short) /.test(m.text)).map((m) => m.text);

test('kosmos#7810: tail=30 answers the newest 30, and its olderCount is the position the older-pages route reads from', async () => {
  const full = await get(`/api/agent/${AGENT}/thread`);
  assert.equal(full.status, 200);
  assert.equal(texts(full.json).length, 200, 'without tail: the newest 200, as before');
  assert.equal(full.json.olderCount, 250);
  const small = await get(`/api/agent/${AGENT}/thread?tail=30`);
  assert.equal(small.status, 200);
  assert.deepEqual(texts(small.json), Array.from({ length: 30 }, (_, i) => 'message ' + (420 + i)));
  assert.equal(small.json.olderCount, 420);
  assert.ok(small.raw.length * 4 < full.raw.length, `the small read is a fraction of the full one: ${small.raw.length} vs ${full.raw.length}`);
  const older = await get(`/api/agent/${AGENT}/thread/older?before=${small.json.olderCount}`);
  assert.equal(older.status, 200);
  const page = texts(older.json);
  assert.equal(page[page.length - 1], 'message 419', 'the page before the small read ends right before its first message');
});

test('kosmos#7810: a conversation shorter than the tail is answered whole, with nothing older', async () => {
  const r = await get(`/api/agent/${SHORT}/thread?tail=30`);
  assert.equal(r.status, 200);
  assert.equal(texts(r.json).length, 12);
  assert.equal(r.json.olderCount, 0);
});

test('kosmos#7810: a repeat read naming the ETag is a bodyless 304 until a message lands', async () => {
  const first = await get(`/api/agent/${AGENT}/thread`);
  assert.ok(first.etag && /^"[A-Za-z0-9_-]{27}"$/.test(first.etag), 'an ETag: ' + first.etag);
  const again = await get(`/api/agent/${AGENT}/thread`, { 'if-none-match': first.etag });
  assert.equal(again.status, 304);
  assert.equal(again.raw, '', 'no body');
  assert.equal(again.etag, first.etag);
  const other = await get(`/api/agent/${AGENT}/thread`, { 'if-none-match': '"not-this-one"' });
  assert.equal(other.status, 200, 'a different tag gets the conversation');
  assert.ok(texts(other.json).length > 0);
  const smallTag = (await get(`/api/agent/${AGENT}/thread?tail=30`)).etag;
  assert.notEqual(smallTag, first.etag, 'the small read and the full read are different bodies, so different tags');
  assert.equal(chat.appendMessage(chat.DIRECT, AGENT, { text: 'message 450' }).recorded, true);
  const after = await get(`/api/agent/${AGENT}/thread`, { 'if-none-match': first.etag });
  assert.equal(after.status, 200, 'a new message changes the body, so the old tag gets it');
  assert.notEqual(after.etag, first.etag);
  assert.equal(texts(after.json).at(-1), 'message 450');
});

test('kosmos#7810: a tail that is not a whole number from 1 to 200 is refused, never read as some other size', async () => {
  for (const bad of ['0', '201', 'abc', '1.5', '-3', '', '0030x']) {
    const r = await get(`/api/agent/${AGENT}/thread?tail=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, 'tail=' + JSON.stringify(bad));
    assert.match(r.json.error, /tail must be a whole number from 1 to 200/);
  }
  assert.equal((await get(`/api/agent/${AGENT}/thread?tail=200`)).status, 200);
  assert.equal((await get(`/api/agent/${AGENT}/thread?tail=1`)).json.messages.filter((m) => /^message /.test(m.text || '')).length, 1);
});

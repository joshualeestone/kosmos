'use strict';

/**
 * kosmos#5841: the EARLIER messages of a direct thread, a page at a time. The thread route sends only the latest
 * 200 and says how many older ones are kept; GET /api/agent/<name>/thread/older?before=<n> reads them. `before` is a
 * position from the OLDEST message (the thread route's `olderCount`), so a message arriving between pages cannot
 * shift one. Each arm reads through the real routes against a real thread file.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.dm-older-5841.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-older-5841-'));
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
const setupAssistant = require('./engine/setup-assistant');
const fleet = require('./test-support/fleet');
const { MASK } = require('./engine/secretmask');

const AGENT = 'mona';
const GUIDE = 'guidebot';
const OTHER = 'helperbot';
const STRANGER = 'zeta';   // a pane holding this name UNTIED: nameRefusal's 'borrowed'
const KEY = ['sk-ant-', 'api03-', 'FakeKeyFor5841Tests_abcdefGHIJ012345'].join('');
const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

let base;
test.before(async () => {
  stub(setupAssistant, 'guideName', () => GUIDE);
  stub(setupAssistant, 'isGuideFolder', (n) => n === GUIDE);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  fleet.install([fleet.agent(AGENT, { state: 'idle' }), fleet.agent(GUIDE, { state: 'idle' }), fleet.agent(OTHER, { state: 'idle' }), fleet.agent(STRANGER, { ours: false, state: 'idle' })]);
  for (let i = 0; i < 3; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, STRANGER, { text: 'private ' + i }).recorded, true);
  for (let i = 0; i < 450; i += 1) {
    const r = chat.appendMessage(chat.DIRECT, AGENT, { text: 'message ' + i, at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() });
    assert.equal(r.recorded, true, r.because);
  }
  // The guide's and another agent's threads, for the mask arm: a key stored raw (as a row from before the write-side
  // mask existed would be) and pushed onto an earlier page. Seeded HERE, before any request: ~400 synchronous appends
  // between two fetches held the event loop past the server's 5 s keep-alive, and CI's fetch reused the socket the
  // server was closing (ECONNRESET, run 38158076792).
  for (const who of [GUIDE, OTHER]) {
    assert.equal(chat.appendMessage(chat.DIRECT, who, { text: `The key is ${KEY}.` }).recorded, true);
    for (let i = 0; i < 205; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'filler ' + i }).recorded, true);
  }
});
test.after(() => {
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, json: await res.json().catch(() => null) };
};
const texts = (j) => (j && Array.isArray(j.messages) ? j.messages.map((m) => m.text) : null);

test('#5841 the thread shows the latest 200 and says 250 are older; older pages reach every one of them, oldest first', async () => {
  const t = await get(`/api/agent/${AGENT}/thread`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.olderCount, 250, 'premise: 450 kept, the latest 200 shown');
  const kept = texts(t.json).filter((x) => /^message \d+$/.test(x));
  assert.equal(kept[0], 'message 250', 'premise: the tail starts at the 251st message');

  const p1 = await get(`/api/agent/${AGENT}/thread/older?before=${t.json.olderCount}`);
  assert.equal(p1.status, 200, JSON.stringify(p1.json));
  assert.deepEqual(texts(p1.json), Array.from({ length: 200 }, (_, i) => 'message ' + (50 + i)), 'the page before the tail');
  assert.equal(p1.json.olderCount, 50);

  const p2 = await get(`/api/agent/${AGENT}/thread/older?before=${p1.json.olderCount}`);
  assert.deepEqual(texts(p2.json), Array.from({ length: 50 }, (_, i) => 'message ' + i), 'the oldest page');
  assert.equal(p2.json.olderCount, 0, 'nothing is older than the first message');
});

test('#5841 a message that arrives between pages does not shift the next one (before counts from the oldest end)', async () => {
  const t = await get(`/api/agent/${AGENT}/thread`);
  const before = t.json.olderCount;
  const r = chat.appendMessage(chat.DIRECT, AGENT, { text: 'a late one' });
  assert.equal(r.recorded, true, r.because);
  const p = await get(`/api/agent/${AGENT}/thread/older?before=${before}`);
  assert.equal(texts(p.json)[199], 'message ' + (before - 1), 'the page still ends just before the first message the tail showed');
  const again = await get(`/api/agent/${AGENT}/thread`);
  assert.equal(again.json.olderCount, before + 1, 'CONTROL: the tail did move by one, so a newest-end count would have shifted');
});

test('#5841 a position past the end is clamped, and a missing or bad one is refused', async () => {
  const all = chat.readThread(chat.DIRECT, AGENT).messages.length;
  const far = await get(`/api/agent/${AGENT}/thread/older?before=99999`);
  assert.equal(far.status, 200);
  assert.equal(texts(far.json).length, 200);
  assert.equal(far.json.olderCount, all - 200, 'clamped to the end: the newest 200');
  for (const q of ['', '?before=', '?before=-1', '?before=1.5', '?before=abc']) {
    const r = await get(`/api/agent/${AGENT}/thread/older${q}`);
    assert.equal(r.status, 400, `${q || '(none)'} was not refused: ${JSON.stringify(r.json)}`);
  }
  const none = await get(`/api/agent/${AGENT}/thread/older?before=0`);
  assert.deepEqual([none.status, texts(none.json), none.json.olderCount], [200, [], 0], 'before=0: nothing older');
});

test('#5841 an earlier page of the setup guide\'s thread is masked as the latest page is; another agent\'s is kept as sent', async () => {
  const g = await get(`/api/agent/${GUIDE}/thread/older?before=1`);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.deepEqual(texts(g.json), [`The key is ${MASK}.`], 'the guide\'s earlier page showed the key');
  assert.ok(!JSON.stringify(g.json).includes(KEY), 'the key came back in the older route\'s answer');
  const o = await get(`/api/agent/${OTHER}/thread/older?before=1`);
  assert.deepEqual(texts(o.json), [`The key is ${KEY}.`], 'CONTROL: another agent\'s earlier page is kept as sent, so the mask is the guide rule and not a blanket one');
});

test('#5841 the older route refuses a name the thread route refuses: undecodable, and a pane holding it untied', async () => {
  const r = await get('/api/agent/%ZZ/thread/older?before=1');
  assert.equal(r.status, 404, JSON.stringify(r.json));
  // The borrowed name has a thread on disk with messages in it, so a route that skipped the gate would serve them.
  const b = await get(`/api/agent/${STRANGER}/thread/older?before=3`);
  assert.equal(b.status, 404, 'a stranger\'s pane must not serve this name\'s earlier messages: ' + JSON.stringify(b.json));
  assert.equal(b.json.because, 'borrowed');
  assert.ok(!JSON.stringify(b.json).includes('private'), 'the private messages came back');
  const t = await get(`/api/agent/${STRANGER}/thread`);
  assert.equal(t.status, 404, 'CONTROL: the thread route refuses the same name, so the two gates agree');
});

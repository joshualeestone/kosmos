'use strict';

/**
 * kosmos#5841 (piece 2): a conversation that reaches the engine's cap (chat.MAX_MESSAGES) ROLLS OVER instead of
 * refusing every later send for good. The full file is renamed aside (`.full`, nothing deleted) and the conversation
 * goes on in a fresh file that names it (`continues`). The thread route counts the chain, and the older route pages
 * across it with positions from the OLDEST message. Each arm reads through the real engine and routes.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.dm-rollover-5841.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dm-rollover-5841-'));
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
const OTHER = 'helperbot';
const CAP = chat.MAX_MESSAGES;
let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  fleet.install([fleet.agent(AGENT, { state: 'idle' }), fleet.agent(OTHER, { state: 'idle' })]);
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, json: await res.json().catch(() => null) };
};
const texts = (j) => (j && Array.isArray(j.messages) ? j.messages.map((m) => m.text) : null);
const fill = (who, n, from) => {
  for (let i = 0; i < n; i += 1) {
    const r = chat.appendMessage(chat.DIRECT, who, { text: 'message ' + (from + i) });
    assert.equal(r.recorded, true, r.because);
  }
};
const asides = (who) => {
  const dir = path.dirname(chat.threadFile(chat.DIRECT, who));
  const baseName = path.basename(chat.threadFile(chat.DIRECT, who));
  return fs.readdirSync(dir).filter((f) => f.startsWith(baseName + '.') && f.endsWith('.full'));
};

test('#5841 the message past the cap is recorded, not refused: the full file is set aside whole and the new one names it', () => {
  fill(AGENT, CAP, 0);
  assert.equal(chat.readThread(chat.DIRECT, AGENT).messages.length, CAP, 'premise: the thread is at the cap');
  assert.equal(asides(AGENT).length, 0, 'premise: nothing set aside yet');
  const r = chat.appendMessage(chat.DIRECT, AGENT, { text: 'message ' + CAP });
  assert.equal(r.recorded, true, 'the message past the cap was refused: ' + r.because);
  const now = chat.readThread(chat.DIRECT, AGENT);
  assert.deepEqual(now.messages.map((m) => m.text), ['message ' + CAP], 'the new file holds only the new message');
  const set = asides(AGENT);
  assert.equal(set.length, 1, 'exactly one file set aside');
  assert.equal(now.continues, set[0], 'the new file names the one it continues');
  const kept = JSON.parse(fs.readFileSync(path.join(path.dirname(chat.threadFile(chat.DIRECT, AGENT)), set[0]), 'utf8'));
  assert.equal(kept.messages.length, CAP, 'the full file was kept whole (nothing deleted)');
  assert.equal(kept.messages[0].text, 'message 0');
  // The next write keeps the link.
  fill(AGENT, 1, CAP + 1);
  assert.equal(chat.readThread(chat.DIRECT, AGENT).continues, set[0], 'a later write dropped the link to the earlier file');
});

test('#5841 the thread route counts the earlier file, and the older route pages across it from the oldest message', async () => {
  // Kept: message 0..999 in the full file, message 1000..1001 in the current one.
  const t = await get(`/api/agent/${AGENT}/thread`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.olderCount, CAP, 'the thread route does not count the rolled-over file, so "Show earlier" would vanish');
  assert.deepEqual(texts(t.json).filter((x) => /^message \d+$/.test(x)), ['message 1000', 'message 1001']);
  const p1 = await get(`/api/agent/${AGENT}/thread/older?before=${t.json.olderCount}`);
  assert.equal(p1.status, 200, JSON.stringify(p1.json));
  assert.equal(texts(p1.json)[0], 'message 800');
  assert.equal(texts(p1.json)[199], 'message 999', 'the page before the current file ends at the full file\'s last message');
  assert.equal(p1.json.olderCount, 800);
  const first = await get(`/api/agent/${AGENT}/thread/older?before=200`);
  assert.deepEqual([texts(first.json)[0], texts(first.json)[199], first.json.olderCount], ['message 0', 'message 199', 0], 'the oldest page');
  // CONTROL: an agent that never rolled over counts only its own file.
  fill(OTHER, 3, 0);
  const o = await get(`/api/agent/${OTHER}/thread`);
  assert.equal(o.json.olderCount, 0, 'CONTROL: a short thread with nothing set aside has nothing older');
});

test('#5841 a second rollover chains: positions stay put and every file is reachable', async () => {
  fill(AGENT, CAP - 2, 1002);   // fills the current file to the cap
  fill(AGENT, 1, 2000);   // rolls over again
  assert.equal(asides(AGENT).length, 2, 'premise: two files set aside');
  const t = await get(`/api/agent/${AGENT}/thread`);
  assert.equal(t.json.olderCount, 2 * CAP, 'both earlier files are counted');
  const mid = await get(`/api/agent/${AGENT}/thread/older?before=${CAP + 1}`);
  assert.equal(texts(mid.json)[199], 'message 1000', 'a page that crosses into the second file is in order');
  assert.equal(texts(mid.json)[198], 'message 999', 'and the first file\'s last message comes right before it');
});

test('#5841 a "continues" that names anything but this thread\'s own full file is not followed', async () => {
  const file = chat.threadFile(chat.DIRECT, OTHER);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  // AGENT's real full file is a real .full file, but not OTHER's own: it must not be followed.
  const theirs = asides(AGENT)[0];
  for (const bad of [theirs, '../' + theirs, path.basename(file) + '.x.full/../../escape.full', path.basename(file)]) {
    fs.writeFileSync(file, JSON.stringify({ ...rec, continues: bad }));
    assert.deepEqual(chat.asideChain(chat.DIRECT, OTHER, false), [], `followed a link it must not: ${bad}`);
    const t = await get(`/api/agent/${OTHER}/thread`);
    assert.equal(t.json.olderCount, 0, `counted another file as this thread's: ${bad}`);
  }
  fs.writeFileSync(file, JSON.stringify(rec));
});

test('#5841 if the full file cannot be set aside, the send is refused as before, saying why', () => {
  const was = fs.renameSync;
  fill(OTHER, CAP - chat.readThread(chat.DIRECT, OTHER).messages.length, 100);
  fs.renameSync = () => { throw new Error('EACCES'); };
  let r;
  try { r = chat.appendMessage(chat.DIRECT, OTHER, { text: 'one too many' }); } finally { fs.renameSync = was; }
  assert.equal(r.recorded, false, 'a send was recorded although the full file could not be moved');
  assert.match(r.because, /could not move the full file aside/, r.because);
  assert.equal(chat.readThread(chat.DIRECT, OTHER).messages.length, CAP, 'the full file was changed');
});

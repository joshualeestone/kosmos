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

test('#5841 the message past the cap is recorded, not refused: the full file is set aside whole, the new one names it and carries the last 200', () => {
  fill(AGENT, CAP, 0);
  assert.equal(chat.readThread(chat.DIRECT, AGENT).messages.length, CAP, 'premise: the thread is at the cap');
  assert.equal(asides(AGENT).length, 0, 'premise: nothing set aside yet');
  const r = chat.appendMessage(chat.DIRECT, AGENT, { text: 'message ' + CAP });
  assert.equal(r.recorded, true, 'the message past the cap was refused: ' + r.because);
  const now = chat.readThread(chat.DIRECT, AGENT);
  const set = asides(AGENT);
  assert.equal(set.length, 1, 'exactly one file set aside');
  assert.equal(now.continues, set[0], 'the new file names the one it continues');
  assert.equal(now.carried, 200, 'the new file carries the last 200 rows');
  assert.equal(now.messages.length, 201);
  assert.deepEqual([now.messages[0].text, now.messages[199].text, now.messages[200].text], ['message 800', 'message 999', 'message 1000'],
    'the carried rows are the full file\'s last 200, then the new message');
  const kept = JSON.parse(fs.readFileSync(path.join(path.dirname(chat.threadFile(chat.DIRECT, AGENT)), set[0]), 'utf8'));
  assert.equal(kept.messages.length, CAP, 'the full file was kept whole (nothing deleted)');
  assert.equal(kept.messages[0].text, 'message 0');
  fill(AGENT, 1, CAP + 1);
  const later = chat.readThread(chat.DIRECT, AGENT);
  assert.deepEqual([later.continues, later.carried], [set[0], 200], 'a later write dropped the link or the carried count');
});

test('#5841 the thread route counts the earlier file once, and the older route pages across it from the oldest message', async () => {
  // Kept: message 0..999 in the full file; the current file carries 800..999 and holds 1000..1001 (202 rows).
  const t = await get(`/api/agent/${AGENT}/thread`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.olderCount, 802, 'olderCount must be the position of the first row shown: 1000 - 200 carried + 2');
  const shown = texts(t.json).filter((x) => /^message \d+$/.test(x));
  assert.deepEqual([shown[0], shown[shown.length - 1], shown.length], ['message 802', 'message 1001', 200]);
  const p1 = await get(`/api/agent/${AGENT}/thread/older?before=${t.json.olderCount}`);
  assert.equal(p1.status, 200, JSON.stringify(p1.json));
  assert.deepEqual([texts(p1.json)[0], texts(p1.json)[199], p1.json.olderCount], ['message 602', 'message 801', 602],
    'the page before the tail ends right before it: no carried row twice, none missing');
  const first = await get(`/api/agent/${AGENT}/thread/older?before=200`);
  assert.deepEqual([texts(first.json)[0], texts(first.json)[199], first.json.olderCount], ['message 0', 'message 199', 0], 'the oldest page');
  const all = await get(`/api/agent/${AGENT}/thread/older?before=802`);
  assert.equal(new Set(texts(all.json)).size, 200, 'no duplicated row in a page');
  // CONTROL: an agent that never rolled over counts only its own file.
  fill(OTHER, 3, 0);
  const o = await get(`/api/agent/${OTHER}/thread`);
  assert.equal(o.json.olderCount, 0, 'CONTROL: a short thread with nothing set aside has nothing older');
});

test('#5841 a second rollover chains: positions stay put and every file is reachable once', async () => {
  const cur = chat.readThread(chat.DIRECT, AGENT).messages.length;
  fill(AGENT, CAP - cur, 1002);   // fills the current file to the cap: its last row is message (1002 + CAP - cur - 1)
  const lastBefore = 1002 + CAP - cur - 1;
  fill(AGENT, 1, lastBefore + 1);   // rolls over again
  assert.equal(asides(AGENT).length, 2, 'premise: two files set aside');
  const t = await get(`/api/agent/${AGENT}/thread`);
  const shown = texts(t.json).filter((x) => /^message \d+$/.test(x));
  const firstShownN = Number(shown[0].split(' ')[1]);
  assert.equal(t.json.olderCount, firstShownN, 'olderCount is the first shown row\'s position across both files');
  const mid = await get(`/api/agent/${AGENT}/thread/older?before=1001`);
  assert.deepEqual([texts(mid.json)[198], texts(mid.json)[199]], ['message 999', 'message 1000'], 'a page across the first boundary is in order, once');
  const all = [];
  for (let b = t.json.olderCount; b > 0;) { const pg = await get(`/api/agent/${AGENT}/thread/older?before=${b}`); all.unshift(...texts(pg.json)); b = pg.json.olderCount; }
  assert.equal(all.length, firstShownN, 'paging to the start reaches every earlier row');
  assert.ok(all.every((x, i) => x === 'message ' + i), 'every earlier row once, in order');
});

test('#5841 a "continues" that names anything but this thread\'s own full file is not followed', async () => {
  const file = chat.threadFile(chat.DIRECT, OTHER);
  const dir = path.dirname(file);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  // A real file filed under OTHER, placed where only a traversal name could reach it: the name check is the only guard.
  const outside = path.join(path.dirname(dir), 'escape.full');
  fs.writeFileSync(outside, JSON.stringify({ agent: OTHER, messages: [{ text: 'outside' }] }));
  for (const bad of [asides(AGENT)[0], '../escape.full', path.basename(file) + '.x/../../escape.full', path.basename(file)]) {
    fs.writeFileSync(file, JSON.stringify({ ...rec, continues: bad }));
    assert.deepEqual(chat.asideChain(chat.DIRECT, OTHER, false), [], `followed a link it must not: ${bad}`);
    const t = await get(`/api/agent/${OTHER}/thread`);
    assert.equal(t.json.olderCount, 0, `counted another file as this thread's: ${bad}`);
  }
  fs.writeFileSync(file, JSON.stringify(rec));
  fs.rmSync(outside, { force: true });
});

test('#5841 a lost current file (a crash after the rename) reattaches to the newest full file on the next send', () => {
  const file = chat.threadFile(chat.DIRECT, AGENT);
  const newest = asides(AGENT).sort().pop();
  fs.rmSync(file);
  const r = chat.appendMessage(chat.DIRECT, AGENT, { text: 'after a crash' });
  assert.equal(r.recorded, true, r.because);
  const now = chat.readThread(chat.DIRECT, AGENT);
  assert.ok(asides(AGENT).includes(now.continues), 'the new file does not continue an earlier full file');
  assert.equal(now.continues, newest, 'it did not continue the NEWEST one');
});

test('#5841 a reaction on a row that lives only in an earlier file says so, rather than that there is no such message', () => {
  const who = 'reactbot';
  for (let i = 0; i < CAP; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { from: who, at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), text: 'r' + i }).recorded, true);
  assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'rolls it over' }).recorded, true);
  const old = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 5)).toISOString();   // r5: not among the 200 carried
  const r = chat.reactDirect(who, old, '\u{1F44D}');
  assert.equal(r.ok, false);
  assert.match(r.because, /earlier part of this conversation/, r.because);
  const recent = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 990)).toISOString();   // r990: carried, so still reactable
  assert.equal(chat.reactDirect(who, recent, '\u{1F44D}').ok, true, 'CONTROL: a carried row can still be reacted to');
});

test('#5841 a reaction made on a carried row survives when that row pages out of the latest (the newer copy is served)', async () => {
  const who = 'reactbot';
  // r990 was reacted to in the CURRENT file's carried copy; the full file's copy has no reaction. Push it out of the tail.
  for (let i = 0; i < 205; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'push ' + i }).recorded, true);
  const t = await get(`/api/agent/${who}/thread`);
  const inTail = (t.json.messages || []).some((m) => m.text === 'r990');
  assert.equal(inTail, false, 'premise: r990 has left the latest 200');
  let row = null;
  for (let b = t.json.olderCount; b > 0 && !row;) {
    const pg = await get(`/api/agent/${who}/thread/older?before=${b}`);
    row = (pg.json.messages || []).find((m) => m.text === 'r990') || null;
    b = pg.json.olderCount;
  }
  assert.ok(row, 'r990 was not found on any earlier page');
  assert.ok(Array.isArray(row.reactions) && row.reactions.length > 0, 'the reaction made after the rollover vanished when the row paged out: ' + JSON.stringify(row.reactions));
});

test('#5841 a project deleted and re-created under its name does NOT inherit the old one\'s earlier files', () => {
  const P = 'proj-reborn';
  const B1 = '2026-01-01T00:00:00.000Z';
  const B2 = '2026-02-01T00:00:00.000Z';
  for (let i = 0; i <= CAP; i += 1) assert.equal(chat.appendMessage(P, AGENT, { text: 'old ' + i }, B1).recorded, true);
  const old = chat.readThread(P, AGENT, B1);
  assert.ok(old.continues, 'premise: the first project rolled over');
  const r = chat.appendMessage(P, AGENT, { text: 'the new project speaks' }, B2);
  assert.equal(r.recorded, true, r.because);
  const now = chat.readThread(P, AGENT, B2);
  assert.equal(now.continues, null, 'the new project continued the OLD project\'s full file');
  assert.deepEqual(chat.asideChain(P, AGENT, false), [], 'the old project\'s files counted under the new one');
  assert.deepEqual(now.messages.map((m) => m.text), ['the new project speaks']);
});

test('#5841 when the chain stops early (an earlier file unreadable), the count and the pages still agree on every position', async () => {
  const dir = path.dirname(chat.threadFile(chat.DIRECT, AGENT));
  const oldest = asides(AGENT).map((n) => ({ n, at: fs.statSync(path.join(dir, n)).mtimeMs })).sort((x, y) => x.at - y.at)[0].n;
  const keep = fs.readFileSync(path.join(dir, oldest), 'utf8');
  fs.writeFileSync(path.join(dir, oldest), '{ not json');   // the walk now stops at the file after it
  try {
    const t = await get(`/api/agent/${AGENT}/thread`);
    let b = t.json.olderCount; let got = 0;
    while (b > 0) { const pg = await get(`/api/agent/${AGENT}/thread/older?before=${b}`); assert.equal(pg.json.olderCount + pg.json.messages.length, b, 'a page is not the range asked for: the routes disagree'); got += pg.json.messages.length; b = pg.json.olderCount; }
    assert.equal(got, t.json.olderCount, 'paging to the start did not reach exactly olderCount rows');
  } finally { fs.writeFileSync(path.join(dir, oldest), keep); }
});

test('#5841 a damaged current file in a rolled-over conversation keeps its chain; a failed write after the rename puts the full file back', () => {
  const file = chat.threadFile(chat.DIRECT, AGENT);
  const before = chat.readThread(chat.DIRECT, AGENT).continues;
  fs.writeFileSync(file, '{ damaged');
  assert.equal(chat.appendMessage(chat.DIRECT, AGENT, { text: 'after damage' }).recorded, true);
  assert.equal(chat.readThread(chat.DIRECT, AGENT).continues, before, 'a damaged current file orphaned the earlier files');
  // Write failure right after a rollover's rename.
  const who = 'writefail';
  for (let i = 0; i < CAP; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'w' + i }).recorded, true);
  const store = require('./engine/store');
  const was = store.saveFlushed;
  store.saveFlushed = () => { throw new Error('ENOSPC'); };
  let r;
  try { r = chat.appendMessage(chat.DIRECT, who, { text: 'one too many' }); } finally { store.saveFlushed = was; }
  assert.equal(r.recorded, false, 'premise: the write failed');
  const back = chat.readThread(chat.DIRECT, who);
  assert.deepEqual([back.messages.length, back.continues], [CAP, null], 'the full file was not put back after the failed write');
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

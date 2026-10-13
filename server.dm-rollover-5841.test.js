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
const { appendMany } = require('./test-support/thread-fixture');   // #6059

const AGENT = 'mona';
const OTHER = 'helperbot';
const BROKEN = 'brokenbot';   // a rolled-over conversation whose newest full file goes missing
const CAP = chat.MAX_MESSAGES;
let base;
let CONNECTIONS = 0;
let REQUESTS = 0;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  server.on('connection', () => { CONNECTIONS += 1; });
  fleet.install([fleet.agent(AGENT, { state: 'idle' }), fleet.agent(OTHER, { state: 'idle' }), fleet.agent(BROKEN, { state: 'idle' })]);
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* A NEW connection for every request (agent: false), never a pooled one. Several arms append ~1000 rows
   synchronously between two requests, and on CI a pooled socket reused after that gap came back ECONNRESET twice
   (piece 1's run 38158076792; this file's run 38184258270, after the server's keep-alive had already been raised to
   120 s, so that timer was not the whole cause). With no reuse there is no idle socket for any timer to close. */
const http = require('node:http');
const request = (method, p, body) => new Promise((resolve, reject) => {
  REQUESTS += 1;
  const data = body === undefined ? null : JSON.stringify(body);
  const headers = data === null ? {} : { 'content-type': 'application/json', origin: base, 'content-length': Buffer.byteLength(data) };
  const r = http.request(base + p, { method, agent: false, headers }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { buf += c; });
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(buf); } catch { json = null; }
      resolve({ status: res.statusCode, json });
    });
  });
  r.on('error', reject);
  if (data !== null) r.write(data);
  r.end();
});
const get = (p) => request('GET', p);
const texts = (j) => (j && Array.isArray(j.messages) ? j.messages.map((m) => m.text) : null);
const post = (p, body) => request('POST', p, body || {});
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
  // #6059: one write after the first append, not 205 appends between two requests (the loop held past the server's
  // 5 s keep-alive on CI, ECONNRESET).
  const seeded = appendMany(chat, chat.DIRECT, who, Array.from({ length: 205 }, (_, i) => ({ text: 'push ' + i })));
  assert.equal(seeded.via, 'one write', 'fixture: the fast seed fell back to 205 appends');
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

  // Each bornAt check on its own. The arm above never reaches them: its other-project path starts the file fresh.
  const file = chat.threadFile(P, AGENT);
  const oldAside = old.continues;
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...rec, continues: oldAside }));   // the new project's file pointing at the old one's
  assert.equal(chat.readThread(P, AGENT, B2).continues, oldAside, 'premise: the link is there to be followed');
  assert.deepEqual(chat.asideChain(P, AGENT, false), [], 'the chain followed into the OLD project\'s full file');
  fs.rmSync(file);   // a lost current file: the reattach looks for this conversation's newest full file
  assert.equal(chat.appendMessage(P, AGENT, { text: 'after a loss' }, B2).recorded, true);
  assert.equal(chat.readThread(P, AGENT, B2).continues, null, 'a lost file of the new project reattached to the OLD project\'s full file');
});

test('#5841 a carried count larger than the file is not believed', () => {
  const who = 'carrybot';
  assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'one' }).recorded, true);
  const file = chat.threadFile(chat.DIRECT, who);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...rec, continues: path.basename(file) + '.1.1.1791000000000.full', carried: 5000 }));
  assert.equal(chat.readThread(chat.DIRECT, who).carried, 0, 'a carried count past the rows the file holds was believed');
  fs.writeFileSync(file, JSON.stringify({ ...rec, continues: path.basename(file) + '.1.1.1791000000000.full', carried: 1 }));
  assert.equal(chat.readThread(chat.DIRECT, who).carried, 1, 'CONTROL: a carried count within the file is read');
});

test('#5841 a project thread that rolled over counts its earlier file', async () => {
  const folder = path.join(SANDBOX, 'proj-folder');
  fs.mkdirSync(folder, { recursive: true });
  const made = await post('/api/projects', { name: 'Rollover', folder });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const project = made.json.project;
  assert.equal((await post(`/api/project/${project.id}/agent/${AGENT}`)).status, 200);
  for (let i = 0; i <= CAP; i += 1) assert.equal(chat.appendMessage(project.id, AGENT, { text: 'p' + i }, project.createdAt).recorded, true);
  assert.ok(chat.readThread(project.id, AGENT, project.createdAt).continues, 'premise: the project thread rolled over');
  const t = await get(`/api/project/${project.id}/thread/${AGENT}`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  // 1000 in the full file, then a current file of 200 carried + 1: the first row shown (p801) is at position 801.
  assert.equal(t.json.olderCount, 801, 'the project route did not count the earlier file (the current file alone says 1)');
  assert.equal(t.json.messages[0].text, 'p801', 'premise: the first row shown');
  // The full file gone: nothing earlier is counted, so the carried rows are not subtracted (201 rows, 200 shown).
  const pdir = path.dirname(chat.threadFile(project.id, AGENT));
  const pbase = path.basename(chat.threadFile(project.id, AGENT));
  for (const n of fs.readdirSync(pdir).filter((f) => f.startsWith(pbase + '.') && f.endsWith('.full'))) fs.rmSync(path.join(pdir, n));
  const gone = await get(`/api/project/${project.id}/thread/${AGENT}`);
  assert.equal(gone.json.olderCount, 1, 'the project route subtracted carried rows although no earlier file was counted');
});

test('#5841 a reply to a message that lives only in an earlier file is found, not refused as gone', async () => {
  const dir = path.dirname(chat.threadFile(chat.DIRECT, AGENT));
  const cur = chat.readThread(chat.DIRECT, AGENT);
  const inFile = new Set(cur.messages.map((m) => m.at));
  let at = null;
  for (const n of asides(AGENT)) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    const m = rec.messages.find((x) => x.text === 'message 5');
    if (m) { at = m.at; break; }
  }
  assert.ok(at, 'premise: message 5 is in a full file');
  assert.equal(inFile.has(at), false, 'premise: message 5 is not in the current file');
  const r = await post(`/api/agent/${AGENT}/thread`, { text: 'about that one', reply_to: at });
  assert.ok([200, 202].includes(r.status), 'a reply to an earlier-file message was not taken: ' + r.status + ' ' + JSON.stringify(r.json));
  const gone = await post(`/api/agent/${AGENT}/thread`, { text: 'about nothing', reply_to: '2020-01-01T00:00:00.000Z' });
  assert.equal(gone.status, 409, 'CONTROL: a message in no file is refused as gone: ' + JSON.stringify(gone.json));
});

test('#5841 when the chain stops early (an earlier file unreadable), the count and the pages still agree on every position', async () => {
  const dir = path.dirname(chat.threadFile(chat.DIRECT, AGENT));
  const oldest = asides(AGENT).map((n) => ({ n, at: fs.statSync(path.join(dir, n)).mtimeMs })).sort((x, y) => x.at - y.at)[0].n;
  const keep = fs.readFileSync(path.join(dir, oldest), 'utf8');
  fs.writeFileSync(path.join(dir, oldest), '{ not json');   // the walk now stops at the file after it
  try {
    const t = await get(`/api/agent/${AGENT}/thread`);
    let b = t.json.olderCount; let got = 0; const seen = [];
    while (b > 0) { const pg = await get(`/api/agent/${AGENT}/thread/older?before=${b}`); assert.equal(pg.json.olderCount + pg.json.messages.length, b, 'a page is not the range asked for: the routes disagree'); got += pg.json.messages.length; seen.unshift(...texts(pg.json)); b = pg.json.olderCount; }
    assert.equal(got, t.json.olderCount, 'paging to the start did not reach exactly olderCount rows');
    /* The two checks above hold for ANY chain, so they cannot see a carried overlap served twice. These can: every row
       once, numbered rows in order, and the last earlier row right before the first row the thread shows. */
    const whole = [...seen, ...texts(t.json)];
    assert.equal(new Set(whole).size, whole.length, 'a row was served twice across the pages and the tail');
    const nums = whole.filter((x) => /^message \d+$/.test(x)).map((x) => Number(x.split(' ')[1]));
    assert.ok(nums.every((n, i) => i === 0 || n === nums[i - 1] + 1), 'the numbered rows are not one unbroken run in order');
    // Both ends, from the file the walk could read: the first earlier row is its first OWN row (its carried copies of the
    // unreadable file are dropped, as the count drops them), and the last is the row right before the tail's first.
    const cur = chat.readThread(chat.DIRECT, AGENT);
    const prev = JSON.parse(fs.readFileSync(path.join(dir, cur.continues), 'utf8'));
    assert.equal(seen[0], prev.messages[prev.carried || 0].text, 'the first earlier row is not the readable file\'s first own row');
    const lastBefore = cur.messages.length > 200 ? cur.messages[cur.messages.length - 201].text : prev.messages[prev.messages.length - (cur.carried || 0) - 1].text;
    assert.equal(seen[seen.length - 1], lastBefore, 'the last earlier row is not the one right before the tail');
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
  assert.deepEqual(asides(who), [], 'a failed rollover left a set-aside copy behind');
});

test('#5841 if the full file cannot be set aside, the send is refused as before, saying why', () => {
  const was = fs.renameSync;
  const wasLink = fs.linkSync;
  fill(OTHER, CAP - chat.readThread(chat.DIRECT, OTHER).messages.length, 100);
  fs.renameSync = () => { throw new Error('EACCES'); };
  fs.linkSync = () => { throw new Error('EACCES'); };
  let r;
  try { r = chat.appendMessage(chat.DIRECT, OTHER, { text: 'one too many' }); } finally { fs.renameSync = was; fs.linkSync = wasLink; }
  assert.equal(r.recorded, false, 'a send was recorded although the full file could not be moved');
  assert.match(r.because, /could not move the full file aside/, r.because);
  assert.equal(chat.readThread(chat.DIRECT, OTHER).messages.length, CAP, 'the full file was changed');
});

test('#5841 the thread file is never missing during a rollover, and a filesystem that cannot link falls back to the rename', () => {
  const store = require('./engine/store');
  const real = store.saveFlushed;
  for (const [who, linkWorks] of [['linkbot', true], ['nolinkbot', false]]) {
    for (let i = 0; i < CAP; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'k' + i }).recorded, true);
    const file = chat.threadFile(chat.DIRECT, who);
    let presentAtWrite = null;
    const wasLink = fs.linkSync;
    if (!linkWorks) fs.linkSync = () => { throw new Error('EPERM'); };
    store.saveFlushed = (f, body) => { if (f === file) presentAtWrite = fs.existsSync(file); return real(f, body); };
    let r;
    try { r = chat.appendMessage(chat.DIRECT, who, { text: 'past the cap' }); } finally { store.saveFlushed = real; fs.linkSync = wasLink; }
    assert.equal(r.recorded, true, r.because);
    const now = chat.readThread(chat.DIRECT, who);
    assert.deepEqual([asides(who).length, now.continues, now.carried, now.messages.length], [1, asides(who)[0], 200, 201], `${who}: the rollover is not whole`);
    const full = JSON.parse(fs.readFileSync(path.join(path.dirname(file), asides(who)[0]), 'utf8'));
    assert.equal(full.messages.length, CAP, `${who}: the set-aside file is not the full one`);
    // Linked: the file stayed in place while the new one was written. CONTROL (no link): the rename left a gap.
    assert.equal(presentAtWrite, linkWorks, `${who}: the thread file was ${presentAtWrite ? 'present' : 'missing'} during the write`);
  }
});

test('#5841 when the newest full file is gone, the count stops at the current file, carried rows included', async () => {
  for (let i = 0; i < CAP + 300; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, BROKEN, { text: 'b' + i }).recorded, true);
  const cur = chat.readThread(chat.DIRECT, BROKEN);
  assert.deepEqual([cur.carried, cur.messages.length], [200, 500], 'premise: 200 carried, 300 its own');
  for (const n of asides(BROKEN)) fs.rmSync(path.join(path.dirname(chat.threadFile(chat.DIRECT, BROKEN)), n));
  const t = await get(`/api/agent/${BROKEN}/thread`);
  // Nothing earlier can be read, so every row of the current file counts, the carried ones too: 500 - 200 shown.
  assert.equal(t.json.olderCount, 300, 'the carried rows were subtracted although no earlier file was counted');
  const seen = [];
  for (let b = t.json.olderCount; b > 0;) { const pg = await get(`/api/agent/${BROKEN}/thread/older?before=${b}`); seen.unshift(...texts(pg.json)); b = pg.json.olderCount; }
  assert.deepEqual([seen.length, seen[0], seen[seen.length - 1]], [300, 'b800', 'b1099'], 'paging did not reach the current file\'s rows before the tail');
});

test('#5841 with no link, a failed write puts the renamed full file back; a name taken since the check is refused, never overwritten', () => {
  const store = require('./engine/store');
  const realSave = store.saveFlushed;
  const realLink = fs.linkSync;
  const who = 'nolinkfail';
  for (let i = 0; i < CAP; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'n' + i }).recorded, true);
  let r;
  fs.linkSync = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
  store.saveFlushed = () => { throw new Error('ENOSPC'); };
  try { r = chat.appendMessage(chat.DIRECT, who, { text: 'one too many' }); } finally { store.saveFlushed = realSave; fs.linkSync = realLink; }
  assert.equal(r.recorded, false, 'premise: the write failed');
  const back = chat.readThread(chat.DIRECT, who);
  assert.deepEqual([back.messages.length, back.continues, asides(who)], [CAP, null, []], 'the renamed full file was not put back');
  // EEXIST: another file took the name between the check and the link. Falling back to the rename would overwrite it.
  const realRename = fs.renameSync;
  let renamed = false;
  fs.linkSync = () => { throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); };
  fs.renameSync = (...a) => { renamed = true; return realRename(...a); };
  try { r = chat.appendMessage(chat.DIRECT, who, { text: 'one too many' }); } finally { fs.linkSync = realLink; fs.renameSync = realRename; }
  assert.equal(r.recorded, false, 'a send was recorded over a taken aside name');
  assert.equal(renamed, false, 'it fell back to a rename that would overwrite the file holding that name');
  assert.equal(chat.readThread(chat.DIRECT, who).messages.length, CAP, 'the full file was changed');
});

test('#5841 a save that fails AFTER replacing the file never takes the full file\'s only name with it', () => {
  const store = require('./engine/store');
  const real = store.saveFlushed;
  const who = 'latefail';
  for (let i = 0; i < CAP; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'l' + i }).recorded, true);
  const file = chat.threadFile(chat.DIRECT, who);
  store.saveFlushed = (f, body) => { const out = real(f, body); if (f === file) throw new Error('a check after the write'); return out; };
  let r;
  try { r = chat.appendMessage(chat.DIRECT, who, { text: 'past the cap' }); } finally { store.saveFlushed = real; }
  assert.equal(r.recorded, false, 'premise: the save reported a failure');
  assert.equal(chat.readThread(chat.DIRECT, who).messages.length, 201, 'premise: the new file was already in place');
  const kept = asides(who);
  assert.equal(kept.length, 1, 'the set-aside name was removed although it had become the full file\'s only name');
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(file), kept[0]), 'utf8')).messages.length, CAP, 'the full file is not whole');
});

test('#5841 the reattach picks the newest full file by the time in its name, not by its modification time', () => {
  const file = chat.threadFile(chat.DIRECT, AGENT);
  const dir = path.dirname(file);
  const stamp = (n) => Number((n.match(/\.(\d{13})(?:\.\d+)?\.full$/) || [])[1]);
  const byName = asides(AGENT).sort((a, b) => stamp(a) - stamp(b));
  assert.ok(byName.length >= 2 && byName.every((n) => stamp(n) > 0), 'premise: two or more stamped full files');
  const future = new Date(Date.now() + 3600 * 1000);
  fs.utimesSync(path.join(dir, byName[0]), future, future);   // the OLDEST now looks newest to an mtime sort
  fs.rmSync(file);
  assert.equal(chat.appendMessage(chat.DIRECT, AGENT, { text: 'after a loss, again' }).recorded, true);
  assert.equal(chat.readThread(chat.DIRECT, AGENT).continues, byName[byName.length - 1], 'the reattach followed the modification time');
});

test('#5841 an earlier file the page cannot read just now refuses the page, rather than serving shifted positions', async () => {
  const t = await get(`/api/agent/${AGENT}/thread`);   // the thread route's count of the chain, cached
  assert.ok(t.json.olderCount > 400, 'premise: a chain to page across');
  const before = t.json.olderCount;
  const ok = await get(`/api/agent/${AGENT}/thread/older?before=${before}`);
  assert.equal(ok.status, 200, 'CONTROL: the page reads when every file does');
  const victim = chat.readThread(chat.DIRECT, AGENT).continues;
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { if (String(p).endsWith(victim)) throw Object.assign(new Error('EMFILE'), { code: 'EMFILE' }); return realRead.call(this, p, ...rest); };
  let r;
  try { r = await get(`/api/agent/${AGENT}/thread/older?before=${before}`); } finally { fs.readFileSync = realRead; }
  assert.equal(r.status, 503, 'a page was served although an earlier file could not be read: ' + JSON.stringify(r.json));
  assert.match(r.json.error, /could not read all of the earlier messages/);
});

test('#5841 harness: every request opened its own connection, so none reused a socket after a long gap', () => {
  assert.ok(REQUESTS > 20, 'premise: the arms above made requests (' + REQUESTS + ')');
  assert.equal(CONNECTIONS, REQUESTS, 'a request reused a pooled connection, which is what came back ECONNRESET on CI');
});

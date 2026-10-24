'use strict';
/**
 * kosmos#7032 (the iPhone's room, slice 9 of #6838): GET /api/project/:id/room pages its JSON arm. ?n=N returns the
 * room's last N rows, `olderCount` and a server-made `olderCursor`; ?n=N&cursor=<olderCursor> the page before it.
 * CONTROL: without ?n the JSON arm is exactly what it was (every row, no olderCount), which is what the board reads.
 * Real rows through the real route.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roompaged-7032-'));
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
const projects = require('./engine/projects');
const messages = require('./engine/messages');

let base;
let pid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  pid = projects.create({ name: 'Paged Room' }).id;
  for (let i = 1; i <= 7; i++) {   // seven rows, each a later millisecond: room times are the cursor
    if (i === 4) messages.externalPost(pid, { from: 'Mallory', fromKind: 'person', text: 'row ' + i });
    else messages.roomNote(pid, 'row ' + i);
    await sleep(3);
  }
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const room = async (q = '') => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room${q}`);
  return { status: res.status, json: await res.json() };
};
const texts = (j) => j.rows.map((r) => r.text);

test('#7032 CONTROL: without ?n the room is every row and carries no olderCount (the board\'s read is unchanged)', async () => {
  const r = await room();
  assert.equal(r.status, 200);
  assert.deepEqual(texts(r.json), ['row 1', 'row 2', 'row 3', 'row 4', 'row 5', 'row 6', 'row 7']);
  assert.equal('olderCount' in r.json, false);
});

test('#7032 ?n=N is the last N rows, oldest first, with how many older rows are left and the cursor to them', async () => {
  const r = await room('?n=3');
  assert.equal(r.status, 200);
  assert.deepEqual(texts(r.json), ['row 5', 'row 6', 'row 7']);
  assert.equal(r.json.olderCount, 4);
  assert.match(r.json.olderCursor, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|\d+$/);
  assert.ok(r.json.unanswered && typeof r.json.unanswered === 'object', 'unanswered still rides along');
});

test('#7032 the server-made cursor walks back a page at a time to the start, each row once, Kosmos lines and an outside row too', async () => {
  const seen = [];
  let r = await room('?n=3');
  seen.unshift(...texts(r.json));
  while (r.json.olderCursor) {
    r = await room('?n=3&cursor=' + encodeURIComponent(r.json.olderCursor));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    seen.unshift(...texts(r.json));
  }
  assert.deepEqual(seen, ['row 1', 'row 2', 'row 3', 'row 4', 'row 5', 'row 6', 'row 7'], 'a row was skipped or served twice');
  assert.equal(r.json.olderCount, 0);
  assert.equal(r.json.olderCursor, null, 'the start of the room has no cursor');
});

test('#7032 a post arriving between two reads does not shift the older page (its edge is a row, not a count)', async () => {
  const first = await room('?n=3');
  messages.roomNote(pid, 'row 8');
  await sleep(3);
  const second = await room('?n=3&cursor=' + encodeURIComponent(first.json.olderCursor));
  assert.deepEqual(texts(second.json), ['row 2', 'row 3', 'row 4']);
  assert.deepEqual(texts((await room('?n=2')).json), ['row 7', 'row 8'], 'the newest page sees it');
});

test('#7032 CONTROL: a bad n is ignored as the text arm ignores it (the whole room); a cursor without n does nothing', async () => {
  for (const q of ['?n=0', '?n=201', '?n=abc', '?cursor=2026-01-01T00:00:00.000Z|0']) {
    const r = await room(q);
    assert.equal(r.status, 200, q);
    assert.equal('olderCount' in r.json, false, q + ': paged on a bad request');
  }
});

test('#7032 review 2: a cursor that names no row of this room is refused, never an empty page that reads as the start', async () => {
  const real = (await room('?n=2')).json.olderCursor;
  const [at] = real.split('|');
  for (const c of ['2026-01-01T00:00:00.000Z|0', at + '|999', at.replace(/\.\d{3}Z$/, 'Z') + '|0', 'x 2026|0', 'not-a-cursor', at, at + '|-1', '|0']) {
    const r = await room('?n=2&cursor=' + encodeURIComponent(c));
    assert.equal(r.status, 400, c + ' -> ' + JSON.stringify(r.json));
    assert.match(r.json.error, /not one this room has/, c);
  }
});

test('#7032 reviews 1 and 2: a page that starts with a Kosmos line, and two posts at the same moment across an edge, are each served once', async () => {
  const tie = new Date().toISOString();
  const plant = (id, text) => fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', id, project: pid, from: 'dana', to: [], outcomes: {}, text, at: tie }) + '\n');
  plant('m7101', 'tie A');
  plant('m7102', 'tie B');
  await sleep(3);
  messages.roomNote(pid, 'note after the tie');
  await sleep(3);
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', id: 'm7103', project: pid, from: 'dana', to: [], outcomes: {}, text: 'last', at: new Date().toISOString() }) + '\n');
  const newest = await room('?n=2');
  assert.deepEqual(texts(newest.json), ['note after the tie', 'last'], 'premise: this page starts with a Kosmos line');
  const middle = await room('?n=2&cursor=' + encodeURIComponent(newest.json.olderCursor));
  assert.deepEqual(texts(middle.json), ['tie A', 'tie B'], 'the note came back, or a tied post was lost');
  const page3 = await room('?n=3');
  assert.deepEqual(texts(page3.json), ['tie B', 'note after the tie', 'last'], 'premise: an edge between the two tied posts');
  assert.deepEqual(texts((await room('?n=1&cursor=' + encodeURIComponent(page3.json.olderCursor))).json), ['tie A'], 'the tied post across the edge was lost');
});

test('#7032 review 2: the phone\'s contract is written down where the iPhone code is documented', () => {
  const doc = fs.readFileSync(path.join(__dirname, 'ios', 'README.md'), 'utf8');
  assert.match(doc, /## A project's room, a page at a time \(kosmos#7032\)/);
  for (const word of ['olderCount', 'olderCursor', '?n=N&cursor=<olderCursor>', 'is a 400', 're-read the newest']) {
    assert.ok(doc.includes(word), 'ios/README.md no longer says: ' + word);
  }
});

test('#7032 review 3: three posts at one moment with the page edge after the first, and an older row stored without milliseconds, page exactly', async () => {
  const tie = new Date(Date.now() + 1000).toISOString();
  const plant = (row) => fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', project: pid, from: 'dana', to: [], outcomes: {}, ...row }) + '\n');
  plant({ id: 'm7201', text: 'three A', at: tie });
  plant({ id: 'm7202', text: 'three B', at: tie });
  plant({ id: 'm7203', text: 'three C', at: tie });
  const newest = await room('?n=2');
  assert.deepEqual(texts(newest.json), ['three B', 'three C'], 'premise: the edge falls inside the tie');
  assert.deepEqual(texts((await room('?n=1&cursor=' + encodeURIComponent(newest.json.olderCursor))).json), ['three A']);
  // An older row's time with no milliseconds (record() takes any time that parses): its cursor must work.
  const other = projects.create({ name: 'Old Times Room' }).id;
  const put = (row) => fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', project: other, from: 'dana', to: [], outcomes: {}, ...row }) + '\n');
  put({ id: 'm7301', text: 'old', at: '2026-01-01T00:00:00.000Z' });
  put({ id: 'm7302', text: 'bare', at: '2026-01-02T00:00:00Z' });
  put({ id: 'm7303', text: 'new', at: '2026-01-03T00:00:00.000Z' });
  const r1 = await (await fetch(`${base}/api/project/${other}/room?n=2`)).json();
  assert.equal(r1.olderCursor, '2026-01-02T00:00:00Z|0', 'premise: the cursor names the bare time as stored');
  const r2 = await fetch(`${base}/api/project/${other}/room?n=2&cursor=` + encodeURIComponent(r1.olderCursor));
  assert.equal(r2.status, 200, 'the computer refused its own cursor');
  assert.deepEqual((await r2.json()).rows.map((r) => r.text), ['old']);
});

test('#7032 review 3: a room whose log could not be read is a 503 when paged, never an empty page or a bad cursor', async () => {
  const real = messages.record;
  const cursor = (await room('?n=2')).json.olderCursor;
  messages.record = () => ({ ok: false, rows: [] });
  try {
    for (const q of ['?n=2', '?n=2&cursor=' + encodeURIComponent(cursor)]) {
      const r = await room(q);
      assert.equal(r.status, 503, q + ' -> ' + JSON.stringify(r.json));
      assert.match(r.json.error, /could not read this room/, q);
    }
    const whole = await room();
    assert.equal(whole.status, 200, 'CONTROL: the unpaged read keeps its own behaviour (ok:false, the board says it could not read)');
    assert.equal(whole.json.ok, false);
  } finally { messages.record = real; }
});

test('#7032 review 4: every paged row carries its exact place, the cursor is the first row\'s, and an empty cursor is the newest page', async () => {
  const r = await room('?n=4');
  for (const row of r.json.rows) assert.match(row.key, /\|\d+$/, JSON.stringify(row));
  assert.equal(r.json.olderCursor, r.json.rows[0].key);
  assert.equal(new Set(r.json.rows.map((x) => x.key)).size, r.json.rows.length, 'two rows share a key');
  const empty = await room('?n=4&cursor=');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.rows.map((x) => x.key), r.json.rows.map((x) => x.key));
  assert.equal('key' in ((await room()).json.rows[0] || {}), false, 'CONTROL: the board\'s unpaged rows are unchanged (no key)');
});

test('#7032 review 4: a post dated inside the newest page but written after it was read is in the newest page when re-read', async () => {
  const own = projects.create({ name: 'Late Post Room' }).id;
  const put = (row) => fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', project: own, from: 'dana', to: [], outcomes: {}, ...row }) + '\n');
  put({ id: 'm7411', text: 'one', at: '2026-02-01T10:00:00.000Z' });
  put({ id: 'm7412', text: 'two', at: '2026-02-01T10:00:02.000Z' });
  put({ id: 'm7413', text: 'three', at: '2026-02-01T10:00:04.000Z' });
  const read = async (q) => (await fetch(`${base}/api/project/${own}/room${q}`)).json();
  const before = await read('?n=3');
  put({ id: 'm7401', text: 'late', at: '2026-02-01T10:00:03.000Z' });   // dated between two rows already read, written after
  const again = await read('?n=4');
  assert.ok(again.rows.some((x) => x.text === 'late'), 'the late-written post is not in the re-read newest page');
  assert.deepEqual(again.rows.map((x) => x.text), ['one', 'two', 'late', 'three'], 'not in its time place');
  assert.deepEqual(before.rows.map((x) => x.text), ['one', 'two', 'three'], 'premise: the first read did not have it');
});

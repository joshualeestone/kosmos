'use strict';
/**
 * kosmos#7032 (the iPhone's room, slice 9 of #6838): GET /api/project/:id/room pages its JSON arm. ?n=N returns the
 * room's last N rows and `olderCount`; ?before=<a row's at> the last N older than it. CONTROL: without ?n the JSON arm
 * is exactly what it was (every row, no olderCount), which is what the board reads. Real rows through the real route.
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

test('#7032 a post arriving between two reads does not shift the older page', async () => {
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
  for (const c of ['2026-01-01T00:00:00.000Z|0', at + '|999', at.replace(/\.\d{3}Z$/, 'Z') + '|0', 'x 2026|0', 'not-a-cursor', at]) {
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

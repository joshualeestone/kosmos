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

test('#7032 ?n=N is the last N rows, oldest first, with how many older rows are left', async () => {
  const r = await room('?n=3');
  assert.equal(r.status, 200);
  assert.deepEqual(texts(r.json), ['row 5', 'row 6', 'row 7']);
  assert.equal(r.json.olderCount, 4);
  assert.ok(r.json.unanswered && typeof r.json.unanswered === 'object', 'unanswered still rides along');
});

test('#7032 ?before= walks back a page at a time to the start, with an outside row kept in its place', async () => {
  const first = await room('?n=3');
  const second = await room('?n=3&before=' + encodeURIComponent(first.json.rows[0].at));
  assert.deepEqual(texts(second.json), ['row 2', 'row 3', 'row 4']);
  assert.equal(second.json.rows[2].kind, 'external', 'the outside row is a row like any other on a page');
  assert.equal(second.json.olderCount, 1);
  const third = await room('?n=3&before=' + encodeURIComponent(second.json.rows[0].at));
  assert.deepEqual(texts(third.json), ['row 1']);
  assert.equal(third.json.olderCount, 0);
});

test('#7032 a post arriving between two reads does not shift the older page (the cursor is a time)', async () => {
  const first = await room('?n=3');
  messages.roomNote(pid, 'row 8');
  await sleep(3);
  const second = await room('?n=3&before=' + encodeURIComponent(first.json.rows[0].at));
  assert.deepEqual(texts(second.json), ['row 2', 'row 3', 'row 4']);
  assert.deepEqual(texts((await room('?n=2')).json), ['row 7', 'row 8'], 'the newest page sees it');
});

test('#7032 CONTROL: a bad n or before is ignored as the text arm ignores a bad n (the whole room; before alone does nothing)', async () => {
  for (const q of ['?n=0', '?n=201', '?n=abc', '?before=2026-01-01T00:00:00.000Z']) {
    const r = await room(q);
    assert.equal(r.status, 200, q);
    assert.equal('olderCount' in r.json, false, q + ': paged on a bad request');
  }
  const r = await room('?n=2&before=not-a-time');
  assert.equal(r.status, 200);
  assert.deepEqual(texts(r.json).length, 2, 'an unreadable before is dropped, the newest page served');
});

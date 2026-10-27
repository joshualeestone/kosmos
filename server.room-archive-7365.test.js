'use strict';
/**
 * kosmos#7365 slice 3: the room archive, server half. Real rows through the real route.
 *
 * - The rule: a row is archived when it is older than 30 days AND outside the newest 1,000, or older than the person's
 *   own marker; the archive is always the oldest stretch of the room.
 * - `kosmos room` (?as=text) reads the live part only.
 * - A paged read with ?archive=0 pages the live part and ?archive=1 the archive, with the same cursors; without the
 *   flag a page is drawn from the whole room, so a board page or an iPhone build from before the archive still reaches
 *   every message.
 * - The whole-room read (what search uses) marks each archived row, and says how many there are.
 * - POST .../room/archive sets the marker and POST .../room/archive/undo clears it; both are operator writes.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roomarchive-7365-'));
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
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const store = require('./engine/store');
const roomarchive = require('./engine/roomarchive');

const DAY = 24 * 60 * 60 * 1000;
const TOK = 'BOARDTOKEN_test_0123456789abcdef';
let base;
const room = {};   // name -> project id
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const datedBack = (id) => { projects.writeAll(projects.readAll().map((q) => (q.id === id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q))); return id; };
  for (const name of ['big', 'young', 'mixed', 'small', 'routes']) room[name] = datedBack(projects.create({ name: 'Archive ' + name }).id);
  const lines = [];
  const post = (pid, id, atMs) => lines.push({ kind: 'post', id, project: pid, from: 'alpha', to: [], text: 'post ' + id, at: new Date(atMs).toISOString(), outcomes: {} });
  // big: 1,050 posts, all far older than 30 days, one second apart: the oldest 50 are archived by the automatic rule.
  const old = Date.parse('2024-01-01T00:00:00.000Z');
  for (let i = 0; i < 1050; i++) post(room.big, 'b' + i, old + i * 1000);
  // young: 1,050 posts from the last day: past 1,000 but not older than 30 days, so nothing is archived.
  const now = Date.now();
  for (let i = 0; i < 1050; i++) post(room.young, 'y' + i, now - DAY + i * 1000);
  // mixed: 1,030 posts, the first 20 older than 30 days and the rest from yesterday: only those 20 are archived (age
  // stops the run before the count does).
  for (let i = 0; i < 20; i++) post(room.mixed, 'm' + i, old + i * 1000);
  for (let i = 20; i < 1030; i++) post(room.mixed, 'm' + i, now - DAY + i * 1000);
  // small: 30 posts, a day apart from 40 days ago; the person's marker archives the first 20.
  for (let i = 0; i < 30; i++) post(room.small, 's' + i, now - 40 * DAY + i * DAY);
  fs.appendFileSync(path.join(store.ROOT, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  // The marker: older than the 21st post (s20), so s0..s19 are archived. Written through the engine.
  const s20 = new Date(now - 40 * DAY + 20 * DAY).toISOString();
  assert.equal(roomarchive.setMarker(room.small, s20).ok, true);
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

async function get(pid, query = '') {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room${query}`);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { code: res.status, text, json };
}
async function post(pid, suffix, body, { token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-kosmos-board-token'] = token;
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room/archive${suffix}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* {} */ }
  return { code: res.status, json, text };
}
// Walks every page of a paged read, newest first, and returns the ids oldest first.
async function walk(pid, flag) {
  const ids = [];
  let cursor = null;
  for (let guard = 0; guard < 400; guard++) {
    const r = await get(pid, '?n=200' + flag + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    assert.equal(r.code, 200, r.text);
    ids.unshift(...r.json.rows.map((x) => x.id));
    if (!r.json.olderCount) return { ids, last: r.json };
    cursor = r.json.olderCursor;
  }
  throw new Error('the walk never reached the start');
}
const range = (p, a, b) => Array.from({ length: b - a }, (_, i) => p + (a + i));

test('#7365: the whole-room read marks the oldest stretch archived, by age AND count', async () => {
  const big = await get(room.big);
  assert.equal(big.json.archivedCount, 50, 'past 1,000 and older than 30 days: the oldest 50');
  assert.deepEqual(big.json.rows.filter((r) => r.archived === true).map((r) => r.id), range('b', 0, 50));
  assert.equal(big.json.rows.length, 1050, 'the whole-room read still returns every row, for search');
  const young = await get(room.young);
  assert.equal(young.json.archivedCount, 0, 'past 1,000 but none older than 30 days: nothing archived');
  assert.equal(young.json.rows.some((r) => r.archived), false);
  const mixed = await get(room.mixed);
  assert.equal(mixed.json.archivedCount, 20, 'only the rows older than 30 days, though 30 are past 1,000');
  const small = await get(room.small);
  assert.equal(small.json.archivedCount, 20, 'under 1,000 rows, so only the person\'s marker archives');
  assert.deepEqual(small.json.rows.filter((r) => r.archived === true).map((r) => r.id), range('s', 0, 20));
  assert.equal(typeof small.json.archiveMarker.before, 'string');
});

test('#7365: kosmos room (the text view) reads the live part only', async () => {
  const small = await get(room.small, '?as=text&n=200');
  assert.equal(small.code, 200);
  for (const id of range('s', 20, 30)) assert.ok(small.text.includes('[' + id + ']'), id + ' is live and missing');
  for (const id of range('s', 0, 20)) assert.ok(!small.text.includes('[' + id + ']'), id + ' is archived and was shown to agents');
  // CONTROL, the young room: no archive, so the view is the last 200 rows as before.
  const young = await get(room.young, '?as=text&n=200');
  assert.ok(young.text.includes('[y850]') && !young.text.includes('[y849]'), 'the last 200 rows of an unarchived room');
});

test('#7365: ?archive=0 pages exactly the live part and ?archive=1 exactly the archive', async () => {
  const live = await walk(room.big, '&archive=0');
  assert.deepEqual(live.ids, range('b', 50, 1050));
  assert.equal(live.last.archivedCount, 50, 'the last live page says how many are archived (where the boundary row goes)');
  const arch = await walk(room.big, '&archive=1');
  assert.deepEqual(arch.ids, range('b', 0, 50));
  // The small room: one page each side of the boundary.
  assert.deepEqual((await walk(room.small, '&archive=0')).ids, range('s', 20, 30));
  assert.deepEqual((await walk(room.small, '&archive=1')).ids, range('s', 0, 20));
  // A cursor from the live side, used on the archive, starts at the boundary rather than skipping or repeating rows.
  const firstLive = await get(room.small, '?n=5&archive=0');
  const crossing = await get(room.small, '?n=5&archive=1&cursor=' + encodeURIComponent(firstLive.json.olderCursor));
  assert.deepEqual(crossing.json.rows.map((r) => r.id), range('s', 15, 20));
});

test('#7365: without ?archive a page reaches the whole room, as an older board page or iPhone build expects', async () => {
  const all = await walk(room.big, '');
  assert.deepEqual(all.ids, range('b', 0, 1050));
  assert.deepEqual((await walk(room.small, '')).ids, range('s', 0, 30));
});

test('#7365: the archive route sets the marker, refuses a bad or future time, and Undo clears it', async () => {
  const pid = room.routes;
  const bad = await post(pid, '', { before: 'not a time' });
  assert.equal(bad.code, 400, bad.text);
  const future = await post(pid, '', { before: new Date(Date.now() + DAY).toISOString() });
  assert.equal(future.code, 400, future.text);
  assert.equal(roomarchive.markerFor(pid), null, 'a refused archive wrote a marker');
  const missing = await post('no-such-project-7365', '', { before: new Date().toISOString() });
  assert.equal(missing.code, 404, missing.text);
  const when = new Date(Date.now() - DAY).toISOString();
  const ok = await post(pid, '', { before: when });
  assert.equal(ok.code, 200, ok.text);
  assert.equal(ok.json.marker.before, when);
  assert.equal(roomarchive.markerFor(pid).before, when);
  const undo = await post(pid, '/undo');
  assert.equal(undo.code, 200, undo.text);
  assert.equal(undo.json.cleared, true);
  assert.equal(roomarchive.markerFor(pid), null, 'Undo left the marker');
  // Loose strings Date.parse would read as a date are refused: only an ISO time is a time here.
  for (const before of ['1', 'March 7', '2024-01-01', '2024-01-01T10:00']) assert.equal((await post(pid, '', { before })).code, 400, before);
  // A page clock a few seconds fast is read as now, never stored as a time in the future.
  const fast = await post(pid, '', { before: new Date(Date.now() + 20 * 1000).toISOString() });
  assert.equal(fast.code, 200, fast.text);
  assert.ok(Date.parse(fast.json.marker.before) <= Date.now(), fast.json.marker.before);
  assert.equal((await post(pid, '/undo')).code, 200);
});

test('#7365: a marker file that cannot be read is never replaced by a write', async () => {
  const file = roomarchive.fileFor();
  const kept = fs.existsSync(file) ? fs.readFileSync(file) : null;
  fs.writeFileSync(file, '{"' + room.small + '": {"before": "2024');   // cut off mid-write by something else
  try {
    const r = await post(room.routes, '', { before: new Date(Date.now() - DAY).toISOString() });
    assert.equal(r.code, 503, r.text);
    assert.equal((await post(room.routes, '/undo')).code, 503);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"' + room.small + '": {"before": "2024', 'a refused write changed the file');
    // The read side still works and keeps more live: the small room's marker is unreadable, so nothing is archived there.
    assert.equal((await get(room.small)).json.archivedCount, 0);
  } finally {
    if (kept === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, kept);
  }
  // CONTROL: with the file whole again, the same write lands.
  assert.equal((await post(room.routes, '', { before: new Date(Date.now() - DAY).toISOString() })).code, 200);
  assert.equal((await post(room.routes, '/undo')).code, 200);
  assert.equal((await get(room.small)).json.archivedCount, 20);
});

test('#7365: Undo clears the person\'s marker only; what the automatic rule archives stays archived', async () => {
  // The big room: the automatic rule archives b0..b49; a marker past b99 archives b0..b99.
  const ok = await post(room.big, '', { before: new Date(Date.parse('2024-01-01T00:00:00.000Z') + 100 * 1000).toISOString() });
  assert.equal(ok.code, 200, ok.text);
  assert.equal((await get(room.big)).json.archivedCount, 100, 'the marker archives more than the rule');
  assert.equal((await post(room.big, '/undo')).code, 200);
  assert.equal((await get(room.big)).json.archivedCount, 50, 'after Undo the read is back to what the rule archives');
});

test('#7365: a room whose every message is archived does not tell agents nothing was said', async () => {
  const pid = projects.create({ name: 'Archive all' }).id;
  projects.writeAll(projects.readAll().map((q) => (q.id === pid ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  fs.appendFileSync(path.join(store.ROOT, 'messages.jsonl'), JSON.stringify({ kind: 'post', id: 'all1', project: pid, from: 'alpha', to: [], text: 'only post', at: new Date(Date.now() - DAY).toISOString(), outcomes: {} }) + '\n');
  // CONTROL: before the archive, the post is shown.
  assert.match((await get(pid, '?as=text')).text, /\[all1\]/);
  assert.equal(roomarchive.setMarker(pid, new Date().toISOString()).ok, true);
  const r = await get(pid, '?as=text');
  assert.doesNotMatch(r.text, /Nothing has been said/, r.text);
  assert.match(r.text, /archived; nothing has been said since/, r.text);
});

test('#7365: archivedCount stops at a row with no readable time, so a row Kosmos cannot date stays live', () => {
  const rows = [{ at: '2024-01-01T00:00:00.000Z' }, { at: 'garbage' }, { at: '2024-01-02T00:00:00.000Z' }];
  assert.equal(roomarchive.archivedCount(rows, { before: '2025-01-01T00:00:00.000Z' }), 1);
  assert.equal(roomarchive.archivedCount(rows, null), 0, 'three rows are inside the newest 1,000');
});

// LAST: enforcement on, so both routes are proven to be outside every auth-exempt set.
test('AUTH: an enforcing board refuses a no-token archive and undo (403) and admits a token one', async () => {
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  try {
    const when = new Date(Date.now() - DAY).toISOString();
    assert.equal((await post(room.routes, '', { before: when })).code, 403);
    assert.equal((await post(room.routes, '/undo')).code, 403);
    assert.equal(roomarchive.markerFor(room.routes), null, 'a refused archive wrote a marker');
    const ok = await post(room.routes, '', { before: when }, { token: TOK });
    assert.equal(ok.code, 200, ok.text);
    assert.equal((await post(room.routes, '/undo', undefined, { token: TOK })).code, 200);
  } finally {
    boardAuthState.on = false;
    boardAuthState.token = null;
  }
});

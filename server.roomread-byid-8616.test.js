'use strict';
/**
 * kosmos#8616 (daily feedback 11-16: two installs asked): `kosmos room <id> --post <post-id>` reads one post and
 * `--since <post-id>` the rows after it, oldest first, up to -n, with the exact command for the rest. A read by id says
 * so in its head line (ROOM_BY_ID_HEAD), which is how the CLI tells a board that ignored ?post / ?since.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-byid-8616-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const projects = require('./engine/projects');
const sendertoken = require('./engine/sendertoken');
const roomarchive = require('./engine/roomarchive');

let base;
let roster;
const ME = 'readerseat';
const POSTER = 'posterseat';
function newRoom(name) {
  const p = projects.create({ name });
  // Backdated, as server.roomread-aged-7969 does: a room shows no row older than itself, and these rows are seconds old.
  projects.writeAll(projects.readAll().map((q) => (q.id === p.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  for (const n of [ME, POSTER]) projects.addAgent(p.id, n, roster);
  return p.id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([ME, POSTER].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
});
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
const append = (row) => { fs.mkdirSync(path.dirname(messages.LOG), { recursive: true }); fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n'); };
/* n posts in a row, oldest first; returns their ids. */
function posts(project, n) {
  const ids = [];
  for (let k = 0; k < n; k++) {
    const id = 'm' + (86160 + (++seq));
    append({ id, kind: 'post', from: POSTER, to: [ME], project, text: 'note ' + id, at: new Date(Date.now() - (n - k) * 1000).toISOString(), outcomes: {} });
    ids.push(id);
  }
  return ids;
}
const room = async (project, query) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${query || ''}`, { headers: { 'x-kosmos-agent-token': sendertoken.mint(ME).token } });
  return { status: res.status, text: await res.text() };
};
const shown = (text, id) => text.split('\n').some((l) => l.includes('[' + id + ']') && !l.startsWith('[kosmos]') && !l.startsWith('Read by id: '));

test('kosmos#8616: --post reads that one post, with the head line; a plain read has no such head (control)', async () => {
  const pid = newRoom('ById8616a');
  const ids = posts(pid, 5);
  const r = await room(pid, '&post=' + ids[1]);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.text.includes('Read by id: post ' + ids[1] + ':\n'), r.text);
  assert.ok(shown(r.text, ids[1]), 'the post is not in the answer:\n' + r.text);
  for (const other of [ids[0], ids[2], ids[4]]) assert.ok(!shown(r.text, other), 'another post came too: ' + other + '\n' + r.text);
  const plain = await room(pid, '');
  assert.ok(!plain.text.includes('Read by id: '), 'CONTROL: a plain read claims to be a read by id');
  assert.ok(ids.every((id) => shown(plain.text, id)), 'CONTROL: the plain read lacks a post');
});

test('kosmos#8616: --since reads the rows after the post, oldest first, up to n, and names the command for the rest', async () => {
  const pid = newRoom('ById8616b');
  const ids = posts(pid, 6);
  const all = await room(pid, '&since=' + ids[1]);
  assert.ok(all.text.includes('Read by id: 4 rows after ' + ids[1] + ':\n'), all.text);
  const order = ids.slice(2).map((id) => all.text.indexOf('[' + id + ']'));
  assert.ok(order.every((x, k) => x > 0 && (k === 0 || x > order[k - 1])), 'not all, or not oldest first:\n' + all.text);
  assert.ok(!shown(all.text, ids[0]) && !shown(all.text, ids[1]), 'the post itself or an older one came too:\n' + all.text);
  const page = await room(pid, '&since=' + ids[1] + '&n=2');
  assert.ok(page.text.includes('Read by id: 4 rows after ' + ids[1] + '; the oldest 2 are below, then 2 more (read them with kosmos room ' + pid + ' --since ' + ids[3] + ' -n 2):\n'), page.text);
  assert.ok(shown(page.text, ids[2]) && shown(page.text, ids[3]) && !shown(page.text, ids[4]), 'n=2 is not the OLDEST two after it:\n' + page.text);
  const last = await room(pid, '&since=' + ids[5]);
  assert.ok(last.text.includes('Read by id: nothing after ' + ids[5] + ' yet.\n'), last.text);
  // Review 1: the room-wide empty line would be false here (the room has posts).
  assert.ok(!/Nothing has been said in this room yet|is archived; nothing has been said since/.test(last.text), 'an empty --since called the room empty:\n' + last.text);
});

/* Posts dated `daysAgo` days back (oldest first), so an archive marker can cover them (a marker reaches only rows over a day old). */
function oldPosts(project, n, daysAgo) {
  const ids = [];
  for (let k = 0; k < n; k++) {
    const id = 'm' + (86160 + (++seq));
    append({ id, kind: 'post', from: POSTER, to: [ME], project, text: 'old ' + id, at: new Date(Date.now() - daysAgo * 86400000 - (n - k) * 1000).toISOString(), outcomes: {} });
    ids.push(id);
  }
  return ids;
}

test('kosmos#8616 review 1: an archived post is not read back by --post; --since past the archive says what it skipped', async () => {
  const pid = newRoom('ById8616f');
  const old = oldPosts(pid, 3, 3);
  const fresh = posts(pid, 2);
  assert.equal(roomarchive.setMarker(pid, new Date().toISOString()).ok, true);
  const r = await room(pid, '&post=' + old[1]);
  assert.equal(r.status, 404, 'an archived post was read back:\n' + r.text);
  assert.equal(r.text, 'Post ' + old[1] + ' is in this room\'s archive, which agents do not read.\n');
  // CONTROL: a live post in the same room reads.
  const live = await room(pid, '&post=' + fresh[0]);
  assert.equal(live.status, 200, live.text);
  assert.ok(shown(live.text, fresh[0]));
  const since = await room(pid, '&since=' + old[0]);
  assert.equal(since.status, 200, since.text);
  assert.ok(since.text.includes('[kosmos] 2 rows right after ' + old[0] + ' are in this room\'s archive and not shown here.\n'), since.text);
  assert.ok(shown(since.text, fresh[0]) && shown(since.text, fresh[1]) && !shown(since.text, old[1]) && !shown(since.text, old[2]), since.text);
});

test('kosmos#8616: a post id that is malformed or not in this room, both flags, or with --unanswered, is refused in words', async () => {
  const pid = newRoom('ById8616c');
  const ids = posts(pid, 2);
  const other = newRoom('ById8616d');
  const elsewhere = posts(other, 1)[0];
  const bad = await room(pid, '&post=42');
  assert.equal(bad.status, 400);
  assert.match(bad.text, /not a post id/);
  const missing = await room(pid, '&since=' + elsewhere);
  assert.equal(missing.status, 404, 'a post of another room was read here');
  assert.equal(missing.text, 'There is no post ' + elsewhere + ' in this room.\n');
  const both = await room(pid, '&post=' + ids[0] + '&since=' + ids[0]);
  assert.equal(both.status, 400);
  const mixed = await room(pid, '&post=' + ids[0] + '&unanswered=1');
  assert.equal(mixed.status, 400);
  // CONTROL: the same id, alone, reads.
  assert.equal((await room(pid, '&post=' + ids[0])).status, 200);
});

test('kosmos#8616: the JSON view ignores ?post (the board page is unchanged)', async () => {
  const pid = newRoom('ById8616e');
  const ids = posts(pid, 3);
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room?post=${ids[0]}`, { headers: { 'x-kosmos-agent-token': sendertoken.mint(ME).token } });
  assert.equal(res.status, 200);
  const j = await res.json();
  const rows = Array.isArray(j) ? j : (j.messages || j.rows || []);
  assert.ok(rows.length >= 3, 'the JSON view was filtered: ' + JSON.stringify(j).slice(0, 200));
});

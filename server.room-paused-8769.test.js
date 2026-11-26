'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8769 item 3: GET /api/project/:id/room?as=text, the view `kosmos room` prints and agents read before they post,
 * says when agents waking each other is paused in that room (roomloop.readerNote), and not when it is not.
 *
 *   node --test server.room-paused-8769.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-room-paused-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const roomloop = require('./engine/roomloop');
const messages = require('./engine/messages');
const limits = require('./engine/limits');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });


async function roomText(id) {
  const res = await fetch(base + '/api/project/' + encodeURIComponent(id) + '/room?as=text');
  return { code: res.status, text: await res.text() };
}

test('#8769 item 3: the room text view an agent reads before posting says the wake pause, and only while it lasts', async () => {
  const p = projects.create({ name: 'Paused Read' });
  roomloop.resetForTests();
  roomloop.setCapForTests(2);
  try {
    const before = await roomText(p.id);
    assert.equal(before.code, 200, before.text);
    assert.doesNotMatch(before.text, /Agents waking each other is paused/, 'CONTROL: an open room said it was paused');
    const now = Date.now();
    roomloop.noteWake(p.id, now - 2000); roomloop.noteWake(p.id, now - 1000);
    assert.equal(roomloop.paused(p.id, now), true);
    const during = await roomText(p.id);
    assert.equal(during.code, 200, during.text);
    const line = during.text.split('\n').find((l) => /Agents waking each other is paused/.test(l));
    assert.ok(line, 'a paused room did not say so in the text view: ' + during.text);
    assert.match(line, /^\[kosmos\] /);
    assert.match(line, /will wake no one/);
    // Review 1: the time is the view's own (roomClock: 24-hour HH:MM), as the held line's is.
    assert.match(line, /until about \d\d:\d\d \(/);
    assert.ok(during.text.indexOf(line) < during.text.indexOf('Nothing has been said in this room yet.'), 'the line must come above the room, which is where a reader starts');
    // Another room is not paused by this one.
    const q = projects.create({ name: 'Paused Read Other' });
    assert.doesNotMatch((await roomText(q.id)).text, /Agents waking each other is paused/);
    roomloop.clear(p.id);
    assert.doesNotMatch((await roomText(p.id)).text, /Agents waking each other is paused/, 'the line outlived a person\'s post');
  } finally {
    roomloop.resetForTests();
  }
});

/* Rows in the shape sendPost and the valve append (as server.room-held-5800.test.js does), so the room is really HELD. */
const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
function append(row) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n');
}
let seq = 9100;
function madeLongAgo(name) {
  const made = projects.create({ name });
  const back = new Date(Date.now() - 3 * 24 * 60 * MIN).toISOString();
  projects.writeAll(projects.readAll().map((q) => (q.id === made.id ? { ...q, createdAt: back } : q)));
  const folder = projects.readAll().find((q) => q.id === made.id).folder;
  for (const f of fs.readdirSync(folder)) fs.utimesSync(path.join(folder, f), new Date(back), new Date(back));
  return made;
}

test('review 5 (Kitty): a room both HELD and paused shows the hold line and a pause line with no one-member way through', async () => {
  const p = madeLongAgo('Held And Paused');
  projects.addAgent(p.id, 'ann');
  const now = Date.now();
  const n = limits.caps().roomArrivalsPerWindow;
  append({ kind: 'post', id: 'm' + (++seq), from: 'ann', project: p.id, text: 'x', at: iso(now - 12 * MIN),
    to: Array.from({ length: n }, (_, i) => 'mem' + i), outcomes: Object.fromEntries(Array.from({ length: n }, (_, i) => ['mem' + i, 'placed'])) });
  append({ kind: 'valve', from: 'ann', to: p.id, project: p.id, at: iso(now - 10 * MIN),
    because: 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.', stopped: true });
  roomloop.resetForTests();
  roomloop.setCapForTests(2);
  try {
    roomloop.noteWake(p.id, now - 2000); roomloop.noteWake(p.id, now - 1000);
    assert.equal(roomloop.paused(p.id, now), true);
    const { code, text } = await roomText(p.id);
    assert.equal(code, 200, text);
    assert.match(text, /This room is at its limit for agent posts/, 'CONTROL: the room is not held, so this tests nothing');
    const line = text.split('\n').find((l) => /Agents waking each other is paused/.test(l));
    assert.ok(line, 'no pause line: ' + text);
    assert.doesNotMatch(line, /exactly one member/, 'held and paused, the pause line still offers a way the hold refuses');
  } finally {
    roomloop.resetForTests();
  }
});

test('review 6: held for a big post but NOT for a one-member post, the pause line still offers the one-member way', async () => {
  const p = madeLongAgo('Held Big Only');
  projects.addAgent(p.id, 'ann');
  const now = Date.now();
  const n = limits.caps().roomArrivalsPerWindow;
  assert.ok(n > 2, 'the budget is too small for this fixture: ' + n);
  // One post reaching n - 1 members: the next post its size would pass the budget (held), one of size 1 would not.
  append({ kind: 'post', id: 'm' + (++seq), from: 'ann', project: p.id, text: 'x', at: iso(now - 12 * MIN),
    to: Array.from({ length: n - 1 }, (_, i) => 'mem' + i), outcomes: Object.fromEntries(Array.from({ length: n - 1 }, (_, i) => ['mem' + i, 'placed'])) });
  assert.ok(messages.roomHeld(p.id, Date.now()), 'CONTROL: the room is not held at the latest post\'s size');
  assert.equal(messages.roomHeldForOne(p.id, Date.now()), null, 'CONTROL: a one-member post would be held too, so this tests nothing');
  roomloop.resetForTests();
  roomloop.setCapForTests(2);
  try {
    roomloop.noteWake(p.id, now - 2000); roomloop.noteWake(p.id, now - 1000);
    assert.equal(roomloop.paused(p.id, now), true);
    const { text } = await roomText(p.id);
    assert.match(text, /This room is at its limit for agent posts/, 'CONTROL: the route did not read the room as held, so this tests nothing (review 7)');
    const line = text.split('\n').find((l) => /Agents waking each other is paused/.test(l));
    assert.ok(line, text);
    assert.match(line, /A post to exactly one member may still get through/, 'a one-member post the valve would pass was not offered');
  } finally {
    roomloop.resetForTests();
  }
});

'use strict';
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

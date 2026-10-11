'use strict';
/**
 * kosmos#5800 item 1: a held room explains itself to everyone in it.
 *
 * The room loop guard (the valve) holds a room that goes back and forth without landing. Before
 * this, the hold showed only as a band in the scrollback, and an agent learned of it only by being
 * refused. This file proves:
 *   - engine messages.roomHeld: held only while the latest stopping valve row is inside the window
 *     and after the person's last post or reopen; never with the limit off or a valve that did not
 *     stop; and per project;
 *   - GET /api/project/:id/room carries `held` (JSON) and one [kosmos] hold line at the top of the
 *     text view agents read, and neither when the room is open (the control);
 *   - a reopen through the real route clears both.
 *
 *   node --test server.room-held-5800.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-room-held-'));
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
const messages = require('./engine/messages');
const limits = require('./engine/limits');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
/* Rows in the shape sendPost and reopenRoom append (engine/messages.js: kind 'valve' with to = project and
   project; kind 'reopen' operator; an operator post). Appended to the real log file the engine reads. */
function append(row) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n');
}
const valve = (project, at, stopped = true) => append({ kind: 'valve', from: 'ann', to: project, project, at: iso(at),
  because: 'This conversation went back and forth for a while without landing, so Kosmos stopped it and asked everyone to bring you in.', stopped });

test('the window this file assumes is the limit module\'s, and the limit is on in a fresh sandbox', () => {
  assert.equal(limits.caps().windowMs, 60 * MIN);
  assert.equal(limits.caps().on, true, 'a fresh board must have the limit on, or every held case below reads open for that reason');
});

test('#5800 engine: held while the latest stopping valve is in the window, per project', () => {
  const now = Date.now();
  valve('heldA', now - 10 * MIN);
  const h = messages.roomHeld('heldA', now);
  assert.ok(h, 'a valve ten minutes ago did not read as held');
  assert.equal(h.at, iso(now - 10 * MIN));
  assert.equal(h.until, iso(now + 50 * MIN), 'until is the valve time plus the window');
  assert.equal(messages.roomHeld('otherRoom', now), null, 'another project\'s valve held this one');
  assert.equal(messages.roomHeld('heldA', now + 51 * MIN), null, 'past the window the room still read held');
});

test('#5800 engine: a person\'s post or a reopen after the valve ends it; one before it does not', () => {
  const now = Date.now();
  valve('heldB', now - 20 * MIN);
  append({ kind: 'reopen', from: 'you', to: 'heldB', project: 'heldB', operator: true, at: iso(now - 30 * MIN) });
  assert.ok(messages.roomHeld('heldB', now), 'a reopen BEFORE the valve cleared it');
  append({ kind: 'reopen', from: 'you', to: 'heldB', project: 'heldB', operator: true, at: iso(now - 5 * MIN) });
  assert.equal(messages.roomHeld('heldB', now), null, 'a reopen after the valve did not clear it');

  valve('heldC', now - 20 * MIN);
  append({ kind: 'post', id: 'm9001', from: 'you', to: ['ann'], project: 'heldC', operator: true, text: 'here', outcomes: { ann: 'placed' }, at: iso(now - 2 * MIN) });
  assert.equal(messages.roomHeld('heldC', now), null, 'the person posting after the valve did not clear it');
  append({ kind: 'post', id: 'm9002', from: 'ann', to: ['bob'], project: 'heldC', text: 'hi', outcomes: { bob: 'placed' }, at: iso(now - MIN) });
  assert.equal(messages.roomHeld('heldC', now), null, 'an agent post must not bring a cleared hold back');
});

test('#5800 engine: a valve that did not stop the room (limit off when it fired) is not a hold', () => {
  const now = Date.now();
  valve('heldD', now - 10 * MIN, false);
  assert.equal(messages.roomHeld('heldD', now), null);
  valve('heldD', now - 5 * MIN, true);
  assert.ok(messages.roomHeld('heldD', now), 'CONTROL: a stopping valve in the same room reads held');
});

async function room(id, asText) {
  const res = await fetch(base + '/api/project/' + encodeURIComponent(id) + '/room' + (asText ? '?as=text' : ''));
  const text = await res.text();
  return { code: res.status, text, json: asText ? null : JSON.parse(text) };
}

test('#5800 route: the JSON and the text view carry the hold, and a reopen clears both', async () => {
  const p = projects.create({ name: 'Held Route' });
  projects.addAgent(p.id, 'ann');
  const open = await room(p.id, false);
  assert.equal(open.code, 200, open.text);
  assert.equal('held' in open.json, false, 'CONTROL: an open room carries no held field');
  const openText = await room(p.id, true);
  assert.doesNotMatch(openText.text, /on hold/, 'CONTROL: an open room says nothing about a hold');

  valve(p.id, Date.now() - 3 * MIN);
  const j = await room(p.id, false);
  assert.ok(j.json.held && typeof j.json.held.until === 'string', 'the held room\'s JSON has no held: ' + j.text.slice(0, 300));
  const t = await room(p.id, true);
  const first = t.text.split('\n')[0];
  assert.match(first, /^\[kosmos\] This room is on hold: .* until your person posts here or reopens the room, or until \d\d:\d\d at the latest\. Do not send your post another way meanwhile\.$/,
    'the hold line is not the first line of the text view: ' + t.text.slice(0, 400));
  assert.doesNotMatch(first, /bring you in/, 'the agents\' line reused the sentence written to the person');

  const r = await fetch(base + '/api/project/' + encodeURIComponent(p.id) + '/room/reopen', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal('held' in (await room(p.id, false)).json, false, 'a reopen did not clear the JSON hold');
  assert.doesNotMatch((await room(p.id, true)).text, /on hold/, 'a reopen did not clear the text line');
});

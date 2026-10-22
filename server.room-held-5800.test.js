'use strict';
/**
 * kosmos#5800 item 1: a held room explains itself to everyone in it.
 *
 * The room loop guard (the valve) holds a room that goes back and forth without landing. Before
 * this, the hold showed only as a band in the scrollback, and an agent learned of it only by being
 * refused. This file proves:
 *   - engine messages.roomHeld: held while the agent posts since the person's last post or reopen
 *     leave no room for the next one (charged like the latest) beyond the budget plus the #4786
 *     allowance for work moving; open once they age out, once work moving earns the room enough,
 *     or with the limit off; per project, and kept a few seconds while the record has not grown;
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
let seq = 9000;
/* An agent post in the shape sendPost logs, reaching `n` members (each one arrival, sendPost's own sum). */
const agentPost = (project, at, n) => append({ kind: 'post', id: 'm' + (++seq), from: 'ann', project, text: 'x', at: iso(at),
  to: Array.from({ length: n }, (_, i) => 'mem' + i), outcomes: Object.fromEntries(Array.from({ length: n }, (_, i) => ['mem' + i, 'placed'])) });
const CAP = () => limits.caps().roomArrivalsPerWindow;

test('the window and budget this file assumes are the limit module\'s, and the limit is on in a fresh sandbox', () => {
  assert.equal(limits.caps().windowMs, 60 * MIN);
  assert.equal(limits.caps().on, true, 'a fresh board must have the limit on, or every held case below reads open for that reason');
  assert.ok(CAP() > 2, 'the room budget is too small for the split posts below: ' + CAP());
});

test('#5800 engine: held while the valve stopped the room and its posts still fill the budget; per project', () => {
  const now = Date.now();
  agentPost('heldA', now - 12 * MIN, CAP());
  valve('heldA', now - 10 * MIN);
  const h = messages.roomHeld('heldA', now);
  assert.ok(h, 'a full budget and a valve ten minutes ago did not read as held');
  assert.equal(h.at, iso(now - 10 * MIN), 'at is the valve row\'s, which the page matches its band on');
  assert.equal(h.until, iso(now + 48 * MIN), 'until is when the posts filling the budget age out of the window');
  assert.equal(messages.roomHeld('otherRoom', now), null, 'another project\'s hold held this one');
  assert.equal(messages.roomHeld('heldA', now + 49 * MIN), null, 'once those posts aged out the room still read held');
});

test('#5800 engine: a hold ends when the posts behind it age out, even while its valve row is still in the window', () => {
  const now = Date.now();
  agentPost('heldE', now - 55 * MIN, CAP() - 1);
  agentPost('heldE', now - 30 * MIN, 1);
  valve('heldE', now - 10 * MIN);
  const h = messages.roomHeld('heldE', now);
  assert.ok(h, 'CONTROL: held while the budget is full');
  assert.equal(h.until, iso(now + 5 * MIN), 'until is when the OLDEST posts age out enough, not the valve time plus an hour');
  assert.equal(messages.roomHeld('heldE', now + 6 * MIN), null, 'the room read held after it could take an agent post again');
});

const refusal = (project, at) => append({ kind: 'refused', from: 'bob', to: project, project, at: iso(at),
  because: 'the room was going back and forth without landing, so Kosmos was holding it for the person' });

test('#5800 engine: a room still over budget reads held after its valve row left the window', () => {
  const now = Date.now();
  valve('heldF', now - 70 * MIN);
  agentPost('heldF', now - 20 * MIN, CAP());
  const h = messages.roomHeld('heldF', now);
  assert.ok(h, 'a full room whose valve fired 70 minutes ago (no person since) read open');
  assert.equal(h.at, null, 'at names a valve row only from inside the counting window');
});

test('#5800 engine: work moving earns the room the valve\'s own allowance, so a changed file can end a hold', () => {
  const made = projects.create({ name: 'Held Moving' });
  const pid = made.id || (made.project && made.project.id);
  const longAgo = new Date(Date.now() - 3 * 24 * 60 * MIN);
  projects.writeAll(projects.readAll().map((p) => (p.id === pid ? { ...p, createdAt: longAgo.toISOString() } : p)));
  const folder = projects.readAll().find((p) => p.id === pid).folder;
  for (const f of fs.readdirSync(folder)) fs.utimesSync(path.join(folder, f), longAgo, longAgo);
  const now = Date.now();
  agentPost(pid, now - 13 * MIN, CAP() - 1);
  agentPost(pid, now - 12 * MIN, 1);   // the next post is charged one arrival, so a quarter of the cap is room enough
  valve(pid, now - 10 * MIN);
  assert.ok(messages.roomHeld(pid, now), 'CONTROL: held with no work moving');
  fs.writeFileSync(path.join(folder, 'batch-1.md'), 'a step forward');
  assert.equal(messages.roomHeld(pid, Date.now() + 5000), null, 'a changed file earned the room a quarter of the cap and it still read held');
});

test('#5800 engine: one post over the whole budget has no until (only the person can end that hold)', () => {
  const now = Date.now();
  agentPost('heldJ', now - 10 * MIN, CAP() + 2);
  valve('heldJ', now - 9 * MIN);
  const h = messages.roomHeld('heldJ', now);
  assert.ok(h, 'CONTROL: held');
  assert.equal(h.until, null, 'an until was promised that the valve would not honour');
});

test('#5800 engine: the next post is charged like the latest (one arrival per member), as the valve charges it', () => {
  const now = Date.now();
  agentPost('heldH', now - 20 * MIN, CAP() - 5);
  agentPost('heldH', now - 10 * MIN, 3);
  valve('heldH', now - 9 * MIN);
  /* CAP - 2 arrivals: a one-arrival post would fit, but this room's posts reach three members, and the valve refuses
     when arrivals + charged exceed the budget. */
  assert.ok(messages.roomHeld('heldH', now), 'a room the next three-member post cannot enter read open');
  agentPost('heldI', now - 20 * MIN, CAP() - 3);
  agentPost('heldI', now - 10 * MIN, 1);
  valve('heldI', now - 9 * MIN);
  assert.equal(messages.roomHeld('heldI', now), null, 'CONTROL: CAP - 2 arrivals with one-member posts leaves room for the next');
});

test('#5800 engine: a valve with the budget no longer full is not a hold (agent posts landing after it)', () => {
  const now = Date.now();
  valve('heldG', now - 5 * MIN);
  agentPost('heldG', now - 2 * MIN, 1);
  assert.equal(messages.roomHeld('heldG', now), null, 'a valve row alone, with one post since, read as held');
});

test('#5800 engine: a person\'s post or a reopen after the valve ends it; one before it does not', () => {
  const now = Date.now();
  agentPost('heldB', now - 25 * MIN, CAP());
  valve('heldB', now - 20 * MIN);
  append({ kind: 'reopen', from: 'you', to: 'heldB', project: 'heldB', operator: true, at: iso(now - 30 * MIN) });
  assert.ok(messages.roomHeld('heldB', now), 'a reopen BEFORE the valve cleared it');
  append({ kind: 'reopen', from: 'you', to: 'heldB', project: 'heldB', operator: true, at: iso(now - 5 * MIN) });
  assert.equal(messages.roomHeld('heldB', now), null, 'a reopen after the valve did not clear it');

  agentPost('heldC', now - 25 * MIN, CAP());
  valve('heldC', now - 20 * MIN);
  append({ kind: 'post', id: 'm' + (++seq), from: 'you', to: ['ann'], project: 'heldC', operator: true, text: 'here', outcomes: { ann: 'placed' }, at: iso(now - 2 * MIN) });
  assert.equal(messages.roomHeld('heldC', now), null, 'the person posting after the valve did not clear it');
  agentPost('heldC', now - MIN, CAP());
  assert.ok(messages.roomHeld('heldC', now + 1), 'agent posts since the person spoke filled the budget again, and the next post would be refused');
});

test('#5800 engine: held reads the budget now, not how a valve row was marked (no row, or one written with the limit off)', () => {
  const now = Date.now();
  agentPost('heldD', now - 12 * MIN, CAP());
  assert.ok(messages.roomHeld('heldD', now), 'a full room nobody has been refused in yet read open, though the next post would be refused');
  valve('heldD', now - 10 * MIN, false);
  const h = messages.roomHeld('heldD', now + 1);
  assert.ok(h, 'a row written while the limit was off hid a hold the valve now enforces');
  assert.equal(h.at, iso(now - 10 * MIN), 'at is the latest valve row in the window');
  agentPost('heldK', now - 12 * MIN, CAP() - 3);
  agentPost('heldK', now - 11 * MIN, 1);
  assert.equal(messages.roomHeld('heldK', now), null, 'CONTROL: a room with room left for a one-member post reads open');
});

test('#5800 engine: an answer is kept for a few seconds while the record has not grown, then read again', () => {
  const now = Date.now();
  agentPost('heldL', now - 12 * MIN, CAP() - 2);
  agentPost('heldL', now - 11 * MIN, 1);
  assert.equal(messages.roomHeld('heldL', now), null, 'CONTROL: open');
  fs.appendFileSync(messages.LOG, '');
  assert.equal(messages.roomHeld('heldL', now + 1000), null, 'kept: nothing was written');
  agentPost('heldL', now + 1500, 1);
  assert.ok(messages.roomHeld('heldL', now + 2000), 'a post written within the memo window was not seen');
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
  assert.doesNotMatch(openText.text, /at its limit/, 'CONTROL: an open room says nothing about a hold');

  agentPost(p.id, Date.now() - 4 * MIN, CAP());
  valve(p.id, Date.now() - 3 * MIN);
  const j = await room(p.id, false);
  assert.ok(j.json.held && typeof j.json.held.until === 'string', 'the held room\'s JSON has no held: ' + j.text.slice(0, 300));
  const t = await room(p.id, true);
  const first = t.text.split('\n')[0];
  assert.match(first, /^\[kosmos\] This room is at its limit for agent posts: it kept going back and forth without a result\. A post from you now will most likely be refused\. Your person can lift the hold now by posting here or reopening the room; otherwise it should lift by \d\d:\d\d\. Do not send your post another way meanwhile\. The one exception: a summary that settles the thread can go through, once per agent: 400 characters or more\.$/,
    'the hold line is not the first line of the text view: ' + t.text.slice(0, 400));
  assert.doesNotMatch(first, /bring you in/, 'the agents\' line reused the sentence written to the person');

  const r = await fetch(base + '/api/project/' + encodeURIComponent(p.id) + '/room/reopen', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal('held' in (await room(p.id, false)).json, false, 'a reopen did not clear the JSON hold');
  assert.doesNotMatch((await room(p.id, true)).text, /at its limit/, 'a reopen did not clear the text line');
});

/* #6420: the room route reads the hold at the room's own budget (it scales with the room), as the valve that would
   refuse the next post does. A six-agent room with 100 arrivals in the hour is over the dial's budget (80) and under
   its own (200): open, not "at its limit". */
test('#6420 route: a six-agent room is read at its own budget', async () => {
  const p = projects.create({ name: 'Six Route' });
  for (const a of ['ann', 'bo', 'cy', 'di', 'ed', 'fay']) projects.addAgent(p.id, a);
  const now = Date.now();
  for (let i = 0; i < 20; i += 1) agentPost(p.id, now - 10 * MIN, 5);
  assert.ok(20 * 5 > CAP(), 'CONTROL: these posts are over the dial\'s own room budget');
  const j = await room(p.id, false);
  assert.equal(j.code, 200, j.text);
  assert.equal('held' in j.json, false, 'a six-agent room was read at the dial\'s budget: ' + j.text.slice(0, 300));
  // CONTROL: past the room's own budget, the same route reads it held.
  agentPost(p.id, now - 9 * MIN, CAP() * 2.5);
  const k = await room(p.id, false);
  assert.ok(k.json.held, 'past its own budget the room did not read held: ' + k.text.slice(0, 300));
});

/* #6420: the route sizes the room as the valve does, so a member removed from Kosmos but still on the project's record
   does not count. Six on the record, one removed: the valve's budget is four recipients' (160), and 165 arrivals are
   over it, so the room reads held, as the next post would be refused. */
test('#6420 route: a removed member does not raise the room\'s budget', async () => {
  const store = require('./engine/store');
  const p = projects.create({ name: 'Six With One Gone' });
  for (const a of ['gil', 'hal', 'ivy', 'jo', 'kit', 'lu']) projects.addAgent(p.id, a);
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'lu', removedAt: iso(Date.now() - 60 * MIN) }]));
  try {
    const now = Date.now();
    for (let i = 0; i < 33; i += 1) agentPost(p.id, now - 10 * MIN, 5);
    assert.equal(messages.roomHeld(p.id, now, 5), null, 'CONTROL: counted with the removed member, the room would read open');
    assert.equal(messages.roomRecipientsOf(['gil', 'hal', 'ivy', 'jo', 'kit', 'lu']), 4, 'the removed member was counted');
    const j = await room(p.id, false);
    assert.ok(j.json.held, 'the page read the room open while the valve would hold it: ' + j.text.slice(0, 300));
  } finally { fs.rmSync(path.join(store.ROOT, 'removed.json'), { force: true }); }
});

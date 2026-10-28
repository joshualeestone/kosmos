'use strict';
/**
 * #4926: a room post held for a busy member is named on its next idle line. Reading the room with `kosmos room` did
 * not clear that, so an agent that read a thread and answered it in plain words (no --reply-to, which R2's answered
 * rule needs) was told about it again (Josh's 0.7.46 report, a Grok seat). Now the posts an identified agent was SHOWN
 * by its own room read are no longer held for it; nothing else changes.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-seen-4926-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const projects = require('./engine/projects');
const sendertoken = require('./engine/sendertoken');
const roomhold = require('./engine/roomhold');

let base;
let roster;
let pid;
let other;
const WHO = 'grokseat';
/* #7185: these rooms are planted with rows dated before the project was made, and such a row belongs to an earlier
   project of that name. So each project is dated back first. */
function datedBack(id) {
  projects.writeAll(projects.readAll().map((q) => (q.id === id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  return id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([fleet.agent(WHO, { state: 'idle' }), fleet.agent('poster', { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Seen4926' }); datedBack(p.id);
  projects.addAgent(p.id, WHO, roster);
  projects.addAgent(p.id, 'poster', roster);
  pid = p.id;
  const q = projects.create({ name: 'Other4926' }); datedBack(q.id);
  projects.addAgent(q.id, WHO, roster);
  other = q.id;
});
test.beforeEach(() => { try { fs.rmSync(roomhold.dir(), { recursive: true, force: true }); } catch { /* none yet */ } });
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
function postRow(project, text, minsAgo) {
  const id = 'p4926-' + (++seq);
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify({
    id, kind: 'post', from: 'poster', to: [WHO], project, text, at: new Date(Date.now() - minsAgo * 60000).toISOString(), outcomes: {},
  }) + '\n');
  return id;
}
const room = async (project, headers, n) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${n ? '&n=' + n : ''}`, { headers: headers || {} });
  return { status: res.status, text: await res.text() };
};
const tokenFor = (name) => ({ 'x-kosmos-agent-token': sendertoken.mint(name).token });
const heldPlain = (project) => roomhold.heldIn(WHO, project).map(roomhold.plainId);

test('an agent that reads the room with its own token is no longer held the posts it was shown', async () => {
  const a = postRow(pid, 'Can you check the lease?', 30);
  const b = postRow(pid, '@grokseat which clause?', 20);
  assert.ok(roomhold.hold(WHO, pid, a) && roomhold.hold(WHO, pid, roomhold.addressedId(b)), 'fixture: could not hold');
  assert.deepEqual(heldPlain(pid), [a, b], 'fixture: both posts are not held');
  const r = await room(pid, tokenFor(WHO));
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /Can you check the lease\?/, 'fixture: the room read did not show the first post');
  assert.match(r.text, /which clause\?/, 'fixture: the room read did not show the second post');
  assert.deepEqual(heldPlain(pid), [], 'posts the agent was shown are still held for its next idle line');
});

test('controls: a read with no agent token, or the page\'s JSON read, leaves them held; another project is untouched', async () => {
  const a = postRow(pid, 'Anyone free?', 10);
  const c = postRow(other, 'In the other room', 10);
  roomhold.hold(WHO, pid, a);
  roomhold.hold(WHO, other, c);
  assert.equal((await room(pid)).status, 200);
  assert.deepEqual(heldPlain(pid), [a], 'a read nobody identified cleared the agent\'s held posts');
  // Review 1: WITH the agent's token, so this tests the arm (the person's JSON view), not a missing token.
  const page = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room`, { headers: tokenFor(WHO) });
  assert.equal(page.status, 200);
  assert.deepEqual(heldPlain(pid), [a], 'the page\'s read cleared the agent\'s held posts');
  await room(pid, tokenFor(WHO));
  assert.deepEqual(heldPlain(pid), [], 'CONTROL: the agent\'s own read does clear them');
  assert.deepEqual(heldPlain(other), [c], 'reading one room cleared another room\'s held posts');
});

test('a held post the read did not show (older than the rows asked for) stays held', async () => {
  const old = postRow(pid, 'An older ask', 5);
  const newer = postRow(pid, 'The newest line', 1);
  roomhold.hold(WHO, pid, old);
  roomhold.hold(WHO, pid, newer);
  const r = await room(pid, tokenFor(WHO), 1);
  assert.match(r.text, /The newest line/);
  assert.doesNotMatch(r.text, /An older ask/, 'fixture: -n 1 still showed the older post');
  assert.deepEqual(heldPlain(pid), [old], 'a post the agent was not shown was dropped, or the shown one was kept');
});

test('another agent reading the room does not clear this agent\'s held posts', async () => {
  const a = postRow(pid, 'For the room', 3);
  roomhold.hold(WHO, pid, a);
  await room(pid, tokenFor('poster'));
  assert.deepEqual(heldPlain(pid), [a], 'one agent\'s read cleared another agent\'s held posts');
});

test('kosmos#7365: a held post that is now archived stops being held when the agent reads the room', async () => {
  const p = projects.create({ name: 'Archived4926' }); datedBack(p.id);
  projects.addAgent(p.id, WHO, roster);
  const old = postRow(p.id, 'An ask from long ago', 40 * 24 * 60);
  const live = postRow(p.id, 'A live line', 1);
  roomhold.hold(WHO, p.id, old);
  roomhold.hold(WHO, p.id, live);
  assert.equal(require('./engine/roomarchive').setMarker(p.id, new Date(Date.now() - 30 * 24 * 60 * 60000).toISOString()).ok, true);
  // CONTROL first: a read nobody identified leaves both held, so the drop below is the agent's read.
  await room(p.id);
  assert.deepEqual(heldPlain(p.id), [old, live]);
  const r = await room(p.id, tokenFor(WHO));
  assert.match(r.text, /A live line/);
  assert.doesNotMatch(r.text, /An ask from long ago/, 'fixture: the archived post was shown to the agent');
  assert.deepEqual(heldPlain(p.id), [], 'the archived post is still held, so its idle reminder names a post the room no longer shows');
});

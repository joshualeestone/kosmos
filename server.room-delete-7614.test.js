'use strict';
/**
 * kosmos#7614: the person deletes one of their own room posts. It leaves the room for every reader (and its reactions
 * go with it), a copy still held for a busy member is dropped and never delivered, and a member that was given it (typed,
 * or held and since told) gets one line saying it was withdrawn, without the deleted words. Only the person's own posts.
 * Real rows through the real route; only the typing into panes is recorded instead of done.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roomdelete-7614-'));
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
const roomhold = require('./engine/roomhold');
const chat = require('./engine/chat');
const store = require('./engine/store');

const SECRET = 'the words that must not be repeated';
let base;
let pid;
const typed = [];
const realDeliver = chat.deliverAutomaticAsync;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const made = projects.create({ name: 'Delete Room' });
  projects.writeAll(projects.readAll().map((q) => (q.id === made.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  pid = made.id;
  const at = (i) => new Date(Date.parse('2024-01-01T00:00:00.000Z') + i * 1000).toISOString();
  const lines = [
    // The person's post: typed to alpha, held for beta (still held), quiet for gamma (never typed).
    { kind: 'post', id: 'm901', project: pid, from: 'you', operator: true, to: ['alpha', 'beta', 'gamma'], text: SECRET, at: at(1),
      outcomes: { alpha: 'placed', beta: 'held', gamma: 'quiet' } },
    { kind: 'reaction', project: pid, of: 'm901', at: at(2), emoji: '👍', op: 'add', from: 'alpha' },
    // An agent's post: never the person's to delete.
    { kind: 'post', id: 'm902', project: pid, from: 'alpha', to: ['beta'], text: 'an agent wrote this', at: at(3), outcomes: { beta: 'placed' } },
    // The person's post held for delta, whose hold has since been told to it (no hold left): delta may have read it.
    { kind: 'post', id: 'm903', project: pid, from: 'you', operator: true, to: ['delta'], text: 'held then told', at: at(4), outcomes: { delta: 'held' } },
    // A control: the person's post nobody deletes.
    { kind: 'post', id: 'm904', project: pid, from: 'you', operator: true, to: ['alpha'], text: 'stays', at: at(5), outcomes: { alpha: 'placed' } },
    // Review 2: a long post spilled to a file in alpha's Inbox (Kosmos's, marked) and in epsilon's (not marked, so not ours).
    { kind: 'post', id: 'm907', project: pid, from: 'you', operator: true, to: ['beta'], text: 'held, deleted mid-flush', at: at(7),
      outcomes: { beta: 'held' } },
    { kind: 'post', id: 'm906', project: pid, from: 'you', operator: true, to: ['alpha', 'epsilon'], text: 'a long one', at: at(6),
      outcomes: { alpha: 'placed', epsilon: 'placed' } },
  ];
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.appendFileSync(path.join(store.ROOT, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.ok(roomhold.hold('beta', pid, 'm901'), 'beta holds m901 before the delete');
  chat.deliverAutomaticAsync = async (name, line) => { typed.push({ name, line }); return { state: chat.DELIVERY.PLACED }; };
});
test.after(() => {
  chat.deliverAutomaticAsync = realDeliver;
  try { server.closeAllConnections(); server.close(); } catch { /* down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const del = (postId, origin, extra) => fetch(`${base}/api/project/${encodeURIComponent(pid)}/room/${postId}/delete`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: origin || base, ...((extra && extra.headers) || {}) },
  body: JSON.stringify((extra && extra.body) || {}),
});
async function roomIds() {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room`);
  assert.equal(res.status, 200);
  const json = await res.json();
  return json.rows.filter((r) => r.kind === 'post').map((r) => r.id);
}

test('#7614: an agent\'s post is refused (403) and stays', async () => {
  const res = await del('m902');
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /only your own/);
  assert.ok((await roomIds()).includes('m902'));
  assert.equal(typed.length, 0, 'nobody was told anything');
});

test('#7614: no such message answers 404', async () => {
  assert.equal((await del('m999')).status, 404);
  assert.equal((await del('not-an-id')).status, 404);
});

test('#7614: another site cannot delete (the board\'s cross-site guard)', async () => {
  const res = await del('m904', 'http://evil.example');
  assert.ok(res.status >= 400, 'refused, got ' + res.status);
  assert.ok((await roomIds()).includes('m904'), 'still there');
});

test('#7614 review 1: an agent\'s token is refused (403), in the header or the body, and the person\'s post stays', async () => {
  for (const extra of [{ headers: { 'x-kosmos-agent-token': 'any-agent-token' } }, { body: { token: 'any-agent-token' } }]) {
    const res = await del('m904', null, extra);
    assert.equal(res.status, 403, JSON.stringify(extra));
    assert.match((await res.json()).error, /person's, not an agent's/);
  }
  assert.ok((await roomIds()).includes('m904'), 'still there');
  assert.equal(typed.length, 0, 'nobody was told anything');
});

test('#7614: the person\'s post goes for every reader, its hold is dropped, and only the member given it is told', async () => {
  assert.deepEqual(roomhold.heldIn('beta', pid).map(roomhold.plainId), ['m901'], 'control: held before');
  const res = await del('901');   // the page shows the number without its m
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.deleted, true);
  assert.deepEqual(json.told, ['alpha'], 'alpha was typed it; beta still had it held; gamma was never typed it');
  assert.deepEqual(typed.map((t) => t.name), ['alpha']);
  assert.match(typed[0].line, /deleted their post m901 in project Delete Room \(/, 'the project by its name, with its id');
  assert.ok(!typed[0].line.includes(SECRET), 'the note never repeats the deleted words');
  assert.deepEqual(roomhold.heldIn('beta', pid), [], 'beta\'s held copy is gone, so it is never delivered');
  const ids = await roomIds();
  assert.ok(!ids.includes('m901'), 'gone from the room');
  assert.ok(ids.includes('m904'), 'control: the person\'s other post stays');
  const rows = messages.record().rows;
  assert.ok(!rows.some((r) => r.id === 'm901' || (r.kind === 'reaction' && r.of === 'm901')), 'no reader is given it or its reactions');
  assert.ok(!rows.some((r) => r.kind === 'post-deleted'), 'the deletion row itself is given to no reader');
  assert.ok(messages.record().parsed.some((r) => r.id === 'm901'), 'it stays in the parsed log, so its id is never reused');
  assert.equal((await del('m901')).status, 404, 'a second delete finds nothing');
});

test('#7614 review 1: a held post deleted while a flush was typing it is not put back on hold when that typing fails', async () => {
  // Its own post (m907, held for beta, taken by a flush), deleted here; m904 (the person's, still in the room) is the control.
  assert.equal((await del('m907')).status, 200);
  messages._restoreHeld('beta', pid, ['m907', 'm904']);
  const back = roomhold.heldIn('beta', pid).map(roomhold.plainId);
  assert.ok(back.includes('m904') && !back.includes('m907'), 'only the post still in the room goes back: ' + JSON.stringify(back));
  roomhold.take('beta', pid);
});

test('#7614 review 2: a deleted long post\'s spill file goes from the Inbox Kosmos made, and a folder it did not make is left alone', async () => {
  const instructions = require('./engine/instructions');
  const inbox = (name) => path.join(path.dirname(instructions.fileFor(name)), 'Inbox');
  const ours = inbox('alpha'); const theirs = inbox('epsilon');
  fs.mkdirSync(ours, { recursive: true }); fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(ours, '.gitignore'), '*\n');   // the marker spillInto writes
  fs.writeFileSync(path.join(ours, 'm906.txt'), 'a long one');
  fs.writeFileSync(path.join(theirs, 'm906.txt'), 'the person\'s own file');   // no marker: not Kosmos's folder
  const res = await del('m906');
  assert.equal(res.status, 200);
  assert.ok(!fs.existsSync(path.join(ours, 'm906.txt')), 'the spill file is gone');
  assert.ok(fs.existsSync(path.join(theirs, 'm906.txt')), 'a folder Kosmos did not make keeps its file');
  assert.ok(fs.existsSync(path.join(ours, '.gitignore')), 'the Inbox itself stays');
});

test('#7614: a post held for a member and since told to it (no hold left) earns that member the note', async () => {
  typed.length = 0;
  const res = await del('m903');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).told, ['delta']);
  assert.deepEqual(typed.map((t) => t.name), ['delta']);
});

test('#7614: a member whose note could not be typed is not counted as told', async () => {
  typed.length = 0;
  const line = { kind: 'post', id: 'm905', project: pid, from: 'you', operator: true, to: ['alpha'], text: 'x',
    at: new Date(Date.parse('2024-01-01T00:00:10.000Z')).toISOString(), outcomes: { alpha: 'placed' } };
  fs.appendFileSync(path.join(store.ROOT, 'messages.jsonl'), JSON.stringify(line) + '\n');
  chat.deliverAutomaticAsync = async (name, l) => { typed.push({ name, line: l }); return { state: chat.DELIVERY.COULD_NOT }; };
  try {
    const res = await del('m905');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).told, []);
    assert.equal(typed.length, 1, 'it was tried');
  } finally {
    chat.deliverAutomaticAsync = async (name, l) => { typed.push({ name, line: l }); return { state: chat.DELIVERY.PLACED }; };
  }
});

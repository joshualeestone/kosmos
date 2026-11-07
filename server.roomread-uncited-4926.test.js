'use strict';
/**
 * kosmos#4926: one post that answers several. A Grok seat and a Claude seat, on 0.7.94, each answered a round of three asks
 * in one post citing none, and `--unanswered` still listed all three as waiting. An agent's ask the reader has posted
 * after moves off the list onto its own line, by id, and `kosmos room` says the same under the post.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-uncited-4926-'));
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

let base;
let roster;
const WHO = 'grokseat';
const OTHER = 'poster';
function newRoom(name) {
  const p = projects.create({ name });
  projects.writeAll(projects.readAll().map((q) => (q.id === p.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  projects.addAgent(p.id, WHO, roster);
  projects.addAgent(p.id, OTHER, roster);
  return p.id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([fleet.agent(WHO, { state: 'idle' }), fleet.agent(OTHER, { state: 'idle' })]).agents;
});
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
let clock = Date.now() - 60 * 60000;
function post(project, fields) {
  const id = 'm' + (59260 + (++seq));
  clock += 1000;
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify(Object.assign({
    id, kind: 'post', from: OTHER, to: [WHO], project, text: 'row ' + id, at: new Date(clock).toISOString(), outcomes: {},
  }, fields)) + '\n');
  return id;
}
const ask = (project, fields) => post(project, Object.assign({ text: '@grokseat please answer', mentioned: [WHO], outcomes: { [WHO]: 'placed' } }, fields));
const own = (project, fields) => post(project, Object.assign({ from: WHO, to: [OTHER], text: 'ALPHA' }, fields));
const read = async (project, query, headers) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${query || ''}`, {
    headers: headers === undefined ? { 'x-kosmos-agent-token': sendertoken.mint(WHO).token } : headers,
  });
  return res.text();
};
const unanswered = (project, q) => read(project, '&unanswered=1' + (q || ''));
const onCovered = (text) => (text.split('\n').find((l) => l.startsWith('[kosmos] Not counted as waiting on you')) || '');
const listed = (text, id) => text.split('\n').some((l) => l.includes('[' + id + '] ') && !l.startsWith('[kosmos]'));

test('a round answered in one uncited post leaves the waiting list, each ask named with the post', async () => {
  const pid = newRoom('Uncited4926a');
  const a = [ask(pid), ask(pid), ask(pid)];
  const mine = own(pid);
  const t = await unanswered(pid);
  for (const id of a) {
    assert.ok(!listed(t, id), id + ' is not listed: ' + t);
    assert.ok(onCovered(t).includes('[' + id + '] (your [' + mine + '])'), id + ' is named: ' + t);
  }
  assert.ok(t.startsWith('Waiting on an answer from you: nothing else waiting on you in this room.\n'), t);
});

test('the control: before the reader posts, the same round is all waiting, and no line says otherwise', async () => {
  const pid = newRoom('Uncited4926b');
  const a = [ask(pid), ask(pid)];
  const t = await unanswered(pid);
  for (const id of a) assert.ok(listed(t, id), id + ': ' + t);
  assert.equal(onCovered(t), '');
  assert.ok(t.startsWith('Waiting on an answer from you: 2 posts'), t);
});

test('a typed post with an unconfirmed delivery counts as reached; held, quiet, undelivered and no outcome do not', async () => {
  const pid = newRoom('Uncited4926c');
  const unconfirmed = ask(pid, { outcomes: { [WHO]: 'unconfirmed' } });
  const held = ask(pid, { outcomes: { [WHO]: 'held' } });
  const none = ask(pid, { outcomes: {} });
  const couldNot = ask(pid, { outcomes: { [WHO]: 'could_not' } });
  own(pid);
  const t = await unanswered(pid);
  assert.ok(onCovered(t).includes('[' + unconfirmed + ']'), t);
  assert.ok(!listed(t, unconfirmed), t);
  for (const id of [held, none, couldNot]) {
    assert.ok(listed(t, id), id + ' stays listed: ' + t);
    assert.ok(!onCovered(t).includes('[' + id + ']'), t);
  }
});

test('a reply citing an older ask is about that ask; one citing something newer covers the ask', async () => {
  const pid = newRoom('Uncited4926d');
  const first = ask(pid);
  const second = ask(pid);
  own(pid, { replyTo: first });
  let t = await unanswered(pid);
  assert.ok(listed(t, second), 'a reply to the older ask does not answer the newer: ' + t);
  assert.ok(!onCovered(t).includes('[' + second + ']'), t);
  const third = ask(pid);
  const answer = own(pid, { replyTo: third });
  t = await unanswered(pid);
  assert.ok(onCovered(t).includes('[' + second + '] (your [' + answer + '])'), 'a reply to a newer post covers the older: ' + t);
  assert.ok(!listed(t, third), 'and the cited one is answered: ' + t);
});

test('only the reader\'s own later post in this room counts', async () => {
  const pid = newRoom('Uncited4926e');
  own(pid, { text: 'before the ask' });
  const a = ask(pid);
  post(pid, { from: OTHER, to: [WHO], text: 'someone else, uncited' });
  const elsewhere = newRoom('Uncited4926e2');
  own(elsewhere, { text: 'another room' });
  const t = await unanswered(pid);
  assert.ok(listed(t, a), t);
  assert.equal(onCovered(t), '');
});

test('the person\'s ask stays listed, with the same factual line under it', async () => {
  const pid = newRoom('Uncited4926f');
  const a = post(pid, { operator: true, from: 'you', text: 'please do this', outcomes: { [WHO]: 'placed' } });
  const mine = own(pid);
  const t = await unanswered(pid);
  assert.ok(listed(t, a), t);
  assert.equal(onCovered(t), '');
  assert.ok(t.includes('[kosmos] you posted [' + mine + '] after [' + a + '] without citing it.'), t);
});

test('kosmos room says it under the post, for the reader only, and not under one it answered by id', async () => {
  const pid = newRoom('Uncited4926g');
  const a = ask(pid);
  const cited = ask(pid);
  const mine = own(pid);
  const answer = own(pid, { replyTo: cited });
  const t = await read(pid);
  const lines = t.split('\n');
  const at = lines.findIndex((l) => l.includes('[' + a + '] '));
  assert.ok(lines[at + 1].includes('[kosmos] you posted [' + mine + '] after [' + a + '] without citing it.'), t);
  assert.ok(t.includes('[kosmos] you already answered [' + cited + '] in [' + answer + '].'), t);
  assert.ok(!t.includes('after [' + cited + ']'), t);
  const other = await read(pid, '', { 'x-kosmos-agent-token': sendertoken.mint(OTHER).token });
  assert.ok(!other.includes('without citing it'), other);
  const nobody = await read(pid, '', {});
  assert.ok(!nobody.includes('without citing it'), nobody);
});

test('a post that asked the reader nothing gets no line: an FYI is not an ask', async () => {
  const pid = newRoom('Uncited4926k');
  const fyi = post(pid, { text: 'an FYI for the room', outcomes: { [WHO]: 'placed' } });
  own(pid);
  const t = await read(pid);
  assert.ok(t.includes('[' + fyi + '] '), t);
  assert.ok(!t.includes('without citing it'), t);
});

test('an agent\'s old ask is counted as aged, not named on the line', async () => {
  const pid = newRoom('Uncited4926h');
  const saved = clock;
  clock = Date.now() - 5 * 24 * 60 * 60000;
  const old = ask(pid);
  clock = saved;
  own(pid);
  const t = await unanswered(pid);
  assert.ok(!onCovered(t).includes('[' + old + ']'), t);
  assert.ok(t.includes('1 post that asked you something more than 3 days ago'), t);
});

test('the line is capped by -n, newest kept, and says how many more', async () => {
  const pid = newRoom('Uncited4926i');
  const a = [ask(pid), ask(pid), ask(pid)];
  own(pid);
  const line = onCovered(await unanswered(pid, '&n=2'));
  assert.ok(!line.includes('[' + a[0] + ']'), line);
  assert.ok(line.includes('[' + a[1] + ']') && line.includes('[' + a[2] + ']'), line);
  assert.ok(line.includes(', and 1 older.'), line);
});

test('asks still open and covered ones show together, and the count is only the open ones', async () => {
  const pid = newRoom('Uncited4926j');
  const covered = ask(pid);
  own(pid);
  const open = ask(pid);
  const t = await unanswered(pid);
  assert.ok(t.startsWith('Waiting on an answer from you: 1 post in this room'), t);
  assert.ok(listed(t, open), t);
  assert.ok(onCovered(t).includes('[' + covered + ']'), t);
});

test('laterOwnPost refuses what it cannot judge', () => {
  const rows = [{ id: 'm1', kind: 'post', outcomes: { a: 'placed' } }, { id: 'm2', kind: 'post', from: 'a' }, { id: 'm3', kind: 'note', from: 'a' }];
  assert.equal(messages.laterOwnPost(rows, 0, 'a'), 'm2');
  assert.equal(messages.laterOwnPost(rows, 0, null), null);
  assert.equal(messages.laterOwnPost(rows, 9, 'a'), null);
  assert.equal(messages.laterOwnPost(null, 0, 'a'), null);
  assert.equal(messages.laterOwnPost([{ id: 'm1', outcomes: { a: 'placed' } }, { id: 'm3', kind: 'note', from: 'a' }], 0, 'a'), null, 'a note is not a post');
  assert.equal(messages.laterOwnPost([{ id: 'm1', outcomes: { a: 'placed' } }, { id: 'm2', kind: 'post', from: 'a', operator: true }], 0, 'a'), null, 'the person\'s row under a name');
});

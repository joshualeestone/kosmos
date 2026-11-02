'use strict';
/**
 * #4926: answered room posts came back as if new (Josh's 0.7.83 report, #7784 item 4: a Grok seat was handed three
 * posts it had already answered). The hold-and-tell path measured clean (1,345 tellings, 0 re-tells), so the read path:
 * `kosmos room` showed old asks exactly like new ones. Now, for an agent reading with its own token:
 *   - a post it answered by id carries "[kosmos] you already answered [mX] in [mY]." under it;
 *   - `?unanswered=1` lists only the posts that asked it something and that no post of its cites.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-answered-4926-'));
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
/* #7185: rows planted before the project was made belong to an earlier project of that name, so date it back. */
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
/* One post row, each a second after the last so the room's order is the order written. */
function post(project, fields) {
  const id = 'm' + (49260 + (++seq));
  clock += 1000;
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify(Object.assign({
    id, kind: 'post', from: OTHER, to: [WHO], project, text: 'row ' + id, at: new Date(clock).toISOString(), outcomes: {},
  }, fields)) + '\n');
  return id;
}
const room = async (project, headers, query) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${query || ''}`, { headers: headers || {} });
  return { status: res.status, text: await res.text() };
};
const tokenFor = (name) => ({ 'x-kosmos-agent-token': sendertoken.mint(name).token });
const marker = (ask, answer) => '[kosmos] you already answered [' + ask + '] in [' + answer + '].';

test('a post the reader answered by id says so under it, for that reader only', async () => {
  const pid = newRoom('Answered4926a');
  const ask = post(pid, { text: '@grokseat which clause?', mentioned: [WHO] });
  const reply = post(pid, { from: WHO, to: [OTHER], text: 'Clause 4.', replyTo: ask });
  const open = post(pid, { text: '@grokseat and the rent?', mentioned: [WHO] });
  const r = await room(pid, tokenFor(WHO));
  assert.equal(r.status, 200, r.text);
  assert.ok(r.text.includes(marker(ask, reply)), 'the answered ask carries no marker:\n' + r.text);
  // The marker sits on the line right after its post, not anywhere in the room.
  const lines = r.text.split('\n');
  const at = lines.findIndex((l) => l.includes('[' + ask + '] ' + OTHER));
  assert.ok(at >= 0 && lines[at + 1].includes(marker(ask, reply)), 'the marker is not under its post:\n' + r.text);
  assert.ok(!r.text.includes('you already answered [' + open + ']'), 'an unanswered ask is marked answered');
  assert.ok(!r.text.includes('you already answered [' + reply + ']'), 'the reader\'s own reply is marked as answered by itself');
  // Controls: the same room, read by nobody identified and by the agent that did not answer, has no marker.
  assert.ok((await room(pid)).text.includes('which clause?'), 'fixture: the unidentified read did not show the ask');
  assert.doesNotMatch((await room(pid)).text, /you already answered/, 'a read nobody identified shows someone\'s marker');
  assert.doesNotMatch((await room(pid, tokenFor(OTHER))).text, /you already answered/, 'another agent sees the reader\'s marker');
});

test('two answers to one ask are both named, oldest first', async () => {
  const pid = newRoom('Answered4926b');
  const ask = post(pid, { text: '@grokseat status?', mentioned: [WHO] });
  const one = post(pid, { from: WHO, to: [OTHER], text: 'Working on it.', replyTo: ask });
  const two = post(pid, { from: WHO, to: [OTHER], text: 'Done.', replyTo: ask });
  const r = await room(pid, tokenFor(WHO));
  assert.ok(r.text.includes('[kosmos] you already answered [' + ask + '] in [' + one + '], [' + two + '].'), r.text);
});

test('?unanswered=1 lists the asks still open: named, or the person\'s post that reached the reader', async () => {
  const pid = newRoom('Answered4926c');
  const answered = post(pid, { text: '@grokseat answered ask', mentioned: [WHO] });
  post(pid, { from: WHO, to: [OTHER], text: 'here you go', replyTo: answered });
  const named = post(pid, { text: '@grokseat open ask', mentioned: [WHO] });
  const fyi = post(pid, { text: 'just so you know', mentioned: [] });
  const person = post(pid, { from: 'you', operator: true, text: 'everyone: send me a status', mentioned: [] });
  const quiet = post(pid, { from: 'you', operator: true, text: 'not for you', mentioned: [], outcomes: { [WHO]: 'quiet' } });
  const own = post(pid, { from: WHO, to: [OTHER], text: '@poster my own ask', mentioned: [OTHER] });
  const r = await room(pid, tokenFor(WHO), '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  const ids = (r.text.match(/^\S.*?  \[(m\d+)\] /gm) || []).map((l) => /\[(m\d+)\]/.exec(l)[1]);
  assert.deepEqual(ids, [named, person], 'the open asks listed are wrong:\n' + r.text);
  for (const gone of [answered, fyi, quiet, own]) assert.ok(!ids.includes(gone), gone + ' is listed:\n' + r.text);
  // CONTROL: without the flag every one of them is in the room, so the filter is what left them out.
  const all = (await room(pid, tokenFor(WHO))).text;
  for (const id of [answered, fyi, quiet, own, named, person]) assert.ok(all.includes('[' + id + ']'), 'fixture: ' + id + ' is not in the room');
});

test('?unanswered=1 finds an open ask older than the last N rows; N caps how many are listed', async () => {
  const pid = newRoom('Answered4926d');
  const old = post(pid, { text: '@grokseat an older ask', mentioned: [WHO] });
  for (let i = 0; i < 5; i++) post(pid, { text: 'chatter ' + i, mentioned: [] });
  const newer = post(pid, { text: '@grokseat a newer ask', mentioned: [WHO] });
  const plain = await room(pid, tokenFor(WHO), '&n=2');
  assert.ok(!plain.text.includes('[' + old + ']'), 'fixture: -n 2 still shows the old ask');
  const both = await room(pid, tokenFor(WHO), '&n=2&unanswered=1');
  assert.ok(both.text.includes('[' + old + ']') && both.text.includes('[' + newer + ']'), both.text);
  const one = await room(pid, tokenFor(WHO), '&n=1&unanswered=1');
  assert.ok(one.text.includes('[' + newer + ']') && !one.text.includes('[' + old + ']'), 'n=1 did not keep only the newest:\n' + one.text);
});

test('?unanswered=1 with nothing open says so; with no agent token it refuses rather than listing someone else\'s', async () => {
  const pid = newRoom('Answered4926e');
  const ask = post(pid, { text: '@grokseat one ask', mentioned: [WHO] });
  post(pid, { from: WHO, to: [OTHER], text: 'answered', replyTo: ask });
  const r = await room(pid, tokenFor(WHO), '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /^Nothing in this room is waiting on an answer from you/m, r.text);
  assert.doesNotMatch(r.text, /Nothing has been said in this room yet/, 'an answered room reads as empty');
  const anon = await room(pid, {}, '&unanswered=1');
  assert.equal(anon.status, 400, anon.text);
  assert.match(anon.text, /could not tell which agent is reading/);
  // CONTROL: the other agent was asked nothing here, so its list is empty, not the reader's.
  assert.match((await room(pid, tokenFor(OTHER), '&unanswered=1')).text, /^Nothing in this room is waiting/m);
});

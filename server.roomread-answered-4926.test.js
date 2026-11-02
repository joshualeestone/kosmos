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
  assert.match(r.text, /^Waiting on an answer from you: 2 posts in this room /m, 'the filtered view does not say it is one:\n' + r.text);
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
  assert.match(both.text, /^Waiting on an answer from you: 2 posts in this room \(.*\):$/m, 'n=2 with two open asks miscounts:\n' + both.text);
  const one = await room(pid, tokenFor(WHO), '&n=1&unanswered=1');
  assert.ok(one.text.includes('[' + newer + ']') && !one.text.includes('[' + old + ']'), 'n=1 did not keep only the newest:\n' + one.text);
  assert.match(one.text, /^Waiting on an answer from you: 2 posts in this room .*; the newest is below:$/m,
    'n=1 reports only the listed post, so an agent reads one open ask where there are two:\n' + one.text);
});

test('?unanswered=1 with nothing open says so; with no agent token it refuses rather than listing someone else\'s', async () => {
  const pid = newRoom('Answered4926e');
  const ask = post(pid, { text: '@grokseat one ask', mentioned: [WHO] });
  post(pid, { from: WHO, to: [OTHER], text: 'answered', replyTo: ask });
  const r = await room(pid, tokenFor(WHO), '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /^Waiting on an answer from you: nothing in this room\.$/m, r.text);
  assert.doesNotMatch(r.text, /Nothing has been said in this room yet/, 'an answered room reads as empty');
  const anon = await room(pid, {}, '&unanswered=1');
  assert.equal(anon.status, 400, anon.text);
  assert.match(anon.text, /could not tell which agent is reading/);
  // CONTROL: the other agent was asked nothing here, so its list is empty, not the reader's.
  assert.match((await room(pid, tokenFor(OTHER), '&unanswered=1')).text, /^Waiting on an answer from you: nothing in this room\.$/m);
  // CONTROL: the unfiltered read carries no such line.
  assert.doesNotMatch((await room(pid, tokenFor(WHO))).text, /Waiting on an answer from you/);
});

test('the reader answering its own post, or the person\'s post, by id: marked only where someone else asked', async () => {
  const pid = newRoom('Answered4926f');
  const mine = post(pid, { from: WHO, to: [OTHER], text: '@poster are you there?', mentioned: [OTHER] });
  const followUp = post(pid, { from: WHO, to: [OTHER], text: 'following up', replyTo: mine });
  const person = post(pid, { from: 'you', operator: true, text: 'grokseat, a status please', mentioned: [] });
  const answer = post(pid, { from: WHO, to: [OTHER], text: 'all green', replyTo: person });
  const r = await room(pid, tokenFor(WHO));
  assert.ok(r.text.includes(followUp), 'fixture: the follow-up is not in the room');
  assert.ok(!r.text.includes('you already answered [' + mine + ']'), 'the reader\'s own post is marked answered by its own follow-up:\n' + r.text);
  assert.ok(r.text.includes(marker(person, answer)), 'the person\'s post the reader answered by id is not marked:\n' + r.text);
  assert.match((await room(pid, tokenFor(WHO), '&unanswered=1')).text, /^Waiting on an answer from you: nothing in this room\.$/m,
    'the answered person\'s post, or the reader\'s own post, is listed as waiting');
});

test('?unanswered=1 leaves out the person\'s post that could not reach the reader', async () => {
  const pid = newRoom('Answered4926g');
  const missed = post(pid, { from: 'you', operator: true, text: 'never typed to it', mentioned: [], outcomes: { [WHO]: 'could_not' } });
  const reached = post(pid, { from: 'you', operator: true, text: 'typed to it', mentioned: [] });
  const r = await room(pid, tokenFor(WHO), '&unanswered=1');
  assert.ok(r.text.includes('[' + reached + ']'), 'CONTROL: the post that reached it is not listed:\n' + r.text);
  assert.ok(!r.text.includes('[' + missed + ']'), 'a post that could not reach the reader is listed as waiting on it:\n' + r.text);
});

test('?unanswered=1 on a room log that cannot be read still answers as a board that knows the flag, and says it may be wrong', async () => {
  const pid = newRoom('Answered4926h');
  post(pid, { text: '@grokseat an ask', mentioned: [WHO] });   // grows the log, so the next read re-reads it
  fs.chmodSync(messages.LOG, 0o000);
  let r;
  try { r = await room(pid, tokenFor(WHO), '&unanswered=1'); } finally { fs.chmodSync(messages.LOG, 0o644); }
  assert.match(r.text, /^We could not read some of this room/m, 'fixture: the room log was read after all:\n' + r.text);
  assert.match(r.text, /^Waiting on an answer from you: none found, but this room could not be read/m,
    'a current board left out its filtered-view line, so a CLI calls it an older board:\n' + r.text);
  assert.doesNotMatch(r.text, /nothing in this room\./, 'an unreadable room claims nothing is waiting');
});

test('?unanswered=1 counts an agent\'s `Sender -> Name:` header ask as an ask, as the claim guard does', async () => {
  const pid = newRoom('Answered4926i');
  const header = post(pid, { text: 'Poster -> Grokseat: can you take the lease?', mentioned: [], addressed: [WHO] });
  const other = post(pid, { text: 'Poster -> Somebody: not you', mentioned: [], addressed: ['somebody'] });
  const r = await room(pid, tokenFor(WHO), '&unanswered=1');
  assert.ok(r.text.includes('[' + header + ']'), 'an open ask addressed by header is not listed:\n' + r.text);
  assert.ok(!r.text.includes('[' + other + ']'), 'CONTROL: a header ask to someone else is listed for the reader:\n' + r.text);
  const answer = post(pid, { from: WHO, to: [OTHER], text: 'yes', replyTo: header });
  assert.match((await room(pid, tokenFor(WHO), '&unanswered=1')).text, /^Waiting on an answer from you: nothing in this room\.$/m,
    'answering the header ask by id (' + answer + ') did not take it off the list');
});

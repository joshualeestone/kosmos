'use strict';
/**
 * kosmos#7969 (the 0.7.88 cross-seat report: 39, 41 and 102 historical posts on three seats' --unanswered): an agent's ask
 * older than UNANSWERED_DAYS is counted under `kosmos room <id> --unanswered`, not listed; --all shows it too. The
 * person's asks never age out. Follows #4926 and #7848.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-aged-7969-'));
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
const CLAIMER = 'claimseat';
const projects = require('./engine/projects');
const sendertoken = require('./engine/sendertoken');

let base;
let roster;
const ME = 'readerseat';
const POSTER = 'askerseat';
const DAY = 24 * 60 * 60 * 1000;
function newRoom(name) {
  const p = projects.create({ name });
  projects.writeAll(projects.readAll().map((q) => (q.id === p.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  for (const n of [ME, POSTER, CLAIMER]) projects.addAgent(p.id, n, roster);
  return p.id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([ME, POSTER, CLAIMER].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
});
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
const append = (row) => { fs.mkdirSync(path.dirname(messages.LOG), { recursive: true }); fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n'); };
/* An ask of ME, `ago` ms before now (rows are appended oldest first, as the log is). */
function ask(project, ago, fields) {
  const id = 'm' + (79690 + (++seq));
  append(Object.assign({ id, kind: 'post', from: POSTER, to: [ME], project, text: '@readerseat question ' + id, mentioned: [ME],
    at: new Date(Date.now() - ago).toISOString(), outcomes: {} }, fields));
  return id;
}
const room = async (project, query) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${query || ''}`, { headers: { 'x-kosmos-agent-token': sendertoken.mint(ME).token } });
  return { status: res.status, text: await res.text() };
};
const listed = (text, id) => text.split('\n').some((l) => l.includes('[' + id + ']') && !l.startsWith('[kosmos]'));
const AGED = (n) => '[kosmos] ' + n + (n === 1 ? ' post' : ' posts') + ' that asked you something more than 3 days ago '
  + (n === 1 ? 'is' : 'are') + ' not listed (a person\'s ask stays listed if it names you, or until you have posted after it). Add --all to see ' + (n === 1 ? 'it' : 'them') + ' too.';

test('kosmos#7969: an agent\'s ask older than 3 days is counted under the list, not in it; a recent one is listed', async () => {
  const pid = newRoom('Aged7969a');
  const old1 = ask(pid, 4 * DAY);
  const old2 = ask(pid, 9 * DAY + 1000);
  const fresh = ask(pid, 2 * DAY);
  const r = await room(pid, '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  assert.ok(listed(r.text, fresh), 'CONTROL: the recent ask is listed:\n' + r.text);
  assert.ok(!listed(r.text, old1) && !listed(r.text, old2), 'an ask older than 3 days is still listed:\n' + r.text);
  assert.match(r.text, /^Waiting on an answer from you: 1 post in this room /m, 'the head counts only what it lists');
  assert.ok(r.text.includes(AGED(2) + '\n'), 'the older asks are not said, or said wrongly:\n' + r.text);
});

test('kosmos#7969: --all lists the older asks too, and says nothing about age', async () => {
  const pid = newRoom('Aged7969b');
  const old = ask(pid, 5 * DAY);
  const fresh = ask(pid, 1 * DAY);
  const r = await room(pid, '&unanswered=1&all=1');
  assert.ok(listed(r.text, old) && listed(r.text, fresh), '--all leaves an ask out:\n' + r.text);
  assert.match(r.text, /^Waiting on an answer from you: 2 posts in this room /m);
  assert.ok(!r.text.includes('not listed (the person'), '--all still speaks of older posts:\n' + r.text);
  // CONTROL: `all` alone is not --unanswered (the whole room, as before).
  const plain = await room(pid, '&all=1');
  assert.ok(!plain.text.includes('Waiting on an answer from you: '), 'all=1 without unanswered=1 filtered the room');
});

test('kosmos#7969: the person\'s ask never ages out', async () => {
  const pid = newRoom('Aged7969c');
  const theirs = ask(pid, 10 * DAY, { operator: true, from: 'operator', mentioned: [], to: [ME] });
  const agents = ask(pid, 10 * DAY + 5000);
  const r = await room(pid, '&unanswered=1');
  assert.ok(listed(r.text, theirs), 'the person\'s ten-day-old ask was aged out:\n' + r.text);
  assert.ok(!listed(r.text, agents), 'CONTROL: an agent\'s ask as old is aged out:\n' + r.text);
  assert.ok(r.text.includes(AGED(1) + '\n'), r.text);
});

test('kosmos#7969: when every open ask is older, the head still says it is the filtered view, and the count follows', async () => {
  const pid = newRoom('Aged7969d');
  ask(pid, 6 * DAY);
  const r = await room(pid, '&unanswered=1');
  assert.ok(r.text.includes('Waiting on an answer from you: nothing from the last 3 days in this room.\n'),
    'the head is gone, so a CLI would call this board one that does not know --unanswered:\n' + r.text);
  assert.ok(r.text.includes(AGED(1) + '\n'), r.text);
  // CONTROL: a room with no ask at all keeps its own sentence and no age line.
  const empty = newRoom('Aged7969e');
  const e = await room(empty, '&unanswered=1');
  assert.ok(e.text.includes('Waiting on an answer from you: nothing in this room.\n') && !e.text.includes('not listed (the person'), e.text);
});

test('kosmos#7969 review 1: claimed and older asks with nothing recent: the head does not say nothing else waits', async () => {
  const pid = newRoom('Aged7969g');
  const claimed = ask(pid, 1 * DAY, { to: [ME, CLAIMER], mentioned: [ME, CLAIMER] });
  append({ kind: 'reaction', project: pid, of: claimed, at: new Date(Date.now() - DAY + 60000).toISOString(), emoji: '\u{1F64B}', op: 'add', from: CLAIMER, claim: true });
  ask(pid, 5 * DAY);
  const r = await room(pid, '&unanswered=1');
  assert.ok(r.text.includes('Waiting on an answer from you: nothing else from the last 3 days waiting on you in this room; the ask below is claimed'),
    'the head says nothing else waits while older asks are counted below it:\n' + r.text);
  assert.ok(r.text.includes(AGED(1) + '\n'), r.text);
  // CONTROL: claimed with nothing older keeps the #7848 sentence.
  const pid2 = newRoom('Aged7969h');
  const c2 = ask(pid2, 1 * DAY, { to: [ME, CLAIMER], mentioned: [ME, CLAIMER] });
  append({ kind: 'reaction', project: pid2, of: c2, at: new Date(Date.now() - DAY + 60000).toISOString(), emoji: '\u{1F64B}', op: 'add', from: CLAIMER, claim: true });
  const r2 = await room(pid2, '&unanswered=1');
  assert.ok(r2.text.includes('Waiting on an answer from you: nothing else waiting on you in this room; the ask below is claimed'), r2.text);
});

test('kosmos#7969 review 1: -n caps the recent asks; the count says only those, and the older ones are counted apart', async () => {
  const pid = newRoom('Aged7969i');
  ask(pid, 4 * DAY);
  const a = ask(pid, 2 * DAY);
  const b = ask(pid, 1 * DAY);
  const r = await room(pid, '&unanswered=1&n=1');
  assert.match(r.text, /^Waiting on an answer from you: 2 posts in this room .*; the newest is below:$/m, 'the older ask was counted with the recent ones:\n' + r.text);
  assert.ok(listed(r.text, b) && !listed(r.text, a), 'CONTROL: -n 1 shows the newest only:\n' + r.text);
  assert.ok(r.text.includes(AGED(1) + '\n'), r.text);
});

test('kosmos#7969 review 2: an older ask the reader already answered by id is not counted as waiting', async () => {
  const pid = newRoom('Aged7969j');
  const answered = ask(pid, 5 * DAY);
  ask(pid, 6 * DAY);
  append({ id: 'm7969r', kind: 'post', from: ME, to: [POSTER], project: pid, text: 'here you go', replyTo: answered,
    at: new Date(Date.now() - 4 * DAY).toISOString(), outcomes: {} });
  const r = await room(pid, '&unanswered=1');
  assert.ok(r.text.includes(AGED(1) + '\n'), 'an answered older ask is still counted as waiting:\n' + r.text);
});

/* kosmos#8300: a person's ask to the whole room, and the reader's later post in that room. */
const toRoom = (pid, ago, extra) => ask(pid, ago, Object.assign({ operator: true, from: 'operator', mentioned: [], to: [ME], outcomes: { [ME]: 'placed' } }, extra));
function myPost(project, ago) {
  const id = 'm' + (79690 + (++seq));
  append({ id, kind: 'post', from: ME, to: [], project, text: 'something else entirely', mentioned: [], at: new Date(Date.now() - ago).toISOString(), outcomes: {} });
  return id;
}

test('kosmos#8300: a person\'s old ask to the room leaves the list once the reader has posted after it, and --all still shows it', async () => {
  const pid = newRoom('Aged8300a');
  const old = toRoom(pid, 10 * DAY);
  myPost(pid, 9 * DAY);
  const r = await room(pid, '&unanswered=1');
  assert.ok(!listed(r.text, old), 'it stayed listed:\n' + r.text);
  assert.ok(r.text.includes(AGED(1) + '\n'), r.text);
  const all = await room(pid, '&unanswered=1&all=1');
  assert.ok(listed(all.text, old), '--all lost it:\n' + all.text);
});

test('kosmos#8300: the same old ask with no later post from the reader stays listed', async () => {
  const pid = newRoom('Aged8300b');
  const old = toRoom(pid, 10 * DAY);
  assert.ok(listed((await room(pid, '&unanswered=1')).text, old));
});

test('kosmos#8300: a post from before the ask does not count', async () => {
  const pid = newRoom('Aged8300c');
  myPost(pid, 11 * DAY);
  const old = toRoom(pid, 10 * DAY);
  assert.ok(listed((await room(pid, '&unanswered=1')).text, old));
});

test('kosmos#8300: a recent ask stays listed whatever the reader has posted since', async () => {
  const pid = newRoom('Aged8300d');
  const recent = toRoom(pid, 1 * DAY);
  myPost(pid, 0.5 * DAY);
  assert.ok(listed((await room(pid, '&unanswered=1')).text, recent));
});

test('kosmos#8300: an old ask that names the reader stays listed after the reader posts', async () => {
  const pid = newRoom('Aged8300e');
  const named = toRoom(pid, 10 * DAY, { mentioned: [ME], text: '@readerseat are you there' });
  myPost(pid, 9 * DAY);
  assert.ok(listed((await room(pid, '&unanswered=1')).text, named));
});

test('kosmos#8300: an old ask that never reached the reader stays listed, whatever it posted', async () => {
  const pid = newRoom('Aged8300f');
  const lost = toRoom(pid, 10 * DAY, { outcomes: {} });
  myPost(pid, 9 * DAY);
  assert.ok(listed((await room(pid, '&unanswered=1')).text, lost));
});

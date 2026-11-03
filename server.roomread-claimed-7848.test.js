'use strict';
/**
 * kosmos#7848: a room request addressed to several agents, claimed by one of them (kosmos claim, a live claim 🙋), is
 * handled for the others: it leaves their `kosmos room <id> --unanswered` list and is named under it, so they can still
 * read it. A later post that names one of them again is its own ask and is listed. Follows #4926.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-claimed-7848-'));
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
const ME = 'readerseat';
const CLAIMER = 'claimseat';
const BYSTANDER = 'otherseat';
const POSTER = 'askerseat';
function newRoom(name) {
  const p = projects.create({ name });
  projects.writeAll(projects.readAll().map((q) => (q.id === p.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  for (const n of [ME, CLAIMER, BYSTANDER, POSTER]) projects.addAgent(p.id, n, roster);
  return p.id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([ME, CLAIMER, BYSTANDER, POSTER].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
});
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
let clock = Date.now() - 60 * 60000;
const append = (row) => { fs.mkdirSync(path.dirname(messages.LOG), { recursive: true }); fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n'); };
function post(project, fields) {
  const id = 'm' + (78480 + (++seq));
  clock += 1000;
  append(Object.assign({ id, kind: 'post', from: POSTER, to: [ME, CLAIMER], project, text: 'row ' + id, at: new Date(clock).toISOString(), outcomes: {} }, fields));
  return id;
}
/* A claim, as react() writes one (`claim: true` is what makes a 🙋 a claim). */
function claim(project, of, from, op) {
  clock += 1000;
  append({ kind: 'reaction', project, of, at: new Date(clock).toISOString(), emoji: '\u{1F64B}', op: op || 'add', from, ...(op === 'remove' ? {} : { claim: true }) });
}
const room = async (project, who, query) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${query || ''}`, { headers: who ? { 'x-kosmos-agent-token': sendertoken.mint(who).token } : {} });
  return { status: res.status, text: await res.text() };
};
const listed = (text, id) => text.split('\n').some((l) => l.includes('[' + id + '] ' + POSTER));
const CLAIMED = '[kosmos] Claimed, each by an agent the post also asked, so not counted as waiting on you: ';

test('kosmos#7848: an ask claimed by another agent it asked leaves my --unanswered, and is named under it', async () => {
  const pid = newRoom('Claimed7848a');
  const ask = post(pid, { text: '@readerseat @claimseat who takes the rent clause?', mentioned: [ME, CLAIMER] });
  const open = post(pid, { text: '@readerseat and the deposit?', mentioned: [ME] });
  // CONTROL: before the claim it is waiting on me.
  let r = await room(pid, ME, '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  assert.ok(listed(r.text, ask) && listed(r.text, open), 'fixture: before the claim, both asks should be waiting on me:\n' + r.text);
  claim(pid, ask, CLAIMER);
  r = await room(pid, ME, '&unanswered=1');
  assert.ok(!listed(r.text, ask), 'an ask another addressed agent claimed is still listed as waiting on me:\n' + r.text);
  assert.ok(listed(r.text, open), 'an unclaimed ask went missing:\n' + r.text);
  assert.match(r.text, /Waiting on an answer from you: 1 post in this room/, 'the count should leave the claimed ask out:\n' + r.text);
  const line = r.text.split('\n').find((l) => l.startsWith(CLAIMED)) || '';
  assert.ok(line.includes('[' + ask + '] by ' + CLAIMER + ' ('), 'the claimed ask is not named with who claimed it:\n' + r.text);
  // The claimer's own list: its own claim is no answer, so the ask stays listed for it.
  const c = await room(pid, CLAIMER, '&unanswered=1');
  assert.ok(listed(c.text, ask), 'the claimer lost the ask it claimed and has not answered:\n' + c.text);
  assert.ok(!c.text.includes(CLAIMED), 'the claimer is told its own claim is someone else\'s:\n' + c.text);
});

test('kosmos#7848: a claim by an agent the post did not ask does not answer for me', async () => {
  const pid = newRoom('Claimed7848b');
  const ask = post(pid, { text: '@readerseat @claimseat which form?', mentioned: [ME, CLAIMER] });
  claim(pid, ask, BYSTANDER);
  const r = await room(pid, ME, '&unanswered=1');
  assert.ok(listed(r.text, ask), 'a bystander\'s claim took the ask off my list:\n' + r.text);
  assert.ok(!r.text.includes(CLAIMED), 'a bystander\'s claim is reported as handled:\n' + r.text);
});

test('kosmos#7848: a claim taken back puts the ask back; a later post that names me again is listed', async () => {
  const pid = newRoom('Claimed7848c');
  const ask = post(pid, { text: '@readerseat @claimseat the invoice?', mentioned: [ME, CLAIMER] });
  claim(pid, ask, CLAIMER);
  const again = post(pid, { text: '@readerseat can you take the invoice after all?', mentioned: [ME], to: [ME] });
  let r = await room(pid, ME, '&unanswered=1');
  assert.ok(!listed(r.text, ask), 'fixture: the claimed ask should be off my list:\n' + r.text);
  assert.ok(listed(r.text, again), 'a later post naming me again is not listed:\n' + r.text);
  claim(pid, ask, CLAIMER, 'remove');
  r = await room(pid, ME, '&unanswered=1');
  assert.ok(listed(r.text, ask), 'a claim taken back left the ask off my list:\n' + r.text);
  assert.ok(!r.text.includes(CLAIMED), 'a claim taken back is still reported:\n' + r.text);
});

test('kosmos#7848: the person\'s ask that reached both of us, claimed by the other, leaves my list too', async () => {
  const pid = newRoom('Claimed7848d');
  const ask = post(pid, { from: 'operator', operator: true, to: [ME, CLAIMER], text: 'Can one of you look at the lease?', outcomes: { [ME]: 'delivered', [CLAIMER]: 'delivered' } });
  let r = await room(pid, ME, '&unanswered=1');
  assert.ok(r.text.includes('[' + ask + ']'), 'fixture: the person\'s ask is not waiting on me:\n' + r.text);
  claim(pid, ask, CLAIMER);
  r = await room(pid, ME, '&unanswered=1');
  assert.ok(!r.text.split('\n').some((l) => / \[m\d+\] operator /.test(l) && l.includes('[' + ask + ']')), 'the person\'s claimed ask is still listed (review 1):\n' + r.text);
  assert.ok(r.text.includes(CLAIMED + '[' + ask + '] by ' + CLAIMER), 'the person\'s claimed ask is not named:\n' + r.text);
  assert.match(r.text, /^Waiting on an answer from you: nothing waiting on you in this room; the ask below is claimed by another agent it also asked\.$/m, 'all claimed: the head line is wrong:\n' + r.text);
});

test('kosmos#7848 review 1: the person naming only me, or an agent the post could not reach, does not make another claim answer for me', async () => {
  const pid = newRoom('Claimed7848e');
  const named = post(pid, { from: 'operator', operator: true, to: [ME, CLAIMER], text: '@readerseat please check the lease', mentioned: [ME], outcomes: { [ME]: 'delivered', [CLAIMER]: 'delivered' } });
  const unreached = post(pid, { from: 'operator', operator: true, to: [ME, CLAIMER], text: 'Could someone check the deposit?', outcomes: { [ME]: 'delivered', [CLAIMER]: 'could_not' } });
  claim(pid, named, CLAIMER);
  claim(pid, unreached, CLAIMER);
  const r = await room(pid, ME, '&unanswered=1');
  assert.ok(!r.text.includes(CLAIMED), 'a claim by an agent the post did not ask answered for me:\n' + r.text);
  assert.match(r.text, /^Waiting on an answer from you: 2 posts in this room/m, r.text);
});

test('kosmos#7848 review 1: a claimant no longer on the project does not take the ask off my list', async () => {
  const pid = newRoom('Claimed7848f');
  const ask = post(pid, { text: '@readerseat @claimseat who files it?', mentioned: [ME, CLAIMER] });
  claim(pid, ask, CLAIMER);
  let r = await room(pid, ME, '&unanswered=1');
  assert.ok(!listed(r.text, ask), 'fixture: the claim should take it off while the claimer is a member:\n' + r.text);
  projects.removeAgent(pid, CLAIMER);
  r = await room(pid, ME, '&unanswered=1');
  assert.ok(listed(r.text, ask), 'a claim by an agent that left the project still hides the ask:\n' + r.text);
});

test('kosmos#7848 review 1: with -n, the count leaves claimed asks out and the claimed line is capped too', async () => {
  const pid = newRoom('Claimed7848g');
  const claimed = [];
  for (let i = 0; i < 3; i++) { const id = post(pid, { text: '@readerseat @claimseat item ' + i, mentioned: [ME, CLAIMER] }); claimed.push(id); claim(pid, id, CLAIMER); }
  const open = [];
  for (let i = 0; i < 3; i++) open.push(post(pid, { text: '@readerseat open ' + i, mentioned: [ME] }));
  const r = await room(pid, ME, '&unanswered=1&n=2');
  assert.match(r.text, /^Waiting on an answer from you: 3 posts in this room .*; the newest 2 are below:$/m, 'the count includes claimed asks or the cap is wrong:\n' + r.text);
  assert.ok(listed(r.text, open[1]) && listed(r.text, open[2]) && !listed(r.text, open[0]), 'the newest two open asks are not the ones listed:\n' + r.text);
  const line = r.text.split('\n').find((l) => l.startsWith(CLAIMED)) || '';
  assert.ok(line.includes('[' + claimed[1] + ']') && line.includes('[' + claimed[2] + ']') && !line.includes('[' + claimed[0] + ']') && line.endsWith(', and 1 older.'), 'the claimed line is not capped at -n with how many more:\n' + r.text);
});

test('kosmos#7848 review 3: a claimed ask stays held for my idle reminder (a claim can go; a dropped reminder cannot come back)', async () => {
  const roomhold = require('./engine/roomhold');
  const pid = newRoom('Claimed7848h');
  const ask = post(pid, { text: '@readerseat @claimseat the survey?', mentioned: [ME, CLAIMER] });
  const open = post(pid, { text: '@readerseat the map?', mentioned: [ME] });
  claim(pid, ask, CLAIMER);
  roomhold.hold(ME, pid, roomhold.addressedId(ask));   // the form an ask is held in
  roomhold.hold(ME, pid, open);
  const r = await room(pid, ME, '&unanswered=1');
  assert.ok(r.text.includes(CLAIMED + '[' + ask + ']'), 'fixture: the claimed ask should be named:\n' + r.text);
  const left = roomhold.heldIn(ME, pid).join(' ');
  assert.ok(left.includes(ask), 'a claimed ask was dropped from my idle reminder hold: ' + left);
  assert.ok(!left.includes(open), 'CONTROL: the listed (shown) ask should leave the hold as before: ' + left);
});

test('kosmos#7848 review 4: several asks, all claimed, get the plural head line', async () => {
  const pid = newRoom('Claimed7848i');
  for (let i = 0; i < 2; i++) { const id = post(pid, { text: '@readerseat @claimseat part ' + i, mentioned: [ME, CLAIMER] }); claim(pid, id, CLAIMER); }
  const r = await room(pid, ME, '&unanswered=1');
  assert.match(r.text, /^Waiting on an answer from you: nothing waiting on you in this room; the asks named below are claimed by agents they also asked\.$/m, r.text);
});

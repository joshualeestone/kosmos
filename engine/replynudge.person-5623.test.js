'use strict';
/**
 * kosmos#5623 (Josh, 2026-10-08 17:20): a person who replies to an agent's community post gets an answer. A PERSON's comment
 * is a must-answer: counted sooner, told first and alone, outside the hourly limit, told again until the agent's own
 * reply appears in the thread, then recorded as an unanswered person. Driven through injections (no pane, no service).
 *
 *   node --test engine/replynudge.person-5623.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-person5623-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const rn = require('./replynudge');
const cr = require('./communityread');
const fleet = require('../test-support/fleet');
const BOARD = fleet.install(['kim', 'ann', 'bo', 'cy', 'di'].map((n) => fleet.agent(n, { state: 'idle' })));
test.after(() => BOARD.restore());

const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const card = (name) => Object.assign({}, BOARD.agents.find((a) => a.sessionName === name));
const POST = 'a1000000-0000-4000-8000-000000000001';
const PC = 'c1000000-0000-4000-8000-000000000001';   // a person's comment
const person = (over) => ({ remoteId: POST, title: 'Shipping notes', id: PC, author: 'Dana', parent: '', ...(over || {}) });

/* communityread's thread shape: what commentOf returns. */
const cm = (id, who, ts, over) => ({ id, author: who, nameKey: who.toLowerCase(), person: false, ts, replies: [], ...(over || {}) });

test('#5623 personOwed: a person\'s comment on the post is owed until the agent replies under it', () => {
  const top = cm(PC, 'Dana', 10, { person: true });
  assert.deepEqual(cr.personOwed([top], 'kim').map((o) => o.x.id), [PC]);
  top.replies = [cm('r1', 'Kim', 20)];
  assert.deepEqual(cr.personOwed([top], 'kim'), [], 'the agent\'s own reply should answer it');
  top.replies = [cm('r1', 'Bo', 20)];
  assert.deepEqual(cr.personOwed([top], 'kim').length, 1, 'another agent\'s reply should not answer it');
  assert.deepEqual(cr.personOwed([cm('a1', 'Bo', 10)], 'kim'), [], 'an AGENT\'s comment was taken for a person\'s');
});

test('#5623 personOwed: a person\'s reply under the agent\'s OWN comment is owed until a LATER reply of the agent\'s', () => {
  const own = cm('o1', 'Kim', 10, { replies: [cm('pr', 'Dana', 20, { person: true })] });
  assert.deepEqual(cr.personOwed([own], 'kim').map((o) => [o.x.id, o.parent]), [['pr', 'o1']]);
  own.replies.push(cm('k1', 'Kim', 15, { replyToKey: 'dana' }));
  assert.equal(cr.personOwed([own], 'kim').length, 1, 'an EARLIER reply of the agent\'s counted as the answer');
  own.replies.push(cm('k2', 'Kim', 30, { replyToKey: 'dana' }));
  assert.deepEqual(cr.personOwed([own], 'kim'), []);
  const theirs = cm('b1', 'Bo', 10, { replies: [cm('pr2', 'Dana', 20, { person: true })] });
  assert.deepEqual(cr.personOwed([theirs], 'kim'), [], 'a person answering ANOTHER agent was owed by this one');
});

test('#5623 commentOf keeps the service\'s person kind and whom a reply answers', () => {
  const c = (kind) => ({ id: PC, state: 'live', body: 'hi', created_at: '2026-10-08T10:00:00Z', reply_to_name: 'Kim', agent: { name: 'Dana', kind } });
  assert.equal(cr.commentOf(c('person')).person, true);
  assert.equal(cr.commentOf(c('agent')).person, false);
  assert.equal(cr.commentOf(c('person')).replyToKey, 'kim');
});

test('#5623 review 1: a thread not wholly visible owes nothing this pass (an unseen answer must not read as none)', () => {
  const top = cm(PC, 'Dana', 10, { person: true, replyCount: 3, replies: [cm('b1', 'Bo', 11), cm('c1', 'Cy', 12)] });
  assert.deepEqual(cr.personOwed([top], 'kim'), [], 'owed while a third reply (perhaps the answer) was not in hand');
  top.replyCount = 2;
  assert.equal(cr.personOwed([top], 'kim').length, 1, 'a wholly visible thread with no answer owed nothing');
});

test('#5623 review 1: a person\'s follow-up in their own thread, addressed to the agent, is owed', () => {
  const top = cm(PC, 'Dana', 10, { person: true, replies: [cm('k1', 'Kim', 20), cm('f1', 'Dana', 30, { person: true, replyToKey: 'kim' })] });
  assert.deepEqual(cr.personOwed([top], 'kim').map((o) => o.x.id), ['f1']);
  top.replies.push(cm('k2', 'Kim', 40, { replyToKey: 'dana' }));
  assert.deepEqual(cr.personOwed([top], 'kim'), []);
  const toBo = cm(PC, 'Dana', 10, { person: true, replies: [cm('k1', 'Kim', 20), cm('f2', 'Dana', 30, { person: true, replyToKey: 'bo' })] });
  assert.deepEqual(cr.personOwed([toBo], 'kim'), [], 'a follow-up addressed to someone else was owed by this agent');
  // Review 2: a person answering the agent inside ANOTHER agent's thread is owed too (reply_to names the agent).
  const bos = cm('b1', 'Bo', 10, { replies: [cm('k1', 'Kim', 20), cm('p3', 'Dana', 30, { person: true, replyToKey: 'kim' })] });
  assert.deepEqual(cr.personOwed([bos], 'kim').map((o) => o.x.id), ['p3']);
  // personOwed reports the person comments it saw answered: the only evidence that clears a record.
  const answered = [];
  const done = cm(PC, 'Dana', 10, { person: true, replies: [cm('k9', 'Kim', 20)] });
  cr.personOwed([done], 'kim', answered);
  assert.deepEqual(answered, [PC]);
});

test('#5623 personsUpdate: told first, again after PERSON_RETELL_MS, then unanswered after PERSON_TELLS; answered goes', () => {
  const t0 = 1_000_000_000_000;
  let u = rn.personsUpdate({}, [person()], t0);
  assert.deepEqual(u.due.map((d) => d.id), [PC], 'a new person comment should be due');
  const told = (rec, at) => { rec[PC] = { ...rec[PC], told: [...(rec[PC].told || []), at] }; return rec; };
  let rec = told(u.owed, t0);
  u = rn.personsUpdate(rec, [person()], t0 + 10 * 60 * 1000);
  assert.deepEqual(u.due, [], 'told again before PERSON_RETELL_MS');
  let at = t0;
  for (let i = 1; i < rn.PERSON_TELLS; i += 1) {
    at += rn.PERSON_RETELL_MS;
    u = rn.personsUpdate(rec, [person()], at);
    assert.deepEqual(u.due.map((d) => d.id), [PC], 'not told again after PERSON_RETELL_MS (tell ' + (i + 1) + ')');
    rec = told(u.owed, at);
  }
  u = rn.personsUpdate(rec, [person()], at + rn.PERSON_RETELL_MS);
  assert.deepEqual(u.unanswered, [PC], 'not recorded unanswered after PERSON_TELLS tells');
  assert.deepEqual(u.due, [], 'still told after it was given up on');
  assert.equal(u.owed[PC].unanswered, true);
  // Review 2: gone from the count is UNKNOWN (a post unreadable this pass): kept, told history and all.
  assert.ok(rn.personsUpdate(u.owed, [], at + rn.PERSON_RETELL_MS + 1).owed[PC], 'an entry the count did not see was dropped');
  // Seen answered (positive evidence): the record drops it, unanswered or not.
  assert.deepEqual(rn.personsUpdate(u.owed, [], at + rn.PERSON_RETELL_MS + 1, [PC]).owed, {});
  // Review 3: unseen for PERSONS_KEPT_MS after it was last seen, it is dropped; before that it is kept.
  const old = { [PC]: { ...u.owed[PC], lastSeen: at } };
  assert.ok(rn.personsUpdate(old, [], at + rn.PERSONS_KEPT_MS - 1).owed[PC], 'dropped before PERSONS_KEPT_MS');
  assert.equal(rn.personsUpdate(old, [], at + rn.PERSONS_KEPT_MS).owed[PC], undefined, 'kept past PERSONS_KEPT_MS');
});

/* A pass: in-memory told and person stores, a recording deliver. */
function rig(over) {
  const told = new Map();
  const persons = new Map();
  const typed = [];
  const o = Object.assign({
    roster: [card('kim')], projects: [], book: new Map(), sent: [], limit: { on: true, perHour: 20 }, betweenAgentsMs: 0, typeGapMs: 0, busyWaitMs: 0,
    fresh: async () => ({ ok: true, posts: [{ remoteId: POST, title: 'Shipping notes', ids: ['r1'] }], persons: [person()] }),
    readNudged: (s) => new Set(told.get(s) || []), writeNudged: (s, set) => { told.set(s, [...set]); return true; },
    readPersons: (s) => ({ ...(persons.get(s) || {}) }), writePersons: (s, owed) => { persons.set(s, JSON.parse(JSON.stringify(owed))); return true; },
    deliver: (s, text) => { typed.push({ s, text }); return { state: D.PLACED }; }, DELIVERY: D,
  }, over || {});
  return { o, told, persons, typed };
}

test('#5623 a person waiting gets their own line first, naming the post and the comment, and the regular line waits', async () => {
  const { o, typed, told } = rig();
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'two lines were typed into one agent in one pass');
  assert.match(typed[0].text, /a person, not an agent, replied to you on your community post 'Shipping notes' and is waiting/);
  assert.doesNotMatch(typed[0].text, /Dana/, 'the person\'s own name was typed into a Kosmos line');
  assert.ok(typed[0].text.includes('kosmos community comment ' + POST + ' --reply-to ' + PC), typed[0].text);
  assert.deepEqual(told.get('kim'), [PC], 'the regular comments were recorded as told without a line, or the person\'s comment was not');
});

test('#5623 a person\'s line takes no slot of the hourly limit, and is typed even when the limit is reached', async () => {
  const { o, typed } = rig({ limit: { on: true, perHour: 1 }, sent: [Date.now()] });
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1, 'the hourly limit held a person\'s line');
  assert.equal(o.sent.length, 1, 'a person\'s line took a slot of the hourly limit');
});

test('#5623 a person\'s line that reached nothing is not counted as a tell (it is tried again next pass)', async () => {
  const { o, persons, typed } = rig({ deliver: (s, text) => { typed.push(text); return { state: D.COULD_NOT }; } });
  await rn.sweepOnce(o);
  assert.deepEqual(persons.get('kim')[PC].told, [], 'a line that reached nothing was recorded as a tell');
  await rn.sweepOnce(o);
  assert.equal(typed.length, 2, 'it was not tried again');
});

test('#5623 an unreadable person record skips the persons for that agent (the regular line still goes)', async () => {
  const { o, typed } = rig({ readPersons: () => null });
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1);
  assert.doesNotMatch(typed[0].text, /a person, not an agent/);
});

test('#5623 a person is counted after PERSON_IDLE_MS idle; the regular comments still wait IDLE_FIRST_MS', async () => {
  const now = Date.now();
  const { o, typed } = rig({ idleSince: () => now - rn.PERSON_IDLE_MS - 1000, clock: () => now });
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1);
  assert.match(typed[0].text, /a person, not an agent/);
  const r2 = rig({ idleSince: () => now - rn.PERSON_IDLE_MS - 1000, clock: () => now,
    fresh: async () => ({ ok: true, posts: [{ remoteId: POST, title: 'Shipping notes', ids: ['r1'] }], persons: [] }) });
  await rn.sweepOnce(r2.o);
  assert.equal(r2.typed.length, 0, 'a regular line went after only PERSON_IDLE_MS');
});

test('#5623 the read marks a person\'s comment the agent owes', () => {
  assert.match(cr.PERSON_OWED, /a person wrote this, so it IS owed an answer even when marked under comment/);
});

test('#5623 review 1: once per comment: a person\'s top comment told on the person line is not named again by the regular line', async () => {
  const { o, typed } = rig({ fresh: async () => ({ ok: true, posts: [{ remoteId: POST, title: 'Shipping notes', ids: [PC, 'r1'] }], persons: [person()] }) });
  await rn.sweepOnce(o);
  o.fresh = async () => ({ ok: true, posts: [{ remoteId: POST, title: 'Shipping notes', ids: [PC, 'r1'] }], persons: [] });
  await rn.sweepOnce(o);
  assert.equal(typed.length, 2);
  assert.match(typed[1].text, /you have 1 new comment on/, 'the regular line named the person\'s comment again');
});

test('#5623 review 2: a re-tell says the person is still waiting', () => {
  assert.match(rn.personText([{ ...person(), again: true }]), /and is still waiting for your answer/);
  assert.match(rn.personText([person()]), /and is waiting for your answer/);
});

test('#5623 review 3: a person who took the agent\'s own name is not its answer', () => {
  const top = cm(PC, 'Dana', 10, { person: true, replies: [cm('x1', 'Kim', 20, { person: true })] });
  assert.deepEqual(cr.personOwed([top], 'kim').map((o) => o.x.id).sort(), [PC], 'a person named like the agent answered for it');
});

test('#5623 review 3: a person line that keeps reaching nothing rests after MAX_TRIES, and the regular line goes', async () => {
  let n = 0;
  const { o, typed } = rig({ deliver: (s, text) => { typed.push(text); n += 1; return { state: n <= rn.MAX_TRIES ? D.COULD_NOT : D.PLACED }; } });
  for (let i = 0; i < rn.MAX_TRIES + 1; i += 1) await rn.sweepOnce(o);
  assert.equal(typed.filter((t) => /a person, not an agent/.test(t)).length, rn.MAX_TRIES, 'the person line was not rested after MAX_TRIES');
  assert.match(typed[typed.length - 1], /new comment/, 'the regular line was still held off');
});

test('#5623 review 4: an answer in the same second (or with an unreadable time) still counts, by its place in the thread', () => {
  const same = cm(PC, 'Dana', 10, { person: true, replies: [cm('k1', 'Kim', 10)] });
  assert.deepEqual(cr.personOwed([same], 'kim'), [], 'a same-second answer did not count');
  const own = cm('o1', 'Kim', 5, { replies: [cm('pr', 'Dana', 20, { person: true }), cm('k2', 'Kim', 0, { replyToKey: 'dana' })] });
  assert.deepEqual(cr.personOwed([own], 'kim'), [], 'a later answer with no readable time did not count');
});

test('#5623 review 4: a person answering someone else under the agent\'s own comment is not owed by the agent', () => {
  const own = cm('o1', 'Kim', 5, { replies: [cm('pr', 'Dana', 20, { person: true, replyToKey: 'bo' })] });
  assert.deepEqual(cr.personOwed([own], 'kim'), []);
  own.replies[0].replyToKey = '';
  assert.equal(cr.personOwed([own], 'kim').length, 1, 'an unaddressed person reply under its own comment was not owed');
});

test('#5623 review 5: the agent\'s later reply answers a person only when it is addressed to them', () => {
  const own = cm('o1', 'Kim', 5, { replies: [cm('p1', 'Dana', 10, { person: true }), cm('p2', 'Eli', 20, { person: true }), cm('k3', 'Kim', 30, { replyToKey: 'eli' })] });
  assert.deepEqual(cr.personOwed([own], 'kim').map((o) => o.x.id), ['p1'], 'answering Eli counted as answering Dana');
  const top = cm(PC, 'Dana', 10, { person: true, replies: [cm('b1', 'Bo', 15), cm('k4', 'Kim', 20, { replyToKey: 'bo' })] });
  assert.deepEqual(cr.personOwed([top], 'kim').map((o) => o.x.id), [PC], 'answering another agent in her thread counted as answering her');
});

test('#5623 review 13: every tell, first or again, says to do nothing if the agent already answered', () => {
  for (const due of [[{ remoteId: POST, title: 'x', id: PC }], [{ remoteId: POST, id: PC, again: true }, { remoteId: POST, id: 'c2' }]]) {
    assert.match(rn.personText(due), /If you already answered them there, do nothing\./, JSON.stringify(due));
  }
});

test('#5623 review 13: the person line\'s rest survives the regular line, and a busy retry does not restart it', async () => {
  let n = 0; let now = 1e12;
  const { o, typed } = rig({ clock: () => now, deliver: (s, text) => { typed.push(text); n += 1; return { state: n <= rn.MAX_TRIES ? D.COULD_NOT : D.PLACED }; } });
  for (let i = 0; i < rn.MAX_TRIES + 1; i += 1) await rn.sweepOnce(o);
  const b = o.book.get('kim') || {};
  assert.ok(b.personFails >= rn.MAX_TRIES && Number.isFinite(b.personGivenAt), 'the regular line wiped the person line\'s rest: ' + JSON.stringify(b));
  const given = b.personGivenAt;
  now += rn.GIVE_UP_FOR_MS + 1;
  o.deliver = (s, text) => { typed.push(text); return { state: D.COULD_NOT, busy: true }; };
  await rn.sweepOnce(o);
  assert.equal(o.book.get('kim').personGivenAt, given, 'a busy pane on the retry restarted the rest');
});

test('#5623 review 15: a person continuing their own answered thread with a direct reply is owed, until a later direct answer', () => {
  const top = cm(PC, 'Dana', 10, { person: true, replies: [cm('k1', 'Kim', 20), cm('p2', 'Dana', 30, { person: true })] });
  assert.deepEqual(cr.personOwed([top], 'kim').map((o) => o.x.id), ['p2'], 'her follow-up after the agent answered was not owed');
  top.replies.push(cm('k2', 'Kim', 40));
  assert.deepEqual(cr.personOwed([top], 'kim'), [], 'a later direct answer did not count');
  const before = cm(PC, 'Dana', 10, { person: true, replies: [cm('p2', 'Dana', 15, { person: true }), cm('b1', 'Bo', 20)] });
  assert.deepEqual(cr.personOwed([before], 'kim').map((o) => o.x.id), [PC], 'a follow-up before the agent ever answered was owed twice');
});

test('#5623 review 15: past a full cap, persons-only reads take a round of 3 a pass and close it at the end of the roster', async () => {
  const names = ['kim', 'ann', 'bo', 'cy', 'di'];
  const reads = [];
  const rotation = {};
  const { o } = rig({ roster: names.map(card), rotation, limit: { on: true, perHour: 1 }, sent: [Date.now()],
    fresh: async (s) => { reads.push(s); return { ok: true, posts: [], persons: [] }; } });
  await rn.sweepOnce(o);
  const p1 = reads.splice(0);
  await rn.sweepOnce(o);
  const p2 = reads.splice(0);
  await rn.sweepOnce(o);
  const p3 = reads.splice(0);
  assert.equal(p1.length, 3, 'pass 1 read ' + p1.length + ' past the cap');
  assert.equal(new Set(p1.concat(p2)).size, p1.length + p2.length, 'pass 2 re-read an agent of this round: ' + p2);
  assert.equal(p2.length, 2, 'pass 2 did not read the rest of the roster: ' + p2);
  assert.deepEqual(p3, p1, 'the round did not close at the end of the roster, so pass 3 did not start a fresh one');
});

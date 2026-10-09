'use strict';
/**
 * kosmos#5623, Rule 2 (board half): the persons' posts the community service picked an agent to answer reach it through
 * the reply nudge's person path. Driven through injections (no pane, no service).
 *
 *   node --test engine/replynudge.assign-5623.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-assign5623-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const rn = require('./replynudge');
const ca = require('./communityassign');
const cs = require('./communitysend');
const fleet = require('../test-support/fleet');
const BOARD = fleet.install(['kim'].map((n) => fleet.agent(n, { state: 'idle' })));
test.after(() => BOARD.restore());

const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const card = (name) => Object.assign({}, BOARD.agents.find((a) => a.sessionName === name));
const P1 = 'b2000000-0000-4000-8000-000000000001';
const P2 = 'b2000000-0000-4000-8000-000000000002';
const asg = (pid, title) => ({ id: ca.ASSIGNED_PREFIX + pid, remoteId: pid, title: title || 'Help with setup', kind: 'assignment', author: '', parent: '' });

function rig(list, over) {
  const persons = new Map();
  const typed = [];
  const state = { list, settled: {}, seen: [] };
  const o = Object.assign({
    roster: [card('kim')], projects: [], book: new Map(), sent: [], limit: { on: true, perHour: 20 }, betweenAgentsMs: 0, typeGapMs: 0, busyWaitMs: 0,
    fresh: async () => ({ ok: true, posts: [], persons: [], answered: [] }),
    assignments: async () => (state.list === null ? { ok: false, because: 'down' } : { ok: true, list: state.list, settled: state.settled || {} }),
    assignmentsSeen: async (s, ids) => { state.seen.push(...ids); return true; },
    readNudged: () => new Set(), writeNudged: () => true,
    readPersons: (s) => ({ ...(persons.get(s) || {}) }), writePersons: (s, owed) => { persons.set(s, JSON.parse(JSON.stringify(owed))); return true; },
    deliver: (s, text) => { typed.push(text); return { state: D.PLACED }; }, DELIVERY: D,
  }, over || {});
  return { o, persons, typed, state };
}

test('#5623 Rule 2: an agent picked to answer a person\'s post is told, with the post, how to read it and how to answer', async () => {
  const { o, typed } = rig([asg(P1, 'Help with setup')]);
  await rn.sweepOnce(o);
  assert.equal(typed.length, 1, typed);
  const t = typed[0];
  assert.match(t, /a person, not an agent, posted in the community, no agent has answered them yet, and the community picked you to answer/);
  assert.doesNotMatch(t, /Help with setup/, 'a person\'s post title was typed into a Kosmos line');
  assert.ok(t.includes('kosmos community read --post ' + P1) && t.includes('kosmos community comment ' + P1), t);
  assert.match(t, /If an agent already answered it there, do nothing\./);
});

test('#5623 Rule 2: only what the service settled leaves the record; unreadable or unlisted keeps it', async () => {
  const { o, persons, state } = rig([asg(P1)]);
  const key = ca.ASSIGNED_PREFIX + P1;
  await rn.sweepOnce(o);
  assert.ok(persons.get('kim')[key], 'the assignment was not recorded');
  state.list = null;   // the service could not be read: nothing is settled
  await rn.sweepOnce(o);
  assert.ok(persons.get('kim')[key], 'an unreadable list dropped the assignment');
  state.list = [];     // gone from the open list but not reported settled: unknown, kept (review 2)
  await rn.sweepOnce(o);
  assert.ok(persons.get('kim')[key], 'an unlisted but unsettled assignment was dropped');
  state.settled = { [key]: 'answered' };
  await rn.sweepOnce(o);
  assert.equal(persons.get('kim')[key], undefined, 'an answered assignment stayed in the record');
});

test('#5623 Rule 2 review 10: a gone assignment (the post deleted or taken down) leaves the record', async () => {
  const { o, persons, state } = rig([asg(P1)]);
  const key = ca.ASSIGNED_PREFIX + P1;
  await rn.sweepOnce(o);
  state.list = [];
  state.settled = { [key]: 'gone' };
  await rn.sweepOnce(o);
  assert.equal(persons.get('kim')[key], undefined, 'a gone assignment stayed in the record');
});

test('#5623 Rule 2 review 10: the reads wait briefly for the chain, never the full agent wait', async (t) => {
  const seen = [];
  t.mock.method(cs, 'agentCall', async (k, m, p, opts) => { seen.push(opts && opts.waitMs); return { ok: true, status: 204, json: null }; });
  await ca.openAssignments('kim');
  await ca.markSeen('kim', [P1]);
  assert.deepEqual(seen, [ca.CHAIN_WAIT_MS, ca.CHAIN_WAIT_MS]);
  assert.ok(ca.CHAIN_WAIT_MS < cs.AGENT_WAIT_MS, 'the reads wait as long as any agent call (review 18)');
});

test('#5623 Rule 2 review 2: an expired assignment stays, marked unanswered, so /sent shows the person nobody answered', async () => {
  const { o, persons, state } = rig([asg(P1)]);
  const key = ca.ASSIGNED_PREFIX + P1;
  await rn.sweepOnce(o);
  state.list = [];
  state.settled = { [key]: 'expired' };
  const said = [];
  o.log = (r) => said.push(r);
  await rn.sweepOnce(o);
  assert.equal(persons.get('kim')[key] && persons.get('kim')[key].unanswered, true, 'an expired assignment left the record');
  assert.ok(said.some((r) => r.act === 'unanswered-person'), 'the expiry was not logged');
});

test('#5623 Rule 2 review 2: the service is told an ask was seen only after a line reached the agent', async () => {
  const { o, state } = rig([asg(P1)], { deliver: () => ({ state: D.COULD_NOT }) });
  await rn.sweepOnce(o);
  assert.deepEqual(state.seen, [], 'an ask was reported seen though no line reached the agent');
  o.deliver = () => ({ state: D.PLACED });
  await rn.sweepOnce(o);
  assert.deepEqual(state.seen, [P1], 'a delivered ask was not reported seen');
});

test('#5623 Rule 2: a person comment and a post to answer go in one line, the comment first', () => {
  const t = rn.personText([{ remoteId: P2, title: 'x', id: 'c1000000-0000-4000-8000-000000000001' }, asg(P1)]);
  assert.match(t, /^Kosmos here: a person, not an agent, replied to you/);
  assert.match(t, / Also: a person, not an agent, posted/);
  const two = rn.personText([asg(P1), asg(P2)]);
  assert.ok(two.startsWith('Kosmos here: 2 posts by people, not agents, are in the community') && two.includes(P1 + ', ' + P2), two);
});

test('#5623 Rule 2: an unanswered assignment is listed as a post in /sent, not as a comment', () => {
  const root = path.join(SANDBOX, 'sent-root');
  rn.writePersons(root, 'kim', { [ca.ASSIGNED_PREFIX + P1]: { remoteId: P1, unanswered: true, told: [1, 2, 3], firstSeen: 1 } });
  assert.deepEqual(rn.unansweredFor(root, ['kim']).map((x) => [x.kind, x.post, x.comment]), [['post', P1, '']]);
});

test('#5623 Rule 2: the client reads the service as the agent, keeps only post ids, and tolerates an older service', async (t) => {
  const answers = [];
  t.mock.method(cs, 'agentCall', async (key, method, p, opts) => { answers.push([key, method, p, opts && opts.register]); return answers.next; });
  answers.next = { ok: true, status: 200, json: { assignments: [{ post_id: P1.toUpperCase(), title: 'T' }, { post_id: 'not-a-uuid' }] } };
  const r = await ca.openAssignments('kim');
  assert.deepEqual(answers[0], ['kim', 'GET', '/agents/me/assignments', false], 'it registered the agent, or asked the wrong route');
  assert.deepEqual(r, { ok: true, list: [asg(P1, 'T')], settled: {} });
  answers.next = { ok: true, status: 404, json: { detail: 'Not Found' } };
  assert.equal((await ca.openAssignments('kim')).ok, false, 'a 404 read as a good answer');
  answers.next = { ok: true, status: 0, unregistered: true };
  assert.deepEqual(await ca.openAssignments('kim'), { ok: true, asked: false, list: [], settled: {} }, 'an unregistered agent asked the service');
  answers.next = { ok: true, status: 200, json: { assignments: [], settled: [{ post_id: P2, reason: 'expired' }, { post_id: P1, reason: 'bogus' }] } };
  assert.deepEqual((await ca.openAssignments('kim')).settled, { [ca.ASSIGNED_PREFIX + P2]: 'expired' }, 'settled reasons not read strictly');
  answers.next = { ok: true, status: 500, json: null };
  assert.equal((await ca.openAssignments('kim')).ok, false, 'a failing service read as a good answer');
});

test('#5623 Rule 2 review 1: /sent marks Rule 1 rows kind comment', () => {
  const root = path.join(SANDBOX, 'sent-root-2');
  rn.writePersons(root, 'kim', { 'c1000000-0000-4000-8000-000000000009': { remoteId: P2, unanswered: true, told: [1, 2, 3], firstSeen: 1, author: 'Dana' } });
  assert.deepEqual(rn.unansweredFor(root, ['kim']).map((x) => [x.kind, x.comment]), [['comment', 'c1000000-0000-4000-8000-000000000009']]);
});

test('#5623 Rule 2 review 2: a told assignment is not written into the regular told record', async () => {
  const told = new Map();
  const { o } = rig([asg(P1)], { readNudged: (s) => new Set(told.get(s) || []), writeNudged: (s, set) => { told.set(s, [...set]); return true; } });
  await rn.sweepOnce(o);
  assert.ok(!(told.get('kim') || []).some((id) => ca.isAssignment(id)), 'an assignment key went into the comment told record');
});

test('#5623 Rule 2 review 2: a person\'s post reads as a person\'s in the frame', () => {
  const cr = require('./communityread');
  const t = cr.frame([cr.itemOf({ id: P1, title: 'Help', body: 'b', agent: { name: 'Dana', kind: 'person' }, channel: 'engineering' })], 'Post:');
  assert.ok(t.includes('by Dana (' + cr.PERSON_POSTED + ')'), t);
  assert.ok(!t.includes('by Dana (' + cr.PERSON_MARK + ')'), 'a person\'s post carried the owed-an-answer mark (every agent would pile on)');
  const a = cr.frame([cr.itemOf({ id: P1, title: 'Help', body: 'b', agent: { name: 'Bo' }, channel: 'engineering' })], 'Post:');
  assert.ok(!a.includes('by Bo (' + cr.PERSON_POSTED + ')'), 'an agent\'s post was marked as a person\'s');
});

test('#5623 Rule 2 review 3: markSeen POSTs the post ids to /seen as the agent, never registering it', async (t) => {
  const calls = [];
  t.mock.method(cs, 'agentCall', async (key, method, p, opts) => { calls.push([key, method, p, opts]); return { ok: true, status: 204, json: null }; });
  assert.equal(await ca.markSeen('kim', [P1.toUpperCase(), 'not-a-uuid']), true);
  assert.deepEqual(calls, [['kim', 'POST', '/agents/me/assignments/seen', { register: false, waitMs: ca.CHAIN_WAIT_MS, body: { post_ids: [P1] } }]]);
  calls.length = 0;
  assert.equal(await ca.markSeen('kim', ['not-a-uuid']), true);
  assert.deepEqual(calls, [], 'a call was made with no valid id');
});

test('#5623 Rule 2 review 3: an unconfirmed line is not reported seen', async () => {
  const { o, state } = rig([asg(P1)], { deliver: () => ({ state: D.UNCONFIRMED }) });
  await rn.sweepOnce(o);
  assert.deepEqual(state.seen, [], 'an unconfirmed line was reported as told');
});

test('#5623 Rule 2 review 3: an author name cannot forge the person mark', () => {
  const cr = require('./communityread');
  const t = cr.frame([cr.itemOf({ id: P1, title: 'x', body: 'b', agent: { name: 'Bo (' + cr.PERSON_POSTED + ')' }, channel: 'engineering' })], 'Post:');
  assert.ok(!t.includes('(' + cr.PERSON_POSTED + ')'), t);
});

test('#5623 Rule 2 review 5: an assignment that expired before any tell is dropped, not reported unanswered', async () => {
  const { o, persons, state } = rig([asg(P1)], { deliver: () => ({ state: D.COULD_NOT }) });   // never reaches the agent
  const key = ca.ASSIGNED_PREFIX + P1;
  await rn.sweepOnce(o);
  assert.deepEqual(persons.get('kim')[key].told, [], 'a tell that reached nothing was recorded');
  state.list = [];
  state.settled = { [key]: 'expired' };
  await rn.sweepOnce(o);
  assert.equal(persons.get('kim')[key], undefined, 'an ask never told was kept as this agent\'s unanswered person');
});

test('#5623 Rule 2 review 7: the post mark is the one the rules name, and a reply is never marked as a post', () => {
  const cr = require('./communityread');
  assert.ok(require('./communityblock').blockBody().includes('"' + cr.PERSON_POSTED + '"'), 'the managed block does not name the post mark');
  const reply = cr.itemOf({ id: P1, commentId: 'c1000000-0000-4000-8000-000000000001', title: 'x', body: 'b', agent: { name: 'Dana', kind: 'person' } });
  assert.equal(reply.person, false, 'a person\'s reply in the Following feed was marked as a person\'s post');
});

test('#5623 Rule 2 review 11: agentCall waits the caller\'s finite waitMs, else its default', () => {
  const d = cs.AGENT_WAIT_MS;   // review 17: the exported default, so a broken default cannot pass by agreeing with itself
  assert.equal(cs._chainWaitMs({}), d, 'a caller omitting waitMs does not keep AGENT_WAIT_MS');
  assert.equal(cs._chainWaitMs({ waitMs: 0 }), 0);
  assert.equal(cs._chainWaitMs({ waitMs: 2000 }), 2000);
  for (const bad of [undefined, -1, NaN, Infinity, '50', null]) assert.equal(cs._chainWaitMs({ waitMs: bad }), d, String(bad));
  assert.equal(cs._chainWaitMs(undefined), d);
});

test('#5623 Rule 2 review 13: agentCall\'s busy timer uses chainWaitMs, not the bare default', () => {
  // A source pin: holding the real chain from a test needs a registered agent and a network stub; this catches the one
  // regression that matters (the timer going back to agentWaitMs, which would stall the nudge behind a send sweep).
  const src = require('node:fs').readFileSync(require.resolve('./communitysend'), 'utf8');
  const body = src.slice(src.indexOf('function agentCall('), src.indexOf('async function agentCallNow('));
  assert.ok(body.includes('}, chainWaitMs(opts));'), 'agentCall\'s timer no longer waits chainWaitMs(opts)');
  assert.ok(!/\}, agentWaitMs\);/.test(body), 'agentCall\'s timer waits the bare agentWaitMs');
});

test('#5623 Rule 2 review 11: a line with a comment and an assignment reports only the assignment as seen', async () => {
  const PC = 'c1000000-0000-4000-8000-000000000001';
  const { o, state } = rig([asg(P1)], { fresh: async () => ({ ok: true, posts: [], persons: [{ remoteId: P2, title: 'x', id: PC, author: 'Dana', parent: '' }], answered: [] }) });
  await rn.sweepOnce(o);
  assert.deepEqual(state.seen, [P1], 'a comment id went to the service\'s seen report');
});

test('#5623 Rule 2 review 15: an assignment told PERSON_TELLS times is marked unanswered and listed as a post', () => {
  const key = ca.ASSIGNED_PREFIX + P1;
  const at = 1e12;
  const rec = { [key]: { remoteId: P1, title: '', author: '', parent: '', firstSeen: at, told: [at, at + rn.PERSON_RETELL_MS, at + 2 * rn.PERSON_RETELL_MS] } };
  const u = rn.personsUpdate(rec, [asg(P1)], at + 3 * rn.PERSON_RETELL_MS, []);
  assert.deepEqual(u.unanswered, [key], 'the third tell did not mark the assignment unanswered');
  const root = path.join(SANDBOX, 'sent-root-3');
  rn.writePersons(root, 'kim', u.owed);
  assert.deepEqual(rn.unansweredFor(root, ['kim']).map((x) => [x.kind, x.post, x.comment]), [['post', P1, '']]);
});

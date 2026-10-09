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
  const state = { list };
  const o = Object.assign({
    roster: [card('kim')], projects: [], book: new Map(), sent: [], limit: { on: true, perHour: 20 }, betweenAgentsMs: 0, typeGapMs: 0, busyWaitMs: 0,
    fresh: async () => ({ ok: true, posts: [], persons: [], answered: [] }),
    assignments: async () => (state.list === null ? { ok: false, because: 'down' } : { ok: true, list: state.list }),
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
  assert.match(t, /a person, not an agent, posted 'Help with setup' in the community, no agent has answered them yet, and the community picked you to answer/);
  assert.ok(t.includes('kosmos community read --post ' + P1) && t.includes('kosmos community comment ' + P1), t);
  assert.match(t, /If an agent already answered it there, do nothing\./);
});

test('#5623 Rule 2: an assignment the service no longer lists leaves the record; an unreadable list keeps it', async () => {
  const { o, persons, state } = rig([asg(P1)]);
  await rn.sweepOnce(o);
  assert.ok(persons.get('kim')[ca.ASSIGNED_PREFIX + P1], 'the assignment was not recorded');
  state.list = null;   // the service could not be read: nothing is settled
  await rn.sweepOnce(o);
  assert.ok(persons.get('kim')[ca.ASSIGNED_PREFIX + P1], 'an unreadable list dropped the assignment');
  state.list = [];     // the service no longer lists it: answered, expired or taken down
  await rn.sweepOnce(o);
  assert.equal(persons.get('kim')[ca.ASSIGNED_PREFIX + P1], undefined, 'a settled assignment stayed in the record');
});

test('#5623 Rule 2: a person comment and a post to answer go in one line, the comment first', () => {
  const t = rn.personText([{ remoteId: P2, title: 'x', id: 'c1000000-0000-4000-8000-000000000001' }, asg(P1)]);
  assert.match(t, /^Kosmos here: a person, not an agent, replied to you/);
  assert.match(t, / Also: a person, not an agent, posted/);
  const two = rn.personText([asg(P1), asg(P2)]);
  assert.ok(two.startsWith('Kosmos here: 2 people, not agents, posted') && two.includes(P1 + ', ' + P2), two);
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
  assert.deepEqual(r, { ok: true, list: [asg(P1, 'T')] });
  answers.next = { ok: true, status: 404, json: null };
  assert.deepEqual(await ca.openAssignments('kim'), { ok: true, list: [] }, 'a service without the route was an error');
  answers.next = { ok: true, status: 0, unregistered: true };
  assert.deepEqual(await ca.openAssignments('kim'), { ok: true, list: [] });
  answers.next = { ok: true, status: 500, json: null };
  assert.equal((await ca.openAssignments('kim')).ok, false, 'a failing service read as nothing assigned (it would settle every assignment)');
});

'use strict';
/* kosmos#4926 N7 (still on 0.7.50, the Meta seat only): a post told to a member at its turn end "again as new" after it
   answered it. Two causes fit, and the board log could tell neither: the member answered without citing the post (so
   staleHeld never counts it answered), or something else re-told it. This diagnostic lists, on every line that tells a
   held post (or could not, or may have), the member's own later posts in that room by id and what each replies to. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'roomhold-n7diag-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
const messages = require('./messages');
const roomhold = require('./roomhold');
const chat = require('./chat');

const P = 'proj-1';
const at = (m) => new Date(Date.UTC(2026, 9, 15, 12, m)).toISOString();
const LOG = [
  { kind: 'post', id: 'm1', project: P, from: 'ann', at: at(0), text: 'one' },
  { kind: 'post', id: 'm2', project: P, from: 'bob', at: at(1), text: 'two' },
  { kind: 'post', id: 'm3', project: P, from: 'ann', at: at(2), text: 'three' },
  { kind: 'post', id: 'm4', project: P, from: 'meta', at: at(3), text: 'answers m2', replyTo: 'm2' },
  { kind: 'post', id: 'm5', project: P, from: 'meta', at: at(4), text: 'a reply with no citation' },
  { kind: 'post', id: 'm6', project: P, from: 'ann', at: at(5), text: 'after meta spoke' },
  { kind: 'post', id: 'm9', project: 'other', from: 'meta', at: at(6), text: 'another room' },
];

test('#4926 N7: memberAfter lists the member\'s own later posts in that room, with what each replies to', () => {
  const got = messages.memberAfter(P, ['m1', 'm2', 'm3', 'm6', 'm404'], 'meta', LOG);
  assert.deepEqual(got, {
    m1: { after: [{ id: 'm4', cites: 'm2' }, { id: 'm5', cites: null }], total: 2 },
    m2: { after: [{ id: 'm4', cites: 'm2' }, { id: 'm5', cites: null }], total: 2 },
    m3: { after: [{ id: 'm4', cites: 'm2' }, { id: 'm5', cites: null }], total: 2 },
    m6: { after: [], total: 0 },
  });
  // CONTROL: another member's view; another room's post does not count; an unreadable log says nothing.
  assert.deepEqual(messages.memberAfter(P, ['m1'], 'zoe', LOG), { m1: { after: [], total: 0 } });
  assert.deepEqual(messages.memberAfter('other', ['m1'], 'meta', LOG), {});
  assert.deepEqual(messages.memberAfter(P, ['m1'], 'meta', 'not a log'), {});
  // Round 1: log order, not the clock, so two posts in one millisecond are still ordered; and at most ten are listed.
  const same = [{ kind: 'post', id: 'm1', project: P, from: 'ann', at: at(0) }, { kind: 'post', id: 'm2', project: P, from: 'meta', at: at(0) }];
  assert.deepEqual(messages.memberAfter(P, ['m1'], 'meta', same), { m1: { after: [{ id: 'm2', cites: null }], total: 1 } });
  const many = [{ kind: 'post', id: 'm1', project: P, from: 'ann', at: at(0) }];
  for (let k = 2; k < 12; k += 1) many.push({ kind: 'post', id: 'm' + k, project: P, from: 'meta', at: at(k) });
  const m = messages.memberAfter(P, ['m1'], 'meta', many).m1;
  assert.equal(m.after.length, 10); assert.equal(m.total, 10);
  many.push({ kind: 'post', id: 'm12', project: P, from: 'meta', at: at(12) });
  const m2 = messages.memberAfter(P, ['m1'], 'meta', many).m1;
  assert.equal(m2.after.length, 10); assert.equal(m2.total, 11);
});

test('#4926 N7: the told line lists them by id, never text; a refused one, or none given, adds nothing', () => {
  const after = { m1: { after: [{ id: 'm4', cites: 'm2' }, { id: 'm5', cites: null }], total: 3 }, m6: { after: [], total: 0 }, bad: { after: [], total: 0 } };
  const told = roomhold.toldLine('meta', { n: 2, projectId: P, state: chat.DELIVERY.PLACED, after });
  assert.match(told, /told of 2 held post\(s\) in proj-1, delivery=placed; since each, the member's own posts here: m1: m4 \(replies to m2\), m5 \(cites nothing\) \+1 more; m6: none\n$/);
  assert.match(roomhold.toldLine('meta', { n: 1, projectId: P, state: chat.DELIVERY.PLACED }), /delivery=placed\n$/, 'CONTROL: no diagnostic, no suffix');
  assert.doesNotMatch(roomhold.toldLine('meta', { n: 1, projectId: P, state: chat.DELIVERY.COULD_NOT, after }), /since each/);
  assert.match(roomhold.carriedLine('meta', P, ['m6'], { m6: { after: [], total: 0 } }, chat.DELIVERY.PLACED), /^room-hold: meta told of 1 held post\(s\) in proj-1 on an arrival there, delivery=placed; since each, the member's own posts here: m6: none\n$/);
  // Round 3: typing threw after it started: they may have been pasted, and were put back.
  assert.match(roomhold.carriedLine('meta', P, ['m6'], { m6: { after: [], total: 0 } }, 'may-have'),
    /^room-hold: meta may have been told of 1 held post\(s\) in proj-1 on an arrival there \(typing threw after it started\), put back; since each, the member's own posts here: m6: none\n$/);
  // Round 2: an arrival held or refused did not tell them (they were put back): never logged as told.
  for (const st of ['held', chat.DELIVERY.COULD_NOT, undefined]) {
    const line = roomhold.carriedLine('meta', P, ['m6'], { m6: { after: [], total: 0 } }, st);
    assert.match(line, /could not yet be told of 1 held post/, String(st));
    assert.doesNotMatch(line, /since each/);
  }
});

test('#4926 N7: the idle flush reads it before typing the line, and hands it on', async () => {
  roomhold.hold('meta', P, 'm1');
  roomhold.hold('meta', P, 'm3');
  const order = [];
  const done = await roomhold.flushOnIdle('meta', {
    deliver: async () => { order.push('deliver'); return { state: chat.DELIVERY.PLACED }; }, roster: [], DELIVERY: chat.DELIVERY, env: {},
    shownOf: () => 'Room', afterOf: (p, ids, who) => { order.push(['after', p, ids, who]); return { m1: { after: [], total: 0 } }; },
  });
  assert.deepEqual(order, [['after', P, ['m1', 'm3'], 'meta'], 'deliver'], 'read after typing, or with other ids');
  assert.deepEqual(done.map((d) => d.after), [{ m1: { after: [], total: 0 } }]);
  roomhold.hold('meta', P, 'm6');
  const thrown = await roomhold.flushOnIdle('meta', { deliver: async () => ({ state: chat.DELIVERY.PLACED }), roster: [], DELIVERY: chat.DELIVERY, env: {}, shownOf: () => 'Room', afterOf: () => { throw new Error('boom'); } });
  assert.equal(thrown[0].state, chat.DELIVERY.PLACED, 'a failing diagnostic changed the delivery');
  assert.equal('after' in thrown[0], false);
});

test('#4926 N7: the arrival path logs the held posts it carries (source pin)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'messages.js'), 'utf8');
  assert.match(SRC, /try \{ carriedAfter = memberAfter\(projectId, heldIds\.map\(roomhold\.plainId\), name, log\); \} catch/);
  // Written with the outcome, never before typing (round 2).
  assert.match(SRC, /logCarried\('held'\);/);
  assert.match(SRC, /outcomes\[name\] = sent\.state;\n      logCarried\(sent\.state\);/);
  assert.match(SRC, /if \(typingStarted\.has\(name\)\) logCarried\('may-have'\);\n      roomhold\.restore\(name, projectId, heldIds\);/, 'a throw after typing started is not logged');
});

test('#4926 N7: both of the board\'s flushes (turn end and the timed retry) pass the diagnostic (source pin)', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const wired = SRC.split('afterOf: (p, ids, who2) => messages.memberAfter(p, ids, who2),').length - 1;
  assert.equal(wired, 3, 'the turn-end flush, flushReleased and (#7246) flushDigests should each pass afterOf');
});

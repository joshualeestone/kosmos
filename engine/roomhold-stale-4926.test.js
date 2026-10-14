'use strict';
/**
 * #4926: a held room post that asks nothing of the member and has gone stale (older than messages.HELD_TELL_MAX_MS, or
 * the room's loop guard stopped the conversation after it) is dropped at the flush instead of told: telling it is a wake
 * into an idle agent, which then answers it, hours after the person asked the room for quiet. A held post that names
 * the member and asks for an answer is told, unless the member answered it in the room or it is over a day old (R2).
 *
 *   node --test engine/roomhold-stale-4926.test.js
 */
const os = require('node:os');
const path = require('node:path');
const SANDBOX = path.join(os.tmpdir(), 'kosmos-roomhold-stale-4926-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const messages = require('./messages');
const roomhold = require('./roomhold');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const NOW = Date.parse('2026-10-01T22:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const post = (id, min, project = 'p1') => ({ kind: 'post', id, project, from: 'ann', to: ['kim'], text: 'x', at: ago(min) });
const valve = (min, stopped = true, project = 'p1') => ({ kind: 'valve', from: 'ann', to: project, project, at: ago(min), because: 'loop', stopped });

test('#4926 staleHeld: older than HELD_TELL_MAX_MS, or the loop guard stopped the room after it; nothing else', () => {
  const maxMin = messages.HELD_TELL_MAX_MS / 60000;
  const log = [post('m1', maxMin + 5), post('m2', 30), post('m3', 10), post('m9', 30, 'p2'), valve(20), valve(5, false), valve(1, true, 'p2')];
  const stale = messages.staleHeld('p1', ['m1', 'm2', 'm3', 'm7'], log, NOW);
  assert.ok(stale.has('m1'), 'a post older than the limit was not stale');
  assert.ok(stale.has('m2'), 'a post the loop guard stopped the room after was not stale');
  assert.ok(!stale.has('m3'), 'a post AFTER the stop was stale (the person reopened, or it is new talk)');
  assert.ok(!stale.has('m7'), 'a post not in the record yet (still being delivered) was stale');
  // Age alone (no stop in the room): the old post is stale, one inside the limit is not.
  const aged = messages.staleHeld('p1', ['m1', 'm3'], [post('m1', maxMin + 5), post('m3', maxMin - 5)], NOW);
  assert.ok(aged.has('m1') && !aged.has('m3'), 'age alone did not decide: ' + [...aged]);
  // CONTROL: the same post in a room whose guard was only noted, not stopped (stopped: false), is not stale.
  assert.equal(messages.staleHeld('p1', ['m2'], [post('m2', 30), valve(20, false)], NOW).size, 0, 'a not-stopped valve row made a post stale');
  // Another room's stop does not count here.
  assert.equal(messages.staleHeld('p2', ['m9'], log, NOW).has('m9'), true, 'fixture: p2 was stopped after m9');
  assert.equal(messages.staleHeld('p1', ['m3'], [post('m3', 10), valve(1, true, 'p2')], NOW).size, 0, 'another room\'s stop made a post stale');
});

test('#4926 withoutStale drops a stale UNADDRESSED id and keeps an addressed one; without a judge, nothing is dropped', () => {
  const ids = ['m1', roomhold.addressedId('m2'), 'm3'];
  const judge = () => new Set(['m1', 'm2']);
  assert.deepEqual(roomhold.withoutStale('p1', ids, judge), [roomhold.addressedId('m2'), 'm3'], 'an addressed post was dropped, or a stale one kept');
  assert.deepEqual(roomhold.withoutStale('p1', ids, undefined), ids);
  assert.deepEqual(roomhold.withoutStale('p1', ids, () => { throw new Error('x'); }), ids, 'a judge that throws dropped something');
});

test('#4926 flushOnIdle: only stale posts held -> nothing typed, and they are not kept for later; a fresh one is told alone', async () => {
  const D = { PLACED: 'placed', COULD_NOT: 'could_not' };
  const typed = [];
  const deliver = async (name, text) => { typed.push(text); return { state: D.PLACED }; };
  const judge = (p, ids) => new Set(ids.filter((x) => x === 'm1' || x === 'm2'));
  roomhold.forget('kim');
  roomhold.hold('kim', 'p1', 'm1'); roomhold.hold('kim', 'p1', 'm2');
  let done = await roomhold.flushOnIdle('kim', { deliver, roster: [], shownOf: () => 'Room', DELIVERY: D, stale: judge });
  assert.deepEqual(typed, [], 'a stale post woke the member');
  assert.deepEqual(done, []);
  assert.deepEqual(roomhold.heldIn('kim', 'p1'), [], 'stale posts were kept to be told later');
  roomhold.hold('kim', 'p1', 'm1'); roomhold.hold('kim', 'p1', 'm3');
  done = await roomhold.flushOnIdle('kim', { deliver, roster: [], shownOf: () => 'Room', DELIVERY: D, stale: judge });
  assert.equal(typed.length, 1);
  assert.match(typed[0], /1 room post not addressed to you/, 'the line counted the stale post too: ' + typed[0]);
  assert.match(typed[0], /m3/);
  assert.ok(!/m1/.test(typed[0]), 'the stale post was named');
  // CONTROL: without a judge (the old call), both are told.
  roomhold.hold('kim', 'p1', 'm1'); roomhold.hold('kim', 'p1', 'm3');
  await roomhold.flushOnIdle('kim', { deliver, roster: [], shownOf: () => 'Room', DELIVERY: D });
  assert.match(typed[1], /2 room posts/);
  roomhold.forget('kim');
});

test('#4926 server.js passes the staleness judge to both flushes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const call of ['roomhold.flushOnIdle(who, {', 'roomhold.flushReleased(r, {']) {
    const at = src.indexOf(call);
    assert.notEqual(at, -1, call + ' not found');
    assert.match(src.slice(at, at + 600), /stale: \(p, ids, who2\) => messages\.staleHeld\(p, ids, undefined, undefined, who2\)/, call + ' does not pass the judge with the member');
  }
});

test('#4926 review 1 (Opus): flushReleased (the quota retry) passes the judge on: a stale plain post is not typed', async () => {
  const fleet = require('../test-support/fleet');
  const chat = require('./chat');
  const board = fleet.install([fleet.agent('gem', { state: 'idle' })]);
  try {
    const roster = board.snapshot ? board.snapshot() : board.roster;
    const D = { PLACED: 'placed', COULD_NOT: 'could_not' };
    const typed = [];
    roomhold.forget('gem');
    roomhold.hold('gem', 'p1', roomhold.addressedId('m5'));   // an ask, so the minute retry looks at it at all
    roomhold.hold('gem', 'p1', 'm1'); roomhold.hold('gem', 'p1', 'm3');
    assert.equal(chat.addressable('gem', roster).ok, true, 'fixture: the member cannot be typed into');
    await roomhold.flushReleased(roster, { isAgy: () => true, readReport: () => null, now: Date.now(), decayMs: 60000,
      deliver: async (n, text) => { typed.push(text); return { state: D.PLACED }; }, shownOf: () => 'Room', DELIVERY: D, env: {},
      stale: (p, ids) => new Set(ids.filter((x) => x === 'm1')) });
    assert.equal(typed.length, 1, 'fixture: the retry typed nothing');
    assert.ok(/m3/.test(typed[0]) && /m5/.test(typed[0]), 'a fresh or asked post was left out: ' + typed[0]);
    assert.ok(!/\bm1\b/.test(typed[0]), 'the quota retry told a stale post: ' + typed[0]);
  } finally { roomhold.forget('gem'); board.restore(); chat.resetForTests(); }
});

test('#4926 review 5 (Opus): a post held on the member\'s QUOTA is aged from the pause\'s end, not from the post', () => {
  const maxMin = messages.HELD_TELL_MAX_MS / 60000;
  const row = Object.assign(post('m1', maxMin + 120), { heldUntil: { gem: new Date(NOW - 10 * 60000).toISOString() } });
  assert.equal(messages.staleHeld('p1', ['m1'], [row], NOW, 'gem').size, 0, 'a quota-held post was dropped 10 min after the pause ended');
  assert.ok(messages.staleHeld('p1', ['m1'], [row], NOW, 'kim').has('m1'), 'control: for another member the post\'s own age decides');
  const ended = Object.assign(post('m2', maxMin + 300), { heldUntil: { gem: new Date(NOW - (maxMin + 5) * 60000).toISOString() } });
  assert.ok(messages.staleHeld('p1', ['m2'], [ended], NOW, 'gem').has('m2'), 'a pause that ended long ago kept it fresh');
  const stopped = [Object.assign(post('m3', 30), { heldUntil: { gem: new Date(NOW).toISOString() } }), valve(10)];
  assert.ok(messages.staleHeld('p1', ['m3'], stopped, NOW, 'gem').has('m3'), 'the loop guard no longer applied to a quota hold');
});

/* #4926 R2 (10-05 user diagnostic, 0.7.22): a session was woken on 10-05 for posts from 10-02 and 10-03 it had already
   handled. A held post the member has ANSWERED in the room (its own post with replyTo = that id), or one over a day old,
   is dropped even when it names the member. */
test('#4926 R2: staleHeld marks a post the member answered, or one over a day old, as dropped even if asked', () => {
  const reply = (min, to, project = 'p1', from = 'kim') => ({ kind: 'post', id: 'r' + min, project, from, to: ['ann'], text: 'y', replyTo: to, at: ago(min) });
  const dayMin = messages.HELD_ASKED_MAX_MS / 60000;
  let s = messages.staleHeld('p1', ['m1'], [post('m1', 30), reply(10, 'm1')], NOW, 'kim');
  assert.ok(s.has('m1') && s.evenIfAsked.has('m1'), 'a post the member answered was kept');
  // CONTROLS: kim's later post that answers something else (review 1's BLOCKER: a held post was never shown, so a
  // later post is no proof it was seen), someone else's answer, kim's answer in another room, no member named.
  s = messages.staleHeld('p1', ['m1'], [post('m1', 30), reply(10, 'm9')], NOW, 'kim');
  assert.equal(s.size, 0, 'a later post of the member that answers another post dropped this one');
  s = messages.staleHeld('p1', ['m1'], [post('m1', 30), { ...reply(10, 'm1'), project: 'p1', from: 'bob' }], NOW, 'kim');
  assert.equal(s.size, 0, 'someone else\'s answer handled it for the member');
  s = messages.staleHeld('p1', ['m1'], [post('m1', 30), reply(10, 'm1', 'p2')], NOW, 'kim');
  assert.equal(s.size, 0, 'an answer in another room handled it');
  s = messages.staleHeld('p1', ['m1'], [post('m1', 30), reply(10, 'm1')], NOW);
  assert.equal(s.size, 0, 'with no member named, a post was taken as answered');
  // Over a day old: dropped even if asked; just under a day (and past the 2 h rule): stale but still told if asked.
  s = messages.staleHeld('p1', ['m1', 'm2'], [post('m1', dayMin + 5), post('m2', dayMin - 5)], NOW, 'kim');
  assert.ok(s.evenIfAsked.has('m1'), 'a post over a day old was kept for an ask');
  assert.ok(s.has('m2') && !s.evenIfAsked.has('m2'), 'a post under a day old was dropped even when asked');
  // Review 4: the day rule counts from the POST even after a quota pause, so a pause of days does not deliver old
  // asks; the 2-hour rule still counts from the pause's end (CONTROL: a post 3 h old, paused until 1 h ago, is not stale).
  const paused = { ...post('m3', dayMin + 60), heldUntil: { kim: ago(60) } };
  s = messages.staleHeld('p1', ['m3'], [paused], NOW, 'kim');
  assert.equal(s.evenIfAsked.has('m3'), true, 'a day-old ask was kept because a quota pause ended recently');
  const recent = { ...post('m4', 180), heldUntil: { kim: ago(60) } };
  assert.equal(messages.staleHeld('p1', ['m4'], [recent], NOW, 'kim').size, 0, 'the 2-hour rule stopped counting from the pause\'s end');
});

test('#4926 R2: withoutStale drops an addressed id the judge marks evenIfAsked, and keeps the other addressed ones', () => {
  const ids = [roomhold.addressedId('m1'), roomhold.addressedId('m2'), 'm3', 'm4'];
  const judge = () => { const g = new Set(['m1', 'm2', 'm3']); g.evenIfAsked = new Set(['m1']); return g; };
  assert.deepEqual(roomhold.withoutStale('p1', ids, judge), [roomhold.addressedId('m2'), 'm4']);
  // CONTROL: a judge without evenIfAsked (the earlier shape) keeps every addressed id, as before.
  assert.deepEqual(roomhold.withoutStale('p1', ids, () => new Set(['m1', 'm2', 'm3'])), [roomhold.addressedId('m1'), roomhold.addressedId('m2'), 'm4']);
});

test('#4926 R2 review 1: through the real idle flush, a fresh held post survives the member\'s own later post; an answered or day-old ask does not', async () => {
  const dayMin = messages.HELD_ASKED_MAX_MS / 60000;
  const log = [post('m5', 3), post('m6', dayMin + 5), post('m7', 40),
    { kind: 'post', id: 'k1', project: 'p1', from: 'kim', to: ['ann'], text: 'my turn\'s answer', at: ago(1) },
    { kind: 'post', id: 'k2', project: 'p1', from: 'kim', to: ['ann'], text: 'done', replyTo: 'm7', at: ago(2) }];
  assert.ok(roomhold.hold('kim', 'p1', 'm5'));
  assert.ok(roomhold.hold('kim', 'p1', roomhold.addressedId('m6')));
  assert.ok(roomhold.hold('kim', 'p1', roomhold.addressedId('m7')));
  const typed = [];
  const DELIVERY = { PLACED: 'placed', COULD_NOT: 'could_not' };
  await roomhold.flushOnIdle('kim', { deliver: async (n, line) => { typed.push(line); return { state: DELIVERY.PLACED }; }, roster: [], shownOf: () => 'p1', DELIVERY, env: {},
    stale: (p, ids, n) => messages.staleHeld(p, ids, log, NOW, n) });
  assert.equal(typed.length, 1, 'nothing was told: ' + JSON.stringify(typed));
  assert.match(typed[0], /\bm5\b/, 'a fresh held post was dropped because the member posted after it');
  assert.doesNotMatch(typed[0], /\bm6\b/, 'a day-old ask was told');
  assert.doesNotMatch(typed[0], /\bm7\b/, 'an ask the member already answered was told');
});

test('#4926 R2 review 4: every staleHeld call in server.js passes the member (without it the answered rule is off)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const calls = src.match(/messages\.staleHeld\(([^)]*)\)/g) || [];
  assert.ok(calls.length >= 2, 'fixture: fewer than the two server flush call sites found: ' + calls.length);
  for (const c of calls) assert.match(c, /^messages\.staleHeld\(p, ids, undefined, undefined, who2\)$/, 'a server call does not pass the flush\'s member: ' + c);
});

/* N7, the 10-13 19:31:31Z test-Mac log: a Meta seat held 9 posts of one round (m1024 to m1032), answered the round
   in ONE reply to m1032, and the flush dropped only m1032 and told it the other 8 as new. */
test('#4926 N7: one reply to the round\'s newest post (m1032) answers the 8 older held posts too; a newer one is still told', async () => {
  const round = [];
  for (let n = 1024; n <= 1032; n += 1) round.push(post('m' + n, 40 - (n - 1024)));   // m1024 40 min ago ... m1032 32 min ago
  const later = post('m1033', 20);   // posted after m1032, before the reply: not covered
  const answer = { kind: 'post', id: 'm1034', project: 'p1', from: 'mark', to: ['ann'], text: 'answers to all of them', replyTo: 'm1032', at: ago(10) };
  const log = [...round, later, answer];
  const ids = [...round, later].map((r, i) => (i % 2 ? roomhold.addressedId(r.id) : r.id));   // asks and plain posts both
  roomhold.forget('mark');
  for (const x of ids) assert.ok(roomhold.hold('mark', 'p1', x), 'fixture: could not hold ' + x);
  const typed = [];
  const DELIVERY = { PLACED: 'placed', COULD_NOT: 'could_not' };
  await roomhold.flushOnIdle('mark', { deliver: async (n, line) => { typed.push(line); return { state: DELIVERY.PLACED }; }, roster: [], shownOf: () => 'p1', DELIVERY, env: {},
    stale: (p, got, n) => messages.staleHeld(p, got, log, NOW, n) });
  assert.equal(typed.length, 1, 'nothing was told: ' + JSON.stringify(typed));
  for (const r of round) assert.doesNotMatch(typed[0], new RegExp('\\b' + r.id + '\\b'), r.id + ' of the answered round was told again: ' + typed[0]);
  assert.match(typed[0], /\bm1033\b/, 'a post newer than the answered one was dropped');
  assert.deepEqual(roomhold.heldIn('mark', 'p1'), [], 'the line was not taken');
  // CONTROLS, on staleHeld directly: no reply, a reply in another room, someone else's reply, no member named.
  const judge = (lg, who) => messages.staleHeld('p1', round.map((r) => r.id), lg, NOW, who);
  assert.equal(judge([...round], 'mark').size, 0, 'without the reply, the round was dropped');
  assert.equal(judge([...round, { ...answer, project: 'p2' }], 'mark').size, 0, 'a reply in another room dropped the round');
  assert.equal(judge([...round, { ...answer, from: 'bob' }], 'mark').size, 0, 'someone else\'s reply dropped the round for mark');
  assert.equal(judge(log, undefined).size, 0, 'with no member named, the round was dropped');
  // A reply to the round's OLDEST post covers nothing newer than it.
  const first = judge([...round, { ...answer, replyTo: 'm1024' }], 'mark');
  assert.deepEqual([...first].sort(), ['m1024'], 'a reply to the oldest post dropped newer ones: ' + [...first]);
  assert.ok(judge(log, 'mark').answered.has('m1028'), 'an older post was not marked answered (a limit hold would keep it back)');
  // A reply to mark's OWN post covers nothing: seeing your own post shows you nothing else of the room.
  const own = { kind: 'post', id: 'm1035', project: 'p1', from: 'mark', to: ['ann'], text: 'mine', at: ago(31) };
  assert.equal(judge([...round, own, { ...answer, replyTo: 'm1035' }], 'mark').size, 0, 'a reply to its own post dropped the round');
  // Only the ROOM_READ_ROWS - 1 room rows before the answered post: one further back was never on a read that showed it.
  const filler = [];
  for (let k = 0; k < messages.ROOM_READ_ROWS - 1; k += 1) filler.push({ kind: 'note', project: 'p1', text: 'n', at: ago(35) });
  const far = messages.staleHeld('p1', ['m1024', 'm1031'], [post('m1024', 40), ...filler, post('m1032', 32), answer], NOW, 'mark');
  assert.ok(!far.has('m1024'), 'a post more than ROOM_READ_ROWS - 1 rows before the answered one was dropped');
  const near = messages.staleHeld('p1', ['m1024'], [post('m1024', 40), ...filler.slice(1), post('m1032', 32), answer], NOW, 'mark');
  assert.ok(near.has('m1024'), 'control: the post exactly ROOM_READ_ROWS - 1 rows before the answered one was kept');
  // The window is in the read's order (by `at`), not the log's: a post appended late but started earlier sits before
  // the answered post in the read and takes a slot there, so the oldest one falls outside.
  const late = post('m1040', 33);
  const lateLog = [post('m1024', 40), ...filler.slice(1), post('m1032', 32), late, answer];
  assert.ok(!messages.staleHeld('p1', ['m1024'], lateLog, NOW, 'mark').has('m1024'), 'the window was counted in log order');
  // A post at the same instant as the answered one is not before it.
  assert.ok(!messages.staleHeld('p1', ['m1031'], [{ ...post('m1031', 32) }, post('m1032', 32), answer], NOW, 'mark').has('m1031'), 'a post at the same instant was covered');
  // Rows after the answered post and before the reply narrow the window (a read before the reply showed them instead);
  // a row after the reply does not.
  const between = post('m1036', 20);
  const after = post('m1037', 5);
  const base = [post('m1024', 40), ...filler.slice(1), post('m1032', 32)];
  assert.ok(!messages.staleHeld('p1', ['m1024'], [...base, between, answer], NOW, 'mark').has('m1024'), 'a row between the answered post and the reply did not narrow the window');
  assert.ok(messages.staleHeld('p1', ['m1024'], [...base, answer, after], NOW, 'mark').has('m1024'), 'a row after the reply narrowed the window (control: it must not)');
  // A held post whose time does not parse does not switch the rule off for the others.
  assert.ok(messages.staleHeld('p1', ['m1028', 'm1050'], [...round, { ...post('m1050', 31), at: 'not a time' }, answer], NOW, 'mark').has('m1028'),
    'an unreadable held post switched N7 off');
  // Deliberate: an older ask a usage limit kept (#5805) is covered too, so withoutStale drops it rather than keep it back.
  // The ask is over a day old, so the day rule would drop it; the limit hold keeps it back unless it was answered.
  assert.equal(roomhold.noteLimit('mark', 'p1', ['m1028'], new Date(Date.now() + 3600000).toISOString()), true, 'fixture: the limit was not noted');
  const dayOld = post('m1028', messages.HELD_ASKED_MAX_MS / 60000 + 10);
  const limitJudge = (lg) => (p, got, who) => messages.staleHeld(p, got, lg, NOW, who);
  const ask = [roomhold.addressedId('m1028')];
  assert.deepEqual(roomhold.withoutStale('p1', ask, limitJudge([dayOld, post('m1032', 32)]), 'mark'), ask, 'control: the limit hold did not keep a day-old ask back');
  assert.deepEqual(roomhold.withoutStale('p1', ask, limitJudge([dayOld, post('m1032', 32), answer]), 'mark'), [], 'a limit-kept ask the reply covered was kept back');
  // A reply stamped no later than the post it answers covers nothing (no read before it could have shown that post).
  assert.deepEqual([...judge([...round, { ...answer, at: round[8].at }], 'mark')], ['m1032'], 'a reply at the answered post\'s own instant covered the older posts');
  // Rows the room read does not show (a reaction) do not use up the window.
  const unseen = filler.map(() => ({ kind: 'reaction', project: 'p1', from: 'ann', at: ago(35) }));
  assert.ok(messages.staleHeld('p1', ['m1024'], [post('m1024', 40), ...unseen, post('m1032', 32), answer], NOW, 'mark').has('m1024'),
    'rows the room read does not show narrowed the window');
  roomhold.forget('mark');
});

test('#4926 N7: ROOM_READ_KINDS is the list of row kinds the server room read keeps', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const rows = guideMaskedRows(rec.rows, null)');
  assert.notEqual(at, -1, 'the room read\'s row filter was not found');
  // Only the first .filter of the chain: a later one names some kinds again. It guards a kind added on either side.
  const end = src.indexOf('/* A note written for the agents', at);
  assert.ok(end > at, 'the end of the room read\'s row filter was not found');
  const kept = new Set([...src.slice(at, end).matchAll(/m\.kind === '([a-z]+)'/g)].map((x) => x[1]));
  assert.ok(kept.size >= 4, 'fixture: too few kinds read from the filter: ' + [...kept]);
  assert.deepEqual([...messages.ROOM_READ_KINDS].sort(), [...kept].sort(), 'the room read and staleHeld disagree on which rows a read shows');
});

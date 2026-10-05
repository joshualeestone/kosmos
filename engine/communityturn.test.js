'use strict';
/* #4947 slice 2: the community turn. Real cards from the real producer (fleet + status.snapshot()), never hand-built
 * (fixture-discipline.test.js); every read is injected, and communitystore.postTimesAll runs against a sandboxed data
 * root.
 *
 *   node --test engine/communityturn.test.js
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-communityturn-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const ct = require('./communityturn');
const store = require('./communitystore');
const { POSTS_PER_DAY_MAX } = require('./communityblock');
const fleet = require('../test-support/fleet');
const status = require('./status');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const CARDS = (() => {
  const board = fleet.install([fleet.agent('ann', { state: 'idle' }), fleet.agent('bea', { state: 'idle' }), fleet.agent('cal', { state: 'idle' }), fleet.agent('dan', { state: 'idle' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
const card = (s, over = {}) => { const c = CARDS.find((x) => x.sessionName === s); assert.ok(c, 'fixture: no real card for ' + s); return { ...c, ...over }; };
const NOW = Date.parse('2026-10-02T19:30:00Z');
const H = 3600e3;
const ago = (ms) => new Date(NOW - ms).toISOString();
const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
/* #5296: every fixture agent worked half an hour ago, after the fixture posts (an hour or more old) and their grace, so
   the pre-#5296 cases still read as they did. The #5296 tests below take this away. */
const WORKED = () => [{ state: 'idle', at: NOW - 2 * H }, { state: 'working', at: NOW - 0.5 * H }, { state: 'idle', at: NOW - 0.4 * H }];

function args(over = {}) {
  return {
    roster: [card('ann'), card('bea'), card('cal'), card('dan')], projects: [],
    now: NOW, book: new Map(),
    inCommunity: () => true, idleSince: () => NOW - H, seenIdle: new Set(['ann', 'bea', 'cal', 'dan']),
    history: WORKED,
    postTimes: (s) => ({ ann: [ago(8 * H)], bea: [ago(4 * H)], cal: [ago(1 * H)], dan: [ago(1 * H)] }[s] || [ago(1 * H)]),
    ...over,
  };
}

test('fixture: real cards, ours and idle', () => {
  assert.ok(CARDS.length >= 4);
  for (const s of ['ann', 'bea', 'cal', 'dan']) assert.equal(card(s).isNamedOurs, true, s);
});

test('due: last post 3 h or more ago is due (longest silent first); 1 h ago is not', () => {
  assert.deepEqual(ct.due(args()).map((d) => d.session), ['ann', 'bea']);
});

test('due: at most MAX_PER_PASS a pass', () => {
  const r = ct.due(args({ postTimes: () => [ago(5 * H)] }));
  assert.equal(r.length, ct.MAX_PER_PASS);
});

test('due: the daily maximum in the last 24 h stops it; one fewer does not', () => {
  const full = Array.from({ length: POSTS_PER_DAY_MAX }, (_, i) => ago((4 + i) * H));
  const fewer = full.slice(1);
  assert.deepEqual(ct.due(args({ postTimes: (s) => (s === 'ann' ? full : [ago(H)]) })).map((d) => d.session), [], 'an agent at the daily maximum was prompted');
  assert.deepEqual(ct.due(args({ postTimes: (s) => (s === 'ann' ? fewer : [ago(H)]) })).map((d) => d.session), ['ann'], 'CONTROL: one under the maximum is due');
});

test('due: a working agent, one not ours, and one whose instructions lack the block are not prompted', () => {
  const only = (s) => (s === 'ann' ? [ago(8 * H)] : [ago(H)]);
  assert.deepEqual(ct.due(args({ postTimes: only, roster: [card('ann', { state: 'working' })] })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, roster: [card('ann', { isNamedOurs: false })] })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, inCommunity: () => false })), []);
  assert.deepEqual(ct.due(args({ postTimes: only })).map((d) => d.session), ['ann'], 'CONTROL: the same agent idle, ours and in the community is due');
});

test('due: an unreadable post store (null) or a throwing read prompts nobody', () => {
  assert.deepEqual(ct.due(args({ postTimes: () => null })), []);
  assert.deepEqual(ct.due(args({ postTimes: () => { throw new Error('boom'); } })), []);
  assert.deepEqual(ct.due(args({ inCommunity: () => { throw new Error('boom'); } })), []);
});

test('due: tried less than 3 h ago is not tried again; 3 h ago is; PROMPTS_PER_DAY tries in 24 h stop it', () => {
  const book = new Map([['ann', [NOW - 2 * H]]]);
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['bea']);
  book.set('ann', [NOW - 3 * H]);
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['ann', 'bea']);
  book.set('ann', Array.from({ length: ct.PROMPTS_PER_DAY }, (_, i) => NOW - (4 + 4 * i) * H));
  assert.deepEqual(ct.due(args({ book })).map((d) => d.session), ['bea'], 'tried past the daily limit');
});

test('due: just idle (under replynudge.IDLE_FIRST_MS by its own idle report) is not due; idle long enough is', () => {
  const { IDLE_FIRST_MS } = require('./replynudge');
  assert.deepEqual(ct.due(args({ idleSince: (s) => (s === 'ann' ? NOW - 60e3 : NOW - IDLE_FIRST_MS) })).map((d) => d.session), ['bea']);
});

test('review 2: no idle report (null or not idle) is not due; CONTROL: the same agent with an old idle report is', () => {
  assert.deepEqual(ct.due(args({ idleSince: () => null })), []);
  assert.deepEqual(ct.due(args({ idleSince: () => NaN })), []);
  assert.deepEqual(ct.due(args()).map((d) => d.session), ['ann', 'bea']);
});

test('review 2: the agent-nudge brake (AGENT_WORKFORCE_AGENT_NUDGE_OFF=1) stops the turn too', () => {
  const { sent, o } = tickArgs({ env: { AGENT_WORKFORCE_AGENT_NUDGE_OFF: '1' } });
  assert.deepEqual(ct.tickOnce(o), []);
  assert.deepEqual(sent, []);
  const ctl = tickArgs();
  assert.equal(ct.tickOnce(ctl.o).length, 2, 'CONTROL: without the brake it prompts');
});

test('the line names the same gap the gate uses', () => {
  assert.match(ct.TURN_TEXT, new RegExp((ct.TURN_GAP_MS / 3600e3) + ' hours ago or more'));
});

test('due: a stood-down agent (every project paused for it) is not due', () => {
  const projects = [{ id: 'p', agents: ['ann'], paused: true, status: 'paused' }];
  const P = require('./projects');
  assert.equal(P.isPaused(projects[0]), true, 'fixture: the project does not read as paused');
  assert.deepEqual(ct.due(args({ projects })).map((d) => d.session), ['bea']);
});

test('review 1 (a blocker): agents held on the quota are skipped BEFORE the per-pass cut, so they cannot take every pass', () => {
  const held = new Set(['ann', 'bea']);
  const r = ct.due(args({ postTimes: (s) => ({ ann: [ago(9 * H)], bea: [ago(8 * H)], cal: [ago(5 * H)], dan: [ago(4 * H)] }[s]), quotaHeld: (s) => held.has(s) }));
  assert.deepEqual(r.map((d) => d.session), ['cal', 'dan']);
});

function tickArgs(over = {}) {
  const sent = [];
  return { sent, o: {
    allowed: () => true, env: {}, switchOn: () => true, prompterOn: () => true,
    roster: () => [card('ann'), card('bea')], readProjects: () => [], now: NOW, book: new Map(), sent: [],
    readLimit: () => ({ on: true, perHour: 20 }),
    inCommunity: () => true, postTimes: () => [ago(6 * H)], idleSince: () => NOW - H, idleSeen: new Set(['ann', 'bea']),
    history: WORKED,
    deliver: (s, text) => { sent.push([s, text]); return { state: D.PLACED }; }, DELIVERY: D,
    ...over,
  } };
}

test('tickOnce: prompts the due agents with the line and books them; a second pass at once sends nothing', () => {
  const { sent, o } = tickArgs();
  const r = ct.tickOnce(o);
  assert.deepEqual(r.map((x) => [x.session, x.act]), [['ann', 'prompted'], ['bea', 'prompted']]);
  assert.equal(sent[0][1], ct.TURN_TEXT);
  assert.deepEqual(ct.tickOnce(o), [], 'prompted twice within the gap');
});

test('tickOnce gates: live execution off, the brake, the community switch off, the Prompter off: nothing is sent', () => {
  for (const over of [{ allowed: () => false }, { env: { AGENT_WORKFORCE_COMMUNITY_TURN_OFF: '1' } }, { switchOn: () => false }, { prompterOn: () => false }]) {
    const { sent, o } = tickArgs(over);
    assert.deepEqual(ct.tickOnce(o), [], JSON.stringify(Object.keys(over)));
    assert.deepEqual(sent, []);
  }
});

test('tickOnce: a held line is not booked (tried again later); an unreached one IS booked, so it backs off rather than take every pass', () => {
  const heldRun = tickArgs({ roster: () => [card('ann')], deliver: () => ({ state: D.COULD_NOT, held: true }) });
  assert.equal(ct.tickOnce(heldRun.o)[0].act, 'held');
  assert.equal(heldRun.o.book.has('ann'), false);
  const lost = tickArgs({ roster: () => [card('ann')], deliver: () => ({ state: D.COULD_NOT }) });
  assert.equal(ct.tickOnce(lost.o)[0].act, 'not-reached');
  assert.deepEqual(lost.o.book.get('ann'), [NOW]);
  assert.deepEqual(lost.o.sent, [], 'an unreached line was counted in the hour log');
});

test('tickOnce: Agent Communication\'s per-hour limit, counted in the shared hour log, stops the pass; a reached line is logged', () => {
  const full = tickArgs({ sent: Array.from({ length: 20 }, () => NOW - 60e3) });
  const r = ct.tickOnce(full.o);
  assert.deepEqual(r.map((x) => x.act), ['limit']);
  assert.deepEqual(full.sent, [], 'a line went past the hour\'s limit');
  const ok = tickArgs();
  ct.tickOnce(ok.o);
  assert.deepEqual(ok.o.sent, [NOW, NOW], 'reached lines are counted in the shared hour log');
  const off = tickArgs({ sent: Array.from({ length: 20 }, () => NOW - 60e3), readLimit: () => ({ on: false, perHour: 20 }) });
  assert.equal(ct.tickOnce(off.o).filter((x) => x.act === 'prompted').length, 2, 'CONTROL: with the limit off, nothing stops it');
});

test('tickOnce: no projects read (cannot tell a stood-down agent) prompts nobody', () => {
  const { sent, o } = tickArgs({ readProjects: () => null });
  assert.deepEqual(ct.tickOnce(o), []);
  assert.deepEqual(sent, []);
});

test('the line asks for a real post, names the daily maximum, and says to do nothing rather than invent', () => {
  assert.match(ct.TURN_TEXT, /kosmos community post/);
  assert.match(ct.TURN_TEXT, new RegExp('no more than ' + POSTS_PER_DAY_MAX + ' times a day'));   // #5297: the block's own words
  assert.match(ct.TURN_TEXT, /at least 300 words/);
  assert.match(ct.TURN_TEXT, /do nothing/);
  assert.match(ct.TURN_TEXT, /Never invent/);
  assert.ok(![0x2014, 0x2013].some((c) => ct.TURN_TEXT.includes(String.fromCharCode(c))), 'a dash in product copy');
});

test('communitystore.postTimesAll: each agent\'s posts in any status, keyed lower-case, agent posts only; empty when none; null when unreadable', () => {
  const dir = path.join(require('./store').ROOT, 'community');   // communitystore's own dir()
  assert.ok(path.resolve(dir).startsWith(path.resolve(SANDBOX) + path.sep), dir);
  assert.equal(store.postTimesAll().size, 0, 'no file yet');
  const a = store.insertPost({ status: 'published', agent: 'ann', body: 'one' });
  const b = store.insertPost({ status: 'held', agent: 'ANN', body: 'two' });
  store.insertPost({ status: 'published', agent: 'bea', body: 'other' });
  store.insertPost({ status: 'published', agent: 'ann', author: { type: 'user', name: 'ann' }, body: 'a person' });
  assert.deepEqual(store.postTimesAll().get('ann').sort(), [a.receivedAt, b.receivedAt].sort());
  // postedBy's guard: a corrupt-* sidecar means earlier posts are elsewhere, so no count is given.
  fs.writeFileSync(path.join(dir, 'posts.json.corrupt-1'), '[]');
  assert.equal(store.postTimesAll(), null, 'a count from the fresh file alone was given beside a corrupt sidecar');
  fs.rmSync(path.join(dir, 'posts.json.corrupt-1'));
  assert.equal(store.postTimesAll().get('bea').length, 1, 'CONTROL: without the sidecar the store reads');
  fs.writeFileSync(path.join(dir, 'posts.json'), '{not json');
  assert.equal(store.postTimesAll(), null);
});

test('review 3: a busy pane is not booked (no try spent); a throw counts as unconfirmed, booked and in the hour log', () => {
  const busy = tickArgs({ roster: () => [card('ann')], deliver: () => ({ state: D.COULD_NOT, busy: true }) });
  assert.equal(ct.tickOnce(busy.o)[0].act, 'pane-busy');
  assert.equal(busy.o.book.has('ann'), false, 'a collision with another nudge spent a try');
  const threw = tickArgs({ roster: () => [card('ann')], deliver: () => { throw new Error('after the paste'); } });
  assert.equal(ct.tickOnce(threw.o)[0].act, 'prompted');
  assert.deepEqual(threw.o.book.get('ann'), [NOW]);
  assert.deepEqual(threw.o.sent, [NOW]);
});

test('review 4: an agent is due only if it was idle at the previous pass too; the tick keeps this pass\'s idle cards for the next', () => {
  assert.deepEqual(ct.due(args({ seenIdle: new Set(['bea']) })).map((d) => d.session), ['bea']);
  const first = tickArgs({ idleSeen: new Set() });
  assert.deepEqual(ct.tickOnce(first.o), [], 'an agent seen idle for the first time was prompted');
  assert.deepEqual([...first.o.idleSeen].sort(), ['ann', 'bea'], 'this pass\'s idle cards were not kept for the next');
  assert.equal(ct.tickOnce(first.o).length, 2, 'CONTROL: idle at the previous pass too, they are prompted');
});

test('review 5: a pass with a gate off clears the idle-seen marks, so the next pass with the gate on prompts nobody yet', () => {
  for (const over of [{ switchOn: () => false }, { prompterOn: () => false }, { allowed: () => false }, { readProjects: () => null }]) {
    const run = tickArgs({ idleSeen: new Set(['ann', 'bea']) });
    const gateOff = { ...run.o, ...over };
    assert.deepEqual(ct.tickOnce(gateOff), []);
    assert.equal(run.o.idleSeen.size, 0, 'a gate-off pass kept stale idle marks: ' + Object.keys(over));
    assert.deepEqual(ct.tickOnce(run.o), [], 'an agent nobody watched while the gate was off counted as seen idle');
  }
});

test('review 5: a missing gate or deliver reads as off, never on', () => {
  for (const drop of ['switchOn', 'prompterOn', 'allowed', 'deliver']) {
    const run = tickArgs();
    delete run.o[drop];
    assert.deepEqual(ct.tickOnce(run.o), [], drop + ' missing was read as on');
  }
});

test('review 6: an agent that has never posted is due, first, and gets INTRO_TEXT (which claims no last post)', () => {
  const posts = (s) => ({ ann: [ago(8 * H)], dan: [] }[s] || [ago(H)]);
  assert.deepEqual(ct.due(args({ postTimes: posts })).map((d) => [d.session, d.first]), [['dan', true], ['ann', false]]);
  const run = tickArgs({ roster: () => [card('ann'), card('dan')], idleSeen: new Set(['ann', 'dan']), postTimes: posts });
  ct.tickOnce(run.o);
  assert.deepEqual(run.sent.map(([s, t]) => [s, t === ct.INTRO_TEXT ? 'intro' : (t === ct.TURN_TEXT ? 'turn' : '?')]), [['dan', 'intro'], ['ann', 'turn']]);
  assert.doesNotMatch(ct.INTRO_TEXT, /last post/);
  // Review 9: the introduction keeps Josh's 300-word minimum and the block's privacy clause (the bullet may be absent).
  assert.match(ct.INTRO_TEXT, /introduction of at least 300 words/);
  assert.doesNotMatch(ct.INTRO_TEXT, /short introduction/);
  assert.match(ct.INTRO_TEXT, /Never say what your work is for or who it is for\./);
  assert.match(ct.INTRO_TEXT, /Never invent/);
});

test('review 6: the tries book is kept on disk; an odd or unreadable file reads as empty; entries past 24 h are dropped', () => {
  const file = ct.bookFile();
  assert.ok(path.resolve(file).startsWith(path.resolve(SANDBOX) + path.sep), file);
  fs.rmSync(file, { force: true });
  assert.equal(ct.readBook().size, 0, 'no file yet');
  assert.equal(ct.writeBook(new Map([['ann', [NOW - 2 * H, NOW - 30 * H]], ['old', [NOW - 40 * H]]]), NOW), true);
  assert.deepEqual([...ct.readBook()], [['ann', [NOW - 2 * H]]]);
  fs.writeFileSync(file, '[1,2,3]');
  assert.equal(ct.readBook().size, 0);
  fs.writeFileSync(file, '{not json');
  assert.equal(ct.readBook().size, 0);
});

test('#5212: the turn says what is waiting (lineFor) in place of the generic line; who is due is unchanged; an intro stays an intro', () => {
  const posts = (s) => ({ ann: [ago(8 * H)], dan: [] }[s] || [ago(6 * H)]);
  const waiting = 'Kosmos here: 2 comments on your post "X" have no answer from you yet.';
  const asked = [];
  const run = tickArgs({ roster: () => [card('ann'), card('dan')], idleSeen: new Set(['ann', 'dan']), postTimes: posts,
    lineFor: (s) => { asked.push(s); return waiting; } });
  const plain = tickArgs({ roster: () => [card('ann'), card('dan')], idleSeen: new Set(['ann', 'dan']), postTimes: posts });
  const r = ct.tickOnce(run.o);
  assert.deepEqual(r.map((x) => [x.session, x.act]), ct.tickOnce(plain.o).map((x) => [x.session, x.act]), 'lineFor changed who was prompted');
  const said = Object.fromEntries(run.sent);
  assert.equal(said.dan, ct.INTRO_TEXT, 'an agent that never posted lost its introduction line');
  assert.equal(said.ann, waiting);
  assert.ok(!asked.includes('dan'), 'the waiting line was asked for an agent that has never posted');
  const none = tickArgs({ roster: () => [card('bea')], idleSeen: new Set(['bea']), lineFor: () => null });   // at most 2 a pass: its own run
  ct.tickOnce(none.o);
  assert.deepEqual(none.sent, [['bea', ct.TURN_TEXT]], 'no line: the generic one');
});

test('#5212: a lineFor that throws or answers blank leaves the generic line', () => {
  for (const lineFor of [() => { throw new Error('x'); }, () => '   ', () => 42]) {
    const { sent, o } = tickArgs({ roster: () => [card('ann')], lineFor });
    ct.tickOnce(o);
    assert.equal(sent[0][1], ct.TURN_TEXT);
  }
});

/* ---- kosmos#5296 / #5297: once the floor is met, a prompt needs new work since the last post ---- */
const MIN = 60e3;

test('#5296 workedSince: the posting turn and a turn this timer woke are not work; a later turn is; CONTROLS for each', () => {
  const post = NOW - 4 * H;
  // The turn that wrote the post: working before it and up to WORK_GRACE_MS after it.
  assert.equal(ct.workedSince([{ state: 'working', at: post - 5 * MIN }, { state: 'working', at: post + 10 * MIN }, { state: 'idle', at: post + 12 * MIN }], post, []), false);
  // Every agent goes idle when the posting turn ends (the Stop report); the fixtures below start there.
  const done = { state: 'idle', at: post + 2 * MIN };
  assert.equal(ct.workedSince([done, { state: 'working', at: post + ct.WORK_GRACE_MS + MIN }], post, []), true, 'CONTROL: past the grace, after the posting turn ended, it is work');
  // A turn this timer's own prompt woke (the loop in the user's report): not work.
  const tried = post + 3 * H;
  assert.equal(ct.workedSince([done, { state: 'working', at: tried + 2 * MIN }, { state: 'idle', at: tried + 3 * MIN }], post, [tried]), false);
  assert.equal(ct.workedSince([done, { state: 'working', at: tried + 2 * MIN }], post, []), true, 'CONTROL: the same turn with no prompt before it is work');
  // Idle and stopped are never work; needs_you and blocked are (the agent was on something).
  assert.equal(ct.workedSince([{ state: 'idle', at: post + 2 * H }, { state: 'stopped', at: post + 2 * H }], post, []), false);
  assert.equal(ct.workedSince([done, { state: 'needs_you', at: post + 2 * H }], post, []), true);
  assert.equal(ct.workedSince(null, post, []), null, 'no record is unknown, never "did not work"');
});

test('#5296 due: posted today and idle since -> not prompted; CONTROL: the same agent after real work is', () => {
  const only = (s) => (s === 'ann' ? [ago(4 * H)] : [ago(H)]);
  const idleSince = [{ state: 'working', at: NOW - 4 * H - 5 * MIN }, { state: 'idle', at: NOW - 4 * H + 5 * MIN }];
  assert.deepEqual(ct.due(args({ postTimes: only, history: () => idleSince })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, history: WORKED })).map((d) => d.session), ['ann']);
});

test('#5296 due: an unknown history (null, or a throw) prompts nobody who has posted today', () => {
  const only = (s) => (s === 'ann' ? [ago(4 * H)] : [ago(H)]);
  assert.deepEqual(ct.due(args({ postTimes: only, history: () => null })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, history: () => { throw new Error('boom'); } })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, history: undefined })), [], 'no history read at all');
});

test('#5296 due: the daily floor stands: no post in 24 h is due with no work at all, and a never-posted agent too', () => {
  const none = () => [];
  assert.deepEqual(ct.due(args({ postTimes: (s) => (s === 'ann' ? [ago(25 * H)] : [ago(H)]), history: none })).map((d) => d.session), ['ann']);
  const first = ct.due(args({ postTimes: (s) => (s === 'ann' ? [] : [ago(H)]), history: none }));
  assert.deepEqual(first.map((d) => [d.session, d.first]), [['ann', true]]);
});

test('#5296 tickOnce: the reported loop ends: a prompt that wakes an idle agent does not make it due again', () => {
  // ann posted 7 h ago, was prompted 4 h ago (tick book), woke for a minute and went idle; now 4 h on, she is not due.
  const book = new Map([['ann', [NOW - 4 * H]]]);
  const hist = () => [{ state: 'idle', at: NOW - 7 * H + 2 * MIN }, { state: 'working', at: NOW - 4 * H + MIN }, { state: 'idle', at: NOW - 4 * H + 2 * MIN }];
  const { sent, o } = tickArgs({ roster: () => [card('ann')], book, postTimes: () => [ago(7 * H)], history: hist, idleSeen: new Set(['ann']) });
  assert.deepEqual(ct.tickOnce(o), []);
  assert.deepEqual(sent, []);
  const ctl = tickArgs({ roster: () => [card('ann')], book: new Map(), postTimes: () => [ago(7 * H)], history: hist, idleSeen: new Set(['ann']) });
  assert.equal(ct.tickOnce(ctl.o).length, 1, 'CONTROL: the same turn with no prompt in the book is work, so she is prompted');
});

test('#5297 item 3: the prompt and the block state the same numbers, from one place', () => {
  const cb = require('./communityblock');
  const body = cb.blockBody();
  for (const text of [ct.TURN_TEXT, body]) {
    assert.match(text, new RegExp('at least ' + cb.MIN_WORDS + ' words'));
    assert.match(text, new RegExp('no more than ' + cb.POSTS_PER_DAY_MAX + ' times a day'));
    assert.match(text, /at least once a day/);
    assert.match(text, /an honest post about what you are working on, stuck on or learned today counts/);
  }
  assert.equal(cb.FLOORS.postsPerDayMax, cb.POSTS_PER_DAY_MAX);
  assert.match(ct.INTRO_TEXT, new RegExp('at least ' + cb.MIN_WORDS + ' words'));
});

test('#5296 review 1: a LONG turn the prompt woke (replies, votes, comments past the grace) is still not work; CONTROL: a later turn is', () => {
  const post = NOW - 8 * H;
  const tried = NOW - 4 * H;
  const rows = [{ state: 'working', at: tried + MIN }, { state: 'working', at: tried + 50 * MIN }, { state: 'idle', at: tried + 55 * MIN }];
  assert.equal(ct.workedSince(rows, post, [tried]), false);
  assert.equal(ct.workedSince([...rows, { state: 'working', at: tried + 2 * H }], post, [tried]), true);
  // Still working since the prompt woke it (no idle after it): all of it is the woken turn.
  assert.equal(ct.workedSince([{ state: 'working', at: tried + MIN }, { state: 'working', at: tried + 90 * MIN }], post, [tried]), false);
});

test('#5296 review 3: a prompt that woke nothing (no report within the grace) does not swallow the next real turn', () => {
  const post = NOW - 8 * H;
  const tried = NOW - 4 * H;
  // Unreached (or ignored): nothing until real work an hour later, then idle. That work counts.
  const done = { state: 'idle', at: post + 2 * MIN };
  assert.equal(ct.workedSince([done, { state: 'working', at: tried + H }, { state: 'idle', at: tried + 2 * H }], post, [tried]), true);
  // CONTROL: the same work starting inside the grace is the prompt's own turn.
  assert.equal(ct.workedSince([done, { state: 'working', at: tried + 5 * MIN }, { state: 'working', at: tried + H }, { state: 'idle', at: tried + 2 * H }], post, [tried]), false);
});

test('#5296 review 5: a session start is not work, and a turn a Kosmos re-read line woke is not work; CONTROLS', () => {
  const post = NOW - 8 * H;
  assert.equal(ct.workedSince([{ state: 'started', at: NOW - 2 * H }, { state: 'idle', at: NOW - 2 * H + MIN }], post, []), false);
  const done = { state: 'idle', at: post + 2 * MIN };
  assert.equal(ct.workedSince([done, { state: 'started', at: NOW - 2 * H }, { state: 'working', at: NOW - 2 * H + MIN }], post, []), true, 'CONTROL: work after the start is work');
  const reread = NOW - 3 * H;
  const rows = [done, { state: 'working', at: reread + MIN }, { state: 'idle', at: reread + 3 * MIN }];
  const only = (s) => (s === 'ann' ? [ago(8 * H)] : [ago(H)]);
  assert.deepEqual(ct.due(args({ postTimes: only, history: () => rows, kosmosLines: () => [reread] })), []);
  assert.deepEqual(ct.due(args({ postTimes: only, history: () => rows })).map((d) => d.session), ['ann'], 'CONTROL: without the send time, that turn reads as work');
  assert.deepEqual(ct.due(args({ postTimes: only, history: () => rows, kosmosLines: () => { throw new Error('boom'); } })).map((d) => d.session), ['ann']);
});

test('#5296 review 6: the posting turn runs to the next idle report, and a report stamped just before a re-read send is that turn', () => {
  const post = NOW - 8 * H;
  // Kept working 40 minutes after posting, then idle: still the posting turn.
  assert.equal(ct.workedSince([{ state: 'working', at: post + 40 * MIN }, { state: 'idle', at: post + 45 * MIN }], post, []), false);
  assert.equal(ct.workedSince([{ state: 'working', at: post + 40 * MIN }, { state: 'idle', at: post + 45 * MIN }, { state: 'working', at: post + 2 * H }], post, []), true, 'CONTROL: a later turn is work');
  // The re-read line was stamped at t, the agent's working report 20 s earlier.
  const t = NOW - 3 * H;
  assert.equal(ct.workedSince([{ state: 'working', at: t - 20e3 }, { state: 'idle', at: t + 2 * MIN }], post, [t]), false);
});

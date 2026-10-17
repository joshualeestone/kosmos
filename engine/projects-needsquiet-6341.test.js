'use strict';

/**
 * #6341 (Josh, 2026-10-16 19:43 and 19:47): a project's "needs you" / Issue is quiet when the project is paused, when it
 * is an agent being out of usage, when it is an agent's own condition in a room with no post for a day, or when the
 * person dismissed that member's reason. A dismissal stands only while the reason does. The Recommender does not write
 * a note its room already holds.
 *
 *   node --test engine/projects-needsquiet-6341.test.js
 *
 * Sandbox first, before any require (see engine/projects.test.js): every root the code writes to.
 */
require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-needsquiet-6341-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const messages = require('./messages');
const recommender = require('./recommender');
const store = require('./store');
const selfreport = require('./selfreport');
const fleet = require('../test-support/fleet');

const WORK = path.join(SANDBOX, 'work');
fs.mkdirSync(WORK, { recursive: true });
const folder = (name) => { const d = path.join(WORK, name); fs.mkdirSync(d, { recursive: true }); return d; };
const LOG = () => path.join(store.ROOT, 'messages.jsonl');
function reset() {
  try { fs.rmSync(projects.file()); } catch { /* nothing written yet */ }
  try { fs.rmSync(LOG()); } catch { /* no log yet */ }
}
function cards(specs) {
  const board = fleet.install(specs);
  try { return board.agents; } finally { board.restore(); }
}
function row(r) { fs.appendFileSync(LOG(), JSON.stringify(r) + '\n'); }
const ago = (ms) => new Date(Date.now() - ms).toISOString();
function roomPost(projectId, at = new Date().toISOString()) {
  row({ kind: 'post', id: 'p' + Math.random().toString(36).slice(2), from: 'zed61', project: projectId, to: [], text: 'on it', outcomes: {}, at });
}
const HOUR = 60 * 60 * 1000;
const one = (roster, id) => projects.list(roster).find((p) => p.id === id);
const member = (r, name) => r.agents.find((m) => m.sessionName === name);
// A crash loop is the agent's own condition, about no project (the real card, with the field server.js attaches).
const looping = (name) => cards([fleet.agent(name, { state: 'working' })]).map((c) => ({ ...c, crashLoop: { looping: true, count: 4 } }));

test('#6341: an agent\'s own condition counts only in a live room (a post in the last day)', () => {
  reset();
  const p = projects.create({ name: 'Idle', folder: folder('idle'), agents: ['cl61'] });
  const roster = looping('cl61');
  let r = one(roster, p.id);
  assert.equal(member(r, 'cl61').needsYouHere, null, 'a crash loop lit a project whose room has never had a post');
  assert.deepEqual(member(r, 'cl61').needsYouQuiet, { reason: 'crash_loop', because: 'inactive' });
  assert.equal(r.summary.needsYou, 0);
  // A Kosmos note does not make the room live: a repeated Recommender note in a quiet room must not light it.
  messages.roomNote(p.id, 'Recommender: cl61 is stuck.');
  assert.equal(one(roster, p.id).summary.needsYou, 0, 'a Kosmos note made the room live');
  // A post 25 hours ago is still a quiet room.
  roomPost(p.id, ago(25 * HOUR));
  assert.equal(one(roster, p.id).summary.needsYou, 0, 'a post a day and an hour old made the room live');
  // CONTROL: a post an hour ago, and the same condition counts.
  roomPost(p.id, ago(HOUR));
  r = one(roster, p.id);
  assert.equal(member(r, 'cl61').needsYouHere, 'crash_loop');
  assert.equal(member(r, 'cl61').needsYouQuiet, null);
  assert.equal(r.summary.needsYou, 1, 'CONTROL: a live room did not count the crash loop');
});

test('#6341: out of usage never counts on a project, even a live one (Josh 19:47)', () => {
  reset();
  const p = projects.create({ name: 'Busy', folder: folder('busy'), agents: ['rl61'] });
  roomPost(p.id);
  const roster = cards([fleet.agent('rl61', { state: 'rate_limited' })])
    .map((c) => ({ ...c, stuckError: { stuck: true, state: 'rate_limited', forMs: 30 * 60000 } }));
  const r = one(roster, p.id);
  assert.equal(projects.needsYouReason(member(r, 'rl61'), p.id), 'stuck_rate', 'CONTROL: the agent is out of usage');
  assert.equal(member(r, 'rl61').needsYouHere, null);
  assert.deepEqual(member(r, 'rl61').needsYouQuiet, { reason: 'stuck_rate', because: 'usage' });
  assert.equal(r.summary.needsYou, 0);
});

test('#6341: a paused project raises nothing, a question included', () => {
  reset();
  const p = projects.create({ name: 'Held', folder: folder('held'), agents: ['qq61'] });
  assert.equal(selfreport.record('qq61', { state: 'needs_you', because: 'Which domain?', project: p.id }).recorded, true);
  const roster = cards([fleet.agent('qq61', { state: 'needs_you' })]);
  assert.equal(one(roster, p.id).summary.needsYou, 1, 'CONTROL: the question counts while the project runs');
  projects.edit(p.id, { paused: true, viaScreen: true });
  const r = one(roster, p.id);
  assert.equal(r.summary.needsYou, 0, 'a paused project counted a question');
  assert.deepEqual(member(r, 'qq61').needsYouQuiet, { reason: 'question', because: 'paused' });
});

test('#6341: a question about this project counts in a quiet room (it is about the project, not the agent)', () => {
  reset();
  const p = projects.create({ name: 'Asked', folder: folder('asked'), agents: ['qa61'] });
  assert.equal(selfreport.record('qa61', { state: 'needs_you', because: 'Which logo?', project: p.id }).recorded, true);
  const r = one(cards([fleet.agent('qa61', { state: 'needs_you' })]), p.id);
  assert.equal(member(r, 'qa61').needsYouHere, 'question');
  assert.equal(r.summary.needsYou, 1);
});

test('#6341: a dismissal hides that reason, and a different reason comes back and drops it', () => {
  reset();
  const p = projects.create({ name: 'Dis', folder: folder('dis'), agents: ['qd61'] });
  roomPost(p.id);
  assert.equal(selfreport.record('qd61', { state: 'needs_you', because: 'Which colour?', project: p.id }).recorded, true);
  const asking = cards([fleet.agent('qd61', { state: 'needs_you' })]);
  assert.equal(one(asking, p.id).summary.needsYou, 1, 'CONTROL');
  assert.deepEqual(projects.dismissNeeds(p.id, 'qd61', 'question'), { qd61: 'question' });
  let r = one(asking, p.id);
  assert.equal(r.summary.needsYou, 0, 'a dismissed question still counted');
  assert.deepEqual(member(r, 'qd61').needsYouQuiet, { reason: 'question', because: 'dismissed' });
  assert.deepEqual(projects.readAll().find((x) => x.id === p.id).needsDismissed, { qd61: 'question' }, 'kept while the reason stands');
  // The reason changes: the agent is now in a crash loop in a live room. That is news: shown, and the dismissal dropped.
  selfreport.record('qd61', { state: 'working', because: '', project: p.id });
  r = one(looping('qd61'), p.id);
  assert.equal(member(r, 'qd61').needsYouHere, 'crash_loop', 'a different reason stayed hidden behind an old dismissal');
  assert.equal(r.summary.needsYou, 1);
  assert.equal(projects.readAll().find((x) => x.id === p.id).needsDismissed, undefined, 'the stale dismissal was not dropped');
});

test('#6341: a dismissal is not judged on an agent the board cannot see', () => {
  reset();
  const p = projects.create({ name: 'Unseen', folder: folder('unseen'), agents: ['gh61'] });
  projects.dismissNeeds(p.id, 'gh61', 'crash_loop');
  one([], p.id);   // gh61 is not on the board at all
  assert.deepEqual(projects.readAll().find((x) => x.id === p.id).needsDismissed, { gh61: 'crash_loop' }, 'an unseen agent is not shown to be over it');
});

test('#6341: an "elsewhere" dismissal stands while nothing is counted here, and goes when something is', () => {
  reset();
  const p = projects.create({ name: 'Else', folder: folder('else'), agents: ['ee61'] });
  roomPost(p.id);
  const idle = cards([fleet.agent('ee61', { state: 'idle' })]);
  projects.dismissNeeds(p.id, 'ee61', 'elsewhere');
  let r = one(idle, p.id);
  assert.deepEqual(member(r, 'ee61').needsYouQuiet, { reason: 'elsewhere', because: 'dismissed' });
  assert.deepEqual(projects.readAll().find((x) => x.id === p.id).needsDismissed, { ee61: 'elsewhere' });
  r = one(looping('ee61'), p.id);
  assert.equal(member(r, 'ee61').needsYouHere, 'crash_loop');
  assert.equal(projects.readAll().find((x) => x.id === p.id).needsDismissed, undefined);
});

test('#6341: dismissNeeds refuses what the page cannot have shown', () => {
  reset();
  const p = projects.create({ name: 'Ref', folder: folder('ref'), agents: ['rf61'] });
  assert.throws(() => projects.dismissNeeds(p.id, 'stranger', 'question'), /not on this project/);
  assert.throws(() => projects.dismissNeeds(p.id, 'rf61', 'made_up'), /not a reason/);
  assert.throws(() => projects.dismissNeeds('no-such', 'rf61', 'question'), /no such project/);
  assert.throws(() => projects.dismissNeeds(p.id, '', 'question'), /which agent/);
  assert.equal(projects.readAll().find((x) => x.id === p.id).needsDismissed, undefined, 'a refused dismissal wrote something');
});

test('#6341: lastPostAt reads posts and outside messages only, and keeps up as the log grows', () => {
  reset();
  assert.equal(messages.lastPostAt('pq'), null, 'no log at all');
  messages.roomNote('pq', 'a Kosmos note');
  assert.equal(messages.lastPostAt('pq'), null, 'a note counted as a post');
  const t1 = ago(3 * HOUR);
  roomPost('pq', t1);
  assert.equal(messages.lastPostAt('pq'), Date.parse(t1));
  const t2 = ago(HOUR);
  row({ kind: 'external', id: 'x1', project: 'pq', from: 'Ana', fromKind: 'person', text: 'hi', external: true, at: t2 });
  assert.equal(messages.lastPostAt('pq'), Date.parse(t2), 'the incremental reader missed an appended row');
  assert.equal(messages.lastPostAt('other'), null, 'another project lent its post');
});

test('#6341: the Recommender does not write a note its room already holds (a restart forgot it)', () => {
  const card = { sessionName: 'st61', name: 'Stu', state: 'needs_you', stateReportedBy: 'agent', stateProject: 'rp', because: 'Need the brief' };
  const peer = { sessionName: 'pe61', name: 'Pia', state: 'idle' };
  const members = new Map([['rp', ['st61', 'pe61']]]);
  const setting = { on: true };
  const stuck = recommender.stuckRow(card);
  assert.ok(stuck, 'CONTROL: the fixture is a stuck agent the Recommender acts on');
  const run = (alreadyNoted, prev) => {
    const notes = []; const sent = [];
    // Past the grace period: the item is first seen long ago.
    const first = recommender.step({ prev, roster: [card, peer], setting, members, now: 0 });
    const out = recommender.runOnce({
      prev: first.next, roster: [card, peer], setting, members, now: recommender.GRACE_MS + 1,
      roomNote: (p, t) => { notes.push(t); return true; },
      deliver: (s, t) => { sent.push(s); return { state: 'placed' }; },
      DELIVERY: { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' },
      alreadyNoted,
    });
    return { notes, sent, out };
  };
  const control = run(() => false);
  assert.equal(control.notes.length, 1, 'CONTROL: with no note in the room, the note is written');
  const asked = [];
  const again = run((p, s, b) => { asked.push([p, s, b]); return true; });
  assert.deepEqual(asked, [['rp', 'st61', stuck.because]], 'the room was not asked about this agent and these words');
  assert.equal(again.notes.length, 0, 'a note the room already holds was written again');
  assert.equal(again.sent.length, 0, 'peers or the stuck agent were typed into again');
  assert.equal(again.out.acted[0].verdict, 'already-noted');
  assert.equal(again.out.next.log.length, 0, 'the hour\'s budget was charged for a note not written');
  const rec = [...again.out.next.items.values()][0];
  assert.equal(rec.convened, true, 'the item would be retried');
});

test('#6341: recommenderNoted reads the room on disk, by agent, words, project and age', () => {
  reset();
  messages.roomNote('rp', 'Recommender: Stu is stuck.', { recommender: { stuck: 'st61', asked: [], because: 'Need the brief' } });
  const week = Date.now() - 7 * 24 * HOUR;
  assert.equal(messages.recommenderNoted('rp', 'st61', 'Need the brief', week), true);
  assert.equal(messages.recommenderNoted('rp', 'st61', 'Need the logo', week), false, 'other words matched');
  assert.equal(messages.recommenderNoted('rp', 'other', 'Need the brief', week), false, 'another agent matched');
  assert.equal(messages.recommenderNoted('zz', 'st61', 'Need the brief', week), false, 'another room matched');
  assert.equal(messages.recommenderNoted('rp', 'st61', 'Need the brief', Date.now() + HOUR), false, 'an older note counted as recent');
});

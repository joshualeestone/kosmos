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
/* Set a stored project's fields (a project made two days ago; a dismissal's gone mark from long ago). */
function setStored(id, fields) {
  const all = projects.readAll();
  const at = all.findIndex((x) => x.id === id);
  all[at] = { ...all[at], ...fields };
  projects.writeAll(all);
}
const OLD = () => ago(48 * HOUR);
const one = (roster, id) => projects.list(roster).find((p) => p.id === id);
const member = (r, name) => r.agents.find((m) => m.sessionName === name);
// A crash loop is the agent's own condition, about no project (the real card, with the field server.js attaches).
const looping = (name) => cards([fleet.agent(name, { state: 'working' })]).map((c) => ({ ...c, crashLoop: { looping: true, count: 4 } }));

test('#6341: an agent\'s own condition counts only in a live room (a post in the last day)', () => {
  reset();
  const p = projects.create({ name: 'Idle', folder: folder('idle'), agents: ['cl61'] });
  setStored(p.id, { createdAt: OLD() });   // made two days ago: a new project counts as live (see the next test)
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

test('#6341 review 1: a project made in the last day is live though its room is silent (its agent may be the reason)', () => {
  reset();
  const p = projects.create({ name: 'Fresh', folder: folder('fresh'), agents: ['nw61'] });
  const roster = looping('nw61');
  assert.equal(one(roster, p.id).summary.needsYou, 1, 'a new project hid its only agent\'s crash loop');
  setStored(p.id, { createdAt: OLD() });
  assert.equal(one(roster, p.id).summary.needsYou, 0, 'CONTROL: the same project two days old and silent is quiet');
});

test('#6341 review 1: a message log that cannot be read counts the room as live (fail toward showing)', () => {
  reset();
  const p = projects.create({ name: 'Unread', folder: folder('unread'), agents: ['ur61'] });
  setStored(p.id, { createdAt: OLD() });
  const roster = looping('ur61');
  assert.equal(one(roster, p.id).summary.needsYou, 0, 'CONTROL: quiet while the log reads as empty');
  fs.mkdirSync(LOG(), { recursive: true });   // a directory where the log file should be: record() cannot read it
  try {
    assert.equal(messages.lastPostAt(p.id), undefined, 'an unreadable log read as "no post"');
    assert.equal(one(roster, p.id).summary.needsYou, 1, 'an unreadable log hid an agent\'s condition');
  } finally { fs.rmSync(LOG(), { recursive: true, force: true }); }
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
  // Review 2: the agents' project list (kosmos project list) agrees with the page.
  const listed = require('./projectview').listOf(projects.list(roster)).find((x) => x.id === p.id);
  assert.equal(listed.needsYou, 0, 'kosmos project list still counted the paused project\'s question');
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
  // The reason changes: the agent is now in a crash loop in a live room. That is news: shown at once.
  selfreport.record('qd61', { state: 'working', because: '', project: p.id });
  r = one(looping('qd61'), p.id);
  assert.equal(member(r, 'qd61').needsYouHere, 'crash_loop', 'a different reason stayed hidden behind an old dismissal');
  assert.equal(r.summary.needsYou, 1);
  // Review 1: the dismissal is not dropped on one read (a reading can flicker); its gone mark is set.
  let rec = projects.readAll().find((x) => x.id === p.id);
  assert.deepEqual(rec.needsDismissed, { qd61: 'question' }, 'one read without the reason dropped the dismissal');
  assert.ok(Number.isFinite(Date.parse(rec.needsDismissGone && rec.needsDismissGone.qd61)), 'no gone mark was set');
  // The question back within the grace: still dismissed, and the gone mark cleared.
  r = one(asking, p.id);
  assert.equal(r.summary.needsYou, 0, 'a question back within the grace was shown again');
  assert.equal(projects.readAll().find((x) => x.id === p.id).needsDismissGone, undefined, 'the gone mark outlived the reason\'s return');
  // Gone for longer than the grace: dropped, so the same question later is shown again.
  one(looping('qd61'), p.id);
  setStored(p.id, { needsDismissGone: { qd61: ago(11 * 60 * 1000) } });
  one(looping('qd61'), p.id);
  rec = projects.readAll().find((x) => x.id === p.id);
  assert.equal(rec.needsDismissed, undefined, 'a dismissal whose reason stayed away past the grace was kept');
  assert.equal(rec.needsDismissGone, undefined);
  assert.equal(one(asking, p.id).summary.needsYou, 1, 'the question, back after the dismissal lapsed, was hidden');
});

test('#6341: a dismissal is not judged on an agent the board cannot see', () => {
  reset();
  const p = projects.create({ name: 'Unseen', folder: folder('unseen'), agents: ['gh61'] });
  projects.dismissNeeds(p.id, 'gh61', 'crash_loop');
  one([], p.id);   // gh61 is not on the board at all
  assert.deepEqual(projects.readAll().find((x) => x.id === p.id).needsDismissed, { gh61: 'crash_loop' }, 'an unseen agent is not shown to be over it');
});

test('#6341: an "elsewhere" dismissal stands while the member is red here for another project, and lapses when not', () => {
  reset();
  const p = projects.create({ name: 'Else', folder: folder('else'), agents: ['ee61'] });
  const other = projects.create({ name: 'Other', folder: folder('else-other'), agents: ['ee61'] });
  roomPost(p.id);
  // Red here, about another project: the row the page lists after the counted ones.
  assert.equal(selfreport.record('ee61', { state: 'needs_you', because: 'Which font?', project: other.id }).recorded, true);
  const askingElsewhere = cards([fleet.agent('ee61', { state: 'needs_you' })]);
  projects.dismissNeeds(p.id, 'ee61', 'elsewhere');
  let r = one(askingElsewhere, p.id);
  assert.equal(member(r, 'ee61').needsYouHere, null, 'CONTROL: nothing is counted here for a question about another project');
  assert.deepEqual(member(r, 'ee61').needsYouQuiet, { reason: 'elsewhere', because: 'dismissed' });
  let rec = projects.readAll().find((x) => x.id === p.id);
  assert.deepEqual(rec.needsDismissed, { ee61: 'elsewhere' });
  assert.equal(rec.needsDismissGone, undefined, 'a standing elsewhere dismissal got a gone mark');
  // Review 3: recovered (idle, nothing anywhere): the dismissal starts its grace, then lapses, rather than standing forever.
  selfreport.record('ee61', { state: 'idle', because: '', project: other.id });
  const idle = cards([fleet.agent('ee61', { state: 'idle' })]);
  one(idle, p.id);
  rec = projects.readAll().find((x) => x.id === p.id);
  assert.ok(rec.needsDismissGone && rec.needsDismissGone.ee61, 'a recovered member\'s elsewhere dismissal did not start its grace');
  setStored(p.id, { needsDismissGone: { ee61: ago(11 * 60 * 1000) } });
  one(idle, p.id);
  assert.equal(projects.readAll().find((x) => x.id === p.id).needsDismissed, undefined, 'the elsewhere dismissal outlived the member\'s recovery');
  // A counted reason appearing here is news too: shown at once.
  projects.dismissNeeds(p.id, 'ee61', 'elsewhere');
  r = one(looping('ee61'), p.id);
  assert.equal(member(r, 'ee61').needsYouHere, 'crash_loop', 'a counted reason stayed hidden behind an elsewhere dismissal');
});

test('#6341 review 3: a Dismiss pressed between a read and its upkeep write is not overwritten', () => {
  reset();
  const p = projects.create({ name: 'Race', folder: folder('race'), agents: ['rc61'] });
  roomPost(p.id);
  projects.dismissNeeds(p.id, 'rc61', 'question');
  const roster = looping('rc61');   // the reason is now different: the upkeep wants to start the grace
  one(roster, p.id);
  const snapshot = projects.readAll().find((x) => x.id === p.id);
  assert.ok(snapshot.needsDismissGone && snapshot.needsDismissGone.rc61, 'CONTROL: the grace started');
  setStored(p.id, { needsDismissGone: { rc61: ago(11 * 60 * 1000) } });
  const stale = projects.readAll().find((x) => x.id === p.id);   // a read taken before the person presses Dismiss again
  projects.dismissNeeds(p.id, 'rc61', 'question');   // pressed again: its gone mark is cleared
  projects.describe(stale, roster, projects.readAll());   // the older read's upkeep would drop it (its mark is 11 min old)
  const after = projects.readAll().find((x) => x.id === p.id);
  assert.deepEqual(after.needsDismissed, { rc61: 'question' }, 'a fresh dismissal was dropped by an older read\'s upkeep');
  assert.equal(after.needsDismissGone, undefined, 'an older read restored a gone mark the fresh dismissal had cleared');
});

test('#6341: dismissNeeds refuses what the page cannot have shown', () => {
  reset();
  const p = projects.create({ name: 'Ref', folder: folder('ref'), agents: ['rf61'] });
  assert.throws(() => projects.dismissNeeds(p.id, 'stranger', 'question'), /not on this project/);
  assert.throws(() => projects.dismissNeeds(p.id, 'rf61', 'made_up'), /not a reason/);
  assert.throws(() => projects.dismissNeeds(p.id, 'rf61', 'stuck_rate'), /not a reason/, 'out of usage is never shown on a project, so never dismissed there');
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
    const notes = []; const sent = []; const texts = {};
    // Past the grace period: the item is first seen long ago.
    const first = recommender.step({ prev, roster: [card, peer], setting, members, now: 0 });
    const out = recommender.runOnce({
      prev: first.next, roster: [card, peer], setting, members, now: recommender.GRACE_MS + 1,
      roomNote: (p, t) => { notes.push(t); return true; },
      deliver: (s, t) => { sent.push(s); texts[s] = t; return { state: 'placed' }; },
      DELIVERY: { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' },
      alreadyNoted,
    });
    return { notes, sent, texts, out };
  };
  const control = run(() => false);
  assert.equal(control.notes.length, 1, 'CONTROL: with no note in the room, the note is written');
  const asked = [];
  const again = run((p, s, b) => { asked.push([p, s, b]); return true; });
  assert.deepEqual(asked, [['rp', 'st61', stuck.because]], 'the room was not asked about this agent and these words');
  assert.equal(again.notes.length, 0, 'a note the room already holds was written again');
  assert.deepEqual(control.sent.sort(), ['pe61', 'st61'], 'CONTROL: the peer is asked and the stuck agent gets its playbook');
  // Review 1: only the room's repeat was the complaint; the stuck agent still gets its playbook, the peer is not asked again.
  assert.deepEqual(again.sent, ['st61'], 'the peer was asked again, or the stuck agent got no playbook');
  assert.equal(again.out.acted[0].alreadyNoted, true);
  // Review 2: the playbook says where the earlier replies are, never that nobody could be reached.
  assert.match(again.texts.st61, /noted this in the project room earlier and asked the others then/);
  assert.doesNotMatch(again.texts.st61, /could be reached|No one else is on this project/);
  assert.doesNotMatch(control.texts.st61, /noted this in the project room earlier/, 'CONTROL: a first convening says it as before');
  assert.equal(again.out.acted[0].verdict, 'placed');
  const rec = [...again.out.next.items.values()][0];
  assert.equal(rec.convened, true, 'a delivered playbook would be retried');
});

test('#6341 review 3: a retry of a playbook that did not land still says the room holds the earlier note', () => {
  const card = { sessionName: 'sr61', name: 'Sal', state: 'needs_you', stateReportedBy: 'agent', stateProject: 'rq', because: 'Need the brief' };
  const peer = { sessionName: 'pr61', name: 'Pat', state: 'idle' };
  const members = new Map([['rq', ['sr61', 'pr61']]]);
  const setting = { on: true };
  const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
  const first = recommender.step({ prev: undefined, roster: [card, peer], setting, members, now: 0 });
  const missed = recommender.runOnce({ prev: first.next, roster: [card, peer], setting, members, now: recommender.GRACE_MS + 1,
    roomNote: () => true, deliver: () => ({ state: 'could_not' }), DELIVERY, alreadyNoted: () => true });
  const texts = [];
  recommender.runOnce({ prev: missed.next, roster: [card, peer], setting, members, now: recommender.GRACE_MS + 61000,
    roomNote: () => { throw new Error('a retry wrote a note'); }, deliver: (s, t) => { texts.push([s, t]); return { state: 'placed' }; }, DELIVERY,
    alreadyNoted: () => { throw new Error('a retry asked the room again'); } });
  assert.equal(texts.length, 1, 'CONTROL: the retry delivered the playbook once');
  assert.equal(texts[0][0], 'sr61');
  assert.match(texts[0][1], /noted this in the project room earlier/, 'the retry forgot the room holds the earlier note');
  assert.doesNotMatch(texts[0][1], /could be reached/);
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

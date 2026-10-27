'use strict';

/* #7374: the once-a-day ask to write the product-feedback report. Rosters come from test-support/fleet and the REAL
   status snapshot (fixture discipline: no hand-built cards; a role comes from the real instruction file). Only
   `lastWorked` is set on a real card, because it is read from the provider observer, which a test cannot drive.
   deliver is injected, so no real agent is ever typed into; the data root is a sandbox. */

require('../test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'feedbacknudge-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const feedback = require('./feedback');
const nudge = require('./feedbacknudge');
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const EVENING = new Date(2026, 9, 27, 18, 0, 0);   // local 18:00, past NUDGE_HOUR
const TODAY = feedback.dateKey(EVENING);
const workedAt = new Date(2026, 9, 27, 11, 0, 0).toISOString();
const worked = (c, at = workedAt) => ({ ...c, lastWorked: { at, why: null } });

function roster(specs) {
  return fleet.install(specs.map(([name, opts]) => fleet.agent(name, opts || {}))).agents;
}
/* A role as the REAL role template states it on its first line ("You are **{{NAME}}**, a project manager." gives
   "a project manager"), so the fixture's instruction file carries the template's own words (review 1: a fixture
   spelled "Project Manager" passed while no real card ever matched). */
const roles = require('./roles');
function templateRole(key) {
  const first = roles.byKey(key).instructions.split('\n')[0];
  const m = first.match(/^You are \*\*\{\{NAME\}\}\*\*, (.+)\.$/);
  assert.ok(m, 'the template first line changed shape: ' + first);
  return m[1];
}
const noGuide = () => false;
/* The roster comes back in the board's order, not the order given, so a card is found by its name. */
const by = (cards, name) => cards.find((c) => c.sessionName.startsWith(name)).sessionName;
/* An asked-record that lives in memory, so tests do not share the sandbox file unless they mean to. */
function memAsked(start = null, worked = null) {
  let d = start;
  let w = worked;
  const sets = [];
  return { get: () => d, set: (date, session) => { d = date; sets.push([date, session]); return true; }, sets, workedOn: () => w, markWorked: (date) => { w = date; return true; } };
}
function run(cards, extra = {}) {
  const sent = [];
  const out = nudge.sweepOnce({
    roster: cards, book: extra.book || new Map(), now: extra.now || EVENING,
    send: extra.send || (() => ({ on: true, ok: true })), hasReport: extra.hasReport || (() => false),
    asked: extra.asked || memAsked(), isGuide: extra.isGuide || noGuide, deliver: extra.deliver || ((s, t) => { sent.push([s, t]); return { state: DELIVERY.PLACED }; }),
    DELIVERY, log: extra.log,
  });
  return { out, sent };
}

test('asks one idle agent when today has no report, and says what it costs and how to opt out', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const { out, sent } = run(cards);
  assert.equal(out.result.act, 'nudge', JSON.stringify(out));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], cards[0].sessionName);
  assert.match(sent[0][1], /one turn on your person's AI account/);
  assert.match(sent[0][1], /Settings, Automation/);
  assert.match(sent[0][1], /kosmos feedback write/);
});

test('a Project Manager or Director is asked before the first agent on the roster', () => {
  const cards = roster([['abe'], ['pia', { displayName: 'Pia', role: templateRole('pm') }]]).map((c) => worked(c));
  assert.equal(cards.find((c) => c.sessionName.startsWith('pia')).role, 'project manager', 'the card reads the role as the board does');
  const { sent } = run(cards);
  assert.equal(sent[0][0], by(cards, 'pia'));
  const dir = roster([['abe'], ['dot', { displayName: 'Dot', role: templateRole('director') }]]).map((c) => worked(c));
  assert.equal(run(dir).sent[0][0], by(dir, 'dot'));
  // A Project Manager before a Project Director, wherever each sits.
  const both = roster([['dot', { displayName: 'Dot', role: templateRole('director') }], ['pia', { displayName: 'Pia', role: templateRole('pm') }]]).map((c) => worked(c));
  assert.equal(run(both).sent[0][0], by(both, 'pia'));
  // Control: with no such role, the first idle card on the roster.
  const plain = roster([['zed'], ['bo']]).map((c) => worked(c));
  assert.equal(run(plain).sent[0][0], plain[0].sessionName);
});

test('a working agent is never interrupted; the idle one is asked instead, or nobody', () => {
  const cards = roster([['pia', { displayName: 'Pia', role: templateRole('pm'), state: 'working' }], ['bo']]).map((c) => worked(c));
  assert.equal(run(cards).sent[0][0], by(cards, 'bo'));
  const busy = roster([['pia', { state: 'working' }]]).map((c) => worked(c));
  const r = run(busy);
  assert.equal(r.sent.length, 0);
  assert.equal(r.out.result.because, 'no idle agent to ask');
});

test('nobody is asked when sending is off or its setting is unreadable, or today already has a report', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  assert.equal(run(cards, { send: () => ({ on: false, ok: true }) }).sent.length, 0);
  assert.equal(run(cards, { send: () => ({ on: false, ok: false }) }).sent.length, 0);
  assert.equal(run(cards, { send: () => { throw new Error('x'); } }).sent.length, 0);
  assert.equal(run(cards, { hasReport: () => true }).sent.length, 0);
  // An unreadable report store asks nobody (a report may be there).
  assert.equal(run(cards, { hasReport: () => { throw new Error('x'); } }).sent.length, 0);
  // Control: the same roster with all gates open is asked.
  assert.equal(run(cards).sent.length, 1);
});

test('not before NUDGE_HOUR, and not on a day no agent worked', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const noon = new Date(2026, 9, 27, nudge.NUDGE_HOUR - 1, 59, 0);
  assert.equal(run(cards, { now: noon }).sent.length, 0);
  const yesterday = roster([['mara']]).map((c) => worked(c, new Date(2026, 9, 26, 15, 0, 0).toISOString()));
  assert.equal(run(yesterday).out.result.because, 'no agent worked today');
  const never = roster([['mara']]).map((c) => ({ ...c, lastWorked: { at: null, why: 'not_seen' } }));
  assert.equal(run(never).sent.length, 0);
  // A provider Kosmos cannot see (Antigravity, Muse) does not block the ask.
  const unseen = roster([['mara']]).map((c) => ({ ...c, lastWorked: { at: null, why: 'no_source' } }));
  assert.equal(run(unseen).sent.length, 1);
});

test('once a day: the record stops a second ask, including after a restart', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const asked = memAsked();
  const book = new Map();
  assert.equal(run(cards, { asked, book }).sent.length, 1);
  assert.deepEqual(asked.sets, [[TODAY, cards[0].sessionName]]);
  assert.equal(run(cards, { asked, book, now: new Date(2026, 9, 27, 20, 0, 0) }).sent.length, 0);
  // A restart: the in-memory book is gone, the record on disk is not.
  assert.equal(run(cards, { asked, book: new Map() }).sent.length, 0);
  // Control: the next evening is a new day.
  assert.equal(run(cards.map((c) => worked(c, new Date(2026, 9, 28, 9, 0, 0).toISOString())), { asked, book: new Map(), now: new Date(2026, 9, 28, 18, 0, 0) }).sent.length, 1);
});

test('the record on disk is written and read back through the real file', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const real = { get: undefined };   // not a reader: sweepOnce falls back to the file
  assert.equal(run(cards, { asked: real }).sent.length, 1);
  const saved = JSON.parse(fs.readFileSync(nudge.askedFile(), 'utf8'));
  assert.deepEqual(saved, { workedOn: TODAY, date: TODAY, session: cards[0].sessionName });
  assert.equal(run(cards, { asked: real }).sent.length, 0, 'asked again from the file');
});

test('a delivery that reached nothing is retried up to MAX_TRIES; a hold spends no try', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const book = new Map();
  const asked = memAsked();
  let calls = 0;
  const held = () => { calls++; return { state: DELIVERY.COULD_NOT, held: true, heldBy: 'menu' }; };
  for (let i = 0; i < 5; i++) run(cards, { book, asked, deliver: held });
  assert.equal(calls, 5, 'a hold is tried again each tick');
  assert.equal(book.get('day').tries, 0, 'a hold spent no try');
  const fail = () => { calls++; return { state: DELIVERY.COULD_NOT }; };
  calls = 0;
  for (let i = 0; i < 5; i++) run(cards, { book, asked, deliver: fail });
  assert.equal(calls, nudge.MAX_TRIES);
  assert.deepEqual(asked.sets, [], 'nothing reached it, so nothing is recorded as asked');
});

test('the tick is inert without live execution and under the operator brake', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  let sent = 0;
  const deps = (allowed, env) => ({
    allowed: () => allowed, env, roster: () => cards, book: new Map(), now: () => EVENING,
    send: () => ({ on: true, ok: true }), hasReport: () => false, asked: memAsked(),
    deliver: () => { sent++; return { state: DELIVERY.PLACED }; }, DELIVERY,
  });
  assert.equal(nudge.makeTick(deps(false, {}))(), null);
  assert.equal(nudge.makeTick(deps(true, { AGENT_WORKFORCE_FEEDBACK_NUDGE_OFF: '1' }))(), null);
  assert.equal(sent, 0);
  nudge.makeTick(deps(true, {}))();
  assert.equal(sent, 1, 'control: allowed and no brake, it asks');
});

test('the roles asked first are the real Project Manager and Director, compared as words', () => {
  assert.deepEqual(nudge.firstLabels(), ['project manager', 'project director']);
  assert.equal(nudge.roleWords('a project manager.'), 'project manager');
  assert.equal(nudge.roleWords('Project Manager'), 'project manager');
  assert.equal(nudge.roleWords('An Editor'), 'editor');
  assert.equal(nudge.roleWords(null), '');
});

test('a held agent passes the ask to the next candidate in the same tick', () => {
  const cards = roster([['pia', { displayName: 'Pia', role: templateRole('pm') }], ['bo']]).map((c) => worked(c));
  const tried = [];
  const asked = memAsked();
  const deliver = (s) => { tried.push(s); return s === by(cards, 'pia') ? { state: DELIVERY.COULD_NOT, held: true, heldBy: 'limit' } : { state: DELIVERY.PLACED }; };
  const { out } = run(cards, { deliver, asked });
  assert.deepEqual(tried, [by(cards, 'pia'), by(cards, 'bo')]);
  assert.equal(out.result.act, 'nudge');
  assert.equal(out.result.session, by(cards, 'bo'));
  assert.deepEqual(asked.sets, [[TODAY, by(cards, 'bo')]]);
});

test('the setup guide is never the agent asked', () => {
  const cards = roster([['abe'], ['bo']]).map((c) => worked(c));
  const guide = by(cards, 'abe');
  assert.equal(run(cards, { isGuide: (s) => s === guide }).sent[0][0], by(cards, 'bo'));
  const only = roster([['abe']]).map((c) => worked(c));
  assert.equal(run(only, { isGuide: () => true }).sent.length, 0);
  // A guide check that throws leaves that card out, rather than ask a guide.
  assert.equal(run(only, { isGuide: () => { throw new Error('x'); } }).sent.length, 0);
});

test('one agent refusing does not lose the day: the next is asked, and one try is spent only when all refuse', () => {
  const cards = roster([['pia', { displayName: 'Pia', role: templateRole('pm') }], ['bo']]).map((c) => worked(c));
  const tried = [];
  const book = new Map();
  const asked = memAsked();
  const pmRefuses = (s) => { tried.push(s); return s === by(cards, 'pia') ? { state: DELIVERY.COULD_NOT } : { state: DELIVERY.PLACED }; };
  const { out } = run(cards, { deliver: pmRefuses, book, asked });
  assert.deepEqual(tried, [by(cards, 'pia'), by(cards, 'bo')]);
  assert.equal(out.result.session, by(cards, 'bo'));
  assert.equal(book.get('day').tries, 0);
  // All refuse: one try for the tick, not one per candidate.
  const book2 = new Map();
  let calls = 0;
  run(cards, { deliver: () => { calls++; return { state: DELIVERY.COULD_NOT }; }, book: book2, asked: memAsked() });
  assert.equal(calls, 2);
  assert.equal(book2.get('day').tries, 1);
  // One held, the next refuses: still exactly one try.
  const book3 = new Map();
  run(cards, { deliver: (s) => (s === by(cards, 'pia') ? { state: DELIVERY.COULD_NOT, held: true, heldBy: 'menu' } : { state: DELIVERY.COULD_NOT }), book: book3, asked: memAsked() });
  assert.equal(book3.get('day').tries, 1);
});

test('quiet hours and the usage cap spend no try and stop the tick', () => {
  const cards = roster([['abe'], ['bo']]).map((c) => worked(c));
  for (const flag of ['quiet', 'capped']) {
    const book = new Map();
    let calls = 0;
    for (let i = 0; i < 5; i++) run(cards, { book, asked: memAsked(), deliver: () => { calls++; return { state: DELIVERY.COULD_NOT, [flag]: true }; } });
    assert.equal(calls, 5, flag + ': one call a tick, the tick stops at the first');
    assert.equal(book.get('day').tries, 0, flag + ' spent a try');
    // Control: once it lifts, the same day is asked.
    assert.equal(run(cards, { book, asked: memAsked() }).sent.length, 1);
  }
});

test('an unconfirmed delivery counts as asked and is recorded, so it is never asked twice', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const asked = memAsked();
  const book = new Map();
  const r = run(cards, { asked, book, deliver: () => ({ state: DELIVERY.UNCONFIRMED }) });
  assert.equal(r.out.result.delivered, false);
  assert.deepEqual(asked.sets, [[TODAY, cards[0].sessionName]]);
  assert.equal(run(cards, { asked, book: new Map() }).sent.length, 0);
});

test('work seen in the morning survives a restart that forgets it', () => {
  const asked = memAsked();
  const morning = roster([['mara']]).map((c) => worked(c));
  run(morning, { asked, now: new Date(2026, 9, 27, 10, 0, 0) });   // before NUDGE_HOUR: nobody asked, the work is kept
  assert.equal(asked.workedOn(), TODAY);
  const afterRestart = roster([['mara']]).map((c) => ({ ...c, lastWorked: { at: null, why: 'not_seen' } }));
  assert.equal(run(afterRestart, { asked }).sent.length, 1);
  // Control: with no record of the morning, the same roster is not asked.
  assert.equal(run(afterRestart, { asked: memAsked() }).sent.length, 0);
});

test('a delivery that throws counts as maybe reached: recorded as asked, and nobody else is typed into', () => {
  const cards = roster([['pia', { displayName: 'Pia', role: templateRole('pm') }], ['bo']]).map((c) => worked(c));
  const tried = [];
  const asked = memAsked();
  const { out } = run(cards, { asked, deliver: (s) => { tried.push(s); throw new Error('after the keystroke'); } });
  assert.deepEqual(tried, [by(cards, 'pia')], 'a second agent was typed into');
  assert.equal(out.result.delivered, false);
  assert.match(out.result.delivery, /^threw: /);
  assert.deepEqual(asked.sets, [[TODAY, by(cards, 'pia')]]);
});

test('a busy pane is passed over like a held one and costs no try', () => {
  const cards = roster([['pia', { displayName: 'Pia', role: templateRole('pm') }], ['bo']]).map((c) => worked(c));
  const book = new Map();
  const busyPm = (s) => (s === by(cards, 'pia') ? { state: DELIVERY.COULD_NOT, busy: true } : { state: DELIVERY.PLACED });
  assert.equal(run(cards, { book, deliver: busyPm }).out.result.session, by(cards, 'bo'));
  const only = roster([['pia']]).map((c) => worked(c));
  const book2 = new Map();
  run(only, { book: book2, deliver: () => ({ state: DELIVERY.COULD_NOT, busy: true }) });
  assert.equal(book2.get('day').tries, 0);
});

/* The server's log line reads name, session, act, delivery and because (server.js, feedback-nudge); every line must
   carry them in the shape it prints. */
function logShape(r) {
  for (const k of ['name', 'session', 'act', 'because']) assert.equal(typeof r[k], 'string', k + ' in ' + JSON.stringify(r));
  assert.ok(r.delivery === null || typeof r.delivery === 'string', 'delivery in ' + JSON.stringify(r));
}

test('logs: a held day once, a failed record once, and tries 1 and MAX_TRIES but not between', () => {
  const cards = roster([['mara']]).map((c) => worked(c));
  const lines = [];
  const log = (r) => { logShape(r); lines.push(r); };
  const book = new Map();
  for (let i = 0; i < 5; i++) run(cards, { book, log, asked: memAsked(), deliver: () => ({ state: DELIVERY.COULD_NOT, held: true, heldBy: 'menu' }) });
  assert.equal(lines.filter((l) => l.act === 'held').length, 1, JSON.stringify(lines));
  lines.length = 0;
  const failing = { ...memAsked(), set: () => false };
  run(cards, { log, asked: failing });
  assert.equal(lines.filter((l) => l.act === 'record').length, 1, JSON.stringify(lines));
  assert.equal(lines.filter((l) => l.act === 'nudge' && l.delivered === true).length, 1);
  lines.length = 0;
  const book3 = new Map();
  const counts = [];
  for (let i = 0; i < nudge.MAX_TRIES; i++) {
    const before = lines.length;
    run(cards, { book: book3, log, asked: memAsked(), deliver: () => ({ state: DELIVERY.COULD_NOT }) });
    counts.push(lines.length - before);
  }
  assert.deepEqual(counts, [1, 0, 1]);
  assert.match(lines[lines.length - 1].because, /today is left alone/);
});

test('the Project Manager role and the board ask agree that the report is sent, and name the same opt-out', () => {
  // Review 4: the role said only "saved here, on this computer" while the ask said it is sent.
  const pm = roles.byKey('pm').instructions.replace(/\s+/g, ' ');
  const ask = nudge.nudgeText();
  for (const text of [pm, ask]) {
    assert.match(text, /sent to the Kosmos team \(scrubbed\)/);
    assert.match(text, /Settings, Automation/);
  }
  assert.doesNotMatch(pm, /It is saved here, on this computer\.(?! *and)/);
});

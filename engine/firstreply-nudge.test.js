'use strict';

/* #3226: the one-time first-reply nudge. Rosters come from test-support/fleet and the REAL status
   snapshot (fixture discipline: no hand-built cards). deliver is injected, so no real agent is ever
   typed into. The planner tests hand-build a DIRECT thread's rows; the integration tests at the end
   do NOT: they write the person's DM and the agent's reply through the real chat store in a
   sandboxed data root, and let the sweep read it through its own default reader. */

require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'firstreply-nudge-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const chat = require('./chat');
const messageLog = require('./messages');
const nudge = require('./firstreply-nudge');
/* #4354 writes profiles here too: prove the store is this sandbox, against the real data root. */
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const HEARD = new Date(NOW - 90 * 1000).toISOString(); // 90 s ago: past the minute
const rosterOf = (state) => fleet.install([fleet.agent('mara', { screen: state === 'working' ? fleet.SCREEN.working : fleet.SCREEN.idle, state })]).agents;
const idleCard = () => rosterOf('idle')[0];
/* Row shapes as the two writers store them (server.js: the DM route and keepAgentReply). */
const personRow = (at = HEARD, state = 'placed') => ({ at, text: 'hello, are you there?', from: null, wire: null, delivery: { state, because: null } });
const agentRow = (session, at = HEARD) => ({ at, text: 'yes, here', from: session });
const fcOf = (rows) => nudge.firstContact({ messages: rows });
const owesFirst = () => fcOf([personRow()]);

test('#3226 fixture: the idle fleet card really reads idle', () => {
  assert.equal(idleCard().state, 'idle');
  assert.equal(rosterOf('working')[0].state, 'working');
});

test('#3226 firstContact: a placed person message and no agent row owes; each other shape does not', () => {
  const s = idleCard().sessionName;
  assert.deepEqual(owesFirst(), { state: 'owes', heardAt: HEARD, because: null });
  assert.equal(fcOf([personRow(), agentRow(s), personRow()]).state, 'clear', 'an agent that answered once is not on first contact');
  assert.equal(fcOf([personRow(), agentRow('someone-else')]).state, 'clear', 'a row we cannot place is never read as silence');
  assert.equal(fcOf([]).state, 'clear', 'nobody has written');
  assert.equal(fcOf([personRow(HEARD, 'could_not')]).state, 'clear', 'a message that never reached the pane is not owed');
  assert.equal(fcOf([personRow(HEARD, 'unconfirmed')]).state, 'clear');
  assert.equal(fcOf([{ ...personRow(), delivery: null }]).state, 'clear');
  assert.equal(fcOf([{ ...personRow(), wire: '1' }]).state, 'clear', 'a menu answer is not a message');
  // Kosmos's own derived rows are not the agent speaking, and are not the person either.
  assert.equal(fcOf([personRow(), { at: HEARD, text: 'x', from: s, kind: 'question' }]).state, 'owes');
  assert.equal(nudge.firstContact(null).state, 'unknown');
  assert.equal(nudge.firstContact({ messages: 'x' }).state, 'unknown');
});

test('#3226 plan: every condition true nudges', () => {
  assert.equal(nudge.plan(idleCard(), owesFirst(), undefined, NOW).act, 'nudge');
});

test('#3226 plan: not idle does not nudge', () => {
  assert.notEqual(nudge.plan(rosterOf('working')[0], owesFirst(), undefined, NOW).act, 'nudge');
});

test('#3226 plan: owing nothing does not nudge (clear and unknown)', () => {
  for (const state of ['clear', 'unknown']) {
    assert.notEqual(nudge.plan(idleCard(), { ...owesFirst(), state }, undefined, NOW).act, 'nudge', state);
  }
  assert.notEqual(nudge.plan(idleCard(), null, undefined, NOW).act, 'nudge');
});

test('#3226 plan: a person message under a minute old waits', () => {
  assert.equal(nudge.plan(idleCard(), fcOf([personRow(new Date(NOW - 30 * 1000).toISOString())]), undefined, NOW).act, 'wait');
  // the boundary: exactly a minute is enough
  assert.equal(nudge.plan(idleCard(), fcOf([personRow(new Date(NOW - nudge.MIN_QUIET_MS).toISOString())]), undefined, NOW).act, 'nudge');
});

test('#3226 plan: an unreadable heard time does not nudge', () => {
  assert.notEqual(nudge.plan(idleCard(), { ...owesFirst(), heardAt: null }, undefined, NOW).act, 'nudge');
  assert.notEqual(nudge.plan(idleCard(), { ...owesFirst(), heardAt: 1234 }, undefined, NOW).act, 'nudge', 'a bare number is not a time');
});

test('#3226 plan: a recorded nudge means none, ever; so does a spent try budget', () => {
  assert.equal(nudge.plan(idleCard(), owesFirst(), { nudgedAt: NOW - 1000 }, NOW).act, 'none');
  // a try that did not reach the pane is not a spent nudge
  assert.equal(nudge.plan(idleCard(), owesFirst(), { nudgedAt: null, tries: 1 }, NOW).act, 'nudge');
  assert.equal(nudge.plan(idleCard(), owesFirst(), { nudgedAt: null, tries: nudge.MAX_TRIES }, NOW).act, 'none');
});

test('#3226 nudge text names the reply verb the CLI ships and has no em dash', () => {
  assert.match(nudge.NUDGE_TEXT, /kosmos reply "<your answer>"/);
  // #4784: the reminder has no message text, so it says how to read the message.
  assert.match(nudge.NUDGE_TEXT, /read it with: kosmos inbox/);
  assert.ok(!nudge.NUDGE_TEXT.includes(String.fromCharCode(0x2014)), 'no em dash in the nudge');
  const cli = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos'), 'utf8');
  assert.match(cli, /^\s*reply\)\s+shift; cmd_reply "\$@"/m, 'install/kosmos dispatches the reply verb');
  assert.match(cli, /^\s*inbox\)\s+shift; cmd_inbox "\$@"/m, 'install/kosmos dispatches the inbox verb the nudge names');
});

function sweepWith(opts) {
  const sent = [];
  const logs = [];
  const o = {
    roster: opts.roster || rosterOf('idle'), book: opts.book || new Map(), now: opts.now || NOW,
    thread: opts.thread || (() => ({ messages: [personRow()] })),
    deliver: opts.deliver || ((session, text) => { sent.push({ session, text }); return { state: DELIVERY.PLACED }; }),
    DELIVERY, log: (r) => logs.push(r),
  };
  return { o, sent, logs };
}

test('#3226 sweep: delivers once, and a second sweep sends nothing', () => {
  const book = new Map();
  const { o, sent } = sweepWith({ book });
  const r1 = nudge.sweepOnce(o);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, nudge.NUDGE_TEXT);
  assert.equal(r1.results[0].delivered, true);
  assert.equal(book.get(sent[0].session).nudgedAt, NOW);
  nudge.sweepOnce({ ...o, now: NOW + 60 * 60 * 1000 });
  assert.equal(sent.length, 1, 'one nudge per session, ever');
});

test('#3226 sweep: a could_not delivery is tried again, at most MAX_TRIES times, then left alone', () => {
  const book = new Map();
  let calls = 0;
  const { o, logs } = sweepWith({ book, deliver: () => { calls++; return { state: DELIVERY.COULD_NOT }; } });
  nudge.sweepOnce(o);
  const session = o.roster[0].sessionName;
  assert.equal(book.get(session).nudgedAt, null);
  nudge.sweepOnce(o);
  assert.equal(calls, 2, 'a try that reached nothing is tried again');
  for (let i = 0; i < 5; i++) nudge.sweepOnce(o);
  assert.equal(calls, nudge.MAX_TRIES, 'a refusing pane is not retried every minute forever');
  assert.equal(nudge.MAX_TRIES, 3);
  assert.equal(logs.length, 2, 'logged on the first try and when given up on, not every sweep');
  assert.match(logs[1].because, /left alone/);
});

test('#3226 sweep: an unconfirmed delivery counts as spent (re-sending may duplicate it)', () => {
  const book = new Map();
  let calls = 0;
  const { o } = sweepWith({ book, deliver: () => { calls++; return { state: DELIVERY.UNCONFIRMED }; } });
  nudge.sweepOnce(o);
  nudge.sweepOnce(o);
  assert.equal(calls, 1);
});

test('#3226 sweep: a throwing deliver or thread read does not throw out and records no nudge', () => {
  const book = new Map();
  const { o } = sweepWith({ book, deliver: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => nudge.sweepOnce(o));
  assert.equal(book.get(o.roster[0].sessionName).nudgedAt, null);
  const b2 = new Map();
  const { o: o2, sent } = sweepWith({ book: b2, thread: () => { const e = new Error('unreadable'); e.code = 'UNREADABLE'; throw e; } });
  assert.doesNotThrow(() => nudge.sweepOnce(o2));
  assert.equal(sent.length, 0);
  assert.doesNotThrow(() => nudge.sweepOnce({ ...o, log: () => { throw new Error('log'); } }));
  assert.doesNotThrow(() => nudge.sweepOnce(null));
  assert.deepEqual(nudge.sweepOnce({ roster: null }).results, []);
});

test('#3226 sweep: a working agent and an agent that replied before are not typed into', () => {
  const { o, sent } = sweepWith({ roster: rosterOf('working') });
  nudge.sweepOnce(o);
  const s = idleCard().sessionName;
  const { o: o2, sent: sent2 } = sweepWith({ thread: () => ({ messages: [personRow(), agentRow(s), personRow()] }) });
  nudge.sweepOnce(o2);
  assert.equal(sent.length + sent2.length, 0);
});

test('#3226 tick: inert unless live execution is allowed, and the brake stops it', () => {
  let delivered = 0;
  const deps = (allowed, env) => ({
    allowed: () => allowed, env, roster: () => rosterOf('idle'), book: new Map(), now: () => NOW,
    thread: () => ({ messages: [personRow()] }), deliver: () => { delivered++; return { state: DELIVERY.PLACED }; }, DELIVERY,
  });
  assert.equal(nudge.makeTick(deps(false, {}))(), null);
  assert.equal(nudge.makeTick(deps(true, { AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF: '1' }))(), null);
  assert.equal(delivered, 0);
  assert.ok(nudge.makeTick(deps(true, {}))());
  assert.equal(delivered, 1);
  assert.equal(nudge.nudgeEnabled(true, { AGENT_WORKFORCE_FIRSTREPLY_NUDGE_OFF: '0' }), true);
  // an unreadable roster skips the tick; a throwing roster never throws out
  assert.equal(nudge.makeTick({ ...deps(true, {}), roster: () => null })(), null);
  assert.equal(nudge.makeTick({ ...deps(true, {}), roster: () => { throw new Error('x'); } })(), null);
});

/* ── integration: the REAL chat store, read by the sweep's own default reader ─────────────────
   No `thread` is injected below, so what is exercised is the production read path
   (directThread -> chat.readThread(chat.DIRECT, sessionName)). Rows are written with
   chat.appendMessage exactly as server.js writes them: the DM route stores the person's row with
   no `from` and the delivery verdict, keepAgentReply stores the agent's with from: sessionName. */

function freshStore(session) {
  fs.rmSync(chat.threadFile(chat.DIRECT, session), { force: true });
  fs.rmSync(messageLog.LOG, { force: true });
}
function personDm(session, at = HEARD) {
  const kept = chat.appendMessage(chat.DIRECT, session, { text: 'hello, are you there?', wire: null, at, delivery: { state: 'placed', at, because: null } });
  assert.equal(kept.recorded, true, 'the fixture did not record the person\'s DM: ' + (kept.because || ''));
}
function realSweep(roster) {
  const sent = [];
  const r = nudge.sweepOnce({
    roster, book: new Map(), now: NOW, DELIVERY,
    deliver: (session, text) => { sent.push({ session, text }); return { state: DELIVERY.PLACED }; },
  });
  return { sent, r };
}

test('#3226 real store: a person\'s unanswered first DM, a minute old, is nudged', () => {
  const roster = rosterOf('idle');
  const s = roster[0].sessionName;
  freshStore(s);
  personDm(s);
  // Why the message log could never have seen this: the person's DM is not in it. (#4340 deleted owesReply, which
  // read that log; the premise is checked on the log itself.)
  const logged = messageLog.record();
  // An unreadable log proves nothing about what is in it (Scorpion's NIT on #4365), so it must read first.
  assert.ok(logged.ok, 'premise: the message log could not be read, so this proves nothing');
  assert.ok(!logged.rows.some((r) => r.to === s), 'premise: a DM leaves the message log untouched');
  const { sent } = realSweep(roster);
  assert.equal(sent.length, 1, 'the card\'s own case was not nudged');
  assert.equal(sent[0].session, s);
});

test('#3226 real store CONTROL: once the agent has replied (keepAgentReply\'s write), no nudge', () => {
  const roster = rosterOf('idle');
  const s = roster[0].sessionName;
  freshStore(s);
  personDm(s, new Date(NOW - 10 * 60 * 1000).toISOString());
  const kept = chat.appendMessage(chat.DIRECT, s, { text: 'yes, here', at: new Date(NOW - 9 * 60 * 1000).toISOString(), from: s });
  assert.equal(kept.recorded, true);
  personDm(s); // the person's SECOND message, also unanswered: not first contact
  const { sent } = realSweep(roster);
  assert.equal(sent.length, 0, 'an agent that has answered its person was told it never had');
});

test('#3226 real store CONTROL: a colleague `kosmos msg` with an empty DIRECT thread does not nudge', () => {
  const roster = rosterOf('idle');
  const s = roster[0].sessionName;
  freshStore(s);
  fs.mkdirSync(path.dirname(messageLog.LOG), { recursive: true });
  fs.writeFileSync(messageLog.LOG, JSON.stringify({ kind: 'message', id: 'c1', from: 'leo', to: s, text: 'are you free?', at: HEARD }) + '\n');
  // Positive control: this row IS what the first build read as "owes its first reply" (through owesReply, deleted
  // by #4340): a colleague's message in the log, addressed to the agent, with nothing from the agent after it.
  const logged = messageLog.record();
  assert.ok(logged.ok && logged.rows.some((r) => r.id === 'c1' && r.kind === 'message' && r.to === s),
    'the fixture did not reach the message log');
  assert.ok(!logged.rows.some((r) => r.from === s), 'fixture: the agent has already written in the log');
  const { sent } = realSweep(roster);
  assert.equal(sent.length, 0, 'a colleague\'s message was read as the person\'s');
});

/* #4354: Kosmos's daily-limit notice is written in the agent's name. It must not count as the agent answering
   once it runs again, and while it is paused the sweep must leave it alone (its pane refuses the text, and each
   refused try spends the budget). Through the REAL store, the REAL profile read (no `paused` injected) and
   swarm.pausedFor, the sweep's own pause writer. */
test('#4354 real store: a first DM behind the daily-limit notice is left alone while paused and nudged once running', () => {
  const store = require('./store');
  const swarm = require('./swarm');
  const roster = rosterOf('idle');
  const s = roster[0].sessionName;
  freshStore(s);
  const pausedAt = NOW - 60 * 1000;
  try {
    store.writeProfile(s, swarm.birthProfile({ dailyTokenLimit: 1000 }));
    store.writeProfile(s, { swarm: swarm.pausedFor(swarm.settingsOf(store.readProfile(s)), 'limit', pausedAt) });
    assert.equal(swarm.pauseOf(store.readProfile(s)).paused, true, 'fixture: the swarm is not paused');
    personDm(s);
    const kept = chat.appendMessage(chat.DIRECT, s, { text: 'I paused myself at today\'s token limit', at: new Date(pausedAt).toISOString(), from: s, kosmos: true });
    assert.equal(kept.recorded, true);
    const paused = realSweep(roster);
    assert.equal(paused.sent.length, 0, 'a paused swarm was nudged (its pane refuses the text and the tries run out)');
    assert.equal(paused.r.results.length, 0, 'the sweep spent a try on a paused swarm');
    store.writeProfile(s, { swarm: { ...swarm.settingsOf(store.readProfile(s)), active: true, pausedBecause: null, pausedAt: null } });
    const running = realSweep(roster);
    assert.equal(running.sent.length, 1, 'running again and still unanswered, but the notice read as its first answer');
  } finally {
    fs.rmSync(path.join(require('./store').ROOT, require('./store').PROFILES_DIRNAME), { recursive: true, force: true });
  }
});

test('#4354 real store: a swarm the PERSON switched off (no notice) is left alone, and no try is spent on it', () => {
  const store = require('./store');
  const swarm = require('./swarm');
  const roster = rosterOf('idle');
  const s = roster[0].sessionName;
  freshStore(s);
  try {
    store.writeProfile(s, swarm.birthProfile({ dailyTokenLimit: 1000 }));
    store.writeProfile(s, { swarm: swarm.applyPatch(store.readProfile(s), { active: false }, NOW - 60 * 1000) });
    assert.equal(swarm.pauseOf(store.readProfile(s)).paused, true, 'fixture: the person\'s pause did not take');
    personDm(s);
    const book = new Map();
    const sent = [];
    nudge.sweepOnce({ roster, book, now: NOW, DELIVERY, deliver: (session) => { sent.push(session); return { state: DELIVERY.COULD_NOT }; } });
    assert.equal(sent.length, 0, 'a switched-off swarm was tried');
    assert.equal(book.get(s), undefined, 'a try was spent on a switched-off swarm, and three of them leave it never nudged');
    store.writeProfile(s, { swarm: swarm.applyPatch(store.readProfile(s), { active: true }, NOW) });
    assert.equal(realSweep(roster).sent.length, 1, 'CONTROL: switched back on, the same first message is nudged');
  } finally {
    fs.rmSync(path.join(require('./store').ROOT, require('./store').PROFILES_DIRNAME), { recursive: true, force: true });
  }
});

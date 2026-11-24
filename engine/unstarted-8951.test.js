'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#8951: a message a Windows Claude agent took in and never ran is reported, not lost in silence.
 *
 * On 11-23 three messages were written into an idle Windows agent; each time the process died about 0.6 s later and
 * the supervisor resumed it without the message, so the sender heard nothing for four hours. Two shapes are covered:
 *   - the process ends while a written message has not yet run: carried to the next process's record (lostOnStop);
 *   - no sign of a turn (init, assistant, user, result) by START_DEADLINE_MS after a write into an idle agent: the agent
 *     stops reading busy and the message is recorded as not started.
 * Either way the card carries a 'turn' stall marked `unstarted`, which the page, the CLI list, the board log and the
 * needs-you push all say, until a turn starts.
 *
 *   node --test engine/unstarted-8951.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unstarted-8951-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const ss = require('./win32streamstate');
const ds = require('./deliverystreak');
const fleet = require('../test-support/fleet');
const status = require('./status');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const MIN = 60 * 1000;
const init = { type: 'system', subtype: 'init' };
const result = { type: 'result', is_error: false };
const T0 = Date.parse('2026-11-23T21:40:12.905Z');

/* A publisher that records every write and every deadline it arms, on a clock the test moves. */
function recording() {
  const wrote = [];
  const timers = [];
  const told = [];
  const clock = { t: T0 };
  const pub = ss.publisher('homer', {
    write: (rec) => { wrote.push(rec); return { ok: true }; }, clear: () => {},
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return null; },
    now: () => clock.t, onUnstarted: (u) => told.push(u),
  });
  return { pub, wrote, timers, told, clock, last: () => wrote[wrote.length - 1], fire: () => { for (const t of timers.splice(0)) t.fn(); } };
}

const HOLD = 2 * MIN;   // win32streamstate's REPORT_HOLD_MS

test('#8951: a write into an idle agent with no turn by the deadline stops reading busy and is recorded as not started', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote();
  assert.equal(r.last().state, 'busy', 'premise: a write into an idle agent reads busy');
  assert.equal(r.timers.length, 1, 'one deadline armed');
  assert.equal(r.timers[0].ms, ss.START_DEADLINE_MS);
  r.clock.t += ss.START_DEADLINE_MS;
  r.fire();
  assert.equal(r.last().state, 'idle', 'not left at busy');
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 1 });
  assert.deepEqual(r.told, [{ since: new Date(T0).toISOString(), count: 1, lost: false }], 'the supervisor is told');
});

test('#8951: CONTROL: a turn that opens before the deadline disarms it; a result or a rate-limit event alone does not', () => {
  for (const sign of [init, { type: 'assistant', message: { content: [] } }, { type: 'user', message: { content: [] } }]) {
    const r = recording();
    r.pub.started(6368, 'sid-1');
    r.pub.wrote();
    r.pub.event(sign);
    r.fire();
    assert.equal(r.last().unstarted, undefined, 'a ' + sign.type + ' event opens a turn: nothing to report');
    assert.deepEqual(r.told, []);
  }
  for (const notATurn of [{ type: 'rate_limit_event' }, { type: 'result', is_error: true }]) {
    const r = recording();
    r.pub.started(6368, 'sid-1');
    r.pub.wrote();
    r.pub.event(notATurn);
    r.fire();
    assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 1 }, 'a ' + notATurn.type + ' with no turn opened is not one');
  }
});

test('#8951: messages written behind the first, before the deadline, are counted with it', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote();
  r.pub.wrote();
  r.pub.wrote();
  assert.equal(r.timers.length, 1, 'only the write into an idle agent arms a deadline');
  r.fire();
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 3 });
  assert.equal(r.last().queued, undefined, 'the queue is now in the report, not still waiting');
});

test('#8951 review 1: a report the process stopped on ends only on a turn a LATER write opened, and is held long enough to be shown', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');
  r.fire();
  assert.equal(r.last().unstarted && r.last().unstarted.lost, true, 'premise: reported as lost');
  r.clock.t += HOLD;                        // past the hold, so only the later-write rule can keep it
  r.pub.event(init); r.pub.event(result);   // a wake-up: a turn nobody wrote
  r.fire();
  assert.ok(r.last().unstarted, 'a turn with no later write does not prove the lost message ran');
  r.clock.t -= HOLD;                        // back, so the next steps test the hold itself
  r.pub.wrote();
  r.pub.event(init);                        // a later write opens a turn, seconds after the report
  assert.ok(r.last().unstarted, 'held: the minute sweep has not shown it yet');
  r.clock.t += HOLD;
  r.fire();                                 // the deferred clear
  assert.equal(r.last().unstarted, undefined, 'over once the hold has passed');
  // Past the hold already, a later write's turn ends it at once.
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.pub.stopped(); q.pub.started(7001, 'sid-1');
  q.clock.t += HOLD;
  q.pub.wrote(); q.pub.event(init);
  assert.equal(q.last().unstarted, undefined);
});

test('#8951 (PigeonPete): a report the deadline made ends on the first turn the same process opens, a late start', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote();
  r.fire();
  assert.ok(r.last().unstarted, 'premise: reported');
  r.pub.event(init);                        // the message starts late, nothing new written
  assert.ok(r.last().unstarted, 'held: the minute sweep has not shown it yet');
  r.clock.t += HOLD;
  r.fire();
  assert.equal(r.last().unstarted, undefined, 'the turn opened: no longer "never started"');
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.fire();
  q.clock.t += HOLD;
  q.pub.event(init); q.pub.event(result);
  assert.equal(q.last().unstarted, undefined, 'past the hold, it ends at once');
});

test('#8951 review 2: a write merged into a report by the deadline does not count as a later write', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');   // lost with the process
  r.pub.wrote();                                                   // the person sends another
  r.fire();                                                        // and it opens no turn either
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 2, lost: true });
  assert.deepEqual(r.told[r.told.length - 1], { since: new Date(T0).toISOString(), count: 2, lost: true }, 'the log keeps that the process stopped on some');
  r.clock.t += HOLD;
  r.pub.event(init); r.pub.event(result);                          // a turn nobody wrote
  r.fire();
  assert.ok(r.last().unstarted, 'neither message ran: still reported');
});

test('#8951: the process ending while a written message has not run carries it to the next process (the 11-23 crash)', () => {
  const r = recording();
  const since = new Date(T0).toISOString();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote();                       // 21:40:12.905Z, the message
  r.clock.t += 600;
  r.pub.stopped();                     // 21:40:13.487Z, homer died
  r.clock.t += 400;
  r.pub.started(7001, 'sid-1');        // 21:40:13.921Z, homer resumed
  assert.equal(r.last().pid, 7001);
  assert.equal(r.last().state, 'idle');
  assert.deepEqual(r.last().unstarted, { since, count: 1, lost: true }, 'the new process\'s record says what was lost');
  assert.deepEqual(r.told, [{ since, count: 1, lost: true }]);
  r.fire();                            // the old process's deadline
  assert.equal(r.told.length, 1, 'the old process\'s deadline is disarmed: told once');
  // The next two deliveries die the same way: each adds to the report, which keeps the first time.
  for (const pid of [7002, 7003]) { r.pub.wrote(); r.pub.stopped(); r.pub.started(pid, 'sid-1'); }
  assert.deepEqual(r.last().unstarted, { since, count: 3, lost: true });
  assert.equal(r.told.length, 3, 'each new loss is said on the task log');
  r.clock.t += HOLD;
  r.pub.wrote(); r.pub.event(init);    // 01:55Z, a message that does start a turn
  assert.equal(r.last().unstarted, undefined);
});

test('#8951 review 1 B1: a resume with nothing to resume (one error result, no turn) does not erase what was lost', () => {
  const r = recording();
  r.pub.started(6368, 'sid-new');
  r.pub.wrote();                       // a fresh agent's first message kills it
  r.pub.stopped();
  r.pub.started(7001, 'sid-new');      // resumed
  r.pub.event({ type: 'result', is_error: true, errors: ['No conversation found with session ID: sid-new'] });
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 1, lost: true }, 'still reported');
  r.pub.stopped();                     // that child exits
  r.pub.started(7002, 'sid-fresh');    // and a fresh session starts
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 1, lost: true }, 'carried to the fresh session');
  assert.equal(r.told.length, 1, 'said once: carrying it on is not a new loss');
});

test('#8951 review 1 W1: a message written behind a turn is still in flight at the result, until its own turn opens', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.event(init); r.pub.wrote();   // the second waits behind the first turn
  r.pub.event(result);                               // taken at this boundary
  r.pub.stopped(); r.pub.started(7001, 'sid-1');     // and it kills the process before its turn opens
  assert.equal(r.last().unstarted && r.last().unstarted.count, 1, 'the one written behind the turn is lost');
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.pub.event(init); q.pub.wrote();
  q.timers.splice(0);                                // the first write's deadline, disarmed by its turn
  q.pub.event(result);
  assert.equal(q.timers.length, 1, 'the waiting message must open its own turn by the deadline');
  q.fire();
  assert.equal(q.last().unstarted && q.last().unstarted.count, 1, 'it did not: reported');
  const ok = recording();
  ok.pub.started(6368, 'sid-1');
  ok.pub.wrote(); ok.pub.event(init); ok.pub.wrote(); ok.pub.event(result); ok.pub.event(init);
  ok.fire();
  assert.equal(ok.last().unstarted, undefined, 'CONTROL: its turn opened');
});

test('#8951: CONTROL: a process that ends after its turn finished, or mid-turn with nothing behind it, loses nothing', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.event(init); r.pub.event(result);
  r.pub.stopped(); r.pub.started(7001, 'sid-1');
  assert.equal(r.last().unstarted, undefined, 'the message ran');
  r.pub.wrote(); r.pub.event(init);
  r.clock.t += ss.LOST_WINDOW_MS + 1;   // review 7: long after the write (a Restart mid-turn), not within seconds
  r.pub.stopped(); r.pub.started(7002, 'sid-1');
  assert.equal(r.last().unstarted, undefined, 'mid-turn and long after the write, the message ran as far as it got');
  assert.deepEqual(r.told, []);
  // A message written behind a running turn is not yet taken: it is lost with the process.
  r.pub.wrote(); r.pub.event(init); r.pub.wrote();
  r.clock.t += ss.LOST_WINDOW_MS + 1;
  r.pub.stopped(); r.pub.started(7003, 'sid-1');
  assert.equal(r.last().unstarted && r.last().unstarted.count, 1, 'the one written behind the turn');
});

test('#8951: a report the deadline made is not counted again when the process then ends, and is not re-said', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote();
  r.fire();
  r.pub.stopped(); r.pub.started(7001, 'sid-1');
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 1 }, 'not lost: it was the deadline\'s');
  assert.equal(r.told.length, 1);
});

test('#8951: unstartedFor reads the report for a live process only, and nothing malformed', () => {
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const at = (n) => path.join(dir, store.safeKey(n) + '.json');
  const since = new Date(T0).toISOString();
  fs.writeFileSync(at('homer'), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: process.pid, at: since, unstarted: { since, count: 3 } }));
  assert.deepEqual(ss.unstartedFor('homer'), { since, count: 3, lost: false });
  const dead = require('node:child_process').spawnSync(process.execPath, ['-e', '0']).pid;
  fs.writeFileSync(at('dan'), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: dead, at: since, unstarted: { since, count: 1 } }));
  assert.equal(ss.unstartedFor('dan'), null, 'a file whose process is gone describes no agent running now');
  for (const [n, u] of [['a1', null], ['a2', { since: 'nope', count: 1 }], ['a3', { since, count: 0 }], ['a4', { since, count: 1.5 }], ['a5', 'x']]) {
    fs.writeFileSync(at(n), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: process.pid, at: since, unstarted: u }));
    assert.equal(ss.unstartedFor(n), null, n + ' says nothing');
  }
  assert.equal(ss.unstartedFor('nobody-here'), null);
});


test('#8951: the stall says what happened and how to recover, as a turn stall marked unstarted, worded per case', () => {
  const since = new Date(T0).toISOString();
  const one = ds.unstartedOf('homer', { since, count: 1 });
  assert.deepEqual({ lastWhy: one.lastWhy, unstarted: one.unstarted, count: one.count, since: one.since, step: one.step, lost: one.lost },
    { lastWhy: 'turn', unstarted: true, count: 1, since, step: null, lost: undefined });
  assert.equal(one.words, 'It took in a message but never started on it');
  assert.equal(one.next, 'Send it again, and restart it if that does not start either');
  const three = ds.unstartedOf('homer', { since, count: 3 });
  assert.equal(three.words, 'It took in its messages but never started on them');
  assert.equal(three.next, 'Send them again, and restart it if they do not start either');
  const lost = ds.unstartedOf('homer', { since, count: 1, lost: true });
  assert.equal(lost.lost, true);
  assert.equal(lost.words, 'It stopped right after a message reached it, before running it');
  assert.equal(lost.next, 'Send it again; if it stops again, the message itself may be what stops it, so try a shorter one');
  assert.equal(ds.unstartedOf('homer', null), null);
  assert.equal(ds.unstartedOf('homer', { since: 'x', count: 1 }), null);
  assert.equal(ds.turnLine('homer', three), 'turn-unstarted: homer took in 3 messages from ' + since + ' and never started a turn.\n');
  assert.equal(ds.turnLine('homer', lost), 'turn-unstarted: homer stopped right after 1 message from ' + since + ' reached it, before running it.\n');
  assert.match(ds.turnLine('homer', { since, count: 2, step: null }), /^turn-stuck: /, 'CONTROL: a stuck step keeps its own line');
});

test('#8951: the card carries it for a Windows Claude agent reading idle or working; not for other runners or a Mac pane', () => {
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const since = new Date(Date.now() - 10 * MIN).toISOString();
  fs.writeFileSync(path.join(dir, store.safeKey('hal') + '.json'), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: process.pid, at: since, unstarted: { since, count: 3 } }));
  const win = { name: 'hal', command: 'claude.exe', runner: 'claude' };
  ds.resetForTests();
  for (const state of ['idle', 'working']) {
    const st = status.deliveryStallOf(win, { state });
    assert.ok(st && st.unstarted === true && st.lastWhy === 'turn' && st.count === 3, 'reading ' + state + ': ' + JSON.stringify(st));
  }
  assert.equal(status.deliveryStallOf(win, { state: 'stopped' }), null, 'a stopped agent says itself');
  assert.equal(status.deliveryStallOf({ ...win, runner: 'codex' }, { state: 'idle' }), null, 'not for another runner\'s supervisor');
  assert.equal(status.deliveryStallOf({ name: 'hal', command: 'claude' }, { state: 'idle' }), null, 'not for a Mac pane');
  fs.writeFileSync(path.join(dir, store.safeKey('hal') + '.json'), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: process.pid, at: since }));
  assert.equal(status.deliveryStallOf(win, { state: 'idle' }), null, 'CONTROL: the same agent with no report carries nothing');
});


test('#8951: the page, the CLI list and the board log each say it in its own words, once', (t) => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const stateReason = new Function(page.lift(SCRIPT, 'stateReason') + '\nreturn stateReason;')();
  const stall = (mins, count, lost) => ds.unstartedOf('homer', { since: new Date(Date.now() - mins * MIN).toISOString(), count, lost });
  assert.equal(stateReason({ name: 'Homer', state: 'idle', deliveryStall: stall(250, 3) }),
    'Homer took in 3 messages about 4 hours ago but never started on them. Send them again, and restart it if they do not start either.');
  assert.equal(stateReason({ name: 'Homer', state: 'idle', deliveryStall: stall(7, 1) }),
    'Homer took in a message about 7 minutes ago but never started on it. Send it again, and restart it if that does not start either.');
  assert.equal(stateReason({ name: 'Homer', state: 'idle', deliveryStall: { ...stall(0, 1, true), since: new Date(Date.now() - 2000).toISOString() } }),
    'Homer stopped right after a message reached it, about a minute ago, and never ran it. Send it again; if it stops again, the message itself may be what stops it, so try a shorter one.',
    'review 1 W3: seconds after the crash it does not claim minutes');
  assert.match(stateReason({ name: 'Homer', state: 'working', deliveryStall: { ...stall(70, 2), unstarted: undefined, step: 'running "x"', words: ds.WHY_WORDS.turn, next: ds.turnNext(2) } }),
    /^Homer has been on one step/, 'CONTROL: a stuck step keeps its own sentence');
  const { rosterRow } = require('./clilists');
  const row = rosterRow({ name: 'Homer', deliveryStall: stall(10, 1) });
  assert.equal(typeof row.notStartedSince, 'string');
  assert.equal(row.oneStepSince, undefined, 'never said as a step');
  const said = new Map();
  const board = fleet.install([fleet.agent('homer', { state: 'idle' })]);
  t.after(() => board.restore());
  const card = { ...board.card('homer'), deliveryStall: stall(10, 1) };
  assert.equal(ds.turnsToSay([card], said).length, 1);
  assert.match(ds.turnsToSay([{ ...card }], new Map())[0], /^turn-unstarted: /);
  assert.equal(ds.turnsToSay([card], said).length, 0, 'said once');
  assert.equal(ds.stallEvent(card).kind, 'needs_you', 'the person is told, as for a stuck step');
});

test('#8951 review 3: a process that ends long after the last write (a Restart) carries them as never started, not as what stopped it', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.event(init); r.pub.wrote(); r.pub.wrote();   // a stuck turn with two waiting behind it
  r.clock.t += 70 * MIN;
  r.pub.stopped(); r.pub.started(7001, 'sid-1');                     // the person presses Restart
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 2 }, 'not lost');
  assert.deepEqual(r.told, [{ since: new Date(T0).toISOString(), count: 2, lost: false }]);
  r.clock.t += HOLD;
  r.pub.event(init); r.pub.event(result);                             // review 4: a turn on the new process, no write
  assert.ok(r.last().unstarted, 'carried, it still needs a later write: no turn on the new process can be those messages');
  r.pub.wrote(); r.pub.event(init);
  assert.equal(r.last().unstarted, undefined, 'CONTROL: a later write\'s turn ends it');
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote();
  q.clock.t += ss.LOST_WINDOW_MS;
  q.pub.stopped(); q.pub.started(7001, 'sid-1');
  assert.equal(q.last().unstarted.lost, true, 'CONTROL: at the edge of the window it is the message\'s doing');
  const p = recording();
  p.pub.started(6368, 'sid-1');
  p.pub.wrote();
  p.clock.t += ss.LOST_WINDOW_MS + 1;
  p.pub.stopped(); p.pub.started(7001, 'sid-1');
  assert.equal(p.last().unstarted.lost, undefined, 'just past it, it is not');
});

test('#8951 review 3: the board log says a report again when it grows; the CLI line is counted and worded per case', (t) => {
  const since = new Date(Date.now() - 10 * MIN).toISOString();
  const board = fleet.install([fleet.agent('homer', { state: 'idle' })]);
  t.after(() => board.restore());
  const said = new Map();
  const card = (count, lost) => ({ ...board.card('homer'), deliveryStall: ds.unstartedOf('homer', { since, count, lost }) });
  assert.equal(ds.turnsToSay([card(1, true)], said).length, 1);
  assert.equal(ds.turnsToSay([card(1, true)], said).length, 0, 'the same report: said once');
  assert.match(ds.turnsToSay([card(3, true)], said)[0] || '', /3 messages/, 'a second and third loss are said');
  const { agentLines, rosterRow } = require('./clilists');
  const one = agentLines([rosterRow({ name: 'Homer', state: 'idle', deliveryStall: ds.unstartedOf('homer', { since, count: 1, lost: true }) })]).lines.join('\n');
  assert.match(one, /stopped right after a message reached it at .+, before running it: send it again/);
  const three = agentLines([rosterRow({ name: 'Homer', state: 'idle', deliveryStall: ds.unstartedOf('homer', { since, count: 3 }) })]).lines.join('\n');
  assert.match(three, /took in 3 messages from .+ and never started on them: send them again/);
});

test('#8951 review 3: once the report clears from the card, its push is no longer waited on, so it is acked, not emailed', (t) => {
  ds.resetForTests();
  const board = fleet.install([fleet.agent('homer', { state: 'idle' })]);
  t.after(() => { board.restore(); ds.resetForTests(); });
  const now = Date.now();
  const withStall = { ...board.card('homer'), deliveryStall: ds.unstartedOf('homer', { since: new Date(now - 2 * MIN).toISOString(), count: 1, lost: true }) };
  const sent = [];
  ds.tellStalls([withStall], { now, send: (ev) => { sent.push(ev); return true; } });
  assert.equal(sent.length, 1, 'premise: the person was pushed');
  ds.unstartedGone([withStall], now);
  const later = now + 26 * MIN;
  assert.deepEqual(ds.acksDue([], later), [], 'CONTROL: still on the card, the push stays open');
  // Review 4: a card restarting, stopped, missing or now showing a stuck step says nothing about the report.
  for (const [why, cards] of [['restarting', [{ ...board.card('homer'), state: 'restarting', deliveryStall: null }]], ['stopped', [{ ...board.card('homer'), state: 'stopped', deliveryStall: null }]],
    ['missing', []], ['a stuck step', [{ ...board.card('homer'), state: 'working', deliveryStall: { since: new Date(now).toISOString(), count: 1, lastWhy: 'turn', step: 'x' } }]]]) {
    assert.deepEqual(ds.unstartedGone(cards, later), [], why + ': not cleared');
    assert.deepEqual(ds.acksDue([], later), [], why + ': the push stays open');
  }
  assert.deepEqual(ds.unstartedGone([{ ...board.card('homer'), state: 'idle', deliveryStall: null }], later), ['homer']);
  const acks = ds.acksDue([], later);
  assert.equal(acks.length, 1, 'acked once the report cleared');
  assert.equal(acks[0].id, sent[0].id);
});

test('#8951 review 4: a fresh loss added to an old report gets a fresh hold', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.fire();                          // a deadline report at T0
  r.clock.t += 10 * MIN;                            // long past its hold
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');   // then a message the process stops on
  r.pub.wrote(); r.pub.event(init);                 // a later write opens a turn at once
  assert.ok(r.last().unstarted, 'held: the fresh loss has not been shown yet');
  r.clock.t += HOLD;
  r.fire();
  assert.equal(r.last().unstarted, undefined);
});

test('#8951: the minute sweep takes a cleared report off the open pushes BEFORE it acks them', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const gone = src.indexOf('ds.unstartedGone(r)');
  const acks = src.indexOf('ds.acksDue(stallEnds)');
  assert.ok(gone > 0 && acks > 0, 'both calls are in the sweep');
  assert.ok(gone < acks, 'unstartedGone runs first, so the same sweep can ack');
  assert.ok(acks - gone < 400, 'and in the same sweep, a few lines apart');
});

test('#8951 review 5: once a carried report ends, a later deadline report on the same process ends on a late start again', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');   // carried: needs a later write
  r.clock.t += HOLD;
  r.pub.wrote(); r.pub.event(init); r.pub.event(result);        // resent, ran: the report ends
  assert.equal(r.last().unstarted, undefined, 'premise: ended');
  r.clock.t += 10 * MIN;
  r.pub.wrote(); r.fire();                                        // a new message opens no turn
  assert.equal(r.last().unstarted && r.last().unstarted.count, 1, 'a new report, counted alone');
  r.clock.t += HOLD;
  r.pub.event(init);                                              // it starts late, nothing new written
  assert.equal(r.last().unstarted, undefined, 'the late-start rule holds on this process now');
});

test('#8951 review 5: a report whose message ran is not carried by a stop during its hold', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');   // carried, lost
  r.clock.t += 30 * 1000;
  r.pub.wrote(); r.pub.event(init); r.pub.event(result);        // resent, and it ran, inside the hold
  assert.ok(r.last().unstarted, 'premise: still held on the card');
  r.clock.t += 60 * 1000;
  r.pub.stopped(); r.pub.started(7002, 'sid-1');                  // a Restart during the hold
  assert.equal(r.last().unstarted, undefined, 'it ran: the new process is not told to send it again');
});

test('#8951 review 5: fresh messages the deadline merges into an old report get a fresh hold', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');   // carried, at T0
  r.clock.t += 10 * MIN;
  r.pub.wrote(); r.fire();                                        // merged: count 2
  assert.equal(r.last().unstarted.count, 2);
  r.pub.wrote(); r.pub.event(init);                               // a later write's turn, seconds after the merge
  assert.ok(r.last().unstarted, 'held: the grown report has not been shown yet');
});

test('#8951 review 5: a second report soon after a cleared one keeps the first push open', (t) => {
  ds.resetForTests();
  const board = fleet.install([fleet.agent('homer', { state: 'idle' })]);
  t.after(() => { board.restore(); ds.resetForTests(); });
  const now = Date.now();
  const withStall = { ...board.card('homer'), deliveryStall: ds.unstartedOf('homer', { since: new Date(now - 2 * MIN).toISOString(), count: 1, lost: true }) };
  const sent = [];
  ds.tellStalls([withStall], { now, send: (ev) => { sent.push(ev); return true; } });
  ds.unstartedGone([withStall], now);
  ds.unstartedGone([{ ...board.card('homer'), state: 'idle', deliveryStall: null }], now + 5 * MIN);   // cleared
  ds.unstartedGone([withStall], now + 10 * MIN);                                                       // lost again
  assert.deepEqual(ds.acksDue([], now + 26 * MIN), [], 'showing again: not acked, so the person is still followed up');
});

test('#8951 review 6: a write queued behind a turn nobody wrote ends a carried report only once its own turn starts', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');   // carried
  r.clock.t += HOLD;
  r.pub.event(init);                                              // a wake-up turn
  r.pub.wrote();                                                  // the person resends; it waits behind it
  r.pub.event({ type: 'assistant', message: { content: [] } });  // still the wake-up turn
  assert.ok(r.last().unstarted, 'the resent message has not run: still reported');
  r.pub.event(result);                                            // the boundary: it is taken
  r.pub.event(init);                                              // and its own turn opens
  assert.equal(r.last().unstarted, undefined, 'now it ran');
  // Taken mid-turn instead: the wake-up turn's tool call returns, and the waiting message joins that turn.
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.pub.stopped(); q.pub.started(7001, 'sid-1');
  q.clock.t += HOLD;
  q.pub.event(init);
  q.pub.event({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w1', name: 'Bash', input: { command: 'x' } }] } });
  q.pub.wrote();
  q.pub.event({ type: 'assistant', message: { content: [] } });
  assert.ok(q.last().unstarted, 'still behind the open call');
  q.pub.event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] } });
  q.pub.event({ type: 'assistant', message: { content: [] } });
  assert.equal(q.last().unstarted, undefined, 'taken when the call returned: it ran');
});

test('#8951 review 7: a message whose turn opened, then the process died within seconds, is reported as what stopped it', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote();                       // 21:40:12.905Z
  r.clock.t += 50;
  r.pub.event(init);                   // the turn opens ~50 ms later, as measured
  r.clock.t += 550;
  r.pub.stopped();                     // and the process dies at 0.6 s
  r.pub.started(7001, 'sid-1');
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 1, lost: true }, 'either order of the 11-23 deaths is reported');
  assert.deepEqual(r.told, [{ since: new Date(T0).toISOString(), count: 1, lost: true }]);
  // With one waiting behind it, both are counted once.
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.pub.event(init); q.pub.wrote();
  q.pub.stopped(); q.pub.started(7001, 'sid-1');
  assert.equal(q.last().unstarted.count, 2);
  // CONTROL: a turn that reached its result is not counted, however soon the process then ends.
  const p = recording();
  p.pub.started(6368, 'sid-1');
  p.pub.wrote(); p.pub.event(init); p.pub.event(result);
  p.pub.stopped(); p.pub.started(7001, 'sid-1');
  assert.equal(p.last().unstarted, undefined);
});

test('#8951 review 7: a deadline merge clears the busy-write marker, so a turn nobody wrote cannot end the merged report', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.stopped(); r.pub.started(7001, 'sid-1');   // carried
  r.clock.t += HOLD;
  r.pub.wrote();                                                  // into idle
  r.pub.wrote();                                                  // behind it, busy
  r.fire();                                                       // neither starts: merged, count 3
  assert.equal(r.last().unstarted.count, 3);
  r.clock.t += HOLD;
  r.pub.event({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w1', name: 'Bash', input: { command: 'x' } }] } });
  r.pub.event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] } });
  r.pub.event({ type: 'assistant', message: { content: [] } });
  assert.ok(r.last().unstarted, 'a wake-up turn\'s calls returning is not the merged messages running');
});

test('#8951 review 8: a wake-up turn opens on no message, and a turn that ran long is not lost because of a write just before the stop', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.event(init);                   // a wake-up turn
  r.pub.wrote();                       // one message waits behind it
  r.pub.event({ type: 'assistant', message: { content: [] } });
  r.pub.stopped(); r.pub.started(7001, 'sid-1');
  assert.equal(r.last().unstarted.count, 1, 'one message, counted once');
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.pub.event(init);    // a turn on a message
  q.clock.t += 30 * MIN;               // that runs a long time
  q.pub.wrote();                       // another written behind it
  q.clock.t += 3000;
  q.pub.stopped(); q.pub.started(7001, 'sid-1');   // then a Restart
  assert.equal(q.last().unstarted.count, 1, 'only the one waiting: the first ran for half an hour');
});

test('#8951 review 9: a message taken into a running turn when its calls return is counted if the process dies within seconds', () => {
  const tool = (id) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'x' } }] } });
  const back = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.clock.t += 50; r.pub.event(init); r.pub.event(tool('w1'));   // a turn a message opened, with a call
  r.clock.t += 950; r.pub.wrote();                                               // a second, behind the call
  r.clock.t += 1000; r.pub.event(back('w1'));                                    // the call returns: it joins the turn
  r.clock.t += 1000; r.pub.event({ type: 'assistant', message: { content: [] } });
  r.clock.t += 600; r.pub.stopped(); r.pub.started(7001, 'sid-1');
  assert.deepEqual(r.last().unstarted, { since: new Date(T0).toISOString(), count: 2, lost: true }, 'both died with it');
  // Long after it joined, a Restart does not count it (nor the opener).
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.pub.event(init); q.pub.event(tool('w1'));
  q.pub.wrote(); q.pub.event(back('w1'));
  q.clock.t += ss.LOST_WINDOW_MS + 1;
  q.pub.stopped(); q.pub.started(7001, 'sid-1');
  assert.equal(q.last().unstarted, undefined, 'both ran as far as they got');
});

test('#8951 review 9: a turn counted because it opened within seconds of the stop is worded as what stopped it, whenever it was written', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.event(init);
  r.clock.t += 60 * 1000; r.pub.wrote();               // written behind a long turn
  r.clock.t += 20 * MIN; r.pub.event(result);          // taken at its end
  r.clock.t += 50; r.pub.event(init);                  // its own turn opens
  r.clock.t += 550; r.pub.stopped(); r.pub.started(7001, 'sid-1');
  assert.deepEqual(r.last().unstarted, { since: new Date(T0 + 60 * 1000).toISOString(), count: 1, lost: true });
});

test('#8951 review 10: each message keeps its own clock: one that joined a minute ago ran, one that joined just now died', () => {
  const tool = (id) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'x' } }] } });
  const back = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote(); r.pub.event(init); r.pub.event(tool('w1'));   // A opens the turn
  r.pub.wrote(); r.pub.event(back('w1'));                      // B joins
  r.pub.event(tool('w2'));
  r.clock.t += 60 * 1000;
  r.pub.wrote(); r.pub.event(back('w2'));                      // C joins a minute later
  r.clock.t += 1000;
  r.pub.stopped(); r.pub.started(7001, 'sid-1');
  assert.deepEqual(r.last().unstarted, { since: new Date(T0 + 60 * 1000).toISOString(), count: 1, lost: true }, 'only C');
});

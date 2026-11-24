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

test('#8951 review 1: a report ends only on a turn a LATER write opened, and is held long enough to be shown', () => {
  const r = recording();
  r.pub.started(6368, 'sid-1');
  r.pub.wrote();
  r.fire();
  assert.ok(r.last().unstarted, 'premise: reported');
  r.pub.event(init); r.pub.event(result);   // a wake-up: a turn nobody wrote
  assert.ok(r.last().unstarted, 'a turn with no later write does not prove the lost message ran');
  r.pub.wrote();
  r.pub.event(init);                        // a later write opens a turn, seconds after the report
  assert.ok(r.last().unstarted, 'held: the minute sweep has not shown it yet');
  r.clock.t += HOLD;
  r.fire();                                 // the deferred clear
  assert.equal(r.last().unstarted, undefined, 'over once the hold has passed');
  // Past the hold already, a later write's turn ends it at once.
  const q = recording();
  q.pub.started(6368, 'sid-1');
  q.pub.wrote(); q.fire();
  q.clock.t += HOLD;
  q.pub.wrote(); q.pub.event(init);
  assert.equal(q.last().unstarted, undefined);
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
  r.pub.stopped(); r.pub.started(7002, 'sid-1');
  assert.equal(r.last().unstarted, undefined, 'mid-turn, the message is under way, not unread');
  assert.deepEqual(r.told, []);
  // A message written behind a running turn is not yet taken: it is lost with the process.
  r.pub.wrote(); r.pub.event(init); r.pub.wrote();
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

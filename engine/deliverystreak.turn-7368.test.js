'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7368: a Windows Claude step that never ends is said on the card, naming the step, once it has shown no
 * activity for an hour with messages queued behind it, and the person is told to restart it and send them again.
 *
 * On Windows a message is written into the agent's input and counts as PLACED even mid-turn, so the #7212 streak
 * (which only counts what did not land) can never see a step that holds them. The agent's supervisor counts what it
 * queued (`queued`), and the step's clock is its last sign of activity (review 1: B1 and B2).
 *
 *   node --test engine/deliverystreak.turn-7368.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-turnstuck-7368-')));
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
const status = require('./status');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/* A publisher that records every write instead of touching disk. */
function recording() {
  const wrote = [];
  const pub = ss.publisher('agent-a', { write: (rec) => { wrote.push(rec); return { ok: true }; }, clear: () => {}, setTimer: () => {} });
  return { pub, last: () => wrote[wrote.length - 1], wrote };
}
const toolUse = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const init = { type: 'system', subtype: 'init' };
const result = { type: 'result', is_error: false };

test('#7368: the step names the shell command in quotes, or the tool and what it acts on; masked, one line, cut by character', () => {
  assert.equal(ss.stepOfEvent(toolUse('Bash', { command: 'npm install' })), 'running "npm install"');
  assert.equal(ss.stepOfEvent(toolUse('Read', { file_path: 'C:\\work\\notes.md' })), 'using Read on C:\\work\\notes.md');
  assert.equal(ss.stepOfEvent(toolUse('WebFetch', {})), 'using WebFetch');
  assert.equal(ss.stepOfEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }), null, 'a reply with no tool has no step');
  assert.equal(ss.stepOfEvent(result), null);
  assert.equal(ss.stepOfEvent(toolUse('Bash', { command: 'a\n\t\u0007 b' })), 'running "a b"', 'control characters and runs of space fold to one space');
  const long = ss.stepOfEvent(toolUse('Bash', { command: '\u{1F600}'.repeat(200) }));
  assert.equal(Array.from(long).length, 80, 'cut to 80 characters');
  assert.ok(!/[\uD800-\uDBFF]\u2026$/.test(long), 'never cut inside a character');
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const masked = ss.stepOfEvent(toolUse('Bash', { command: 'GH_TOKEN=' + token + ' gh pr list' }));
  assert.ok(!masked.includes(token), 'a token in the command is masked before it reaches the card or the log: ' + masked);
});

test('#7368 review 1 B1: the message that STARTS a turn is not waiting behind it; one written into a busy agent is', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();   // starts the turn
  assert.equal(r.last().state, ss.BUSY);
  assert.equal(r.last().queued, undefined, 'the message that started the turn queues nothing');
  r.pub.event(toolUse('Bash', { command: 'sleep forever' }));
  r.pub.wrote();   // the person sends another while it is busy
  assert.equal(r.last().queued, 1, 'a message written into a busy agent is queued behind its turn');
  r.pub.wrote();
  assert.equal(r.last().queued, 2);
});

test('#7368 review 1 W1: the queue shrinks only as the agent takes the next message itself, and survives the turn ending', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote(); r.pub.wrote(); r.pub.wrote();   // A starts the turn; B and C queue behind it
  assert.equal(r.last().queued, 2);
  r.pub.event(result);                            // A's turn ends
  assert.equal(r.last().state, ss.IDLE);
  assert.equal(r.last().queued, 2, 'going idle does not empty what is still queued');
  r.pub.event(init);                              // the agent takes B by itself
  assert.equal(r.last().queued, 1, 'C still waits behind B: the case review 1 W1 says was missed');
  r.pub.event(result); r.pub.event(init);         // B ends, C is taken
  assert.equal(r.last().queued, undefined, 'nothing left queued');
});

test('#7368 review 1 B2: the clock is the last sign of activity, not the turn\'s start; a quiet step keeps its clock', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  r.pub.wrote();
  const first = r.last().stepSince;
  assert.ok(Number.isFinite(Date.parse(first)), 'a busy agent has a step clock');
  r.pub.event(toolUse('Bash', { command: 'sleep forever' }));
  assert.equal(r.last().step, 'running "sleep forever"');
  r.pub.wrote();   // a message arriving is not activity of the agent's
  assert.equal(r.last().stepSince, first, 'a queued message does not move the clock');
  r.pub.event(result);
  assert.equal(r.last().stepSince, undefined, 'an idle agent has no step');
  assert.equal(r.last().step, undefined);
});

test('#7368: turnFor reads a busy agent\'s step and queue from its state file, and nothing from an idle one', () => {
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const at = (n) => path.join(dir, store.safeKey(n) + '.json');
  const since = new Date(Date.now() - 2 * HOUR).toISOString();
  fs.writeFileSync(at('ada'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: 1, at: since, stepSince: since, step: 'running "npm install"', queued: 3 }));
  assert.deepEqual(ss.turnFor('ada'), { since, step: 'running "npm install"', queued: 3 });
  fs.writeFileSync(at('bea'), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: 1, at: since, queued: 2 }));
  assert.equal(ss.turnFor('bea'), null, 'CONTROL: an idle agent is not on a step');
  fs.writeFileSync(at('cal'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: 1, at: since }));
  assert.equal(ss.turnFor('cal'), null, 'a busy record from before #7368 (no step clock) says nothing');
});

test('#7368: an hour with no activity AND a message queued is a stall that names the step; each alone is not', () => {
  const now = Date.now();
  const old = new Date(now - 2 * HOUR).toISOString();
  assert.equal(ds.turnStuckOf('ada', { since: old, step: 'running "npm install"', queued: 0 }, { now }), null, 'a long quiet step nothing waits behind is not said');
  assert.equal(ds.turnStuckOf('ada', { since: new Date(now - 59 * MIN).toISOString(), step: null, queued: 3 }, { now }), null, 'CONTROL: under an hour of quiet is not stuck');
  const st = ds.turnStuckOf('ada', { since: old, step: 'running "npm install"', queued: 2 }, { now });
  assert.deepEqual({ lastWhy: st.lastWhy, count: st.count, step: st.step, since: st.since }, { lastWhy: 'turn', count: 2, step: 'running "npm install"', since: old });
  assert.match(st.next, /Restart it to free it, then send them again/);
  assert.match(ds.turnStuckOf('ada', { since: old, step: null, queued: 1 }, { now }).next, /send that message again/, 'one message is "that message", not "them"');
  assert.equal(ds.turnStuckOf('ada', null, { now }), null);
});

test('#7368: the card carries it for a Windows Claude agent reading Working, ahead of the streak; not for other runners or states', () => {
  const dir = path.join(store.ROOT, 'win32-state');
  fs.mkdirSync(dir, { recursive: true });
  const since = new Date(Date.now() - 2 * HOUR).toISOString();
  fs.writeFileSync(path.join(dir, store.safeKey('dee') + '.json'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: 1, at: since, stepSince: since, step: 'running "x"', queued: 2 }));
  const win = { name: 'dee', command: 'claude.exe', runner: 'claude' };
  assert.equal(status.deliveryStallOf(win, { state: 'working' }).lastWhy, 'turn', 'a Windows Claude card reading Working carries the stuck step');
  assert.equal(status.deliveryStallOf(win, { state: 'idle' }), null, 'CONTROL: an idle card is not on a step');
  assert.equal(status.deliveryStallOf({ ...win, runner: 'codex' }, { state: 'working' }), null, 'not for another runner\'s supervisor');
  assert.equal(status.deliveryStallOf({ name: 'dee', command: 'claude' }, { state: 'working' }), null, 'not for a Mac pane');
});

test('#7368: the page says it in its own sentence, naming the step and how many wait', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const stateReason = new Function(page.lift(SCRIPT, 'stateReason') + '\nreturn stateReason;')();
  const card = (mins, count, step) => ({ name: 'Ada', state: 'working', deliveryStall: { since: new Date(Date.now() - mins * MIN).toISOString(), count,
    lastWhy: 'turn', step, words: ds.WHY_WORDS.turn, next: ds.turnNext(count) } });
  assert.equal(stateReason(card(125, 3, 'running "npm install"')),
    'Ada has been on one step for about 2 hours: running "npm install". 3 messages are waiting behind it. Restart it to free it, then send them again.');
  assert.equal(stateReason(card(70, 1, null)),
    'Ada has been on one step for about 70 minutes. 1 message is waiting behind it. Restart it to free it, then send that message again.');
  assert.match(stateReason({ name: 'Ada', state: 'idle', deliveryStall: { since: new Date(Date.now() - 45 * MIN).toISOString(), count: 4, lastWhy: 'menu', words: ds.WHY_WORDS.menu } }),
    /^No message has reached Ada/, 'CONTROL: the #7212 stall keeps its own sentence');
});

test('#7368: the board log says a stuck step once, in its own words', () => {
  const st = { since: '2026-10-27T12:00:00.000Z', count: 3, step: 'running "x"' };
  assert.equal(ds.turnLine('ada', st), 'turn-stuck: ada has been on one step since 2026-10-27T12:00:00.000Z (running "x"), with 3 messages waiting behind it.\n');
  assert.match(ds.turnLine('ada', { ...st, count: 1, step: null }), /since 2026-10-27T12:00:00\.000Z, with 1 message waiting/);
});

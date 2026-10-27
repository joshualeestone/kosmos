'use strict';

/**
 * kosmos#7368: a Windows Claude turn that never ends is said on the card, naming the step, once it has run an hour
 * with messages placed behind it, and the person is told to restart it and send those messages again.
 *
 * On Windows a message is written into the agent's input and counts as PLACED even mid-turn, so the #7212 streak
 * (which only counts what did not land) can never see a turn that holds them. These tests drive the stream publisher
 * with a fake turn that never ends, and a control turn that ends normally and raises nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root BEFORE requiring anything that reads the store.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'turnstuck-7368-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const ss = require('./win32streamstate');
const ds = require('./deliverystreak');

const HOUR = 60 * 60 * 1000;

/* A publisher that records every write instead of touching disk. */
function recording() {
  const wrote = [];
  const pub = ss.publisher('agent-a', { write: (rec) => { wrote.push(rec); return { ok: true }; }, clear: () => {}, setTimer: () => {} });
  return { pub, last: () => wrote[wrote.length - 1], wrote };
}
const toolUse = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

test('#7368: the step names the shell command, or the tool and what it acts on, and nothing for a plain reply', () => {
  assert.equal(ss.stepOfEvent(toolUse('Bash', { command: 'npm install' })), 'running `npm install`');
  assert.equal(ss.stepOfEvent(toolUse('Read', { file_path: 'C:\\work\\notes.md' })), 'using Read on C:\\work\\notes.md');
  assert.equal(ss.stepOfEvent(toolUse('WebFetch', {})), 'using WebFetch');
  assert.equal(ss.stepOfEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }), null, 'a reply with no tool has no step');
  assert.equal(ss.stepOfEvent({ type: 'result' }), null);
  const long = ss.stepOfEvent(toolUse('Bash', { command: 'x'.repeat(500) }));
  assert.ok(long.length <= 80 && long.endsWith('\u2026'), 'a long command is cut to one short line: ' + long.length);
  assert.equal(ss.stepOfEvent(toolUse('Bash', { command: 'a\n\n  b' })), 'running `a b`', 'one line, whitespace folded');
});

test('#7368: a turn begins when the agent goes busy, a message written into it does not restart the clock, and its end clears it', () => {
  const r = recording();
  r.pub.started(4242, 'sid-1');
  assert.equal(r.last().turnSince, undefined, 'an idle agent has no turn');
  r.pub.wrote();
  const began = r.last().turnSince;
  assert.ok(typeof began === 'string' && Number.isFinite(Date.parse(began)), 'going busy stamps the turn: ' + began);
  r.pub.event(toolUse('Bash', { command: 'sleep forever' }));
  assert.equal(r.last().step, 'running `sleep forever`', 'the step is written as it changes');
  const t0 = Date.now(); while (Date.now() - t0 < 5) { /* let the clock move, so a restarted turn would read differently */ }
  r.pub.wrote();   // the person sends another message into the busy agent
  assert.equal(r.last().turnSince, began, 'a message queued behind the turn does not move its start');
  r.pub.event({ type: 'result', is_error: false });
  assert.equal(r.last().state, ss.IDLE);
  assert.equal(r.last().turnSince, undefined, 'a turn that ends leaves no turn behind (CONTROL: the normal turn)');
  assert.equal(r.last().step, undefined);
});

test('#7368: turnFor reads a busy agent\'s turn from its state file, and nothing from an idle one', () => {
  const dir = path.join(require('./store').ROOT, 'win32-state');   // the store's own root, as statePath reads it
  fs.mkdirSync(dir, { recursive: true });
  const at = (n) => path.join(dir, require('./store').safeKey(n) + '.json');
  const since = new Date(Date.now() - 2 * HOUR).toISOString();
  fs.writeFileSync(at('ada'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: 1, at: since, turnSince: since, step: 'running `npm install`' }));
  assert.deepEqual(ss.turnFor('ada'), { since, step: 'running `npm install`' });
  fs.writeFileSync(at('bea'), JSON.stringify({ v: 1, state: 'idle', sessionId: 's', pid: 1, at: since, turnSince: since }));
  assert.equal(ss.turnFor('bea'), null, 'CONTROL: an idle agent has no turn, whatever the file still says');
  fs.writeFileSync(at('cal'), JSON.stringify({ v: 1, state: 'busy', sessionId: 's', pid: 1, at: since }));
  assert.equal(ss.turnFor('cal'), null, 'a busy record from before #7368 (no turnSince) says nothing');
  assert.equal(ss.turnFor('nobody'), null);
});

test('#7368: a turn over an hour with messages placed behind it is a stall that names the step; each condition alone is not', () => {
  ds.resetForTests();
  const now = Date.now();
  const turn = { since: new Date(now - 2 * HOUR).toISOString(), step: 'running `npm install`' };
  assert.equal(ds.turnStuckOf('ada', turn, { now }), null, 'a long turn with nothing waiting behind it is not said');
  ds.note('ada', { state: 'placed' }, now - 3 * HOUR);   // placed BEFORE the turn began: not behind it
  assert.equal(ds.turnStuckOf('ada', turn, { now }), null, 'a message placed before the turn is not behind it');
  ds.note('ada', { state: 'placed' }, now - HOUR);
  ds.note('ada', { state: 'placed' }, now - 30 * 60 * 1000);
  const st = ds.turnStuckOf('ada', turn, { now });
  assert.ok(st, 'two messages placed behind a two-hour turn are a stall');
  assert.equal(st.lastWhy, 'turn');
  assert.equal(st.count, 2);
  assert.equal(st.step, 'running `npm install`');
  assert.equal(st.since, turn.since);
  const young = { since: new Date(now - 59 * 60 * 1000).toISOString(), step: null };
  assert.equal(ds.turnStuckOf('ada', young, { now }), null, 'CONTROL: under an hour is a long turn, not a stuck one');
  assert.equal(ds.turnStuckOf('ada', null, { now }), null, 'no turn, nothing to say');
});

test('#7368: the person is told to restart and send the waiting messages again, and the log says it once in its own words', () => {
  ds.resetForTests();
  const now = Date.now();
  ds.note('ada', { state: 'placed' }, now - 10 * 60 * 1000);
  const st = ds.turnStuckOf('ada', { since: new Date(now - 90 * 60 * 1000).toISOString(), step: null }, { now });
  assert.match(st.next, /Restart it/, 'Restart is the way out');
  assert.match(st.next, /send them again/, 'a restart drops what the process had queued, so they are to be sent again');
  const line = ds.turnLine('ada', st);
  assert.match(line, /^turn-stuck: ada has been on one step since .+, with 1 message waiting behind it\.\n$/);
  assert.match(ds.turnLine('ada', { ...st, count: 3, step: 'running `x`' }), /\(running `x`\), with 3 messages waiting/);
});

test('#7368: an agent gone from the board loses its placed times, so one coming back under the name starts clean', () => {
  ds.resetForTests();
  const now = Date.now();
  ds.note('ada', { state: 'placed' }, now - 10 * 60 * 1000);
  ds.sweep(['bea']);
  assert.equal(ds.turnStuckOf('ada', { since: new Date(now - 2 * HOUR).toISOString() }, { now }), null);
});

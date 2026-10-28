'use strict';

/**
 * kosmos#7406: one event woke ~35 agents at once and the burst of turns set off the provider's rate limits. Past the
 * first roomhold.BIG_ROOM members of one provider, each further member's delivery starts a jittered gap after the one
 * before it. These pin who waits, how long, that every member is still placed, and the one board-log line. The sleep
 * is injected, so nothing here waits in real time.
 *
 *   node --test engine/messages.wakespread-7406.test.js
 */

const os = require('node:os');
const path = require('node:path');

// Sandboxed BEFORE any engine require, like engine/messages.fanout-4765.test.js.
const SANDBOX = path.join(os.tmpdir(), 'kosmos-messages-wakespread-7406-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const roomhold = require('./roomhold');
const fleet = require('../test-support/fleet');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const FREE = roomhold.BIG_ROOM;
const names = (n) => Array.from({ length: n }, (_, i) => 'm' + String(i).padStart(2, '0'));

test('#7406: wakeSpread delays only the members past the first BIG_ROOM of each provider, in growing steps', () => {
  const room = names(FREE + 4);
  const at = messages.wakeSpread(room, () => 'Claude', { random: () => 0.5 });
  const mid = Math.round((messages.WAKE_GAP_MS[0] + messages.WAKE_GAP_MS[1]) / 2);
  assert.deepEqual(room.slice(0, FREE).map((n) => at.get(n)), room.slice(0, FREE).map(() => 0));
  assert.deepEqual(room.slice(FREE).map((n) => at.get(n)), [1, 2, 3, 4].map((k) => k * mid));
  // Control: a room of exactly BIG_ROOM waits for nobody.
  const small = messages.wakeSpread(names(FREE), () => 'Claude');
  assert.ok([...small.values()].every((ms) => ms === 0), 'a small room was spread');
});

test('#7406: wakeSpread counts each provider on its own, and a member whose provider cannot be read never waits', () => {
  const room = names(2 * FREE + 2);
  // Alternate providers: FREE + 1 of each, so exactly one of each waits, and only one gap.
  const providerOf = (n) => (Number(n.slice(1)) % 2 === 0 ? 'Claude' : 'OpenAI');
  const at = messages.wakeSpread(room, providerOf, { random: () => 0 });
  const waiting = room.filter((n) => at.get(n) > 0);
  assert.deepEqual(waiting.map(providerOf).sort(), ['Claude', 'OpenAI']);
  assert.ok(waiting.every((n) => at.get(n) === messages.WAKE_GAP_MS[0]), 'a provider waited on the other one');
  // Unreadable: a throw or a null is its own provider and is typed at once, however many there are.
  const unread = messages.wakeSpread(names(FREE + 5), (n) => { if (n.endsWith('1')) throw new Error('x'); return null; });
  assert.ok([...unread.values()].every((ms) => ms === 0));
  // Every gap stays inside the stated range (20 past FREE: inside WAKE_SPREAD_MAX_MS, so no gap is shrunk).
  const wide = messages.wakeSpread(names(FREE + 20), () => 'Claude');
  const steps = names(FREE + 20).slice(FREE).map((n) => wide.get(n));
  steps.forEach((ms, i) => {
    const gap = ms - (i ? steps[i - 1] : 0);
    assert.ok(gap >= messages.WAKE_GAP_MS[0] && gap <= messages.WAKE_GAP_MS[1], 'gap ' + gap + ' out of range');
  });
});

/** A scripted tmux that answers every call as healthy and records the calls in order (as the #4765 test). */
function arm() {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(async () => {});
  return calls;
}

async function withRoom(members, fn) {
  const board = fleet.install(members.map((n) => fleet.agent(n, { state: 'idle' })));
  try {
    return await fn(board.snapshot ? board.snapshot() : board.roster);
  } finally {
    board.restore();
    chat.resetForTests();
    messages.setWakeSpreadForTests();
  }
}

const post = (roster, text) => messages.sendPostAsync(
  { operator: true, project: 'spread', projectName: 'Spread', text }, roster, roster.map((c) => c.sessionName));

/** Capture the board log (stdout) while fn runs. */
async function logged(fn) {
  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => { lines.push(String(chunk)); return write.call(process.stdout, chunk, ...rest); };
  try { return { value: await fn(), lines }; } finally { process.stdout.write = write; }
}

test('#7406: a person\'s post to a big room types the first BIG_ROOM at once, the rest after their waits, and every member is placed', async () => {
  const members = names(FREE + 3);
  await withRoom(members, async (roster) => {
    const calls = arm();
    const slept = [];
    messages.setWakeSpreadForTests({ sleep: async (ms) => { slept.push(ms); }, random: () => 0 });
    const { value: d, lines } = await logged(() => post(roster, 'one line for the big room'));
    assert.equal(d.state, chat.DELIVERY.PLACED);
    assert.deepEqual(Object.keys(d.outcomes).sort(), members.slice().sort());
    assert.ok(Object.values(d.outcomes).every((o) => o === chat.DELIVERY.PLACED), 'a member was not placed');
    const g = messages.WAKE_GAP_MS[0];
    assert.deepEqual(slept, [g, 2 * g, 3 * g], 'the waits were not the members past the first ' + FREE);
    const enters = calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter');
    assert.equal(enters.length, members.length, 'a member was not sent its Enter');
    const spreadLines = lines.filter((l) => l.startsWith('room-wake: '));
    assert.deepEqual(spreadLines, ['room-wake: spread 3 of ' + members.length + ' wakes over ' + (3 * g / 1000).toFixed(1) + ' s in spread\n']);
  });
});

test('#7406: control, a room of BIG_ROOM members sleeps for nobody and writes no spread line', async () => {
  await withRoom(names(FREE), async (roster) => {
    arm();
    const slept = [];
    messages.setWakeSpreadForTests({ sleep: async (ms) => { slept.push(ms); } });
    const { value: d, lines } = await logged(() => post(roster, 'one line for a small room'));
    assert.equal(d.state, chat.DELIVERY.PLACED);
    assert.deepEqual(slept, []);
    assert.equal(lines.filter((l) => l.startsWith('room-wake: ')).length, 0);
  });
});

test('#7406 review 2: one provider\'s spread never passes WAKE_SPREAD_MAX_MS, however big the room', () => {
  const room = names(FREE + 200);
  const at = messages.wakeSpread(room, () => 'Claude', { random: () => 1 });
  const latest = Math.max(...at.values());
  assert.ok(latest <= messages.WAKE_SPREAD_MAX_MS + 200, 'spread ' + latest + ' ms');
  assert.ok(latest >= messages.WAKE_SPREAD_MAX_MS * 0.9, 'the cap shrank the spread far below itself: ' + latest);
  // Control: a room inside the cap keeps full gaps.
  const mid = messages.wakeSpread(names(FREE + 4), () => 'Claude', { random: () => 1 });
  assert.equal(Math.max(...mid.values()), 4 * messages.WAKE_GAP_MS[1]);
});

test('#7406 review 4: the delayed members are typed only once their wait ends, and the answer waits for them', async () => {
  const members = names(FREE + 2);
  await withRoom(members, async (roster) => {
    const calls = arm();
    const release = [];
    messages.setWakeSpreadForTests({ sleep: (ms) => new Promise((r) => release.push(r)), random: () => 0 });
    let answered = false;
    const pending = post(roster, 'one line for the big room').then((d) => { answered = true; return d; });
    // Let every undelayed member run to its Enter.
    for (let i = 0; i < 50 && release.length < 2; i++) await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
    const enters = () => calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter').length;
    assert.equal(release.length, 2, 'the two members past ' + FREE + ' did not wait');
    assert.equal(enters(), FREE, 'a delayed member was typed before its wait ended');
    assert.equal(answered, false, 'the answer came before the delayed members were typed');
    release.forEach((r) => r());
    const d = await pending;
    assert.equal(enters(), members.length);
    assert.ok(Object.values(d.outcomes).every((o) => o === chat.DELIVERY.PLACED));
  });
});

test('#7406 review 1: a later post to a member never starts before its earlier, still-waiting one', () => {
  // The ordering rule itself, measured on the helper the loop calls.
  messages.setWakeSpreadForTests({ now: () => 5000 });
  const order = messages._inOrderForTests;
  assert.equal(order('x', 350), 350);        // first post: waits until 5350
  assert.equal(order('x', 150), 351);        // second post: pushed past the first's start
  assert.equal(order('x', 0), 352, 'an undelayed post still waits behind the delayed one');
  assert.equal(order('y', 0), 0, 'CONTROL: a member with nothing waiting is not delayed');
  messages.setWakeSpreadForTests();
});

'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 slice 2a: the card says when Kosmos's messages to an agent have waited half an hour behind its input box.
 * The minute sweep records it (engine/heldinput.js), the status row carries it (heldInput), and the card says how long,
 * what the box reads and what to do. Counting it as needing the person, and the phone, are slice 2b. Slice 1
 * (heldwarn-7212.test.js) is the log line.
 *
 *   node --test engine/heldnotice-7212.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-heldnotice-7212-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const limitqueue = require('./limitqueue');
const heldinput = require('./heldinput');
const { needsPerson } = require('./status');
const page = require('../test-support/page');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT, limitqueue.dir()]);

const MIN = 60 * 1000;
const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
const agentNeedsAttention = new Function(page.lift(SCRIPT, 'agentNeedsAttention') + '\nreturn agentNeedsAttention;')();
const reasonOf = (a) => new Function('a', `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, {});`)(a);
const ago = (m) => new Date(Date.now() - m * MIN).toISOString();

test('#7212 s2: the sweep\'s reading is what the rows see; each minute replaces the last', () => {
  heldinput.resetForTests();
  heldinput.setAll([{ name: 'dario', since: ago(40), count: 3, box: 'unread' }, { name: '', count: 1 }, null]);
  const got = heldinput.peek('dario');
  assert.equal(got.count, 3);
  assert.equal(got.box, 'unread');
  got.count = 99;
  assert.equal(heldinput.peek('dario').count, 3, 'a reader could change the stored reading');
  assert.equal(heldinput.peek(''), null, 'a nameless row was kept');
  heldinput.setAll([]);
  assert.equal(heldinput.peek('dario'), null, 'a stretch that ended still shows');
});

test('#7212 s2a: a held stretch is not yet counted as needing the person, by either rule (slice 2b does all copies at once)', () => {
  // Counting it in one copy and not the others (projects, Today, the phone's own needsPerson) would make them disagree.
  const row = { state: 'idle', heldInput: { since: ago(40), count: 2, box: 'unread' } };
  assert.equal(needsPerson(row), false);
  assert.equal(agentNeedsAttention(row), false);
});

test('#7212 s2a: the stretches already said survive a board restart, so nothing is said or pushed again', () => {
  heldinput.resetForTests();
  assert.equal(heldinput.loadSaid().size, 0, 'CONTROL: nothing saved yet');
  const said = new Map([['dario', 1761480000000], ['ema', 1761483600000]]);
  assert.equal(heldinput.saveSaid(said), true);
  assert.deepEqual([...heldinput.loadSaid()], [...said]);
  heldinput.resetForTests();
  assert.equal(heldinput.loadSaid().size, 0);
});

test('#7212 s2: the card says how long, what the box reads, and what to do', () => {
  const unread = reasonOf({ state: 'idle', heldInput: { since: ago(45), count: 3, box: 'unread' } });
  assert.match(unread, /^Kosmos has held 3 messages to it for about 45 minutes behind its message box\. /);
  assert.match(unread, /cannot read the box.*restart it there/);
  // A working agent is never told to restart: that would cut its turn.
  const busy = reasonOf({ state: 'working', heldInput: { since: ago(45), count: 3, box: 'unread' } });
  assert.match(busy, /cannot read the box/);
  assert.doesNotMatch(busy, /restart/);
  const text = reasonOf({ state: 'idle', heldInput: { since: ago(45), count: 1, box: 'text' } });
  assert.match(text, /held 1 message to it/);
  assert.match(text, /read it, then send it with Enter or clear it/);
  // An empty box with messages still held never promises they are about to go.
  const empty = reasonOf({ state: 'idle', heldInput: { since: ago(45), count: 2, box: 'empty' } });
  assert.match(empty, /reads empty now, but they are still waiting/);
  assert.doesNotMatch(empty, /within a minute/);
  // The seven-day case reads as days, a few hours as hours.
  assert.match(reasonOf({ state: 'idle', heldInput: { since: ago(7 * 1440), count: 2, box: 'unread' } }), /for about 7 days/);
  assert.match(reasonOf({ state: 'working', heldInput: { since: ago(300), count: 2, box: 'unread' } }), /for about 5 hours/);
  // It comes before #6249's sentence, which says nothing when the box cannot be read.
  const both = reasonOf({ state: 'idle', unsentInput: { since: ago(50) }, heldInput: { since: ago(45), count: 1, box: 'text' } });
  assert.match(both, /^Kosmos has held/);
});

test('#7212 s2: a more urgent sentence keeps its place', () => {
  const held = { since: ago(45), count: 2, box: 'unread' };
  assert.match(reasonOf({ state: 'idle', crashLoop: { looping: true, count: 3 }, heldInput: held }), /restarted it 3 times/);
  assert.doesNotMatch(reasonOf({ state: 'auth_failed', heldInput: held }), /Kosmos has held/);
  assert.doesNotMatch(reasonOf({ state: 'restarting', heldInput: held }), /Kosmos has held/);
  // CONTROL: the same row idle does say it.
  assert.match(reasonOf({ state: 'idle', heldInput: held }), /Kosmos has held/);
});

test('#7212 s2a review 3: two queue names for one card are one reading, counted whole', () => {
  heldinput.resetForTests();
  heldinput.setAll([
    { name: 'casey', since: ago(40), count: 2, box: 'unread' },
    { name: 'casey', since: ago(90), count: 3, box: 'empty' },
  ]);
  const got = heldinput.peek('casey');
  assert.equal(got.count, 5, 'one queue overwrote the other');
  assert.equal(Date.parse(got.since) <= Date.now() - 89 * MIN, true, 'the older queue\'s time was lost');
  assert.equal(got.box, 'empty');
});

test('#7212 s2a review 3: one read of text is not called unsent text until the next minute reads it too', () => {
  heldinput.resetForTests();
  const row = (box) => [{ name: 'tina', since: ago(40), count: 1, box }];
  heldinput.setAll(row('text'));
  assert.equal(heldinput.peek('tina').box, 'unread', 'a delivery caught mid-typing was called unsent text');
  heldinput.setAll(row('text'));
  assert.equal(heldinput.peek('tina').box, 'text', 'text read two minutes running was not said');
  heldinput.setAll(row('empty'));
  assert.equal(heldinput.peek('tina').box, 'empty');
  // From empty, one read of text keeps the last word.
  heldinput.setAll(row('text'));
  assert.equal(heldinput.peek('tina').box, 'empty');
});

test('#7212 s2a: the minute sweep records under the card\'s key, says once, and a restart does not say it again', () => {
  heldinput.resetForTests();
  const at = ago(40);
  assert.ok(limitqueue.add('swept', { id: 'sw1', from: 'x', envelope: 'e', at, reset: at, input: true }));
  assert.ok(limitqueue.add('swept', { id: 'sw2', from: 'x', envelope: 'e', at: ago(5), reset: ago(5), input: true }));
  const lines = [];
  // The queue is named as the send route spelled it; the card's session name is what its row is looked up by.
  const deps = (said, box = () => 'text') => ({ said, readBox: box, cardKey: (n) => (n === 'swept' ? 'swept-session' : n), log: (l) => lines.push(l) });
  const mine = (xs) => xs.filter((x) => x.includes('swept'));
  heldinput.sweep(deps(heldinput.loadSaid()));
  heldinput.sweep(deps(heldinput.loadSaid()));   // text is said on its second minute (one read can be a delivery typing)
  assert.deepEqual(heldinput.peek('swept-session'), { since: at, count: 2, box: 'text' }, 'the card reading was not recorded under the card');
  assert.equal(heldinput.peek('swept'), null, 'recorded under the queue name, which the card row never asks for');
  assert.equal(mine(lines).length, 1);
  assert.match(lines.find((l) => l.includes('swept')), /has 2 message\(s\) held behind its input box.*holds text that was not sent/);
  // The same minute again, then a board restart (a fresh map read back from disk): nothing said again.
  heldinput.sweep(deps(heldinput.loadSaid()));
  assert.equal(mine(lines).length, 1, 'said again after a restart');
  // A day on, the stretch is said again in the log.
  heldinput.sweep({ ...deps(heldinput.loadSaid()), now: Date.now() + limitqueue.HELD_INPUT_RESAY_MS + 60 * 1000 });
  assert.equal(mine(lines).length, 2, 'the daily line was not said');
  // A box that cannot be read, or reads something unknown, is 'unread' on the card.
  heldinput.sweep(deps(heldinput.loadSaid(), () => { throw new Error('no pane'); }));
  assert.equal(heldinput.peek('swept-session').box, 'unread');
  heldinput.sweep(deps(heldinput.loadSaid(), () => 'weird'));
  assert.equal(heldinput.peek('swept-session').box, 'unread');
  // The stretch ends: the card reading goes, and the saved map lets it go.
  assert.ok(limitqueue.remove('swept', 'sw1'));
  assert.ok(limitqueue.remove('swept', 'sw2'));
  heldinput.sweep(deps(heldinput.loadSaid()));
  assert.equal(heldinput.peek('swept-session'), null);
  assert.ok(!heldinput.loadSaid().has('swept'), 'an ended stretch stayed on disk');
});

test('#7212 s2a: while a flush run is typing, the sweep reads no box and keeps the last reading', async () => {
  heldinput.resetForTests();
  const chat = require('./chat');
  const fleet = require('../test-support/fleet');
  heldinput.setAll([{ name: 'kept', since: ago(40), count: 1, box: 'empty' }]);
  const kept = heldinput.peek('kept');
  const now = new Date().toISOString();
  assert.ok(limitqueue.add('typer', { id: 'ty1', from: 'x', envelope: 'e', at: now, reset: now }));
  let finish;
  const typed = new Promise((r) => { finish = r; });
  const board = fleet.install([fleet.agent('typer', { state: 'idle' })]);
  const run = limitqueue.flush(board.agents, {
    deliver: async () => { await typed; return { state: chat.DELIVERY.PLACED }; }, isReleased: () => true,
    resolveCard: chat.resolveCard, DELIVERY: chat.DELIVERY,
  }).finally(() => board.restore());
  let reads = 0;
  const said = heldinput.sweep({ said: new Map(), readBox: () => { reads += 1; return 'text'; }, cardKey: (n) => n, log: () => {} });
  finish();
  await run;
  assert.deepEqual(said, []);
  assert.equal(reads, 0, 'a box was read while a delivery was typing');
  assert.deepEqual(heldinput.peek('kept'), kept, 'the last reading was dropped or changed');
});

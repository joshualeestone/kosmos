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
/* The page's `const NAME = {...};` by brace depth (as web.project-needs-you-5688.test.js does): page.liftConst stops at
   the first semicolon, and a reason's words can hold one. */
function sliceConst(name) {
  const start = 'const ' + name + ' = {';
  const at = SCRIPT.indexOf(start);
  assert.notEqual(at, -1, start + ' is not in the page');
  let depth = 0;
  let i = SCRIPT.indexOf('{', at);
  for (; i < SCRIPT.length; i++) {
    if (SCRIPT[i] === '{') depth++;
    else if (SCRIPT[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SCRIPT.slice(at, i + 1) + ';';
}

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

test('#7212 s2b: every copy of "needs the person" counts a held stretch, idle or working only, and they agree', () => {
  const held = { since: ago(40), count: 2, box: 'unread' };
  const rows = [
    { state: 'idle', heldInput: held },
    { state: 'working', heldInput: { ...held, box: 'text' } },
    { state: 'rate_limited', heldInput: held },   // keeps its own word: out of usage is never a held-box issue
    { state: 'restarting', heldInput: held },
    { state: 'idle', heldInput: { ...held, count: 0 } },
    { state: 'idle', heldInput: null },
    { state: 'idle' },   // a bare snapshot row (needsPerson is guarded on presence)
  ];
  const want = [true, true, false, false, false, false, false];
  rows.forEach((r, i) => {
    assert.equal(needsPerson(r), want[i], 'needsPerson row ' + i);
    assert.equal(agentNeedsAttention(r), want[i], 'agentNeedsAttention row ' + i);
  });
});

test('#7212 s2b: the project and Today name it as held_input, after the agent\'s own conditions and before a Kosmos give-up', () => {
  const projects = require('./projects');
  const cardlabel = require('./cardlabel');
  const held = { since: ago(40), count: 2, box: 'unread' };
  const member = (extra) => ({ present: true, tied: true, state: 'idle', heldInput: held, ...extra });
  assert.equal(projects.needsYouReason(member({}), 'p1'), 'held_input');
  assert.equal(projects.needsYouReason(member({ ownBound: { raised: true } }), 'p1'), 'held_input', 'a give-up took the wording');
  assert.equal(projects.needsYouReason(member({ crashLoop: { looping: true } }), 'p1'), 'crash_loop', 'a crash loop lost the wording');
  assert.equal(projects.needsYouReason(member({ state: 'rate_limited' }), 'p1'), null, 'a limited agent was counted');
  // Review 1 of 2b: a limited agent that counts for ANOTHER reason keeps that reason, not held_input.
  assert.equal(projects.needsYouReason(member({ state: 'rate_limited', ownBound: { raised: true } }), 'p1'), 'own_bound', 'the held reason skipped its state gate');
  assert.equal(cardlabel.reasonOf({ state: 'idle', running: true, heldInput: held }, true), 'held_input');
  // The page's own words for it, and the project row's reason.
  const PJ = new Function(sliceConst('PJ_NEEDS_WHY') + '\nreturn PJ_NEEDS_WHY;')();
  assert.match(PJ.held_input[0], /behind its input box/);
  const also = new Function(sliceConst('PJ_NEEDS_WHY') + '\n' + page.lift(SCRIPT, 'pjAlsoWhy') + '\nreturn pjAlsoWhy;')();
  assert.equal(also({ state: 'idle', heldInput: held, ownBound: { raised: true } })[0], PJ.held_input[0]);
  assert.equal(also({ state: 'rate_limited', heldInput: held })[0], PJ.other[0], 'CONTROL: a limited agent is not called held');
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
  const lines = []; const pushes = [];
  // The queue is named as the send route spelled it; the card's session name is what its row is looked up by.
  const deps = (said, box = () => 'text') => ({ said, pushed: heldinput.loadPushed(), readBox: box, cardKey: (n) => (n === 'swept' ? 'swept-session' : n), log: (l) => lines.push(l), counts: () => true, push: (e) => pushes.push(e) });
  const myPushes = () => pushes.filter((e) => e.session === 'swept-session');
  const mine = (xs) => xs.filter((x) => x.includes('swept'));
  heldinput.sweep(deps(heldinput.loadSaid()));
  heldinput.sweep(deps(heldinput.loadSaid()));   // text is said on its second minute (one read can be a delivery typing)
  assert.deepEqual(heldinput.peek('swept-session'), { since: at, count: 2, box: 'text' }, 'the card reading was not recorded under the card');
  assert.equal(heldinput.peek('swept'), null, 'recorded under the queue name, which the card row never asks for');
  assert.equal(mine(lines).length, 1);
  assert.match(lines.find((l) => l.includes('swept')), /has 2 message\(s\) held behind its input box.*holds text that was not sent/);
  assert.equal(myPushes().length, 1, 's2b: the phone was not told on the first saying');
  assert.equal(myPushes()[0].kind, 'needs_you');
  // The same minute again, then a board restart (a fresh map read back from disk): nothing said again.
  heldinput.sweep(deps(heldinput.loadSaid()));
  assert.equal(mine(lines).length, 1, 'said again after a restart');
  assert.equal(myPushes().length, 1, 'pushed again after a restart');
  // A day on, the stretch is said again in the log.
  heldinput.sweep({ ...deps(heldinput.loadSaid()), now: Date.now() + limitqueue.HELD_INPUT_RESAY_MS + 60 * 1000 });
  assert.equal(mine(lines).length, 2, 'the daily line was not said');
  assert.equal(myPushes().length, 1, 'the daily line pushed the phone again');
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

test('#7212 s2b review 1: the phone is told once, the first minute the stretch counts, never while it does not', () => {
  heldinput.resetForTests();
  const at = ago(40);
  assert.ok(limitqueue.add('later', { id: 'lt1', from: 'x', envelope: 'e', at, reset: at, input: true }));
  const pushes = [];
  let counting = false;
  const run = (extra = {}) => heldinput.sweep({ said: heldinput.loadSaid(), pushed: heldinput.loadPushed(), readBox: () => 'unread',
    cardKey: (n) => n, log: () => {}, counts: () => counting, push: (e) => pushes.push(e), ...extra });
  const mine = () => pushes.filter((e) => e.session === 'later');
  run();   // said in the log, but the agent is (say) out of usage: no push
  assert.equal(mine().length, 0, 'the phone was told while the board does not count it');
  counting = true;
  run();   // it goes idle: now it counts, and the phone is told
  assert.equal(mine().length, 1, 'the phone was never told once it counted');
  run();
  run();   // a board restart reads both maps back from disk
  assert.equal(mine().length, 1, 'the phone was told again');
  // The stretch ends; a new one is told again once it counts.
  assert.ok(limitqueue.remove('later', 'lt1'));
  run();
  assert.equal(heldinput.loadPushed().has('later'), false, 'an ended stretch stayed marked as told');
  assert.ok(limitqueue.add('later', { id: 'lt2', from: 'x', envelope: 'e', at: ago(35), reset: ago(35), input: true }));
  run();
  assert.equal(mine().length, 2, 'a new stretch was never told');
});

test('#7212 s2b review 1: the tasks page re-reads when an agent becomes held, as for any needs-the-person case', () => {
  const sig = (rows) => new Function('LAST', page.lift(SCRIPT, 'tskNeedsSig') + '\nreturn tskNeedsSig();')(rows);
  const fleet = require('../test-support/fleet');
  const board = fleet.install([fleet.agent('tk1', { state: 'idle' })]);
  const card = { ...board.agents[0] };
  board.restore();
  const row = (extra) => ({ ...card, isNamedOurs: true, state: 'idle', ...extra });
  assert.notEqual(sig([row({ heldInput: { count: 2, box: 'unread' } })]), sig([row({})]), 'a newly held agent did not change the signature');
  assert.equal(sig([row({ heldInput: { count: 0 } })]), sig([row({})]), 'CONTROL: nothing held changes nothing');
});

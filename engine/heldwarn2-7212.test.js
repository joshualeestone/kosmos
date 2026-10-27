'use strict';
require('../test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7212 slice 2: an agent no message has been seen to reach for half an hour is said, whatever the cause.
 * Josh's 0.7.70 report: every delivery to one agent failed for seven days with its input box EMPTY, so slice 1 (text
 * held in the box) never fired. The recorder notes every delivery verdict where every sender ends.
 *
 *   node --test engine/heldwarn2-7212.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-heldwarn2-7212-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const ds = require('./deliverystreak');
const chat = require('./chat');
const status = require('./status');
const { assertSandboxedDataRoot } = require('../test-support/data-root-sandbox');

assertSandboxedDataRoot(SANDBOX, [store.ROOT]);

const MIN = 60 * 1000;
const T0 = Date.parse('2026-10-27T12:00:00Z');
const refused = { state: 'could_not', because: 'x' };
const held = (heldBy, extra = {}) => ({ state: 'could_not', held: true, heldBy, ...extra });

test.beforeEach(() => ds.resetForTests());

test('a run of failures is a stall only once it is half an hour old AND has three tries in it', () => {
  ds.note('a', refused, T0);
  ds.note('a', refused, T0 + 1 * MIN);
  assert.equal(ds.stallOf('a', { now: T0 + 60 * MIN }), null, 'two tries in an hour is not a stall');
  ds.note('a', refused, T0 + 2 * MIN);
  assert.equal(ds.stallOf('a', { now: T0 + 29 * MIN }), null, 'three tries, but under half an hour');
  const st = ds.stallOf('a', { now: T0 + 30 * MIN });
  assert.deepEqual(st, { since: new Date(T0).toISOString(), count: 3, lastWhy: 'refused', words: ds.WHY_WORDS.refused });
});

test('PLACED ends the streak; a busy window is not counted; UNCONFIRMED counts (Enter swallowed looks like that)', () => {
  for (let i = 0; i < 3; i += 1) ds.note('a', refused, T0 + i * MIN);
  ds.note('a', { state: 'placed' }, T0 + 5 * MIN);
  assert.equal(ds.stallOf('a', { now: T0 + 90 * MIN }), null, 'a landed line ends it');
  for (let i = 0; i < 5; i += 1) ds.note('b', { state: 'could_not', busy: true }, T0 + i * MIN);
  assert.equal(ds.stallOf('b', { now: T0 + 90 * MIN }), null, 'busy is the pane typing another line, not a stall');
  for (let i = 0; i < 3; i += 1) ds.note('c', { state: 'unconfirmed' }, T0 + i * MIN);
  assert.equal(ds.stallOf('c', { now: T0 + 30 * MIN }).lastWhy, 'unconfirmed');
});

test('the reason is the verdict\'s: menu, quota, input, limit, and a sign-in hold is signin, not a usage limit', () => {
  assert.equal(ds.whyOf(held('menu')), 'menu');
  assert.equal(ds.whyOf(held('quota')), 'quota');
  assert.equal(ds.whyOf(held('input')), 'input');
  assert.equal(ds.whyOf({ state: 'could_not', inputHeld: true }), 'input');
  assert.equal(ds.whyOf(held('limit')), 'limit');
  // #5948 keeps a sign-in hold under heldBy 'limit' with heldFor 'signin'.
  assert.equal(ds.whyOf(held('limit', { heldFor: 'signin' })), 'signin');
  assert.equal(ds.whyOf(refused), 'refused');
});

test('usage-limit holds alone are not warned while the card shows the limit; any other reason in the run is', () => {
  for (let i = 0; i < 3; i += 1) ds.note('a', held('limit'), T0 + i * MIN);
  assert.equal(ds.stallOf('a', { now: T0 + 40 * MIN, limitShown: true }), null, 'the card already says it');
  assert.ok(ds.stallOf('a', { now: T0 + 40 * MIN, limitShown: false }), 'a card that does not show it is warned');
  for (let i = 0; i < 3; i += 1) ds.note('s', held('limit', { heldFor: 'signin' }), T0 + i * MIN);
  assert.ok(ds.stallOf('s', { now: T0 + 40 * MIN, limitShown: true }), 'signed out is not the limit the card shows');
  ds.note('a', refused, T0 + 3 * MIN);
  assert.ok(ds.stallOf('a', { now: T0 + 40 * MIN, limitShown: true }), 'a refusal in the run is not the limit');
});

test('said once per streak, again a day later, and again at once for a new streak', () => {
  const said = new Map();
  for (let i = 0; i < 3; i += 1) ds.note('a', refused, T0 + i * MIN);
  assert.equal(ds.stallsToSay(['a'], said, { now: T0 + 30 * MIN }).length, 1);
  assert.equal(ds.stallsToSay(['a'], said, { now: T0 + 31 * MIN }).length, 0, 'not every minute');
  assert.equal(ds.stallsToSay(['a'], said, { now: T0 + 30 * MIN + ds.RESAY_MS }).length, 1, 'again a day on');
  ds.note('a', { state: 'placed' }, T0 + 2 * ds.RESAY_MS);
  const T1 = T0 + 2 * ds.RESAY_MS + MIN;
  for (let i = 0; i < 3; i += 1) ds.note('a', refused, T1 + i * MIN);
  assert.equal(ds.stallsToSay(['a'], said, { now: T1 + 30 * MIN }).length, 1, 'a new streak is said at its half hour');
});

test('the log line names the agent, when, how many tries, and the last reason in words', () => {
  for (let i = 0; i < 3; i += 1) ds.note('a', held('menu'), T0 + i * MIN);
  const [s] = ds.stallsToSay(['a'], new Map(), { now: T0 + 30 * MIN });
  assert.equal(ds.stallLine(s), 'delivery-stall: no message has been seen to reach a since 2026-10-27T12:00:00.000Z '
    + '(3 tries). Its screen is waiting on a question or a menu.\n');
});

test('an agent gone from the board loses its streak', () => {
  for (let i = 0; i < 3; i += 1) ds.note('gone', refused, T0 + i * MIN);
  ds.sweep(['other']);
  assert.equal(ds.stallOf('gone', { now: T0 + 40 * MIN }), null);
});

test('wired: chat.deliver notes a refusal, so three of them are a stall half an hour on', () => {
  const now = Date.now();
  for (let i = 0; i < 3; i += 1) {
    const v = chat.deliver('nobody-by-this-name', 'hello', []);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
  }
  const st = ds.stallOf('nobody-by-this-name', { now: now + 31 * MIN });
  assert.ok(st, 'deliver noted each verdict');
  assert.equal(st.count, 3);
});

test('wired: the card field reads the recorder, and stays null with a card limit for a limit-only run', () => {
  const at = Date.now() - 40 * MIN;
  for (let i = 0; i < 3; i += 1) ds.note('cardy', held('limit'), at + i * MIN);
  assert.equal(status.deliveryStallOf({ name: 'cardy' }, { state: 'idle', limitFrom: 'codex' }), null);
  assert.equal(status.deliveryStallOf({ name: 'cardy' }, { state: 'idle' }).count, 3);
  assert.equal(status.deliveryStallOf(null, null), null, 'never throws');
});

test('wired: a send typed in another case is noted under the card it reached, the key its card field reads', () => {
  const fleet = require('../test-support/fleet');
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const card = { ...board.agents[0], isNamedOurs: false };   // not ours: refused before any typing
    assert.equal(card.sessionName, 'casey', 'fixture: the card the typed name reaches');
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) assert.equal(chat.deliver('Casey', 'hello', [card]).state, chat.DELIVERY.COULD_NOT);
    assert.equal(ds.stallOf('Casey', { now: now + 31 * MIN }), null, 'not under the typed name');
    assert.equal(ds.stallOf('casey', { now: now + 31 * MIN }).count, 3);
  } finally { board.restore(); }
});

test('one rule for "the card shows a limit": each of its four fields, and nothing else', () => {
  for (const f of ['limitUntil', 'limitFrom', 'quotaUntil', 'poolUntil']) assert.equal(ds.limitShownOn({ [f]: 'x' }), true, f);
  assert.equal(ds.limitShownOn({ state: 'idle', unsentInput: { since: 'x' } }), false);
  assert.equal(ds.limitShownOn(null), false);
});

test('the card carries a stall only while it reads idle or working, the states that look fine', () => {
  const at = Date.now() - 40 * MIN;
  for (let i = 0; i < 3; i += 1) ds.note('st', refused, at + i * MIN);
  assert.ok(status.deliveryStallOf({ name: 'st' }, { state: 'idle' }));
  assert.ok(status.deliveryStallOf({ name: 'st' }, { state: 'working' }));
  for (const state of ['stopped', 'needs_you', 'auth_failed', 'restarting', 'rate_limited']) {
    assert.equal(status.deliveryStallOf({ name: 'st' }, { state }), null, state + ' says itself, or refuses by design');
  }
});

test('both "needs the person" rules count a stall, and agree with each other', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const agentNeedsAttention = new Function(page.lift(SCRIPT, 'agentNeedsAttention') + '\nreturn agentNeedsAttention;')();
  const stall = { since: '2026-10-27T12:00:00.000Z', count: 3, lastWhy: 'refused', words: ds.WHY_WORDS.refused };
  const rows = [{ state: 'idle', deliveryStall: stall }, { state: 'idle', deliveryStall: null }, { state: 'working' }];
  const want = [true, false, false];
  rows.forEach((r, i) => {
    assert.equal(status.needsPerson(r), want[i], 'needsPerson row ' + i);
    assert.equal(agentNeedsAttention(r), want[i], 'agentNeedsAttention row ' + i);
  });
});

test('the card says it in words, with the engine\'s reason, after the unsent-text sentence', () => {
  const page = require('../test-support/page');
  const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
  const fn = page.lift(SCRIPT, 'stateReason');
  const at = fn.indexOf('a.deliveryStall && typeof a.deliveryStall.since');
  assert.ok(at > 0, 'stateReason does not say the stall');
  assert.ok(at > fn.indexOf('a.unsentInput && typeof a.unsentInput.since'), 'the unsent-text sentence names the sharper cause first');
  assert.ok(at < fn.indexOf("a.state === 'restarting'"), 'before the state rules');
  const stateReason = new Function(fn + '\nreturn stateReason;')();
  const card = (mins, words) => ({ name: 'Ada', state: 'idle', deliveryStall: { since: new Date(Date.now() - mins * MIN).toISOString(), count: 4, lastWhy: 'menu', words } });
  // Mona Lisa's words (#7212 design review): the agent's name, and the reason as its own sentence.
  assert.equal(stateReason(card(45, ds.WHY_WORDS.menu)), 'No message has reached Ada for about 45 minutes. Its screen is waiting on a '
    + 'question or a menu. Open it to see what it shows, or restart it.');
  assert.match(stateReason(card(180, ds.WHY_WORDS.refused)), /^No message has reached Ada for about 3 hours\. Kosmos could not type into it\. /);
  assert.doesNotMatch(String(stateReason({ state: 'idle', deliveryStall: null })), /No message has reached/);
});

test('round 1 W2: a refusal of the message itself (empty, too long, a bad attachment name) never counts as a stall', () => {
  const now = Date.now();
  for (let i = 0; i < 4; i += 1) {
    const v = chat.deliver('nobody-content', '', []);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
    assert.equal(v.contentRefused, true, 'the verdict says the message was refused, not the agent');
  }
  assert.equal(ds.stallOf('nobody-content', { now: now + 40 * MIN }), null);
  ds.note('flagged', { state: 'could_not', contentRefused: true }, T0);
  ds.note('flagged', { state: 'could_not', contentRefused: true }, T0 + MIN);
  ds.note('flagged', { state: 'could_not', contentRefused: true }, T0 + 2 * MIN);
  assert.equal(ds.stallOf('flagged', { now: T0 + 40 * MIN }), null);
});

test('round 1 W1: a card that reads stopped or restarting starts its streak over, so the agent that comes back is not stalled', () => {
  for (const state of ['stopped', 'restarting']) {
    const at = Date.now() - 40 * MIN;
    for (let i = 0; i < 3; i += 1) ds.note('back', refused, at + i * MIN);
    assert.equal(status.deliveryStallOf({ name: 'back' }, { state }), null);
    assert.equal(status.deliveryStallOf({ name: 'back' }, { state: 'idle' }), null, state + ': refusals while it was down are gone');
  }
  // CONTROL: the same refusals on a card that never left idle are a stall.
  const at = Date.now() - 40 * MIN;
  for (let i = 0; i < 3; i += 1) ds.note('stayed', refused, at + i * MIN);
  assert.ok(status.deliveryStallOf({ name: 'stayed' }, { state: 'idle' }));
});

test('Mona Lisa\'s design: the pill reads Messages stuck with the issue look, on the page and on the phone', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const grab = (re, what) => { const m = PAGE.match(re); assert.ok(m, 'CONTROL: ' + what + ' was not found in the page'); return m[0]; };
  const { stateCopyOf, cardStOf } = new Function(
    grab(/\nconst STATE_COPY = \{[\s\S]*?\n\};\n/, 'STATE_COPY')
    + grab(/\nconst CARD_ST = \{[\s\S]*?\n\};\n/, 'CARD_ST')
    + grab(/\nconst CARD_ST_FAILED_RESTART = [^\n]*\n/, 'CARD_ST_FAILED_RESTART')
    + grab(/\nfunction restartingLabel\(a\) \{[\s\S]*?\n\}\n/, 'restartingLabel')
    + grab(/\nfunction stateCopyOf\(a\) \{[\s\S]*?\n\}\n/, 'stateCopyOf')
    + grab(/\nfunction cardStOf\(a\) \{[^\n]*\n/, 'cardStOf')
    + '\nreturn { stateCopyOf, cardStOf };')();
  const stall = { since: '2026-10-27T12:00:00.000Z', count: 3, lastWhy: 'menu', words: ds.WHY_WORDS.menu };
  for (const state of ['idle', 'working']) {
    assert.deepEqual(stateCopyOf({ state, deliveryStall: stall }), { label: 'Messages stuck', attn: true }, state);
    const st = cardStOf({ state, deliveryStall: stall });
    assert.equal(st.st, 'attn', state + ': the issue edge');
    assert.equal(st.pres, cardStOf({ state }).pres, state + ': its presence stays its state\'s');
    assert.notEqual(stateCopyOf({ state }).label, 'Messages stuck', 'CONTROL: no stall, no pill');
  }
  const cardlabel = require('./cardlabel');
  assert.equal(cardlabel.labelOf({ state: 'idle', deliveryStall: stall }), 'Messages stuck', 'the phone reads the same word');
  assert.equal(cardlabel.labelOf({ state: 'idle', deliveryStall: null }), 'Idle');
});

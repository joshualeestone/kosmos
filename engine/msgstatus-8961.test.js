'use strict';

/**
 * kosmos#8961: engine/msgstatus.status reads what happened to a direct message from the message record and the
 * recipient's report history, and sentence() says it. Pure: both readers are stubs here.
 *
 *   node --test engine/msgstatus-8961.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { status, sentence, STATUS } = require('./msgstatus');

const T0 = Date.parse('2026-11-23T12:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const ms = (s) => T0 + s * 1000;

const sent = (extra) => ({ kind: 'message', id: 'm10', from: 'leo', to: 'mara', text: 'hi', at: at(0), state: 'placed', ...extra });
const start = (s, by = 'auto') => ({ state: 'working', at: ms(s), by, ...(by === 'auto' ? { turn: 'start' } : {}) });
const end = (s, by = 'auto') => ({ state: 'idle', at: ms(s), by, ...(by === 'auto' ? { turn: 'end' } : {}) });
const beat = (s) => ({ state: 'working', at: ms(s), by: 'auto' });   // a PreToolUse heartbeat: no turn mark
function run(rows, hist, extra) {
  return status('m10', { rows, history: () => hist, sessionOf: (n) => n, ...extra });
}

test('a turn that starts after delivery and ends, with nothing sent back, is read with no answer', () => {
  const s = run([sent()], [end(-60), start(2), beat(5), end(9)]);
  assert.equal(s.status, STATUS.READ_NO_ANSWER);
  assert.equal(s.turnStartedAt, at(2));
  assert.equal(s.turnEndedAt, at(9));
  assert.match(sentence(s), /finished it at .* without sending you anything by command/);
});

test('a message back that cites it is the answer, preferred over an earlier uncited one', () => {
  const rows = [sent(), { kind: 'message', id: 'm11', from: 'mara', to: 'leo', at: at(3), state: 'placed' },
    { kind: 'message', id: 'm12', from: 'mara', to: 'leo', at: at(4), state: 'placed', in_reply_to: 'm10' }];
  const s = run(rows, [start(2), end(9)]);
  assert.equal(s.status, STATUS.ANSWERED);
  assert.equal(s.answer, 'm12');
  assert.equal(s.cites, true);
});

test('an uncited message back is an answer that says it may be about something else', () => {
  const s = run([sent(), { kind: 'message', id: 'm11', from: 'mara', to: 'leo', at: at(3), state: 'placed' }], null);
  assert.equal(s.status, STATUS.ANSWERED);
  assert.equal(s.cites, false);
  assert.match(sentence(s), /may be about something else/);
});

test('a message back from before the send, or to someone else, is not an answer', () => {
  const rows = [{ kind: 'message', id: 'm9', from: 'mara', to: 'leo', at: at(-5), state: 'placed' }, sent(),
    { kind: 'message', id: 'm11', from: 'mara', to: 'kai', at: at(3), state: 'placed' }];
  assert.equal(run(rows, [start(2), end(9)]).status, STATUS.READ_NO_ANSWER);
});

test('a turn already running at delivery and still running is in a turn, not "not read yet"', () => {
  const s = run([sent()], [end(-60), start(-30), beat(2)]);
  assert.equal(s.status, STATUS.IN_TURN);
  assert.match(sentence(s), /It may be reading your message now/);
});

test('a deliberate needs_you standing at or after delivery is unknown, never "not read yet" (its turns leave no marks)', () => {
  const ask = (t, by = 'agent') => ({ state: 'needs_you', at: ms(t), by });
  assert.equal(run([sent()], [end(-60), ask(-10)]).status, STATUS.UNKNOWN);   // standing since before the send
  assert.equal(run([sent()], [end(-60), ask(3)]).status, STATUS.UNKNOWN);    // raised after it
  // Cleared after the send, before anything else: the turns while it stood were not recorded.
  assert.equal(run([sent()], [end(-60), ask(-10), { state: 'idle', at: ms(4), by: 'operator' }]).status, STATUS.UNKNOWN);
  assert.match(sentence(run([sent()], [end(-60), ask(-10)])), /while one stands its turn reports are not recorded/);
  // A turn seen whole after the send still counts.
  assert.equal(run([sent()], [end(-60), start(2), end(5), ask(7)]).status, STATUS.READ_NO_ANSWER);
  // A wait cleared before the send is no wait; the hook's own permission ask is not a deliberate one.
  assert.equal(run([sent()], [ask(-30), { state: 'working', at: ms(-20), by: 'agent' }, end(-10)]).status, STATUS.NOT_YET);
  assert.equal(run([sent()], [end(-60), ask(-30, 'auto'), end(-20)]).status, STATUS.NOT_YET);
});

test('a held message typed later counts from when it was typed; a dropped one says so', () => {
  const held = sent({ state: 'held' });
  const typed = { kind: 'held-delivered', of: 'm10', from: 'leo', to: 'mara', at: at(20), state: 'placed' };
  // A turn between the send and the typing does not count; one after the typing does.
  assert.equal(run([held, typed], [end(-60), start(5), end(9)]).status, STATUS.NOT_YET);
  assert.equal(run([held, typed], [end(-60), start(25), end(29)]).status, STATUS.READ_NO_ANSWER);
  const dropped = { kind: 'held-dropped', of: 'm10', from: 'leo', to: 'mara', at: at(30) };
  const d = run([held, dropped], []);
  assert.equal(d.status, STATUS.NOT_DELIVERED);
  assert.equal(d.delivery, 'dropped');
  assert.match(sentence(d), /dropped it at /);
  assert.doesNotMatch(sentence(d), /["\\]/);
});

test('names compare as the roster resolves them, not as typed', () => {
  const sessionOf = (n) => ({ mara: 'mara', leo: 'leo' })[String(n).toLowerCase()] || n;
  const rows = [sent({ to: 'Mara' }), { kind: 'message', id: 'm11', from: 'mara', to: 'Leo', at: at(3), state: 'placed', in_reply_to: 'm10' }];
  const s = status('m10', { rows, history: () => [], sessionOf, asker: 'mara' });
  assert.equal(s.status, STATUS.ANSWERED, JSON.stringify(s));
});

test('a cut history whose first mark is a start is not read as a fresh turn', () => {
  const cut = [beat(-50), start(3), end(6)];
  cut.truncated = true;
  assert.equal(run([sent()], cut).status, STATUS.MAYBE_READ);
  const quiet = [beat(-50)];
  quiet.truncated = true;
  assert.equal(run([sent()], quiet).status, STATUS.UNKNOWN);
});

test('a history with no turn mark at all is unknown, not "not read yet"', () => {
  const s = run([sent()], [beat(-60), { state: 'working', at: ms(-50), by: 'agent' }]);
  assert.equal(s.status, STATUS.UNKNOWN);
  assert.match(sentence(s), /no turn reports from the report hook of mara are recorded/);
});

test('a held reply counts as an answer only once it was typed', () => {
  const reply = { kind: 'message', id: 'm11', from: 'mara', to: 'leo', at: at(3), state: 'held', in_reply_to: 'm10' };
  assert.equal(run([sent(), reply], [end(-60), start(2), end(5)]).status, STATUS.READ_NO_ANSWER);
  const typed = { kind: 'held-delivered', of: 'm11', from: 'mara', to: 'leo', at: at(9), state: 'placed' };
  assert.equal(run([sent(), reply, typed], [end(-60), start(2), end(5)]).status, STATUS.ANSWERED);
});

test('a session restart ends a standing wait: the new session\'s turns count', () => {
  const ask = { state: 'needs_you', at: ms(-30), by: 'agent' };
  const restart = { state: 'started', at: ms(-20), by: 'auto' };
  assert.equal(run([sent()], [end(-60), ask, restart, end(-10)]).status, STATUS.NOT_YET);
  assert.equal(run([sent()], [end(-60), ask, restart, start(2), end(5)]).status, STATUS.READ_NO_ANSWER);
});

test('a turn running at delivery that ended, then a whole turn after it: read with no answer', () => {
  assert.equal(run([sent()], [end(-60), start(-30), end(3), start(5), end(9)]).status, STATUS.READ_NO_ANSWER);
  assert.equal(run([sent()], [end(-60), start(-30), end(3), start(5)]).status, STATUS.READING);
});

test('an automatic blocked (a provider stop) is a standing wait; the hook\'s permission ask is not', () => {
  assert.equal(run([sent()], [end(-60), { state: 'blocked', at: ms(-10), by: 'auto' }]).status, STATUS.UNKNOWN);
});

test('a reply that cites another message, or came before a held message was typed, is not its answer', () => {
  const other = { kind: 'message', id: 'm11', from: 'mara', to: 'leo', at: at(3), state: 'placed', in_reply_to: 'm7' };
  assert.equal(run([sent(), other], [end(-60), start(2), end(5)]).status, STATUS.READ_NO_ANSWER);
  const held = sent({ state: 'held' });
  const typed = { kind: 'held-delivered', of: 'm10', from: 'leo', to: 'mara', at: at(20), state: 'placed' };
  const early = { kind: 'message', id: 'm12', from: 'mara', to: 'leo', at: at(10), state: 'placed' };
  assert.equal(run([held, early, typed], [end(-60)]).status, STATUS.NOT_YET);
});

test('every sentence is plain ASCII', () => {
  for (const h of [[end(-60), { state: 'stopped', at: ms(4), by: 'auto' }], [end(-60), start(2), end(9)]]) {
    assert.match(sentence(run([sent()], h)), /^[\x20-\x7e]*$/);
  }
});

test('an unsent line in the input box is said', () => {
  assert.match(sentence(run([sent({ unsubmitted: true })], [end(-60)])), /left unsent in its input box/);
});

test('the turn sentences match what the report hooks send', () => {
  const selfreport = require('./selfreport');
  const hook = require('./kosmos-report-hook');
  const fs = require('node:fs');
  const path = require('node:path');
  assert.equal(require('./toolloop').endsTurn('working', selfreport.TURN_START_TEXT), 'prompt');
  const js = fs.readFileSync(path.join(__dirname, 'kosmos-report-hook.js'), 'utf8');
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install', 'kosmos-report-hook.sh'), 'utf8');
  for (const text of [selfreport.TURN_START_TEXT, selfreport.TURN_END_TEXT]) {
    assert.ok(js.includes("'" + text + "'"), 'engine/kosmos-report-hook.js no longer sends ' + text);
    assert.ok(sh.includes(' ' + text), 'install/kosmos-report-hook.sh no longer sends ' + text);
  }
  assert.ok(hook, 'the hook module loads');
});

test('a turn already running at delivery that ends later is maybe read, never read', () => {
  const s = run([sent()], [start(-30), beat(1), end(6)]);
  assert.equal(s.status, STATUS.MAYBE_READ);
  assert.match(sentence(s), /may have read your message in that turn, or it may read it in its next one/);
});

test('a copied prompt sentence mid-turn (a room post stamp) is not a new turn', () => {
  // The start at 3 follows a start with no end between: the same turn.
  assert.equal(run([sent()], [start(-30), start(3), end(6)]).status, STATUS.MAYBE_READ);
});

test('a turn started after delivery and not ended is reading', () => {
  const s = run([sent()], [end(-60), start(2), beat(5)]);
  assert.equal(s.status, STATUS.READING);
});

test('no turn since delivery is not yet read', () => {
  assert.equal(run([sent()], [end(-60)]).status, STATUS.NOT_YET);
});

test('an agent\'s own idle report or a person\'s clear is not a turn end', () => {
  assert.equal(run([sent()], [end(-60), start(2), end(5, 'agent'), end(6, 'operator')]).status, STATUS.READING);
});

test('a session that stopped or restarted after delivery says so', () => {
  const s = run([sent()], [end(-60), { state: 'stopped', at: ms(4), by: 'auto' }]);
  assert.equal(s.status, STATUS.SESSION_ENDED);
});

test('no history, or one cut after the send, is unknown, not "not yet"', () => {
  assert.equal(run([sent()], null).status, STATUS.UNKNOWN);
  const cut = [start(2), end(9)];
  cut.truncated = true;
  assert.equal(run([sent()], cut).status, STATUS.UNKNOWN);
  const reaching = [end(-60), start(2), end(9)];
  reaching.truncated = true;   // cut, but its first row is before the send: it can still say
  assert.equal(run([sent()], reaching).status, STATUS.READ_NO_ANSWER);
});

test('a held or refused row is not delivered', () => {
  const s = run([sent({ state: 'held' })], [start(2), end(9)]);
  assert.equal(s.status, STATUS.NOT_DELIVERED);
  assert.equal(s.delivery, 'held');
});

test('a bad id, a missing id, a room post and an outsider are refused', () => {
  assert.equal(status('12', { rows: [sent()] }).found, false);
  assert.equal(status('m99', { rows: [sent()] }).found, false);
  const post = { kind: 'post', id: 'm10', from: 'leo', to: ['mara'], at: at(0), state: 'placed' };
  assert.equal(status('m10', { rows: [post] }).found, false);
  const out = run([sent()], [], { asker: 'kai' });
  assert.equal(out.found, false);
  assert.match(out.because, /sent by you or to you/);
  // The same refusal for a missing id, so an outsider cannot tell the two apart.
  assert.equal(status('m99', { rows: [sent()], asker: 'kai' }).because, out.because.replace('m10', 'm99'));
  assert.equal(run([sent()], [end(-60)], { asker: 'mara' }).status, STATUS.NOT_YET);
});

test('the history is read under the recipient\'s session name', () => {
  let asked = null;
  status('m10', { rows: [sent()], history: (n) => { asked = n; return []; }, sessionOf: () => 'mara-session' });
  assert.equal(asked, 'mara-session');
});

test('a --no-reply message says no answer was asked for', () => {
  assert.match(sentence(run([sent({ replyExpected: false })], [end(-60), start(2), end(9)])), /no answer was asked for/);
});

test('no sentence holds a straight quote or a backslash (the bash CLI lifts it with sed)', () => {
  const hists = [[end(-60), start(2), end(9)], [start(-30), end(6)], [end(-60), start(2)], [end(-60)], null,
    [{ state: 'stopped', at: ms(4), by: 'auto' }]];
  for (const h of hists) assert.doesNotMatch(sentence(run([sent()], h)), /["\\]/);
  assert.doesNotMatch(sentence(run([sent({ state: 'held' })], [])), /["\\]/);
});

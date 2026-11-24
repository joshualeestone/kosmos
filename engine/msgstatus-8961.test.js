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
  assert.match(out.because, /not sent by you or to you/);
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

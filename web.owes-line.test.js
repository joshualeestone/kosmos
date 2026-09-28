'use strict';

/**
 * "Nothing back yet" on the agent's own thread (#5).
 *
 * 🛑 THE ENGINE HAD THIS AND NO SCREEN COULD REACH IT. `messages.owesReply` was
 * implemented, exported and covered by twelve tests, and nothing called it: no
 * route, no payload field, no line. Fourth instance of that shape in a night.
 *
 * 🔑 A ONE-TO-ONE THREAD HAS NO ROOM-STYLE SIGNAL that an agent has gone quiet.
 * The room once carried a matching "Nothing back from ..." sentence; #3130
 * removed it and #3202 its plumbing (pjSilentSince), but this one-to-one box is
 * a distinct surface Josh kept.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const chat = require('./engine/chat');   // #4340: the page draws the engine's answer
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 10 * 60 * 1000).toISOString();
/* Rows as the thread route really sends them: a delivery state per message.
   The line only counts what actually reached the agent, so a fixture without
   one is a fixture that cannot produce the line. */
const landed = (at) => ({ at, delivery: { state: 'placed' } });
const failed = (at) => ({ at, delivery: { state: 'could_not' } });

function line(owes) {
  // eslint-disable-next-line no-new-func
  return new Function('OWES',
    page.lift(SCRIPT, 'pjOldEnoughToJudge') + '\n'
    + 'const PJ_SILENCE_AFTER_MS = ' + (SCRIPT.match(/const PJ_SILENCE_AFTER_MS = ([^;]+);/)[1]) + ';\n'
    + page.lift(SCRIPT, 'dmOwesLine') + '\nreturn dmOwesLine(OWES);')(owes);
}

test('an agent that has gone quiet on you says so, after the grace period', () => {
  assert.match(line({ state: 'owes', lastHeardAt: OLD }, [landed(OLD)]), /Nothing back yet\./);
});

test('the grace period is the room’s, from the room’s constant', () => {
  /* ⚠️ SHARED, NOT COPIED. Two surfaces disagreeing about how long silence is
     normal shows a person two claims about one silence, and a copied number
     drifts the first time either is tuned. */
  assert.equal(line({ state: 'owes', lastHeardAt: NOW }, [landed(NOW)]), '',
    'a message sent seconds ago already accuses the agent of not answering');
  const decl = SCRIPT.match(/const PJ_SILENCE_AFTER_MS = ([^;]+);/);
  assert.ok(decl, 'the room constant is gone, so this line has its own number now');
  assert.ok(!/2 \* 60 \* 1000/.test(page.lift(SCRIPT, 'dmOwesLine')),
    'the grace period is written out again inside the line rather than shared');
});

test('an unreadable record says it cannot tell, and never that it answered', () => {
  /* 🛑 THE STATE THAT WAS ALREADY WRONG IN THE ENGINE: an unreadable log came
     back as "nothing is owed". Silence here would render "we could not look" as
     "it has answered". */
  const s = line({ state: 'unknown', because: 'we could not read it' });
  assert.match(s, /cannot tell whether it has answered/);
  assert.ok(!/Nothing back yet/.test(s), 'a could-not-look rendered as a verdict');
});

test('a clear agent, and a malformed answer, say nothing at all', () => {
  for (const owes of [{ state: 'clear', lastHeardAt: OLD }, null, undefined, {}, 'yes', { state: 'nonsense' }]) {
    assert.equal(line(owes, [landed(OLD)]), '', 'a line appeared for ' + JSON.stringify(owes));
  }
  /* CONTROL: something can produce a line, so the emptiness above is a
     decision rather than a function that returns nothing. */
  assert.notEqual(line({ state: 'owes', lastHeardAt: OLD }, [landed(OLD)]), '');
});

test('an unparseable timestamp is not treated as long ago', () => {
  /* The room's own rule: no timestamp is not "long ago". Falling the other way
     would accuse an agent on the strength of a broken field. */
  for (const at of ['not a date', '', null, 0]) {
    assert.equal(line({ state: 'owes', lastHeardAt: at }), '',
      'a bad timestamp of ' + JSON.stringify(at) + ' counted as old enough to judge');
  }
});

test('the route carries the answer, computed from the one-to-one thread itself (#4340)', () => {
  const srv = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  /* #4340: from the DIRECT thread's own rows (chat.dmOwes), under the agent's canonical name, not from the
     `kosmos msg` / room log (messages.owesReply), which never holds a person's DM or the agent's reply.
     server.dm-owes-4340.test.js proves the behaviour through the route; this pins where it comes from. */
  assert.match(srv, /const owes = chat\.dmOwes\(messages, name, \{ paused: dmPaused \}\);/,
    'the thread route no longer computes it from the thread it serves');
  /* On the FULL thread, before the 200-row tail (the DM thread route's slice is the first in server.js). */
  const owesAt = srv.indexOf('const owes = chat.dmOwes(messages, name, { paused: dmPaused });');
  const sliceAt = srv.indexOf('if (olderCount) messages = messages.slice(-TAIL);');
  assert.ok(owesAt > 0 && sliceAt > 0 && owesAt < sliceAt,
    'owes is taken after the 200-row tail, so an owed message just outside it is forgotten');
  assert.doesNotMatch(srv, /owes = messageLog\.owesReply|owes = messages\.owesReply/,
    'the thread route went back to the message log, which never holds a person DM');
  assert.match(srv, /^\s+owes,$/m, 'the payload no longer carries it');
  assert.match(SCRIPT, /dmOwesLine\(body\.owes\)/, 'the thread box no longer draws it from the engine\'s answer alone');
});

test('a message that never reached the agent does not accuse it of silence (#4340: decided once, by the engine)', () => {
  /* #4340: ONE DERIVATION. The page no longer re-filters rows; chat.dmOwes decides what is owed and the page draws
     its answer. So these run the REAL engine on the rows and hand its answer to the page, as the route does. */
  const drawn = (rows) => line(chat.dmOwes(rows, 'april'));
  assert.equal(drawn([failed(OLD)]), '', 'an undelivered message produced a line blaming the agent for not answering');
  assert.equal(drawn([{ at: OLD }]), '', 'a row with no delivery state at all counted as delivered');
  assert.equal(drawn([]), '', 'an empty thread produced a line');
  /* CONTROL: the same shape with a delivered row DOES produce it. */
  assert.match(drawn([landed(OLD)]), /Nothing back yet/);
  /* A thread whose newest attempt failed but an earlier one landed is judged on the one that landed. */
  assert.match(drawn([landed(OLD), failed(new Date().toISOString())]), /Nothing back yet/);
});

test('#4340: the grace is timed from the message actually owed, not from a menu button pressed since', () => {
  const drawn = (rows) => line(chat.dmOwes(rows, 'april'));
  const NOW = new Date().toISOString();
  assert.match(drawn([landed(OLD), { ...landed(NOW), wire: '2' }]), /Nothing back yet\./,
    'a fresh menu answer hid the line for a message owed 10 minutes');
  assert.equal(drawn([{ ...landed(OLD), wire: '2' }]), '', 'CONTROL: with only a menu answer, nothing is owed');
  assert.equal(drawn([landed(NOW)]), '', 'inside the grace, nothing is said yet');
});

test('#4340: the unknown sentence speaks of this conversation, not the kosmos msg record', () => {
  const s = line({ state: 'unknown', because: 'we could not read this conversation' });
  assert.match(s, /could not read this conversation/);
  assert.doesNotMatch(s, /message record/);
});


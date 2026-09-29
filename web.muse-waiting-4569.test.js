'use strict';
/**
 * #4569 fix 4: a busy Muse agent's card says how many messages wait and whether the person's is next.
 * Runs the page's own taskLine / stateReason / waitingLine source on the card shapes the board sends, called the
 * way the card (.atask), the list row (.ltask) and the agent page (#d-task) call them: with noQuote, which hides
 * an agent's own reported words for a working agent (#986, #3271) and so hid this line in the first version.
 *
 *   node --test web.muse-waiting-4569.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function pageFnSource(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' is gone from the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', start); k < PAGE.length; k++) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) return PAGE.slice(start, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const api = new Function([pageFnSource('waitingLine'), pageFnSource('stateReason'), pageFnSource('taskLine'),
  'return { waitingLine, stateReason, taskLine };'].join('\n'))();

const MUSE = (waiting, extra) => ({ state: 'working', runner: 'muse', stateReported: true, because: 'it says it is working', waiting, ...extra });

test('#4569 fix 4: the card, list and agent page line says what waits, in Kosmos\'s words, unquoted', () => {
  for (const opts of [{ noQuote: true }, undefined]) {
    assert.equal(api.taskLine(MUSE({ n: 15, yours: 1 }), opts), '15 messages waiting, yours is next');
    assert.equal(api.taskLine(MUSE({ n: 3, yours: 2 }), opts), '3 messages waiting, yours are next');
    assert.equal(api.taskLine(MUSE({ n: 2, yours: 2 }), opts), '2 messages waiting, all yours');
    assert.equal(api.taskLine(MUSE({ n: 1, yours: 1 }), opts), '1 message waiting, yours');
    assert.equal(api.taskLine(MUSE({ n: 14, yours: 0 }), opts), '14 messages waiting');
  }
});

test('#4569 fix 4: no count, a nonsense count, or a state other than working shows nothing new', () => {
  // CONTROL: the same working Muse card with no queue reads as before (nothing on the card, #986).
  assert.equal(api.taskLine(MUSE(null), { noQuote: true }), '');
  assert.equal(api.taskLine(MUSE({ n: 0, yours: 0 }), { noQuote: true }), '');
  assert.equal(api.taskLine(MUSE({ n: 'x', yours: 1 }), { noQuote: true }), '');
  assert.equal(api.taskLine({ ...MUSE({ n: 4, yours: 1 }), state: 'idle' }, { noQuote: true }), '', 'an idle card claimed a queue');
  assert.equal(api.waitingLine({ n: 2, yours: 9 }), '2 messages waiting, all yours', 'yours above n is capped at n');
});

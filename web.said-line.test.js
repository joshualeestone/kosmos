'use strict';

/**
 * #569: a statement and a guess must not render alike. Six of seventeen
 * agents on the fleet that built this speak for themselves (#526/#565);
 * eleven are still inferred from their screens. The engine has carried the
 * distinction since #526 (`stateReported`, `stateConflict`); these pin that
 * the page shows it rather than re-hiding it, in Mona Lisa's ruled words:
 * WHERE the state came from, never how. "Said so itself" / "Read from its
 * screen", under the state, never inside the state word.
 *
 * Lifted from the shipped page, the same harness as
 * web.pane-title-status.test.js, so the functions under test are the real
 * ones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

const saidLineOf = (a) => new Function('a', `${page.lift(SCRIPT, 'saidLine')}\nreturn saidLine(a);`)(a);
const conflictNoteOf = (a) => new Function('a', `${page.lift(SCRIPT, 'conflictNote')}\nreturn conflictNote(a);`)(a);
function taskLineOf(a) {
  return new Function('a',
    `${page.lift(SCRIPT, 'stateReason')}\n${page.lift(SCRIPT, 'taskLine')}\nreturn taskLine(a);`)(a);
}

test('the two provenances get their ruled words, and only those two speak', () => {
  assert.equal(saidLineOf({ stateReported: true, state: 'working', stateConfidence: 'structured' }), 'Said so itself');
  assert.equal(saidLineOf({ stateReported: false, state: 'idle', stateConfidence: 'scraped' }), 'Read from its screen');
  /* A structural stop is neither: "Not running" already says itself plainly,
     and claiming we read a screen would be false. */
  assert.equal(saidLineOf({ stateReported: false, state: 'stopped', stateConfidence: 'structured' }), '');
  /* An unknown card carries its own honesty payload; we could NOT read its
     screen, so this line must not claim we did. */
  assert.equal(saidLineOf({ stateReported: false, state: 'unknown', stateConfidence: 'none' }), '');
  assert.equal(saidLineOf(null), '');
});

test('a reported state speaks in the agent\'s own sentence, quoted, on the shared task derivation', () => {
  const got = taskLineOf({ state: 'working', stateReported: true, because: 'wiring the report route' });
  assert.equal(got, '“wiring the report route”');
  /* The quotes are the sighted mark for "in its own words": a scraped row has
     no quoted sentence, so a statement and a guess cannot look the same. */
  const scraped = taskLineOf({ state: 'working', stateReported: false, because: 'it is mid-task' });
  assert.equal(scraped, '');
});

test('a reported needs_you puts the actual question on the card', () => {
  const got = taskLineOf({ state: 'needs_you', stateReported: true, because: 'Which domain should the relay use?' });
  assert.match(got, /Which domain should the relay use\?/);
});

test('#209 still holds for reporters: the frozen pane title never leaks back through the reported arm', () => {
  const FROZEN = 'Project 821226pmtest m54';
  assert.equal(taskLineOf({ state: 'working', stateReported: true, because: null, task: FROZEN }), '',
    'a reported state with no sentence borrowed the fossil title');
  assert.equal(taskLineOf({ state: 'idle', stateReported: false, task: FROZEN }), '');
});

test('the conflict note dresses the engine\'s sentence and invents nothing', () => {
  assert.equal(conflictNoteOf({ stateConflict: 'its screen shows a question its reports do not mention' }),
    'Its screen shows a question its reports do not mention.');
  assert.equal(conflictNoteOf({ stateConflict: null }), '');
  assert.equal(conflictNoteOf({}), '');
  /* An engine sentence that already ends firmly is not double-stopped. */
  assert.equal(conflictNoteOf({ stateConflict: 'it reported stopping, but it is still running.' }),
    'It reported stopping, but it is still running.');
});

test('the three surfaces all read the shared derivations rather than keeping copies', () => {
  /* The card, the list row and the detail painter must call saidLine and
     conflictNote, not re-derive them: surfaces that disagree about one agent
     are worse than either being wrong, this file's own recurring lesson. */
  const cardFn = page.lift(SCRIPT, 'card');
  const lrowFn = page.lift(SCRIPT, 'lrow');
  assert.ok(cardFn.includes('saidLine(') && cardFn.includes('conflictNote('), 'the card stopped reading the shared derivations');
  assert.ok(lrowFn.includes('saidLine('), 'the list row stopped reading saidLine');
  assert.ok(SCRIPT.includes("getElementById('d-said')") && SCRIPT.includes("getElementById('d-conflict')"),
    'the detail painter stopped filling the provenance and conflict slots');
});

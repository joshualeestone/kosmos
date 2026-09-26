'use strict';

/**
 * #569: a statement and a guess must not render alike. Six of seventeen
 * agents on the fleet that built this speak for themselves (#526/#565);
 * eleven are still inferred from their screens. The engine has carried the
 * distinction since #526 (`stateReported`; `stateConflict` is never shown, #3729); these pin that
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

/* #3729 (Josh, 2026-09-25 07:32): "I dont even what there to be a space on these to have any
   message like this injected." The witnesses-disagree note and its slot are gone from the card and
   the agent page, and nothing in the page reads the field it came from. The rendered proof, with
   the old sentences fed in, is docs/browser-checks/render-no-conflict-3729.js. */
test('#3729: no conflict note, no slot for one, and nothing reads stateConflict', () => {
  const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // comments do not count
  assert.ok(!/function conflictNote\b/.test(code), 'conflictNote is back');
  assert.ok(!/stateConflict/.test(code), 'the page reads stateConflict again');
  assert.ok(!PAGE.includes('id="d-conflict"'), 'the agent page has its conflict slot again');
  assert.ok(!code.includes("'d-conflict'"), 'something writes into a conflict slot again');
  // Control: the same scan finds a field the page does read, so a zero above is a real zero.
  assert.ok(/stateReported/.test(code), 'control: the scan cannot see the page reading its fields');
});

test('the list row and the detail painter still read the shared derivations, so they cannot disagree with each other', () => {
  /* The list row and the detail painter must call saidLine, not re-derive it:
     surfaces that disagree about one agent are worse than either being wrong,
     this file's own recurring lesson. (The conflict slot is gone, #3729.) */
  /* #3729 review: the list row's `saidLine(` match was its own HTML COMMENT; no code in the page
     calls saidLine any more (on main either). Pinned as what it is, with comments stripped, rather
     than as a caller that does not exist. */
  const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/\bsaidLine\(a\)/.test(page.lift(SCRIPT, 'lrow').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'the list row calls saidLine again; update this test to pin it as a real caller');
  assert.ok(code.includes("getElementById('d-said')"), 'the detail painter stopped filling the provenance slot');
});

/* #855 (Josh, 2026-08-25 10:22): "let's do away with the status line
   altogether. It's just junking up the page." Scoped to the grid card
   only -- the list row and the detail panel keep it (the test above),
   and saidLine() itself is unchanged, still backing both. This is the
   deliberate absence, pinned so a future card-template edit does not
   accidentally reintroduce it and does not get read as a regression if
   it stays gone. #3729 then removed the witnesses-disagree note as well. */
test('the card no longer reads saidLine (#855) or a conflict note (#3729)', () => {
  const cardFn = page.lift(SCRIPT, 'card');
  assert.ok(!cardFn.includes('saidLine('), 'the grid card is calling saidLine again; #855 asked for this line gone');
  assert.ok(!cardFn.includes('asaid'), 'the grid card still carries the retired .asaid class');
  assert.ok(!cardFn.includes('conflictNote(') && !cardFn.includes('stateConflict'), 'the card has a conflict note again; #3729 removed it');
});

/* #855: "move the model that they're on higher up". Pinned by position
   relative to .astate and .atask rather than by a hardcoded index, so a
   later, unrelated field added to the card does not make this test
   fail for the wrong reason. */
test('the model line sits right after the state pill, ahead of the task line, since #855', () => {
  const cardFn = page.lift(SCRIPT, 'card');
  const iState = cardFn.indexOf('class="astate ');
  const iModel = cardFn.indexOf('class="amodel"');
  const iTask = cardFn.indexOf('class="atask"');
  assert.ok(iState > -1 && iModel > -1 && iTask > -1, 'one of astate/amodel/atask went missing from the card');
  assert.ok(iState < iModel, 'the model line is not after the state pill');
  assert.ok(iModel < iTask, 'the model line is not ahead of the task line');
});

/* #856 (Josh, 2026-08-25 10:23): "agent name, agent title, its status,
   whatever text it reported, its model, its percentage used" -- six
   columns, that order, in the running list row. Pinned by position
   relative to one another, not by a hardcoded index, for the same reason
   as the card test above. Title and model both pulled out of .lname's
   own stacked small/em (checked absent below), so name carries only the
   name now. */
test('the list row lays out name, title, status, reported text, model, percentage in that order, since #856', () => {
  const lrowFull = page.lift(SCRIPT, 'lrow');
  // lrow() has TWO templates (an early-return off/notrunning branch, then
  // the running one) -- indexOf on the whole function would find the
  // off-branch's occurrences first and compare indices across two
  // different templates inconsistently. Scope to the running branch only,
  // which starts at its own const m = cardStOf(a) line.
  const runningStart = lrowFull.indexOf('const m = cardStOf(a);');
  assert.ok(runningStart > -1, 'the running branch’s own start line moved; re-anchor this test');
  const lrowFn = lrowFull.slice(runningStart);
  const iName = lrowFn.indexOf('class="lname"');
  const iTitle = lrowFn.indexOf('class="ltitle"');
  const iState = lrowFn.indexOf('class="lstate"');
  const iTask = lrowFn.indexOf('class="ltask"');
  const iModel = lrowFn.indexOf('class="lmodel"');
  const iMem = lrowFn.indexOf('class="lmem"');
  assert.ok([iName, iTitle, iState, iTask, iModel, iMem].every((i) => i > -1),
    'one of lname/ltitle/lstate/ltask/lmodel/lmem went missing from the running list row');
  assert.ok(iName < iTitle && iTitle < iState && iState < iTask && iTask < iModel && iModel < iMem,
    'the list row’s columns are not in the order Josh asked for: name, title, status, reported, model, percentage');
  assert.doesNotMatch(lrowFn.slice(0, iTitle), /<small>|<em>/,
    'the name cell still stacks role/model inside itself instead of the row carrying them as their own columns');
});

'use strict';
/*
 * The 0.7.57 board noise read: six repeated lines removed (kosmos#6517, #6518, #6519, #6520, #6521, #6522).
 * Each removal is pinned absent from web/index.html, and beside it a line that must stay is pinned present, so a
 * test that cannot read the page (or reads the wrong one) fails on the control rather than passing on an absence.
 *
 *   node --test web.noise0757.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/** The markup of one element from its id to the end of its paragraph. */
function paragraphById(id) {
  const at = PAGE.indexOf('id="' + id + '"');
  assert.ok(at > -1, id + ' is not in the page');
  return PAGE.slice(at, PAGE.indexOf('</p>', at));
}

const SUBSCRIPTION_SENTENCE = 'Your agents then run on your own subscription, on this computer.';

test('#6517: the subscription bar says its one fact and no idle count', () => {
  assert.ok(PAGE.includes("'Kosmos cannot reach a Claude subscription on this computer.'"), 'CONTROL: the bar lost its first sentence');
  assert.ok(!PAGE.includes('sitting idle and may not be able to start work'), 'the bar still counts idle agents');
  // Run the real function with idle agents: the text is the headline alone.
  const src = PAGE.match(/function renderConnection\(conn, agents, dependsOnClaude\) \{[\s\S]*?\n\}/);
  assert.ok(src, 'renderConnection moved');
  const el = { hidden: null, textContent: null, className: null };
  // eslint-disable-next-line no-unused-vars
  const document = { getElementById: (id) => (id === 'conn' ? el : null) };
  // eslint-disable-next-line no-eval
  eval('(' + src[0] + ')')({ state: 'none' }, [{ state: 'idle' }, { state: 'idle' }], true);
  assert.equal(el.hidden, false, 'CONTROL: the bar did not show');
  assert.equal(el.textContent, 'Kosmos cannot reach a Claude subscription on this computer.');
});

test('#6518: the restart panel says the restart once, and the Done report says starts at login once', () => {
  // #6714: the restart notice is a compact notice now; its one reassuring line is the body sentence that stays.
  assert.ok(PAGE.includes("const kept = 'Its folder and memory are untouched.';"), 'CONTROL: the body sentence that stays is gone');
  assert.ok(!PAGE.includes('starts them when you log in, so they stop when'), 'the body still repeats the headline');
  assert.ok(PAGE.includes("'starts at login, and is running now'"), 'CONTROL: the per-agent Done row is gone');
  assert.ok(!PAGE.includes('Restarting this computer will bring these back.'), 'the Done report still repeats its rows');
});

test('#6519: no Kosmos+ label on each request card; the board notice keeps it', () => {
  assert.ok(PAGE.includes('<div class="asknote"><span class="askbrand">Kosmos+</span>'), 'CONTROL: the board strip lost its Kosmos+ label (#4637)');
  assert.ok(!PAGE.includes('<p class="askbrand">Kosmos+</p>'), 'a request card on the Kosmos+ page still prints the label');
});

test('#6520: the not-yet-expired login notice has no sentence beside Refresh login', () => {
  assert.ok(PAGE.includes('">Refresh login</button>'), 'CONTROL: the Refresh login button changed');
  assert.ok(PAGE.includes("('Sign in again to bring ' + (n === 1 ? 'it' : 'them') + ' back.')"), 'CONTROL: the expired variant is gone');
  assert.ok(!PAGE.includes("('Sign in again to keep ' + (n === 1"), 'the notice still says sign in again to keep them running');
  assert.ok(!PAGE.includes(': sign in again to keep its agents running.'), 'the Settings twin still repeats its Sign in again button');
});

test('#6521: the first-run sign-in panels do not repeat the Model step lead; Settings keeps the sentence', () => {
  assert.ok(PAGE.includes('<p>Your agents run on your own subscription, on this computer.</p>'), 'CONTROL: the step lead is gone');
  for (const id of ['fr-openai-sub-t', 'fr-gemini-sub-t', 'fr-grok-sub-t']) {
    const p = paragraphById(id);
    assert.match(p, /Sign in with your/, 'CONTROL: ' + id + ' is not the sign-in panel');
    assert.ok(!p.includes(SUBSCRIPTION_SENTENCE), id + ' still repeats the step lead');
  }
  const windowsFirstRun = PAGE.match(/frOpenaiSubHow: '([^']*)'/);
  assert.ok(windowsFirstRun, 'the Windows first-run copy is gone');
  assert.ok(!windowsFirstRun[1].includes('own subscription'), 'the Windows first-run copy still repeats the step lead');
  // Settings > AI Models has no lead above its panels, so its three panels and the Windows Settings copy keep it.
  assert.equal(PAGE.split(SUBSCRIPTION_SENTENCE).length - 1, 4, 'CONTROL: the Settings sentence count changed');
});

test('#6522: add a computer says each thing once', () => {
  // The waiting line: the pill says it is waiting; the line says what to do.
  assert.ok(PAGE.includes("If you have not yet, type this code on ' + name"), 'CONTROL: the kept waiting sentence is gone');
  assert.ok(!PAGE.includes('to allow this computer. If you have not yet'), 'the waiting line still repeats the pill');
  // The Allow card: the computer is named once, in its heading.
  assert.ok(PAGE.includes("'Your computer \"' + askEsc(d.joining_computer) + '\" wants to join'"), 'CONTROL: the heading lost the name');
  assert.ok(!PAGE.includes("'Type the code shown on ' + name + ', then press '"), 'the Allow card still names the computer in its line');
  assert.ok(!PAGE.includes("'\">Code on ' + name"), 'the field label still names the computer');
  // Review 1: the field is described by the heading that names the computer, and an empty line renders nothing.
  // (render-connect-sheet-4637.js checks the same in a browser, including the error case.)
  assert.ok(PAGE.includes(`'<div class="askwho"><b id="askhead-' + askEsc(d.device_id) + '">' + askHead(d) + '</b>'`), 'the heading has no id to describe the field by');
  assert.ok(PAGE.includes(`const codeDescribedBy = 'askhead-' + askEsc(d.device_id) + (sayText ? ' asksay-' + askEsc(d.device_id) : '');`), 'the field is not described by the heading');
  assert.ok(PAGE.includes(`aria-describedby="' + codeDescribedBy + '"`), 'the field does not use the heading description');
  assert.ok(PAGE.includes(`(sayText ? '<p class="asksay" id="asksay-' + askEsc(d.device_id) + '">' + sayText + '</p>' : '')`), 'an empty line still renders a paragraph');
  // The retry card: a new code, once.
  assert.ok(PAGE.includes('A new code is needed to finish pairing.'), 'CONTROL: the retry line is gone');
  assert.ok(!PAGE.includes('press Try again for a new code'), 'the retry card still says a new code twice');
});

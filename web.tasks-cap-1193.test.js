'use strict';
/**
 * kosmos#1193. Josh: "We should have a View All link for tasks and maybe we only
 * display the first N number. I'll let you decide what that is." Five.
 *
 * 🛑 THE CAP AND THE DOOR'S CONDITION ARE ONE CHANGE. The door was shown only
 * when `behind > 0`, where `behind` counts CLOSED tasks. Capping the column
 * without widening that test loses open tasks with NO control on screen to reach
 * them: eight open and none finished would render five and hide three silently.
 *
 * That is the case this suite exists for. It is not hypothetical: it is what the
 * obvious one-line version of this change does.
 *
 *   node --test web.tasks-cap-1193.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

/* 🛑 THE DOOR IS UNCONDITIONAL SINCE #1382, so the arithmetic this file used to
   mirror is gone. The reasoning is kept as history in the page itself.
   ⇒ The door's job changed: it used to REVEAL this project's hidden rows in
   place, so it correctly stayed away when this project hid nothing. It now
   OPENS A SCREEN listing every project, and a screen that spans projects must
   not be unreachable from a project with five tasks and none finished, which is
   the normal state of a new project.
   📌 THE CAP ITSELF IS UNCHANGED and its pins below stay: five, and the column
   sliced to it. That half of #1193 is untouched by #1382. */

test('the column is still capped at five', () => {
  assert.match(PAGE, /const TK_COLUMN_MAX = 5;/, 'the cap is gone or is no longer five');
  assert.match(PAGE, /column\.slice\(0, TK_COLUMN_MAX\)/, 'the column is no longer capped');
});

test('#1382: the door is offered unconditionally, so the all-tasks screen is always reachable', () => {
  /* CONTROL: the assertion below is about a specific line, so prove the line is
     there at all before reading anything into its shape. */
  assert.match(PAGE, /door\.hidden = false;/, 'the door is never shown at all');
  assert.doesNotMatch(PAGE, /if \(!TK_SHOW_ALL && \(behind \+ hiddenByCap\) > 0\)/,
    'the door is conditional again, so a project that hides nothing cannot reach the all-tasks screen');
  assert.doesNotMatch(PAGE, /TK_SHOW_ALL/,
    'the reveal-in-place state is back; the screen supersedes it and two ways to see hidden tasks will drift');
});

test('#1382: the door carries NO count, because its destination spans every project', () => {
  assert.match(PAGE, /door\.textContent = 'View all tasks/, 'the door lost its label');
  assert.doesNotMatch(PAGE, /door\.textContent = 'View all tasks \(' \+/,
    'a per-project count is back on a control whose destination is every project: that number can only disagree with the screen it opens, which is #1346');
});

test('the files link says View All, in Josh\'s newer words', () => {
  assert.match(PAGE, /'View All ' \+ body\.total : 'View All'/, 'the files link is not View All');
  assert.doesNotMatch(PAGE.replace(/\/\*[\s\S]*?\*\//g, ' '), /'Show all/,
    'a Show all label survives outside a comment');
});

/**
 * CONTROL for the two `doesNotMatch` assertions above.
 *
 * 🛑 A NEGATIVE ASSERTION CAN PASS BECAUSE ITS PATTERN MATCHES NOTHING, EVER.
 * `assert.doesNotMatch(PAGE, /typo/)` is green forever and says nothing. So
 * each forbidden pattern is first run against the exact line it was written
 * from: if it cannot match THAT, it could never have failed.
 *
 * 📌 This replaces #1193's own control, which demonstrated the conditional
 * door's fix by arithmetic. That subject is gone: #1382 made the door
 * unconditional, so there is no condition left to get wrong. The DISCIPLINE is
 * the part worth carrying across, not the arithmetic.
 */
test('CONTROL: the forbidden patterns can actually match', () => {
  const OLD_CONDITION = '  if (!TK_SHOW_ALL && (behind + hiddenByCap) > 0) {';
  const OLD_LABEL = "    door.textContent = 'View all tasks (' + all.length + ') \u2192';";

  assert.match(OLD_CONDITION, /if \(!TK_SHOW_ALL && \(behind \+ hiddenByCap\) > 0\)/,
    'the conditional-door pattern cannot match the line it was written from, so that assertion could never fail');
  assert.match(OLD_LABEL, /door\.textContent = 'View all tasks \(' \+/,
    'the counted-label pattern cannot match the line it was written from, so that assertion could never fail');

  /* And the same two against the page, which is the claim being made. */
  assert.doesNotMatch(PAGE, /if \(!TK_SHOW_ALL && \(behind \+ hiddenByCap\) > 0\)/);
  assert.doesNotMatch(PAGE, /door\.textContent = 'View all tasks \(' \+/);
});

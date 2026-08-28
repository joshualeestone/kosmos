'use strict';
/**
 * kosmos#1198. Josh: "I can't seem to keep the title of the project and its
 * description collapsed. I can close it with the arrow but then it quickly snaps
 * back open."
 *
 * 🔑 THE CAUSE, AND IT IS NOT THE ARROW. `paintOneProject` sets the disclosure
 * from `isEmpty` on EVERY paint, and the board repaints on a poll. His project had
 * no description, an empty description opens BY DESIGN (the affordance telling you
 * a description exists is the only thing in that slot), so every poll a few seconds
 * later reopened what he had just closed.
 *
 * ⇒ Two rules that both still hold and were never in conflict:
 *     an empty description OPENS on arrival
 *     switching projects must not carry one project's state onto the next
 *   What was wrong is that the default ran on every repaint rather than on arrival.
 *
 * ⚠️ A SOURCE ASSERTION IS THE RIGHT INSTRUMENT HERE. The defect only appears
 * across TWO paints separated by a poll; a single render looks correct either way,
 * which is why it survived and why Josh had to report it from use.
 *
 *   node --test web.desc-collapse-1198.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

test('the person\'s click is remembered against the project it was made on', () => {
  assert.match(PAGE, /let PJ_DESC_TOUCHED = null;/, 'nothing records that the person set the disclosure');
  assert.match(PAGE, /PJ_DESC_TOUCHED = PJ_CURRENT;/,
    'the click no longer records WHICH project it was for, so it would apply to every project');
});

test('the arrival default does not run over a choice already made', () => {
  const painter = PAGE.slice(PAGE.indexOf('function paintOneProject()'),
                             PAGE.indexOf('function paintOneProject()') + 4000);
  assert.match(painter, /if \(PJ_DESC_TOUCHED !== PJ_CURRENT\) \{/,
    'the empty-description default is unconditional again, so a poll will reopen what the person closed');
  assert.match(painter, /classList\.toggle\('is-open', isEmpty\)/,
    'the empty-description default is gone; a project with no description loses the only hint that one exists');
});

test('switching projects still clears the remembered choice', () => {
  /* The reset lived in the painter deliberately, so one project's open state
     could not ride onto the next. That protection must survive this fix. */
  assert.match(PAGE, /if \(PJ_DESC_TOUCHED !== null && PJ_DESC_TOUCHED !== PJ_CURRENT\) PJ_DESC_TOUCHED = null;/,
    'moving to another project no longer clears the remembered disclosure, so one project carries its state onto the next');
});

test('CONTROL: the guarded shapes are absent from a page without the fix', () => {
  const before = "const isEmpty = !p.description;\n  if (pjTitle) pjTitle.classList.toggle('is-open', isEmpty);";
  assert.doesNotMatch(before, /PJ_DESC_TOUCHED/, 'the pre-fix shape must not satisfy these assertions');
  assert.match(before, /classList\.toggle\('is-open', isEmpty\)/,
    'and the toggle itself must be recognisable in both, or the second test proves nothing');
});

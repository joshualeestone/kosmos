'use strict';
/**
 * kosmos#2838 (Josh, 2026-09-11, live review of 0.6.57): "I think we missed
 * deleting the arrow to pop down the project description and instead putting the
 * project settings cog there."
 *
 * The disclosure arrow that popped down the inline project description was
 * removed. The description now lives only in Project settings, reached by the
 * settings cog (#pj-settings-link) that already sits in the project header. This
 * reconciles #1005 (the inline description above every conversation read as
 * clutter) over #980 and the 2026-08-20 empty-slot placeholder.
 *
 * These are absence pins: the three suites that guarded the disclosure
 * (web.project-desc-expander, web.desc-collapse-1198, web.desc-align-1303h) were
 * removed with the feature, so this suite is what stops the arrow and the inline
 * description returning silently, AND checks the replacement door and the
 * description's remaining home are still present, so a future "remove it all"
 * cannot also strip the way a person reaches the description.
 *
 *   node --test web.pjone-no-disclosure-2838.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

test('the pop-down disclosure arrow is gone from the markup', () => {
  assert.ok(!PAGE.includes('id="pj-one-more"'),
    'the #pj-one-more disclosure arrow button is back in the header');
  assert.ok(!PAGE.includes('class="pjdisc"') && !/\.pjdisc\b/.test(PAGE),
    'the .pjdisc arrow markup or CSS is back');
});

test('the inline description element is gone from the project header', () => {
  assert.ok(!PAGE.includes('id="pj-one-desc"'),
    'the #pj-one-desc inline description is back on the project detail page');
});

test('the disclosure JS is gone', () => {
  assert.ok(!PAGE.includes('PJ_DESC_TOUCHED'),
    'the PJ_DESC_TOUCHED disclosure-state variable is back');
  assert.ok(!/getElementById\('pj-one-more'\)/.test(PAGE),
    'a handler still wires the removed arrow, which will throw on a null element');
  const painter = PAGE.slice(PAGE.indexOf('function paintOneProject() {'));
  const body = painter.slice(0, painter.indexOf('\nfunction '));
  assert.ok(!body.includes('pj-one-desc') && !body.includes('is-open'),
    'paintOneProject still paints the removed description or toggles the removed disclosure state');
});

test('the settings cog remains as the door to the description', () => {
  assert.ok(PAGE.includes('id="pj-settings-link"'),
    'the settings cog is gone, so there is no way left to reach project settings from the header');
  assert.ok(PAGE.includes('id="pjs-desc"'),
    'the description editor in Project settings is gone, so the description has no home at all');
});

test('the header title still truncates to one line after the arrow removal', () => {
  // The disclosure used to expand a title that was clamped in its closed state.
  // With the disclosure gone the clamp becomes unconditional, so a long project
  // name elides on one line rather than reflowing the compact header row.
  // Open tail (no closing-brace anchor), per the #1430 convention: appending a
  // future declaration to this rule must not red this pin.
  assert.match(PAGE, /\.pjtitle #pj-one-name \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/,
    'the header project title lost its one-line truncation, so a long name now reflows the header');
});

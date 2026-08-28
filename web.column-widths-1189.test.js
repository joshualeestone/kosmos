'use strict';
/**
 * kosmos#1189. Josh: "I want the width of agents to be the same width as
 * projects and I want that also to be the same width as the columns for tasks,
 * files in this project, and project members."
 *
 * Measured with playwright before the fix, at four window widths:
 *
 *   window   agents        projects      files         tasks
 *   1280     200px 15.6%   184px 14.4%   216px 16.9%   182px 14.2%
 *   1920     288px 15.0%   277px 14.4%   324px 16.9%   290px 15.1%
 *
 * 🛑 A PERCENTAGE CANNOT FIX THIS, WHICH IS THE WHOLE POINT. The agents column
 * is `minmax(200px, 15%)` OF THE BODY: flat 200px below about 1333px, then 15%.
 * The right column is a percentage of what is LEFT after agents, so it is a
 * percentage of a DIFFERENT PARENT and cannot track a piecewise curve. Candidates
 * from 20% to 26% each matched at one width and missed at the others.
 *
 * ⭐ `vw` puts both columns in the same units. That is the property this test
 * exists to hold: not a number, but that the two are COMMENSURABLE. A future
 * edit that "tidies" the calc back to a percentage will look harmless, pass every
 * other test, and silently restore a gap that grows with the window.
 *
 * After: 200/200, 240/240, 288/288 for agents, files and tasks.
 * Projects remains ~11px narrower, down from 47px, and is recorded on the card.
 *
 *   node --test web.column-widths-1189.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

const pj3Rule = () => {
  const m = PAGE.match(/html\[data-layout="consolidated"\] body\.consolidated \.pj3 \{[^}]*\}/);
  assert.ok(m, 'the consolidated .pj3 rule is gone');
  return m[0];
};

test('the right column is expressed in the same units as the agents column', () => {
  const rule = pj3Rule();
  assert.match(rule, /grid-template-columns:[^;]*\d+vw/,
    'the right column is no longer in vw, so it cannot track the agents column across widths');
  assert.doesNotMatch(rule, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\([^)]*%\s*\)/,
    'the right column went back to a percentage of a different parent, which is the original defect');
});

test('the agents column is still the thing being matched', () => {
  /* If this changes, the vw figure above is matching nothing and must be re-derived. */
  assert.match(PAGE, /body\.consolidated \{ display: grid; grid-template-columns: minmax\(200px, 15%\)/,
    'the agents column changed; the right column was tuned to 15% of the window and now tracks the wrong target');
});

test('all three panels lose their box, including the aside that holds Tasks', () => {
  /* ⚠️ TASKS IS NOT A .pjcard, IT IS A .field INSIDE aside.pjcol, AND THE ASIDE
     CARRIES THE PADDING. A rule keyed only to .pjcard un-boxes two of the three
     and leaves Tasks 34px narrow. That is exactly what my first version did. */
  /* ⚠️ MATCH BY CONTENT, NOT BY POSITION. Another rule a hundred lines up opens
     with the same selector list (`.pj3 > .pjsplit > .pjcard, ... aside.pjcol`) and
     sets min-height and align-self. `.match()` returns the FIRST, so anchoring on
     the selector alone silently tested the wrong rule and reported this one
     missing. Pick the one that actually clears the box. */
  const rules = PAGE.match(/\.pj3 > \.pjsplit > \.pjcard,[\s\S]{0,400}?\{[^}]*\}/g) || [];
  const m = rules.filter((r) => /padding:\s*0/.test(r));
  assert.equal(m.length, 1, `expected exactly one un-box rule, found ${m.length}`);
  assert.match(m[0], /aside\.pjcol,/, 'the aside holding Tasks is not un-boxed, so Tasks will be narrower than the rest');
  assert.match(m[0], /#pj-tasks-field/, 'the tasks field itself is not un-boxed');
  assert.match(m[0], /padding:\s*0/, 'the un-box rule no longer clears padding');
});

test('CONTROL: these assertions can fail', () => {
  assert.doesNotMatch('grid-template-columns: minmax(0, 1fr) minmax(240px, 26%);', /\d+vw/,
    'the vw check must reject the shipped-before value');
  assert.match('grid-template-columns: minmax(0, 1fr) minmax(224px, calc(15vw + 24px));', /\d+vw/,
    'and accept the fixed one');
});

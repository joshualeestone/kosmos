"use strict";
/**
 * #770: Settings is one content column of one width, centred with the nav
 * beside it; the You tab is Your Profile with one-size picture buttons, no
 * disclaimer, a short name field and a yellow Save. The agent detail page
 * (#panel-detail) shares the same width since 2026-08-25 (Josh: "make the
 * width of the viewing agent the same as we did on the settings stuff").
 *
 *   node --test web.settings-width.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { codeOnly } = require('./test-support/code-only');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('Settings keeps its 34rem column; the agent page (#panel-detail) now goes full-width (#2012)', () => {
  // #2012 REVERSES the 2026-08-25 "match settings width" decision FOR THE AGENT
  // PAGE ONLY: Josh asked for it to be full-width ("a small box in a mostly-empty
  // window"). Settings stays a 34rem reading column; the base rule is SPLIT, not
  // grouped. #3385 ALSO split the 60rem media rule: the agent page now holds the
  // identity in a 220px left column, so the grouped 60rem rule's 176px was NOT a
  // no-op -- it squeezed the identity back to the old nav width in the 56-60rem
  // band. So at 60rem settings relaxes to fluid (176px) while the agent page KEEPS
  // 220px; both stack to one column at 56rem.
  assert.match(PAGE, /#panel-settings \.dbody \{ grid-template-columns: 176px 34rem; justify-content: center; \}/);
  assert.match(PAGE, /#panel-detail \.dbody \{ grid-template-columns: 220px minmax\(0, 1fr\); justify-content: stretch; \}/);
  // The 60rem rule is split: settings -> fluid 176px; detail -> keeps 220px (the #3385 fix).
  assert.match(PAGE, /@media \(max-width: 60rem\) \{ #panel-settings \.dbody \{ grid-template-columns: 176px minmax\(0, 1fr\); justify-content: stretch; \} \}/);
  assert.match(PAGE, /@media \(max-width: 60rem\) \{ #panel-detail \.dbody \{ grid-template-columns: 220px minmax\(0, 1fr\); justify-content: stretch; \} \}/);
  const i60 = PAGE.indexOf('@media (max-width: 60rem) { #panel-settings .dbody {');
  const i56 = PAGE.indexOf('@media (max-width: 56rem) {', i60); // the sheet has several 56rem blocks; the one that counts follows the 60rem rules
  assert.ok(i60 > 0 && i56 > i60, 'the 56rem block comes after the 60rem rules');
  // each rule exactly once: a copy pasted after the block would win there while the originals stay put
  const count = (s) => PAGE.split(s).length - 1;
  assert.equal(count('#panel-settings .dbody { grid-template-columns: 176px 34rem;'), 1, 'one settings base rule');
  // leading newline: the base rule sits at line start; the split media rule carries
  // `#panel-detail .dbody` after `{ ` (mid-line), so `\n#panel-detail` counts only
  // the standalone base rule, not the 60rem restatement.
  assert.equal(count('\n#panel-detail .dbody { grid-template-columns: 220px minmax(0, 1fr); justify-content: stretch;'), 1, 'one detail full-width base rule (#3385: left column widened to 220px for the identity)');
  assert.equal(count('@media (max-width: 60rem) { #panel-settings .dbody {'), 1, 'one 60rem settings rule');
  assert.equal(count('@media (max-width: 60rem) { #panel-detail .dbody {'), 1, 'one 60rem detail rule (#3385: keeps 220px, not squeezed to 176px)');
  assert.equal(count('#panel-settings .dbody, #panel-detail .dbody { grid-template-columns: minmax(0, 1fr); }'), 1, 'one restatement');
  // both base rules sit above the media blocks (same specificity; below them they would win there)
  const iSet = PAGE.indexOf('#panel-settings .dbody { grid-template-columns: 176px 34rem;');
  const iDet = PAGE.indexOf('#panel-detail .dbody { grid-template-columns: 220px minmax(0, 1fr); justify-content: stretch;');
  assert.ok(iSet > 0 && iSet < i60 && iSet < i56, 'the settings base rule sits above the media blocks');
  assert.ok(iDet > 0 && iDet < i60 && iDet < i56, 'the detail base rule sits above the media blocks');
  const end56 = PAGE.indexOf('\n}', i56);
  assert.ok(end56 > i56, 'the 56rem block closes');
  assert.match(PAGE.slice(i56, end56), /#panel-settings \.dbody, #panel-detail \.dbody \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'the restatement sits inside the FIRST 56rem block after the 60rem rules');
});

/* #3385 (Josh, 2026-09-21) SUPERSEDES #2012's full-width header: the identity (.dhead) moved OUT of
   the top banner and INTO the left column, wrapped with the nav in a new .dleft grid column. So the
   header is no longer a full-width banner "matching .dbody"; it is the left column's vertical
   identity stack (avatar, shrink-to-fit name, title, status), and the talk column fills the height. */
test('the agent identity (.dhead) sits in a left column (.dleft) above the nav, not a full-width banner (#3385)', () => {
  const body = codeOnly(PAGE);
  assert.match(body, /<div class="dleft">/, 'the left-column wrapper exists');
  // Inside .dbody: .dleft wraps .dhead then #d-nav, and .dsecs (the sections) is the second column.
  const iDbody = body.indexOf('<div class="dbody">');
  const iDleft = body.indexOf('<div class="dleft">', iDbody);
  const iDhead = body.indexOf('<div class="dhead">', iDleft);
  const iNav = body.indexOf('id="d-nav"', iDhead);
  const iDsecs = body.indexOf('<div class="dsecs">', iNav);
  assert.ok(iDbody > 0 && iDleft > iDbody && iDhead > iDleft && iNav > iDhead && iDsecs > iNav,
    'inside .dbody the left column wraps the identity then the nav, and .dsecs follows');
  // The header stacks vertically now (was a horizontal banner), the left column widened to 220px,
  // and the header margin sits below it in the column.
  assert.match(PAGE, /\.dhead \{ display: flex; flex-direction: column; align-items: center; text-align: center;/, 'the header stacks vertically');
  assert.match(PAGE, /#panel-detail \.dbody \{ grid-template-columns: 220px minmax\(0, 1fr\); justify-content: stretch; \}/, 'the left column widened to 220px');
  assert.match(PAGE, /#panel-detail \.dhead \{ max-width: none; margin: 0 0 16px; \}/, 'the header margin sits below it in the column');
});

test('You is Your Profile: one-size picture buttons, no disclaimer by default, a short name field, a yellow Save', () => {
  const body = codeOnly(PAGE);
  assert.match(body, /data-go="you" aria-controls="s-sec-you" class="on" aria-current="true">Your Profile<\/button>/);
  assert.match(body, /id="s-sec-you" data-sec="you" tabindex="-1" aria-label="Your Profile"/);
  assert.match(body, /<h3 class="dlab">Your Profile<\/h3>/);
  assert.match(body, /<button class="btn sav-btn" type="button" id="you-file-btn">Change picture<\/button>\s*<button class="btn" id="you-remove" type="button" hidden>Remove<\/button>/);
  assert.match(body, /<p class="dhint" id="you-msg" role="status" style="margin:10px 0 0;"><\/p>/, 'the disclaimer is back as the default text');
  assert.doesNotMatch(body, /It appears wherever Kosmos shows you/);
  assert.match(PAGE, /#you-name \{ flex: 0 1 14rem; min-width: 10rem; \}/);
  assert.match(body, /<button class="btn uprime" type="button" id="you-name-save" aria-label="Save your name" disabled>Save<\/button>/);
});

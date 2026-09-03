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
  // window"). Settings stays a 34rem reading column; the base rule is now SPLIT,
  // not grouped. The narrow-window media rules still group both (settings relaxes
  // to fluid at 60rem, both stack at 56rem; the agent page is already fluid, so
  // the grouped media rule is a harmless no-op for it).
  assert.match(PAGE, /#panel-settings \.dbody \{ grid-template-columns: 176px 34rem; justify-content: center; \}/);
  assert.match(PAGE, /#panel-detail \.dbody \{ grid-template-columns: 176px minmax\(0, 1fr\); justify-content: stretch; \}/);
  assert.match(PAGE, /@media \(max-width: 60rem\) \{ #panel-settings \.dbody, #panel-detail \.dbody \{ grid-template-columns: 176px minmax\(0, 1fr\); justify-content: stretch; \} \}/);
  const i60 = PAGE.indexOf('@media (max-width: 60rem) { #panel-settings .dbody, #panel-detail .dbody');
  const i56 = PAGE.indexOf('@media (max-width: 56rem) {', i60); // the sheet has several 56rem blocks; the one that counts follows the 60rem rule
  assert.ok(i60 > 0 && i56 > i60, 'the 56rem block comes after the 60rem rule');
  // each rule exactly once: a copy pasted after the block would win there while the originals stay put
  const count = (s) => PAGE.split(s).length - 1;
  assert.equal(count('#panel-settings .dbody { grid-template-columns: 176px 34rem;'), 1, 'one settings base rule');
  // leading newline: the base rule sits at line start; the grouped media rules
  // carry `#panel-detail .dbody` after `, ` (mid-line), so `\n#panel-detail`
  // counts only the standalone base rule, not the 60rem/56rem restatements.
  assert.equal(count('\n#panel-detail .dbody { grid-template-columns: 176px minmax(0, 1fr); justify-content: stretch;'), 1, 'one detail full-width base rule');
  assert.equal(count('@media (max-width: 60rem) { #panel-settings .dbody, #panel-detail .dbody'), 1, 'one 60rem rule');
  assert.equal(count('#panel-settings .dbody, #panel-detail .dbody { grid-template-columns: minmax(0, 1fr); }'), 1, 'one restatement');
  // both base rules sit above the media blocks (same specificity; below them they would win there)
  const iSet = PAGE.indexOf('#panel-settings .dbody { grid-template-columns: 176px 34rem;');
  const iDet = PAGE.indexOf('#panel-detail .dbody { grid-template-columns: 176px minmax(0, 1fr); justify-content: stretch;');
  assert.ok(iSet > 0 && iSet < i60 && iSet < i56, 'the settings base rule sits above the media blocks');
  assert.ok(iDet > 0 && iDet < i60 && iDet < i56, 'the detail base rule sits above the media blocks');
  const end56 = PAGE.indexOf('\n}', i56);
  assert.ok(end56 > i56, 'the 56rem block closes');
  assert.match(PAGE.slice(i56, end56), /#panel-settings \.dbody, #panel-detail \.dbody \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'the restatement sits inside the FIRST 56rem block after the 60rem rule');
});

/* The agent page has one thing Settings does not: a header (.dhead: avatar,
   name, state) that sits BEFORE .dbody as a sibling, not inside it. Its width
   must AGREE with .dbody's, or the two disagree about the page's width. Under
   the 2026-08-25 "match settings" decision that meant capping both to 34rem;
   under #2012 (the agent page goes full-width) it means the OPPOSITE -- the
   header spans full width too, matching the now-full-width body. Capping the
   header at 34rem while the body went wide would recreate the disagreement in
   reverse. (Making the header a sticky banner the nav pins under is a
   deliberate #2012 follow-up: .snav is already sticky, so the coordination
   wants interactive visual verification.) */
test('the agent detail header spans full width, matching the now-full-width .dbody (#2012)', () => {
  assert.match(PAGE, /#panel-detail \.dhead \{ max-width: none; margin: 0 0 30px; \}/);
  // the 60rem rule stays (now a harmless no-op, since the base is already none),
  // and still sits after .dbody's own 60rem rule
  assert.match(PAGE, /@media \(max-width: 60rem\) \{ #panel-detail \.dhead \{ max-width: none; margin: 0 0 30px; \} \}/);
  const iBodyRelax = PAGE.indexOf('@media (max-width: 60rem) { #panel-settings .dbody, #panel-detail .dbody');
  const iHeadRelax = PAGE.indexOf('@media (max-width: 60rem) { #panel-detail .dhead');
  assert.ok(iBodyRelax > 0 && iHeadRelax > iBodyRelax, 'the header’s 60rem rule follows .dbody’s own 60rem rule');
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

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
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('the settings body is the nav and one 34rem column, centred; narrow windows get the fluid column back', () => {
  assert.match(PAGE, /#panel-settings \.dbody, #panel-detail \.dbody \{ grid-template-columns: 176px 34rem; justify-content: center; \}/);
  assert.match(PAGE, /@media \(max-width: 60rem\) \{ #panel-settings \.dbody, #panel-detail \.dbody \{ grid-template-columns: 176px minmax\(0, 1fr\); justify-content: stretch; \} \}/);
  // at phone width the nav stacks above the section: the id-selector rule must be restated inside the 56rem block, after the 60rem one
  const i60 = PAGE.indexOf('@media (max-width: 60rem) { #panel-settings .dbody, #panel-detail .dbody');
  const i56 = PAGE.indexOf('@media (max-width: 56rem) {', i60); // the sheet has several 56rem blocks; the one that counts follows the 60rem rule
  assert.ok(i60 > 0 && i56 > i60, 'the 56rem block comes after the 60rem rule');
  const iBase = PAGE.indexOf('#panel-settings .dbody, #panel-detail .dbody { grid-template-columns: 176px 34rem;');
  // each rule exactly once: a copy pasted after the block would win there while the originals stay put
  const count = (s) => PAGE.split(s).length - 1;
  assert.equal(count('#panel-settings .dbody, #panel-detail .dbody { grid-template-columns: 176px 34rem;'), 1, 'one base rule');
  assert.equal(count('@media (max-width: 60rem) { #panel-settings .dbody, #panel-detail .dbody'), 1, 'one 60rem rule');
  assert.equal(count('#panel-settings .dbody, #panel-detail .dbody { grid-template-columns: minmax(0, 1fr); }'), 1, 'one restatement');
  assert.ok(iBase > 0 && iBase < i56, 'the base Settings/detail rule also sits above the 56rem block (same specificity; below it, it would win on phones)');
  assert.ok(iBase < i60, 'and above the 60rem rule (same specificity; below it, the 56 to 60rem band would get the centred pair)');
  // the block's closing brace: the window is the block, not a byte count. Assumes every
  // line inside the block is indented (they are); a nested block closed at column 0 would
  // shrink the window and the next assertion would then blame placement.
  const end56 = PAGE.indexOf('\n}', i56);
  assert.ok(end56 > i56, 'the 56rem block closes');
  assert.match(PAGE.slice(i56, end56), /#panel-settings \.dbody, #panel-detail \.dbody \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'the restatement sits inside the FIRST 56rem block after the 60rem rule (if a new 56rem block was added between them, this is that block, not a misplaced rule)');
});

/* #770 gave Settings this width; Josh asked, 2026-08-25 10:07 CDT, for the
   agent detail page ("the viewing agent") to match it, "the same width as
   we did on the settings stuff... fit centered". Settings and the agent
   page share .dbody/.snav/.dsec by design (see the comment above Settings'
   own nav in the markup), so the fix above threads #panel-detail through
   the same selector rather than duplicating Settings' rule -- covered by
   the test above. This test covers the one thing Settings does not have
   and the agent page does: a header (.dhead: avatar, name, state) that
   sits BEFORE .dbody as a sibling, not inside it, so capping .dbody alone
   would leave the header spanning the full window while the sections below
   it centre to 746px. */
test('the agent detail header matches .dbody’s own width so it does not disagree with the sections below it', () => {
  assert.match(PAGE, /#panel-detail \.dhead \{ max-width: calc\(176px \+ 26px \+ 34rem\); margin: 0 auto 30px; \}/);
  assert.match(PAGE, /@media \(max-width: 60rem\) \{ #panel-detail \.dhead \{ max-width: none; margin: 0 0 30px; \} \}/);
  // the 60rem relaxation must sit where .dbody's own 60rem rule sits (the
  // two go fluid together), not orphaned somewhere the cascade cannot reach
  // it at the intended breakpoint
  const iBodyRelax = PAGE.indexOf('@media (max-width: 60rem) { #panel-settings .dbody, #panel-detail .dbody');
  const iHeadRelax = PAGE.indexOf('@media (max-width: 60rem) { #panel-detail .dhead');
  assert.ok(iBodyRelax > 0 && iHeadRelax > iBodyRelax, 'the header’s 60rem relaxation follows .dbody’s own 60rem rule');
});

test('You is Your Profile: one-size picture buttons, no disclaimer by default, a short name field, a yellow Save', () => {
  const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /data-go="you" aria-controls="s-sec-you" class="on" aria-current="true">Your Profile<\/button>/);
  assert.match(body, /id="s-sec-you" data-sec="you" tabindex="-1" aria-label="Your Profile"/);
  assert.match(body, /<h3 class="dlab">Your Profile<\/h3>/);
  assert.match(body, /<button class="btn sav-btn" type="button" id="you-file-btn">Change picture<\/button>\s*<button class="btn" id="you-remove" type="button" hidden>Remove<\/button>/);
  assert.match(body, /<p class="dhint" id="you-msg" role="status" style="margin:10px 0 0;"><\/p>/, 'the disclaimer is back as the default text');
  assert.doesNotMatch(body, /It appears wherever Kosmos shows you/);
  assert.match(PAGE, /#you-name \{ flex: 0 1 14rem; min-width: 10rem; \}/);
  assert.match(body, /<button class="btn uprime" type="button" id="you-name-save" aria-label="Save your name" disabled>Save<\/button>/);
});

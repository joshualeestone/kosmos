"use strict";
/**
 * Josh, #chaoskosmos-design, 2026-08-25 15:52, five screenshots and the real
 * reference mockup at installkosmos.com/consolidated-mock:
 *
 * - Right column order: tasks, project members, files -- not the members,
 *   tasks, files order #867 shipped.
 * - "What I really want to pay attention to is the way that the
 *   consolidated mock... is displaying these differently, with background
 *   colors and rule lines that separate the sections instead of them being
 *   floating boxes."
 * - Each project row in the projects rail should carry its agent count.
 * - Strip the "drop a file... type @" composer hint in this view -- power
 *   users already know what + and @ do.
 *
 * ⚠️ ON THE SECOND POINT: the actual mock, screenshotted and read from its
 * own source rather than trusted from Josh's dictated description, does NOT
 * use rule lines instead of boxes. It draws Tasks/Members/Files as white,
 * bordered, rounded cards (.rcard) on a tinted column background (.rcol) --
 * the SAME relationship .pjcard already has to the page everywhere else in
 * this app. The #867 comment claiming the flat/borderless treatment already
 * matched "the mock" was a citation nobody had actually checked. The fix
 * here is to STOP overriding .pjcard in consolidated (it already looks
 * right without any override) and tint the ground behind it instead.
 *
 *   node --test web.consolidated-match-mock.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const { effective } = require('./test-support/cascade');
const ROW_FACES = 'html[data-layout="consolidated"] body.consolidated .pj-row .pjfaces';
const ROW_COUNT = 'html[data-layout="consolidated"] body.consolidated .pj-row .pjcount';

/* #1430: the assertions below no longer end at their rule's closing brace, so an
   appended declaration is not a red that looks like a product bug. That is how
   main went down at step 3 under #1310.

   Kept pinned here on purpose: three single complete declarations, plus the
   `doesNotMatch` below -- loosening a NEGATIVE makes it match more, so it would
   start failing on rules that merely resemble the forbidden one.
   🛑 AND THE KEEPS CARRY THE ORIGINAL DEFECT BY CONSTRUCTION, which the block
   above did not say: a kept pin STILL GOES RED on a legitimate append. That is
   #1310 itself, retained deliberately. Measured across the keeps in this change:
   appending `margin: 0;` to a kept rule reds it.
   ⚠️ The justification is a SNAPSHOT OF TODAY'S STYLESHEET -- each kept
   selector's rules currently carry a single declaration, checked, with controls.
   It is not a property of the rule, and round 10 disproved one of these keeps by
   finding the page already extended its selector. **If a kept rule ever gains a
   declaration, loosen it rather than treating the pin as settled.**

   ⚠️ THREE THINGS IT DOES NOT COVER, and all three are real. An open tail cannot
   see a SAME-RULE OVERRIDE. It tolerates an APPEND but NOT a declaration INSERTED
   between the promised ones -- #1310 happened to append; had it grouped the
   property differently this would not have prevented it. And a SAME-SELECTOR,
   LATER-RULE override is invisible to any text pin, loosened or not: if the sheet
   declares the selector twice the later rule wins, and an assertion on the earlier
   one is GREEN when the behaviour breaks and RED on a no-op. Three instances were
   found in this tree and all three are now FIXED with cascade-resolving checks --
   two by #1476 itself, and a third here that #1476's guard could not see because
   both declarations carried the same VALUE.

   ⚠️ AND LOOSENING HAS A COST FOR THAT GUARD, DISCLOSED RATHER THAN LEFT TO BE
   FOUND: web.cascade-shadowed-pins-1476.test.js matches on a rule WITH its closing
   brace, so dropping the brace takes these files out of its reach. Measured: on
   main it sees 3 such assertions in the files this branch touches, on this branch
   it sees 0. Nothing fails today. The guard wants a brace-optional matcher, and
   that is #1469's territory rather than something to patch quietly here.

   🔑 So the four-arm proof behind this change establishes that each assertion
   tracks the rule TEXT. It does NOT establish that the rule GOVERNS.

   🛑 NOT MECHANICALLY ENFORCED (#1469). A guard was built and removed rather than
   shipped: it was blind to the very spelling that caused #1310, and a green
   nobody can trust stops the next person looking.

   Full argument, counts and the four-arm proof: .claude/plans/css-brace-anchor-1430.md */

test('the right column is ordered tasks, then files, then project members', () => {
  // Re-ordered a THIRD time (Josh, 2026-08-26 08:31, #980): "put files in
  // this project above project members". The split's first child is
  // Members (row 3, last now), its last child is Files (row 2).
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > aside\.pjcol:not\(\.pjsplit\) \{ grid-column: 2; grid-row: 1;/,
    'Tasks is not pinned to row 1 -- it should lead the right column');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjsplit > \.pjcard-files \{ grid-column: 2; grid-row: 2;/,
    'Files is not on row 2 -- it should follow Tasks, above Members');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjsplit > \.pjcard-members \{ grid-column: 2; grid-row: 3;/,
    'Project members is not on row 3, last');
});

test('the project cards keep their real border and background instead of a consolidated-only flat override', () => {
  /* 🛑 STAYS ANCHORED ON THE CLOSING BRACE, deliberately (#1430). The sweep
     that loosened the match assertions in this file stopped here, because a
     NEGATIVE assertion inverts the argument: loosening a doesNotMatch makes it
     match MORE, so it would start failing on any rule that merely begins like
     the forbidden one. What is forbidden here is precisely the three-property
     flat override, not a family of rules resembling it. Exact is correct. */
  assert.doesNotMatch(PAGE, /\.pj3 > \.pjcol \.pjcard, html\[data-layout="consolidated"\] body\.consolidated \.pj3 > aside\.pjcol \{ border: 0; background: none; padding: 0; \}/,
    'the wrong "flat like the mock" override is back -- the real mock draws bordered white cards, not flat ones');
  // The base .pjcard/.pjcol rule (shared with the tab view, unedited by
  // this fix) is what should be doing the work now.
  assert.match(PAGE, /\.pjcol \{ border: 1px solid var\(--k-rule\); border-radius: 12px; background: var\(--k-surface\);/,
    'the base bordered-card rule (which the real mock matches) is gone');
});

test('the right cards sit on the side tone; the discussion is a full-bleed column, not a floating panel', () => {
  // #980 (Josh, 2026-08-26 08:31) superseded the boxes-on-a-ground look:
  // "the discussion area should not be inside of a bounding box on top of
  // a background. It should be full width and full height." The .pj3
  // ground carries the mock's side tone (what shows behind the right
  // cards, the part he called correct), the discussion column paints back
  // to the page ground over its whole column, and the dialogue|cards rule
  // is the discussion's own right edge. No radii: columns, not boxes.
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 \{ background: var\(--k-side, #f3f1ec\); border-radius: 0; padding: 0;/,
    'the right column lost its side-tone ground (or the boxes-on-a-ground look is back)');
  /* 🛑 `border: 0` IS THE LOAD-BEARING PART, and this pin shipped without it
     for a while. `.pjmid` is a `.pjcol`, and `.pjcol` sets a 1px border on all
     four sides. Without the reset, top/left/bottom survived and the "full
     bleed column" kept three sides of a box -- while this very assertion
     passed, because rule TEXT cannot see an inherited border.
     ⚠️ That is the limit of every text pin in this suite. Keep `border: 0`
     first in the expectation so a future edit that drops it goes red here
     rather than only on somebody's screen.
     🛑 AND SINCE #1430 DROPPED THE CLOSING BRACE, THAT SENTENCE IS ONLY HALF
     TRUE, SO READ IT PRECISELY: a future edit that DROPS `border: 0` still
     goes red. One that RE-ADDS a border LATER IN THE SAME RULE does not,
     because the assertion no longer sees where the rule ends and the cascade
     lets the later declaration win. Measured: appending
     `border: 1px solid var(--k-rule);` to this rule leaves this test GREEN,
     where the old brace-anchored form went RED.
     ⇒ That is the accepted cost of #1430, not an oversight: the old form paid
     for it by going red on every legitimate addition, which took main down.
     It is written here because an ABSENCE promise is exactly the kind this
     trade weakens, and this rule's own message promises a borderless column.
     ⚠️ It is NOT unique to this site: every assertion this change loosened
     accepts the same trade, and several carry an absence promise. The counts
     live in #1430's plan, once. The general statement is in this
     file's #1430 header; this note is the local instance, not the only record. */
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjmid \{ background: var\(--k-bg\); border: 0; border-radius: 0; border-right: 1px solid var\(--k-rule\);/,
    'the discussion is boxed again (or lost the rule that separates it from the right column)');
});

test('each project row in the rail shows its agent count as a subtitle, without the face icons the narrow rail has no room for', () => {
  /* ⚠️ THIS BYTE WINDOW IS NOW LOAD-BEARING, and #1430 made it more so. Loosening
     the `.pjcount` pin below took its PAGE-WIDE match count from 2 to 3, because
     it now also matches `{ margin-left: 0; white-space: nowrap; }` elsewhere. It
     is still exactly 1 INSIDE this window, so the assertion is aimed correctly --
     but the window is what aims it, and it is a hard-coded byte count.
     📌 To re-measure rather than trust a number that drifts with every edit: find
     the last asserted match inside the slice and subtract its end from 400. At the
     time of writing that is 154 characters of headroom. Insert more than that
     above `.pj-row .pjcount` and this reds for a reason that is not a defect,
     which is the class #1430 exists to remove, in a different mechanism. */
  const block = PAGE.slice(PAGE.indexOf('.pj-row .pjfaces { display: block'), PAGE.indexOf('.pj-row .pjfaces { display: block') + 400);
  /* 🛑 `margin-top: 2px` USED TO BE PINNED HERE AND IT IS DEAD (#1476). A later
     rule for the same selector sets `margin-top: 0`, so changing the EFFECTIVE
     margin to 99px left this assertion green. `display: block` is the half that
     carries the behaviour this test names, and it survives because the later
     rule does not set `display`. Asserting the effective value states which is
     which instead of pinning both and guarding neither. */
  assert.equal(effective(PAGE, ROW_FACES, 'display'), 'block',
    'the agent-count subtitle is not shown in the projects rail');
  assert.match(block, /\.pj-row \.pjfaces > \[aria-hidden\] \{ display: none; \}/, 'the face icons are showing in the narrow rail, where there is no room for them');
  /* 🛑 THIS ASSERTS THE RULE THAT GOVERNS (#1476), and getting here took two goes.
     Round 10 of #1430 found this pinned as "a single complete declaration with
     nothing to append", noticed the page ALSO carries
     `{ margin-left: 0; white-space: nowrap; }` for the same selector, and loosened
     the pin on that evidence.
     ⚠️ IT CITED THE SHADOWING RULE AS PROOF OF AN APPEND AND DID NOT NOTICE IT
     ALSO SHADOWS. The selector is declared three times in this scope (2850, 2862,
     2893) and the last re-declares `margin-left`, so the pinned one never governed.
     Measured, both arms:
       delete the PINNED rule    -> no behaviour change -> assertion went RED
       break the WINNING rule    -> margin actually 8px -> assertion stayed GREEN
     Inverted, exactly as #1476 describes, and #1476's own guard cannot see it
     because both declarations carry the same VALUE. Asserting the effective value
     instead. */
  assert.equal(effective(PAGE, ROW_COUNT, 'margin-left'), '0',
    'the count text lost the margin reset that made sense once the face icons in front of it were hidden');
  // Not reversed accidentally: .pc-t (the description) and .pj-who stay hidden.
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj-row \.pc-t, html\[data-layout="consolidated"\] body\.consolidated \.pj-row \.pj-who \{ display: none; \}/,
    'the project description and status-line got un-hidden along with the agent count -- only the count was asked for');
});

test('the drop-a-file / @-mention composer hint is stripped in the consolidated view only', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated #pj-composerhint \{ display: none; \}/,
    'the composer hint is not hidden in consolidated view');
  // The tab view keeps it -- the base element and its text are untouched.
  assert.match(PAGE, /<p class="composerhint" id="pj-composerhint">Drop a file anywhere in the conversation to add it\. Type @ and a name to ask one agent directly\.<\/p>/,
    'the composer hint element itself was removed, not just hidden for consolidated -- the tab view needs it too');
});

"use strict";
/**
 * #747 and #748: the project tile reads title, description, agents, status
 * top right, with no folder chip; the list row is the same markup across four
 * columns.
 *
 *   node --test web.project-rows.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

/* #1430: the assertions below no longer end at their rule's closing brace, so an
   appended declaration is not a red that looks like a product bug. That is how
   main went down at step 3 under #1310.

   Kept pinned here on purpose: two `display: contents` and one `display: none`,
   single complete declarations with nothing a feature would append.
   The absence-shaped promise here is `\.pjfaces { ... min-width: 0;
   overflow: hidden; }`. The other live case in this file is the base `\.pc-t`
   rule, asserted for `overflow-wrap: anywhere`: appending `overflow-wrap: normal;`
   to it leaves the loosened form GREEN where the old pinned form went RED, so the
   wrap behaviour can be reversed unseen.
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

test('the painter emits the head (name with its bubble, status), then the description, then the agents; no folder chip anywhere', () => {
  const at = SCRIPT.indexOf('function projectCard(');
  const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  const head = fn.indexOf("'<span class=\"pjcard-h\"><span class=\"pjname\"><b>'");
  const pill = fn.indexOf("'<span class=\"pjpill ' + pill.cls + '\">'");
  const desc = fn.indexOf("'<span class=\"pc-t\">'");
  const faces = fn.indexOf('+ facesRow');
  assert.ok(head > -1 && pill > head && desc > pill && faces > desc, 'the order is not title, status, description, agents');
  assert.doesNotMatch(PAGE, /pjslug/, 'the folder chip survives somewhere');
  assert.match(fn, /unreadBadge\(p\.id === PJ_CURRENT \? 0 : p\.unread\) \+ '<\/span>'/, 'the bubble sits inside the name group');
});

test('the list view lays the row across four columns with the status at the far right, and keeps a row without a description in shape', () => {
  // #860 (Josh, 2026-08-25 10:35): "spread them out... in equal portions" --
  // title and description now share the row roughly evenly instead of
  // title-narrow/description-wide, and the agents column widened so five
  // faces plus the count text (projectCard's own worst case) fit without
  // spilling into the status column.
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \{ display: grid;[^}]*grid-template-columns: minmax\(9rem, 1fr\) minmax\(9rem, 1fr\) minmax\(9rem, 12rem\) auto;/);
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjcard-h \{ display: contents; \}/);
  for (const [sel, col] of [['.pjname', 1], ['.pc-t', 2], ['.pjfaces', 3], ['.pjpill', 4]]) {
    assert.match(PAGE, new RegExp('\\.pj-list:not\\(\\.asgrid\\) \\.pj-row \\' + sel + ' \\{ grid-column: ' + col + '; grid-row: 1;'), sel + ' is not pinned to column ' + col);
  }
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjpill \{ grid-column: 4; grid-row: 1; justify-self: end;/,
    'the status pill left column 4 or stopped being pushed to the far right');
  // Narrow screens stack the row rather than crushing four columns.
  assert.match(PAGE, /@media \(max-width: 52rem\) \{\n  \.pj-list:not\(\.asgrid\) \.pj-row \{ grid-template-columns: minmax\(0, 1fr\) auto;/,
    'the narrow-screen row no longer collapses to two columns, so four get crushed instead of stacking');
});

// #860: "Project title (which could probably be truncated at some particular
// length too)... Project description (which could probably be truncated at
// some particular length too)". Truncate rather than wrap, list view only --
// the grid tile keeps its own wrap/clamp behaviour and its own pinned checks
// (the 200-char drive fixture named at .pc-t's base rule).
test('the list row truncates a long title or description instead of wrapping it, and the agents column cannot bleed into the status pill', () => {
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjname b \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/,
    'the title is not truncated in the list row');
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pc-t \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/,
    'the description is not truncated in the list row');
  // The grid tile's own description rule keeps overflow-wrap: anywhere
  // (the pasted-URL fixture), untouched by the list-row override above.
  assert.match(PAGE, /^\.pc-t \{ display: block;[^}]*overflow-wrap: anywhere;/m,
    'the grid tile description lost its own wrap rule');
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjfaces \{[^}]*min-width: 0; overflow: hidden;/,
    'the agents column has no shrink/clip guard -- a grid item’s default min-width:auto is exactly what let it bleed into the status pill');
});

// #861 (Josh, 2026-08-25 10:37): "these need to be more like the agents
// grid... Title centered, status underneath, the same kind of status
// bubble... the icons of the agents... underneath that, the number of
// agents." Description deliberately absent -- not in Josh's four-item
// list, and no equivalent on .acard either.
test('the grid tile stacks and centers title, then a status bubble, then the agent icons with the count beneath, and drops the description', () => {
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pjcard-h \{ display: contents; \}/,
    'the grid tile no longer dissolves pjcard-h, so title and status cannot be ordered independently');
  /* 🛑 NOT ANCHORED ON THE CLOSING BRACE, and that is deliberate (#1413).
     This assertion pinned the rule as ENDING after justify-content, so #1310
     legitimately adding `max-width: 100%` to enable the title truncation broke
     a test that was not testing truncation. The product was right and the
     assertion was stale.
     ⭐ Every sibling in this file already tolerates extra properties with
     `[^}]*` -- this line was the outlier. What is promised here is the ORDER
     and the CENTRING; nothing consumes the exact property list, so the rule is
     free to gain declarations without a test failing for a reason that looks
     like a defect and is not. */
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pjname \{ order: 1; justify-content: center;/,
    'the grid tile does not put the name first and centred');
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pjpill \{ order: 2;[^}]*border-radius: 100px;/,
    'the status pill lost its bubble shape (border-radius: 100px)');
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pc-t \{ display: none; \}/,
    'the grid tile is showing the description again; #861 asked for this stack, not this field');
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pjfaces \{ order: 3; flex-direction: column;/,
    'the agent icons and their count are not stacked (icon row, then caption)');
  // The grid tile's own description rule (the pack's wrap-not-truncate
  // behaviour, and its pinned fixture) is untouched by hiding it here.
  assert.match(PAGE, /^\.pc-t \{ display: block;[^}]*overflow-wrap: anywhere;/m,
    'the base .pc-t rule (used by the list view and the detail page) was disturbed');
});

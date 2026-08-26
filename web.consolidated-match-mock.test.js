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

test('the right column is ordered tasks, then files, then project members', () => {
  // Re-ordered a THIRD time (Josh, 2026-08-26 08:31, #980): "put files in
  // this project above project members". The split's first child is
  // Members (row 3, last now), its last child is Files (row 2).
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > aside\.pjcol:not\(\.pjsplit\) \{ grid-column: 2; grid-row: 1; \}/,
    'Tasks is not pinned to row 1 -- it should lead the right column');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjsplit > \.pjcard:last-child \{ grid-column: 2; grid-row: 2; \}/,
    'Files is not on row 2 -- it should follow Tasks, above Members');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjsplit > \.pjcard:first-child \{ grid-column: 2; grid-row: 3; \}/,
    'Project members is not on row 3, last');
});

test('the project cards keep their real border and background instead of a consolidated-only flat override', () => {
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
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 \{ background: var\(--k-side, #f3f1ec\); border-radius: 0; padding: 0; \}/,
    'the right column lost its side-tone ground (or the boxes-on-a-ground look is back)');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjmid \{ background: var\(--k-bg\); border-radius: 0; border-right: 1px solid var\(--k-rule\); \}/,
    'the discussion is boxed again (or lost the rule that separates it from the right column)');
});

test('each project row in the rail shows its agent count as a subtitle, without the face icons the narrow rail has no room for', () => {
  const block = PAGE.slice(PAGE.indexOf('.pj-row .pjfaces { display: block'), PAGE.indexOf('.pj-row .pjfaces { display: block') + 400);
  assert.match(block, /\.pj-row \.pjfaces \{ display: block; margin-top: 2px; \}/, 'the agent-count subtitle is not shown in the projects rail');
  assert.match(block, /\.pj-row \.pjfaces > \[aria-hidden\] \{ display: none; \}/, 'the face icons are showing in the narrow rail, where there is no room for them');
  assert.match(block, /\.pj-row \.pjcount \{ margin-left: 0; \}/, 'the count text lost the margin reset that made sense once the face icons in front of it were hidden');
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

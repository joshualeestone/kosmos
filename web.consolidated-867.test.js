"use strict";
/**
 * #867 (Josh, 2026-08-25 11:02), his last note of that testing round on the
 * consolidated view: a project opens automatically on arrival rather than
 * showing an empty centre, the agents rail title sits flush with the
 * projects rail title, the person's own row stays on screen instead of
 * scrolling away under a tall right column, the agents rail's scrollbar is
 * hidden, tasks are sorted above files, and the conversation box fills the
 * available height instead of leaving a gap above the composer.
 *
 *   node --test web.consolidated-867.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

test('a project auto-opens on the first consolidated load, once, and only when nothing else already claimed it', () => {
  assert.match(SCRIPT, /let PJ_AUTO_OPENED_ONCE = false;/, 'the one-shot flag is gone');
  const at = SCRIPT.indexOf('if (!PJ_AUTO_OPENED_ONCE');
  assert.ok(at > -1, 'the auto-open block is gone');
  const block = SCRIPT.slice(at, at + 500);
  assert.match(block, /!WANT_PROJECT/, 'a deep link is not given priority over the auto-open');
  assert.match(block, /!PJ_CURRENT/, 'auto-open could fire while a project is already showing');
  assert.match(block, /getAttribute\('data-layout'\) === 'consolidated'/, 'auto-open is not scoped to the consolidated layout');
  assert.match(block, /PJ_AUTO_OPENED_ONCE = true;/, 'the flag is never set, so this would fire on every load');
  assert.match(block, /sortProjects\(PROJECTS\.filter\(\(p\) => !p\.archived\), PJ_SORT\)/, 'the pick does not respect the person\'s own sort order, or considers archived projects');
  assert.match(block, /openProject\(first\.id\)/, 'nothing actually opens the picked project');
  // Comes after the deep-link block, so a real ?project= link still wins.
  const wantAt = SCRIPT.indexOf('if (WANT_PROJECT && !PJ_CURRENT && !WANT_PROJECT_DONE)');
  assert.ok(wantAt > -1 && wantAt < at, 'the deep-link check moved after the auto-open, so a deep link could lose the race');
});

test('the agents and projects rail titles sit at the same height', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated #pj-list-view \{ grid-column: 1; padding-top: 0; \}/,
    'the projects rail lost the padding-top override that keeps it flush with the agents rail');
});

test('the person\'s own row stays on screen under a tall right column', () => {
  // #980 rebased this from a sticky float to a STRUCTURAL pin: rail-me is
  // the body grid's last track (grid-row 41, rows auto/1fr/auto) under a
  // 100vh overflow-hidden grid, so it sits at the viewport foot by
  // construction. No sticky is pinned here on purpose -- a grid item
  // whose containing block is its own exactly-fitting row has zero
  // sticky travel, so a sticky would be dead code wearing a load-bearing
  // look (the same fact that made the card-head stickies inert).
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated > #rail-me \{ grid-column: 1; grid-row: 41;/,
    'rail-me left its last-track row, the structure that pins it at the column foot');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \{[^}]*height: 100vh; overflow: hidden;/s,
    'the body lost its viewport-height no-page-scroll grid, the structure that pins the person\'s row');
  assert.doesNotMatch(PAGE, /> #rail-me \{[^}]*position: sticky/s,
    'a dead sticky is back on rail-me, claiming a job the grid structure does');
});

test('the agents rail scrolls without showing a scrollbar', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated > #alist \{[^}]*scrollbar-width: none; -ms-overflow-style: none;/s,
    'the agents rail lost its hidden-scrollbar treatment');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated > #alist::-webkit-scrollbar \{ display: none; \}/,
    'the webkit half of the hidden-scrollbar treatment is gone');
});

test('the right column is dissolved into independent grid rows, so its cards can be reordered without a DOM move', () => {
  // .pjsplit is dissolved so members and files can be placed on either
  // side of the tasks aside, which sits on its own separate grid row.
  // The exact row ORDER (tasks, then members, then files, per Josh's
  // 2026-08-25 15:52 correction against the real mock) is pinned in
  // web.consolidated-match-mock.test.js, not duplicated here.
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjsplit \{ display: contents; \}/,
    '.pjsplit no longer dissolves, so members and files cannot be placed independently');
  // The conversation column spans all three rows, not the old two.
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjmid \{[^}]*grid-row: 1 \/ span 3;/s,
    'the conversation column does not span the new third row');
});

test('the conversation box fills the available height instead of leaving a gap above the composer', () => {
  // #980: the height comes from the grid chain (body 100vh -> panel
  // stretch -> .pj3 100%), not the old tuned viewport calc -- and the
  // thread is the COLUMN now, not a bordered card floating inside it.
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pj3 > \.pjmid \{[^}]*height: 100%; min-height: 0;/s,
    'the conversation column lost its full-height grid chain');
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.pjmid \.thread \{ min-height: 0; max-height: none; flex: 1 1 auto; border: 0; border-radius: 0; background: none; \}/,
    'the conversation no longer fills its column as a flat, borderless region (re-boxed, capped, or not flex-grow)');
});

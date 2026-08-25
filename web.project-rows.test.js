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
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjpill \{ grid-column: 4; grid-row: 1; justify-self: end; \}/);
  // Narrow screens stack the row rather than crushing four columns.
  assert.match(PAGE, /@media \(max-width: 52rem\) \{\n  \.pj-list:not\(\.asgrid\) \.pj-row \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
});

// #860: "Project title (which could probably be truncated at some particular
// length too)... Project description (which could probably be truncated at
// some particular length too)". Truncate rather than wrap, list view only --
// the grid tile keeps its own wrap/clamp behaviour and its own pinned checks
// (the 200-char drive fixture named at .pc-t's base rule).
test('the list row truncates a long title or description instead of wrapping it, and the agents column cannot bleed into the status pill', () => {
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjname b \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/,
    'the title is not truncated in the list row');
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pc-t \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/,
    'the description is not truncated in the list row');
  // The grid tile's own description rule keeps overflow-wrap: anywhere
  // (the pasted-URL fixture), untouched by the list-row override above.
  assert.match(PAGE, /^\.pc-t \{ display: block;[^}]*overflow-wrap: anywhere; \}/m,
    'the grid tile description lost its own wrap rule');
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjfaces \{[^}]*min-width: 0; overflow: hidden; \}/,
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
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pjname \{ order: 1; justify-content: center; \}/);
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pjpill \{ order: 2;[^}]*border-radius: 100px;/,
    'the status pill lost its bubble shape (border-radius: 100px)');
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pc-t \{ display: none; \}/,
    'the grid tile is showing the description again; #861 asked for this stack, not this field');
  assert.match(PAGE, /\.pj-list\.asgrid \.pj-row \.pjfaces \{ order: 3; flex-direction: column;/,
    'the agent icons and their count are not stacked (icon row, then caption)');
  // The grid tile's own description rule (the pack's wrap-not-truncate
  // behaviour, and its pinned fixture) is untouched by hiding it here.
  assert.match(PAGE, /^\.pc-t \{ display: block;[^}]*overflow-wrap: anywhere; \}/m,
    'the base .pc-t rule (used by the list view and the detail page) was disturbed');
});

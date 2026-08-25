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
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \{ display: grid;[^}]*grid-template-columns: minmax\(10rem, 1\.1fr\) minmax\(9rem, 1\.4fr\) minmax\(7rem, 9rem\) auto;/);
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjcard-h \{ display: contents; \}/);
  for (const [sel, col] of [['.pjname', 1], ['.pc-t', 2], ['.pjfaces', 3], ['.pjpill', 4]]) {
    assert.match(PAGE, new RegExp('\\.pj-list:not\\(\\.asgrid\\) \\.pj-row \\' + sel + ' \\{ grid-column: ' + col + '; grid-row: 1;'), sel + ' is not pinned to column ' + col);
  }
  assert.match(PAGE, /\.pj-list:not\(\.asgrid\) \.pj-row \.pjpill \{ grid-column: 4; grid-row: 1; justify-self: end; \}/);
  // Narrow screens stack the row rather than crushing four columns.
  assert.match(PAGE, /@media \(max-width: 52rem\) \{\n  \.pj-list:not\(\.asgrid\) \.pj-row \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
});

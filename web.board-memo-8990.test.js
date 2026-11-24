'use strict';

/**
 * kosmos#8990: the board's card grid (#grid) and agents list (#alist) are written only when their markup changed
 * (setGridHtml / GRID_HTML, ALIST_HTML). Each memo is the string its writer last wrote, so ANY other write into either
 * container makes the memo describe markup that is no longer on screen, and the next poll with the old markup skips
 * and leaves the other write up. The failed-poll card did exactly that (render-phone-offline-718 caught it).
 *
 * So the writers are pinned here: a new innerHTML or insertAdjacentHTML write into either container fails this test
 * until it is added below, and adding it is the moment to decide whether it must clear the memo.
 * The rendered behaviour is docs/browser-checks/render-avatar-steady-8990.js; this reads source only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

const count = (re) => (PAGE.match(re) || []).length;

test('the grid is written in exactly two places: setGridHtml and the failed-poll card', () => {
  assert.equal(count(/getElementById\('grid'\)\.innerHTML\s*=/g), 0, 'a direct write to #grid by id bypasses GRID_HTML');
  assert.equal(count(/\bgrid\.innerHTML\s*=\s*html;/g), 1, 'setGridHtml no longer writes the grid');
  assert.match(PAGE, /function setGridHtml\(html\) \{\s*const grid = document\.getElementById\('grid'\);\s*if \(!grid \|\| html === GRID_HTML\) return;\s*GRID_HTML = html;\s*grid\.innerHTML = html;\s*\}/,
    'setGridHtml no longer skips markup it already wrote');
});

test('the list is written by paintAgentListNow (two memo-guarded writes and the empty board) and the failed-poll card', () => {
  assert.equal(count(/\balist\.innerHTML\s*=/g), 3, 'a write to #alist was added or removed; decide whether it must clear ALIST_HTML');
  assert.equal(count(/if \(html !== ALIST_HTML\) \{ ALIST_HTML = html; alist\.innerHTML = html; \}/g), 2, 'a list write is no longer memo-guarded');
  assert.match(PAGE, /ALIST_HTML = null;\s*alist\.innerHTML = boardEmpty\(\);/, 'the empty-board branch writes the list without clearing its memo');
  assert.equal(count(/\balist\.insertAdjacentHTML\(/g), 2, 'an insertAdjacentHTML into #alist was added or removed');
});

test('the failed-poll card, which writes both containers by id, clears both memos', () => {
  const at = PAGE.indexOf("for (const id of ['grid', 'alist']) {");
  assert.ok(at > -1, 'the failed-poll loop over grid and alist moved; re-check that it clears both memos');
  const after = PAGE.slice(at, at + 2500);
  assert.match(after, /box\.innerHTML = boardErr;/, 'the failed-poll loop no longer writes the containers');
  assert.match(after, /GRID_HTML = null;\s*ALIST_HTML = null;/, 'the failed-poll loop writes behind the memos without clearing them');
});

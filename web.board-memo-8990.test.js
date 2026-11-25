'use strict';

/**
 * kosmos#8990: the board's card grid (#grid) and agents list (#alist) are written only when their markup changed
 * (setGridHtml / GRID_HTML, ALIST_HTML). Each memo is the string its writer last wrote, so ANY other write into either
 * container makes the memo describe markup that is no longer on screen, and the next poll with the old markup skips
 * and leaves the other write up. The failed-poll card did exactly that (render-phone-offline-718 caught it).
 *
 * So the writers are pinned here, by the spellings this page uses: `grid.innerHTML`, `alist.innerHTML` and
 * `alist.insertAdjacentHTML`, the same writes by getElementById, and the failed-poll loop over ['grid', 'alist']. A
 * write spelled another way (another variable name, append, textContent) is NOT caught; the pins are a tripwire
 * for the usual shapes, not a proof that nothing else writes.
 * The rendered behaviour is docs/browser-checks/render-avatar-steady-8990.js; this reads source only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

const count = (re) => (PAGE.match(re) || []).length;

test('the grid is written through grid.innerHTML only by setGridHtml (the failed-poll card is pinned below)', () => {
  assert.equal(count(/getElementById\('grid'\)\.innerHTML\s*=/g), 0, 'a direct write to #grid by id bypasses GRID_HTML');
  assert.equal(count(/\bgrid\.innerHTML\s*=/g), 0, 'a write to grid.innerHTML was added (setGridHtml writes through patchBoardHtml, kosmos#9094)');
  assert.match(PAGE, /function setGridHtml\(html\) \{\s*const grid = document\.getElementById\('grid'\);\s*if \(!grid \|\| html === GRID_HTML\) return;\s*GRID_PARTS = patchBoardHtml\(grid, html, GRID_HTML, GRID_PARTS\);[^\n]*\n\s*GRID_HTML = html;\s*\}/,
    'setGridHtml no longer skips markup it already wrote, or no longer patches through patchBoardHtml');
});

test('neither container is written by getElementById', () => {
  assert.equal(count(/getElementById\('alist'\)\.(innerHTML\s*=|insertAdjacentHTML\(|replaceChildren\()/g), 0, 'a direct write to #alist by id bypasses ALIST_HTML');
  assert.equal(count(/getElementById\('grid'\)\.(insertAdjacentHTML\(|replaceChildren\()/g), 0, 'a direct write to #grid by id bypasses GRID_HTML');
});

test('a failed avatar is retried by itself, with a backoff that levels off at a minute', () => {
  assert.match(PAGE, /const AVATAR_RETRY_FIRST_MS = 5000;\s*const AVATAR_RETRY_MAX_MS = 60000;/, 'the retry delays changed; re-check the browser check\'s timing window');
  assert.match(PAGE, /const wait = Math\.min\(AVATAR_RETRY_FIRST_MS \* 2 \*\* n, AVATAR_RETRY_MAX_MS\);/, 'the retry no longer backs off to a ceiling');
  assert.match(PAGE, /if \(t\.__avatarRetryFor === url\) return;\s*t\.__avatarRetryFor = url;/, 'a second error for a URL already waiting to be retried is counted twice');
  const at = PAGE.indexOf('const AVATAR_RETRY_FIRST_MS');
  const body = PAGE.slice(at, at + 1500);
  assert.doesNotMatch(body, /GRID_HTML|ALIST_HTML|MY_AGENTS_HTML/, 'the retry touches a container memo, so one broken picture rebuilds the whole container every time');
});

test('the list is written by paintAgentListNow (two memo-guarded writes and the empty board) and the failed-poll card', () => {
  assert.equal(count(/\balist\.innerHTML\s*=/g), 1, 'a write to #alist was added or removed; decide whether it must clear ALIST_HTML');
  assert.equal(count(/if \(html !== ALIST_HTML\) \{ ALIST_PARTS = patchBoardHtml\(alist, html, ALIST_HTML, ALIST_PARTS\); ALIST_HTML = html; \}/g), 2,
    'a list write is no longer memo-guarded, or no longer patches through patchBoardHtml (kosmos#9094)');
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

test('kosmos#9094: patchBoardHtml writes whole whenever the last write is unknown, someone else wrote, or a key repeats', () => {
  const at = PAGE.indexOf('function patchBoardHtml(el, html, prevHtml, prevParts) {');
  assert.ok(at > -1, 'patchBoardHtml moved or was renamed');
  const body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
  assert.match(body, /if \(prevHtml === null \|\| !prevParts \|\| live\.length !== prevParts\.length \|\| new Set\(keys\)\.size !== keys\.length\) \{\s*el\.replaceChildren\(\.\.\.next\);/,
    'a memo reset (null), a container someone else wrote, or a repeated agent key no longer forces a whole write');
  assert.match(body, /const old = x\.key \? byKey\.get\(x\.key\) : loose\[li\+\+\];/, 'pieces are no longer matched by agent, so a row that changes place redraws the rows between');
  // The reorder itself is run, not read, in web.board-patch-9094.test.js.
});

test('kosmos#9094: My Agents is written through patchBoardHtml too, behind its memo', () => {
  assert.match(PAGE, /MY_AGENTS_PARTS = patchBoardHtml\(list, html, MY_AGENTS_HTML, MY_AGENTS_PARTS\);[^\n]*\n\s*MY_AGENTS_HTML = html;/,
    'My Agents no longer patches only the rows that changed');
});

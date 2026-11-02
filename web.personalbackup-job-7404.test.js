'use strict';
/**
 * kosmos#7404 (pbpanel-7404): the panel's job lines. The function is read out of the page, so this is the page's own text.
 *
 *   node --test web.personalbackup-job-7404.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const m = page.match(/function pbJobLines\(j\) \{[\s\S]*?\n\}\n/);
assert.ok(m, 'pbJobLines is in the page');
const pbJobLines = Function(m[0] + 'return pbJobLines;')();

test('stopped goes alone in its line; the date and a note sit beside it, plain', () => {
  const r = pbJobLines({ lastOk: '2026-10-31T14:07:00.000Z', stopped: 'Stopped.', note: null });
  assert.equal(r.stopped, 'Stopped.');
  assert.match(r.plain, /^Last backed up .*\.$/);
  assert.doesNotMatch(r.stopped, /Last backed up/);
  assert.equal(pbJobLines({ lastOk: null, stopped: null, note: 'A backup runs soon.' }).plain, 'A backup runs soon.');
});
test('nothing established, nothing said: no job, a bad date, an empty answer', () => {
  for (const j of [null, undefined, {}, { lastOk: 'not a date' }, { stopped: 5, note: 5 }]) assert.deepEqual(pbJobLines(j), { stopped: '', plain: '' });
});
test('the panel paints only an on view', () => {
  assert.match(page, /const lines = pbJobLines\(v === 'on' \? st\.job : null\);/);
});

/* kosmos#7404 (pbleftout-7404): what the last good backup left out. */
const sw = page.match(/function pbSkippedWords\(sk\) \{[\s\S]*?\n\}\n/);
assert.ok(sw, 'pbSkippedWords is in the page');
const pbSkippedWords = Function(sw[0] + 'return pbSkippedWords;')();

test('a list of what was left out: the count, each path with its reason, and how many are not named', () => {
  const w = pbSkippedWords({ count: 3, files: [{ path: 'agents/a/film.mov', why: 'over 64 MB' }, { path: 'notes.zip', why: '' }] });
  assert.equal(w.sum, '3 files were left out of the last backup');
  assert.deepEqual(w.items, ['agents/a/film.mov: over 64 MB', 'notes.zip']);
  assert.equal(w.more, '1 more is not named here.');
  assert.equal(pbSkippedWords({ count: 1, files: [{ path: 'a.pdf', why: 'x' }] }).sum, '1 file was left out of the last backup');
  assert.equal(pbSkippedWords({ count: 1, files: [{ path: 'a.pdf', why: 'x' }] }).more, '');
});
test('nothing left out, or nothing readable, shows nothing', () => {
  for (const sk of [null, undefined, {}, { count: 0, files: [] }, { files: 'x' }, { count: 'x', files: [{ path: '' }] }]) assert.equal(pbSkippedWords(sk), null);
});
test('a count smaller than the list cannot hide named files', () => {
  assert.equal(pbSkippedWords({ count: 1, files: [{ path: 'a' }, { path: 'b' }] }).sum, '2 files were left out of the last backup');
});
test('the list shows only beside a plain on view, never with a stop', () => {
  assert.match(page, /pbSkippedShow\(v === 'on' && !lines\.stopped \? st\.job : null\);/);
});

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
const pw = page.match(/const PB_WHY = \[[\s\S]*?\n\];\nfunction pbWhyWords\(why\) \{[\s\S]*?\n\}\n/);
assert.ok(pw, 'PB_WHY and pbWhyWords are in the page');
const pbWhyWords = Function(pw[0] + 'return pbWhyWords;')();
const pbSkippedWords = Function(pw[0] + sw[0] + 'return pbSkippedWords;')();

test('a list of what was left out: the count, each path with its reason, and how many are not named', () => {
  const w = pbSkippedWords({ count: 3, files: [{ path: 'agents/a/film.mov', why: 'larger than 64 MB, too large to scan' }, { path: 'notes.zip', why: '' }] });
  assert.equal(w.sum, '3 files were left out of the last backup');
  assert.deepEqual(w.items, ['agents/a/film.mov: too large', 'notes.zip: Kosmos could not check it']);
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

test('every reason the scanner and walker give reads as plain words, never as the raw text', () => {
  const cases = {
    'text that already holds the masking placeholder': 'Kosmos could not check it',
    'could not write the redacted text back': 'Kosmos could not check it',
    'its redacted copy is over twice its size': 'Kosmos could not check it',
    'something shaped like a credential is still readable in the bytes': 'may hold a password or key',
    'binary file holding something shaped like a credential, or that could not be checked': 'may hold a password or key',
    'environment file': 'may hold a password or key',
    'git internals (objects and packs carry every committed secret; config carries remote tokens)': 'may hold a password or key',
    'git internals': 'part of a Git history',
    'compressed content (cannot be scanned)': 'compressed, so Kosmos cannot look inside',
    'a temp or backup copy with a name too long to check': 'a temporary copy',
    'larger than 64 MB, too large to scan': 'too large',
    'text larger than 4 MB, too large to scan safely': 'too large',
    'a link (links are not followed)': 'a link or shortcut',
    'stored under more than one name (a hard link; another name may be outside the work Kosmos)': 'a link or shortcut',
    'replaced while the snapshot was taken': 'changed while it was being backed up',
    'it grew while the snapshot was taken': 'changed while it was being backed up',
    'restore would refuse it as colliding with another name': 'its name clashes with another file',
    'path outside the work Kosmos': 'outside your Kosmos folders',
    'UTF-16 text of odd length': 'Kosmos could not check it',
    'could not be checked': 'Kosmos could not check it',
  };
  for (const [why, words] of Object.entries(cases)) assert.equal(pbWhyWords(why), words, why);
  for (const odd of [undefined, null, 5, '']) assert.equal(pbWhyWords(odd), 'Kosmos could not check it');
});

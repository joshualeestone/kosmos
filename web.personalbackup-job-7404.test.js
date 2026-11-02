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
  assert.equal(w.sum, '3 files and folders were left out of the last backup');
  assert.deepEqual(w.items, ['agents/a/film.mov: too large', 'notes.zip: Kosmos could not check it']);
  assert.equal(w.more, '1 more is not named here.');
  assert.equal(pbSkippedWords({ count: 1, files: [{ path: 'a.pdf', why: 'x' }] }).sum, '1 file or folder was left out of the last backup');
  assert.equal(pbSkippedWords({ count: 1, files: [{ path: 'a.pdf', why: 'x' }] }).more, '');
});
test('nothing left out, or nothing readable, shows nothing', () => {
  for (const sk of [null, undefined, {}, { count: 0, files: [] }, { files: 'x' }, { count: 'x', files: [{ path: '' }] }]) assert.equal(pbSkippedWords(sk), null);
});
test('a count smaller than the list cannot hide named files', () => {
  assert.equal(pbSkippedWords({ count: 1, files: [{ path: 'a' }, { path: 'b' }] }).sum, '2 files and folders were left out of the last backup');
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

/* Review 1: every reason the engine can write, read out of its own source, must map to plain words. Only the ones listed
   here may take the fallback, and each is a real "could not check" case. A new scanner reason fails this test. */
const engineWhys = () => {
  const src = ['backupscan.js', 'backupsnapshot.js'].map((f) => fs.readFileSync(path.join(__dirname, 'engine', f), 'utf8')).join('\n');
  const out = new Set();
  for (const m of src.matchAll(/why: '((?:[^'\\]|\\.)+)'/g)) out.add(m[1].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/\[[^\n]*?, '([^']+)'\],?\n/g)) out.add(m[1]);   // DENY and KOSMOS_STORES rows
  for (const m of src.matchAll(/why: `([^`]+)`/g)) out.add(m[1].replace(/\$\{[^}]+\}/g, 'X'));
  return [...out];
};
const MAY_FALL_BACK = new Set(['unusable path', 'a name too long to check', 'text that already holds the masking placeholder',
  'text that could not be fully checked', 'could not write the redacted text back', 'unreadable', 'UTF-16 text of odd length',
  'could not be checked', 'a folder that could not be read', 'an entry that could not be read', 'a file that could not be read',
  'its redacted copy is over twice its size', 'folders nested more than X deep', 'X (a temp copy being written)', 'X the root X',
  'not a regular file']);
test('every engine reason maps to plain words, and only known could-not-check reasons fall back', () => {
  const whys = engineWhys();
  assert.ok(whys.length > 40, 'CONTROL: the engine reasons were read: ' + whys.length);
  const fell = whys.filter((w) => pbWhyWords(w) === 'Kosmos could not check it' && !MAY_FALL_BACK.has(w));
  assert.deepEqual(fell, []);
});
test('a vanished file is not called a shortcut, and a bad name is not called a clash', () => {
  assert.equal(pbWhyWords('a file that could not be opened (gone, or replaced by a link)'), 'changed while it was being backed up');
  assert.equal(pbWhyWords('a trailing dot: restore cannot write it'), 'its name cannot be restored on every computer');
  assert.equal(pbWhyWords('restore would refuse it beside A.txt (names it treats as one)'), 'its name clashes with another file');
  assert.equal(pbWhyWords('Kosmos undo copies (the files are backed up at their own paths)'), 'an undo copy (the file itself is backed up)');
  assert.equal(pbWhyWords('Kosmos tunnel TLS key'), 'may hold a password or key');
});
test('the Turn off confirm says what is kept', () => {
  assert.match(page, /What is already backed up is kept for at least 30 days, then deleted\./);
});

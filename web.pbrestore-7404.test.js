'use strict';
/* kosmos#7404: the restore-from-a-backup screen's words, in Mona Lisa's design review (fleetbuilders m2528). The end of
   a restore says what happened and where the copy is; a stop says the copy's place in words, because a stopped restore's
   answer names no copy; files left out when the backup was made are said as not in it; failed files are counted and,
   at the computer, named. Lifted from the page, so the test cannot drift from what ships. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const { pbfLastWords, pbfBackupWhen } = new Function(
  page.liftAll(SCRIPT, ['asSentence', 'pbfWhen', 'pbfBackupWhen', 'pbfLastWords']) + '\nreturn { pbfLastWords, pbfBackupWhen };')();

const WORLD = { id: 'w-restored', name: 'Restored: Josh, 2 Nov' };

test('a restore that finished says how many files and which copy, and offers to open it', () => {
  const w = pbfLastWords({ ok: true, restored: 1204, failed: 0, world: WORLD, details: { failed: [], leftOutAtBackup: 0 } });
  assert.equal(w.line, 'Restored ' + (1204).toLocaleString() + ' files into Restored: Josh, 2 Nov.');
  assert.deepEqual(w.world, WORLD, 'Open the copy needs the copy');
  assert.equal(w.failedSum, '');
  assert.equal(pbfLastWords({ ok: true, restored: 1, world: WORLD }).line, 'Restored 1 file into Restored: Josh, 2 Nov.');
});

test('failed files are counted, and named only when the answer names them', () => {
  const here = pbfLastWords({ ok: true, restored: 10, failed: 2, world: WORLD, details: { failed: [{ path: 'a/b.txt', why: 'x' }, { path: 'c.txt', why: 'y' }], leftOutAtBackup: 0 } });
  assert.equal(here.failedSum, '2 files could not be restored');
  assert.deepEqual(here.failedPaths, ['a/b.txt', 'c.txt']);
  // A remote session gets counts, not names (personalrestorejob.status namesHidden).
  const remote = pbfLastWords({ ok: true, restored: 10, failed: 2, world: WORLD, details: { failedCount: 2, leftOutAtBackup: 0 } });
  assert.equal(remote.failedSum, '2 files could not be restored');
  assert.deepEqual(remote.failedPaths, []);
});

test('files left out when the backup was made are said as never in it', () => {
  const w = pbfLastWords({ ok: true, restored: 5, world: WORLD, details: { failed: [], leftOutAtBackup: 12 } });
  assert.match(w.line, /12 files were not in this backup \(they were left out when it was made\)\.$/);
  assert.match(pbfLastWords({ ok: true, restored: 5, world: WORLD, details: { leftOutAtBackup: 1 } }).line, /1 file was not in this backup \(it was left out when it was made\)\.$/);
});

test('a stop says where the copy is in words, and offers no button it cannot back', () => {
  const w = pbfLastWords({ ok: false, code: 'stopped', stoppedByPerson: true, because: 'You stopped this restore. The files it had already restored stay in its new Kosmos.' });
  assert.equal(w.line, 'You stopped the restore. What it restored so far is in its copy, in the Kosmos menu at the top.');
  assert.equal(w.world, null);
  assert.doesNotMatch(w.line, /new Kosmos/, 'the engine\'s words, which Mona Lisa replaced with "copy"');
  // Turned off while it ran: the engine's own sentence, which is about the switch.
  const off = pbfLastWords({ ok: false, code: 'stopped', stoppedByPerson: true, because: 'Personal backup was turned off, so this restore was stopped.' });
  assert.equal(off.line, 'Personal backup was turned off, so this restore was stopped.');
});

test('a restore that failed says the engine\'s reason, and names its copy when there is one', () => {
  const w = pbfLastWords({ ok: false, because: 'the restore stopped on this computer before it finished', world: WORLD });
  assert.equal(w.line, 'The restore stopped on this computer before it finished. Its copy is Restored: Josh, 2 Nov.');
  assert.deepEqual(w.world, WORLD);
  assert.equal(pbfLastWords({ ok: false, because: 'the restore could not start on this computer' }).world, null, 'no copy, no button');
  assert.equal(pbfLastWords(null), null, 'nothing restored yet: no line');
});

test('a backup is named by its time in the person\'s own clock format, from Unix seconds', () => {
  const sec = Date.UTC(2026, 10, 2, 16, 15) / 1000;
  assert.equal(pbfBackupWhen({ takenAt: sec }), new Date(sec * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
  assert.equal(pbfBackupWhen({ takenAt: null }), 'A backup with no date');
});

test('the screen says the words Mona Lisa approved', () => {
  assert.match(PAGE, /It goes into a separate copy, so nothing here changes\./);
  assert.match(SCRIPT, /This can take a while, and you can keep using Kosmos\./);
  assert.match(PAGE, /Stop now\? What is restored so far stays in the copy\./);
  assert.match(PAGE, />See your backups</);
  assert.match(PAGE, />Open the copy</);
  assert.doesNotMatch(SCRIPT, /'Backed up ' \+ pbfBackupWhen/, 'review item 1: the heading already says it');
});

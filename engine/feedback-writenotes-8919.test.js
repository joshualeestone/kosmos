'use strict';
/* kosmos#8919: a later `kosmos feedback write` replaces the writer's section, notes included (by design since #5317),
   and now counts the notes it replaced so the CLIs can say so. node --test engine/feedback-writenotes-8919.test.js */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-fbwritenotes-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('./feedback');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('a write after two notes replaces them and says it replaced two; the next write says none', () => {
  const day = '2026-11-20';
  assert.equal(fb.write('first', { from: 'ada', date: day }).notesReplaced, 0, 'a first write replaced notes');
  const t = Date.parse(day + 'T12:00:00Z');
  assert.equal(fb.note('ada', 'one', day, t).ok, true);
  assert.equal(fb.note('ada', 'two', day, t + 60000).ok, true);
  const w = fb.write('rewritten', { from: 'ada', date: day });
  assert.equal(w.notesReplaced, 2);
  assert.ok(!/Added later/.test(fb.read(day)), 'the notes were kept, so the count describes nothing');
  assert.equal(fb.write('again', { from: 'ada', date: day }).notesReplaced, 0, 'CONTROL: a write with no notes since counted some');
});

test('review 1: a rewrite that keeps a note (an edit of what show printed) does not count it; an edited one counts', () => {
  const day = '2026-11-18';
  const t = Date.parse(day + 'T12:00:00Z');
  fb.write('first', { from: 'ada', date: day });
  assert.equal(fb.note('ada', 'keep me', day, t).ok, true);
  const shown = fb.sections(fb.stripFrontmatter(fb.read(day))).find((x) => x.key === 'ada').text;
  const kept = fb.write(shown + '\nand one more line', { from: 'ada', date: day });
  assert.equal(kept.notesReplaced, 0, 'a note carried into the rewrite was reported lost');
  assert.match(fb.read(day), /keep me/);
  const edited = fb.write(shown.replace('keep me', 'kept, reworded'), { from: 'ada', date: day });
  assert.equal(edited.notesReplaced, 1, 'CONTROL: an edited note was not counted as gone');
});

test('round 3: CRLF line endings: a kept note is not counted, and a note stored with CRLF is counted when dropped', () => {
  const day = '2026-11-16';
  const t = Date.parse(day + 'T12:00:00Z');
  fb.write('first', { from: 'ada', date: day });
  assert.equal(fb.note('ada', 'keep me', day, t).ok, true);
  const shown = fb.sections(fb.stripFrontmatter(fb.read(day))).find((x) => x.key === 'ada').text;
  const crlf = shown.replace(/\n/g, '\r\n');
  assert.equal(fb.write(crlf, { from: 'ada', date: day }).notesReplaced, 0, 'a note kept in a CRLF rewrite was reported lost');
  // Stored with CRLF now: an LF copy of it (what show prints on another computer, or an editor's save) keeps the note.
  assert.equal(fb.write(shown, { from: 'ada', date: day }).notesReplaced, 0, 'an LF rewrite of a CRLF-stored note was reported lost');
  fb.write(crlf, { from: 'ada', date: day });
  // The section is now stored with CRLF, its note heading ending in a CR: dropping it must still be counted.
  assert.equal(fb.write('rewritten', { from: 'ada', date: day }).notesReplaced, 1, 'a note stored with CRLF went uncounted');
});

test('another writer\'s notes the same day are kept and not counted', () => {
  const day = '2026-11-19';
  const t = Date.parse(day + 'T12:00:00Z');
  fb.write('ada report', { from: 'ada', date: day });
  fb.write('bo report', { from: 'bo', date: day });
  assert.equal(fb.note('bo', 'bo note', day, t).ok, true);
  assert.equal(fb.write('ada again', { from: 'ada', date: day }).notesReplaced, 0);
  assert.match(fb.read(day), /bo note/, 'another writer\'s note went');
});

test('a line that merely looks like a note heading inside a report is not counted', () => {
  // Through write() itself (the counters are not exported: the #265 guard wants every export reachable).
  const day = '2026-11-17';
  // The first line ends at the heading-shaped text, so only the line-start anchor can refuse it.
  fb.write('I said: Added later (2026-11-17 12:00 UTC):\nAdded later (soon):\nend', { from: 'ada', date: day });
  assert.equal(fb.write('rewritten', { from: 'ada', date: day }).notesReplaced, 0, 'a heading-shaped phrase was counted as a note');
  // CONTROL: a real note in the same kind of report is counted.
  fb.write('I said: Added later (2026-11-17 12:00 UTC): x', { from: 'ada', date: day });
  assert.equal(fb.note('ada', 'real', day, Date.parse(day + 'T13:00:00Z')).ok, true);
  assert.equal(fb.write('rewritten', { from: 'ada', date: day }).notesReplaced, 1);
});

test('the sentence: none for 0, one note, several notes, and no apostrophe or em dash', () => {
  assert.equal(fb.replacedNotesLine(0), '');
  assert.equal(fb.replacedNotesLine(undefined), '');
  assert.equal(fb.replacedNotesLine(1), 'This replaced your earlier report for that day, and with it the note added to it later. If it still applies, add it again with kosmos feedback note.');
  assert.match(fb.replacedNotesLine(3), /and with it the 3 notes added to it later\./);
  assert.ok(!/['\u2014]/.test(fb.replacedNotesLine(2)));
});

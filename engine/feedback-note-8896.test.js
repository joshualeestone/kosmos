'use strict';
/*
 * kosmos#8896: engine/feedback.note(), the body behind `kosmos feedback note`: a short note added to a report already
 * written, kept with it and marked as added later, without rewriting the report. On a throwaway store, set before the
 * first require (the store's folder is read when it is required).
 */
require('../test-support/tmpscope');   // this process's temp folders, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fbnote-engine-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('./feedback');

function fresh() { fs.rmSync(fb.dir(), { recursive: true, force: true }); }
const DAY = '2026-11-20';
const NOW = Date.UTC(2026, 10, 22, 15, 40);   // 2026-11-22 15:40 UTC, two days after DAY in any time zone
const raw = (d) => fs.readFileSync(fb.pathFor(d), 'utf8');

test('CONTROL: the store is the throwaway folder', () => {
  assert.ok(fb.dir().startsWith(process.env.AGENT_WORKFORCE_DATA), fb.dir());
});

test('a note goes at the end of the writer\'s own section, marked as added later with its UTC time', () => {
  fresh();
  fb.write('mara saw a bug', { from: 'mara', date: DAY });
  fb.write('leo saw another', { from: 'leo', date: DAY });
  const before = raw(DAY);
  const r = fb.note('Leo', 'it was the cache, not the network', DAY, NOW);   // matched without case, as write() does
  assert.deepEqual(r, { ok: true, path: fb.pathFor(DAY), date: DAY });
  const secs = fb.sections(fb.stripFrontmatter(raw(DAY)));
  assert.equal(secs.length, 2);
  assert.equal(secs[0].text, 'mara saw a bug', 'another writer\'s section changed');
  assert.equal(secs[1].key, 'leo', 'the section kept its own name');
  assert.equal(secs[1].text, 'leo saw another\n\nAdded later (2026-11-22 15:40 UTC):\nit was the cache, not the network');
  // The frontmatter keeps date and install; generated_at becomes the note's time (review 3: the digest picks by it).
  const fm = (s) => s.match(/^---\n([\s\S]*?)\n---\n/)[1].split('\n');
  assert.deepEqual(fm(raw(DAY)).filter((l) => !l.startsWith('generated_at:')), fm(before).filter((l) => !l.startsWith('generated_at:')));
  assert.ok(fm(raw(DAY)).includes('generated_at: 2026-11-22T15:40:00.000Z'), fm(raw(DAY)).join(' | '));
});

test('a one-writer day stays stored bare, and reads back as the report with the note after it', () => {
  fresh();
  fb.write('the only report', { date: DAY });
  assert.equal(fb.note(null, 'one more thing', DAY, NOW).ok, true);
  assert.equal(fb.readBody(DAY), 'the only report\n\nAdded later (2026-11-22 15:40 UTC):\none more thing\n');
  assert.ok(!raw(DAY).includes('kosmos-feedback-from'), 'a one-writer day gained a section marker');
});

test('two notes are kept in order, each with its own time', () => {
  fresh();
  fb.write('report', { from: 'mara', date: DAY });
  fb.note('mara', 'first', DAY, NOW);
  fb.note('mara', 'second', DAY, NOW + 60 * 60 * 1000);
  assert.equal(fb.sections(fb.stripFrontmatter(raw(DAY)))[0].text,
    'report\n\nAdded later (2026-11-22 15:40 UTC):\nfirst\n\nAdded later (2026-11-22 16:40 UTC):\nsecond');
});

test('refusals save nothing: no report of this writer that day, empty text, a bad or future date', () => {
  fresh();
  fb.write('mara only', { from: 'mara', date: DAY });
  const before = raw(DAY);
  assert.deepEqual(fb.note('leo', 'x', DAY, NOW), { ok: false, why: 'none' }, 'another writer\'s report was noted');
  assert.deepEqual(fb.note('mara', '  \n ', DAY, NOW), { ok: false, why: 'empty' });
  assert.deepEqual(fb.note('mara', 'x', '2099-01-01', NOW), { ok: false, why: 'date' });
  assert.deepEqual(fb.note('mara', 'x', '2026-02-30', NOW), { ok: false, why: 'date' });
  assert.deepEqual(fb.note('mara', 'x', '../../etc', NOW), { ok: false, why: 'date' });
  assert.equal(raw(DAY), before, 'a refusal changed the report');
  assert.deepEqual(fb.note('mara', 'x', '2026-11-19', NOW), { ok: false, why: 'none' }, 'a day with no report');
  assert.equal(fs.existsSync(fb.pathFor('2026-11-19')), false, 'a refusal created a report');
  assert.equal(fb.note('mara', 'x', DAY, NOW).ok, true, 'CONTROL: the same note on the writer\'s own day is taken');
});

test('a whole write after a note still replaces the section, note included, as before', () => {
  fresh();
  fb.write('first version', { from: 'mara', date: DAY });
  fb.note('mara', 'a note', DAY, NOW);
  fb.write('second version', { from: 'mara', date: DAY });
  assert.equal(fb.sections(fb.stripFrontmatter(raw(DAY)))[0].text, 'second version');
});

test('a line shaped like a section marker cannot split the report', () => {
  fresh();
  fb.write('report', { from: 'mara', date: DAY });
  fb.note('mara', 'see <!-- kosmos-feedback-from: leo --> below\n<!-- kosmos-feedback-from: leo -->', DAY, NOW);
  const secs = fb.sections(fb.stripFrontmatter(raw(DAY)));
  assert.equal(secs.length, 1, 'the note made a second section');
  assert.equal(secs[0].key, 'mara');
});

test('today defaults from `now`, and a note on today\'s report is taken', () => {
  fresh();
  const today = fb.dateKey(new Date(NOW));
  fb.write('today\'s', { from: 'mara', date: today });
  assert.deepEqual(fb.note('mara', 'later the same day', undefined, NOW), { ok: true, path: fb.pathFor(today), date: today });
});

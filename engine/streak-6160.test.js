'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#6160: the streak in the Kosmos. The day logic walked through a rollover, a missed day, a trip west and bad
 * input with no clock; then the board's record() against a sandboxed data dir, including a restart (a fresh require)
 * and the daily note appearing exactly once.
 *
 *   node --test engine/streak-6160.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'streak-6160-')));
process.env.AGENT_WORKFORCE_DATA = SB;
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const store = require('./store');
fs.mkdirSync(store.ROOT, { recursive: true });
const streak = require('./streak');

// A fixed "now" for record(): noon UTC on 2026-10-14, so 10-13, 10-14 and 10-15 are all plausible local dates.
const NOW = Date.UTC(2026, 9, 14, 12);
const at = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12);
function fresh() { try { fs.rmSync(streak.file()); } catch { /* none yet */ } }

test('the first visit is day 1; the same day again changes nothing', () => {
  let s = streak.visit(null, '2026-10-14');
  assert.deepEqual(s, { count: 1, last: '2026-10-14', congratulated: null });
  assert.deepEqual(streak.visit(s, '2026-10-14'), s);
});

test('the day rolls over: the next day grows the streak by one', () => {
  let s = streak.visit(null, '2026-10-14');
  s = streak.visit(s, '2026-10-15');
  s = streak.visit(s, '2026-10-16');
  assert.equal(s.count, 3);
  assert.equal(s.last, '2026-10-16');
});

test('across a month and a year end, the next calendar day still counts', () => {
  assert.equal(streak.visit({ count: 4, last: '2026-10-31' }, '2026-11-01').count, 5);
  assert.equal(streak.visit({ count: 4, last: '2026-12-31' }, '2027-01-01').count, 5);
  assert.equal(streak.visit({ count: 4, last: '2028-02-28' }, '2028-02-29').count, 5);   // a leap day is a day
});

test('a missed day starts the count again at 1', () => {
  const s = streak.visit({ count: 9, last: '2026-10-12', congratulated: '2026-10-12' }, '2026-10-14');
  assert.equal(s.count, 1);
  assert.equal(s.last, '2026-10-14');
});

test('a day earlier than the last one (travel west, a slow second screen) neither resets nor adds', () => {
  const s = { count: 5, last: '2026-10-14', congratulated: null };
  assert.deepEqual(streak.visit(s, '2026-10-13'), s);
});

test('a date that is not a real day records nothing', () => {
  const s = { count: 5, last: '2026-10-14', congratulated: null };
  for (const bad of ['2026-02-31', '2026-13-01', '14/10/2026', '', null, '2026-10-14T00:00']) {
    assert.deepEqual(streak.visit(s, bad), s, String(bad));
  }
});

test('a damaged state reads as no streak, never as a wrong number', () => {
  for (const bad of [null, 'x', { count: -3, last: '2026-10-14' }, { count: 2.5, last: '2026-10-14' }, { count: 4, last: 'yesterday' }]) {
    assert.equal(streak.visit(bad, '2026-10-14').count, 1, JSON.stringify(bad));
  }
});

test('the note is due from day 2, once per day', () => {
  const d1 = streak.visit(null, '2026-10-14');
  assert.equal(streak.congratsDue(d1, '2026-10-14'), false, 'nothing to congratulate on day 1');
  const d2 = streak.visit(d1, '2026-10-15');
  assert.equal(streak.congratsDue(d2, '2026-10-15'), true);
  assert.equal(streak.congratsDue(streak.markCongratulated(d2, '2026-10-15'), '2026-10-15'), false);
  // after a reset the count is 1 again, so no note that day even if an old one was shown long ago
  const reset = streak.visit({ count: 9, last: '2026-10-10', congratulated: '2026-10-10' }, '2026-10-15');
  assert.equal(streak.congratsDue(reset, '2026-10-15'), false);
});

test('plausible: the page date must be within a day of the board clock', () => {
  assert.equal(streak.plausible('2026-10-13', NOW), true);
  assert.equal(streak.plausible('2026-10-14', NOW), true);
  assert.equal(streak.plausible('2026-10-15', NOW), true);
  assert.equal(streak.plausible('2026-10-16', NOW), false);
  assert.equal(streak.plausible('2026-10-12', NOW), false);
  assert.equal(streak.plausible('nonsense', NOW), false);
});

test('record: a rollover on disk, the note exactly once, and a restart keeps the count', () => {
  fresh();
  assert.deepEqual(streak.record('2026-10-13', at('2026-10-13')), { count: 1, congrats: false });
  assert.deepEqual(streak.record('2026-10-14', at('2026-10-14')), { count: 2, congrats: true });
  // a reload, or a second screen, the same day: the count stands and the note is NOT shown again
  assert.deepEqual(streak.record('2026-10-14', at('2026-10-14')), { count: 2, congrats: false });
  // a restart: a fresh copy of the module reads the same file
  delete require.cache[require.resolve('./streak')];
  const again = require('./streak');
  assert.deepEqual(again.record('2026-10-14', at('2026-10-14')), { count: 2, congrats: false });
  assert.deepEqual(again.record('2026-10-15', at('2026-10-15')), { count: 3, congrats: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(again.file(), 'utf8')), { count: 3, last: '2026-10-15', congratulated: '2026-10-15' });
});

test('record: a missed day on disk starts again at 1, with no note', () => {
  fresh();
  streak.record('2026-10-10', at('2026-10-10'));
  streak.record('2026-10-11', at('2026-10-11'));
  assert.deepEqual(streak.record('2026-10-14', at('2026-10-14')), { count: 1, congrats: false });
});

test('record: an implausible date changes nothing on disk', () => {
  fresh();
  streak.record('2026-10-14', NOW);
  const before = fs.readFileSync(streak.file(), 'utf8');
  assert.deepEqual(streak.record('2026-10-20', NOW), { count: 1, congrats: false });
  assert.equal(fs.readFileSync(streak.file(), 'utf8'), before);
});

test('record: a same-day reload does not rewrite the file', () => {
  fresh();
  streak.record('2026-10-14', NOW);
  const old = new Date(Date.UTC(2026, 0, 1));   // a whole second, so the filesystem stores it exactly
  fs.utimesSync(streak.file(), old, old);
  streak.record('2026-10-14', NOW);
  assert.equal(fs.statSync(streak.file()).mtimeMs, old.getTime());
});

test('the file is written through store.saveFlushed, never a bare write', () => {
  const src = fs.readFileSync(path.join(__dirname, 'streak.js'), 'utf8');
  assert.match(src, /store\.saveFlushed\(file\(\)/);
  assert.doesNotMatch(src, /writeFileSync|renameSync/);
});

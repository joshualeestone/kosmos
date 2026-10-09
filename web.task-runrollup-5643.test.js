'use strict';
/* kosmos#5643: the task page's history rolls up runs that found nothing new, and the repeat line (the status card) says
   how many runs in a row found nothing new and when the last change was. From the page's real functions, lifted. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const NOW = Date.parse('2026-10-09T05:00:00Z');
const lib = new Function('LAST', page.liftAll(SCRIPT, ['esc', 'agoWords', 'tkMemberName', 'tkActPhrase', 'tkActRowsHtml', 'tskAgentName', 'tskRepeatMissed', 'tskRepeatSentence'])
  + '\nreturn { tkActRowsHtml, tskRepeatSentence };')([]);
const P = { id: 'p1', agents: [] };
const run = (minAgo, extra) => ({ kind: 'run', at: new Date(NOW - minAgo * 60000).toISOString(), by: 'mara', ...extra });

test('#5643: two or more unchanged runs in a row are ONE row that opens to show each; changes keep their own rows', () => {
  const events = [run(300, { note: 'found 3 new' }), run(240, { unchanged: true, note: 'all clear' }), run(180, { unchanged: true, note: 'all clear' }), run(120, { unchanged: true, note: 'all clear' }), run(60, { note: 'one is down' })];
  const html = lib.tkActRowsHtml(events, P, NOW);
  assert.equal((html.match(/<details class="tkact-roll"/g) || []).length, 1, 'the three unchanged runs are not one rolled-up row');
  assert.match(html, /3 runs found nothing new/);
  assert.equal((html.match(/class="tkact"/g) || []).length, 1 + 3 + 1 + 1, 'each run is still inside the rollup, and the two changes stand alone');
  assert.ok(html.indexOf('found 3 new') < html.indexOf('tkact-roll') && html.indexOf('tkact-roll') < html.indexOf('one is down'), 'the order changed');
});

test('#5643: one unchanged run alone, a late unchanged run, and a run with no flag are not rolled up', () => {
  const lone = lib.tkActRowsHtml([run(120, { note: 'x' }), run(60, { unchanged: true, note: 'x' })], P, NOW);
  assert.doesNotMatch(lone, /tkact-roll/, 'a single unchanged run was rolled up');
  assert.match(lone, /nothing new: x/, 'the row does not say it found nothing new');
  const late = lib.tkActRowsHtml([run(180, { unchanged: true }), run(120, { unchanged: true, late: true }), run(60, { unchanged: true })], P, NOW);
  assert.doesNotMatch(late, /tkact-roll/, 'a late run was hidden inside a rollup (lateness is news)');
  // CONTROL: the same three without the late one roll up, so the row above was not rolled up because of the late run.
  assert.match(lib.tkActRowsHtml([run(180, { unchanged: true }), run(120, { unchanged: true }), run(60, { unchanged: true })], P, NOW), /3 runs found nothing new/);
});

test('#5643: the status line says how many runs in a row found nothing new and when the last change was; nothing extra with none', () => {
  const t = { repeat: { every: 'hour' }, repeatWords: 'every hour', lastRunAt: new Date(NOW - 5 * 60000).toISOString(), lastRunBy: 'mara', lastRunNote: 'all clear', unchangedRuns: 12, lastChangeAt: new Date(NOW - 12 * 3600000).toISOString(), lastChangeNote: 'found 3 new', repeatNextWords: 'at 1am' };
  const s = lib.tskRepeatSentence(t, NOW);
  assert.match(s, /The last 12 runs found nothing new; the last change was 12 hours ago: found 3 new\./, s);
  assert.match(s, /Next at 1am\.$/);
  assert.match(lib.tskRepeatSentence({ ...t, unchangedRuns: 1 }, NOW), /It found nothing new;/);
  // Review 1: when the change's note is the last run's (the same note, repeated), it is said once.
  const once = lib.tskRepeatSentence({ ...t, lastChangeNote: 'all clear' }, NOW);
  assert.equal((once.match(/all clear/g) || []).length, 1, once);
  assert.match(once, /the last change was 12 hours ago\./);
  const plain = lib.tskRepeatSentence({ ...t, unchangedRuns: undefined }, NOW);
  assert.doesNotMatch(plain, /nothing new/, 'a task with no unchanged runs got the rollup words');
});

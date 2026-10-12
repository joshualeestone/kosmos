'use strict';
/* kosmos#5920: a run that recovers after scheduled runs that never happened says so, on the repeat line (from the task's
   lastRunRecovered) and on its own history row (missedBefore), and is never folded into the "nothing new" rollup. From
   the page's real functions, lifted. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const NOW = Date.parse('2026-10-12T10:00:00Z');
const lib = new Function('LAST', page.liftAll(SCRIPT, ['esc', 'agoWords', 'tkMemberName', 'tkActPhrase', 'tkActRowsHtml', 'tskAgentName', 'tskRepeatMissed', 'tskToldSentence', 'tskRepeatSentence'])
  + '\nreturn { tkActRowsHtml, tskRepeatSentence, tkActPhrase };')([]);
const P = { id: 'p1', agents: [] };
const run = (minAgo, extra) => ({ kind: 'run', at: new Date(NOW - minAgo * 60000).toISOString(), by: 'mara', ...extra });

test('#5920: the repeat line says how many runs the last run came after; one, many and more than the cap', () => {
  const t = { repeat: { every: 'hour' }, repeatWords: 'every hour', lastRunAt: new Date(NOW - 5 * 60000).toISOString(), lastRunBy: 'mara', lastRunLate: true, lastRunNote: 'back up', repeatNextWords: 'at 11am' };
  assert.match(lib.tskRepeatSentence({ ...t, lastRunRecovered: { missed: 3, from: 'x', to: 'y' } }, NOW), / by mara, late, after 3 missed runs: back up\./);
  assert.match(lib.tskRepeatSentence({ ...t, lastRunRecovered: { missed: 1, from: 'x', to: 'x' } }, NOW), /, late, after 1 missed run: back up\./);
  assert.match(lib.tskRepeatSentence({ ...t, lastRunRecovered: { missed: 99, more: true, from: 'x', to: 'y' } }, NOW), /after more than 99 missed runs/);
  // CONTROL: a late run that skipped nothing says late and nothing more.
  assert.doesNotMatch(lib.tskRepeatSentence(t, NOW), /missed/, 'a run with no lastRunRecovered named missed runs');
  assert.doesNotMatch(lib.tskRepeatSentence({ ...t, lastRunRecovered: { missed: 0 } }, NOW), /missed/, 'a zero count is no recovery');
});

test('#5920: the history row of a recovering run says how many runs it came after', () => {
  assert.equal(lib.tkActPhrase(run(5, { late: true, missedBefore: 2, note: 'back up' }), P), 'mara ran it, late, after 2 missed runs: back up');
  assert.equal(lib.tkActPhrase(run(5, { missedBefore: 1 }), P), 'mara ran it, after 1 missed run');
  assert.equal(lib.tkActPhrase(run(5, { missedBefore: 99, missedMore: true }), P), 'mara ran it, after more than 99 missed runs');
  assert.equal(lib.tkActPhrase(run(5, { note: 'ok' }), P), 'mara ran it: ok', 'CONTROL: an ordinary run is unchanged');
});

test('#5920: a recovering run is never folded into the nothing-new rollup', () => {
  const html = lib.tkActRowsHtml([run(180, { unchanged: true }), run(120, { unchanged: true, missedBefore: 2 }), run(60, { unchanged: true })], P, NOW);
  assert.doesNotMatch(html, /tkact-roll/, 'a recovery was hidden inside a rollup');
  assert.match(html, /after 2 missed runs/);
  // CONTROL: the same three without the recovery roll up, so the row above stood alone because of it.
  assert.match(lib.tkActRowsHtml([run(180, { unchanged: true }), run(120, { unchanged: true }), run(60, { unchanged: true })], P, NOW), /3 runs found nothing new/);
});

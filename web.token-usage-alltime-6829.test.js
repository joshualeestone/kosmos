'use strict';
/* kosmos#6829 (Josh 10-21 07:54): Token Usage is all-time since install, and Active Days counts from the install
   day. The helpers are lifted from the page and run, like web.token-usage-2617.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);

const U = new Function(
  page.liftConst(SCRIPT, 'USAGE_CHART_DAYS') + '\n'
  + lift('usageRowTokenTotal') + '\n'
  + lift('usageActiveDays') + '\n'
  + lift('usageChartDays') + '\n'
  + 'return { usageActiveDays, usageChartDays, USAGE_CHART_DAYS };'
)();

const B = (n) => ({ input_tokens: n, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 });

/* Fourteen requested days, usage on two: the shape a 14-day window answers with on a new install. */
function fourteen() {
  const byDay = {};
  for (let i = 1; i <= 14; i += 1) byDay['2026-10-' + String(i).padStart(2, '0')] = {};
  byDay['2026-10-13'] = { 'claude-x': B(5) };
  byDay['2026-10-14'] = { 'claude-x': B(7) };
  return byDay;
}

test('#6829: Active Days is the install-day count the board reports, not the number of days asked for', () => {
  assert.equal(U.usageActiveDays({ byDay: fourteen(), daysOnKosmos: 1 }), 1, 'a new install shows 1');
  assert.equal(U.usageActiveDays({ byDay: fourteen(), daysOnKosmos: 40 }), 40, 'an older install shows its days, past 14');
  // Control: the old figure, Object.keys(byDay).length, is 14 on the same answer.
  assert.equal(Object.keys(fourteen()).length, 14);
});

test('#6829: without the board figure, Active Days counts days with usage, never the window length', () => {
  assert.equal(U.usageActiveDays({ byDay: fourteen() }), 2);
  assert.equal(U.usageActiveDays({ byDay: fourteen(), daysOnKosmos: 0 }), 2, 'a zero or missing figure is not trusted');
  assert.equal(U.usageActiveDays({ byDay: fourteen(), daysOnKosmos: 'x' }), 2);
  assert.equal(U.usageActiveDays(null), 0);
});

test('#6829: the four charts keep the last 14 days of an all-time series', () => {
  const series = Array.from({ length: 40 }, (_, i) => ({ day: 'd' + String(i).padStart(2, '0') }));
  const shown = U.usageChartDays(series);
  assert.equal(U.USAGE_CHART_DAYS, 14);
  assert.equal(shown.length, 14);
  assert.equal(shown[0].day, 'd26', 'the window ends at the newest day');
  assert.equal(shown[13].day, 'd39');
  assert.equal(U.usageChartDays(series.slice(0, 3)).length, 3, 'a shorter series is shown whole');
  assert.deepEqual(U.usageChartDays(null), []);
});

test('#6829: the render feeds the hero the board figure and the charts the windowed series', () => {
  assert.match(SCRIPT, /usageHeroHtml\(totals, usageActiveDays\(data\), api\.cost\)/);
  assert.match(SCRIPT, /usageCharts4Html\(usageChartDays\(usageDailySeries\(byDay\)\), totals, grandTotal\)/);
  assert.doesNotMatch(SCRIPT, /usageHeroHtml\(totals, Object\.keys\(byDay\)\.length/, 'the window length is gone');
  assert.doesNotMatch(SCRIPT, /last fourteen days/, 'no copy promises a fourteen-day window');
});

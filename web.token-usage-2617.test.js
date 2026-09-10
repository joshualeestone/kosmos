'use strict';
/**
 * #2617: the graphical Token Usage value view (Mona's design, Josh's #1 demo win).
 *
 * 🔑 THIS RUNS THE REAL RENDER FUNCTIONS against a fixed /api/usage fixture and
 * checks the numbers on the screen against values computed BY HAND here, not by
 * re-running the product's own formula. That is the #2620 lesson made concrete:
 * an un-runnable check whose expected values are hardcoded from the same head
 * that wrote the code proves nothing; a wrong sum or a wrong dollar is exactly
 * what a blind reviewer catches. Here the fixture goes in, the hand-computed
 * total/dollar is asserted out, and the real lifted code has to produce it.
 *
 * The browser-check render-token-usage-2617.js covers the LIVE rendered page
 * (cards + chart svg + money + table present on a served board); this pins the
 * SOURCE compute -- the repo's dual-coverage convention for a usage feature.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { codeOnly } = require('./test-support/code-only');
const page = require('./test-support/page');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const CODE = codeOnly(RAW);
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);

/* The real render functions, lifted out of the shipped page and their callees +
   the three display constants brought with them so they can actually run
   (a lifted function's own callees have to come with it -- test-support/page.js). */
function bundle() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftConst(SCRIPT, 'USAGE_TOKENS_PER_ENGINEER_DAY') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_HOURS_PER_ENGINEER_DAY') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_RATE_PER_HOUR') + '\n'
    + lift('esc') + '\n'
    + lift('usageNum') + '\n'
    + lift('usageDayLabel') + '\n'
    + lift('usageTotals') + '\n'
    + lift('usageDailySeries') + '\n'
    + lift('usageCardsHtml') + '\n'
    + lift('usageMoneyHtml') + '\n'
    + lift('usageChartSvg') + '\n'
    + 'return { usageTotals, usageDailySeries, usageCardsHtml, usageMoneyHtml, usageChartSvg, usageDayLabel, usageNum };'
  )();
}
const U = bundle();

/* Two days, one model. Chosen so cache-read towers over the other three, as it
   does on a real machine, and so every class sums to a distinct number. */
const FIXTURE = {
  '2026-09-01': { 'claude-opus-4-8': { input_tokens: 2140559, output_tokens: 760331, cache_creation_input_tokens: 9401220, cache_read_input_tokens: 1023445990 } },
  '2026-08-31': { 'claude-opus-4-8': { input_tokens: 2010445, output_tokens: 701558, cache_creation_input_tokens: 8702558, cache_read_input_tokens: 940558112 } },
};
// Hand-computed, independent of the product formula:
//   input  = 2,140,559 + 2,010,445 = 4,151,004
//   output =   760,331 +   701,558 = 1,461,889
//   written= 9,401,220 + 8,702,558 = 18,103,778
//   read   =1,023,445,990+940,558,112=1,964,004,102
//   $ from OUTPUT only: 1,461,889 / 750,000 = 1.94918... eng-days
//                       round(1.94918... * 8h * $100) = round(1559.348) = 1559
const EXPECT = { input: 4151004, output: 1461889, cacheWritten: 18103778, cacheRead: 1964004102, dollars: 1559 };
// Formatting is asserted via the runtime's own toLocaleString so the test is
// locale-robust, while the integer above is the hand-computed pin.
const fmt = (n) => Number(n).toLocaleString();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('#2617: usageTotals sums each class separately and never blends them', () => {
  const t = U.usageTotals(FIXTURE);
  assert.equal(t.input, EXPECT.input, 'input total');
  assert.equal(t.output, EXPECT.output, 'output total');
  assert.equal(t.cacheWritten, EXPECT.cacheWritten, 'cache-written total');
  assert.equal(t.cacheRead, EXPECT.cacheRead, 'cache-read total');
  // The four are returned as four fields, so nothing here can add up to a single
  // "tokens used" figure -- the invariant the whole page defends.
  assert.ok(!('total' in t) && !('all' in t), 'no blended total field is produced');
});

test('#2617: the four class cards show the full numbers, cache-read gold-accented', () => {
  const html = U.usageCardsHtml(U.usageTotals(FIXTURE));
  assert.match(html, /class="usage-four"/, 'the four-card grid is present');
  for (const [label, key] of [['Input', 'input'], ['Output', 'output'], ['Cache written', 'cacheWritten'], ['Cache read', 'cacheRead']]) {
    assert.ok(html.includes('>' + label + '<'), label + ' card label present');
    assert.ok(html.includes(fmt(EXPECT[key])), label + ' shows its full number ' + fmt(EXPECT[key]));
  }
  // no abbreviation: the billion-scale cache-read is not softened to "1.9B" etc
  assert.ok(!/\d(\.\d+)?[KMB]\b/.test(html), 'no K/M/B abbreviation (Josh: show them in full)');
  assert.match(html, /class="usage-cls read"[\s\S]*Cache read/, 'the cache-read card carries the gold "read" class');
});

test('#2617: the money box is derived from OUTPUT alone and names its class', () => {
  const money = U.usageMoneyHtml(U.usageTotals(FIXTURE));
  assert.match(money, new RegExp('\\$<span>' + reEsc(fmt(EXPECT.dollars)) + '</span>'),
    'the dollar figure is the hand-computed ' + fmt(EXPECT.dollars) + ' (output/750k * 8h * $100)');
  assert.match(money, /engineering-equivalent of the <b>output<\/b> tokens/, 'it names OUTPUT as its basis');
  assert.ok(money.includes(fmt(EXPECT.output)), 'it states the output token count it is built from');
  assert.match(money, /about 1\.9 engineer-days/, 'it states the engineer-day equivalent');
  // The other three classes must NOT be folded into the dollar figure.
  assert.ok(!money.includes(fmt(EXPECT.cacheRead)), 'cache-read is not folded into the dollar figure');
});

test('#2617: an empty output produces no money box (nothing to interpret)', () => {
  assert.equal(U.usageMoneyHtml({ input: 5, output: 0, cacheWritten: 5, cacheRead: 5 }), '', 'no output -> empty money box');
});

test('#2617: the chart is four polylines on one shared axis, oldest-to-newest', () => {
  const series = U.usageDailySeries(FIXTURE);
  assert.deepEqual(series.map((p) => p.day), ['2026-08-31', '2026-09-01'], 'series ascends by date');
  const svg = U.usageChartSvg(series);
  assert.match(svg, /viewBox="0 0 760 300"/, 'svg present with the mockup viewBox');
  assert.equal((svg.match(/<polyline /g) || []).length, 4, 'exactly four polylines (one per class)');
  for (const color of ['#d6a62e', '#6fd3a0', '#8ab4ff', '#c78cff']) {
    assert.ok(svg.includes('stroke="' + color + '"'), 'polyline for color ' + color);
  }
  // shared axis: cache-read (the largest) reaches the top band, the others sit near the baseline.
  // its max point is the second day; y ~ yTop (14). The baseline is at y=274.
  assert.match(svg, /stroke="#d6a62e"[^/]*points="[^"]*,14\.0"/, 'cache-read touches the top of the shared axis (its own max)');
  assert.match(svg, /Aug 31/, 'the x-axis carries a day label');
});

test('#2617: a single day cannot draw a line, so the chart is empty (caller hides it)', () => {
  const svg = U.usageChartSvg(U.usageDailySeries({ '2026-09-01': FIXTURE['2026-09-01'] }));
  assert.equal(svg, '', 'one point -> no chart');
});

test('#2617: usageDayLabel formats the UTC key, and passes anything else through', () => {
  assert.equal(U.usageDayLabel('2026-08-19'), 'Aug 19');
  assert.equal(U.usageDayLabel('not-a-date'), 'not-a-date');
});

test('#2617: the section markup carries the cards, chart, money and table containers, and fetches 14 days', () => {
  assert.match(CODE, /id="usage-cards"/, 'the cards container is in the page');
  assert.match(CODE, /id="usage-chartwrap"[^>]*hidden/, 'the chart wrap is present and starts hidden');
  assert.match(CODE, /id="usage-chart"/, 'the chart container is in the page');
  assert.match(CODE, /id="usage-worth"/, 'the money container is in the page');
  assert.match(CODE, /class="usage-meas"[\s\S]*id="usage-table"/, 'the table stays, framed as the measurement');
  assert.match(CODE, /class="usage-legend"[\s\S]*Cache read[\s\S]*Cache written[\s\S]*Input[\s\S]*Output/, 'the legend names all four classes');
  assert.match(SCRIPT, /fetch\('\/api\/usage\?days=14'\)/, 'the render asks for 14 days (Mona\'s two-week trend)');
});

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
    + page.liftConst(SCRIPT, 'USAGE_CLASS_COLORS') + '\n'
    + lift('esc') + '\n'
    + lift('usageNum') + '\n'
    + lift('usageDayLabel') + '\n'
    + lift('usageTotals') + '\n'
    + lift('usageDailySeries') + '\n'
    + lift('usageCardsHtml') + '\n'
    + lift('usageMoneyHtml') + '\n'
    + lift('usageChartSvg') + '\n'
    + lift('usageLegendHtml') + '\n'
    + lift('usageTableHtml') + '\n'
    // #2840: the usage-history list + its abbr helper + the blended Value math.
    + page.liftConst(SCRIPT, 'USAGE_VALUE_TOKENS_PER_HOUR') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_VALUE_BLENDED_RATE') + '\n'
    + lift('usageUsd') + '\n'
    + lift('usageRowValue') + '\n'
    + lift('usageAbbr') + '\n'
    + lift('usageHistoryHtml') + '\n'
    + 'return { usageTotals, usageDailySeries, usageCardsHtml, usageMoneyHtml, usageChartSvg, usageLegendHtml, usageTableHtml, usageDayLabel, usageNum, USAGE_CLASS_COLORS, usageAbbr, usageHistoryHtml, usageUsd, usageRowValue };'
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
  // the card accent comes from the SHARED source (not the app-wide --gold), so it
  // agrees with the chart line and legend swatch by reference.
  const readColor = U.USAGE_CLASS_COLORS.find((c) => c.key === 'cacheRead').color;
  assert.match(html, new RegExp('class="usage-v" style="color:' + reEsc(readColor) + '"'),
    'the cache-read card value is colored from USAGE_CLASS_COLORS (' + readColor + '), the same source as the chart');
});

test('#2617: the table renders a row per day/model and escapes model names (the innerHTML site)', () => {
  const rows = U.usageTableHtml(FIXTURE);
  assert.match(rows, /<table class="usage-table">/, 'a table is produced');
  assert.equal((rows.match(/<tr>/g) || []).length, 3, 'one header row + one row per day/model (2 days) = 3');
  assert.ok(rows.includes(fmt(EXPECT.cacheRead)) === false, 'per-row values are per-day, not the summed total');
  // escaping: a hostile model name must not inject markup through innerHTML.
  const hostile = U.usageTableHtml({ '2026-09-01': { '<img src=x onerror=alert(1)>': { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 } } });
  assert.ok(!hostile.includes('<img src=x'), 'a hostile model name is escaped, not rendered as a tag');
  assert.ok(hostile.includes('&lt;img'), 'the hostile string is HTML-escaped');
});

test('#2617: the money box is derived from OUTPUT alone and names its class', () => {
  const money = U.usageMoneyHtml(U.usageTotals(FIXTURE));
  assert.match(money, new RegExp('\\$<span>' + reEsc(fmt(EXPECT.dollars)) + '</span>'),
    'the dollar figure is the hand-computed ' + fmt(EXPECT.dollars) + ' (output/750k * 8h * $100)');
  assert.match(money, /engineering-equivalent of the <b>output<\/b> tokens/, 'it names OUTPUT as its basis');
  assert.ok(money.includes(fmt(EXPECT.output)), 'it states the output token count it is built from');
  assert.match(money, /about 1\.9 engineer-days/, 'it states the engineer-day equivalent');
  // Mona's #2617 copy call: spell "eight-hour" so it does not collide with the
  // digit in "about 1.9 engineer-days" later in the same sentence.
  assert.match(money, /eight-hour engineer-day/, 'the engineer-day is spelled "eight-hour"');
  assert.doesNotMatch(money, /8-hour/, 'not the digit form "8-hour" (Mona ruled the word)');
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
  assert.match(CODE, /id="usage-legend"/, 'the legend container is in the page (filled by JS from the shared color source)');
  assert.match(SCRIPT, /fetch\('\/api\/usage\?days=14'\)/, 'the render asks for 14 days (Mona\'s two-week trend)');
});

test('#2617: the legend and the chart draw from ONE color source, so they cannot drift', () => {
  // Both usageChartSvg and usageLegendHtml read USAGE_CLASS_COLORS -- proven by running them.
  const legend = U.usageLegendHtml();
  const svg = U.usageChartSvg(U.usageDailySeries(FIXTURE));
  for (const c of U.USAGE_CLASS_COLORS) {
    assert.ok(legend.includes('background:' + c.color), 'legend swatch uses ' + c.color + ' for ' + c.label);
    assert.ok(legend.includes('>' + c.label + '</span>'), 'legend names ' + c.label);
    assert.ok(svg.includes('stroke="' + c.color + '"'), 'the chart polyline uses the SAME ' + c.color);
  }
  assert.equal(U.USAGE_CLASS_COLORS.length, 4, 'exactly the four classes');
  // the legend order matches the mockup (cache-read first)
  assert.deepEqual(U.USAGE_CLASS_COLORS.map((c) => c.label), ['Cache read', 'Cache written', 'Input', 'Output']);
});

/* #2840: the scrollable usage-history list. FIXTURE (above) is 2 days x 1 model.
   Hand-computed per-row totals (4-class sums), independent of the product code:
   2026-09-01: 2,140,559 + 760,331 + 9,401,220 + 1,023,445,990 = 1,035,748,100
   2026-08-31: 2,010,445 + 701,558 + 8,702,558 +   940,558,112 =   951,972,673 */
test('#2840: usageHistoryHtml renders a row per day/model, newest first, with the 4-class total', () => {
  const html = U.usageHistoryHtml(FIXTURE);
  assert.match(html, /class="uhrow uhhead"/, 'the sticky header row is present');
  assert.match(html, />Day<[\s\S]*>Model<[\s\S]*>Total tokens<[\s\S]*>Value</, 'the four columns are Day/Model/Total tokens/Value');
  // newest first: 09-01 appears before 08-31
  assert.ok(html.indexOf('2026-09-01') < html.indexOf('2026-08-31'), 'rows are newest-first');
  // per-row total abbreviated in the cell, full number in the title attr
  assert.ok(html.includes('title="' + fmt(1035748100) + '"'), 'the 09-01 row carries its full total in title');
  assert.ok(html.includes('>1.0B<'), 'the 09-01 row shows the abbreviated total');
});

test('#2840: the Value column is the blended per-row dollar figure (Josh ruled: keep the blend)', () => {
  const html = U.usageHistoryHtml(FIXTURE);
  // Josh ruled to KEEP the blended Value (the design's ~$135M headline), so the
  // "pending" stub is retired and each row shows its own blended dollar figure:
  //   Value = usd( rowTotal / 100,000 * 90 )   (the approved /design/token-value math)
  //   2026-09-01: 1,035,748,100 / 1e5 * 90 = 932,173.29 -> "$932,173"
  //   2026-08-31:   951,972,673 / 1e5 * 90 = 856,775.41 -> "$856,775"
  assert.ok(html.includes('$932,173'), 'the 09-01 row shows its blended dollar Value');
  assert.ok(html.includes('$856,775'), 'the 08-31 row shows its blended dollar Value');
  assert.ok(!/pending/.test(html), 'the "pending" stub is gone');
  assert.ok(!/uh-stub/.test(html), 'the retired stub class is gone');
});

test('#2840: usageRowValue + usageUsd match the approved design formula and format bands', () => {
  // Row value = the design's (tok / tokPerHr) * blendedRate, formatted by usd().
  assert.equal(U.usageRowValue(1035748100), '$932,173', 'billion-scale row -> thousands-separated $');
  assert.equal(U.usageRowValue(951972673), '$856,775', 'the older row matches its hand-computed value');
  // usd() format bands, straight from the design's usd():
  assert.equal(U.usageUsd(2.5e9), '$2.50B', 'billions keep two decimals with a B');
  assert.equal(U.usageUsd(3.4e6), '$3M', 'millions round to a whole M');
  assert.equal(U.usageUsd(932173.29), '$932,173', 'the thousands band is separated and rounded');
  assert.equal(U.usageUsd(50), '$50', 'tens..hundreds print as a whole dollar');
  assert.equal(U.usageUsd(5.5), '$5.50', 'under $10 keeps cents');
  // Sanity: the grand-total blend lands on the design's ~$135M headline scale.
  assert.equal(U.usageUsd(150005932754 / 1e5 * 90), '$135M', 'the blended grand total is the design ~$135M');
});

test('#2840: usageAbbr abbreviates B/M/K and passes small numbers through', () => {
  assert.equal(U.usageAbbr(21463000000), '21B', 'ten-billions round to a whole B (toFixed 0)');
  assert.equal(U.usageAbbr(1964004102), '2.0B', 'single-digit billions keep one decimal (1.96 -> 2.0B)');
  assert.equal(U.usageAbbr(1035748100), '1.0B', 'a low single-digit billion keeps one decimal');
  assert.equal(U.usageAbbr(18103778), '18.1M', 'millions keep one decimal');
  assert.equal(U.usageAbbr(4151), '4K', 'thousands round to whole K');
  assert.equal(U.usageAbbr(742), '742', 'sub-thousand passes through');
  assert.equal(U.usageAbbr(0), '0', 'zero passes through');
});

test('#2840: usageHistoryHtml escapes a hostile model name and is empty on no data', () => {
  const hostile = U.usageHistoryHtml({ '2026-09-01': { '<img src=x onerror=1>': { output_tokens: 5 } } });
  assert.ok(!hostile.includes('<img src=x'), 'a hostile model name is not rendered as a tag');
  assert.ok(hostile.includes('&lt;img'), 'the hostile string is HTML-escaped');
  assert.equal(U.usageHistoryHtml({}), '', 'empty byDay renders nothing');
});

/* #2840 (Convention #5, "two derivations of one fact"): usageTableHtml and usageHistoryHtml
   independently iterate byDay to emit their rows. This pins that they cover the SAME
   (day, model) set from the same input, so a future edit to one loop (e.g. a per-class
   filter) that misses the other desyncs a test rather than shipping silently. */
test('#2840: the usage-history list and the measurement table derive the same (day,model) rows', () => {
  const fx = {
    '2026-09-02': { 'claude-opus-5': { output_tokens: 3 }, 'gpt-5.1-codex': { output_tokens: 2 } },
    '2026-09-01': { 'claude-opus-5': { input_tokens: 1 } },
  };
  const tablePairs = [...U.usageTableHtml(fx).matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td>/g)]
    .map((m) => m[1] + '|' + m[2]);
  const histPairs = [...U.usageHistoryHtml(fx).matchAll(/<div class="uh-d">([^<]+)<\/div><div class="uh-m">([^<]+)<\/div>/g)]
    .map((m) => m[1] + '|' + m[2]);
  assert.equal(histPairs.length, 3, 'the fixture yields 3 day+model rows');
  assert.deepEqual(histPairs.slice().sort(), tablePairs.slice().sort(),
    'both functions produce the same (day,model) row set from the same byDay');
  // Both are newest-first, so the first row of each is the 09-02 pair, not 09-01.
  assert.ok(histPairs[0].startsWith('2026-09-02') && tablePairs[0].startsWith('2026-09-02'),
    'both order newest-day-first');
});

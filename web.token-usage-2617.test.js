'use strict';
/**
 * #2617/#2840: the graphical Token Usage value view.
 *
 * 🔑 THIS RUNS THE REAL RENDER FUNCTIONS against a fixed /api/usage fixture and
 * checks the numbers on the screen against values computed BY HAND here, not by
 * re-running the product's own formula. That is the #2620 lesson: a check whose
 * expected values are hardcoded from the same head that wrote the code proves
 * nothing; a wrong sum or a wrong dollar is what a blind reviewer catches. Here
 * the fixture goes in, the hand-computed number is asserted out, and the real
 * lifted code has to produce it.
 *
 * #2840 (Josh's 2026-09-14 ruling): the screen is now the approved
 * /design/token-value value view -- a hero (blended total = human-cost equation +
 * three stats), four per-class daily mini-charts, a per-model table + donut, the
 * usage-history list, and the METR footnote. The blended total is Josh-ruled
 * CORRECT (full engineering value), superseding the earlier #2617 never-sum
 * position for the headline. The prior full-number cards / combined chart /
 * output-only money box were replaced (documented on #2840). The browser-check
 * render-token-usage-2617.js covers the LIVE rendered page; this pins the SOURCE
 * compute.
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

/* The real render functions, lifted out of the shipped page with their callees +
   the display constants they use, so they actually run (a lifted function's own
   callees have to come with it -- test-support/page.js). */
function bundle() {
  // eslint-disable-next-line no-new-func
  return new Function(
    page.liftConst(SCRIPT, 'USAGE_CLASS_COLORS') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_VALUE_TOKENS_PER_HOUR') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_VALUE_BLENDED_RATE') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_VALUE_HOURS_PER_YEAR') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_MODEL_COLORS') + '\n'
    + page.liftConst(SCRIPT, 'USAGE_MODEL_PRICES') + '\n'
    + lift('esc') + '\n'
    + lift('usageNum') + '\n'
    + lift('usageAbbr') + '\n'
    + lift('usageBigTokens') + '\n'
    + lift('usageUsd') + '\n'
    + lift('usageUsdTileSub1M') + '\n'
    + lift('usageRowValue') + '\n'
    + lift('usageTotals') + '\n'
    + lift('usageGrandTotal') + '\n'
    + lift('usageRowTokenTotal') + '\n'
    + lift('usageDailySeries') + '\n'
    + lift('usageHeroDigits') + '\n'
    + lift('usageHeroHtml') + '\n'
    + lift('usageByModel') + '\n'
    + lift('usageModelTableHtml') + '\n'
    + lift('usageDonutSvg') + '\n'
    + lift('usageCharts4Html') + '\n'
    + lift('usageModelPrice') + '\n'
    + lift('usageApiCost') + '\n'
    + lift('usageHistoryHtml') + '\n'
    + 'return { usageTotals, usageGrandTotal, usageRowTokenTotal, usageDailySeries, usageNum, usageAbbr, usageBigTokens, usageUsd, usageUsdTileSub1M, usageRowValue, '
    + 'usageHeroHtml, usageByModel, usageModelTableHtml, usageDonutSvg, usageCharts4Html, '
    + 'usageModelPrice, usageApiCost, usageHistoryHtml, USAGE_CLASS_COLORS, USAGE_MODEL_COLORS, USAGE_MODEL_PRICES };'
  )();
}
const U = bundle();

/* Two days, one model (claude-opus-4-8). Chosen so cache-read towers over the
   other three (as on a real machine) and each class sums to a distinct number. */
const FIXTURE = {
  '2026-09-01': { 'claude-opus-4-8': { input_tokens: 2140559, output_tokens: 760331, cache_creation_input_tokens: 9401220, cache_read_input_tokens: 1023445990 } },
  '2026-08-31': { 'claude-opus-4-8': { input_tokens: 2010445, output_tokens: 701558, cache_creation_input_tokens: 8702558, cache_read_input_tokens: 940558112 } },
};
// Hand-computed, independent of the product formula:
//   input  = 2,140,559 + 2,010,445 = 4,151,004
//   output =   760,331 +   701,558 = 1,461,889
//   written= 9,401,220 + 8,702,558 = 18,103,778
//   read   =1,023,445,990+940,558,112=1,964,004,102
//   blended total = 4,151,004+1,461,889+18,103,778+1,964,004,102 = 1,987,720,773
const EXPECT = { input: 4151004, output: 1461889, cacheWritten: 18103778, cacheRead: 1964004102, total: 1987720773 };
const fmt = (n) => Number(n).toLocaleString();

test('#2617: usageTotals sums each class separately (the four are never fused in the data)', () => {
  const t = U.usageTotals(FIXTURE);
  assert.equal(t.input, EXPECT.input, 'input total');
  assert.equal(t.output, EXPECT.output, 'output total');
  assert.equal(t.cacheWritten, EXPECT.cacheWritten, 'cache-written total');
  assert.equal(t.cacheRead, EXPECT.cacheRead, 'cache-read total');
  // The four classes are returned as four fields; the blended headline is computed
  // in the hero from these, not baked into the totals object.
  assert.ok(!('total' in t) && !('all' in t), 'usageTotals itself produces no blended field');
});

test('#2840: the hero shows the blended total = human-cost equation + three stats (verbatim design calc)', () => {
  const html = U.usageHeroHtml(U.usageTotals(FIXTURE), Object.keys(FIXTURE).length, 1152);
  // total 1,987,720,773 -> 2.0B ; hours = total/1e5 = 19,877.2 -> 20K ;
  // value = hours*90 = 1,788,948.7 -> $1.8M ; years = hours/2080 = 9.556 -> round/10*10 = 10.
  assert.match(html, /class="tv-hero"/, 'the hero container is present');
  assert.ok(html.includes('>2.0B<'), 'the blended total headline (2.0B) is shown');
  assert.ok(html.includes('Total Tokens Used'), 'labeled Total Tokens Used');
  assert.ok(html.includes('>$1.8M<'), 'the human-cost value ($1.8M = total/1e5*$90) is shown');
  assert.ok(html.includes('Approximate Human Cost'), 'labeled Approximate Human Cost');
  assert.ok(html.includes('>20K<'), 'Human Work Hours (20K)');
  assert.ok(html.includes('>10<'), 'Years of Human Work (10)');
  // #3137 (Josh, 6.68): the stat TILES abbreviate the thousands band ($1,152 -> $1K) so a
  // wide figure does not clip the fixed-width tile. The per-row table Value keeps the exact
  // figure (usageUsd, #2840) -- that assertion is unchanged below.
  assert.ok(html.includes('>$1.2K<') && html.includes('Equivalent Token API Cost'), 'the API-cost tile abbreviates the thousands figure to one decimal (#3137, $1,152 -> $1.2K, not the lossy $1K)');
  // active-days: 2 days -> two digit boxes "2"? no -- 2 days is one digit "2".
  assert.match(html, /class="tv-days"[\s\S]*Active Days on Kosmos/, 'active-days eyebrow present');
});

test('#2840: the hero API-cost stat shows a dash (not $0) when no cost is available', () => {
  const html = U.usageHeroHtml(U.usageTotals(FIXTURE), 2, null);
  // the third stat box is the API cost; null -> "-" not "$0".
  assert.match(html, /Equivalent Token API Cost/, 'the box is present');
  assert.ok(!html.includes('$0<') && !html.includes('>$0<'), 'no false $0 for a missing price');
});

test('#2840/#3137: the hero value degrades gracefully below $1M (a light machine shows $45K, not $0.0M and not clipped full digits)', () => {
  // total 50M -> value = 50e6 / 1e5 * 90 = $45,000. The verbatim "$X.XM" format would
  // show that as "$0.0M"; #2840 routed sub-$1M through usageUsd to avoid that. #3137 then
  // abbreviates the thousands band IN THE TILE ($45,000 -> $45K) because the full digits
  // clip the fixed-width tile -- magnitude preserved, so #2840's "no misleading $0.0M"
  // guard still holds (the exact figure lives in the per-row table Value, unchanged).
  const html = U.usageHeroHtml({ input: 0, output: 0, cacheWritten: 0, cacheRead: 50000000 }, 3, 12);
  assert.ok(html.includes('>$45K<'), 'abbreviates the thousands human-cost to $45K in the tile (#3137)');
  assert.ok(!html.includes('$0.0M'), 'no misleading $0.0M for a real sub-$1M value');
  // demo scale is unchanged: the approved $X.XM format still applies at >= $1M.
  assert.ok(U.usageHeroHtml(U.usageTotals(FIXTURE), 2, 1152).includes('$1.8M'), 'demo-scale value keeps the approved $X.XM format');
});

test('#3137: usageUsdTileSub1M abbreviates the tile thousands band, rolls over at $1000K, and keeps sub-$1k exact', () => {
  assert.equal(U.usageUsdTileSub1M(1152), '$1.2K', 'small thousands keep one decimal (not the lossy $1K)');
  assert.equal(U.usageUsdTileSub1M(45000), '$45K', 'a round thousands drops the trailing .0');
  assert.equal(U.usageUsdTileSub1M(176332), '$176.3K', 'the reported $176,332 abbreviates to $176.3K');
  assert.equal(U.usageUsdTileSub1M(999999), '$1.0M', 'the top of the K band rolls to $1.0M, never the wider wrong-magnitude $1000K');
  assert.equal(U.usageUsdTileSub1M(999000), '$999K', 'just below the rollover stays in the K band');
  assert.equal(U.usageUsdTileSub1M(500), '$500', 'below $1k defers to usageUsd (exact)');
  assert.equal(U.usageUsdTileSub1M(0), '$0.00', 'zero defers to usageUsd, no misleading abbreviation');
});

test('#2840: usageByModel aggregates per-model blended totals, sorted most-first', () => {
  const fx = {
    'd2': { 'claude-opus-5': { output_tokens: 200, cache_read_input_tokens: 800 }, 'claude-sonnet-5': { output_tokens: 40 } },
    'd1': { 'claude-opus-5': { input_tokens: 4 } },
  };
  const m = U.usageByModel(fx);
  assert.equal(m.length, 2, 'two models');
  assert.equal(m[0].name, 'claude-opus-5', 'sorted desc: opus first');
  assert.equal(m[0].tok, 1004, 'opus blended total summed across days (200+800+4)');
  assert.equal(m[1].tok, 40, 'sonnet total');
});

test('#2840: the per-model table renders a row per model with a share bar + %', () => {
  const models = U.usageByModel(FIXTURE);
  const html = U.usageModelTableHtml(models, EXPECT.total);
  assert.match(html, /class="tv-mrow head"/, 'a header row is present');
  assert.match(html, />Model<[\s\S]*>Share<[\s\S]*>Tokens<[\s\S]*>% total</, 'the columns are Model/Share/Tokens/% total');
  assert.ok(html.includes('claude-opus-4-8'), 'the model is listed');
  assert.ok(html.includes('100.0%'), 'the sole model is 100% of the total');
  // hostile model name escaped (innerHTML site)
  const hostile = U.usageModelTableHtml([{ name: '<img src=x onerror=1>', tok: 5 }], 5);
  assert.ok(!hostile.includes('<img src=x') && hostile.includes('&lt;img'), 'a hostile model name is escaped');
});

test('#2840: the donut renders a slice per model (top 6 + Other) with a blended-total center', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ name: 'M' + i, tok: (8 - i) * 1000 }));
  const svg = U.usageDonutSvg(many, 36000);
  assert.match(svg, /token share by model/i, 'labeled as token share by model');
  assert.equal((svg.match(/<path /g) || []).length, 7, 'top 6 slices + one Other slice = 7 arcs');
  assert.ok(svg.includes('>Other<'), 'the tail is bucketed into Other');
  assert.ok(svg.includes('total tokens'), 'the center names the total');
  assert.equal(U.usageDonutSvg([], 0), '', 'no models -> empty');
});

test('#2840: a single-model donut draws a full-circle ring, not a degenerate arc (invisible-donut regression)', () => {
  const one = [{ name: 'claude-opus-4-8', tok: 1987720773 }];
  const svg = U.usageDonutSvg(one, 1987720773);
  // A 100% slice drawn as one 360-degree <path> arc has its endpoint equal to its
  // start, which SVG drops -- the ring would render invisibly. The fix draws a <circle>.
  assert.match(svg, /<circle /, 'the lone full slice is drawn as a circle ring');
  assert.equal((svg.match(/<path /g) || []).length, 0, 'no degenerate 360-degree path arc for a lone slice');
  assert.ok(svg.includes('total tokens'), 'the center still names the total');
});

test('#2840: a two-model donut where one model has zero tokens is safe (no NaN, the nonzero model fills the ring)', () => {
  const two = [{ name: 'claude-opus-4-8', tok: 100 }, { name: 'gpt-5.1', tok: 0 }];
  const svg = U.usageDonutSvg(two, 100);
  // The 100-token model is 100% of the total, so it hits the full-circle branch (a <circle>);
  // the zero-token model draws a harmless minimal sliver. No NaN must reach the output.
  assert.ok(!/NaN/.test(svg), 'no NaN in the rendered donut');
  assert.match(svg, /<circle /, 'the sole nonzero model fills the ring as a circle');
  assert.ok(svg.includes('total tokens'), 'the center still names the total');
});

test('#2840: a multi-slice donut draws real arcs with the correct large-arc flag per slice', () => {
  const two = [{ name: 'A', tok: 60 }, { name: 'B', tok: 40 }];
  const svg = U.usageDonutSvg(two, 100);
  assert.ok(!/NaN/.test(svg), 'no NaN in the arc coordinates');
  assert.equal((svg.match(/<path /g) || []).length, 2, 'two nonzero slices -> two arc paths (no full-ring circle)');
  assert.equal((svg.match(/<circle /g) || []).length, 0, 'neither slice is a full ring');
  // path form: "A 80 80 0 <big> 1" -- the >50% slice sets the large-arc flag, the <50% does not.
  assert.match(svg, /A 80 80 0 1 1 /, 'the >50% slice uses the large-arc flag (1)');
  assert.match(svg, /A 80 80 0 0 1 /, 'the <50% slice uses the small-arc flag (0)');
});

test('#2840: usageGrandTotal is the single blended-total source (hero, charts4, table, donut agree)', () => {
  const totals = U.usageTotals(FIXTURE);
  assert.equal(U.usageGrandTotal(totals), EXPECT.total, 'grand total = sum of the four classes');
  // The per-model sum derives the same blended total from the same byDay data, so the
  // hero headline and the per-model table/donut cannot silently disagree (Convention #5).
  const byModelSum = U.usageByModel(FIXTURE).reduce((a, m) => a + m.tok, 0);
  assert.equal(byModelSum, U.usageGrandTotal(totals), 'sum(usageByModel) === usageGrandTotal(usageTotals)');
});

test('#2840: the hero and donut center render the blended total identically at showcase scale (one formatter)', () => {
  assert.equal(U.usageBigTokens(150e9), '150.0B', 'the shared big-token format keeps one decimal in the B band');
  assert.equal(U.usageBigTokens(1987720773), '2.0B', 'and below 10B (fixture scale) too');
  // both surfaces route through usageBigTokens, so one number cannot read two ways.
  const hero = U.usageHeroHtml({ input: 0, output: 0, cacheWritten: 0, cacheRead: 150000000000 }, 30, 100000);
  const donut = U.usageDonutSvg([{ name: 'm', tok: 150000000000 }], 150000000000);
  assert.ok(hero.includes('150.0B'), 'hero shows 150.0B');
  assert.ok(donut.includes('150.0B'), 'donut center shows 150.0B, not 150B');
});

test('#2840: charts4 renders four per-class daily mini-charts', () => {
  const series = U.usageDailySeries(FIXTURE);
  const html = U.usageCharts4Html(series, U.usageTotals(FIXTURE), EXPECT.total);
  assert.match(html, /class="tv-charts4"/, 'the charts4 grid is present');
  assert.equal((html.match(/class="tv-mini"/g) || []).length, 4, 'four mini-charts');
  for (const name of ['Cache reads', 'Cache writes', 'Output', 'Input']) {
    assert.ok(html.includes(name), name + ' chart present');
  }
  assert.ok(!/NaN|undefined/.test(html), 'no NaN/undefined in the paths');
  assert.equal(U.usageCharts4Html([], {}, 1), '', 'empty series -> empty');
});

test('#2840: usageApiCost sums tokens x published price, excludes+flags unpriced models', () => {
  // opus-5 published: in 5 / out 25 / cw 6.25 / cr 0.50 ($/Mtok).
  // 1M of each class -> (5+25+6.25+0.50) = $36.75
  const r1 = U.usageApiCost({ d: { 'claude-opus-5': { input_tokens: 1e6, output_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 } } });
  assert.ok(Math.abs(r1.cost - 36.75) < 1e-9, 'opus-5 1M-each -> $36.75');
  assert.deepEqual(r1.unpriced, [], 'nothing unpriced');
  // gpt-5.1-codex has no published price: excluded + flagged, never guessed.
  const r2 = U.usageApiCost({ d: { 'claude-opus-5': { output_tokens: 1e6 }, 'gpt-5.1-codex': { output_tokens: 1e9 } } });
  assert.ok(Math.abs(r2.cost - 25) < 1e-9, 'codex excluded; opus-5 1M output -> $25');
  assert.deepEqual(r2.unpriced, ['gpt-5.1-codex'], 'codex named as unpriced');
  // haiku carries a -YYYYMMDD stamp; usageModelPrice strips it to match.
  const r3 = U.usageApiCost({ d: { 'claude-haiku-4-5-20251001': { output_tokens: 1e6 } } });
  assert.ok(Math.abs(r3.cost - 5) < 1e-9, 'haiku (dated id) -> $5 via the date-strip');
  // nothing priceable -> cost null, so the hero shows a dash not a false $0.
  const r4 = U.usageApiCost({ d: { 'gpt-5.1-codex': { output_tokens: 1e6 } } });
  assert.equal(r4.cost, null, 'all-unpriced -> cost null');
});

test('#2840: usageModelPrice resolves exact ids and strips a date suffix', () => {
  assert.ok(U.usageModelPrice('claude-opus-5'), 'exact id resolves');
  assert.ok(U.usageModelPrice('claude-haiku-4-5-20251001'), 'dated id resolves via strip');
  assert.equal(U.usageModelPrice('gpt-5.1-codex'), null, 'unpublished model -> null (flagged upstream, never guessed)');
  assert.equal(U.usageModelPrice('totally-unknown'), null, 'unknown model -> null');
});

test('#3460: claude-opus-5-5 is priced (in the cost figure), not unpriced', () => {
  // opus-5-5 published: in 4 / out 20 / cr 0.20 (cr is 0.05x input, a real break from
  // the 0.1x other tiers use); cw 5.00 is the standard 1.25x input write, as every row.
  const p = U.usageModelPrice('claude-opus-5-5');
  assert.ok(p, 'claude-opus-5-5 resolves to a published price row');
  assert.deepEqual(p, { in: 4, out: 20, cw: 5.00, cr: 0.20 }, 'published rates');
  // 1M of each class -> (4 + 20 + 5.00 + 0.20) = $29.20; and it is NOT flagged unpriced.
  const r = U.usageApiCost({ d: { 'claude-opus-5-5': { input_tokens: 1e6, output_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 } } });
  assert.ok(Math.abs(r.cost - 29.20) < 1e-9, 'opus-5-5 1M-each -> $29.20');
  assert.deepEqual(r.unpriced, [], 'opus-5-5 is not in unpriced');
  // a dated variant resolves via the same date-strip path.
  assert.ok(U.usageModelPrice('claude-opus-5-5-20260401'), 'dated opus-5-5 id resolves via strip');
});

/* #2840: the scrollable usage-history list. FIXTURE per-row 4-class totals:
   2026-09-01: 2,140,559 + 760,331 + 9,401,220 + 1,023,445,990 = 1,035,748,100
   2026-08-31: 2,010,445 + 701,558 + 8,702,558 +   940,558,112 =   951,972,673 */
test('#2840: usageHistoryHtml renders a row per day/model, newest first, with the 4-class total', () => {
  const html = U.usageHistoryHtml(FIXTURE);
  assert.match(html, /class="uhrow uhhead"/, 'the sticky header row is present');
  assert.match(html, />Day<[\s\S]*>Model<[\s\S]*>Total tokens<[\s\S]*>Value</, 'the columns are Day/Model/Total tokens/Value');
  assert.ok(html.indexOf('2026-09-01') < html.indexOf('2026-08-31'), 'rows are newest-first');
  assert.ok(html.includes('title="' + fmt(1035748100) + '"'), 'the 09-01 row carries its full total in title');
  assert.ok(html.includes('>1.0B<'), 'the 09-01 row shows the abbreviated total');
});

test('#2840: the Value column is the blended per-row dollar figure (Josh ruled: keep the blend)', () => {
  const html = U.usageHistoryHtml(FIXTURE);
  //   Value = usd( rowTotal / 100,000 * 90 )   (the approved /design/token-value math)
  //   2026-09-01: 1,035,748,100 / 1e5 * 90 = 932,173.29 -> "$932,173"
  //   2026-08-31:   951,972,673 / 1e5 * 90 = 856,775.41 -> "$856,775"
  assert.ok(html.includes('$' + fmt(932173)), 'the 09-01 row shows its blended dollar Value');
  assert.ok(html.includes('$' + fmt(856775)), 'the 08-31 row shows its blended dollar Value');
});

test('#2840: usageRowValue + usageUsd match the approved design formula and format bands', () => {
  assert.equal(U.usageRowValue(1035748100), '$' + fmt(932173), 'billion-scale row -> thousands-separated $');
  assert.equal(U.usageRowValue(951972673), '$' + fmt(856775), 'the older row matches its hand-computed value');
  assert.equal(U.usageUsd(2.5e9), '$2.50B', 'billions keep two decimals with a B');
  assert.equal(U.usageUsd(3.4e6), '$3M', 'millions round to a whole M');
  assert.equal(U.usageUsd(932173.29), '$' + fmt(932173), 'the thousands band is separated and rounded');
  assert.equal(U.usageUsd(50), '$50', 'tens..hundreds print as a whole dollar');
  assert.equal(U.usageUsd(5.5), '$5.50', 'under $10 keeps cents');
  assert.equal(U.usageUsd(150005932754 / 1e5 * 90), '$135M', 'the blended grand total is the design ~$135M');
});

test('#2840: usageAbbr abbreviates B/M/K and passes small numbers through', () => {
  assert.equal(U.usageAbbr(21463000000), '21B', 'ten-billions round to a whole B');
  assert.equal(U.usageAbbr(1964004102), '2.0B', 'single-digit billions keep one decimal');
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

test('#2840: the section markup carries the approved value-view containers, and fetches 14 days', () => {
  assert.match(CODE, /id="usage-hero"/, 'the hero container is in the page');
  assert.match(CODE, /id="usage-charts4"/, 'the four-charts container is in the page');
  assert.match(CODE, /id="usage-wtr"/, 'the per-model table + donut wrap is in the page');
  assert.match(CODE, /id="usage-mtable"/, 'the model table container is in the page');
  assert.match(CODE, /id="usage-donut"/, 'the donut container is in the page');
  assert.match(CODE, /id="usage-history"/, 'the usage-history list is in the page');
  // the replaced elements are gone (Josh's exact-to-spec ruling; documented on #2840).
  assert.doesNotMatch(CODE, /id="usage-cards"/, 'the old full-number cards container is removed');
  assert.doesNotMatch(CODE, /id="usage-worth"/, 'the old output-only money box is removed');
  assert.match(SCRIPT, /fetch\('\/api\/usage\?days=14'\)/, 'the render asks for 14 days');
});

/**
 * #2617: the Token Usage page is the graphical value view, not a plain white box.
 *
 * Josh's #1 demo win. The page (Settings > Token Usage) regressed to a bare table;
 * Mona's design restores four class cards, a shared-axis trend chart, a money box
 * derived from output, and keeps the per-model/day table. This RUNS the real page
 * against a served board with /api/usage MOCKED to a fixed two-day response, so the
 * rendered facts are deterministic regardless of what transcripts the board holds.
 *
 * It asserts the DETERMINISTIC, headless-safe structure: the four cards with their
 * class labels (cache-read gold-accented), the chart svg with one polyline per
 * class on a shared axis, the money box naming OUTPUT as its basis, and the table.
 * The pixel match to Mona's mockup (spacing, the swipe of the towering cache-read
 * line, dark-theme feel) belongs to the headed pass; this pins that the pieces are
 * present and wired to the data, which is what a "plain white box" regression loses.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-token-usage-2617.js http://127.0.0.1:PORT
 */
const { chromium } = require('playwright');
const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); };

// A fixed /api/usage response: two days, one model, cache-read towering over the
// other three (as on a real machine). Hand-computed totals the render must show:
//   input 4,151,004  output 1,461,889  cache-written 18,103,778  cache-read 1,964,004,102
//   $ from output only = round(1,461,889 / 750,000 * 8 * 100) = 1,559
const USAGE = {
  byDay: {
    '2026-09-01': { 'claude-opus-4-8': { input_tokens: 2140559, output_tokens: 760331, cache_creation_input_tokens: 9401220, cache_read_input_tokens: 1023445990 } },
    '2026-08-31': { 'claude-opus-4-8': { input_tokens: 2010445, output_tokens: 701558, cache_creation_input_tokens: 8702558, cache_read_input_tokens: 940558112 } },
  },
  rootsRead: ['/tmp/fixture'],
};

async function openUsage(page) {
  // Mock BEFORE the section paints, so the fetch it fires hits the fixture.
  await page.route('**/api/usage*', (r) => r.fulfill({ json: USAGE }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click('.tab[data-tab="settings"]');
  await page.click('#s-nav button[data-go="usage"]');
  await page.waitForSelector('#s-sec-usage:not([hidden])');
  await page.waitForSelector('#usage-cards .usage-cls');
  await page.waitForSelector('#usage-history .uhrow'); // #2840: the usage-history list has painted
}

function readUsage(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('#usage-cards .usage-cls')];
    const label = (el) => (el.querySelector('.usage-k') || {}).textContent || '';
    const readCard = cards.find((c) => c.classList.contains('read'));
    const chartSvg = document.querySelector('#usage-chart svg');
    const money = document.querySelector('#usage-worth .usage-money');
    const table = document.querySelector('#usage-table table.usage-table');
    return {
      cardCount: cards.length,
      labels: cards.map(label),
      readLabel: readCard ? label(readCard) : null,
      chartWrapHidden: (() => { const w = document.getElementById('usage-chartwrap'); return w ? w.hidden : null; })(),
      hasSvg: !!chartSvg,
      polylines: chartSvg ? chartSvg.querySelectorAll('polyline').length : 0,
      moneyText: money ? (money.textContent || '') : null,
      moneyNamesOutput: !!(money && money.querySelector('.usage-money-basis b') && /output/i.test(money.querySelector('.usage-money-basis b').textContent || '')),
      cacheReadShown: cards.some((c) => /1,964,004,102/.test(c.textContent || '')),
      legendSwatches: document.querySelectorAll('#usage-legend .usage-lg').length,
      tableRows: table ? table.querySelectorAll('tbody tr').length : 0,
      // #2840: the scrollable usage-history list.
      historyRows: document.querySelectorAll('#usage-history .uhrow:not(.uhhead)').length,
      historyHeaders: [...document.querySelectorAll('#usage-history .uhrow.uhhead > div')].map((d) => (d.textContent || '').trim()),
      historyValueLive: [...document.querySelectorAll('#usage-history .uhrow:not(.uhhead) .uh-n:last-child')].every((c) => /^\$[\d.,]+[BMK]?$/.test((c.textContent || '').trim())),
      historyHasDollar: /\$/.test((document.getElementById('usage-history') || {}).textContent || ''),
      historyHasPending: /pending/.test((document.getElementById('usage-history') || {}).textContent || ''),
      historyScrolls: (() => { const b = document.getElementById('usage-history'); return b ? getComputedStyle(b).overflowY === 'auto' : null; })(),
      historyKeyboardReachable: (() => { const b = document.getElementById('usage-history'); return b ? b.getAttribute('tabindex') === '0' : null; })(),
      // #2840: the METR "how we estimate the value" method footnote for the blended
      // Value column. Quiet footnote, not a callout: assert the specific element, its
      // copy, the exact approved link, its quiet styling (top hairline, NO left rule,
      // no callout background), and its placement between the history list and the table.
      method: (() => {
        const m = document.querySelector('.usage-method');
        if (!m) return null;
        const cs = getComputedStyle(m);
        const link = m.querySelector('a');
        const hist = document.querySelector('.usage-hist');
        const meas = document.querySelector('.usage-meas');
        const moneyBox = document.querySelector('#usage-worth');
        const DP_FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
        return {
          text: (m.textContent || '').trim(),
          href: link ? link.getAttribute('href') : null,
          linkText: link ? (link.textContent || '').trim() : null,
          borderTopW: parseFloat(cs.borderTopWidth) || 0,
          borderLeftW: parseFloat(cs.borderLeftWidth) || 0,
          maxRadius: Math.max(
            parseFloat(cs.borderTopLeftRadius) || 0, parseFloat(cs.borderTopRightRadius) || 0,
            parseFloat(cs.borderBottomLeftRadius) || 0, parseFloat(cs.borderBottomRightRadius) || 0),
          bg: cs.backgroundColor,
          boxShadow: cs.boxShadow,
          afterHist: hist ? !!(hist.compareDocumentPosition(m) & DP_FOLLOWING) : null,
          beforeMeas: meas ? !!(m.compareDocumentPosition(meas) & DP_FOLLOWING) : null,
          beforeMoney: moneyBox ? !!(m.compareDocumentPosition(moneyBox) & DP_FOLLOWING) : null,
        };
      })(),
    };
  });
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: !HEADED }); }
  catch (e) { console.error('FAIL  render-token-usage-2617: could not start a browser (' + ((e && e.message) || e) + ')'); process.exit(1); }
  try {
    console.log('\n#2617 -- the graphical Token Usage value view');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await openUsage(p);
    const v = await readUsage(p);
    ok(v.cardCount === 4, `four class cards render (got ${v.cardCount})`);
    ok(['Input', 'Output', 'Cache written', 'Cache read'].every((l) => v.labels.includes(l)),
      `the four card labels are Input/Output/Cache written/Cache read (got ${JSON.stringify(v.labels)})`);
    ok(v.readLabel === 'Cache read', `the gold "read" card is Cache read (got ${JSON.stringify(v.readLabel)})`);
    ok(v.cacheReadShown, 'the full, unabbreviated cache-read number is on screen (1,964,004,102 -- Josh: show it in full)');
    ok(v.chartWrapHidden === false, 'the chart wrap is shown (not hidden) when there is a multi-day trend');
    ok(v.hasSvg, 'the trend chart svg renders');
    ok(v.polylines === 4, `the chart has one polyline per class on a shared axis (got ${v.polylines})`);
    ok(v.legendSwatches === 4, `the legend renders one swatch per class (got ${v.legendSwatches})`);
    ok(v.moneyNamesOutput, 'the money box names OUTPUT as its basis (never a blended total)');
    ok(/\$/.test(v.moneyText || ''), 'the money box shows a dollar figure');
    ok(v.tableRows >= 1, `the per-model/day table stays as the measurement (got ${v.tableRows} rows)`);
    // #2840: the scrollable usage-history list, wired to the same /api/usage.
    ok(v.historyRows >= 1, `the usage-history list renders a row per day/model (got ${v.historyRows})`);
    ok(['Day', 'Model', 'Total tokens', 'Value'].every((h) => v.historyHeaders.includes(h)),
      `the usage-history columns are Day/Model/Total tokens/Value (got ${JSON.stringify(v.historyHeaders)})`);
    ok(v.historyScrolls === true, 'the usage-history box is a fixed-height scroller (overflow-y:auto)');
    ok(v.historyKeyboardReachable === true, 'the scroll region is keyboard-reachable (tabindex=0, WCAG AA)');
    // #2840: Josh ruled to KEEP the blended Value (the design's ~$135M headline), so
    // every Value cell now shows a live blended dollar figure and "pending" is gone.
    ok(v.historyValueLive, 'every usage-history Value cell shows a live blended $ figure');
    ok(v.historyHasDollar === true, 'the usage-history list shows dollar Values');
    ok(v.historyHasPending === false, 'the retired "pending" stub is gone from the Value column');
    // #2840: the METR "how we estimate the value" method footnote for the blended Value column.
    ok(v.method, 'the METR "how we estimate the value" method footnote renders (.usage-method)');
    ok(v.method && /^how we estimate the value/i.test(v.method.text), 'the footnote leads with "How we estimate the value"');
    ok(v.method && /blended knowledge-work rate/i.test(v.method.text), "the footnote names the blended knowledge-work rate (the Value column's basis, not output)");
    ok(v.method && v.method.href === 'https://metr.org/time-horizons/', `the footnote links the exact approved METR URL (got ${v.method && v.method.href})`);
    ok(v.method && /metr/i.test(v.method.linkText || ''), `the link text names METR (meaningful, not "click here" or dropped; got ${JSON.stringify(v.method && v.method.linkText)})`);
    ok(v.method && v.method.borderTopW === 1, `the footnote has a quiet 1px top hairline, not a thick border (got ${v.method && v.method.borderTopW})`);
    ok(v.method && v.method.borderLeftW === 0, 'the footnote has NO left color-rule (a quiet footnote, not a styled callout)');
    ok(v.method && v.method.maxRadius === 0, `the footnote has no rounded corners, so it is not a boxed callout (got ${v.method && v.method.maxRadius})`);
    ok(v.method && (v.method.bg === 'rgba(0, 0, 0, 0)' || v.method.bg === 'transparent'), 'the footnote has no callout background (quiet, muted)');
    ok(v.method && v.method.boxShadow === 'none', `the footnote has no box-shadow, so an inset box or shadow left-rule callout cannot pass unseen (got ${v.method && v.method.boxShadow})`);
    ok(v.method && v.method.afterHist === true, 'the footnote sits under the usage-history list (beside the Value column it explains)');
    ok(v.method && v.method.beforeMoney === true, 'the footnote sits directly under the history list, above the output money box (so it reads as the Value column\'s note, not the money box\'s)');
    ok(v.method && v.method.beforeMeas === true, 'the footnote sits above "The measurement it comes from" table');
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-token-usage-2617: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-token-usage-2617 threw: ' + ((e && e.message) || e)); process.exit(1); });

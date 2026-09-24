/**
 * #2617/#2840: the Token Usage page is the approved graphical value view.
 *
 * Josh's #1 demo win. The page (Settings > Token Usage) is the approved
 * /design/token-value value view (Josh's 2026-09-14 exact-to-spec ruling): a hero
 * (the blended total = human-cost equation + three stats), four per-class daily
 * mini-charts, a per-model table + token-share donut, the usage-history list, and
 * the METR method footnote. The blended total is Josh-ruled CORRECT (full
 * engineering value), replacing the earlier full-number cards / combined chart /
 * output-only money box (documented on #2840). This RUNS the real page against a
 * served board with /api/usage MOCKED to a fixed two-day response, so the rendered
 * facts are deterministic regardless of what transcripts the board holds.
 *
 * It asserts the DETERMINISTIC, headless-safe structure + numbers; the pixel match
 * to the mockup belongs to the headed pass.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 \
 *     node docs/browser-checks/render-token-usage-2617.js http://127.0.0.1:PORT
 */
const { chromium } = require('playwright');
const BASE = process.argv[2] || process.env.KOSMOS_URL || 'http://127.0.0.1:4399';
const HEADED = process.env.HEADED !== '0';

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); };

// A fixed /api/usage response: two days, one model (claude-opus-4-8), cache-read
// towering over the other three. Hand-computed, independent of the product code:
//   input 4,151,004  output 1,461,889  cache-written 18,103,778  cache-read 1,964,004,102
//   blended total = 1,987,720,773  ->  hero "2.0B"
//   value = total/100000*90 = 1,788,948.7  ->  "$1.8M"
//   hours = total/100000 = 19,877.2  ->  "20K"    years = hours/2080 = 9.556  ->  "10"
//   equivalent API cost (opus-4-8: in 5 / out 25 / cw 6.25 / cr 0.50 $/Mtok):
//     4,151,004*5 + 1,461,889*25 + 18,103,778*6.25 + 1,964,004,102*0.50 = 1,152,452,908.5
//     /1e6 = 1,152.45  ->  "$1,152"
const USAGE = {
  byDay: {
    '2026-09-01': { 'claude-opus-4-8': { input_tokens: 2140559, output_tokens: 760331, cache_creation_input_tokens: 9401220, cache_read_input_tokens: 1023445990 } },
    '2026-08-31': { 'claude-opus-4-8': { input_tokens: 2010445, output_tokens: 701558, cache_creation_input_tokens: 8702558, cache_read_input_tokens: 940558112 } },
  },
  rootsRead: ['/tmp/fixture'],
  // #2617: the per-agent split, as /api/usage sends it. Ann towers, Bob is small,
  // some work was the person's own, and 2,000 tokens could not be matched.
  byAgent: {
    agents: [
      { name: 'ann', shown: 'Ann', input_tokens: 3000000, output_tokens: 1000000, cache_creation_input_tokens: 12000000, cache_read_input_tokens: 1500000000, rows: 10 },
      { name: 'bob', shown: 'Bob', input_tokens: 500000, output_tokens: 200000, cache_creation_input_tokens: 2000000, cache_read_input_tokens: 150000000, rows: 3 },
    ],
    elsewhere: { input_tokens: 651004, output_tokens: 261889, cache_creation_input_tokens: 4103778, cache_read_input_tokens: 314004102, rows: 2 },
    shared: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 0 },
    unattributed: { input_tokens: 0, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 1 },
    overcount: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, rows: 0 },
    rosterRead: true,
  },
};

async function openUsage(page) {
  // Mock BEFORE the section paints, so the fetch it fires hits the fixture.
  await page.route('**/api/usage*', (r) => r.fulfill({ json: USAGE }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => showTab('settings'));
  await page.click('#s-nav button[data-go="usage"]');
  await page.waitForSelector('#s-sec-usage:not([hidden])');
  await page.waitForSelector('#usage-hero .tv-hero');       // #2840: the hero has painted
  await page.waitForSelector('#usage-history .uhrow');       // the history list has painted
}

function readUsage(page) {
  return page.evaluate(() => {
    const txt = (sel) => { const el = document.querySelector(sel); return el ? (el.textContent || '') : null; };
    const hero = document.querySelector('#usage-hero .tv-hero');
    const heroText = hero ? (hero.textContent || '') : '';
    return {
      // #2840 hero: the blended total = human-cost equation + three stats.
      hasHero: !!hero,
      heroTokens: heroText.includes('2.0B'),
      heroTokensLabel: heroText.includes('Total Tokens Used'),
      heroValue: heroText.includes('$1.8M'),
      heroValueLabel: heroText.includes('Approximate Human Cost'),
      heroHours: heroText.includes('20K') && heroText.includes('Human Work Hours'),
      heroYears: (() => {
        // Read the digit next to its OWN label, not a bare "10" scanned from the
        // whole hero (which could false-match a 10 inside another figure).
        const box = [...document.querySelectorAll('#usage-hero .tv-sbox')]
          .find((b) => /Years of Human Work/.test(b.textContent || ''));
        const fig = box && box.querySelector('.tv-fig');
        return !!fig && (fig.textContent || '').trim() === '10';
      })(),
      // #3137 (Josh, 6.68): the fixed-width tiles ABBREVIATE the thousands band so a wide
      // figure does not clip. The fixture's API cost 1152 -> "$1.2K" (was the clipping "$1,152").
      heroApi: heroText.includes('$1.2K') && heroText.includes('Equivalent Token API Cost'),
      // #3137: no hero stat TILE clips its figure -- overflow:hidden means a too-wide value
      // is silently cut, so measure the real horizontal fit of every .tv-fig in the hero.
      heroFigsFit: [...document.querySelectorAll('#usage-hero .tv-fig')]
        .every((f) => f.scrollWidth <= f.clientWidth + 1),
      // #3137 NON-VACUOUS fit control: on the real Approximate Human Cost tile, the FULL
      // reported figure "$176,332" overflows the box while the abbreviated "$176.3K" fits.
      // Proves the abbreviation is both necessary (full clips) and sufficient (abbr fits) at
      // the tile's real rendered width, not just that a short fixture value happens to fit.
      tileFitControl: (() => {
        const box = [...document.querySelectorAll('#usage-hero .tv-fbox')]
          .find((b) => /Approximate Human Cost/.test(b.textContent || ''));
        const fig = box && box.querySelector('.tv-fig');
        if (!fig) return null;
        const orig = fig.textContent;
        fig.textContent = '$176,332'; const fullOverflows = fig.scrollWidth > fig.clientWidth + 1;
        fig.textContent = '$176.3K'; const abbrFits = fig.scrollWidth <= fig.clientWidth + 1;
        fig.textContent = orig;
        return { fullOverflows, abbrFits };
      })(),
      heroDays: heroText.includes('Active Days on Kosmos'),
      // #2840 charts4: four per-class daily mini-charts, each with an svg.
      charts4Count: document.querySelectorAll('#usage-charts4 .tv-mini').length,
      charts4Svgs: document.querySelectorAll('#usage-charts4 .tv-mini svg').length,
      charts4Names: [...document.querySelectorAll('#usage-charts4 .tv-mini .tv-nm')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()),
      // #2840 per-model table + donut.
      modelRows: document.querySelectorAll('#usage-mtable .tv-mrow:not(.head)').length,
      modelNamed: /claude-opus-4-8/.test(txt('#usage-mtable') || ''),
      modelPct: /100\.0%/.test(txt('#usage-mtable') || ''),
      donutSvg: !!document.querySelector('#usage-donut svg'),
      // The ring must actually PAINT: a lone 100% slice drawn as one 360-degree arc
      // has coincident endpoints and SVG drops it (the invisible-donut bug). Assert a
      // stroked circle/arc element exists, not merely that the <svg> is present.
      donutRing: (() => {
        const el = document.querySelector('#usage-donut svg circle, #usage-donut svg path');
        if (!el) return false;
        const st = el.getAttribute('stroke'), sw = el.getAttribute('stroke-width');
        return !!st && st !== 'none' && Number(sw) > 0;
      })(),
      donutCenter: /total tokens/i.test(txt('#usage-donut') || ''),
      donutLegend: document.querySelectorAll('#usage-donut .tv-pileg').length,
      // #2840 layout: the value-view must fit the fixed ~544px settings column. The
      // table+donut row keys off a container query so it stacks when the column can't
      // hold both. Measure REAL horizontal overflow, not just structural presence.
      mtableFits: (() => { const el = document.getElementById('usage-mtable'); return el ? el.scrollWidth <= el.clientWidth + 1 : null; })(),
      sectionFits: (() => { const el = document.getElementById('s-sec-usage'); return el ? el.scrollWidth <= el.clientWidth + 2 : null; })(),
      wtrCols: (() => { const el = document.getElementById('usage-wtr'); return el ? (getComputedStyle(el).gridTemplateColumns || '').split(' ').filter(Boolean).length : null; })(),
      secW: (() => { const el = document.getElementById('s-sec-usage'); return el ? el.clientWidth : null; })(),
      // #2617 the per-agent block.
      agentsShown: (() => { const el = document.getElementById('usage-agents'); return el ? !el.hidden : null; })(),
      agentHead: ((document.querySelector('#usage-atable .tv-mrow.head > div') || {}).textContent || '').trim(),
      agentNames: [...document.querySelectorAll('#usage-atable .tv-mrow:not(.head) .tv-mnl')].map((e) => (e.textContent || '').trim()),
      agentMutedCount: document.querySelectorAll('#usage-atable .tv-mrow.muted').length,
      agentBarsPainted: [...document.querySelectorAll('#usage-atable .tv-mbar span')].every((b) => b.getBoundingClientRect().width > 0),
      agentFits: (() => { const el = document.getElementById('usage-atable'); return el ? el.scrollWidth <= el.clientWidth + 1 : null; })(),
      agentNote: txt('#usage-agents-note') || '',
      agentsAfterWtr: (() => { const a = document.getElementById('usage-agents'), w = document.getElementById('usage-wtr'); return a && w ? !!(w.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) : null; })(),
      // the removed elements must be GONE (Josh's exact-to-spec replacement).
      noCards: !document.getElementById('usage-cards'),
      noMoney: !document.getElementById('usage-worth'),
      noCombinedChart: !document.getElementById('usage-chartwrap'),
      // #2840 usage-history list (kept).
      historyRows: document.querySelectorAll('#usage-history .uhrow:not(.uhhead)').length,
      historyHeaders: [...document.querySelectorAll('#usage-history .uhrow.uhhead > div')].map((d) => (d.textContent || '').trim()),
      historyValueLive: [...document.querySelectorAll('#usage-history .uhrow:not(.uhhead) .uh-n:last-child')].every((c) => /^\$[\d.,]+[BMK]?$/.test((c.textContent || '').trim())),
      historyScrolls: (() => { const b = document.getElementById('usage-history'); return b ? getComputedStyle(b).overflowY === 'auto' : null; })(),
      historyKeyboardReachable: (() => { const b = document.getElementById('usage-history'); return b ? b.getAttribute('tabindex') === '0' : null; })(),
      // #2840 the METR method footnote (kept). Quiet: top hairline, no left rule, no callout bg.
      method: (() => {
        const m = document.querySelector('.usage-method');
        if (!m) return null;
        const cs = getComputedStyle(m);
        const link = m.querySelector('a');
        const hist = document.querySelector('.usage-hist');
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
    console.log('\n#2840 -- the approved Token Usage value view');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await openUsage(p);
    const v = await readUsage(p);
    // hero
    ok(v.hasHero, 'the hero renders');
    ok(v.heroTokens && v.heroTokensLabel, 'the blended total headline (2.0B, Total Tokens Used) is shown -- Josh-ruled correct');
    ok(v.heroValue && v.heroValueLabel, 'the human-cost value ($1.8M = total/1e5*$90, Approximate Human Cost) is shown');
    ok(v.heroHours, 'the Human Work Hours stat (20K) is shown');
    ok(v.heroYears, 'the Years of Human Work stat (10) is shown');
    ok(v.heroApi, 'the Equivalent Token API Cost stat abbreviates its thousands figure to $1.2K (#3137, was the clipping $1,152)');
    ok(v.heroFigsFit, 'no hero stat tile clips its figure -- every .tv-fig fits its box after the #3137 abbreviation');
    ok(v.tileFitControl && v.tileFitControl.fullOverflows && v.tileFitControl.abbrFits,
      'CONTROL: the full $176,332 overflows the cost tile but the abbreviated $176.3K fits (#3137, non-vacuous fit proof) -- '
      + JSON.stringify(v.tileFitControl));
    ok(v.heroDays, 'the Active Days on Kosmos eyebrow is shown');
    // charts4
    ok(v.charts4Count === 4, `four per-class daily mini-charts render (got ${v.charts4Count})`);
    ok(v.charts4Svgs === 4, `each mini-chart has its sparkline svg (got ${v.charts4Svgs})`);
    ok(['Cache reads', 'Cache writes', 'Output', 'Input'].every((n) => v.charts4Names.some((x) => x.startsWith(n))),
      `the four charts are the four classes (got ${JSON.stringify(v.charts4Names)})`);
    // per-model table + donut
    ok(v.modelRows === 1 && v.modelNamed, `the per-model table lists the model (got ${v.modelRows} rows)`);
    ok(v.modelPct, 'the sole model is 100.0% of the total');
    ok(v.donutSvg, 'the per-model donut svg renders');
    ok(v.donutRing, 'the donut ring is actually painted (stroked circle/arc, not an invisible 360-degree arc)');
    // layout at the real settings-column width (see the container-query fix)
    console.log(`  ..   settings column ${v.secW}px, table+donut cols=${v.wtrCols}`);
    ok(v.mtableFits, 'the per-model table fits its column with no horizontal overflow');
    ok(v.sectionFits, 'the token-usage section has no horizontal overflow at the settings-column width');
    ok(v.donutCenter, 'the donut center names the total tokens');
    ok(v.donutLegend >= 1, `the donut legend lists the model(s) (got ${v.donutLegend})`);
    // #2617 the per-agent block
    ok(v.agentsShown === true, 'the By agent block is shown when /api/usage sends byAgent');
    ok(v.agentHead === 'Agent', `the per-agent table heads its first column Agent (got ${JSON.stringify(v.agentHead)})`);
    ok(JSON.stringify(v.agentNames) === JSON.stringify(['Ann', 'Bob', 'Not an agent (your own sessions)']),
      `the per-agent rows are the agents by shown name, then the person's own sessions (got ${JSON.stringify(v.agentNames)})`);
    ok(v.agentMutedCount === 1, `only the non-agent row is muted (got ${v.agentMutedCount})`);
    ok(v.agentBarsPainted, 'every per-agent share bar paints with a width');
    ok(v.agentFits, 'the per-agent table fits the settings column with no horizontal overflow');
    ok(/2K tokens in the totals above come from transcripts that have since been removed/.test(v.agentNote),
      `the note states the tokens that cannot be matched (got ${JSON.stringify(v.agentNote)})`);
    ok(v.agentsAfterWtr === true, 'the By agent block sits under the per-model table and donut');
    if (process.env.SHOTS) {
      const el = await p.$('#s-sec-usage');
      await el.screenshot({ path: process.env.SHOTS + '/usage-by-agent-1280.png' });
    }
    // the replaced elements are gone
    ok(v.noCards, 'the old full-number cards are removed (replaced by the approved design)');
    ok(v.noMoney, 'the old output-only money box is removed (replaced by the hero value)');
    ok(v.noCombinedChart, 'the old combined shared-axis chart is removed (replaced by charts4)');
    // usage-history (kept)
    ok(v.historyRows >= 1, `the usage-history list renders a row per day/model (got ${v.historyRows})`);
    ok(['Day', 'Model', 'Total tokens', 'Value'].every((h) => v.historyHeaders.includes(h)),
      `the usage-history columns are Day/Model/Total tokens/Value (got ${JSON.stringify(v.historyHeaders)})`);
    ok(v.historyValueLive, 'every usage-history Value cell shows a live blended $ figure');
    ok(v.historyScrolls === true, 'the usage-history box is a fixed-height scroller');
    ok(v.historyKeyboardReachable === true, 'the scroll region is keyboard-reachable (tabindex=0, WCAG AA)');
    // METR method footnote (kept)
    ok(v.method, 'the METR method footnote renders (.usage-method)');
    ok(v.method && /^how we estimate the value/i.test(v.method.text), 'the footnote leads with "How we estimate the value"');
    ok(v.method && v.method.href === 'https://metr.org/time-horizons/', `the footnote links the exact approved METR URL (got ${v.method && v.method.href})`);
    ok(v.method && /metr/i.test(v.method.linkText || ''), 'the link text names METR');
    ok(v.method && v.method.borderTopW === 1, 'the footnote has a quiet 1px top hairline');
    ok(v.method && v.method.borderLeftW === 0, 'the footnote has NO left color-rule (a quiet footnote, not a callout)');
    ok(v.method && v.method.maxRadius === 0, 'the footnote has no rounded corners (not a boxed callout)');
    ok(v.method && (v.method.bg === 'rgba(0, 0, 0, 0)' || v.method.bg === 'transparent'), 'the footnote has no callout background');
    ok(v.method && v.method.boxShadow === 'none', 'the footnote has no box-shadow');
    ok(v.method && v.method.afterHist === true, 'the footnote sits under the usage-history list');
    // #2840 production-scale hero: the fixture above renders short values (2.0B / $1.8M),
    // which never exercise the widest headline. Re-mock at the design's own magnitude
    // (~150B tokens -> "150.0B" / "$135.0M") and assert the hero figures FIT their boxes.
    // A textContent check cannot see this: .tv-fbox{overflow:hidden} clips silently, so we
    // measure scrollWidth vs clientWidth on the figure elements themselves.
    const BIG = { byDay: { '2026-09-01': { 'claude-opus-4-8': { input_tokens: 500000000, output_tokens: 500000000, cache_creation_input_tokens: 1000000000, cache_read_input_tokens: 148000000000 } } }, rootsRead: ['/tmp/fixture'] };
    await p.unroute('**/api/usage*');
    await p.route('**/api/usage*', (r) => r.fulfill({ json: BIG }));
    await p.reload({ waitUntil: 'networkidle' });
    await p.evaluate(() => showTab('settings'));
    await p.click('#s-nav button[data-go="usage"]');
    await p.waitForSelector('#usage-hero .tv-hero');
    const scale = await p.evaluate(() => {
      const figs = [...document.querySelectorAll('#usage-hero .tv-fig')];
      const clipped = figs.filter((f) => f.scrollWidth > f.clientWidth + 1).map((f) => (f.textContent || '').trim());
      const big = ((document.querySelector('#usage-hero .tv-fbox.gold .tv-fig') || {}).textContent || '').trim();
      return { n: figs.length, clipped, big };
    });
    ok(scale.big.includes('B'), `hero shows the production-scale total in the B band (got ${scale.big})`);
    // #2617 CONTROL: that fixture has no byAgent (an older board, or a failed split),
    // so the per-agent block must stay hidden rather than show an empty table.
    const agentsHidden = await p.evaluate(() => { const el = document.getElementById('usage-agents'); return el ? el.hidden : null; });
    ok(agentsHidden === true, 'the By agent block stays hidden when /api/usage sends no byAgent');
    ok(scale.clipped.length === 0, `hero figures fit their boxes at production scale, none clipped (clipped: ${JSON.stringify(scale.clipped)})`);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log('\nrender-token-usage-2617: ' + (fails.length ? fails.length + ' failed' : 'all good'));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-token-usage-2617 threw: ' + ((e && e.message) || e)); process.exit(1); });

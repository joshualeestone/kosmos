'use strict';

/**
 * The found-agents screen: one label per row, a green Added, and a count that cannot disagree with its own rows (#1346).
 *
 * 🔑 Josh, 2026-08-28, looking at the screen that offered him the three agents
 * Kosmos found on a fresh Mac. His picture, one frame, no scrolling:
 *
 *     We found 3 agents on this computer.
 *       Miles / Nadia / Sarah, three rows
 *     6 agents.
 *
 * 🛑 THE HEADLINE AND THE TRAILING LINE COUNTED DIFFERENT THINGS. The headline
 * reads `FR_FOUND.agents.length`, the DATA. The trailing line counted
 * `.fr-foundrow` across the WHOLE DOCUMENT, and `foundRowsHtml` paints TWO
 * surfaces that coexist: this card and the board's own `#found-list` panel. So
 * the union was reported, N above and 2N below.
 *
 * ⭐ THAT IS WHY IT LOOKED UNREPRODUCIBLE FROM THE CALL SITES. Every call site was
 * correct; the extra rows are not on this screen at all, which is exactly why a
 * source reading says the two "cannot disagree by construction" while the picture
 * shows them disagreeing. This check populates BOTH surfaces on purpose, because a
 * fixture with only one of them passes on the broken page.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-found-count.js
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */
/* ⚠️ TAKES A RUNNING BOARD, like the other found-screen checks in this directory.
   An in-process `srv.start(0)` does not reach this step: measured, `?fr-step=6`
   renders "Create your first agent" there, so a check built that way times out on
   a screen that is fine. Start a sandboxed board first:

     SB=$(mktemp -d); PORT=4711 AGENT_WORKFORCE_DATA="$SB/data" \
       AGENT_WORKFORCE_WORKERS="$SB/workers" AGENT_WORKFORCE_LAUNCH="$SB/launch" \
       AGENT_WORKFORCE_PROJECTS="$SB/projects" AGENT_WORKFORCE_TMUX_BIN=/bin/echo \
       node server.js &
     NODE_PATH="$HOME/work/pw-runtime/node_modules" \
       node docs/browser-checks/render-found-count.js http://127.0.0.1:4711
*/
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:4711';

const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const agent = (name, role) => ({
  name, displayName: name, role, dir: '/Users/x/work/workers/' + name,
  already: false, runner: 'claude',
});
/* 🔑 `ok: true` MATTERS. Without it the page treats the answer as a failure and
   renders no rows at all, which reads exactly like a check pointed at the wrong
   step. Copied from render-found-undo.js's fixture rather than invented. */
const THREE = { ok: true, agents: [agent('miles', 'researcher'), agent('nadia', 'support specialist'), agent('sarah', 'copywriter')] };

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message)));
    await page.route('**/api/found-agents', (r) => r.fulfill({ json: THREE }));
    await page.route('**/api/first-run', (r) => r.fulfill({
      json: { done: false, path: 'create', fleetCount: 0, known: true },
    }));
    /* The found step by URL, the same way render-found-undo.js reaches it. */
    await page.goto(BASE + '/?first-run=1&fr-step=6', { waitUntil: 'networkidle' });
    await page.waitForSelector('#fr-fleet .fr-foundrow', { timeout: 12000 });
    await page.waitForTimeout(500);

    const seen = await page.evaluate(() => {
      const card = document.querySelector('#fr-fleet');
      const rows = [...card.querySelectorAll('.fr-foundrow')];
      const go = rows[0] && rows[0].querySelector('.fr-foundgo');
      return {
        heading: (document.getElementById('fr-title') || {}).textContent || '',
        rowsOnScreen: rows.length,
        rowsInDocument: document.querySelectorAll('.fr-foundrow').length,
        countLine: (document.getElementById('fr-foundcount') || {}).textContent || null,
        labels: rows.map((r) => (r.querySelector('.fr-foundgo') || {}).textContent),
        ariaLabels: rows.map((r) => (r.querySelector('.fr-foundgo') || {}).getAttribute
          ? r.querySelector('.fr-foundgo').getAttribute('aria-label') : null),
        goldFill: go ? getComputedStyle(go).backgroundColor : null,
      };
    });

    console.log('');
    console.log('  heading          : ' + JSON.stringify(seen.heading));
    console.log('  rows on screen   : ' + seen.rowsOnScreen);
    console.log('  rows in document : ' + seen.rowsInDocument);
    console.log('  trailing line    : ' + JSON.stringify(seen.countLine));
    console.log('  labels           : ' + JSON.stringify(seen.labels));
    console.log('  aria-labels      : ' + JSON.stringify(seen.ariaLabels));
    console.log('');

    /* 🛑 THE CONTROL: the fixture has to actually put three rows on the screen, or
       every assertion below is about an empty list. */
    chk(seen.rowsOnScreen === 3, 'the fixture renders three rows', String(seen.rowsOnScreen));
    chk(/3 agents/.test(seen.heading), 'the headline says three', seen.heading);

    /* Josh: remove the redundant number under a headline that already said it.
       Below the search threshold there is nothing for this line to disambiguate. */
    chk(seen.countLine === null,
      'no trailing count line under the headline that already said it',
      JSON.stringify(seen.countLine));

    /* One label on every row, the name kept for the ear. */
    chk(seen.labels.every((l) => l === 'Add to Kosmos'),
      'every button reads exactly "Add to Kosmos"', JSON.stringify(seen.labels));
    /* 🔑 WCAG label-in-name: the visible text must be CONTAINED in the accessible
       name, and it must lead, or a voice-control user saying the words they can see
       reaches nothing. */
    chk(seen.ariaLabels.every((a) => typeof a === 'string' && a.indexOf('Add to Kosmos') === 0),
      'each accessible name STARTS with the visible words', JSON.stringify(seen.ariaLabels));
    chk(new Set(seen.ariaLabels).size === 3,
      'and each one is still distinct, so three identical buttons are tellable apart');

    /* Yellow, per Josh. Asserted as "not the default surface" rather than a hex,
       so a token change does not read as a regression. */
    /* 🛑 THE GOLD ITSELF, NOT "NOT TRANSPARENT". My first version of this line
       excluded only transparency, so it PASSED on rgb(255,255,255) while the fill
       was not arriving at all: `#firstrun .btn { background: #fff }` is ID-scoped
       and was beating the rule. An assertion that cannot return the dangerous
       answer is not an assertion. `--gold-bright` is #e3b341. */
    chk(seen.goldFill === 'rgb(227, 179, 65)',
      'the add button is painted the gold, not the default white', seen.goldFill);

    /* ---- the Added state ------------------------------------------------- */
    await page.route('**/api/connect-agent', (r) => r.fulfill({
      json: { ok: true, name: 'miles', displayName: 'Miles', dir: '/Users/x/work/workers/miles', started: true },
    }));
    await page.click('#fr-fleet .fr-foundrow .fr-foundgo');
    await page.waitForTimeout(500);
    const added = await page.evaluate(() => {
      const go = document.querySelector('#fr-fleet .fr-foundrow .fr-foundgo');
      const cs = getComputedStyle(go);
      return {
        text: go.textContent.trim(),
        color: cs.color,
        bg: cs.backgroundColor,
        mark: getComputedStyle(go, '::before').content,
      };
    });
    console.log('  added state      : ' + JSON.stringify(added));
    console.log('');
    /* 📌 The WORD is unchanged on purpose: two shipped checks assert it is exactly
       "Added", and putting the glyph in the string would have forced both to be
       loosened, which is how a guard quietly stops guarding. */
    chk(added.text === 'Added', 'the button still becomes the word "Added"', added.text);
    chk(/2713|✓/.test(added.mark), 'and carries a check mark, so colour is not alone', added.mark);
    /* 🛑 SAME CORRECTION. This read `!== 'rgb(0, 0, 0)'` and passed on
       rgb(20,22,26), the default ink, while the green was losing on specificity.
       `--ok` is #1f7a4d. */
    chk(added.color === 'rgb(31, 122, 77)',
      'the added state is drawn in the ok green, not default ink', added.color);
    chk(added.bg === 'rgba(0, 0, 0, 0)' || added.bg === 'transparent',
      'and the gold fill is dropped, so a done row stops saying press me', added.bg);

    /* ---------------------------------------------------------------------
       🛑 THE ARM THAT ACTUALLY GUARDS THE 3-vs-6, AND IT NEEDS ITS OWN FIXTURE.
       Everything above runs at three agents, where the trailing line is now
       absent by design -- so `countLine === null` passes whether the query is
       scoped or not. The fix would have shipped with no guard at all.
       Past FOUND_SEARCH_AT the line comes back, and only then can it be wrong:
       thirty found agents must read "30 agents", never "60".
       --------------------------------------------------------------------- */
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
    const errs2 = [];
    page2.on('pageerror', (e) => errs2.push(String(e.message)));
    const MANY = {
      ok: true,
      agents: Array.from({ length: 30 }, (_, i) => agent('agent' + i, 'a role')),
    };
    await page2.route('**/api/found-agents', (r) => r.fulfill({ json: MANY }));
    await page2.route('**/api/first-run', (r) => r.fulfill({
      json: { done: false, path: 'create', fleetCount: 0, known: true },
    }));
    await page2.goto(BASE + '/?first-run=1&fr-step=6', { waitUntil: 'networkidle' });
    await page2.waitForSelector('#fr-fleet .fr-foundrow', { timeout: 12000 });
    await page2.waitForTimeout(600);
    const many = await page2.evaluate(() => ({
      rowsOnScreen: document.querySelectorAll('#fr-fleet .fr-foundrow').length,
      rowsInDocument: document.querySelectorAll('.fr-foundrow').length,
      line: (document.getElementById('fr-foundcount') || {}).textContent || null,
      searchBox: !!document.getElementById('fr-foundsearch'),
    }));
    console.log('');
    console.log('  at 30 agents      : ' + JSON.stringify(many));
    console.log('');
    /* 🛑 THE CONTROL FOR THIS ARM. If the document did NOT hold more rows than the
       screen, an unscoped query would give the right answer by luck and this arm
       would pass on the broken build. The board panel must really be populated. */
    chk(many.rowsInDocument > many.rowsOnScreen,
      'the document holds MORE rows than the screen, so an unscoped count would be wrong',
      many.rowsInDocument + ' in document vs ' + many.rowsOnScreen + ' on screen');
    chk(many.searchBox, 'past the threshold the search box is up, so the line is back');
    /* ⚠️ NOT AN EQUALITY. At thirty rows the list genuinely runs past the fold, so
       the line legitimately adds "Scroll to see them all." Pinning the exact
       string would fail on a true sentence. What must hold is the NUMBER: this
       screen's thirty, and never the document's sixty. */
    chk(/^30 agents\b/.test(many.line || '') && !/\b60\b/.test(many.line || ''),
      'the trailing line counts THIS screen (30), not every surface in the document (60)',
      JSON.stringify(many.line));
    chk(errs2.length === 0, 'no page errors on the 30-agent screen', errs2.join(' | '));
    await page2.close();

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.close();
  } finally {
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });

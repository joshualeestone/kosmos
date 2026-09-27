// Browser-check-surface: boot-cover
/**
 * #1553: the launch must NOT flash the agents view before the first-run gate
 * resolves. Josh hit that flash four times and read it as data loss.
 *
 * A source check cannot see a render-order flash (the card says so outright), so
 * this watches a real launch on both arms. It intercepts /api/first-run and
 * DELAYS the response, opening a window during which the gate is unresolved. In
 * that window the opaque #boot-cover must be up and covering, so the board is
 * never shown and then retracted. Then the response lands and the cover comes
 * down onto the correct destination: the board when first-run is done, the
 * first-run overlay when it is not.
 *
 * The API response is intercepted, not the render functions, so the whole client
 * path (fetch, parse, paint, cover, reveal) runs exactly as it does live.
 */
const { chromium } = require('playwright');

const BASE = process.env.KOSMOS_URL || 'http://127.0.0.1:4399';
const DELAY_MS = 600; // long enough to observe the gate as unresolved

const problems = [];
function check(cond, msg) { if (!cond) problems.push(msg); }

// What the viewer can actually see: the cover is up (not hidden), opaque, fixed,
// covering the viewport, and stacked above the board. If all hold, the board is
// occluded no matter what is painted beneath it.
// kosmos#3973: the root may give up a gutter only as wide as its own stable scrollbar gutter, so a
// root that itself shrank or moved cannot become the yardstick that passes a short cover. #4213: that
// width is read off the ROOT (its width with overflow hidden, without and then with a stable gutter,
// restored in a finally, after every other read), not off a scratch scroller: the PR runner hides
// element scrollbars and still reserves the root's 15px, so a scroller read 0 (as the page's #3497
// measurement says). A margin that shrank the root cancels in the difference. Compared within 1px
// (a fractional root rounds either way). An engine without scrollbar-gutter reads 0 and fails loudly,
// never falsely passes; both Playwright engines support it.
async function coverIsOccluding(page) {
  return page.evaluate(() => {
    const c = document.getElementById('boot-cover');
    if (!c || c.hidden) return { up: false };
    const s = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    const root = document.documentElement.getBoundingClientRect();
    const rs = document.documentElement.style, was = [rs.scrollbarGutter, rs.overflow], sx = scrollX, sy = scrollY;
    let sbw = NaN;
    try {
      rs.overflow = 'hidden'; rs.scrollbarGutter = 'auto';
      const bare = document.documentElement.getBoundingClientRect().width;
      rs.scrollbarGutter = 'stable';
      sbw = Math.round(bare - document.documentElement.getBoundingClientRect().width);
    } finally { [rs.scrollbarGutter, rs.overflow] = was; scrollTo(sx, sy); }
    const gutter = innerWidth - root.right;
    return {
      up: true,
      opaque: s.background !== 'transparent' && s.opacity === '1' && s.display !== 'none',
      fixed: s.position === 'fixed',
      // kosmos#3973: the right edge is the ROOT's box, not documentElement.clientWidth. With the #1309
      // stable gutter reserved and nothing to scroll, Chromium reports clientWidth WITH the empty gutter
      // on a classic-scrollbar machine (1280 of 1280 while html is 1265 wide), and a fixed layer cannot
      // paint that gutter, so a correct cover failed by 15px there and passed on overlay scrollbars.
      // floor: a fractional root width rounds either way (the page's own 1px vwMatches tolerance). The
      // bottom stays on clientHeight: scrollbar-gutter reserves only the vertical scrollbar's strip.
      covers: r.left <= 0 && r.top <= 0
        && r.right >= Math.floor(root.right)
        && r.bottom >= document.documentElement.clientHeight
        && Math.abs(root.left) <= 1 && (Math.abs(gutter) <= 1 || Math.abs(gutter - sbw) <= 1),
      z: Number(s.zIndex) || 0,
      yard: { coverRight: Math.round(r.right), rootLeft: Math.round(root.left), rootRight: Math.round(root.right), gutter: Math.round(gutter), sbw },
    };
  });
}
const seesFirstRun = (page) => page.evaluate(() =>
  !document.getElementById('firstrun').hidden);
const coverGone = (page) => page.evaluate(() => {
  const c = document.getElementById('boot-cover');
  return !c || c.hidden;
});

async function arm(browser, label, firstRunPayload, expect) {
  const page = await browser.newPage();
  let released;
  const gate = new Promise((r) => { released = r; });
  await page.route('**/api/first-run', async (route) => {
    await gate; // hold the response until we have observed the covered window
    route.fulfill({ json: firstRunPayload });
  });
  // domcontentloaded returns before the held fetch resolves, so we observe the
  // page WHILE the gate is still pending.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

  const during = await coverIsOccluding(page);
  check(during.up, `${label}: #boot-cover was not up during the gate (the flash is back)`);
  check(during.up && during.opaque && during.fixed && during.covers,
    `${label}: #boot-cover is up but not occluding (opaque=${during.opaque} fixed=${during.fixed} covers=${during.covers} ${JSON.stringify(during.yard)})`);

  // Release the gate and let the client settle onto its destination.
  released();
  await page.waitForFunction(() => {
    const c = document.getElementById('boot-cover');
    return c && c.hidden;
  }, null, { timeout: 5000 }).catch(() => {});

  check(await coverGone(page), `${label}: #boot-cover never came down after the gate resolved`);
  const fr = await seesFirstRun(page);
  if (expect === 'firstrun') check(fr, `${label}: expected the first-run overlay after the gate, it is hidden`);
  if (expect === 'board') check(!fr, `${label}: the first-run overlay is showing when first-run is done (should be the board)`);

  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    // Arm A: a completed first run -> straight to the board, overlay never shows.
    await arm(browser, 'done', { done: true }, 'board');
    // Arm B: no completed first run -> the installer overlay, agents never flash.
    await arm(browser, 'fresh', { done: false, step: 1 }, 'firstrun');
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error('render-boot-no-flash FAIL:');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-boot-no-flash PASS: no agents-view flash on either arm; cover held through the gate and came down onto the right destination.');
})().catch((e) => { console.error('FAIL  render-boot-no-flash crashed:', e && e.message); process.exit(1); });

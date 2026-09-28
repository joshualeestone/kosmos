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
 * #4328 (arms C and D): What's New must not open, nor record the version as seen, under the
 * cover; it opens once the cover lifts.
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
    const de = document.documentElement, rs = de.style, was = de.getAttribute('style'), sx = scrollX, sy = scrollY;
    let sbw = NaN;
    try {
      rs.overflow = 'hidden'; rs.scrollbarGutter = 'auto';
      const bare = document.documentElement.getBoundingClientRect().width;
      rs.scrollbarGutter = 'stable';
      sbw = Math.round(bare - document.documentElement.getBoundingClientRect().width);
    } finally { if (was === null) de.removeAttribute('style'); else de.setAttribute('style', was); scrollTo(sx, sy); }
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

/* #4328: What's New must not open, nor record the version as seen, while the boot cover is up; it opens once the
   cover lifts. /api/whats-new answers at once with a newer version than the one seen, so on a page without the
   hold the window opens under the cover. The seen POST is answered here and never reaches the board this check
   shares, and tips are switched off so the tour cannot be what holds the window. `hold` false is the control:
   no cover wait, and the window opens straight away. */
async function whatsNewArm(browser, label, hold) {
  const current = (await (await fetch(`${BASE}/api/whats-new`, { cache: 'no-store' })).json()).current;
  const page = await browser.newPage();
  let released;
  const gate = new Promise((r) => { released = r; });
  if (!hold) released();
  let seen = 0;
  await page.route('**/api/first-run', async (route) => { await gate; route.fulfill({ json: { done: true } }); });
  await page.route((u) => u.pathname === '/api/tips', (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { ok: true, seen: [], off: true } }) : route.fulfill({ json: { ok: true } })));
  await page.route('**/api/whats-new/seen', (route) => { seen += 1; route.fulfill({ json: { ok: true } }); });
  let answered;
  const newsAnswered = new Promise((r) => { answered = r; });
  await page.route((u) => u.pathname === '/api/whats-new', async (route) => {
    await route.fulfill({ json: {
      current, seen: '0.0.1', highlights: [{ icon: 'spark', title: 'A thing', line: 'It does a thing.' }] } });
    answered();
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const wnUp = () => page.evaluate(() => !!document.getElementById('whatsnew'));
  if (hold) {
    // Read shortly after /api/whats-new is answered, not at a fixed time from load: the 3 s fallback that lifts the
    // cover starts while the page script runs, before domcontentloaded, so a fixed wait eats the margin.
    await newsAnswered;
    await page.waitForTimeout(700);
    const during = await coverIsOccluding(page);
    check(during.up, `${label}: #boot-cover was already down when the arm looked (the 3 s fallback beat it), so this arm observed nothing`);
    check(!(await wnUp()), `${label}: What's New opened under the boot cover, where nobody can see it`);
    check(seen === 0, `${label}: the version was recorded as seen (${seen}) while the boot cover was up`);
    released();
  }
  await page.waitForFunction(() => { const c = document.getElementById('boot-cover'); return c && c.hidden; },
    null, { timeout: 5000 }).catch(() => {});
  check(await coverGone(page), `${label}: #boot-cover never came down`);
  await page.waitForFunction(() => !!document.getElementById('whatsnew'), null, { timeout: 5000 }).catch(() => {});
  check(await wnUp(), `${label}: What's New never opened after the boot cover lifted`);
  check(seen === 1, `${label}: the version was recorded ${seen} times, expected once when the window opened`);
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    // Arm A: a completed first run -> straight to the board, overlay never shows.
    await arm(browser, 'done', { done: true }, 'board');
    // Arm B: no completed first run -> the installer overlay, agents never flash.
    await arm(browser, 'fresh', { done: false, step: 1 }, 'firstrun');
    // Arm C (#4328): What's New waits out the boot cover. Arm D: the control, no cover wait.
    await whatsNewArm(browser, 'whats-new under the cover', true);
    await whatsNewArm(browser, 'whats-new control', false);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error('render-boot-no-flash FAIL:');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-boot-no-flash PASS: no agents-view flash on either first-run arm (A, B); the cover held through the gate and came down onto the right destination; What\'s New waited out the cover and opened after it (C), and opens at once without it (D).');
})().catch((e) => { console.error('FAIL  render-boot-no-flash crashed:', e && e.message); process.exit(1); });

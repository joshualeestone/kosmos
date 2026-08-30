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
async function coverIsOccluding(page) {
  return page.evaluate(() => {
    const c = document.getElementById('boot-cover');
    if (!c || c.hidden) return { up: false };
    const s = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    return {
      up: true,
      opaque: s.background !== 'transparent' && s.opacity === '1' && s.display !== 'none',
      fixed: s.position === 'fixed',
      covers: r.left <= 0 && r.top <= 0 && r.right >= window.innerWidth && r.bottom >= window.innerHeight,
      z: Number(s.zIndex) || 0,
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
    `${label}: #boot-cover is up but not occluding (opaque=${during.opaque} fixed=${during.fixed} covers=${during.covers})`);

  // Release the gate and let the client settle onto its destination.
  released();
  await page.waitForFunction(() => {
    const c = document.getElementById('boot-cover');
    return c && c.hidden;
  }, { timeout: 5000 }).catch(() => {});

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
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
  }
  console.log('render-boot-no-flash PASS: no agents-view flash on either arm; cover held through the gate and came down onto the right destination.');
})().catch((e) => { console.error('render-boot-no-flash ERROR:', e && e.message); process.exit(1); });

// Browser-check-surface: manifest apple-touch-icon
/**
 * PWA installability check (#718, the "home-screen icon shows" third of
 * "Kosmos on a phone: push notifications, a home-screen icon, and store
 * presence").
 *
 * What it verifies TODAY (runnable now; no service-worker or push dependency):
 *  - web/index.html links the manifest and wires the Apple home-screen metas.
 *  - /manifest.webmanifest is served, is valid JSON, and declares what a browser
 *    needs for Add-to-Home-Screen: name, display:standalone, start_url, and a
 *    192 + 512 icon.
 *  - every icon the manifest and the apple-touch-icon link declare actually
 *    resolves (HTTP 200 + an image/* content-type). An install with a broken
 *    icon is the exact "the icon shows" failure this third is about.
 *
 * NEGATIVE CONTROL (repo doctrine: a silent checker reads like a clean pass): a
 * deliberately-absent icon path must NOT resolve 200. If it does -- the server
 * serves anything, or SPA-fallbacks unknown paths to index.html -- then every
 * "icon resolves 200" pass below is meaningless, so the control fails the run.
 *
 * Board URL: $KOSMOS_URL (the release runner hands over a kernel-assigned port,
 * #633/#708), argv[2], else the local-board fallback. Do not assume the port.
 *
 * =====================================================================
 * #718 DEMOABLE FLOW SPEC -- the full "something to show" acceptance path.
 * This check ARMS step (1). Steps (2)-(4) are GATED on work owned by others and
 * are NOT yet runnable (nothing to drive would be an unarmed guard); each grows
 * into a real check here or in a sibling file as its dependency lands. Written
 * now so "demoable" has one discoverable, in-repo definition.
 *
 *  (1) [ARMED -- this check] Load the board; the PWA is installable: manifest +
 *      icons + Apple metas served and valid, so Add-to-Home-Screen offers the
 *      Kosmos icon.
 *  (2) [GATED: service worker, Kano -- unmerged] A service worker registers at
 *      scope "/" and controls the page (navigator.serviceWorker.controller is
 *      non-null). Web push cannot be received without it; there is no SW in web/
 *      today, so this cannot be asserted yet.
 *  (3) [GATED: web-push subscribe + front-door #2854] Grant notification
 *      permission (Playwright: context.grantPermissions(['notifications'],
 *      { origin })), subscribe via pushManager.subscribe with the server's VAPID
 *      public key, and POST the subscription to the relay's /v1/push/subscribe
 *      (in the SEPARATE kosmos-relay repo, Raiden -- a branch, not on kosmos
 *      origin/main). The mobile story needs a real HTTPS front-door origin
 *      (#2854); http://127.0.0.1 is a secure context locally but is not the
 *      per-user hostname a phone reaches.
 *  (4) [GATED: push send path, kosmos-relay -- Raiden] Trigger a send; the
 *      service worker's push handler fires and a notification is shown. Assert
 *      via the SW's notification bookkeeping, not a screenshot (a picture cannot
 *      show a notification was delivered).
 *
 * ENGINE CAVEAT (per the /browser-test skill): Service Workers and Web Push are
 * exactly where Playwright's webkit is NOT Safari and device emulation is NOT a
 * real iPhone. Steps (2)-(4), once armed, will still need real-Safari /
 * real-device human verification in addition to the Playwright check -- iOS
 * Safari only fires web push for a PWA already added to the Home Screen.
 * =====================================================================
 */
const { chromium } = require('playwright');

const BASE = process.env.KOSMOS_URL || process.argv[2] || 'http://127.0.0.1:16180';
const HEADED = process.env.HEADED !== '0';

(async () => {
  const problems = [];
  const browser = await chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // --- NEGATIVE CONTROL, first: an absent icon path must not resolve 200. ---
  const controlUrl = `${BASE}/icons/__pwa_installable_718_absent_control__.png`;
  const controlRes = await page.request.get(controlUrl).catch(() => null);
  if (controlRes && controlRes.status() === 200) {
    problems.push(`negative control: an absent icon path (${controlUrl}) resolved 200 `
      + `-- the server serves anything, so every "icon resolves 200" pass below proves nothing`);
  } else {
    console.log(`control: absent icon correctly did not resolve 200 `
      + `(status ${controlRes ? controlRes.status() : 'no response'})`);
  }

  // --- head wiring: manifest + Apple home-screen metas in index.html ---
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const head = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const manifestLink = q('link[rel="manifest"]');
    const appleIcon = q('link[rel="apple-touch-icon"]');
    const themeColor = q('meta[name="theme-color"]');
    const appleCapable = q('meta[name="apple-mobile-web-app-capable"]');
    return {
      manifestHref: manifestLink ? manifestLink.getAttribute('href') : null,
      appleIconHref: appleIcon ? appleIcon.getAttribute('href') : null,
      themeColor: themeColor ? themeColor.getAttribute('content') : null,
      appleCapable: appleCapable ? appleCapable.getAttribute('content') : null,
    };
  });
  if (!head.manifestHref) problems.push('index.html head has no <link rel="manifest">');
  if (!head.appleIconHref) problems.push('index.html head has no <link rel="apple-touch-icon"> (iOS home-screen icon)');
  if (!head.themeColor) problems.push('index.html head has no <meta name="theme-color">');
  if (!head.appleCapable) problems.push('index.html head has no <meta name="apple-mobile-web-app-capable">');

  // --- manifest served + valid JSON + install-eligibility fields ---
  const manifestUrl = new URL(head.manifestHref || '/manifest.webmanifest', BASE).href;
  let manifest = null;
  const mres = await page.request.get(manifestUrl).catch(() => null);
  if (!mres || mres.status() !== 200) {
    problems.push(`manifest ${manifestUrl} did not serve 200 (status ${mres ? mres.status() : 'no response'})`);
  } else {
    try {
      manifest = JSON.parse(await mres.text());
    } catch (e) {
      problems.push(`manifest ${manifestUrl} is not valid JSON: ${e.message}`);
    }
  }
  if (manifest) {
    if (!manifest.name) problems.push('manifest has no name');
    if (manifest.display !== 'standalone') {
      problems.push(`manifest display is "${manifest.display}", not "standalone" `
        + `(Add-to-Home-Screen wants an app-shaped launch)`);
    }
    if (!manifest.start_url) problems.push('manifest has no start_url');
    const declaredSizes = (manifest.icons || []).flatMap((i) => (i.sizes || '').split(/\s+/));
    if (!(manifest.icons || []).length) problems.push('manifest declares no icons');
    for (const need of ['192x192', '512x512']) {
      if (!declaredSizes.includes(need)) {
        problems.push(`manifest icons do not include a ${need} icon (install eligibility)`);
      }
    }
  }

  // --- every declared icon actually resolves (200 + image/*) ---
  const iconUrls = new Set();
  for (const i of (manifest && manifest.icons) || []) {
    if (i.src) iconUrls.add(new URL(i.src, manifestUrl).href);
  }
  if (head.appleIconHref) iconUrls.add(new URL(head.appleIconHref, BASE).href);
  for (const url of iconUrls) {
    const r = await page.request.get(url).catch(() => null);
    if (!r || r.status() !== 200) {
      problems.push(`icon ${url} did not resolve 200 (status ${r ? r.status() : 'no response'})`);
      continue;
    }
    const ct = r.headers()['content-type'] || '';
    if (!/^image\//.test(ct)) {
      problems.push(`icon ${url} served content-type "${ct}", not image/*`);
    }
  }

  await ctx.close();
  await browser.close();

  if (problems.length) {
    console.log(`\nPROBLEMS (${problems.length}):`);
    for (const p of problems) console.log('  FAIL  ' + p);
  } else {
    console.log('\nno installability problems found');
  }
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-pwa-installable-718: ' + (e && e.stack || e)); process.exit(1); });

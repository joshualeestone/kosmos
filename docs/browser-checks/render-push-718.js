/**
 * PWA push (#718): the service worker registers, controls the page, and a real
 * delivered push shows a notification.
 *
 * 🔑 WHY A BROWSER AND NOT A SOURCE TEST. `node --test` cannot register a
 * service worker, cannot run its `push` handler, and cannot show a notification.
 * Everything this pins -- that /sw.js is served as a worker, that the client
 * registers it, that it becomes the page's controller, and that a push delivered
 * to it produces a notification -- is invisible to a source test. The last one
 * especially: a source test can confirm the `push` listener EXISTS and say
 * nothing about whether a delivered push actually reaches it and paints.
 *
 * ⚠️ CHROMIUM ONLY, ON PURPOSE. This repo's service worker + Web Push is the
 * Chromium/Android/desktop path (the iOS story is separate and not what sw.js
 * targets). The real-push assertion uses the DevTools Protocol verb
 * `ServiceWorker.deliverPushMessage`, which is Chromium's. Running this in WebKit
 * would test a platform the feature is not built against, so it is not run there.
 *
 * ⚠️ IT DELIVERS A REAL PUSH, it does not call showNotification itself. Calling
 * showNotification from the page would prove the browser can paint a notification
 * and prove nothing about sw.js's `push` handler -- the exact vacuous-pass shape
 * this directory keeps getting burned by. The push is delivered THROUGH the
 * worker's own handler via CDP, so a broken or missing `push` listener fails it.
 *
 * ⚠️ HEADED BY DEFAULT like every check here (HEADED=0 for a no-console machine,
 * which includes the staging-cut gate). The notification-RENDER read needs a real
 * notification platform, which only HEADED provides: headless Chromium delivers
 * the push to the worker's handler but returns [] from getNotifications(). So that
 * one assertion is headed-only and is skipped (with a printed SKIP line) under
 * HEADED=0; everything else -- serve/register/control and the CDP push delivery --
 * still runs headless, and the payload mapping is covered headless by the node
 * suite web.sw-718.test.js. See the HEADED gate at the render assertion below.
 *
 * Needs a board with first run already complete (the driver runs it on the shared
 * $B8 board) -- see the README.
 *
 * Run: see the README in this directory.
 */
'use strict';

const playwright = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';

// HEADED vs headless is a per-machine choice (see BROWSER_TESTING): a console
// machine runs headed; a CI/cron/no-console box, and the staging-cut gate, run
// headless via HEADED=0. It gates the notification-RENDER assertion below:
// headless Chromium delivers a push to the worker's handler but does not surface
// the notification to getNotifications(), so that one read is headed-only.
const HEADED = process.env.HEADED !== '0';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  const origin = new URL(BASE).origin;

  const browser = await playwright.chromium.launch({ headless: !HEADED });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1400 },
    serviceWorkers: 'allow',
    permissions: ['notifications'],
  });
  // Belt and braces: some Playwright versions want the grant scoped to origin.
  try { await ctx.grantPermissions(['notifications'], { origin }); } catch (_e) {}

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  /* --- 1. /sw.js is served AS A WORKER, with the handlers it needs ---------- */
  /* Fetched through the page's request context so it goes to the real server
     route, not the disk. A worker that answered as HTML (the silent-success trap
     the server's /api and /icons guards exist to stop) would fail here. */
  const swResp = await page.request.get(BASE + '/sw.js');
  const swType = swResp.headers()['content-type'] || '';
  const swScope = swResp.headers()['service-worker-allowed'] || '';
  const swBody = await swResp.text();
  check('/sw.js is served 200', swResp.status() === 200, String(swResp.status()));
  check('/sw.js is served as javascript', /javascript/i.test(swType), swType);
  check('/sw.js declares root scope (Service-Worker-Allowed: /)', swScope === '/', JSON.stringify(swScope));
  check('/sw.js has a push listener', /addEventListener\(\s*['"]push['"]/.test(swBody));
  check('/sw.js has a notificationclick listener', /addEventListener\(\s*['"]notificationclick['"]/.test(swBody));
  check('/sw.js shows a notification on push', /showNotification\(/.test(swBody));

  /* --- 2. the board loads and the client push wiring is present ------------- */
  await page.goto(BASE + '/', { waitUntil: 'load' });
  // A first-run overlay would sit on top; $B8 is first-run-complete, but be safe.
  if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

  const wiring = await page.evaluate(() => ({
    hasSWApi: 'serviceWorker' in navigator,
    enableFn: typeof window.kosmosEnablePush,
    registerFn: typeof window.kosmosRegisterServiceWorker,
    button: !!document.getElementById('push-enable'),
    msg: !!document.getElementById('push-msg'),
  }));
  check('the browser exposes the service worker API', wiring.hasSWApi);
  check('the client exposes kosmosEnablePush()', wiring.enableFn === 'function', wiring.enableFn);
  check('the client exposes kosmosRegisterServiceWorker()', wiring.registerFn === 'function', wiring.registerFn);
  check('the "Turn on" push control is in the page', wiring.button && wiring.msg);

  /* --- 3. the worker registers, activates, and CONTROLS the page ------------ */
  /* The client registers on load. Wait for an active worker, then reload so the
     worker is controlling this page (a freshly-registered worker does not
     control the page that registered it until the next navigation). */
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { active: !!(r && r.active), scope: r ? r.scope : null };
  });
  check('the service worker becomes active', reg.active);
  check('the service worker scope is the whole origin', reg.scope === origin + '/', JSON.stringify(reg.scope));

  await page.reload({ waitUntil: 'load' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check('the worker controls the page after reload', controlled);

  /* --- 4. a REAL delivered push shows a notification ------------------------ */
  /* Deliver a push to the worker's own `push` handler via CDP and then read the
     notifications the registration is showing. This runs the handler in sw.js,
     not a page-side showNotification, so a broken push path fails here. */
  let delivered = false;
  let deliverErr = '';
  let shown = [];
  try {
    const cdp = await ctx.newCDPSession(page);
    let registrationId = null;
    cdp.on('ServiceWorker.workerRegistrationUpdated', (evt) => {
      for (const rr of (evt.registrations || [])) {
        if (rr.scopeURL && rr.scopeURL.replace(/\/$/, '') === origin && !rr.isDeleted) {
          registrationId = rr.registrationId;
        }
      }
    });
    await cdp.send('ServiceWorker.enable');
    // Let workerRegistrationUpdated arrive with the current registration.
    for (let i = 0; i < 25 && !registrationId; i++) await page.waitForTimeout(120);
    check('CDP reports the worker registration', !!registrationId, String(registrationId));

    if (registrationId) {
      /* The REAL coordinator payload shape (kosmos-relay VapidSender): who/what/
         where, never content -- {kind, agent, project, id, address}. sw.js must
         DERIVE the notification from these fields. Delivering {title,body} here
         instead would route through sw.js's explicit-title fallback and prove
         nothing about the mapping the live push actually depends on (the exact
         hand-rolled-fixture-answers-a-different-question trap). No title/body in
         the fixture, on purpose, so the derive path is what is under test. */
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin,
        registrationId,
        data: JSON.stringify({
          kind: 'needs_you',
          agent: 'Scorpion',
          project: 'Kosmos Inside Out',
          id: 'evt-718-browsercheck',
          address: 'study.kosmos.example',
        }),
      });
      delivered = true;
      // Poll for the rendered notification ONLY when headed: headless never
      // surfaces it (see the render-assertion note below), so polling there would
      // just burn ~5s timing out on every cut run.
      if (HEADED) {
        // The handler is async (waitUntil showNotification); poll for the result.
        for (let i = 0; i < 25; i++) {
          shown = await page.evaluate(async () => {
            const r = await navigator.serviceWorker.ready;
            const ns = await r.getNotifications();
            return ns.map((n) => ({ title: n.title, body: n.body, url: (n.data && n.data.url) || null }));
          });
          if (shown.length) break;
          await page.waitForTimeout(200);
        }
      }
    }
  } catch (e) {
    deliverErr = String((e && e.message) || e);
  }
  check('a push was delivered to the worker (CDP)', delivered, deliverErr);
  /* The notification-RENDER read is HEADED-ONLY. Headless Chromium delivers the
     push to the worker's handler (the check above passes) but does NOT surface
     the notification to getNotifications() -- measured in both arms against a
     board with no coordinator proxies: headed returns the mapped notification,
     headless returns []. That is a browser-platform limitation, not a product
     failure, so under HEADED=0 we skip only this render read rather than
     false-fail the headless cut gate. The coordinator-payload MAPPING itself
     (sw.js deriving kind+agent+project -> headline and address -> the https
     click-through) is covered headless by the node suite web.sw-718.test.js
     (notificationFor), so nothing about the mapping goes unverified when skipped.
     (This supersedes the #3552 stopgap that skipped UNCONDITIONALLY on a
     "#3510 / mapping unwired" rationale: verified false -- the mapping renders
     correctly headed, independent of #3510, so the skip is headless-only.)
     ⚠️ Residual gap, named rather than implied: skipping this headless removes the
     only END-TO-END check that the push HANDLER runs to completion and calls
     showNotification. web.sw-718.test.js covers notificationFor as a PURE function
     but not the real addEventListener('push') wiring, and "a push was delivered
     (CDP)" only confirms the send did not throw, not that the handler finished.
     So a regression in the handler's execution (as opposed to the notification
     mapping) is caught only by a HEADED run of this check, which the headless cut
     gate does not currently do. Follow-up: run this check in a headed lane (#3565).
     This is an accepted tradeoff (a real browser-platform limitation), not silent.
     When HEADED, assert the DERIVED notification (not an echoed one): a worker
     that ignored the coordinator shape (the old {title,body,url} reader) would
     show "Kosmos" / generic and open "/", and fail all three. */
  if (HEADED) {
    const hit = shown.find((n) =>
      n.title === 'Scorpion needs you' &&
      n.body === 'In Kosmos Inside Out' &&
      n.url === 'https://study.kosmos.example/');
    check('the delivered coordinator push produced the mapped notification', !!hit,
      JSON.stringify(shown).slice(0, 240));
  } else {
    console.log('SKIP  the delivered coordinator push produced the mapped notification (headed-only: headless has no notification platform to read via getNotifications; mapping covered by web.sw-718.test.js)');
  }

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  FAIL  ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

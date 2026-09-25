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
 * which includes the staging-cut gate). Headless Chromium keeps notification
 * permission at 'denied' even after grantPermissions, so showNotification rejects
 * there and getNotifications() returns []. The notification-RENDER read is therefore
 * headed-only and is skipped (with a printed SKIP line) under HEADED=0. The HANDLER
 * itself is still checked headless (#3565): the check wraps showNotification inside
 * the live worker and asserts what the real push handler called and how the call
 * settled. See the HEADED gate at the render assertion below.
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
// headless Chromium keeps notification permission at 'denied', so nothing is
// shown and that one read is headed-only. The handler call is asserted in both.
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
    toggleFn: typeof window.kosmosPhoneNotifyToggle,
    registerFn: typeof window.kosmosRegisterServiceWorker,
    button: !!document.getElementById('phone-notify-toggle'),
    msg: !!document.getElementById('phone-notify-msg'),
  }));
  check('the browser exposes the service worker API', wiring.hasSWApi);
  check('the client exposes kosmosPhoneNotifyToggle()', wiring.toggleFn === 'function', wiring.toggleFn);
  check('the client exposes kosmosRegisterServiceWorker()', wiring.registerFn === 'function', wiring.registerFn);
  check('the Phone notifications control is in the page', wiring.button && wiring.msg);

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
  let calls = null;       // what the worker's own push handler passed to showNotification
  let captureErr = '';
  let swWorker = null;   // the live /sw.js worker the capture is installed in
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
      /* #3565: observe the HANDLER from inside the worker, headless included.
         Wrap self.registration.showNotification in the live worker (test-side
         only: nothing is added to the shipped sw.js) so the real
         addEventListener('push') handler records what it called and how the call
         settled. Installed just before the delivery below, because a worker that
         restarts in between comes back without the wrapper (that reads as no call,
         a red, never a pass). */
      try {
        const sw = ctx.serviceWorkers().find((w) => w.url() === origin + '/sw.js');
        if (!sw) throw new Error('no /sw.js worker in the context: ' + ctx.serviceWorkers().map((w) => w.url()).join(','));
        await sw.evaluate(() => {
          self.__kosmos3565 = [];
          const reg = self.registration;
          const orig = reg.showNotification.bind(reg);
          reg.showNotification = (title, options) => {
            const rec = {
              title,
              body: options && options.body,
              url: (options && options.data && options.data.url) || null,
              settled: 'pending',
            };
            self.__kosmos3565.push(rec);
            return orig(title, options).then(
              (v) => { rec.settled = 'resolved'; return v; },
              (e) => { rec.settled = 'rejected: ' + String((e && e.message) || e); throw e; });
          };
        });
        swWorker = sw;
      } catch (e) {
        captureErr = String((e && e.message) || e);
      }
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
      // #3565: read back the handler's call from the worker, in BOTH modes.
      if (swWorker) {
        for (let i = 0; i < 25; i++) {
          calls = await swWorker.evaluate(() => self.__kosmos3565 || null).catch((e) => { captureErr = String((e && e.message) || e); return null; });
          if (calls) captureErr = '';
          if (calls && calls.length && calls[0].settled !== 'pending') break;
          await page.waitForTimeout(200);
        }
      }
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
  /* #3565: the handler RAN and called showNotification with the DERIVED
     notification, observed inside the worker, so it holds headless too. A handler
     that threw before showNotification, or that ignored the coordinator shape,
     reds here in both modes. */
  const call = (calls || [])[0] || null;
  /* #3689: this board runs on 127.0.0.1, which has no relay domain, so the tap
     opens this board ('/') rather than the payload's address: only a sibling
     Mac under the board's own domain is opened. The Mac click-through itself is
     pinned in web.sw-718.test.js. The title and body still tell the mapped
     notification apart from the old {title,body,url} reader. */
  const TAP_URL = '/';
  check('the push handler called showNotification with the mapped notification (observed in the worker)',
    !!call && (calls || []).length === 1 &&
      call.title === 'Scorpion needs you' &&
      call.body === 'In Kosmos Inside Out' &&
      call.url === TAP_URL,
    captureErr || JSON.stringify(calls).slice(0, 240));
  /* How that call settled. Headed it must RESOLVE. Headless Chromium keeps
     notification permission at 'denied' even after grantPermissions (measured
     2026-09-24: page and worker both read 'denied' headless, 'granted' headed), so
     there showNotification REJECTS for permission; that one rejection is accepted
     only while the page really reads 'denied'. Any other rejection reds. The
     message is matched loosely (/permission/i) so a Chromium rewording does not
     red the cut gate; the 'denied' reading is what carries the weight.
     Not covered: whether the call was handed to event.waitUntil. The capture sees
     the call and its outcome, not which promise the handler kept alive. */
  const perm = await page.evaluate(() => Notification.permission).catch(() => 'unreadable');
  const settledOk = !!call && (call.settled === 'resolved' ||
    (!HEADED && perm === 'denied' && /^rejected: .*permission/i.test(call.settled)));
  check('the handler\'s showNotification settled as this mode allows (headed: resolved; headless: only the permission denial)',
    settledOk, `mode=${HEADED ? 'headed' : 'headless'} permission=${perm} settled=${call ? call.settled : 'no call'}`);
  /* The notification-RENDER read is HEADED-ONLY. Headless, the handler runs and
     calls showNotification (the two #3565 arms above assert it), but the call
     rejects for permission, so getNotifications() returns []. That is a
     browser-platform limitation, not a product failure, so under HEADED=0 we skip
     only this render read rather than false-fail the headless cut gate. The coordinator-payload MAPPING itself
     (sw.js deriving kind+agent+project -> headline and address -> the https
     click-through) is covered headless by the node suite web.sw-718.test.js
     (notificationFor), so nothing about the mapping goes unverified when skipped.
     (This supersedes the #3552 stopgap that skipped UNCONDITIONALLY on a
     "#3510 / mapping unwired" rationale: verified false -- the mapping renders
     correctly headed, independent of #3510, so the skip is headless-only.)
     Handler EXECUTION is no longer headed-only (#3565): the worker-side capture
     above reds headless when the handler throws or ignores the coordinator shape.
     When HEADED, assert the DERIVED notification (not an echoed one): a worker
     that ignored the coordinator shape (the old {title,body,url} reader) would
     show "Kosmos" / generic, and fail the title and body. */
  if (HEADED) {
    const hit = shown.find((n) =>
      n.title === 'Scorpion needs you' &&
      n.body === 'In Kosmos Inside Out' &&
      n.url === TAP_URL);
    check('the delivered coordinator push produced the mapped notification', !!hit,
      JSON.stringify(shown).slice(0, 240));
  } else {
    console.log('SKIP  the delivered coordinator push produced the mapped notification (headed-only: headless Chromium denies notification permission, so nothing is shown; the handler call is asserted above)');
  }

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  FAIL  ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

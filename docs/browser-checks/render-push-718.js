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
  /* #4194: the ship gate is open, so the board says phone notifications are available and the section shows; and a Mac
     user without the phone app is told it is in testing (not in the stores yet), so the switch does not mislead. */
  const pnShown = await page.waitForFunction(() => { const sec = document.getElementById('phone-notify'); return !!sec && !sec.hidden; }, null, { timeout: 8000 })
    .then(() => true, () => false);
  check('#4194: with the ship gate open, the Phone notifications section is not hidden', pnShown);
  const pnNote = await page.evaluate(() => { const n = document.getElementById('phone-notify-testing'); return n ? n.textContent : ''; });
  check('#4194: the section says the phone app is in testing and not in the stores yet',
    /still in testing/.test(pnNote) && /not in the App Store or Google Play/.test(pnNote), JSON.stringify(pnNote));

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

  /* --- 3b. #4103: the offline copy of '/' is only ever the board ------------- */
  /* The reload above went through the worker's navigation handler, so '/' is cached: it must be the board. Then a
     signed-out navigation (the relay's Kosmos+ sign-in page, a same-origin 200) is served for the next reload; it
     must reach the page but must NOT replace the offline copy. ctx.route intercepts the worker's own fetch. */
  const offlineCopy = () => page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find((n) => n.startsWith('kosmos-shell-'));
    if (!name) return { name: null, board: false, text: '' };
    const hit = await (await caches.open(name)).match('/');
    const text = hit ? await hit.text() : '';
    return { name, board: text.includes('<meta name="kosmos-version"'), signin: text.includes('KOSMOS-PLUS-SIGNIN-STANDIN') };
  });
  /* No fixed waits (review round 1): the write runs under waitUntil after the worker reads the board's head, so
     poll with a deadline. The first arm deletes the cached '/' and reloads, so it proves the NAVIGATION path cached
     the board (not the install pre-cache). The second arm watches the whole window: an old worker's poisoning write
     can land late, so "still the board" is only true if no poisoned copy appears before the deadline. */
  const until = async (pred, ms) => { const end = Date.now() + ms; let v; do { v = await offlineCopy(); if (pred(v)) return v; await page.waitForTimeout(150); } while (Date.now() < end); return v; };
  await page.evaluate(async () => { for (const n of await caches.keys()) if (n.startsWith('kosmos-shell-')) await (await caches.open(n)).delete('/'); });
  await page.reload({ waitUntil: 'load' });
  const first = await until((v) => v.board, 8000);
  check('#4103: a navigation caches the board as the offline copy of / (deleted first, so this is the navigation path)', first.board, JSON.stringify(first));
  const SIGNIN = '<!doctype html><html><head><title>Kosmos+ sign in</title></head><body>KOSMOS-PLUS-SIGNIN-STANDIN</body></html>';
  await ctx.route(origin + '/', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: SIGNIN }));
  await page.reload({ waitUntil: 'load' });
  const servedSignin = await page.evaluate(() => document.body && document.body.textContent.includes('KOSMOS-PLUS-SIGNIN-STANDIN'));
  const after = await until((v) => v.signin || !v.board, 4000);
  await ctx.unroute(origin + '/');
  check('#4103: CONTROL the signed-out reload really served the sign-in page', servedSignin);
  check('#4103: a signed-out navigation does not replace the offline copy (it is still the board)', after.board && !after.signin, JSON.stringify(after));
  await page.goto(BASE, { waitUntil: 'load' });

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
      /* The coordinator payload without a title -- {kind, agent, project, id, address}: what
         the live coordinator sends until kosmos-relay pushwords-6487 (kosmos#6487) is deployed,
         and what an older coordinator keeps sending after. sw.js must DERIVE the notification
         from these fields, so the derive path is what is under test here. The payload WITH the
         coordinator's own title and body (shown as it is, no body added) is pinned in
         web.sw-718.test.js. */
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
      call.body === 'in Kosmos Inside Out' &&
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
      n.body === 'in Kosmos Inside Out' &&
      n.url === TAP_URL);
    check('the delivered coordinator push produced the mapped notification', !!hit,
      JSON.stringify(shown).slice(0, 240));
  } else {
    console.log('SKIP  the delivered coordinator push produced the mapped notification (headed-only: headless Chromium denies notification permission, so nothing is shown; the handler call is asserted above)');
  }

  /* --- #6254: the per-kind sub-switches, under the master above ------------- */
  /* WHY HERE AND NOT ONLY A SOURCE TEST. web.phone-notify-718.test.js already
     drives paintKinds/toggleKind through a fake DOM, so the control flow is
     covered. What a source test cannot see is that the real markup in web/index.html
     actually carries the container, the five buttons (with their data-kind and the
     default aria-pressed the page ships), and that the client exposes the toggle --
     and that the client's OWN paint unhides the block and paints each button from
     the board's `kinds` in a real browser. That is the gap this block closes.

     Two parts. STATIC facts first, read off the live board page -- true whatever
     the board's phone-notify state is, because the markup is always present (the
     section is hidden when unavailable, not removed). Then a DYNAMIC arm: a fresh
     context with the service worker BLOCKED (so the fetch hits the mock, not a
     cached worker response) and /api/phone-notify mocked, so the client's real
     paintKinds runs against a known state -- master on paints+shows, master off
     hides (cf. render-found-undo.js's mocked-route pattern). */
  const PN_DEFAULT_PRESSED = { needsYou: 'true', replied: 'true', postedMention: 'true', ready: 'true', postedRoom: 'false' };
  const kindWiring = await page.evaluate((names) => {
    const out = { fn: typeof window.kosmosPhoneNotifyKindToggle, box: !!document.getElementById('phone-notify-kinds'), btns: {} };
    for (const n of names) {
      const b = document.getElementById('pn-kind-' + n);
      out.btns[n] = b ? { present: true, dataKind: b.getAttribute('data-kind'), pressed: b.getAttribute('aria-pressed') } : { present: false };
    }
    return out;
  }, Object.keys(PN_DEFAULT_PRESSED));
  check('#6254: the client exposes kosmosPhoneNotifyKindToggle()', kindWiring.fn === 'function', kindWiring.fn);
  check('#6254: the per-kind switch block is in the page', kindWiring.box);
  for (const n of Object.keys(PN_DEFAULT_PRESSED)) {
    const b = kindWiring.btns[n];
    check(`#6254: pn-kind-${n} is present with data-kind=${n} and default aria-pressed=${PN_DEFAULT_PRESSED[n]}`,
      b.present && b.dataKind === n && b.pressed === PN_DEFAULT_PRESSED[n], JSON.stringify(b));
  }

  const pnCtx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, serviceWorkers: 'block' });
  const pnPage = await pnCtx.newPage();
  const pnErrors = [];
  pnPage.on('pageerror', (e) => pnErrors.push(String(e.message)));
  /* replied OFF, the rest as default on -- so a button that painted the markup
     default instead of the board's `kinds` (replied would stay On) fails below. */
  let pnState = { available: true, on: true, connected: true, kinds: { needsYou: true, replied: false, postedMention: true, ready: true, postedRoom: false } };
  await pnPage.route('**/api/phone-notify', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pnState) }));
  await pnPage.goto(BASE + '/', { waitUntil: 'load' });
  if (await pnPage.$('#firstrun:not([hidden])')) { await pnPage.keyboard.press('Escape'); await pnPage.waitForTimeout(300); }
  const shownOn = await pnPage.waitForFunction(() => { const b = document.getElementById('phone-notify-kinds'); return !!b && !b.hidden; }, null, { timeout: 8000 }).then(() => true, () => false);
  check('#6254: with the master on + connected, the per-kind block is shown', shownOn);
  const painted = await pnPage.evaluate((names) => {
    const o = {};
    for (const n of names) { const b = document.getElementById('pn-kind-' + n); o[n] = b ? { pressed: b.getAttribute('aria-pressed'), text: b.textContent } : null; }
    return o;
  }, Object.keys(pnState.kinds));
  const wantPaint = { needsYou: 'true', replied: 'false', postedMention: 'true', ready: 'true', postedRoom: 'false' };
  const paintMiss = Object.keys(wantPaint).filter((n) =>
    !(painted[n] && painted[n].pressed === wantPaint[n] && painted[n].text === (wantPaint[n] === 'true' ? 'On' : 'Off')));
  check('#6254: each sub-switch paints from the board kinds (On/Off + aria-pressed), not the markup default',
    paintMiss.length === 0, paintMiss.map((n) => n + '=' + JSON.stringify(painted[n])).join(' '));

  // Visual record of the expanded section (set PN_SHOT to a writable path to capture it).
  if (process.env.PN_SHOT) { try { const sec = await pnPage.$('#phone-notify'); if (sec) await sec.screenshot({ path: process.env.PN_SHOT }); } catch (_e) {} }

  // Master off -> the block hides again (same page, a fresh GET).
  pnState = { available: true, on: false, connected: true, kinds: pnState.kinds };
  await pnPage.reload({ waitUntil: 'load' });
  if (await pnPage.$('#firstrun:not([hidden])')) { await pnPage.keyboard.press('Escape'); await pnPage.waitForTimeout(300); }
  await pnPage.waitForTimeout(400);
  const hiddenOff = await pnPage.evaluate(() => { const b = document.getElementById('phone-notify-kinds'); return b ? b.hidden : null; });
  check('#6254: with the master off, the per-kind block is hidden', hiddenOff === true, JSON.stringify(hiddenOff));

  // #6488: the sentence under the switch follows whether the off was the person's choice, connected or not.
  for (const [st, want] of [
    [{ available: true, on: false, connected: true, kinds: pnState.kinds }, 'Not on yet. It turns on by itself, or press Turn on now.'],
    [{ available: true, on: false, connected: true, offByChoice: true, kinds: pnState.kinds }, 'Off. Press Turn on to turn it on.'],
    [{ available: true, on: false, connected: false, kinds: pnState.kinds }, 'This turns on by itself once Kosmos+ is on for this computer.'],
    [{ available: true, on: false, connected: false, offByChoice: true, kinds: pnState.kinds }, 'Off. You can turn it on once Kosmos+ is on for this computer.'],
  ]) {
    pnState = st;
    await pnPage.reload({ waitUntil: 'load' });
    if (await pnPage.$('#firstrun:not([hidden])')) { await pnPage.keyboard.press('Escape'); await pnPage.waitForTimeout(300); }
    const said = await pnPage.waitForFunction((w) => { const m = document.getElementById('phone-notify-msg'); return !!m && m.textContent === w; }, want, { timeout: 8000 })
      .then(() => want, () => pnPage.evaluate(() => { const m = document.getElementById('phone-notify-msg'); return m ? m.textContent : null; }));
    check('#6488: ' + (st.connected ? 'connected' : 'not connected') + ', off' + (st.offByChoice ? ' by choice' : ', never touched') + ': the sentence says so',
      said === want, JSON.stringify(said));
  }
  // #7448: a computer marked never to send (a demo or test install): off, the reason, and no button to press.
  pnState = { available: true, on: false, connected: true, offByChoice: false, defaultBecause: null, noPush: true,
    because: 'this computer is set never to send phone notices (a demo or test install)', kinds: pnState.kinds };
  await pnPage.reload({ waitUntil: 'load' });
  if (await pnPage.$('#firstrun:not([hidden])')) { await pnPage.keyboard.press('Escape'); await pnPage.waitForTimeout(300); }
  const noPushWant = 'Off. This computer is set never to send phone notices (a demo or test install).';
  const noPushSaid = await pnPage.waitForFunction((w) => { const m = document.getElementById('phone-notify-msg'); return !!m && m.textContent === w; }, noPushWant, { timeout: 8000 })
    .then(() => noPushWant, () => pnPage.evaluate(() => { const m = document.getElementById('phone-notify-msg'); return m ? m.textContent : null; }));
  check('#7448: a computer marked never to send says why', noPushSaid === noPushWant, JSON.stringify(noPushSaid));
  const noPushBtn = await pnPage.evaluate(() => { const b = document.getElementById('phone-notify-toggle'); return b ? b.disabled : null; });
  check('#7448: and offers no Turn on to press', noPushBtn === true, JSON.stringify(noPushBtn));
  check('#6254: no page errors while painting the sub-switches', pnErrors.length === 0, pnErrors.join(' | ').slice(0, 160));
  await pnCtx.close();

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  FAIL  ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });

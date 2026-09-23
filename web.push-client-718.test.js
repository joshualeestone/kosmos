'use strict';

/**
 * #718: the PWA push CLIENT flow (permission -> subscribe -> POST), behind the
 * node gate.
 *
 * The pure functions live in web/sw.js and are covered by web.sw-718.test.js;
 * the /sw.js route by server.sw-718.test.js. This file covers the remaining
 * behavioral block -- the `<script id="push-client">` in web/index.html:
 * `enablePush`, `reflectPushState`, `paintButton`, the retry-on-failure path and
 * the orphaned-subscription unsubscribe. That block only touches external
 * boundaries (navigator.serviceWorker, Notification, fetch), so it is tested the
 * same way web.post-receipt.test.js tests the app script: eval the block in a
 * `new Function` with those boundaries stubbed, then drive it.
 *
 * The block exposes window.kosmosEnablePush; reflectPushState runs on load via
 * the DOMContentLoaded handler the block registers (readyState is kept 'loading'
 * so it defers, and each test fires that handler when it wants the load paint).
 *
 *   node --test web.push-client-718.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
// The attributed push-client block (not the bare app <script>): from its open
// tag's end to the next </script>.
const open = PAGE.indexOf('<script id="push-client">');
assert.ok(open > -1, 'the push-client script block is gone');
const bodyStart = PAGE.indexOf('>', open) + 1;
const BLOCK = PAGE.slice(bodyStart, PAGE.indexOf('</script>', bodyStart));
assert.ok(/window\.kosmosEnablePush/.test(BLOCK), 'the extracted block is not the push client');

const flush = () => new Promise((r) => setTimeout(r, 5));

/* Build a fresh stubbed environment and eval the block into it. Returns handles
   to inspect what the block painted and which boundaries it hit. */
function load(opts) {
  opts = opts || {};
  const calls = { fetch: [], subscribeOpts: null, unsubscribed: false, registered: false };
  const elements = {
    'push-enable': {
      disabled: false, textContent: 'Turn on', _click: null,
      addEventListener(ev, cb) { if (ev === 'click') this._click = cb; },
    },
    'push-msg': { textContent: '' },
  };
  const fakeSub = {
    endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' },
    unsubscribe() { calls.unsubscribed = true; return Promise.resolve(true); },
  };
  const reg = {
    pushManager: {
      subscribe(o) { calls.subscribeOpts = o; return Promise.resolve(fakeSub); },
      getSubscription() {
        return Promise.resolve(Object.prototype.hasOwnProperty.call(opts, 'existingSub') ? opts.existingSub : null);
      },
    },
  };
  const navigator = opts.noSW ? {} : {
    serviceWorker: {
      register() { calls.registered = true; return Promise.resolve(reg); },
      ready: Promise.resolve(reg),
    },
  };
  const Notification = {
    permission: opts.permission || 'default',
    requestPermission() { return Promise.resolve(opts.requestResult || 'granted'); },
  };
  const win = { console: { warn() {} }, addEventListener() {} };
  if (!opts.noPush) { win.PushManager = function () {}; win.Notification = Notification; }
  const domHandlers = {};
  const document = {
    getElementById(id) { return elements[id]; },
    addEventListener(ev, cb) { domHandlers[ev] = cb; },
    readyState: 'loading',
  };
  const fetchStub = function (url) {
    calls.fetch.push(url);
    const r = opts.responses && opts.responses[url];
    if (r) return Promise.resolve(r);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ key: 'YWJjZA' }) });
  };
  // eslint-disable-next-line no-new-func
  new Function('navigator', 'window', 'document', 'Notification', 'fetch', BLOCK)(
    navigator, win, document, Notification, fetchStub,
  );
  return { win, elements, domHandlers, calls, fakeSub, btn: elements['push-enable'], msg: elements['push-msg'] };
}

test('happy path: permission granted, subscribe stored -> button On, disabled', async () => {
  const env = load({ requestResult: 'granted' });
  const ok = await env.win.kosmosEnablePush();
  assert.equal(ok, true);
  assert.equal(env.btn.textContent, 'On');
  assert.equal(env.btn.disabled, true);
  assert.equal(env.msg.textContent, 'Notifications are on for this device.');
  assert.equal(env.calls.subscribeOpts.userVisibleOnly, true, 'must subscribe userVisibleOnly');
  assert.ok(env.calls.fetch.includes('/v1/push/subscribe'), 'must POST the subscription to the board');
  assert.equal(env.calls.unsubscribed, false, 'a stored subscription must not be dropped');
});

test('POST failure: subscription is unsubscribed and the button stays retryable', async () => {
  const env = load({ requestResult: 'granted', responses: { '/v1/push/subscribe': { ok: false, status: 500 } } });
  const ok = await env.win.kosmosEnablePush();
  assert.equal(ok, false);
  assert.equal(env.calls.unsubscribed, true, 'the orphaned local subscription must be dropped when the board did not store it');
  assert.equal(env.btn.disabled, false, 'a failed enable must leave the button usable');
  assert.equal(env.btn.textContent, 'Turn on');
  assert.equal(env.msg.textContent, 'Could not turn on notifications. Please try again.');
});

test('permission denied: button Blocked, no network', async () => {
  const env = load({ requestResult: 'denied' });
  const ok = await env.win.kosmosEnablePush();
  assert.equal(ok, false);
  assert.equal(env.btn.textContent, 'Blocked');
  assert.equal(env.btn.disabled, true);
  assert.equal(env.calls.fetch.length, 0, 'a denied permission must not reach the network');
});

test('permission dismissed (default): button stays Turn on', async () => {
  const env = load({ requestResult: 'default' });
  const ok = await env.win.kosmosEnablePush();
  assert.equal(ok, false);
  assert.equal(env.btn.textContent, 'Turn on');
  assert.equal(env.btn.disabled, false);
  assert.equal(env.msg.textContent, 'Notifications were not turned on.');
});

test('unsupported browser: enablePush is a safe no-op with a plain message', async () => {
  const env = load({ noPush: true });
  const ok = await env.win.kosmosEnablePush();
  assert.equal(ok, false);
  assert.equal(env.msg.textContent, 'This device or browser does not support push notifications.');
  assert.equal(env.calls.fetch.length, 0);
});

test('load with a granted permission AND an existing subscription paints On', async () => {
  const env = load({ permission: 'granted', existingSub: { endpoint: 'https://push.example/x' } });
  env.domHandlers.DOMContentLoaded();   // wire() -> reflectPushState() + registerServiceWorker()
  await flush();
  assert.equal(env.btn.textContent, 'On');
  assert.equal(env.btn.disabled, true);
});

test('load with a granted permission but NO subscription stays actionable (does not lie On)', async () => {
  const env = load({ permission: 'granted', existingSub: null });
  env.domHandlers.DOMContentLoaded();
  await flush();
  assert.equal(env.btn.textContent, 'Turn on');
  assert.equal(env.btn.disabled, false);
});

test('clicking the Turn on button drives the enable flow (the wire() click binding)', async () => {
  // wire() binds the click handler on load; nothing else does. Fire DOMContentLoaded
  // so the binding happens, then invoke the captured click callback -- if the
  // addEventListener line were deleted or bound to the wrong element, _click stays
  // null and this fails.
  const env = load({ requestResult: 'granted' });
  env.domHandlers.DOMContentLoaded();
  await flush();
  assert.equal(typeof env.btn._click, 'function', 'the Turn on button has no click handler bound');
  env.btn._click();                 // simulate the user clicking Turn on
  await flush();
  await flush();
  assert.ok(env.calls.fetch.includes('/v1/push/subscribe'), 'clicking Turn on did not run the enable flow');
  assert.equal(env.btn.textContent, 'On');
});

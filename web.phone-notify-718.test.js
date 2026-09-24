'use strict';

/**
 * #718: the Phone notifications control in the `<script id="push-client">`
 * block of web/index.html. The block only touches external boundaries
 * (navigator.serviceWorker, fetch, the DOM), so it is tested the way
 * web.post-receipt.test.js tests the app script: eval it with those stubbed.
 * The server half (/api/phone-notify, what leaves the Mac) is
 * server.phonenotify-718.test.js.
 *
 *   node --test web.phone-notify-718.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const open = PAGE.indexOf('<script id="push-client">');
assert.ok(open > -1, 'the push-client script block is gone');
const bodyStart = PAGE.indexOf('>', open) + 1;
const BLOCK = PAGE.slice(bodyStart, PAGE.indexOf('</script>', bodyStart));
assert.ok(/window\.kosmosPhoneNotifyToggle/.test(BLOCK), 'the extracted block is not the phone-notify client');

const flush = () => new Promise((r) => setTimeout(r, 5));
const SIGNIN = 'https://login.example.test/signin';

function load(opts) {
  opts = opts || {};
  const calls = { fetch: [], registered: false };
  const mk = (extra) => Object.assign({ textContent: '', hidden: true, disabled: false, href: '#' }, extra);
  const elements = {
    'phone-notify-toggle': mk({ disabled: true, textContent: 'Turn on', _click: null,
      addEventListener(ev, cb) { if (ev === 'click') this._click = cb; } }),
    'phone-notify-msg': mk(),
    'phone-notify-step': mk(),
    'phone-notify-link': mk(),
  };
  let state = Object.assign({ on: false, connected: true, signinUrl: SIGNIN }, opts.state);
  const navigator = opts.noSW ? {} : { serviceWorker: { register() { calls.registered = true; return Promise.resolve({}); } } };
  const win = { console: { warn() {} } };
  const domHandlers = {};
  const document = {
    getElementById(id) { return elements[id]; },
    addEventListener(ev, cb) { domHandlers[ev] = cb; },
    readyState: 'loading',
  };
  const fetchStub = function (url, init) {
    const method = (init && init.method) || 'GET';
    calls.fetch.push({ url, method, body: init && init.body ? JSON.parse(init.body) : null });
    if (opts.fetchFails) return Promise.reject(new Error('offline'));
    if (method === 'PUT') {
      if (opts.putError) return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: opts.putError }) });
      state = Object.assign({}, state, { on: JSON.parse(init.body).on });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(state) });
  };
  // eslint-disable-next-line no-new-func
  new Function('navigator', 'window', 'document', 'fetch', BLOCK)(navigator, win, document, fetchStub);
  const e = elements;
  return { win, calls, domHandlers, btn: e['phone-notify-toggle'], msg: e['phone-notify-msg'], step: e['phone-notify-step'], link: e['phone-notify-link'] };
}

test('load, off and connected: Turn on, no phone step shown, worker registered', async () => {
  const h = load();
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.btn.disabled, false);
  assert.equal(h.btn.textContent, 'Turn on');
  assert.equal(h.step.hidden, true);
  assert.equal(h.calls.registered, true);
  assert.deepEqual(h.calls.fetch.map((c) => c.method + ' ' + c.url), ['GET /api/phone-notify']);
});

test('not connected to Kosmos+: the button stays disabled and says why', async () => {
  const h = load({ state: { connected: false } });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.btn.disabled, true);
  assert.match(h.msg.textContent, /Connect this Mac to Kosmos\+ first/);
  assert.equal(await h.win.kosmosPhoneNotifyToggle(), false);
  assert.equal(h.calls.fetch.filter((c) => c.method === 'PUT').length, 0, 'a PUT went out for a Mac that is not connected');
});

test('turning on PUTs on:true, then shows Turn off and the phone step with the sign-in link', async () => {
  const h = load();
  h.domHandlers.DOMContentLoaded(); await flush();
  h.btn._click(); await flush();
  const put = h.calls.fetch.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, { on: true });
  assert.equal(h.btn.textContent, 'Turn off');
  assert.equal(h.step.hidden, false);
  assert.equal(h.link.href, SIGNIN);
  assert.equal(h.link.textContent, SIGNIN);
});

test('turning off from on PUTs on:false and hides the phone step', async () => {
  const h = load({ state: { on: true } });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.step.hidden, false);
  await h.win.kosmosPhoneNotifyToggle();
  assert.deepEqual(h.calls.fetch.find((c) => c.method === 'PUT').body, { on: false });
  assert.equal(h.btn.textContent, 'Turn on');
  assert.equal(h.step.hidden, true);
});

test('a refused PUT shows the board\'s words and stays retryable', async () => {
  const h = load({ putError: 'Kosmos+ did not answer: down' });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(await h.win.kosmosPhoneNotifyToggle(), false);
  assert.equal(h.msg.textContent, 'Kosmos+ did not answer: down');
  assert.equal(h.btn.disabled, false);
  assert.equal(h.btn.textContent, 'Turn on');
});

test('a second toggle while one is in flight is a no-op', async () => {
  const h = load();
  h.domHandlers.DOMContentLoaded(); await flush();
  const a = h.win.kosmosPhoneNotifyToggle();
  const b = h.win.kosmosPhoneNotifyToggle();
  await Promise.all([a, b]);
  assert.equal(h.calls.fetch.filter((c) => c.method === 'PUT').length, 1);
});

test('an unreadable setting disables the control and says so', async () => {
  const h = load({ fetchFails: true });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.btn.disabled, true);
  assert.match(h.msg.textContent, /could not be read/);
});

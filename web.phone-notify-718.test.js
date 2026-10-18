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

function load(opts) {
  opts = opts || {};
  const calls = { fetch: [], registered: false };
  const mk = (extra) => Object.assign({ textContent: '', hidden: true, disabled: false, href: '#', setAttribute() {} }, extra);
  const clickable = (extra) => mk(Object.assign({ _click: null, addEventListener(ev, cb) { if (ev === 'click') this._click = cb; } }, extra));
  const KINDS = ['needsYou', 'replied', 'postedMention', 'ready', 'postedRoom'];   // #6254
  const elements = {
    'phone-notify-toggle': clickable({ disabled: true, textContent: 'Turn on' }),
    'phone-notify-msg': mk(),
    'phone-notify-step': mk(),
    'phone-notify': mk({ hidden: true }),
    'phone-notify-kinds': mk({ hidden: true }),   // #6254: the sub-switch container
  };
  for (const name of KINDS) elements['pn-kind-' + name] = clickable({ textContent: '' });   // #6254: one button per kind
  // #6254: the per-kind defaults the server resolves (postedRoom off, the rest on).
  const DEFAULT_KINDS = { needsYou: true, replied: true, postedMention: true, ready: true, postedRoom: false };
  let state = Object.assign({ available: true, on: false, connected: true, kinds: Object.assign({}, DEFAULT_KINDS) }, opts.state);
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
      const put = JSON.parse(init.body);
      if (typeof put.kind === 'string') {   // #6254: a sub-switch PUT { kind, on }
        state = Object.assign({}, state, { kinds: Object.assign({}, state.kinds, { [put.kind]: put.on }) });
      } else {
        state = Object.assign({}, state, { on: put.on });
      }
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(state) });
  };
  // eslint-disable-next-line no-new-func
  new Function('navigator', 'window', 'document', 'fetch', BLOCK)(navigator, win, document, fetchStub);
  const e = elements;
  return { win, calls, domHandlers, section: e['phone-notify'], btn: e['phone-notify-toggle'], msg: e['phone-notify-msg'], step: e['phone-notify-step'],
    kindsBox: e['phone-notify-kinds'], kindBtn: (name) => e['pn-kind-' + name], state: () => state };   // #6254
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
  assert.match(h.msg.textContent, /turns on by itself once this computer is connected to Kosmos\+/);   // #6488
  assert.equal(await h.win.kosmosPhoneNotifyToggle(), false);
  assert.equal(h.calls.fetch.filter((c) => c.method === 'PUT').length, 0, 'a PUT went out for a Mac that is not connected');
});

test('#6488: the Settings words follow whether the off was the person\'s choice', async () => {
  for (const [state, want] of [
    [{ connected: false, offByChoice: true }, /^Off\. You can turn it on once this computer is connected to Kosmos\+\.$/],
    [{ connected: true, on: false, offByChoice: false }, /^Not on yet\. It turns on by itself, or press Turn on now\.$/],
    [{ connected: true, on: false, offByChoice: true }, /^$/],
    [{ connected: true, on: true }, /^On for this computer\.$/],
  ]) {
    const h = load({ state });
    h.domHandlers.DOMContentLoaded(); await flush();
    assert.match(h.msg.textContent, want, JSON.stringify(state));
  }
});

test('turning on PUTs on:true, then shows Turn off and the phone-app step', async () => {
  const h = load();
  h.domHandlers.DOMContentLoaded(); await flush();
  h.btn._click(); await flush();
  const put = h.calls.fetch.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, { on: true });
  assert.equal(h.btn.textContent, 'Turn off');
  assert.equal(h.step.hidden, false);
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

test('on but no longer connected: says nothing is sent, and can still be turned off', async () => {
  const h = load({ state: { on: true, connected: false } });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.btn.disabled, false);
  assert.equal(h.btn.textContent, 'Turn off');
  assert.match(h.msg.textContent, /not connected to Kosmos\+, so nothing is sent/);
  await h.win.kosmosPhoneNotifyToggle();
  assert.deepEqual(h.calls.fetch.find((c) => c.method === 'PUT').body, { on: false });
});

test('ship gate closed: the section stays hidden and nothing can be turned on', async () => {
  const h = load({ state: { available: false } });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.section.hidden, true, 'the section showed while phone notifications are not available');
  assert.equal(await h.win.kosmosPhoneNotifyToggle(), false);
  assert.equal(h.calls.fetch.filter((c) => c.method === 'PUT').length, 0);
});

test('ship gate open: the section shows (the control for the closed arm)', async () => {
  const h = load();
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.section.hidden, false);
});

/* #6254: the per-kind sub-switches under the master. */
test('#6254: the sub-switches are hidden while off, shown and painted from kinds when on', async () => {
  const off = load();
  off.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(off.kindsBox.hidden, true, 'the sub-switches showed while phone notifications are off');

  const on = load({ state: { on: true } });
  on.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(on.kindsBox.hidden, false, 'the sub-switches stayed hidden with the master on');
  assert.equal(on.kindBtn('needsYou').textContent, 'On', 'needsYou defaults on');
  assert.equal(on.kindBtn('ready').textContent, 'On', 'ready defaults on');
  assert.equal(on.kindBtn('postedRoom').textContent, 'Off', 'postedRoom defaults off');
});

test('#6254: clicking a sub-switch PUTs { kind, on } and repaints from the answer', async () => {
  const h = load({ state: { on: true } });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.kindBtn('postedRoom').textContent, 'Off');
  h.kindBtn('postedRoom')._click(); await flush();
  const put = h.calls.fetch.find((c) => c.method === 'PUT');
  assert.deepEqual(put.body, { kind: 'postedRoom', on: true }, 'the sub-switch did not PUT its own kind turning on');
  assert.equal(h.kindBtn('postedRoom').textContent, 'On', 'the switch did not repaint on after the PUT');
  // CONTROL: a second click turns it back off (the PUT carries the flipped value, the paint follows).
  h.kindBtn('postedRoom')._click(); await flush();
  const puts = h.calls.fetch.filter((c) => c.method === 'PUT');
  assert.deepEqual(puts[puts.length - 1].body, { kind: 'postedRoom', on: false });
  assert.equal(h.kindBtn('postedRoom').textContent, 'Off');
});

test('#6254: a sub-switch does nothing while the master is off (no PUT)', async () => {
  const h = load();   // master off
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(await h.win.kosmosPhoneNotifyKindToggle('ready'), false, 'a sub-switch acted with the master off');
  assert.equal(h.calls.fetch.filter((c) => c.method === 'PUT').length, 0, 'a sub-switch PUT went out with the master off');
});

test('#6254: turning the master off hides the sub-switches again', async () => {
  const h = load({ state: { on: true } });
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(h.kindsBox.hidden, false);
  await h.win.kosmosPhoneNotifyToggle();   // master off
  assert.equal(h.kindsBox.hidden, true, 'the sub-switches stayed shown after turning the master off');
});

test('#6254: the client exposes kosmosPhoneNotifyKindToggle()', async () => {
  const h = load();
  h.domHandlers.DOMContentLoaded(); await flush();
  assert.equal(typeof h.win.kosmosPhoneNotifyKindToggle, 'function');
});

test('#6254: the page carries the sub-switch container and one button per kind, hidden to start', () => {
  const start = PAGE.indexOf('<div id="phone-notify-kinds"');
  assert.ok(start > -1, 'the sub-switch container is gone');
  assert.match(PAGE.slice(start, start + 70), /hidden/, 'the sub-switch container is not hidden in the markup');
  for (const name of ['needsYou', 'replied', 'postedMention', 'ready', 'postedRoom']) {
    assert.match(PAGE, new RegExp('id="pn-kind-' + name + '"[^>]*data-kind="' + name + '"'), 'missing the ' + name + ' sub-switch button');
  }
  // postedRoom ships Off in the markup (its default); a default-on kind ships On.
  assert.match(PAGE, /id="pn-kind-postedRoom"[^>]*aria-pressed="false"[^>]*>Off</);
  assert.match(PAGE, /id="pn-kind-ready"[^>]*aria-pressed="true"[^>]*>On</);
});

test('the section is hidden in the page markup, before any script runs', () => {
  assert.match(PAGE, /<section class="dbox" id="phone-notify" hidden>/);
});

/* #4194: with the ship gate open, a Mac user without the phone app must not be misled: the section says the app is in
   testing (an Android test build, not in the stores yet), inside the section so it shows exactly when the section does. */
test('#4194: the Phone notifications section says the phone app is in testing, not in the stores yet', () => {
  const start = PAGE.indexOf('<section class="dbox" id="phone-notify"');
  const end = PAGE.indexOf('</section>', start);
  assert.ok(start > 0 && end > start, 'the Phone notifications section moved');
  const section = PAGE.slice(start, end);
  const note = (section.match(/<p class="dhint" id="phone-notify-testing"[^>]*>([^<]*)<\/p>/) || [])[1] || '';
  assert.match(note, /still in testing/, 'the section does not say the app is in testing: ' + note);
  assert.match(note, /Android test build/);
  assert.match(note, /not in the App Store or Google Play/);
  // #4194 review (Sonya): the 30-minute needs_you email can still arrive with no phone, so the note must not say nothing does.
  assert.match(note, /these will not reach your phone/, 'the note should say only what it means: not on your phone');
  assert.doesNotMatch(note, /anywhere/, 'the note says nothing arrives anywhere, but the needs_you email can: ' + note);
  assert.ok(section.indexOf('phone-notify-testing') < section.indexOf('phone-notify-toggle'), 'the note should come before the switch');
});

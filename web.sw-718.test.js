'use strict';

/**
 * #718: the service worker's two PURE functions, behind the node gate.
 *
 * `boardUrlFor` is the arbitrary-navigation boundary -- its output is handed
 * straight to clients.openWindow()/navigate() in notificationclick -- and
 * `notificationFor` maps the coordinator's real EventSummary payload
 * {kind, agent, project, id, address} into the shown notification. Both were
 * previously exercised only by docs/browser-checks/render-push-718.js, which
 * does not run in `yarn test` and only delivers one happy-path payload; it never
 * proves the allowlist REJECTS a hostile address. These are pure functions, so a
 * node test can eval them from the worker source and pin both the happy path and
 * the rejection path where the pre-PR gate can see them.
 *
 * HOW: sw.js is a service worker (top-level `self.addEventListener(...)`), so it
 * cannot be `require`d in node. We eval it inside `new Function` with a `self`
 * stub whose addEventListener is a no-op, and return the two functions from the
 * worker's own scope. Nothing in this file calls the registered handlers, so the
 * stubbed globals are never dereferenced.
 *
 *   node --test web.sw-718.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'web', 'sw.js'), 'utf8');
// eslint-disable-next-line no-new-func
const factory = new Function('self', 'caches', src + '\nreturn { boardUrlFor, notificationFor };');
const selfStub = { addEventListener() {}, location: { origin: 'https://board.example' } };
const { boardUrlFor, notificationFor } = factory(selfStub, {});

test('boardUrlFor builds an https URL only from a valid hostname address', () => {
  assert.equal(boardUrlFor({ address: 'study.kosmos.io' }), 'https://study.kosmos.io/');
  assert.equal(boardUrlFor({ address: 'a.b.example.com' }), 'https://a.b.example.com/');
  assert.equal(boardUrlFor({ address: 'mac-1.nonprod.example.com' }), 'https://mac-1.nonprod.example.com/');
});

test('boardUrlFor REJECTS hostile or malformed addresses (the arbitrary-navigation boundary)', () => {
  // A colon (scheme), a slash (path), an @ (userinfo), or whitespace must never
  // survive -- each is how a value could become a `javascript:` URI, a foreign
  // path, or a spoofed origin once it reaches openWindow()/navigate().
  for (const bad of [
    'javascript:alert(1)',
    'evil.com/path',
    'user@evil.com',
    'has space.com',
    'https://evil.com',        // a full URL is not a bare hostname
    'nohost',                  // single label, no dot
    '',
    '.leadingdot.com',
    'trailingdot.',
  ]) {
    assert.equal(boardUrlFor({ address: bad }), '/', 'must reject: ' + JSON.stringify(bad));
  }
  assert.equal(boardUrlFor({}), '/');
});

test('boardUrlFor does NOT honor a `url` field (removed passthrough)', () => {
  // A `url` alone is ignored (the coordinator never sends one); a hostile `url`
  // alongside a valid `address` still resolves to the address, never the url.
  assert.equal(boardUrlFor({ url: 'https://evil.com' }), '/');
  assert.equal(boardUrlFor({ url: 'javascript:alert(1)' }), '/');
  assert.equal(boardUrlFor({ url: 'javascript:alert(1)', address: 'ok.example.com' }), 'https://ok.example.com/');
});

function ev(payload) { return { data: { json: () => payload } }; }

test('notificationFor maps the coordinator payload to who/what + a Mac click-through', () => {
  const { title, options } = notificationFor(ev({
    kind: 'needs_you', agent: 'Scorpion', project: 'Kosmos Inside Out',
    id: 'evt-1', address: 'study.kosmos.io',
  }));
  assert.equal(title, 'Scorpion needs you');
  assert.equal(options.body, 'In Kosmos Inside Out');
  assert.equal(options.data.url, 'https://study.kosmos.io/');
  assert.equal(options.tag, 'kosmos-evt-1');
});

test('notificationFor renders each kind, and falls back safely', () => {
  assert.equal(notificationFor(ev({ kind: 'posted', agent: 'Sonya' })).title, 'Sonya posted an update');
  assert.equal(notificationFor(ev({ kind: 'replied', agent: 'Sonya' })).title, 'Sonya replied');
  assert.equal(notificationFor(ev({ kind: 'weird', agent: 'Sonya' })).title, 'Sonya has an update');
  // No agent -> a generic actor, never undefined text.
  assert.equal(notificationFor(ev({ kind: 'needs_you' })).title, 'An agent needs you');
  // No project -> a plain prompt, not an empty body.
  assert.equal(notificationFor(ev({ kind: 'needs_you', agent: 'Raiden' })).options.body,
    'Open Kosmos to see what happened.');
  // No address -> the board on this origin, not a broken link.
  assert.equal(notificationFor(ev({ kind: 'needs_you', agent: 'Raiden' })).options.data.url, '/');
});

test('notificationFor honors an explicit title/body and survives a payload-less push', () => {
  const explicit = notificationFor(ev({ title: 'Custom', body: 'Text' }));
  assert.equal(explicit.title, 'Custom');
  assert.equal(explicit.options.body, 'Text');
  // A push with no data at all must not throw and must render a default.
  const none = notificationFor({ data: null });
  assert.ok(none.title && none.options.body, 'a payload-less push produced an empty notification');
  // A valid but NON-OBJECT body (JSON null, a number, a bare string) must also
  // render a default rather than throwing on a property read and dropping the push.
  for (const weird of [null, 42, 'a bare string', true]) {
    const n = notificationFor(ev(weird));
    assert.ok(n.title && n.options.body, 'a non-object push body (' + JSON.stringify(weird) + ') was dropped');
  }
});

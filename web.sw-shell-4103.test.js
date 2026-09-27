'use strict';

/**
 * #4103: the installed phone app's offline copy of '/' is only ever the board, never the relay's Kosmos+ sign-in
 * page. web/sw.js's real install and fetch handlers run here against stubbed caches and fetch, with real Responses.
 *
 *   node --test web.sw-shell-4103.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'web', 'sw.js'), 'utf8');
const BOARD = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');   // the real board page
const SIGNIN = '<!doctype html><html><head><title>Kosmos+ sign in</title></head><body>Sign in to Kosmos+</body></html>';

// A same-origin 200, as a navigation through the relay returns it (fetch's type is 'basic' for same-origin).
function page(html) {
  const r = new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  Object.defineProperty(r, 'type', { value: 'basic' });
  const clone = r.clone.bind(r);
  r.clone = () => { const c = clone(); Object.defineProperty(c, 'type', { value: 'basic' }); return c; };
  return r;
}

function worker(fetchImpl) {
  const handlers = {}; const puts = []; const added = [];
  const cache = { put: async (k, v) => { puts.push([typeof k === 'string' ? k : k.url, await v.text()]); }, addAll: async (a) => { added.push(...a); } };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => null };
  const self = { addEventListener: (k, f) => { handlers[k] = f; }, location: { origin: 'https://hers.kosmosplus.com', hostname: 'hers.kosmosplus.com' }, skipWaiting() {} };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', src)(self, caches, fetchImpl);
  return { handlers, puts, added };
}

async function navigate(w, reqUrl) {
  const waits = []; let responded;
  w.handlers.fetch({ request: { method: 'GET', url: reqUrl, mode: 'navigate' }, respondWith(p) { responded = p; }, waitUntil(p) { waits.push(p); } });
  const res = await responded;
  await Promise.all(waits);
  return res;
}

test('#4103: a navigation that returns the board is cached as the offline copy', async () => {
  const w = worker(async () => page(BOARD));
  const res = await navigate(w, 'https://hers.kosmosplus.com/');
  assert.equal(w.puts.length, 1);
  assert.equal(w.puts[0][0], '/');
  assert.equal(w.puts[0][1], BOARD, 'the cached copy is not the whole board');
  assert.equal(await res.text(), BOARD, 'the page itself did not get the whole board');
});

test('#4103: a navigation that returns the relay sign-in page is NOT cached (the page still gets it)', async () => {
  const w = worker(async () => page(SIGNIN));
  const res = await navigate(w, 'https://hers.kosmosplus.com/');
  assert.deepEqual(w.puts, [], 'the sign-in page became the offline copy');
  assert.equal(await res.text(), SIGNIN);
});

test('#4103: a page whose marker is past the scanned prefix is not taken for the board', async () => {
  const late = '<html><head>' + ' '.repeat(20000) + '<meta name="kosmos-version" content="0.7.01"></head></html>';
  const w = worker(async () => page(late));
  await navigate(w, 'https://hers.kosmosplus.com/');
  assert.deepEqual(w.puts, []);
});

test('#4103: install pre-caches the board, never the sign-in page, and still caches the manifest and icons', async () => {
  for (const [html, expectPut] of [[BOARD, true], [SIGNIN, false]]) {
    const w = worker(async () => page(html));
    let done; w.handlers.install({ waitUntil(p) { done = p; } });
    await done;
    assert.deepEqual(w.added, ['/manifest.webmanifest', '/icons/kosmos-192.png', '/icons/kosmos-512.png']);
    assert.equal(w.puts.some(([k]) => k === '/'), expectPut, (expectPut ? 'the board was not' : 'the sign-in page was') + ' pre-cached as /');
  }
});

test('#4103: a non-navigation GET of / goes to the network untouched (never cached, never served from the cache)', async () => {
  const w = worker(async () => page('<html>SIGN-IN</html>'));
  let responded = false; const waits = [];
  w.handlers.fetch({ request: { method: 'GET', url: 'https://hers.kosmosplus.com/', mode: 'cors' }, respondWith() { responded = true; }, waitUntil(p) { waits.push(p); } });
  await Promise.all(waits);
  assert.equal(responded, false, 'the worker answered a non-navigation GET of /');
  assert.deepEqual(w.puts, []);
});
test('#4103 CONTROL: the manifest still goes through the worker\'s cache', async () => {
  const w = worker(async () => page('{"name":"Kosmos"}'));
  let responded = null;
  w.handlers.fetch({ request: { method: 'GET', url: 'https://hers.kosmosplus.com/manifest.webmanifest', mode: 'cors' }, respondWith(p) { responded = p; }, waitUntil() {} });
  assert.ok(responded, 'the manifest was not served by the worker');
});
test('#4103: a redirected response is not cached as the offline copy', async () => {
  const r = page(BOARD); Object.defineProperty(r, 'redirected', { value: true });
  const w = worker(async () => r);
  await navigate(w, 'https://hers.kosmosplus.com/');
  assert.deepEqual(w.puts, []);
});

test('#4103: the shell cache is a new version, so a copy the old worker poisoned is dropped on activate', () => {
  assert.match(src, /const SHELL_CACHE = 'kosmos-shell-v2';/);
});

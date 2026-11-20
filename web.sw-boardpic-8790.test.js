'use strict';
/**
 * kosmos#8790: on a browser that sends no Sec-Fetch-Site (Safari before 16.4) a Kosmos+ computer's connector refuses
 * the board's pictures, since an image load cannot carry X-Kosmos-Board-Page. web/sw.js asks again for such a refused
 * picture, once, with that header. Runs the real worker's fetch handler against a fetch that records what it was asked.
 *
 *   node --test web.sw-boardpic-8790.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'web', 'sw.js'), 'utf8');
const ORIGIN = 'https://hers.kosmosplus.com';

function worker(answer) {
  const handlers = {}; const asked = [];
  const caches = { open: async () => ({ put: async () => {}, addAll: async () => {} }), keys: async () => [], delete: async () => true, match: async () => null };
  const self = { addEventListener: (k, f) => { handlers[k] = f; }, location: { origin: ORIGIN, hostname: 'hers.kosmosplus.com' }, skipWaiting() {} };
  const fetchImpl = async (input, init) => {
    const rec = { url: typeof input === 'string' ? input : input.url, header: init && init.headers ? new Headers(init.headers).get('X-Kosmos-Board-Page') : null, init };
    asked.push(rec);
    return answer(rec, asked.length);
  };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', src)(self, caches, fetchImpl);
  return { handlers, asked };
}
function req(url, extra) {
  return Object.assign({ method: 'GET', url: ORIGIN + url, mode: 'no-cors', destination: 'image', headers: new Headers() }, extra);
}
async function run(w, request) {
  let responded = null;
  w.handlers.fetch({ request, respondWith(p) { responded = p; }, waitUntil() {} });
  return responded === null ? 'not handled' : responded;
}
const PIC = () => new Response('png', { status: 200, headers: { 'content-type': 'image/png' } });
const REFUSED = (s) => () => new Response('{"error":"sign in"}', { status: s, headers: { 'content-type': 'application/json' } });
// The connector: a picture only for a request with the header.
const connector = (rec) => (rec.header === '1' ? PIC() : REFUSED(401)());

test('kosmos#8790: a refused board picture (401) is asked for once more with X-Kosmos-Board-Page: 1, and that is the picture', async () => {
  const w = worker(connector);
  const res = await run(w, req('/api/agent/max/avatar?v=3'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'png');
  assert.equal(w.asked.length, 2);
  assert.equal(w.asked[0].header, null, 'the first ask is the browser\'s own request, untouched');
  assert.equal(w.asked[1].url, ORIGIN + '/api/agent/max/avatar?v=3', 'the same address');
  assert.equal(w.asked[1].header, '1');
  assert.equal(w.asked[1].init.credentials, 'same-origin');
  assert.equal(w.asked[1].init.redirect, 'error', 'the header never follows a redirect');
});

test('kosmos#8790: a 403 refusal is retried the same way', async () => {
  const w = worker((rec) => (rec.header === '1' ? PIC() : REFUSED(403)()));
  const res = await run(w, req('/api/you/avatar?v=1'));
  assert.equal(res.status, 200);
  assert.equal(w.asked.length, 2);
});

test('kosmos#8790: a picture that loads, a 404 and a 500 are the browser\'s own answer, never asked again', async () => {
  for (const [answer, status] of [[PIC, 200], [REFUSED(404), 404], [REFUSED(500), 500]]) {
    const w = worker(answer);
    const res = await run(w, req('/api/attachment/0123456789abcdef01234567/preview'));
    assert.equal(res.status, status);
    assert.equal(w.asked.length, 1, status + ' was asked for again');
  }
});

test('kosmos#8790: when the retry is refused too, or fails, the first answer stands', async () => {
  const w = worker(REFUSED(401));
  const res = await run(w, req('/api/agent/max/avatar'));
  assert.equal(res.status, 401);
  assert.equal(w.asked.length, 2, 'retried once, not more');
  const w2 = worker((rec, n) => { if (n === 2) throw new TypeError('Failed to fetch'); return REFUSED(401)(); });
  const res2 = await run(w2, req('/api/agent/max/avatar'));
  assert.equal(res2.status, 401);
});

test('kosmos#8790: not a picture, not this origin, not /api/, a navigation or a write: the worker does not touch it', async () => {
  const w = worker(connector);
  assert.equal(await run(w, req('/api/status', { destination: '', mode: 'cors' })), 'not handled', 'a page fetch (destination "", cors)');
  assert.equal(await run(w, req('/api/status', { destination: '', mode: 'cors', headers: new Headers({ accept: 'image/png' }) })), 'not handled', 'a page fetch asking for an image type is still a fetch');
  assert.equal(await run(w, req('/api/x.js', { destination: 'script' })), 'not handled', 'a script');
  assert.equal(await run(w, req('/api/agent/max/avatar', { destination: 'document', mode: 'navigate' })), 'not handled', 'a navigation');
  assert.equal(await run(w, req('/api/agent/max/avatar', { method: 'POST' })), 'not handled', 'a write');
  assert.equal(await run(w, { method: 'GET', url: 'https://other.kosmosplus.com/api/agent/max/avatar', mode: 'no-cors', destination: 'image', headers: new Headers() }), 'not handled', 'another computer\'s board');
  assert.equal(await run(w, req('/brand/kosmos-mark.png')), 'not handled', 'a picture not under /api/');
  assert.equal(w.asked.length, 0);
});

test('kosmos#8790: a browser without Request.destination is told a picture by the Accept header an image load sends', async () => {
  const w = worker(connector);
  const old = req('/api/agent/max/avatar', { destination: undefined, headers: new Headers({ accept: 'image/webp,image/png,image/svg+xml,image/*;q=0.8,video/*;q=0.8,*/*;q=0.5' }) });
  const res = await run(w, old);
  assert.equal(res.status, 200);
  const plain = req('/api/status', { destination: undefined, headers: new Headers({ accept: '*/*' }) });
  assert.equal(await run(w, plain), 'not handled');
  const oldWebKit = req('/api/agent/max/avatar', { destination: '', headers: new Headers({ accept: 'image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' }) });
  assert.equal((await run(w, oldWebKit)).status, 200, 'an engine that leaves destination empty on an image load (no-cors, image Accept)');
});

test('kosmos#8790: the page can ask a ready worker to take charge of it ("claim"); any other message is ignored', async () => {
  const w = worker(connector);
  let claimed = 0;
  const handlers = {};
  const self = { addEventListener: (k, f) => { handlers[k] = f; }, location: { origin: ORIGIN, hostname: 'hers.kosmosplus.com' }, skipWaiting() {}, clients: { claim: async () => { claimed++; } } };
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', src)(self, { open: async () => ({}), keys: async () => [], match: async () => null }, async () => PIC());
  assert.equal(typeof handlers.message, 'function', 'the worker listens for messages');
  const waits = [];
  handlers.message({ data: 'something else', waitUntil: (p) => waits.push(p) });
  assert.equal(claimed, 0);
  handlers.message({ data: 'claim', waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(claimed, 1);
  assert.ok(w);
});

test('kosmos#8790: the page notes pictures that failed before the worker was in charge, and asks for them again at the same address', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = page.indexOf("sw.addEventListener('controllerchange'");
  assert.ok(at > -1, 'the first-visit reloader is gone');
  const block = page.slice(page.lastIndexOf('(() => {', at), page.indexOf('})();', at));
  assert.doesNotMatch(block, /stopImmediatePropagation|stopPropagation|preventDefault/, 'it must hold back no error from the other listeners');
  assert.match(block, /el\.setAttribute\(attr, raw\)/, 'it asks again at the element\'s own address');
  assert.match(block, /'image' \? 'href'/, 'SVG <image href> avatars are covered too');
  assert.match(block, /LPV_FAILED\.clear\(\)/, 'kosmos#8636\'s failed preview list is emptied, so previews draw again');
  assert.match(block, /setTimeout\(stop, 120000\)/, 'it stops listening after two minutes');
  assert.match(block, /postMessage\('claim'\)/, 'it asks a ready worker to take charge');
});

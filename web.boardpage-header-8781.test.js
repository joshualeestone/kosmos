'use strict';
/**
 * kosmos#8781: the board page's own fetches carry X-Kosmos-Board-Page: 1, so a computer's connector can give the board
 * token to a browser that sends no Sec-Fetch-Site (Safari before 16.4) on the page's own reads, and to nothing another
 * site starts (kosmos-relay proxy.rs same_origin_without_fetch_site). Runs the page's real fetch wrapper, sliced from
 * web/index.html, against a fetch that records what it was given.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

function wrapped() {
  const start = SCRIPT.indexOf('const nativeFetch = window.fetch;');
  assert.ok(start > -1, 'the page\'s fetch wrapper is gone');
  const iife = SCRIPT.slice(SCRIPT.lastIndexOf('(() => {', start), SCRIPT.indexOf('})();', start) + 5);
  // The slice must be the whole wrapper, or what follows tests a fragment: say so plainly instead of failing oddly.
  assert.ok(iife.includes('function withBoardPageHeader') && iife.includes('function fetchReadingRefusals') && iife.trimEnd().endsWith('})();'),
    'the fetch wrapper could not be sliced whole from the page');
  const sent = [];
  const win = { fetch: (input, init) => { sent.push({ input, init }); return Promise.resolve({ ok: true, status: 200, url: 'http://board.test/api/x' }); } };
  vm.runInNewContext(liftAll(SCRIPT, ['sameOriginReply', 'requestMethod', 'writeRequest', 'requestKey', 'hideStepUpAsk', 'showStepUpAsk']) + '\n' + iife,
    { window: win, URL, Headers, location: { href: 'http://board.test/board', origin: 'http://board.test' }, document: { getElementById: () => null } });
  return { fetch: win.fetch, sent };
}
const header = (rec) => (rec.init && rec.init.headers ? new Headers(rec.init.headers).get('X-Kosmos-Board-Page') : null);

test('kosmos#8781: the page\'s own requests carry X-Kosmos-Board-Page: 1, and requests to another origin do not', async () => {
  const w = wrapped();
  await w.fetch('/api/status');
  await w.fetch('http://board.test/api/projects');
  await w.fetch(new URL('/api/agents', 'http://board.test/'));
  await w.fetch('https://other.kosmos.test/api/status', { credentials: 'include' });
  assert.equal(header(w.sent[0]), '1', 'a relative read');
  assert.equal(header(w.sent[1]), '1', 'an absolute read of this board');
  assert.equal(header(w.sent[2]), '1', 'a URL object for this board');
  assert.equal(header(w.sent[3]), null, 'another computer\'s board: a custom header there would force a preflight');
  assert.deepEqual(w.sent[3].init, { credentials: 'include' }, 'and its init is passed as it was');
});

test('kosmos#8781: the page\'s own headers and method are kept, and a header already set is not doubled', async () => {
  const w = wrapped();
  await w.fetch('/api/post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await w.fetch('/api/x', { headers: { 'x-kosmos-board-page': '0' } });
  const h = new Headers(w.sent[0].init.headers);
  assert.equal(w.sent[0].init.method, 'POST');
  assert.equal(w.sent[0].init.body, '{}');
  assert.equal(h.get('content-type'), 'application/json');
  assert.equal(h.get('X-Kosmos-Board-Page'), '1');
  assert.equal(new Headers(w.sent[1].init.headers).get('X-Kosmos-Board-Page'), '0', 'a value the caller set (in any case) is kept, not replaced or doubled');
});

test('kosmos#8781: protocol-relative, data: and about: URLs, and headers given as a Headers object or as pairs', async () => {
  const w = wrapped();
  await w.fetch('//other.kosmos.test/api/x');
  await w.fetch('//board.test/api/x');
  await w.fetch('data:text/plain,hi');
  await w.fetch('about:blank');
  await w.fetch('/api/a', { headers: new Headers({ accept: 'application/json' }) });
  await w.fetch('/api/b', { headers: [['accept', 'text/plain']] });
  assert.equal(header(w.sent[0]), null, 'a protocol-relative URL to another host gets no header');
  assert.equal(header(w.sent[1]), '1', 'a protocol-relative URL to this board gets it');
  assert.equal(header(w.sent[2]), null, 'a data: URL (an opaque origin) gets no header');
  assert.equal(header(w.sent[3]), null, 'an about: URL gets no header');
  assert.equal(header(w.sent[4]), '1');
  assert.equal(new Headers(w.sent[4].init.headers).get('accept'), 'application/json', 'a Headers object keeps its entries');
  assert.equal(header(w.sent[5]), '1');
  assert.equal(new Headers(w.sent[5].init.headers).get('accept'), 'text/plain', 'headers given as pairs keep their entries');
});

test('kosmos#8781: the page reads only through fetch with a URL, so every read passes the wrapper (a checked fact, not a remembered one)', () => {
  for (const [shape, re] of [['new Request(', /\bnew Request\(/], ['XMLHttpRequest', /\bXMLHttpRequest\b/], ['EventSource', /\bnew EventSource\(/], ['sendBeacon', /\bsendBeacon\(/]]) {
    assert.equal(re.test(SCRIPT), false, `the page now uses ${shape}: it does not pass the wrapper as a URL, so on a browser with no Sec-Fetch-Site it gets no X-Kosmos-Board-Page (kosmos#8781); teach the wrapper about it`);
  }
});

test('kosmos#8781: a URL or a header the wrapper cannot read, and another origin as a URL object, go out exactly as they were; init keys survive', async () => {
  const w = wrapped();
  const ac = new AbortController();
  await w.fetch('http://[', { method: 'GET' });
  await w.fetch('/api/x', { headers: { 'bad name': 'x' } });
  await w.fetch(new URL('https://other.kosmos.test/api/x'), { credentials: 'include' });
  await w.fetch('/api/y', { signal: ac.signal, credentials: 'same-origin', keepalive: true, cache: 'no-store' });
  assert.deepEqual(w.sent[0].init, { method: 'GET' }, 'an unparseable URL is left alone, not thrown on');
  assert.deepEqual(w.sent[1].init, { headers: { 'bad name': 'x' } }, 'a header the browser would refuse is left for the browser to refuse');
  assert.deepEqual(w.sent[2].init, { credentials: 'include' }, 'a URL object for another origin is left alone');
  assert.equal(w.sent[3].init.signal, ac.signal);
  assert.equal(w.sent[3].init.credentials, 'same-origin');
  assert.equal(w.sent[3].init.keepalive, true);
  assert.equal(w.sent[3].init.cache, 'no-store');
  assert.equal(header(w.sent[3]), '1');
});

test('kosmos#8781: a request the wrapper cannot read goes out exactly as it was', async () => {
  const w = wrapped();
  const req = { url: 'http://board.test/api/x' };   // stands for a Request object (the page makes none)
  await w.fetch(req, { method: 'GET' });
  assert.equal(w.sent[0].input, req);
  assert.deepEqual(w.sent[0].init, { method: 'GET' }, 'left alone');
});

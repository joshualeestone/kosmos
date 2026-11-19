'use strict';
/*
 * kosmos#8722: the one request a read stands on is asked once more, with longer to answer, when the community did not
 * answer, could not be reached, or answered 5xx. Only when the caller asks ({ retry: true }); never on a 429 (the site
 * asking for fewer requests), never once the caller gave up, and never for an answer that came back.
 */
require('../test-support/tmpscope');   // this process's temp folders, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-commretry-8722-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const cr = require('./communityread');

function answering(...answers) {
  const asked = [];
  cr.setFetcher(async (url, cap, signal) => { asked.push({ url, aborted: !!(signal && signal.aborted) }); return answers.length > 1 ? answers.shift() : answers[0]; });
  return asked;
}
test.beforeEach(() => cr.setRetry(12000, 0));
test.after(() => { cr.setFetcher(null); cr.setRetry(12000, 500); });

test('a read that asks for it is asked once more after no answer, and the second answer is the one returned', async () => {
  const asked = answering({ status: 0, json: null, because: 'the community did not answer in time' }, { status: 200, json: { posts: [] } });
  const r = await cr.getJson('/posts/feed?limit=20', null, undefined, { retry: true });
  assert.equal(asked.length, 2);
  assert.deepEqual(r, { status: 200, json: { posts: [] } });
});

test('a 5xx is asked once more; a second failure is returned as it is, with no third ask', async () => {
  const asked = answering({ status: 502, json: null });
  const r = await cr.getJson('/posts/x', null, undefined, { retry: true });
  assert.equal(asked.length, 2);
  assert.equal(r.status, 502);
});

test('the second ask gets the longer wait (12 s), the first the usual one', async () => {
  const waits = [];
  cr.setFetcher(async (url, cap, signal, waitMs) => { waits.push(waitMs); return { status: 0, json: null }; });
  await cr.getJson('/posts/x', null, undefined, { retry: true });
  assert.deepEqual(waits, [8000, 12000]);
});

test('a 200 whose body was cut by the time limit is asked once more', async () => {
  const asked = answering({ status: 200, json: null, cut: true }, { status: 200, json: { posts: [] } });
  const r = await cr.getJson('/posts/feed', null, undefined, { retry: true });
  assert.equal(asked.length, 2);
  assert.deepEqual(r.json, { posts: [] });
});

test('a cut body is asked again only on a 200: a 429 or 404 whose body stalled is not', async () => {
  for (const status of [429, 404]) {
    const asked = answering({ status, json: null, cut: true });
    await cr.getJson('/posts/x', null, undefined, { retry: true });
    assert.equal(asked.length, 1, 'a cut ' + status + ' was asked again');
  }
});

test('a 429, a 503, a 404 and a 200 are never asked again', async () => {
  for (const status of [429, 503, 404, 200]) {
    const asked = answering({ status, json: {} });
    await cr.getJson('/posts/x', null, undefined, { retry: true });
    assert.equal(asked.length, 1, 'asked again after ' + status);
  }
});

test('CONTROL: without { retry: true } a request that got no answer is asked once, as before', async () => {
  const asked = answering({ status: 0, json: null });
  await cr.getJson('/posts/x', null, undefined);
  assert.equal(asked.length, 1);
});

test('a caller that gave up (its signal aborted) is never asked again', async () => {
  const ctl = new AbortController();
  let n = 0;
  cr.setFetcher(async () => { n += 1; ctl.abort(); return { status: 0, json: null }; });   // the caller gives up during the first ask
  await cr.getJson('/posts/x', null, ctl.signal, { retry: true });
  assert.equal(n, 1);
});

test('a caller that gives up during the pause before the second ask is not asked again', async () => {
  cr.setRetry(15000, 50);
  const ctl = new AbortController();
  let n = 0;
  cr.setFetcher(async () => { n += 1; setTimeout(() => ctl.abort(), 10); return { status: 0, json: null }; });   // gives up inside the pause
  await cr.getJson('/posts/x', null, ctl.signal, { retry: true });
  assert.equal(n, 1);
});

test('a post read retries the post (its first answer lost) but not its comment thread', async () => {
  const post = { id: '1b2c3d4e-0000-4000-8000-000000000002', title: 'One', body: 'Body', channel: 'general', agent: { name: 'Ada' }, created_at: '2026-11-18T10:00:00Z' };
  const asked = [];
  let postAsks = 0;
  cr.setFetcher(async (url) => {
    asked.push(url);
    if (url.includes('/comments')) return { status: 0, json: null };
    postAsks += 1;
    return postAsks === 1 ? { status: 0, json: null, because: 'the community did not answer in time' } : { status: 200, json: post };
  });
  const r = await cr.read({ post: post.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(postAsks, 2, 'the post was not asked again after its first answer was lost');
  assert.equal(asked.filter((u) => u.includes('/comments')).length, 1, 'the thread was asked again: ' + JSON.stringify(asked));
});

test('the second ask is logged with both outcomes (the path only); a first answer that came back logs nothing', async () => {
  const lines = []; const real = console.error;
  console.error = (...a) => { lines.push(a.join(' ')); };
  try {
    answering({ status: 0, json: null, because: 'the community did not answer in time' }, { status: 200, json: {} });
    await cr.getJson('/posts/feed?limit=20&cursor=secret', null, undefined, { retry: true });
    answering({ status: 502, json: null });
    await cr.getJson('/posts/x', null, undefined, { retry: true });
    answering({ status: 200, json: {} });
    await cr.getJson('/posts/y', null, undefined, { retry: true });
  } finally { console.error = real; }
  const mine = lines.filter((l) => l.startsWith('communityread:'));
  assert.deepEqual(mine, [
    'communityread: GET /posts/feed asked again after the community did not answer in time: answered 200',
    'communityread: GET /posts/x asked again after 502: failed again (502)',
  ]);
});

test('a caller that gives up during the pause is answered at once, not after the pause', async () => {
  cr.setRetry(12000, 5000);
  const ctl = new AbortController();
  cr.setFetcher(async () => { setTimeout(() => ctl.abort(), 20); return { status: 0, json: null }; });
  const t0 = Date.now();
  await cr.getJson('/posts/x', null, ctl.signal, { retry: true });
  assert.ok(Date.now() - t0 < 2000, 'waited out the pause: ' + (Date.now() - t0) + ' ms');
});

test('a channel read goes through the retry: one lost answer no longer fails it', async () => {
  const feed = { posts: [{ id: '1b2c3d4e-0000-4000-8000-000000000001', title: 'Hello', body: 'Body', channel: 'general', agent: { name: 'Ada' }, created_at: '2026-11-18T10:00:00Z' }] };
  let first = true;
  cr.setFetcher(async (url) => {
    if (url.includes('/posts/feed') || url.includes('/channels/')) { if (first) { first = false; return { status: 0, json: null, because: 'the community did not answer in time' }; } return { status: 200, json: feed }; }
    return { status: 404, json: null };
  });
  const r = await cr.read({});
  assert.equal(first, false, 'CONTROL: the first answer was lost');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /Hello/);
});

test('a real 200 whose body stalls past the time limit is marked cut and asked again (CONTROL: without retry, once)', async () => {
  const http = require('node:http');
  let n = 0;
  const srv = http.createServer((req, res) => { n += 1; res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"posts":'); });   // never ends
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const saved = { url: process.env.AGENT_WORKFORCE_COMMUNITY_URL, ctx: process.env.NODE_TEST_CONTEXT };
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:' + srv.address().port;
  delete process.env.NODE_TEST_CONTEXT;   // the production path, against this local server only
  cr.setFetcher(null);
  cr.setTimeoutMs(200);
  cr.setRetry(200, 0);
  try {
    const r = await cr.getJson('/posts/feed', null, undefined, { retry: true });
    assert.equal(n, 2, 'asked ' + n + ' times');
    assert.equal(r.status, 200);
    assert.equal(r.json, null);
    assert.equal(r.cut, true);
    n = 0;
    await cr.getJson('/posts/feed', null, undefined);
    assert.equal(n, 1, 'CONTROL: without retry it is asked once');
  } finally {
    if (saved.url === undefined) delete process.env.AGENT_WORKFORCE_COMMUNITY_URL; else process.env.AGENT_WORKFORCE_COMMUNITY_URL = saved.url;
    if (saved.ctx !== undefined) process.env.NODE_TEST_CONTEXT = saved.ctx;
    cr.setTimeoutMs(8000);
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
});

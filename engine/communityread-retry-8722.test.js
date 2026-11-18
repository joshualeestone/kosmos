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
test.beforeEach(() => cr.setRetry(15000, 0));
test.after(() => { cr.setFetcher(null); cr.setRetry(15000, 500); });

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

test('a 429, a 404 and a 200 are never asked again', async () => {
  for (const status of [429, 404, 200]) {
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

test('a post read retries the post but not its comment thread', async () => {
  const post = { id: '1b2c3d4e-0000-4000-8000-000000000002', title: 'One', body: 'Body', channel: 'general', agent: { name: 'Ada' }, created_at: '2026-11-18T10:00:00Z' };
  const asked = [];
  cr.setFetcher(async (url) => { asked.push(url); return url.includes('/comments') ? { status: 0, json: null } : { status: 200, json: post }; });
  const r = await cr.read({ post: post.id });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(asked.filter((u) => u.includes('/comments')).length, 1, 'the thread was asked again: ' + JSON.stringify(asked));
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

'use strict';
/**
 * Kosmos Community SITE layer (#3485) — Mikey's slice (A), read + moderation.
 *
 * Covers the site seam over communitystore:
 *   - feedView serves published-only, redacted, and honors/validates sort+paging
 *   - commentsView guards a blank/missing id
 *   - moderationList surfaces held+quarantined and validates kind/status
 *   - release publishes a held row and refuses unknown / non-held ids
 *   - the input coercers clamp untrusted query params
 *
 *   node --test engine/communitysite.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-site-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const cs = require('./communitystore');
const site = require('./communitysite');

// Seed a mixed store: published/held/quarantined posts + a published & a held
// comment on the published post.
let publishedId;
test('seed store', () => {
  const p1 = cs.insertPost({ status: 'published', agent: 'alice', v: 1, kind: 'post', at: '2026-01-01T00:00:00Z', topic: 't', body: 'published body', board: 'applied-ai', session: 'SECRET-SESSION' });
  publishedId = p1.id;
  cs.insertPost({ status: 'held', agent: 'bob', v: 1, kind: 'post', at: '2026-01-02T00:00:00Z', body: 'held body', findings: [{ cls: 'x', field: null, why: 'untrusted' }] });
  cs.insertPost({ status: 'quarantined', agent: 'mallory', v: 1, kind: 'post', at: '2026-01-03T00:00:00Z', body: 'quarantined body', findings: [{ cls: 'secret', field: 'body', why: 'leak' }] });
  cs.insertComment({ postId: p1.id, status: 'published', agent: 'carol', at: '2026-01-01T01:00:00Z', body: 'nice post' });
  cs.insertComment({ postId: p1.id, status: 'held', agent: 'dave', at: '2026-01-01T02:00:00Z', body: 'held comment' });
});

test('feedView serves published only, redacted', () => {
  const feed = site.feedView({});
  assert.equal(feed.length, 1, 'only the one published post');
  const row = feed[0];
  assert.equal(row.id, publishedId);
  assert.equal(row.body, 'published body');
  assert.equal(row.commentCount, 1, 'one PUBLISHED comment counted, held excluded');
  // Redaction: internal fields never serve.
  assert.equal(row.session, undefined, 'session redacted');
  assert.equal(row.findings, undefined, 'findings redacted');
  assert.equal(row.status, undefined, 'status is bookkeeping, not served');
});

test('feedView validates sort and clamps paging', () => {
  assert.doesNotThrow(() => site.feedView({ sort: 'garbage', limit: '9999', offset: '-5' }));
  const r = site.feedView({ sort: 'garbage' }); // falls back to 'commented'
  assert.equal(r.length, 1);
  // clamp: limit over max, negative offset -> still valid, no throw, bounded
  const clampedLimit = site._clampInt('9999', 50, 100, 1);
  assert.equal(clampedLimit, 100);
  assert.equal(site._clampInt('-5', 0, 999, 0), 0);
  assert.equal(site._clampInt(undefined, 50, 100, 1), 50);
  assert.equal(site._clampInt('abc', 50, 100, 1), 50);
});

test('feedView board filter scopes to a category slug', () => {
  assert.equal(site.feedView({ board: 'applied-ai' }).length, 1);
  assert.equal(site.feedView({ board: 'no-such-board' }).length, 0);
  assert.equal(site._normBoard(''), null);
  assert.equal(site._normBoard('x'.repeat(500)).length, 120);
});

test('commentsView returns published comments, guards bad input', () => {
  const comments = site.commentsView(publishedId);
  assert.equal(comments.length, 1, 'only the published comment');
  assert.equal(comments[0].body, 'nice post');
  assert.equal(comments[0].status, undefined, 'redacted');
  assert.deepEqual(site.commentsView(''), []);
  assert.deepEqual(site.commentsView(null), []);
  assert.deepEqual(site.commentsView(undefined), []);
});

test('moderationList surfaces held + quarantined with full fields', () => {
  const all = site.moderationList({});
  // held post + quarantined post + held comment = 3
  assert.equal(all.length, 3);
  assert.ok(all.some((r) => r.status === 'held'));
  assert.ok(all.some((r) => r.status === 'quarantined'));
  // full fields available to the moderator (findings present on a held/quarantined row)
  assert.ok(all.find((r) => r.status === 'quarantined').findings, 'moderator sees findings');
  // kind + status narrowing
  assert.ok(site.moderationList({ kind: 'post' }).every((r) => !r.postId));
  assert.ok(site.moderationList({ kind: 'comment' }).every((r) => r.postId));
  assert.ok(site.moderationList({ status: 'quarantined' }).every((r) => r.status === 'quarantined'));
  // bad kind/status fall back safely (no throw, sane default)
  assert.doesNotThrow(() => site.moderationList({ kind: 'garbage', status: 'garbage' }));
});

test('release publishes a held post and refuses bad/non-held ids', () => {
  const held = site.moderationList({ kind: 'post', status: 'held' })[0];
  const released = site.release(held.id);
  assert.equal(released.status, 'published');
  // now it appears in the public feed
  assert.equal(site.feedView({}).length, 2);
  // unknown id throws
  assert.throws(() => site.release('no-such-id'));
  // blank id throws
  assert.throws(() => site.release(''));
  assert.throws(() => site.release(null));
  // a quarantined row cannot be released
  const quarantined = site.moderationList({ kind: 'post', status: 'quarantined' })[0];
  assert.throws(() => site.release(quarantined.id), /only a held/);
});

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

test('feedView validates sort and tolerates bad paging input', () => {
  // bad sort falls back to the default 'commented'; junk limit/offset never throw
  assert.doesNotThrow(() => site.feedView({ sort: 'garbage', limit: '9999', offset: '-5' }));
  const r = site.feedView({ sort: 'garbage' }); // falls back to 'commented'
  assert.equal(r.length, 1, 'still serves the one published post');
  assert.doesNotThrow(() => site.feedView({ limit: 'abc', offset: 'xyz' }));
  assert.equal(site.feedView({ limit: 'abc' }).length, 1, 'unparseable limit -> default, still serves it');
});

test('feedView board filter scopes to a category slug', () => {
  assert.equal(site.feedView({ board: 'applied-ai' }).length, 1);
  assert.equal(site.feedView({ board: 'no-such-board' }).length, 0);
  assert.equal(site.feedView({ board: '' }).length, 1, 'empty board = no filter, serves all published');
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

// Observe limit/offset clamping through the public API (needs several posts).
// Runs last so its extra rows do not disturb the absolute-count assertions above.
test('feedView limit + offset paginate over multiple posts', () => {
  const before = site.feedView({ limit: 9999 }).length;
  for (let i = 0; i < 5; i++) {
    cs.insertPost({ status: 'published', agent: `pg${i}`, v: 1, kind: 'post', at: `2026-02-0${i + 1}T00:00:00Z`, body: `pg ${i}` });
  }
  const total = before + 5;
  assert.equal(site.feedView({ limit: 9999 }).length, total, 'a large limit returns all present');
  assert.equal(site.feedView({ limit: 3 }).length, 3, 'limit caps the page size');
  assert.equal(site.feedView({ limit: 'abc' }).length, Math.min(total, 50), 'unparseable limit falls back to the default (50)');
  assert.equal(site.feedView({ offset: 2, limit: 9999 }).length, total - 2, 'offset skips rows');
});

// The clamp CEILINGS (not just the defaults) must actually be enforced: seed past
// each ceiling so a regression that widened or dropped the constant is caught,
// rather than the constant merely existing untested.
test('feedView enforces the FEED_LIMIT_MAX ceiling (100)', () => {
  for (let i = 0; i < 101; i++) {
    cs.insertPost({ status: 'published', agent: `cap${i}`, v: 1, kind: 'post', at: '2026-03-01T00:00:00Z', body: `cap ${i}` });
  }
  // an over-max requested limit is capped at 100, regardless of how many exist
  assert.equal(site.feedView({ limit: 100000 }).length, 100, 'feed page capped at FEED_LIMIT_MAX');
});

test('moderationList enforces the MOD_LIMIT_MAX ceiling (200)', () => {
  for (let i = 0; i < 201; i++) {
    cs.insertPost({ status: 'held', agent: `hcap${i}`, v: 1, kind: 'post', at: '2026-03-02T00:00:00Z', body: `held ${i}` });
  }
  assert.equal(site.moderationList({ limit: 100000 }).length, 200, 'moderation queue capped at MOD_LIMIT_MAX');
});

// The routes pass URLSearchParams.get(), which yields null (not undefined) for an
// absent param. Number(null) === 0 is finite, so a naive clamp returns min(1) and
// the DEFAULT feed/moderation load silently returns 1 row. Exercise that exact
// shape so the default path is pinned. (Runs after the ceiling seeds so >1 row exists.)
test('absent params arrive as null (route shape) and fall back to defaults, not min', () => {
  const nullFeed = site.feedView({ limit: null, offset: null, sort: null, board: null });
  assert.ok(nullFeed.length > 1, 'null limit -> default page size, not clamped to 1');
  assert.equal(nullFeed.length, site.feedView({}).length, 'null and undefined limit behave identically (both = default)');
  const nullMod = site.moderationList({ limit: null, status: null, kind: null });
  assert.ok(nullMod.length > 1, 'null mod limit -> default, not clamped to 1');
  assert.equal(nullMod.length, site.moderationList({}).length, 'null and undefined mod limit behave identically');
});

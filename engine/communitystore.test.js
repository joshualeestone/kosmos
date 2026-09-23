'use strict';
/**
 * Kosmos Community store (#3485) — the data-model slice.
 *
 * Covers the two safety properties that matter most for an open, public feed:
 *   - held/quarantined posts NEVER reach publicFeed(); only 'published' does
 *   - the public serialization redacts `session` and `findings`
 * plus the held-by-default trust ladder and the feed sorts.
 *
 * The sandbox points store.ROOT at a NON-EXISTENT temp dir, so the first insert
 * also proves the mkdir-first write (the pushsub #718 ENOENT lesson).
 *
 *   node --test engine/communitystore.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-community-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const cs = require('./communitystore');

// A minimal published-post insert as the board would make it from verdict.post.
function pub(overrides = {}) {
  return cs.insertPost({ kind: 'community_post', agent: 'Angel', at: '2026-09-23T00:00:00Z',
    body: 'hello community', status: 'published', ...overrides });
}

test('first insert creates store.ROOT/community despite a non-existent root (ENOENT-safe)', () => {
  assert.equal(fs.existsSync(cs._paths.dir()), false, 'precondition: community dir absent');
  const p = pub();
  assert.ok(p.id, 'returns an id');
  assert.equal(fs.existsSync(cs._paths.postsFile()), true, 'posts.json now exists');
});

test('published post appears in publicFeed; session + findings + status are redacted', () => {
  pub({ agent: 'Redactme', session: 'secret-routing-key', body: 'visible body' });
  const feed = cs.publicFeed({ sort: 'newest' });
  const row = feed.find((r) => r.agent === 'Redactme');
  assert.ok(row, 'the published post is in the feed');
  assert.equal(row.session, undefined, 'session is stripped');
  assert.equal(row.findings, undefined, 'findings are stripped');
  assert.equal(row.status, undefined, 'status bookkeeping is stripped');
  assert.equal(row.body, 'visible body');
  assert.equal(row.author.type, 'agent');
  assert.equal(row.author.name, 'Redactme');
});

test('toPublic redaction is exercised on a record that ACTUALLY carries findings/session/status (allowlist)', () => {
  const quar = cs.insertPost({ kind: 'community_post', agent: 'Leak', session: 'route-key', at: 'x',
    body: 'b', status: 'quarantined', findings: [{ field: 'body', kind: 'secret' }] });
  // Precondition: the STORED record genuinely carries all three internal fields,
  // so the strip below is not vacuous the way asserting it on a published post is.
  const stored = cs.moderationQueue({ status: 'quarantined', limit: 500 }).find((r) => r.id === quar.id);
  assert.ok(Array.isArray(stored.findings) && stored.findings.length === 1, 'precondition: carries findings');
  assert.equal(stored.session, 'route-key', 'precondition: carries session');
  assert.equal(stored.status, 'quarantined', 'precondition: carries status');
  // toPublic strips all three from a record that HAD them:
  const p = cs.toPublic(stored);
  assert.equal(p.findings, undefined, 'findings stripped');
  assert.equal(p.session, undefined, 'session stripped');
  assert.equal(p.status, undefined, 'status stripped');
  assert.equal(p.body, 'b', 'public body preserved');
  // Allowlist, not denylist: an unlisted (e.g. future internal) field is not served.
  const withExtra = cs.toPublic({ ...stored, someFutureInternalField: 'must-not-leak' });
  assert.equal(withExtra.someFutureInternalField, undefined, 'an unknown field is dropped by default');
});

test('held and quarantined posts NEVER reach publicFeed, but do reach the moderation queue', () => {
  const held = cs.insertPost({ kind: 'community_post', agent: 'Newbie', at: 'x', body: 'held post', status: 'held' });
  const quar = cs.insertPost({ kind: 'community_post', agent: 'Leaker', at: 'x', body: 'quarantined',
    status: 'quarantined', findings: [{ field: 'body', kind: 'token' }] });

  const feedIds = cs.publicFeed({ limit: 500 }).map((r) => r.id);
  assert.equal(feedIds.includes(held.id), false, 'held not public');
  assert.equal(feedIds.includes(quar.id), false, 'quarantined not public');

  const queueIds = cs.moderationQueue({ limit: 500 }).map((r) => r.id);
  assert.equal(queueIds.includes(held.id), true, 'held is in the queue');
  assert.equal(queueIds.includes(quar.id), true, 'quarantined is in the queue');

  const onlyQuar = cs.moderationQueue({ status: 'quarantined', limit: 500 });
  assert.ok(onlyQuar.every((r) => r.status === 'quarantined'));
  const q = onlyQuar.find((r) => r.id === quar.id);
  assert.ok(Array.isArray(q.findings), 'moderator sees findings');
});

test('an explicit user author is preserved (magic-link posts slot in)', () => {
  const p = cs.insertPost({ kind: 'community_post', at: 'x', body: 'a user wrote this',
    status: 'published', author: { type: 'user', name: 'josh' } });
  assert.equal(p.author.type, 'user');
  assert.equal(p.author.name, 'josh');
});

test('held-by-default trust ladder: untrusted -> trusted after K human releases', () => {
  assert.equal(cs.trustState('Fresh'), 'untrusted', 'every agent starts untrusted');
  let rec;
  for (let i = 0; i < cs.PROMOTE_THRESHOLD - 1; i += 1) {
    rec = cs.recordApproval('Fresh');
    assert.equal(rec.trust, 'untrusted', `still untrusted before K (${i + 1})`);
  }
  rec = cs.recordApproval('Fresh');
  assert.equal(rec.trust, 'trusted', 'trusted at K');
  assert.equal(cs.trustState('Fresh'), 'trusted');
});

test('grantTrust promotes immediately; revokeTrust resets the ladder', () => {
  assert.equal(cs.grantTrust('VIP').trust, 'trusted');
  assert.equal(cs.trustState('VIP'), 'trusted');
  const back = cs.revokeTrust('VIP');
  assert.equal(back.trust, 'untrusted');
  assert.equal(back.approved_count, 0);
});

test('releaseHeld publishes the post and credits its author agent', () => {
  const held = cs.insertPost({ kind: 'community_post', agent: 'Climber', at: 'x', body: 'pending', status: 'held' });
  const before = cs.trustRecord('Climber').approved_count;
  const released = cs.releaseHeld(held.id);
  assert.equal(released.status, 'published');
  assert.equal(cs.trustRecord('Climber').approved_count, before + 1, 'author credited one release');
  assert.equal(cs.publicFeed({ limit: 500 }).map((r) => r.id).includes(held.id), true, 'now public');
  assert.throws(() => cs.releaseHeld(held.id), /only a held post/, 'cannot re-release');
});

test('publicFeed "commented" sort ranks by published comment count; held comments do not count', () => {
  const a = pub({ agent: 'PostA', body: 'A' });
  const b = pub({ agent: 'PostB', body: 'B' });
  // two published comments on B, one on A, one HELD comment on A (must not count)
  cs.insertComment({ postId: b.id, agent: 'c', at: 'x', body: 'c1', status: 'published' });
  cs.insertComment({ postId: b.id, agent: 'c', at: 'x', body: 'c2', status: 'published' });
  cs.insertComment({ postId: a.id, agent: 'c', at: 'x', body: 'c3', status: 'published' });
  cs.insertComment({ postId: a.id, agent: 'c', at: 'x', body: 'held', status: 'held' });

  const feed = cs.publicFeed({ sort: 'commented', limit: 500 });
  const ia = feed.findIndex((r) => r.id === a.id);
  const ib = feed.findIndex((r) => r.id === b.id);
  assert.ok(ib < ia, 'B (2 comments) ranks above A (1 counted comment)');
  assert.equal(feed[ib].commentCount, 2);
  assert.equal(feed[ia].commentCount, 1, 'the held comment is not counted');
});

test('getComments returns published comments oldest-first, redacted; board filter scopes the feed', () => {
  const p = cs.insertPost({ kind: 'community_post', agent: 'Boarded', at: 'x', body: 'on a board',
    status: 'published', board: 'applied-ai' });
  cs.insertComment({ postId: p.id, agent: 'x', at: 'x', body: 'first', status: 'published', session: 's' });
  cs.insertComment({ postId: p.id, agent: 'x', at: 'x', body: 'hidden', status: 'held' });

  const comments = cs.getComments(p.id);
  assert.equal(comments.length, 1, 'only published comments');
  assert.equal(comments[0].session, undefined, 'comment session redacted');

  const onBoard = cs.publicFeed({ board: 'applied-ai', limit: 500 });
  assert.ok(onBoard.every((r) => r.board === 'applied-ai'));
  assert.ok(onBoard.some((r) => r.id === p.id));
});

test('an invalid status is rejected (no silent bad row)', () => {
  assert.throws(() => cs.insertPost({ kind: 'community_post', agent: 'x', at: 'x', body: 'b', status: 'live' }),
    /post status must be one of/);
  assert.throws(() => cs.insertComment({ postId: 'p', agent: 'x', at: 'x', body: 'b', status: 'nope' }),
    /comment status must be one of/);
});

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

test('a held comment can be surfaced and released; a comment release does NOT credit the post trust ladder', () => {
  const p = pub({ agent: 'Host', body: 'host post' });
  const held = cs.insertComment({ postId: p.id, agent: 'Commenter', at: 'x', body: 'held comment', status: 'held' });

  // It is NOT in the post queue, but IS in the comment queue (no longer a dead end).
  assert.equal(cs.moderationQueue({ kind: 'post', limit: 500 }).some((r) => r.id === held.id), false);
  assert.equal(cs.moderationQueue({ kind: 'comment', limit: 500 }).some((r) => r.id === held.id), true);
  assert.equal(cs.moderationQueue({ kind: 'all', limit: 500 }).find((r) => r.id === held.id).entry, 'comment', '#4525: a queue row says it is a comment');
  assert.equal(cs.moderationQueue({ kind: 'all', limit: 500 }).find((r) => r.entry === 'post' && r.status === 'held') !== undefined, true, '#4525: and a post says it is a post');
  assert.equal(cs.moderationQueue({ kind: 'all', limit: 500 }).some((r) => r.id === held.id), true);
  assert.equal(cs.getComments(p.id).some((c) => c.id === held.id), false, 'held comment not public yet');

  const before = cs.trustRecord('Commenter').approved_count;
  const released = cs.releaseHeld(held.id);
  assert.equal(released.status, 'published');
  assert.equal(cs.getComments(p.id).some((c) => c.id === held.id), true, 'released comment now public');
  assert.equal(cs.trustRecord('Commenter').approved_count, before, 'a comment release does not advance the post ladder');
  assert.throws(() => cs.releaseHeld(held.id), /only a held comment/, 'cannot re-release');
});

test('releaseHeld refuses a quarantined row (scrubber hits are not a quiet override)', () => {
  const quar = cs.insertPost({ kind: 'community_post', agent: 'Q', at: 'x', body: 'b',
    status: 'quarantined', findings: [{ field: 'body', kind: 'secret' }] });
  assert.throws(() => cs.releaseHeld(quar.id), /only a held post/);
  assert.throws(() => cs.releaseHeld('no-such-id'), /no such held post or comment/);
});

test('#4525 discardHeld removes a held or quarantined post (with its comments) and credits nobody', () => {
  const held = cs.insertPost({ kind: 'community_post', agent: 'Tosser', at: 'x', body: 'not this one', status: 'held' });
  const quar = cs.insertPost({ kind: 'community_post', agent: 'Tosser', at: 'x', body: 'b',
    status: 'quarantined', findings: [{ cls: 'email', field: 'body', why: 'email address (PII)' }] });
  const under = cs.insertComment({ postId: held.id, agent: 'x', at: 'x', body: 'on the held post', status: 'held' });
  const before = cs.trustRecord('Tosser');
  assert.equal(cs.discardHeld(held.id).id, held.id);
  assert.equal(cs.discardHeld(quar.id).id, quar.id, 'a quarantined row can be discarded, only not released');
  const queue = cs.moderationQueue({ limit: 500 }).map((r) => r.id);
  assert.ok(!queue.includes(held.id) && !queue.includes(quar.id), 'discarded posts leave the queue');
  assert.ok(!queue.includes(under.id), 'a comment under a discarded post goes with it');
  assert.deepEqual(cs.trustRecord('Tosser'), before, 'a discard neither credits nor demotes');
  assert.throws(() => cs.discardHeld(held.id), /no such held post or comment/, 'cannot discard twice');
});

test('#4525 discardHeld takes a post\'s PUBLISHED comments too (the Discard ask says any comments go with it)', () => {
  const held = cs.insertPost({ kind: 'community_post', agent: 'Tosser2', at: 'x', body: 'waiting', status: 'held' });
  const pubc = cs.insertComment({ postId: held.id, agent: 'x', at: 'x', body: 'released early', status: 'published' });
  cs.discardHeld(held.id);
  const commentsFile = cs._paths.commentsFile();
  const left = JSON.parse(require('node:fs').readFileSync(commentsFile, 'utf8')).map((c) => c.id);
  assert.ok(!left.includes(pubc.id), 'a published comment under the discarded post was left behind');
});

test('#4525 discardHeld removes a held comment and refuses a published row', () => {
  const p = pub({ agent: 'Host2', body: 'host post' });
  const c = cs.insertComment({ postId: p.id, agent: 'Commenter2', at: 'x', body: 'held comment', status: 'held' });
  assert.equal(cs.discardHeld(c.id).id, c.id);
  assert.equal(cs.moderationQueue({ kind: 'comment', limit: 500 }).some((r) => r.id === c.id), false);
  assert.throws(() => cs.discardHeld(p.id), /only a held or stopped post/, 'a published post is not the queue\'s to discard');
  const live = cs.insertComment({ postId: p.id, agent: 'x', at: 'x', body: 'live', status: 'published' });
  assert.throws(() => cs.discardHeld(live.id), /only a held or stopped comment/);
  assert.ok(cs.publicFeed({ limit: 500 }).some((r) => r.id === p.id), 'the refused discard left the post public');
});

test('an invalid status is rejected (no silent bad row)', () => {
  assert.throws(() => cs.insertPost({ kind: 'community_post', agent: 'x', at: 'x', body: 'b', status: 'live' }),
    /post status must be one of/);
  assert.throws(() => cs.insertComment({ postId: 'p', agent: 'x', at: 'x', body: 'b', status: 'nope' }),
    /comment status must be one of/);
});

test('the trust key is normalized on BOTH credit and lookup, so a persona over MAX_AGENT_LEN still promotes', () => {
  const long = 'L'.repeat(200); // longer than MAX_AGENT_LEN (80)
  for (let i = 0; i < cs.PROMOTE_THRESHOLD; i += 1) {
    const h = cs.insertPost({ kind: 'community_post', agent: long, at: 'x', body: `b${i}`, status: 'held' });
    cs.releaseHeld(h.id); // credits author.name (truncated at insert)
  }
  // trustState is called with the RAW (untruncated) persona; it must still resolve
  // to the same key the credit landed under. Without the fix these diverge and the
  // agent never promotes.
  assert.equal(cs.trustState(long), 'trusted', 'raw-persona lookup matches the truncated credit key');
});

test('a comment on a nonexistent post is rejected (no orphan row)', () => {
  assert.throws(
    () => cs.insertComment({ postId: 'does-not-exist', agent: 'x', at: 'x', body: 'b', status: 'published' }),
    /nonexistent post/,
  );
});

test('a comment carries its links (not silently dropped) and serves them publicly', () => {
  const p = pub({ agent: 'LinkHost', body: 'host' });
  const c = cs.insertComment({ postId: p.id, agent: 'x', at: 'x', body: 'see', links: ['https://example.com/a'], status: 'published' });
  const served = cs.getComments(p.id).find((x) => x.id === c.id);
  assert.deepEqual(served.links, ['https://example.com/a'], 'comment links stored and served');
});

// Kept LAST: it deliberately corrupts the shared posts.json, so no later test
// should depend on prior post state after this point.
test('a corrupt / wrong-shape collection file is quarantined to a .corrupt sidecar, not silently discarded, and the live path recovers', () => {
  const fsx = require('node:fs');
  const dir = cs._paths.dir();
  const pf = cs._paths.postsFile();

  // (a) unparseable JSON
  pub({ agent: 'BeforeCorrupt', body: 'real row' });
  fsx.writeFileSync(pf, '{ this is not valid json', 'utf8');
  const feed1 = cs.publicFeed({ limit: 500 }); // a read triggers loadJson -> quarantine; must not throw
  assert.ok(Array.isArray(feed1), 'read recovers to an array, no throw');
  let sidecars = fsx.readdirSync(dir).filter((f) => f.startsWith('posts.json.corrupt-'));
  assert.ok(sidecars.length >= 1, 'unparseable file preserved to a .corrupt-<ts> sidecar');
  // live path recovered: a fresh insert works
  const p = pub({ agent: 'AfterParseCorrupt', body: 'new' });
  assert.ok(cs.publicFeed({ limit: 500 }).some((r) => r.id === p.id), 'store accepts new posts after recovery');
  // and a subsequent read does NOT re-quarantine (the file is valid again now)
  const countBefore = fsx.readdirSync(dir).filter((f) => f.startsWith('posts.json.corrupt-')).length;
  cs.publicFeed({ limit: 500 });
  const countAfter = fsx.readdirSync(dir).filter((f) => f.startsWith('posts.json.corrupt-')).length;
  assert.equal(countAfter, countBefore, 'a valid file is not re-quarantined on the next read');

  // (b) valid JSON of the WRONG SHAPE (object where an array is expected)
  fsx.writeFileSync(pf, '{"not":"an array"}', 'utf8');
  const feed2 = cs.publicFeed({ limit: 500 }); // must not throw a TypeError on .filter
  assert.ok(Array.isArray(feed2), 'wrong-shape file recovers to an array, no TypeError');
  const shapeSidecars = fsx.readdirSync(dir).filter((f) => f.startsWith('posts.json.corrupt-')).length;
  assert.ok(shapeSidecars >= 2, 'wrong-shape file also quarantined');
});

test('#4287: publishedPosts returns published rows only, oldest first, and postMeta names status and author', () => {
  const a = cs.insertPost({ status: 'published', agent: 'ann', kind: 'community_post', at: 'x', body: 'one' });
  const h = cs.insertPost({ status: 'held', agent: 'ann', kind: 'community_post', at: 'x', body: 'two' });
  const q = cs.insertPost({ status: 'quarantined', agent: 'ann', kind: 'community_post', at: 'x', body: 'three' });
  const b = cs.insertPost({ status: 'published', agent: 'ann', kind: 'community_post', at: 'x', body: 'four' });
  const ids = cs.publishedPosts().map((p) => p.id);
  assert.ok(ids.indexOf(a.id) >= 0 && ids.indexOf(a.id) < ids.indexOf(b.id));
  assert.ok(!ids.includes(h.id) && !ids.includes(q.id));
  assert.deepEqual(cs.postMeta(h.id), { status: 'held', authorType: 'agent' });
  assert.equal(cs.postMeta('no-such-id'), null);
  cs.releaseHeld(h.id);
  const released = cs.publishedPosts().find((p) => p.id === h.id);
  assert.equal(typeof released.releasedAt, 'string');
  assert.equal(cs.toPublic(released).releasedAt, undefined, 'releasedAt must not reach the public feed');
});

// #5000: deleting an agent frees its name; the name's standing must not carry over to a new agent.
function nextMillisecond() { const t = Date.now(); while (Date.now() === t) { /* spin to the next ms */ } }

test('#5000: forgetTrust puts the deleted name back at the start and leaves every other agent alone', () => {
  cs.grantTrust('Gone5000');
  cs.grantTrust('Stays5000');
  assert.equal(cs.trustState('Gone5000'), 'trusted', 'control: the name was trusted before it was forgotten');
  const rec = cs.forgetTrust('Gone5000');
  assert.equal(rec.trust, 'untrusted');
  assert.equal(rec.approved_count, 0);
  assert.equal(typeof rec.forgottenAt, 'string');
  assert.equal(cs.trustState('Gone5000'), 'untrusted', 'a new agent under the freed name starts trusted');
  assert.equal(cs.trustState('Stays5000'), 'trusted', 'forgetting one name changed another agent\'s standing');
});

test('#5000: a held post the deleted agent left behind credits nobody when released; a new agent\'s post does', () => {
  const old = cs.insertPost({ status: 'held', agent: 'Heir5000', topic: 't', body: 'from the deleted agent' });
  nextMillisecond();
  cs.forgetTrust('Heir5000');
  nextMillisecond();
  cs.releaseHeld(old.id);
  assert.equal(cs.trustRecord('Heir5000').approved_count, 0, 'the deleted agent\'s post credited the new agent of that name');
  /* The control, on the same path: a post the NEW agent made after the delete is credited as before, so the zero
     above is the check working and not the release path crediting nothing at all. */
  const fresh = cs.insertPost({ status: 'held', agent: 'Heir5000', topic: 't', body: 'from the new agent' });
  cs.releaseHeld(fresh.id);
  assert.equal(cs.trustRecord('Heir5000').approved_count, 1, 'a new agent\'s released post was not credited');
});

test('#5000: a grant or a revoke after the delete keeps the stamp, so the old agent\'s held post still credits nobody', () => {
  const old = cs.insertPost({ status: 'held', agent: 'Kept5000', topic: 't', body: 'from the deleted agent' });
  nextMillisecond();
  cs.forgetTrust('Kept5000');
  nextMillisecond();
  cs.revokeTrust('Kept5000');
  assert.equal(typeof cs.trustRecord('Kept5000').forgottenAt, 'string', 'revoke dropped the stamp');
  cs.releaseHeld(old.id);
  assert.equal(cs.trustRecord('Kept5000').approved_count, 0, 'after a revoke, the deleted agent\'s post credited the new agent');
  cs.grantTrust('Kept5000');
  assert.equal(typeof cs.trustRecord('Kept5000').forgottenAt, 'string', 'grant dropped the stamp');
  /* And after a grant and a revoke, a second old post still credits nobody. */
  cs.revokeTrust('Kept5000');
  const old2 = cs.insertPost({ status: 'held', agent: 'Kept5000', topic: 't', body: 'also from the deleted agent' });
  const posts = JSON.parse(fs.readFileSync(cs._paths.postsFile(), 'utf8'));
  posts.find((x) => x.id === old2.id).receivedAt = old.receivedAt;
  fs.writeFileSync(cs._paths.postsFile(), JSON.stringify(posts));
  cs.releaseHeld(old2.id);
  assert.equal(cs.trustRecord('Kept5000').approved_count, 0, 'after a grant and a revoke, an old post credited the new agent');
});

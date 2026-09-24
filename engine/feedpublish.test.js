'use strict';
/**
 * #3485: the community feed PUBLISH CHOKE (engine/feedpublish.js).
 *
 * The property that matters most for an open, public feed: EVERY post and comment,
 * of ANY origin, passes through feedguard before the store persists it, and the
 * feedguard verdict maps to the store's held/published/quarantined exactly. These
 * tests EXECUTE the choke against the real feedguard + a sandboxed store, so a
 * mis-map (e.g. a leak from a trusted author slipping to published) is caught here.
 *
 *   node --test engine/feedpublish.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-feedpublish-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const fp = require('./feedpublish');
const cs = require('./communitystore');

// A clean, well-formed post candidate (feedguard REQUIRED_FIELDS: kind, agent, body, at).
function post(overrides = {}) {
  return { kind: 'community_post', agent: 'Angel', at: '2026-09-23T00:00:00Z', body: 'hello community', ...overrides };
}
// A deny-name that feedguard flags as a leak (DEFAULT_DENY_NAMES), so status must be quarantined.
const LEAK_BODY = 'ping Josh Stone about this';

test('statusFor maps the verdict to the store 3-way (leak beats trust)', () => {
  assert.equal(fp.statusFor({ clean: false, publish: false }), 'quarantined');
  assert.equal(fp.statusFor({ clean: false, publish: true }), 'quarantined', 'a leak is quarantined even if trusted');
  assert.equal(fp.statusFor({ clean: true, publish: true }), 'published');
  assert.equal(fp.statusFor({ clean: true, publish: false }), 'held');
});

test('a clean post from an UNTRUSTED agent is HELD, not published (held-by-default)', () => {
  const r = fp.publishPost(post({ agent: 'Untrusted1' }));
  assert.equal(r.ok, true);
  assert.equal(r.status, 'held');
  assert.ok(r.id);
  // Held never reaches the public feed.
  assert.equal(cs.publicFeed().some((p) => p.id === r.id), false, 'a held post must not be served');
});

test('a clean post from a TRUSTED agent (agentId given) is PUBLISHED and served', () => {
  cs.grantTrust('Trusted1');
  const r = fp.publishPost(post({ agent: 'Trusted1' }), { agentId: 'Trusted1' });
  assert.equal(r.status, 'published');
  assert.equal(cs.publicFeed().some((p) => p.id === r.id), true, 'a published post must be served');
});

test('trust is NOT derived from the candidate.agent field (the anti-spoof property)', () => {
  // A promoted persona named in the CONTENT, but no authenticated identity asserted
  // in opts, must NOT publish -- otherwise any caller could claim a trusted persona.
  cs.grantTrust('Trusted1');
  const r = fp.publishPost(post({ agent: 'Trusted1' })); // no opts.agentId / opts.trusted
  assert.equal(r.status, 'held', 'a self-declared trusted agent with no authenticated identity must be held, not published');
});

test('a LEAK is QUARANTINED regardless of trust -- the whole point of the choke', () => {
  cs.grantTrust('Trusted2');
  const r = fp.publishPost(post({ agent: 'Trusted2', body: LEAK_BODY }), { agentId: 'Trusted2' });
  assert.equal(r.status, 'quarantined', 'a leak from a trusted agent must still quarantine');
  assert.ok(r.findings.length > 0, 'quarantined carries findings for the moderator');
  assert.equal(cs.publicFeed().some((p) => p.id === r.id), false, 'a quarantined post must not be served');
});

test('the HUMAN path (explicit opts.trusted) publishes a clean post from an untrusted-by-ladder author', () => {
  // Mikey's site owns the human identity model and passes trusted explicitly.
  const r = fp.publishPost(post({ agent: 'HumanSite' }), { trusted: true, author: { type: 'user', name: 'Jane' } });
  assert.equal(r.status, 'published');
});

test('a leak still quarantines even on the explicit-trusted human path', () => {
  const r = fp.publishPost(post({ agent: 'HumanSite', body: LEAK_BODY }), { trusted: true });
  assert.equal(r.status, 'quarantined');
});

test('author.name is NOT scrubbed by the choke (a deny-name in author.name does not quarantine a clean body)', () => {
  // feedguard has no author in ALLOWED_FIELDS; scrubbing author.name is the site route's job.
  const r = fp.publishPost(post({ agent: 'Trusted1' }), { trusted: true, author: { type: 'user', name: 'Josh Stone' } });
  assert.equal(r.status, 'published', 'the choke must not scan author.name; only the body/topic/links');
});

test('a malformed candidate is REJECTED, nothing stored', () => {
  const before = cs.moderationQueue().length + cs.publicFeed().length;
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const r = fp.publishPost(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
  }
  const after = cs.moderationQueue().length + cs.publicFeed().length;
  assert.equal(after, before, 'a rejected candidate must not create any row');
});

test('a comment strips postId/parentId before the guard and re-attaches them (clean comment is not quarantined)', () => {
  const parent = fp.publishPost(post({ agent: 'Trusted1' }), { trusted: true });
  // If postId/parentId reached feedguard they would be disallowed fields -> quarantined.
  const r = fp.publishComment({ kind: 'community_post', agent: 'Trusted1', at: '2026-09-23T01:00:00Z', body: 'nice post', postId: parent.id, parentId: null }, { trusted: true });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'published', 'a clean comment must not be quarantined by leaked routing keys');
  assert.equal(cs.getComments(parent.id).some((c) => c.id === r.id), true, 'the comment is stored under its post');
});

test('a leak in a comment body quarantines it', () => {
  const parent = fp.publishPost(post({ agent: 'Trusted1' }), { trusted: true });
  const r = fp.publishComment({ kind: 'community_post', agent: 'Trusted1', at: '2026-09-23T02:00:00Z', body: LEAK_BODY, postId: parent.id }, { trusted: true });
  assert.equal(r.status, 'quarantined');
});

test('a comment on a nonexistent post returns ok:false, never throws', () => {
  const r = fp.publishComment({ kind: 'community_post', agent: 'Trusted1', at: '2026-09-23T03:00:00Z', body: 'orphan', postId: 'no-such-post' }, { trusted: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /nonexistent|postId/i);
});

test('the store persists the SNAPSHOT, not the live candidate object', () => {
  // Mutating the candidate after the call must not change what was stored.
  const cand = post({ agent: 'Trusted1', body: 'stable body' });
  const r = fp.publishPost(cand, { trusted: true });
  cand.body = 'mutated after the call';
  const served = cs.publicFeed().find((p) => p.id === r.id);
  assert.equal(served.body, 'stable body', 'the stored body must be the snapshot taken at guard time');
});

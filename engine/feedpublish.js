'use strict';
/**
 * #3485: the community feed's PUBLISH CHOKE -- the single reusable primitive every
 * post and comment passes through before engine/communitystore.js persists it.
 *
 * 🛑 WHY THIS IS ONE PRIMITIVE AND NOT AN AGENT-ONLY PATH. feedguard is the
 * fail-closed content scrubber; communitystore is caller-agnostic storage. If the
 * agent/board path scrubbed through feedguard but the community SITE's human
 * post/comment routes inserted straight into the store, a human post could carry a
 * PII/username/secret leak that never met the scrubber. So BOTH callers -- the
 * agent/board path (this repo) and Mikey's site routes (community.installkosmos.com)
 * -- MUST route through THIS module. It is the only place that decides publish vs
 * hold vs quarantine, so there is exactly one scrub gate for content of any origin.
 *
 * 🔑 THE CHOKE, in one line: feedguard.guard(content, {trusted}) -> a 3-way status
 * -> communitystore.insert*. The status map is the store's model (its docblock):
 *   - NOT clean (feedguard found a leak)      -> 'quarantined' (regardless of trust)
 *   - clean AND trusted                       -> 'published'
 *   - clean AND NOT trusted (held-by-default) -> 'held' (a human releases it later)
 *
 * 🔑 TRUST SOURCE. Agents ride the store's held-by-default ladder: pass `agentId`
 * and this derives `trusted` from communitystore.trustState(). The human-post path
 * (Mikey's site, which owns the human identity model) passes `trusted` EXPLICITLY.
 * Omit both and it is untrusted -> held: fail-closed, an unknown author never
 * auto-publishes.
 *
 * 🛑 author.name IS NOT SCRUBBED HERE. feedguard's ALLOWED_FIELDS has no author,
 * so it never scans a name. The human-post route (Mikey's) owns scrubbing
 * author.name for PII/impersonation and passes an already-clean `author`. This
 * module passes `author` straight to the store; do not read it as scrubbed.
 *
 * 🔑 THE STORE PUBLISHES THE SNAPSHOT, NOT THE CALLER'S OBJECT. feedguard returns
 * `verdict.post`, a snapshot of only the allowed fields, each read once (a getter
 * or Proxy cannot show clean bytes to the scrubber and different bytes to the
 * store). This module inserts THAT, never the live candidate.
 *
 * Never throws to the caller: a malformed candidate or a client error (a comment
 * on a nonexistent post) returns { ok: false, ... }, so a route can map it to a
 * 400 without a try/catch and a bad input can never take down the board.
 */

const feedguard = require('./feedguard');
const communitystore = require('./communitystore');

// The store's 3-way status from a feedguard verdict. A leak is quarantined even
// from a trusted author (the scrubber is the harder backstop); a clean post is
// published only if trusted, else held for a human to release.
function statusFor(verdict) {
  if (!verdict.clean) return 'quarantined';
  return verdict.publish ? 'published' : 'held';
}

// Is this a WELL-FORMED submission at all? A candidate that is not an object, or
// is missing any of feedguard's REQUIRED_FIELDS, is junk (a caller bug), not a
// leak: REJECT it (no stored row) rather than quarantine it, so malformed/empty
// submissions do not fill the moderation queue. A well-formed submission that
// then trips the scrubber (a content leak) IS quarantined, so a moderator sees
// it. Keyed on feedguard's EXPORTED REQUIRED_FIELDS, so the two never drift.
// Reads the SNAPSHOT (verdict.post), never the live candidate.
function isWellFormed(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  return feedguard.REQUIRED_FIELDS.every((f) => {
    const v = snapshot[f];
    return v !== undefined && v !== null && v !== '';
  });
}

// Resolve the trust flag. An EXPLICIT opts.trusted wins (the human-post path,
// where the site's identity model decides). Otherwise derive it from the agent's
// ladder via the store. Neither given -> false (fail-closed: held, never published).
function resolveTrusted(opts, agentId) {
  if (typeof opts.trusted === 'boolean') return opts.trusted;
  if (agentId != null && agentId !== '') return communitystore.trustState(agentId) === 'trusted';
  return false;
}

/**
 * Publish a POST candidate through the choke. `candidate` carries feedguard's
 * allowed fields ({ v?, kind?, agent, at?, topic, body, links? }). `opts`:
 *   agentId    derive trust from the ladder (defaults to candidate.agent)
 *   trusted    override the trust flag explicitly (human-post path)
 *   board      category slug the route assigns (taxonomy is the site's inventory)
 *   author     { type: 'user'|'agent', name } -- ALREADY name-scrubbed by the caller
 *   denyNames  extra deny-list names for feedguard, beyond its defaults
 * Returns { ok, status, id?, findings, error? }. `findings` is empty for a
 * published post and carries the moderation reasons otherwise.
 */
function publishPost(candidate, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const agentId = (o.agentId != null && o.agentId !== '')
    ? o.agentId
    : (candidate && typeof candidate === 'object' ? candidate.agent : undefined);
  const trusted = resolveTrusted(o, agentId);
  const verdict = feedguard.guard(candidate, { trusted, denyNames: o.denyNames });
  if (!isWellFormed(verdict.post)) {
    // Not an object, or missing required fields: junk, not a leak. Reject rather
    // than insert an empty/incomplete quarantined row.
    return { ok: false, status: 'rejected', findings: verdict.findings, error: 'candidate is not a well-formed post (not an object or missing required fields)' };
  }
  const status = statusFor(verdict);
  const rec = { ...verdict.post, status };
  if (o.board != null) rec.board = o.board;
  if (o.author != null) rec.author = o.author;
  if (status !== 'published') rec.findings = verdict.findings;
  const stored = communitystore.insertPost(rec);
  return { ok: true, status, id: stored.id, findings: status !== 'published' ? verdict.findings : [] };
}

/**
 * Publish a COMMENT candidate through the choke. `candidate` carries the comment's
 * CONTENT fields ({ agent, at?, body, links? }) PLUS the routing keys `postId`
 * (required) and `parentId` (optional). The routing keys are stripped BEFORE
 * feedguard (its ALLOWED_FIELDS has no postId/parentId, so leaving them in would
 * flag the comment as malformed and wrongly quarantine it) and re-attached to the
 * store record after. `opts` is the same as publishPost. Returns the same shape;
 * a missing/nonexistent postId returns { ok: false } rather than throwing.
 */
function publishComment(candidate, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const c = (candidate && typeof candidate === 'object') ? candidate : {};
  // Strip the routing keys feedguard does not know about; guard only the content.
  const { postId, parentId, ...content } = c;
  const agentId = (o.agentId != null && o.agentId !== '') ? o.agentId : content.agent;
  const trusted = resolveTrusted(o, agentId);
  const verdict = feedguard.guard(content, { trusted, denyNames: o.denyNames });
  if (!isWellFormed(verdict.post)) {
    return { ok: false, status: 'rejected', findings: verdict.findings, error: 'comment content is not a well-formed submission (not an object or missing required fields)' };
  }
  const status = statusFor(verdict);
  const rec = { ...verdict.post, postId, parentId, status };
  if (o.author != null) rec.author = o.author;
  if (status !== 'published') rec.findings = verdict.findings;
  let stored;
  try {
    stored = communitystore.insertComment(rec);
  } catch (err) {
    // A missing or nonexistent postId is a client error, not a scrub failure --
    // surface it as ok:false so the route returns a 400, never a 500.
    return { ok: false, status: 'rejected', findings: verdict.findings, error: String(err && err.message || err) };
  }
  return { ok: true, status, id: stored.id, findings: status !== 'published' ? verdict.findings : [] };
}

module.exports = { publishPost, publishComment, statusFor, resolveTrusted };

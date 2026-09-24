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

// The three dispositions this choke produces. Asserted against the store's own
// exported STATUSES at load, so a rename there fails LOUDLY here (at require) rather
// than silently at the first insert -- the store is the one source of truth for the
// status vocabulary (#5, "two derivations of one fact"), and this keeps the two coupled.
const HELD = 'held';
const PUBLISHED = 'published';
const QUARANTINED = 'quarantined';
for (const s of [HELD, PUBLISHED, QUARANTINED]) {
  if (!communitystore.STATUSES.includes(s)) {
    throw new Error(`feedpublish: status "${s}" is not in communitystore.STATUSES -- the two have drifted`);
  }
}

// The store's 3-way status from a feedguard verdict. A leak is quarantined even
// from a trusted author (the scrubber is the harder backstop); a clean post is
// published only if trusted, else held for a human to release.
function statusFor(verdict) {
  if (!verdict.clean) return QUARANTINED;
  return verdict.publish ? PUBLISHED : HELD;
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

// A board category slug: lowercase kebab, 1-32 chars, starting with a letter. Keeps
// free text (names, emails, sentences) out of the publicly-served board column.
const BOARD_SLUG = /^[a-z][a-z0-9-]{0,31}$/;

// The store can throw ONE client-input error the primitive cannot pre-check without
// duplicating the store's lookup: a comment on a post that does not exist. Every
// OTHER client precondition (a non-object candidate, missing required fields, a
// missing postId) is validated in the primitive BEFORE the store is called, and the
// primitive always passes a valid status -- so any REMAINING throw from the store is
// a SERVER failure (disk full, permission, a corrupt-file rename failure) whose raw
// message can embed a local filesystem path. This match is the store's EXACT phrase
// for the nonexistent-parent case (not a loose keyword that a random OS path could
// contain), so a real server error is never misclassified and its raw message/path
// is never returned to the caller. A server failure is LOGGED here (the store
// boundary) and returned as a GENERIC message. `reason` tells the route the status code.
const NONEXISTENT_PARENT = /references a nonexistent post/i;
function insertFailure(err, findings) {
  const raw = String((err && err.message) || err);
  if (NONEXISTENT_PARENT.test(raw)) {
    return { ok: false, reason: 'input', status: 'rejected', findings, error: 'the post being commented on does not exist' };
  }
  console.error('feedpublish: community store write failed: ' + raw);
  return { ok: false, reason: 'store', status: 'error', findings, error: 'the submission could not be stored' };
}

// Resolve the trust flag from an AUTHENTICATED identity ONLY.
// 🛑 NEVER FROM THE CANDIDATE'S OWN `agent` FIELD. That field is caller-supplied
// content; deriving trust from it would let any caller who reaches the route publish
// as an already-promoted persona and skip held-by-default entirely (the whole feature
// exists to prevent exactly that). So the caller must assert identity explicitly:
//   - opts.trusted (boolean): the human-post path -- the SITE owns the human identity
//     model and states the trust decision.
//   - opts.agentId (string): the agent path -- the AUTHENTICATED agent identity (the
//     route resolves it via resolveAgentSender's token check, NOT from candidate.agent),
//     looked up on the store's held-by-default ladder.
// Neither asserted -> false (fail-closed: held, never published). opts.trusted wins if
// both are given.
function resolveTrusted(opts) {
  if (typeof opts.trusted === 'boolean') return opts.trusted;
  if (opts.agentId != null && opts.agentId !== '') return communitystore.trustState(opts.agentId) === 'trusted';
  return false;
}

/**
 * Publish a POST candidate through the choke. `candidate` carries feedguard's
 * allowed fields ({ v?, kind?, agent, at?, topic, body, links? }). `opts`:
 *   agentId    the AUTHENTICATED agent identity (the route resolves it via
 *              resolveAgentSender, NEVER from candidate.agent); trust is looked up
 *              on the store ladder under it. The route MUST also set candidate.agent
 *              to this same identity so attribution and the trust-credit key match.
 *   trusted    assert the trust flag explicitly (the human-post path; the site owns
 *              the human identity model). Wins over agentId if both are given.
 *   board      category slug the route assigns (taxonomy is the site's inventory)
 *   author     { type: 'user'|'agent', name } -- ALREADY name-scrubbed by the caller
 *   denyNames  extra deny-list names for feedguard, beyond its defaults
 * Returns { ok, status, id?, findings, error? }. 🛑 `findings` are MODERATOR-only
 * (leak class + field); a route MUST NOT echo them to the submitting caller (an
 * evasion oracle) -- they are here for internal/moderation callers.
 */
function publishPost(candidate, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  // Validate `board` FIRST, before any content processing. 🛑 board is attached AFTER
  // the feedguard snapshot and is served publicly (communitystore PUBLIC_FIELDS), so
  // free-text board would be an un-scrubbed public field -- the exact hole the choke
  // closes. board is NOT free content: it is a CONTROLLED taxonomy slug (the site's
  // category inventory), validated here by FORMAT (a kebab slug: no spaces/@/uppercase/
  // sentences, so it cannot carry a name/email/free text); the semantic gate is the
  // caller's taxonomy allowlist. Checking it up front (not after the guard) means a bad
  // board is a clean request rejection and never DISCARDS an already-computed leak
  // verdict. (The agent route in this branch does not pass board at all.)
  let boardSlug;
  if (o.board != null) {
    boardSlug = String(o.board);
    if (!BOARD_SLUG.test(boardSlug)) {
      return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'board must be a lowercase kebab-case slug (a controlled category), not free text' };
    }
  }
  const trusted = resolveTrusted(o); // identity is opts-only, never candidate.agent
  const verdict = feedguard.guard(candidate, { trusted, denyNames: o.denyNames });
  if (!isWellFormed(verdict.post)) {
    // Not an object, or missing required fields: junk, not a leak. Reject rather
    // than insert an empty/incomplete quarantined row.
    return { ok: false, reason: 'input', status: 'rejected', findings: verdict.findings, error: 'candidate is not a well-formed post (not an object or missing required fields)' };
  }
  const status = statusFor(verdict);
  const rec = { ...verdict.post, status };
  if (boardSlug != null) rec.board = boardSlug;
  if (o.author != null) rec.author = o.author;
  if (status !== PUBLISHED) rec.findings = verdict.findings;
  let stored;
  try {
    stored = communitystore.insertPost(rec);
  } catch (err) {
    // never-throws: classify + log a store failure, never leak its raw message.
    return insertFailure(err, verdict.findings);
  }
  return { ok: true, status, id: stored.id, findings: status !== PUBLISHED ? verdict.findings : [] };
}

/**
 * Publish a COMMENT candidate through the choke. `candidate` carries the same
 * feedguard REQUIRED_FIELDS as a post ({ kind, agent, body, at } -- a comment missing
 * any of these is rejected 400, exactly like a post), plus optional { links }, PLUS
 * the routing keys `postId` (required) and `parentId` (optional). The routing keys
 * are stripped BEFORE
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
  // Pre-check postId PRESENCE here (a clear client error) so the store's throw is not
  // relied on to classify it -- the store's message ("comment requires postId") does
  // not match insertFailure's nonexistent-parent phrase, so leaving it to the store
  // would 500 a plain client mistake. (Nonexistent-parent still comes from the store,
  // which insertFailure classifies by its exact phrase.)
  if (postId == null || postId === '') {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'a comment requires a postId' };
  }
  const trusted = resolveTrusted(o); // identity is opts-only, never content.agent
  const verdict = feedguard.guard(content, { trusted, denyNames: o.denyNames });
  if (!isWellFormed(verdict.post)) {
    return { ok: false, reason: 'input', status: 'rejected', findings: verdict.findings, error: 'comment content is not a well-formed submission (not an object or missing required fields)' };
  }
  const status = statusFor(verdict);
  const rec = { ...verdict.post, postId, parentId, status };
  if (o.author != null) rec.author = o.author;
  if (status !== PUBLISHED) rec.findings = verdict.findings;
  let stored;
  try {
    stored = communitystore.insertComment(rec);
  } catch (err) {
    // A missing/nonexistent postId is a client error (400, safe message); a store
    // write failure is a server error (500, generic, logged). insertFailure classifies.
    return insertFailure(err, verdict.findings);
  }
  return { ok: true, status, id: stored.id, findings: status !== PUBLISHED ? verdict.findings : [] };
}

module.exports = { publishPost, publishComment, statusFor, resolveTrusted, insertFailure };

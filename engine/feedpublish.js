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
 * agent/board path (this repo) and Mikey's site routes (community.kosmosplus.com)
 * -- MUST route through THIS module. It is the only place that decides publish vs
 * hold vs quarantine, so there is exactly one scrub gate for content of any origin.
 *
 * 🔑 THE CHOKE, in one line: feedguard.guard(content, {trusted}) -> a 3-way status
 * -> communitystore.insert*. The status map is the store's model (its docblock):
 *   - NOT clean (feedguard found a leak)      -> 'quarantined' (regardless of trust)
 *   - clean AND trusted                       -> 'published'
 *   - clean AND NOT trusted (held-by-default) -> 'held' (a human releases it later)
 * Since 2026-09-30 an authenticated agent counts as trusted (AGENT_POSTS_PUBLISH_DIRECTLY,
 * below), so an agent's clean post publishes straight away; only an unknown author is held.
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

// A comment id shape (crypto.randomUUID, the store's newId()). parentId must be one
// of these or absent: like board, parentId is served publicly but never scrubbed, so
// it must be an id, never free text that could carry a leak.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
//
// 🔑 #3485 AUTO-PUBLISH (Josh, #admin 2026-09-30 14:41 CDT, verbatim: "Can we push an update
// that just makes it automatic so those agents can go ahead and just publish to the community
// site?"). While AGENT_POSTS_PUBLISH_DIRECTLY is true, an AUTHENTICATED agentId counts as
// trusted, so the agent's CLEAN post or comment is published with no hold and no release step.
// What this does NOT change, and must not:
//   - the scrub. statusFor() checks verdict.clean FIRST, and feedguard's `clean` never reads
//     trust, so a post with any finding is still 'quarantined' and never published.
//   - fail-closed for an unknown author: no agentId and no explicit `trusted` is still held.
//   - an explicit `trusted` (the site's human path, or a caller that asks for a hold) still wins.
//   - rows ALREADY held stay held for the person to Release or Discard (#4525's list); nothing
//     here re-reads or upgrades a stored row. The trust ladder and releaseHeld keep working.
// To turn the hold back on, set this to false: one line, and the ladder resumes where it was.
const AGENT_POSTS_PUBLISH_DIRECTLY = true;
function resolveTrusted(opts) {
  if (typeof opts.trusted === 'boolean') return opts.trusted;
  if (opts.agentId != null && opts.agentId !== '') {
    if (AGENT_POSTS_PUBLISH_DIRECTLY) return true;
    return communitystore.trustState(opts.agentId) === 'trusted';
  }
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
  // would 500 a plain client mistake. Use the store's own falsy test (`!postId`) so a
  // 0/false/NaN postId is caught here too, not misclassified as a store 500.
  // (Nonexistent-parent still comes from the store, classified by its exact phrase.)
  if (!postId) {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'a comment requires a postId' };
  }
  // 🛑 VALIDATE parentId. Like `board`, parentId is a ROUTING key attached AFTER the
  // feedguard snapshot and served publicly (communitystore PUBLIC_FIELDS), so free-text
  // parentId would be an un-scrubbed public field on a published comment -- the exact
  // hole the choke closes, and one feedguard never sees (postId/parentId are stripped
  // before the guard). postId is safe because the store existence-checks it against a
  // real post; parentId has no such gate, so it must be a real comment-id shape (a
  // UUID) here. null/absent/'' means a top-level comment (the store coerces '' -> null).
  // NOTE the deliberate asymmetry: this validates the SHAPE (which closes the leak --
  // a UUID cannot carry free text), not EXISTENCE. A syntactically-valid but
  // nonexistent parentId is a dangling reply, a threading-integrity concern for the
  // store/UI to gate later (as the store already existence-checks postId), not a leak.
  if (parentId != null && parentId !== '' && !UUID_RE.test(String(parentId))) {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'parentId must be a comment id' };
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

// #4373 part B: the community service's own limit on a comment body (kosmos-community
// app/schemas.py CommentIn: 1 to 2000 characters, not blank). Checked at the board, on the
// SCRUBBED text that would be sent, so a comment the service must refuse is refused here,
// never held for a person to release and then refused after.
const SERVICE_COMMENT_MAX = 2000;

// The service's text_problem (kosmos-community app/schemas.py), which it applies to every string it takes:
// an unpaired surrogate, an unassigned code point, a control character other than tab and newlines, or a
// bidirectional embedding, override or isolate control. Refused here with the service's own words.
// The characters Unicode 17 assigned that the service's Unicode 16 (its Python 3.14) still calls unassigned: this
// board's Node is on 17, so \p{Cn} here misses them, and the service refuses each one (its docstring names U+A7F1).
// Generated 2026-09-29 as { Python 3.14 unicodedata Cn } minus { Node 17 \p{Cn} }: 47 ranges, 4803 code points.
// engine/communitycomment-4373.test.js fails the day this board's Node moves past Unicode 17, to regenerate it:
// node tools/gen-service-unicode.js [the service's python] prints this line.
const SERVICE_UNICODE = '16.0.0';
const NEWER_THAN_SERVICE = /[\u{88F}\u{C5C}\u{CDC}\u{1ACF}-\u{1ADD}\u{1AE0}-\u{1AEB}\u{20C1}\u{2B96}\u{A7CE}-\u{A7CF}\u{A7D2}\u{A7D4}\u{A7F1}\u{FBC3}-\u{FBD2}\u{FD90}-\u{FD91}\u{FDC8}-\u{FDCE}\u{10940}-\u{10959}\u{10EC5}-\u{10EC7}\u{10ED0}-\u{10ED8}\u{10EFA}-\u{10EFB}\u{11B60}-\u{11B67}\u{11DB0}-\u{11DDB}\u{11DE0}-\u{11DE9}\u{16EA0}-\u{16EB8}\u{16EBB}-\u{16ED3}\u{16FF2}-\u{16FF6}\u{187F8}-\u{187FF}\u{18D09}-\u{18D1E}\u{18D80}-\u{18DF2}\u{1CCFA}-\u{1CCFC}\u{1CEBA}-\u{1CED0}\u{1CEE0}-\u{1CEF0}\u{1E6C0}-\u{1E6DE}\u{1E6E0}-\u{1E6F5}\u{1E6FE}-\u{1E6FF}\u{1F6D8}\u{1F777}-\u{1F77A}\u{1F8D0}-\u{1F8D8}\u{1FA54}-\u{1FA57}\u{1FA8A}\u{1FA8E}\u{1FAC8}\u{1FACD}\u{1FAEA}\u{1FAEF}\u{1FBFA}\u{2B73A}-\u{2B73F}\u{2CEA2}-\u{2CEAD}\u{323B0}-\u{33479}]/u;
function serviceTextProblem(v) {
  if (/\p{Cs}/u.test(v)) return 'text contains an unpaired surrogate';
  if (/\p{Cn}/u.test(v) || NEWER_THAN_SERVICE.test(v)) return 'text contains a character this server cannot check yet';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v)) return 'text contains a control character';
  if (/[\u202a-\u202e\u2066-\u2069]/.test(v)) return 'text contains a bidirectional override control';
  return null;
}

/**
 * #4373 part B: publish a comment on a post in the PUBLIC community service (a post id
 * `kosmos community read` printed), through the SAME choke as a post: feedguard's scrub,
 * then the authenticated agent's trust state (since #3485 auto-publish on 2026-09-30 a clean
 * comment from an authenticated agent publishes straight away; one the scrub stops is quarantined). `candidate` is
 * { kind, agent, body, at } plus `servicePostId` (required, a UUID) and, for a reply, `serviceParentId` (#4833,
 * the service comment it answers, a UUID). The row is stored
 * in the board's comments with `remotePostId` and no local postId, so the moderation
 * queue and releaseHeld treat it like any comment and the send layer delivers it once
 * published. `opts` is publishComment's. Returns the same shape; never throws.
 */
function publishServiceComment(candidate, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const c = (candidate && typeof candidate === 'object') ? candidate : {};
  const { servicePostId, serviceParentId, postId: _p, parentId: _q, ...content } = c;
  // The service's comment takes a body and an optional parent_id and nothing else (kosmos-community CommentIn forbids other keys), so
  // links would be dropped on the way out with nobody told: refuse them here instead.
  if (content.links !== undefined) {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'a community comment is text only; put a link in the text if it is needed' };
  }
  // Like parentId, the remote post id is a routing key attached after the guard, so
  // it must be an id shape (a UUID cannot carry free text), never whatever was sent.
  if (servicePostId == null || servicePostId === '' || !UUID_RE.test(String(servicePostId))) {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'a comment needs the id of a community post (the one kosmos community read shows)' };
  }
  // #4833: a reply names the service comment it answers, a routing key exactly like servicePostId: an id shape or
  // nothing. Absent (or null or empty) is a top-level comment, as before.
  const hasParent = serviceParentId != null && serviceParentId !== '';
  if (hasParent && !UUID_RE.test(String(serviceParentId))) {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'a reply needs the id of a comment on that post (the one kosmos community read shows after "comment")' };
  }
  const trusted = resolveTrusted(o);
  const verdict = feedguard.guard(content, { trusted, denyNames: o.denyNames });
  if (!isWellFormed(verdict.post)) {
    return { ok: false, reason: 'input', status: 'rejected', findings: verdict.findings, error: 'comment content is not a well-formed submission (not an object or missing required fields)' };
  }
  const text = String(verdict.post.body);
  // Blank as the service judges it: nothing left once invisible characters go (its _is_blank; feedguard's
  // own invisible set), so two zero-width spaces are refused here, not held, released, then refused there.
  if (!text.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu, '').trim()) {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: 'the comment is empty' };
  }
  const problem = serviceTextProblem(text);
  if (problem) return { ok: false, reason: 'input', status: 'rejected', findings: [], error: problem };
  if ([...text].length > SERVICE_COMMENT_MAX) {
    return { ok: false, reason: 'input', status: 'rejected', findings: [], error: `a community comment can be at most ${SERVICE_COMMENT_MAX} characters` };
  }
  const status = statusFor(verdict);
  const rec = { ...verdict.post, remotePostId: String(servicePostId).toLowerCase(), status };
  if (hasParent) rec.remoteParentId = String(serviceParentId).toLowerCase();
  if (o.author != null) rec.author = o.author;
  if (status !== PUBLISHED) rec.findings = verdict.findings;
  let stored;
  try {
    stored = communitystore.insertServiceComment(rec);
  } catch (err) {
    return insertFailure(err, verdict.findings);
  }
  return { ok: true, status, id: stored.id, findings: status !== PUBLISHED ? verdict.findings : [] };
}

module.exports = { publishPost, publishComment, publishServiceComment, statusFor, resolveTrusted, insertFailure, SERVICE_COMMENT_MAX, SERVICE_UNICODE, AGENT_POSTS_PUBLISH_DIRECTLY };

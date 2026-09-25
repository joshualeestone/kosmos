'use strict';

/**
 * Kosmos Community SITE layer (#3485) — Mikey's slice (A).
 *
 * The read + moderation operations behind community.installkosmos.com. This is
 * the thin, testable seam the server.js /api/community routes call: it takes
 * UNTRUSTED request input (query strings), validates and clamps it, and calls
 * engine/communitystore. Keeping the logic here (not in the HTTP handlers) lets
 * it be unit-tested with `node --test` without standing up Express.
 *
 * SCOPE BOUNDARY (deconflicted with Pete + Splinter 2026-09-23): this module is
 * READ + MODERATION only. The board->feed WRITE choke (feedguard.guard -> verdict
 * -> communitystore.insertPost) is Pete's engine lane (B), and the human/comment
 * WRITE routes (which call Pete's choke and own the author.name scrub) are a
 * SEPARATE follow-up in this same slice once feedguard (#3496) lands. Nothing
 * here publishes; the store already serves `published` only and redacts.
 *
 *   node --test engine/communitysite.test.js
 */

const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const feedguard = require('./feedguard');

// Query-param bounds. A public feed takes untrusted pagination, so clamp rather
// than trust: a caller cannot ask for an unbounded page or a negative offset.
const FEED_SORTS = Object.freeze(['commented', 'newest', 'category']);
const FEED_LIMIT_MAX = 100;
const FEED_LIMIT_DEFAULT = 50;
const MOD_LIMIT_MAX = 200;
const MOD_LIMIT_DEFAULT = 100;
const MOD_KINDS = Object.freeze(['all', 'post', 'comment']);
const MOD_STATUSES = Object.freeze(['held', 'quarantined']);
// 🔑 Must match communitystore's board-slug truncation. The store writes
// `String(rec.board).slice(0, 120)` on the post path, and the public feed filters
// by EXACT match (`p.board === board`), so if the store's storage length and this
// read-side cap ever diverge, a `board=` filter would silently stop matching
// stored rows — 0 results, no error. The store owns the canonical value (120);
// this mirrors it deliberately, the same must-match-coupling discipline
// communitystore's MAX_AGENT_LEN documents against feedguard (Convention #5,
// kosmos#1228: two derivations of one fact is this codebase's most-shipped defect).
const BOARD_SLUG_MAX = 120;

// Coerce an untrusted query value to an integer in [min, max]:
//   - ABSENT (undefined / null / '') -> `dflt`. This case is load-bearing:
//     `URLSearchParams.get()` returns null for a missing param, and Number(null)
//     is 0 (finite), so without this guard an absent limit would fall through to
//     the min clamp and the default feed/moderation load would return 1 row
//     instead of its default page size.
//   - unparseable (NaN) -> `dflt`.
//   - below `min` -> `min`; above `max` -> `max`; otherwise the floored integer.
function clampInt(v, dflt, max, min = 0) {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

// A board slug is an optional category filter. Keep it a bounded plain string or
// null; the taxonomy of valid slugs is enforced at write time (the board a post
// carries), so a read filter for an unknown slug simply matches nothing.
function normBoard(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v).slice(0, BOARD_SLUG_MAX);
}

/**
 * The public feed (published-only, redacted, with commentCount). Untrusted
 * `sort` falls back to the homepage default 'commented'; `limit`/`offset` are
 * clamped. Never serves held/quarantined rows — that guarantee lives in
 * communitystore.publicFeed and is asserted in the store's own tests.
 */
function feedView(query = {}) {
  const sort = FEED_SORTS.includes(query.sort) ? query.sort : 'commented';
  const limit = clampInt(query.limit, FEED_LIMIT_DEFAULT, FEED_LIMIT_MAX, 1);
  const offset = clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const board = normBoard(query.board);
  return communitystore.publicFeed({ board, sort, limit, offset });
}

/**
 * Published comments for one post, oldest-first, redacted. Returns [] for a
 * missing/blank id or a non-published parent (the store enforces the parent
 * check; this guards the input shape).
 */
function commentsView(postId) {
  if (postId === undefined || postId === null) return [];
  const id = String(postId).trim();
  if (!id) return [];
  return communitystore.getComments(id);
}

/**
 * The moderation queue (held + quarantined, full fields). NON-PUBLIC — the
 * caller of this (the /api/community/moderation route) MUST be board-token
 * gated. Validates `status`/`kind`, clamps `limit`.
 */
function moderationList(query = {}) {
  const status = MOD_STATUSES.includes(query.status) ? query.status : null;
  const kind = MOD_KINDS.includes(query.kind) ? query.kind : 'all';
  const limit = clampInt(query.limit, MOD_LIMIT_DEFAULT, MOD_LIMIT_MAX, 1);
  return communitystore.moderationQueue({ status, kind, limit });
}

/**
 * Release one held post or comment (moderator action, board-token gated at the
 * route). Validates the id shape; the store throws on an unknown id or a
 * non-held (e.g. quarantined) row, which the route surfaces as a 4xx.
 */
function release(id) {
  if (id === undefined || id === null || String(id).trim() === '') {
    throw new Error('release requires an id');
  }
  return communitystore.releaseHeld(String(id).trim());
}

// ── Human WRITE path (#3485) ────────────────────────────────────────────────
// The board->feed WRITE choke is engine/feedpublish.js: a candidate NEVER reaches
// communitystore except through it (feedguard scrub -> trust ladder ->
// held/published/quarantined). The AGENT write routes call it with `opts.agentId`
// (an authenticated agent, held-by-default on the trust ladder). This SITE seam is
// the HUMAN path: the board route is board-token gated (the account that started
// the board), so the operator is the site-owned human identity and posts `trusted`.
// This module owns the two things the choke does NOT: (1) scrubbing `author.name`
// (feedguard's ALLOWED_FIELDS has no `author`, so a `user` author's name is served
// publicly UN-scanned unless the caller cleans it), and (2) assigning the `board`
// category from the site's taxonomy.

// Max stored author-name length. 🔑 Must equal feedguard's `agent` cap and
// communitystore's MAX_AGENT_LEN (80): the store truncates a stored author name to
// MAX_AGENT_LEN, so a longer value would be silently cut after this layer believed
// it clean. Sourced from feedguard.LIMITS rather than re-typed, the same
// must-match-coupling discipline BOARD_SLUG_MAX documents above (kosmos#1228).
const MAX_AUTHOR_LEN = feedguard.LIMITS.agent;
// An empty/blank submitted name is not an error (a human may omit it); it renders
// under a neutral label rather than blank or the operator's real identity.
const DEFAULT_AUTHOR_NAME = 'Anonymous';

/**
 * Clean an untrusted human display name for a `user` author, whose `name` is
 * served publicly (communitystore PUBLIC_FIELDS) but NOT scanned by feedguard.
 * Returns { ok: true, name } with a normalized, length-capped name (or the neutral
 * default when blank), or { ok: false, error } when the name carries PII/secret
 * material (a feedguard.PATTERNS class) or impersonates a denied name
 * (feedguard.DEFAULT_DENY_NAMES). The error message names CATEGORIES, never which
 * pattern hit, so it is not an evasion oracle.
 */
function scrubAuthorName(raw) {
  let s = String(raw == null ? '' : raw);
  // Strip ALL Unicode format characters (\p{Cf}: zero-width space/joiner, word joiner,
  // soft hyphen, BOM, bidi embeddings/overrides, ...) BEFORE NFKC, mirroring feedguard's
  // normalizeForNameScan (feedguard.js) exactly. 🔑 This scrub is the SOLE cleaner of a
  // `user` author's publicly-served name (feedguard never scans `author`), so if it strips
  // a NARROWER set than feedguard's deny-name scan, the two diverge (Convention #5): a
  // soft-hyphen/bidi impersonation ("Jos­h Stone") would slip THIS up-front deny check
  // and land in the public display name, caught only later as a quarantine by the
  // belt-and-suspenders `agent` re-scan rather than rejected. The fallback enumerates the
  // class for an engine without \p{Cf} support, as feedguard's does.
  try { s = s.replace(/\p{Cf}/gu, ''); }
  catch { s = s.replace(/[­​-‏⁠-⁤‪-‮⁦-⁩﻿]/g, ''); }
  s = s.normalize('NFKC');
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ');  // control chars -> space
  s = s.replace(/\s+/g, ' ').trim();
  s = s.slice(0, MAX_AUTHOR_LEN);
  if (!s) return { ok: true, name: DEFAULT_AUTHOR_NAME };
  // Impersonation: a human must not post under the operator's real name/handles.
  // Case-insensitive substring, matching feedguard's own deny-name posture.
  const low = s.toLowerCase();
  for (const dn of feedguard.DEFAULT_DENY_NAMES) {
    if (low.includes(String(dn).toLowerCase())) {
      return { ok: false, error: 'that display name is not allowed (it names another person)' };
    }
  }
  // PII / secret material in the name (email, phone, tokens, card/SSN, etc.).
  for (const p of feedguard.PATTERNS) {
    const hit = p.re ? p.re.test(s) : (typeof p.fn === 'function' && p.fn(s));
    if (hit) {
      return { ok: false, error: 'that display name is not allowed (remove any email, phone number, or secret)' };
    }
  }
  return { ok: true, name: s };
}

// Build the shared, feedguard-well-formed candidate fields for a human submission.
// `kind` is feedguard.KIND (the single source of the required kind value), `agent`
// is the scrubbed name (so feedguard ALSO scans it and holds the row if the name
// scrub ever misses a leak), and `at` is minted here (a human client is not trusted
// to stamp its own time).
function humanCandidate(name, body, links) {
  const c = { kind: feedguard.KIND, agent: name, body, at: new Date().toISOString() };
  if (links !== undefined) c.links = links;
  return c;
}

/**
 * Publish a HUMAN post through the choke as a trusted, site-identified user.
 * `input`: { authorName?, topic?, body, links?, board? }. Returns feedpublish's
 * shape ({ ok, status, id?, error?, reason? }); `findings` are NOT surfaced (the
 * route must not echo them either). A bad author name is a clean input rejection.
 */
function publishHumanPost(input = {}) {
  const i = (input && typeof input === 'object') ? input : {};
  const scrub = scrubAuthorName(i.authorName != null ? i.authorName : (i.author && i.author.name));
  if (!scrub.ok) return { ok: false, reason: 'input', status: 'rejected', findings: [], error: scrub.error };
  const name = scrub.name;
  const candidate = humanCandidate(name, i.body, i.links);
  if (i.topic !== undefined) candidate.topic = i.topic;
  // trusted: the board-token gate already proved this is the operator. board is the
  // site's category (feedpublish format-validates it); author is served publicly.
  return feedpublish.publishPost(candidate, { trusted: true, board: i.board, author: { type: 'user', name } });
}

/**
 * Publish a HUMAN comment through the choke. `input`: { authorName?, body,
 * links?, postId, parentId? }. postId/parentId are routing keys feedpublish
 * strips before feedguard and re-attaches after; comments carry no board.
 */
function publishHumanComment(input = {}) {
  const i = (input && typeof input === 'object') ? input : {};
  const scrub = scrubAuthorName(i.authorName != null ? i.authorName : (i.author && i.author.name));
  if (!scrub.ok) return { ok: false, reason: 'input', status: 'rejected', findings: [], error: scrub.error };
  const name = scrub.name;
  const candidate = humanCandidate(name, i.body, i.links);
  candidate.postId = i.postId;
  if (i.parentId !== undefined) candidate.parentId = i.parentId;
  return feedpublish.publishComment(candidate, { trusted: true, author: { type: 'user', name } });
}

// Only the route-reachable functions are exported: server.js's /api/community
// handlers call all six. The input coercers (clampInt/normBoard/humanCandidate)
// and the bound constants stay module-private and are covered through these public
// functions, so nothing here is a test-only export (the engine.reachable #265
// guard). scrubAuthorName is exported because its rejection classes are unit-tested
// directly (a leak/impersonation net proven only through the route is under-tested)
// AND it is reachable through publishHumanPost/Comment.
module.exports = {
  feedView,
  commentsView,
  moderationList,
  release,
  publishHumanPost,
  publishHumanComment,
  scrubAuthorName,
};

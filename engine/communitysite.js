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

// Query-param bounds. A public feed takes untrusted pagination, so clamp rather
// than trust: a caller cannot ask for an unbounded page or a negative offset.
const FEED_SORTS = Object.freeze(['commented', 'newest', 'category']);
const FEED_LIMIT_MAX = 100;
const FEED_LIMIT_DEFAULT = 50;
const MOD_LIMIT_MAX = 200;
const MOD_LIMIT_DEFAULT = 100;
const MOD_KINDS = Object.freeze(['all', 'post', 'comment']);
const MOD_STATUSES = Object.freeze(['held', 'quarantined']);
const BOARD_SLUG_MAX = 120;

// Coerce an untrusted value to a non-negative integer within [0, max], falling
// back to `dflt` on anything unparseable (NaN, negative, a string, undefined).
function clampInt(v, dflt, max, min = 0) {
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

// Only the route-reachable functions are exported: server.js's /api/community
// handlers call all four. The input coercers (clampInt/normBoard) and the bound
// constants stay module-private and are covered through these public functions,
// so nothing here is a test-only export (the engine.reachable #265 guard).
module.exports = {
  feedView,
  commentsView,
  moderationList,
  release,
};

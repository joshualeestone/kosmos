'use strict';

/**
 * Kosmos Community feed store (#3485) — the data-model slice.
 *
 * The persistence layer under the open, public community feed
 * (community.installkosmos.com): posts, comments, and per-agent trust state.
 * This module owns storage + queries ONLY. It does NOT scrub content
 * (`engine/feedguard.js` does, at the board's single `feed.publish()` choke
 * point) and it does NOT own the routes or the page (Mikey's build slice).
 *
 * The board wires the two together per Pete's emit-path contract (#3485):
 *
 *   const feedguard = require('./feedguard');
 *   const trusted = communitystore.trustState(agentId) === 'trusted';
 *   const verdict = feedguard.guard(candidate, { trusted });   // pure, never throws
 *   if (verdict.disposition === 'publish') {
 *     communitystore.insertPost({ ...verdict.post, status: 'published' });
 *   } else {
 *     const status = verdict.clean ? 'held' : 'quarantined';
 *     communitystore.insertPost({ ...verdict.post, status, findings: verdict.findings });
 *   }
 *
 * 🔑 Two safety layers, kept distinct (Pete's held-by-default policy, #3485):
 *   1. Scrubber (feedguard, the backstop): a post must be `clean` to publish.
 *      A leak is `quarantined` regardless of trust.
 *   2. Held-by-default (the primary, enforced HERE): a clean post from an
 *      UNTRUSTED agent lands `held`, not published, until a human releases it.
 *      Every agent starts untrusted and earns trust after K human-released
 *      posts. This bounds NOVEL PII the pattern scrubber cannot match.
 *
 * 🛑 The public feed serves `status === 'published'` ONLY. `held` and
 * `quarantined` posts live in the same store but never reach `publicFeed()`,
 * and `toPublic()` strips the internal `session` routing key and the
 * moderation `findings` before any post leaves for a public surface.
 *
 * Storage: JSON files under `store.ROOT/community/` (posts.json, comments.json,
 * trust.json), atomic write (mkdir-first, tmp + rename) in the engine idiom
 * (see activity.js / boardauth.js). The board is single-process, so its
 * synchronous inserts serialize; a growing feed rewrites the whole collection
 * on each insert (O(n)) — fine for the beta's volume, documented as the first
 * thing to replace with a real store if the feed grows large.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const store = require('./store');

const FILE_MODE = 0o600;

// The candidate fields an agent emits (mirrors feedguard ALLOWED_FIELDS). The
// store keeps these plus its own envelope (id, status, author, receivedAt,
// findings). `session` is INTERNAL — kept for board routing, never public.
const POST_CANDIDATE_FIELDS = Object.freeze([
  'v', 'kind', 'agent', 'session', 'at', 'topic', 'body', 'links',
]);

const STATUSES = Object.freeze(['held', 'published', 'quarantined']);
const TRUST_STATES = Object.freeze(['untrusted', 'trusted']);

// K: consecutive human-released posts that promote an agent untrusted -> trusted.
// A starting value, not a load-bearing constant (Pete's policy; tune on observed
// leak rates, which we do not have yet).
const PROMOTE_THRESHOLD = 3;

function dir() { return path.join(store.ROOT, 'community'); }
function postsFile() { return path.join(dir(), 'posts.json'); }
function commentsFile() { return path.join(dir(), 'comments.json'); }
function trustFile() { return path.join(dir(), 'trust.json'); }

// Read a JSON collection, defaulting to `fallback`. A MISSING file is a clean
// fallback (fresh install). A CORRUPT file is different: returning `fallback`
// and letting the next insert overwrite it would silently DISCARD every prior
// row (the file is rewritten whole on each write). So a corrupt file is first
// QUARANTINED to a `.corrupt-<ts>` sidecar — the bytes are preserved for
// recovery, the live path starts fresh, and the board never wedges on one bad
// row. (Atomic writes make corruption unlikely; the loss if it happened would
// be silent and unrecoverable, which is the part worth guarding.)
function loadJson(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return fallback; // missing: clean fallback, nothing to preserve
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    // Present but unparseable: preserve the bytes before any write clobbers them.
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
    return fallback;
  }
}

// Write a JSON collection atomically. mkdir-first: `store.ROOT/community` does
// not exist on a fresh machine, and an atomic tmp+rename ENOENTs on the tmp
// open if the parent is missing (the pushsub #718 lesson). The tmp name carries
// a random suffix so two writers (the board plus a CLI, or parallel test
// processes) cannot collide on one tmp path even though the documented model is
// single-process.
function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: FILE_MODE });
  fs.renameSync(tmp, file);
}

function nowISO() { return new Date().toISOString(); }
function newId() { return crypto.randomUUID(); }

// Normalize an author. Agent posts arrive via feedguard with no `author`, so we
// derive { type: 'agent', name: <persona> } from the post's `agent` field.
// User posts (magic-link authed, via the web route) pass an explicit author.
// ⚠️ A `user` author's `name` is served publicly (via `author` in PUBLIC_FIELDS)
// and is NOT scrubbed by feedguard, which scans the agent-post `agent` field, not
// `author.name`. The board route that accepts user posts owns scrubbing
// user-supplied names, and the user moderation/trust path is a documented
// follow-up (plan weakest-premise #3). Flagged here because this store is the
// last common gate before a row goes public.
function normalizeAuthor(rec) {
  if (rec.author && typeof rec.author === 'object') {
    const type = rec.author.type === 'user' ? 'user' : 'agent';
    const name = String(rec.author.name || rec.agent || '').slice(0, 80);
    return { type, name };
  }
  return { type: 'agent', name: String(rec.agent || '').slice(0, 80) };
}

/**
 * Insert a post. Called by the board AFTER feedguard, with a status the board
 * already decided (`published` | `held` | `quarantined`). Takes the allowed
 * candidate fields (from `verdict.post`), plus status, optional findings
 * (held/quarantined only), optional board (category slug the route assigns —
 * the taxonomy itself is Mikey's inventory, this store just indexes the slug),
 * and optional author (for user posts). Returns the stored record.
 */
function insertPost(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('post record required');
  const status = rec.status;
  if (!STATUSES.includes(status)) {
    throw new Error(`post status must be one of ${STATUSES.join('|')}`);
  }
  const post = {
    id: newId(),
    status,
    author: normalizeAuthor(rec),
    board: rec.board ? String(rec.board).slice(0, 120) : null,
    receivedAt: nowISO(), // server clock — the sort key, never the agent-supplied `at`
  };
  for (const f of POST_CANDIDATE_FIELDS) {
    if (rec[f] !== undefined) post[f] = rec[f];
  }
  // findings only travel with a non-published post, for the moderator UI. They
  // never contain raw secret text (feedguard redacts), but they are internal.
  if (status !== 'published' && Array.isArray(rec.findings)) {
    post.findings = rec.findings;
  }

  const posts = loadJson(postsFile(), []);
  posts.push(post);
  saveJson(postsFile(), posts);
  return post;
}

/**
 * Insert a comment on a post. Comments are public agent/user content too, so
 * they carry the same status model (the board runs them through feedguard and
 * the trust check exactly as posts). `parentId` (optional) references another
 * comment for threaded replies; null is a top-level comment on the post. Depth
 * is not constrained here — the rendering surface decides how deep to nest.
 */
function insertComment(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('comment record required');
  if (!rec.postId) throw new Error('comment requires postId');
  const status = rec.status;
  if (!STATUSES.includes(status)) {
    throw new Error(`comment status must be one of ${STATUSES.join('|')}`);
  }
  const comment = {
    id: newId(),
    postId: String(rec.postId),
    parentId: rec.parentId ? String(rec.parentId) : null,
    status,
    author: normalizeAuthor(rec),
    at: rec.at,
    body: rec.body,
    receivedAt: nowISO(),
  };
  if (rec.session !== undefined) comment.session = rec.session; // internal, never public
  if (status !== 'published' && Array.isArray(rec.findings)) {
    comment.findings = rec.findings;
  }

  const comments = loadJson(commentsFile(), []);
  comments.push(comment);
  saveJson(commentsFile(), comments);
  return comment;
}

// The fields safe to serve on the open public feed, for posts AND comments.
// This is an ALLOWLIST on purpose (not a denylist): on a public surface a NEW
// internal field must default to NOT-served, so adding one later cannot leak by
// omission. `session` (internal routing), `findings` (moderation) and `status`
// (bookkeeping) are simply absent from this list, and so is anything future.
const PUBLIC_FIELDS = Object.freeze([
  'id', 'postId', 'parentId', 'author', 'board', 'receivedAt',
  'v', 'kind', 'agent', 'at', 'topic', 'body', 'links',
]);

// Project a stored row to its public shape — the store's guardrail-redaction
// duty, the last gate before a row is serialized to the open feed. Allowlist,
// so an unlisted field (session, findings, status, or any field added later)
// is never served.
function toPublic(rec) {
  if (!rec) return null;
  const pub = {};
  for (const f of PUBLIC_FIELDS) {
    if (rec[f] !== undefined) pub[f] = rec[f];
  }
  return pub;
}

// Count of PUBLISHED comments on a post (the "most-commented" ranking signal).
// Computed at query time rather than denormalized, so it cannot drift.
function publishedCommentCount(comments, postId) {
  let n = 0;
  for (const c of comments) {
    if (c.postId === postId && c.status === 'published') n += 1;
  }
  return n;
}

/**
 * The public feed: PUBLISHED posts only, redacted, with a computed
 * commentCount. `sort` is one of:
 *   'commented' — most published comments first (Josh's default homepage sort)
 *   'newest'    — most recently received first
 *   'category'  — within a board, newest first (requires `board`)
 * `board` filters to one category slug. `limit`/`offset` paginate.
 */
function publicFeed(opts = {}) {
  const { board = null, sort = 'commented', limit = 50, offset = 0 } = opts;
  const posts = loadJson(postsFile(), []);
  const comments = loadJson(commentsFile(), []);

  let rows = posts.filter((p) => p.status === 'published');
  if (board) rows = rows.filter((p) => p.board === board);

  const withCounts = rows.map((p) => ({
    ...toPublic(p),
    commentCount: publishedCommentCount(comments, p.id),
  }));

  const byNewest = (a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt));
  if (sort === 'commented') {
    withCounts.sort((a, b) => (b.commentCount - a.commentCount) || byNewest(a, b));
  } else {
    // 'newest' and 'category' both order by recency; 'category' is 'newest'
    // already scoped to a board by the filter above.
    withCounts.sort(byNewest);
  }

  return withCounts.slice(offset, offset + limit);
}

// Published comments for a post, oldest-first (reading order), redacted.
function getComments(postId) {
  const comments = loadJson(commentsFile(), []);
  return comments
    .filter((c) => c.postId === String(postId) && c.status === 'published')
    .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)))
    .map(toPublic);
}

// The non-public moderation queue: held and/or quarantined rows, FULL fields
// (findings included) for the moderator surface. Never a public path.
function moderationQueue(opts = {}) {
  const { status = null, limit = 100 } = opts;
  const posts = loadJson(postsFile(), []);
  let rows = posts.filter((p) => p.status === 'held' || p.status === 'quarantined');
  if (status) rows = rows.filter((p) => p.status === status);
  rows.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
  return rows.slice(0, limit);
}

// ── Per-agent trust (held-by-default) ──────────────────────────────────────
//
// 🔑 THE TRUST KEY IS THE POST'S `agent` PERSONA, and the board MUST pass that
// SAME string to trustState() when it computes the `trusted` flag for
// feedguard.guard(). releaseHeld credits post.author.name (derived from the
// post's `agent`), so if the board keyed trustState() on a DIFFERENT identifier
// (a session id, an account id), credit would accrue under one key and be read
// under another, and an agent would never promote — silently, with no error.
// The store cannot enforce what the board passes; this is the contract the board
// must honour, stated here because the failure is invisible.

function loadTrust() { return loadJson(trustFile(), {}); }

function trustRecord(agentId) {
  const all = loadTrust();
  return all[agentId] || { trust: 'untrusted', approved_count: 0 };
}

// The value the board passes to feedguard.guard({ trusted }).
function trustState(agentId) {
  return trustRecord(agentId).trust === 'trusted' ? 'trusted' : 'untrusted';
}

// A moderator releases one held post: publish it and credit its author agent.
// At K credited releases the agent flips to trusted. Returns the updated post.
function releaseHeld(postId) {
  const posts = loadJson(postsFile(), []);
  const post = posts.find((p) => p.id === String(postId));
  if (!post) throw new Error('no such post');
  if (post.status !== 'held') throw new Error('only a held post can be released');
  post.status = 'published';
  delete post.findings; // published posts carry no moderation findings
  saveJson(postsFile(), posts);

  // Credit the author agent (user authors have no agent-trust ladder).
  if (post.author && post.author.type === 'agent' && post.author.name) {
    recordApproval(post.author.name);
  }
  return post;
}

// Increment an agent's approved_count; flip to trusted at K. Idempotent-safe:
// an already-trusted agent stays trusted.
function recordApproval(agentId) {
  const all = loadTrust();
  const rec = all[agentId] || { trust: 'untrusted', approved_count: 0 };
  if (rec.trust !== 'trusted') {
    rec.approved_count = (rec.approved_count || 0) + 1;
    if (rec.approved_count >= PROMOTE_THRESHOLD) rec.trust = 'trusted';
  }
  all[agentId] = rec;
  saveJson(trustFile(), all);
  return rec;
}

// Explicit operator/admin grant — promotes immediately, no ladder.
function grantTrust(agentId) {
  const all = loadTrust();
  all[agentId] = { trust: 'trusted', approved_count: PROMOTE_THRESHOLD };
  saveJson(trustFile(), all);
  return all[agentId];
}

// Demotion: a confirmed human-caught leak drops a trusted agent back to
// untrusted, to re-earn trust. Resets the ladder.
function revokeTrust(agentId) {
  const all = loadTrust();
  all[agentId] = { trust: 'untrusted', approved_count: 0 };
  saveJson(trustFile(), all);
  return all[agentId];
}

module.exports = {
  // constants (exported so the board and tests share one source of truth)
  STATUSES,
  TRUST_STATES,
  PROMOTE_THRESHOLD,
  POST_CANDIDATE_FIELDS,
  // posts + comments
  insertPost,
  insertComment,
  publicFeed,
  getComments,
  moderationQueue,
  toPublic,
  // trust
  trustState,
  trustRecord,
  releaseHeld,
  recordApproval,
  grantTrust,
  revokeTrust,
  // paths (for tests / diagnostics)
  _paths: { dir, postsFile, commentsFile, trustFile },
};

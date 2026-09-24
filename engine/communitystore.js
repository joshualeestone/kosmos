'use strict';

/**
 * Kosmos Community feed store (#3485) — the data-model slice.
 *
 * The persistence layer under the open, public community feed
 * (community.installkosmos.com): posts, comments, and per-agent trust state.
 * This module owns storage + queries ONLY. It does NOT scrub content
 * (`engine/feedguard.js` does) and it does NOT own the routes or the page
 * (Mikey's build slice).
 *
 * 🛑 DO NOT call insertPost/insertComment directly with a hand-wired feedguard +
 * status mapping. That wiring now lives ONCE in `engine/feedpublish.js` (the
 * board->feed choke, #3485): every caller -- the agent/board routes AND the site's
 * human post/comment routes -- MUST go through `feedpublish.publishPost` /
 * `feedpublish.publishComment`, so no content of ANY origin reaches this store
 * un-scrubbed. Reproducing the mapping inline is exactly the bypass the choke exists
 * to prevent. The primitive computes trust (from an AUTHENTICATED identity, never a
 * self-declared field), scrubs, maps the 3-way status, validates `board`, and calls
 * the inserts below:
 *
 *   const feedpublish = require('./feedpublish');
 *   const r = feedpublish.publishPost(candidate, { agentId });   // agent path
 *   //   or ({ trusted, author })                                // site/human path
 *   // -> { ok, status: 'published'|'held'|'quarantined', id }
 *
 * 🔑 Two safety layers, kept distinct (Pete's held-by-default policy, #3485).
 * Both are DISPOSITION decisions the BOARD makes at feed.publish() (feedguard +
 * the trust ladder below); this store PERSISTS the status the board decided and
 * does not itself re-decide publish-vs-hold:
 *   1. Scrubber (feedguard, the backstop): a post must be `clean` to publish; a
 *      leak is `quarantined` regardless of trust.
 *   2. Held-by-default (the primary): the board gives a clean post from an
 *      UNTRUSTED agent `held`, not `published`, until a human releases it. The
 *      board reads the trust ladder THIS module owns (start untrusted, promote
 *      after K human releases) to make that call. It bounds NOVEL PII the
 *      pattern scrubber cannot match.
 * So what this store ENFORCES is narrower than the two layers above: the
 * public/moderation SPLIT (only `published` is ever served) and redaction
 * (toPublic). WHICH status a row gets is the board's decision, persisted here.
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

// Max stored length for a persona/author name. 🔑 This MUST equal feedguard's
// `LIMITS.agent` (80): the agent path arrives already capped there, so this is a
// no-op backstop on that path — but it becomes the trust-ladder credit key in
// releaseHeld -> recordApproval, and the board reads trustState() under the same
// persona. If this cap and feedguard's ever diverged, a name between the two
// lengths would be credited under one key and read under another, silently
// breaking promotion. Kept a named constant rather than a bare 80 so the coupling
// is visible; not imported from feedguard, to keep this store dependency-free.
const MAX_AGENT_LEN = 80;

// The candidate fields an agent emits (mirrors feedguard ALLOWED_FIELDS). The
// store keeps these plus its own envelope (id, status, author, receivedAt,
// findings). `session` is INTERNAL — kept for board routing, never public.
const POST_CANDIDATE_FIELDS = Object.freeze([
  'v', 'kind', 'agent', 'session', 'at', 'topic', 'body', 'links',
]);

const STATUSES = Object.freeze(['held', 'published', 'quarantined']);

// K: consecutive human-released posts that promote an agent untrusted -> trusted.
// A starting value, not a load-bearing constant (Pete's policy; tune on observed
// leak rates, which we do not have yet).
const PROMOTE_THRESHOLD = 3;

function dir() { return path.join(store.ROOT, 'community'); }
function postsFile() { return path.join(dir(), 'posts.json'); }
function commentsFile() { return path.join(dir(), 'comments.json'); }
function trustFile() { return path.join(dir(), 'trust.json'); }

// Preserve a corrupt/wrong-shape collection file to a sidecar before any write
// can clobber it. The name carries a random suffix as well as the timestamp so
// two corruptions in the same millisecond cannot collide on one sidecar name and
// silently lose the first file's bytes. Best-effort: a failed rename must not
// throw out of a read path.
function quarantineCorrupt(file) {
  try {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  } catch (e) {
    // Best-effort, but NOT silent: if the rename fails (read-only mount,
    // permissions), the corrupt file stays in place and the next saveJson will
    // overwrite it, destroying the bytes this quarantine exists to preserve. That
    // is exactly the silent unrecoverable loss worth guarding, so at least make
    // the failure visible on stderr rather than swallowing it.
    try { console.error(`communitystore: could not quarantine corrupt file ${file}: ${e && e.message}`); } catch { /* ignore */ }
  }
}

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
    // Valid JSON of the WRONG SHAPE (`null`, `42`, or `{}` where an array is
    // expected) would throw on the next push/filter; treat any shape mismatch
    // like corruption so recovery is symmetric with the parse-error path rather
    // than a later TypeError. `null` counts as wrong-shape too (it is not the
    // fallback collection), so it is quarantined, not silently accepted.
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed) !== Array.isArray(fallback)) {
      quarantineCorrupt(file);
      return fallback;
    }
    return parsed;
  } catch (e) {
    // Present but unparseable: preserve the bytes before any write clobbers them.
    quarantineCorrupt(file);
    return fallback;
  }
}

// Write a JSON collection atomically. mkdir-first: `store.ROOT/community` does
// not exist on a fresh machine, and an atomic tmp+rename ENOENTs on the tmp
// open if the parent is missing (the pushsub #718 lesson). The random tmp-name
// suffix stops two writers from colliding on one tmp PATH — it does NOT make the
// read-modify-write cycle (load whole collection, mutate, save whole collection)
// safe against concurrent writers: that is still last-write-wins and can drop an
// update. The single-process board model assumes that away, and a real store is
// the documented first replacement if that assumption ever weakens (plan
// weakest-premise #2). This suffix is only about the tmp filename.
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
    const name = String(rec.author.name || rec.agent || '').slice(0, MAX_AGENT_LEN);
    return { type, name };
  }
  return { type: 'agent', name: String(rec.agent || '').slice(0, MAX_AGENT_LEN) };
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
 * Insert a comment on a post. A comment shares posts' STATUS + trust +
 * moderation model (held/quarantined/published, held-by-default, moderationQueue
 * + releaseHeld) but carries a REDUCED field set: body + links + author + at,
 * not the post-level topic/board. `postId` and `parentId` are the board's
 * routing keys, NOT part of feedguard's shape (its ALLOWED_FIELDS has no
 * postId/parentId), so the board scrubs a comment's CONTENT fields through
 * feedguard and attaches postId/parentId around that call — the store does not
 * pass a whole comment candidate through the guard. `parentId` (optional)
 * threads a reply; null is top-level. Depth is not constrained here.
 */
function insertComment(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('comment record required');
  if (!rec.postId) throw new Error('comment requires postId');
  const status = rec.status;
  if (!STATUSES.includes(status)) {
    throw new Error(`comment status must be one of ${STATUSES.join('|')}`);
  }
  // The parent post must exist. A comment on a nonexistent post is an orphan row
  // that could never surface (getComments requires a published parent) and would
  // sit in the moderation queue forever; reject it rather than store it silently.
  const parent = loadJson(postsFile(), []).find((p) => p.id === String(rec.postId));
  if (!parent) throw new Error('comment references a nonexistent post');
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
  // Links are public content a comment may carry (PUBLIC_FIELDS serves them); do
  // not silently drop them. topic/board are post-level and intentionally omitted.
  if (rec.links !== undefined) comment.links = rec.links;
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
 *   'category'  — recency order too; it is 'newest' scoped by the `board`
 *                 filter rather than a distinct ordering. Passing it without a
 *                 `board` is not an error, it just behaves as 'newest' over the
 *                 whole feed. The scoping comes from `board`, not from this value.
 * `board` filters to one category slug (independent of `sort`). `limit`/`offset` paginate.
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
    // 'newest' and 'category' both order by recency; any board scoping was
    // already applied by the `board` filter above, independent of `sort`.
    withCounts.sort(byNewest);
  }

  return withCounts.slice(offset, offset + limit);
}

// Published comments for a post, oldest-first (reading order), redacted.
// Defense-in-depth: if the parent post is not itself `published`, serve NOTHING
// — a public comment must never surface through a post that is held/quarantined
// or absent. Not reachable in the normal flow (held post ids are never exposed,
// so nobody can be viewing one), but this is a public surface and the check is cheap.
function getComments(postId) {
  const key = String(postId);
  const parent = loadJson(postsFile(), []).find((p) => p.id === key);
  if (!parent || parent.status !== 'published') return [];
  const comments = loadJson(commentsFile(), []);
  return comments
    .filter((c) => c.postId === key && c.status === 'published')
    .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)))
    .map(toPublic);
}

// The non-public moderation queue: held and/or quarantined rows, FULL fields
// (findings included) for the moderator surface. Never a public path.
// `kind` selects the collection: 'all' (the DEFAULT — posts + comments, a
// comment row is distinguishable by its `postId`), 'post', or 'comment'. The
// default is 'all' deliberately: a naive `moderationQueue()` must not silently
// omit held comments, which carry the same held/quarantined status model as
// posts and need the same moderation visibility. `status` narrows to one
// status; `limit` caps the result.
function moderationQueue(opts = {}) {
  const { status = null, kind = 'all', limit = 100 } = opts;
  const match = (r) => (r.status === 'held' || r.status === 'quarantined') && (!status || r.status === status);
  let rows = [];
  if (kind === 'post' || kind === 'all') rows = rows.concat(loadJson(postsFile(), []).filter(match));
  if (kind === 'comment' || kind === 'all') rows = rows.concat(loadJson(commentsFile(), []).filter(match));
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

// Normalize a trust key the SAME way normalizeAuthor normalizes a stored author
// name (truncate to MAX_AGENT_LEN). This closes a real present asymmetry: the
// credit side stores `author.name` truncated, while the board's lookup side
// calls trustState() with the raw candidate `agent` (feedguard never truncates,
// it only flags oversize). Without normalizing both sides, an agent persona over
// MAX_AGENT_LEN would be credited under the truncated key and looked up under the
// full one, and never promote. Applying it here makes the store self-consistent
// regardless of which form the board passes.
function trustKey(agentId) {
  return String(agentId || '').slice(0, MAX_AGENT_LEN);
}

function trustRecord(agentId) {
  const all = loadTrust();
  return all[trustKey(agentId)] || { trust: 'untrusted', approved_count: 0 };
}

// The value the board passes to feedguard.guard({ trusted }).
function trustState(agentId) {
  return trustRecord(agentId).trust === 'trusted' ? 'trusted' : 'untrusted';
}

// A moderator releases one HELD post OR comment (looked up by id in either
// collection): publish it and, for a post, credit its author agent's trust
// ladder. Returns the updated row.
//
// Two deliberate decisions, stated so they are not read as oversights:
//   - Only a `held` row can be released. A `quarantined` row (the scrubber
//     caught a leak) is NOT releasable here: quarantine is the harder backstop,
//     and overriding a scrubber hit as a false positive is a higher-stakes
//     action left to the moderation surface to design (#3485), not a quiet
//     capability of this store.
//   - Releasing a POST credits the author's trust ladder; releasing a COMMENT
//     does NOT. Pete's held-by-default ladder is post-based ("K human-approved
//     posts"), so a comment release gates that comment's visibility without
//     advancing the author toward trusted. This is the one way comment
//     moderation is NOT "exactly as posts".
function releaseHeld(id) {
  const key = String(id);

  const posts = loadJson(postsFile(), []);
  const post = posts.find((p) => p.id === key);
  if (post) {
    if (post.status !== 'held') throw new Error('only a held post can be released');
    post.status = 'published';
    delete post.findings; // published rows carry no moderation findings
    saveJson(postsFile(), posts);
    // Credit the author agent (user authors have no agent-trust ladder).
    if (post.author && post.author.type === 'agent' && post.author.name) {
      recordApproval(post.author.name);
    }
    return post;
  }

  const comments = loadJson(commentsFile(), []);
  const comment = comments.find((c) => c.id === key);
  if (comment) {
    if (comment.status !== 'held') throw new Error('only a held comment can be released');
    comment.status = 'published';
    delete comment.findings;
    saveJson(commentsFile(), comments);
    // No trust credit for a comment release — the ladder is post-based (above).
    return comment;
  }

  throw new Error('no such held post or comment');
}

// Increment an agent's approved_count; flip to trusted at K. Idempotent-safe:
// an already-trusted agent stays trusted.
function recordApproval(agentId) {
  const key = trustKey(agentId);
  const all = loadTrust();
  const rec = all[key] || { trust: 'untrusted', approved_count: 0 };
  if (rec.trust !== 'trusted') {
    rec.approved_count = (rec.approved_count || 0) + 1;
    if (rec.approved_count >= PROMOTE_THRESHOLD) rec.trust = 'trusted';
  }
  all[key] = rec;
  saveJson(trustFile(), all);
  return rec;
}

// Explicit operator/admin grant — promotes immediately, no ladder.
function grantTrust(agentId) {
  const all = loadTrust();
  all[trustKey(agentId)] = { trust: 'trusted', approved_count: PROMOTE_THRESHOLD };
  saveJson(trustFile(), all);
  return all[trustKey(agentId)];
}

// Demotion: a confirmed human-caught leak drops a trusted agent back to
// untrusted, to re-earn trust. Resets the ladder.
function revokeTrust(agentId) {
  const all = loadTrust();
  all[trustKey(agentId)] = { trust: 'untrusted', approved_count: 0 };
  saveJson(trustFile(), all);
  return all[trustKey(agentId)];
}

module.exports = {
  // constants (exported so the board and tests share one source of truth)
  STATUSES,
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

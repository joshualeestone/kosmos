# Plan: Kosmos Community feed store — data-model slice (#3485)

## Context

Josh's #3485 vision (community.installkosmos.com, an open Reddit-style agent+user
community) was scoped into a build directive this session (relayed by Splinter,
per Josh's never-idle + make-the-call ruling). Work is split:

- **Angel (this PR):** the DATA MODEL — the store: post/comment records, per-agent
  trust state, the public-feed query, the moderation queue.
- **Mikey:** the build — the community page UI, the server.js `/api/community`
  routes (incl. the `feed.publish()` choke point that wires feedguard -> this
  store), the category taxonomy/inventory, styling port.
- **PigeonPete (#3496, draft):** `engine/feedguard.js`, the fail-closed content
  scrubber at the single publish choke point. Already built; plugs into this
  store when it lands.

Boundary flagged to Mikey before building (kosmos msg). Shared seam = the
`insertPost` signature (I own it; the board route calls it).

## What "done" looks like

A new engine module `engine/communitystore.js` (+ test) that:
1. Satisfies Pete's emit-path contract: the board calls
   `insertPost({ ...verdict.post, status, findings })`.
2. Enforces the two safety layers as a store:
   - held/quarantined posts NEVER appear in `publicFeed()`; only `published` do.
   - `toPublic()` redacts the internal `session` routing key and moderation
     `findings` before any row reaches a public surface.
3. Implements held-by-default trust (every agent untrusted; K=3 human releases
   promote; explicit grant/revoke).
4. Serves the homepage sorts Josh ruled: most-commented / newest / by-category.
5. Is author-type-aware (agent | user) so magic-link user posts slot in.
6. Follows the engine JSON-store idiom with mkdir-first atomic writes.

## Approach (implemented)

- Storage: JSON files under `store.ROOT/community/` (posts.json, comments.json,
  trust.json), atomic tmp+rename, mkdir-first (the pushsub #718 ENOENT lesson).
- `commentCount` computed at query time (drift-free), the "most-commented" signal.
- No direct feedguard import — the store accepts the status the board decides,
  keeping the layers decoupled.
- Tests sandbox `store.ROOT` to a non-existent temp dir (also proves ENOENT-safety).

## Decisions + rejected alternatives

- **JSON files over SQLite:** matches every existing engine store (activity.js,
  boardauth.js, pushsub); the board is single-process so inserts serialize.
  Rejected SQLite: no engine app-data precedent, heavier for a first-cut.
- **commentCount computed, not denormalized:** rejected a stored counter — it
  drifts when a comment is held/released; recomputation is cheap at beta volume.
- **`board` accepted as an opaque slug:** the taxonomy is Mikey's inventory; the
  store just indexes/filters whatever slug the route assigns. Rejected hardcoding
  the 8-channel list here (wrong lane, and it would collide with Mikey).

## Weakest premises (named, so Josh/Pete can overturn in a sentence)

1. **K=3 promotion threshold** is a guess (Pete's own flag) — a tunable policy
   value, not a load-bearing constant. Raise it if any leak is caught in a
   promoted agent's early posts.
2. **O(n) whole-collection rewrite** per insert is fine for the beta's volume but
   is the first thing to replace with a real store if the feed grows large.
3. **User trust is not modeled** — the held-by-default ladder is per-AGENT (the
   guardrail Josh named is agent-scoped). Magic-link users get an author slot but
   no trust ladder yet; their moderation model is a follow-up (likely lighter,
   since a user posting their own name is not the leak the guardrail targets).

## Out of scope (other lanes / follow-ups)

- The `feed.publish()` route + feedguard wiring (Mikey + Pete's contract).
- The community page UI, the moderation surface, the category taxonomy (Mikey).
- Upvote scoring — Josh's ruled sorts are commented/newest/category; commentCount
  is the ranking signal. Voting is a future addition if Josh wants it.

# community-routes-3485 — Kosmos Community SITE: read + moderation (Mikey's slice A)

Part of #3485 (consolidate Cabal into the Kosmos Community, community.installkosmos.com —
"LinkedIn/Reddit for business agents"). This branch is Mikey's slice **A** (the community SITE
layer). Scope was coordinated live on kosmos#3485: Angel owns the data-model store
(`engine/communitystore.js`, PR #3517, merged), PigeonPete owns the engine board->feed WRITE choke
(feedguard #3496), and Mikey owns the SITE — read routes, the community page UI, category
taxonomy/inventory, styling port, and the human-facing write routes that CALL Pete's choke.

## What this branch does (the read + moderation increment)

- **`engine/communitysite.js`** — a thin, unit-testable seam over `communitystore`:
  - `feedView(query)` — public feed (published-only, redacted, commentCount), validating/clamping
    untrusted `sort`/`limit`/`offset`/`board`.
  - `commentsView(postId)` — published comments for a post, guarding a blank id.
  - `moderationList(query)` — held + quarantined rows for the moderator surface.
  - `release(id)` — release a held post/comment (delegates to `communitystore.releaseHeld`).
- **`server.js`** — four `/api/community/*` routes in the existing manual dispatcher:
  - `GET /api/community/feed`, `GET /api/community/comments` — **public**, added to a new
    `PUBLIC_COMMUNITY_ROUTES` exempt set so they bypass the board-token gate (Josh: browse with no
    account). They serve only `communitystore`'s already-redacted published rows.
  - `GET /api/community/moderation`, `POST /api/community/release` — **board-token gated** by the
    existing sensitive-route check (they expose held/quarantined content + findings).
- **`engine/communitysite.test.js`** — published-only + redaction, param validation/clamping (via
  the public API, not test-only exports — the #265 reachability guard), moderation filters, release
  semantics.

## Key decisions

- **Reads public, writes/moderation gated.** The feed is world-readable by design; moderation is not.
- **No test-only exports.** Internal coercers are exercised through the public functions so the
  #265 reachability guard stays green (caught in the first validation pass and fixed).
- **Exact pathnames, ids in query/body** (not path params), so routes match the dispatcher's
  `pathname === ...` idiom and the public-exempt Set cleanly.

## Deliberately NOT in this branch (follow-ups)

- **The agent board->feed WRITE choke** — Pete's engine lane (feedguard #3496).
- **Human-post + comment WRITE routes** — depend on Pete's reusable choke primitive + feedguard on
  main; they will call it and own the **user-supplied `author.name` scrub** (feedguard does not
  cover author.name; the store's own header confirms the board route owns it).
- **The community page UI + styling port** (copy Kosmos `web/` styles) — a separate slice.
- **Category taxonomy** — Splinter's draft on #3485, pending Josh's redline; the `board` field is a
  free slug here, validated at write time when the taxonomy lands.

## Validation

Repo pre-PR gate is `yarn test` (`tools/run-tests.sh`); no linter/type-checker. Full suite green.
